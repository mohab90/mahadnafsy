# Foreign keys: plan, audit, and what is deliberately not automatic

## Where things stand

`api/schema.sql` (dump of production, current branch) has 254 tables and 82 FOREIGN KEY constraints.
227 further columns are clearly references to another table (`*_id` whose target exists) and have no
constraint, so the database accepts a row that points at nothing. Another 85 `*_id` columns were left out on
purpose: external or polymorphic ids (`orders.item_id`, `*.provider_message_id`, `fb_lead_id`), audit and
history logs that must outlive what they describe (`audit_logs`, `payment_audit_log`, `lead_merge_audit`),
aggregate or one-off backfill tables, and national/tax ids that merely end in `_id`.

Facts found while reading the schema:

- No child/parent pair among the 227 has a type or character-set mismatch in `schema.sql` (all tables are
  `utf8mb4_unicode_ci`; varchar lengths differ in places, which a foreign key allows). The live database may
  differ, which is why the audit compares types too.
- `payments.subscriber_id -> subscribers.id` and `journal_entry_lines.entry_id -> journal_entries.id` are
  `ON DELETE CASCADE`: hard-deleting a client would delete their payments. Not changed here; worth a decision
  later (RESTRICT, with soft delete as the only way to remove a client).
- Four candidate tables have no `tenant_id` (`therapist_slots`, `lecture_progress`, `kpi_actuals`,
  `support_messages`), so no cross-tenant check is possible for them.
- The repo already uses composite tenant keys in places (`(tenant_id, staff_id) -> staff (tenant_id, id)` on
  `employee_onboarding`). A plain key on `id` cannot stop a row pointing at another tenant's parent; the audit
  counts those rows separately (`xtenant`).
- `routes/orders.js` (PATCH around line 393) writes `linked_transfer_id` straight from the request body, so
  that relation is the most likely to contain orphans.

## The 227 relations, ranked (the list lives in `api/tools/orphan-row-audit.cjs`)

| Tier | Count | What |
| --- | --- | --- |
| 1 money | 49 | refunds, refund_requests, installment_plans / installment_entries, orders, payments (staff, linked transfer), payment_intents / attempts / proofs, paymob_order_links, incoming_transfers, journal-entry links (accounts payable, box_withdrawals, salary_advances), crm_commissions, instructor_fees, payroll_items, salary_advances, bonus_adjustments |
| 2 enrolments and access | 41 | subscriptions, subscriber_subscriptions, entitlement_events, lecture_progress / completions, course_ratings / waitlists, daqqi attendance, consultations, physical_checkins, loyalty_ledger, referral_codes, ... |
| 3 the rest | 137 | leads, tickets, inbox, HR (attendance, leaves, documents, KPIs), notifications, community, branch_id columns, ... |

Print any tier with `node api/tools/orphan-row-audit.cjs --emit-sql --tier N` (no database needed).

## What the owner runs

Nothing here changes data until step 4, and step 4 is manual.

1. Audit, read-only (SELECT only, session set READ ONLY). It refuses to start unless all of `DB_HOST DB_PORT
   DB_USER DB_PASSWORD DB_NAME` are in the environment; it never reads a `.env`:
   ```
   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=... DB_PASSWORD=... DB_NAME=... \
     node api/tools/orphan-row-audit.cjs --tier 1
   ```
   Output: one row per relation (references, orphans, orphans among live rows, cross-tenant, type check),
   example orphan ids, then JSON. Exit 0 = clean, 1 = orphans found, 2 = could not run. `--json` prints JSON
   only, `--only refunds.payment_id` checks one relation, `--no-samples` skips the example ids.
2. Send the output back. For each relation with orphans, decide whether the rows are dead (then a reviewed
   clean-up script, separate from this) or the application writes a bad value (then fix the writer first).
3. Back up, pick a quiet hour.
4. For each tier-1 relation showing `orphans = 0` and `ok` types, run its statement from
   `docs/FOREIGN_KEYS_PLAN.sql`, wrapped as the header there says (`foreign_key_checks = 0`,
   `ALGORITHM=INPLACE, LOCK=NONE`, which is the only way MariaDB adds a key without copying/locking the table;
   with checks on it fails with "needs foreign_key_checks=OFF"). Run the audit again: the relation now reports
   "already has a foreign key".

## Why there is no migration

The task was to ship one only if it could be made safe. It cannot, with this migration runner:

- `lib/migrationRunner.js` runs each statement separately through the pool and stops the whole run on the first
  error. There is no `DELIMITER`, procedure, or same-connection `PREPARE` to express "add this key only if no
  orphans". The only guard it understands is `ADD CONSTRAINT IF NOT EXISTS`, which checks the name, not the data.
- One orphan row in production would therefore fail the deploy and leave every later migration unapplied.
- Adding a key with `foreign_key_checks = 1` rewrites the table with writes blocked, on tables the size of
  `payments`/`orders`; with checks off it adds the key unvalidated, which is only safe straight after an audit.
- A fresh database is built from `schema.sql` and replays migrations, so a conditional skip would also make
  environments diverge silently.

So the safe shape is: audit, clean, then apply by hand per relation. The SQL file is generated by the tool
(`--emit-sql`) and a unit test keeps the two identical. Every key is `ON DELETE RESTRICT ON UPDATE RESTRICT`;
nothing cascades or sets null on a financial row. A migration becomes reasonable once the audit is clean on
production: it would then be a plain `ADD CONSTRAINT IF NOT EXISTS` list with no guard needed.

## What this does not do

- It does not add, change or drop any constraint, index, or row by itself, and ships no migration.
- It does not touch the two existing CASCADE keys above.
- It does not enforce tenant matching (needs composite keys on `(tenant_id, id)`, a larger change).

## Later phases

1. Tier 1 keys (this plan), then re-audit.
2. Tier 2 (enrolment and access), same procedure; `lecture_progress.lecture_id` has no `lectures` table in
   the schema and needs the lecture source identified first.
3. Tier 3 in batches by area; HR tables last (payroll code is being changed separately).
4. Decide on `payments.subscriber_id` and `journal_entry_lines.entry_id` CASCADE, and on composite tenant keys.
5. Add the audit to the weekly checks and fail CI on a new `*_id` column that has neither a key nor an entry in
   the "left out on purpose" list.
