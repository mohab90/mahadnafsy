#!/usr/bin/env node
'use strict';

/**
 * Brings the instalment plans already on the server in line with what each client owes (8 Nov 2026). From this release a plan follows every price change and
 * every payment as it happens (lib/planFollowsMoney.js); plans made before it may still ask for money already paid at «دفع وحجز», or for a price since lowered —
 * the overdue list then shows instalments nobody owes. DRY RUN by default: every item is worked out in a transaction that is rolled back.
 *
 *   node tools/plans-follow-money.cjs [--tenant=<id>]            # the report: each plan that would change, its open amount before and after
 *   node tools/plans-follow-money.cjs --apply [--tenant=<id>]    # does it, one item per transaction
 *
 * Only the rule «a plan never asks for more than is left on its item» is applied here (the excess comes off its last open instalments); a plan asking for less
 * is left alone. --apply writes the old rows of every plan it changes to ./plans-follow-money-<time>.jsonl (one line per plan) before each commit. Reads api/.env — point it at the database you mean.
 */
const fs = require('fs');
const path = require('path');
const { EOL } = require('os');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const APPLY = process.argv.includes('--apply');
const arg = name => (process.argv.find(value => value.startsWith(`--${name}=`)) || '').split('=')[1] || '';
const COLUMNS = 'id, tenant_id, subscriber_id, course_id, bundle_id, currency, total_amount, installments_count, paid_count, installment_amounts, due_dates, paid_dates, paid_amounts, payment_ids, status';

const openOf = rows => {
  const { planEntries } = require('../lib/installmentMath');
  return rows.flatMap(plan => planEntries(plan)).filter(entry => !entry.paidAt).reduce((sum, entry) => sum + entry.amount - (entry.partialPaid || 0), 0);
};

async function main() {
  const { pool } = require('../lib/db');
  const { planFollowsMoney } = require('../lib/planFollowsMoney');
  const tenant = arg('tenant');
  const [items] = await pool.query(
    `SELECT DISTINCT tenant_id, subscriber_id, course_id, bundle_id FROM installment_plans
      WHERE status='active' AND (course_id IS NOT NULL OR bundle_id IS NOT NULL)${tenant ? ' AND tenant_id=?' : ''}`, tenant ? [tenant] : []);
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${items.length} items with an active plan`);
  const file = path.join(process.cwd(), `plans-follow-money-${Date.now()}.jsonl`);
  let changedItems = 0;
  for (const item of items) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const where = 'tenant_id=? AND subscriber_id=? AND course_id <=> ? AND bundle_id <=> ? AND status=\'active\'';
      const params = [item.tenant_id, item.subscriber_id, item.bundle_id ? null : item.course_id, item.bundle_id];
      const [old] = await conn.query(`SELECT ${COLUMNS} FROM installment_plans WHERE ${where}`, params);
      const written = await planFollowsMoney(conn, { tenantId: item.tenant_id, subscriberId: item.subscriber_id, courseId: item.course_id, bundleId: item.bundle_id });
      if (written.length) {
        const [now] = await conn.query(`SELECT ${COLUMNS} FROM installment_plans WHERE id IN (?)`, [written]);
        const before = old.filter(plan => written.includes(plan.id));
        console.log(`  ${item.subscriber_id} ${item.bundle_id ? `bundle:${item.bundle_id}` : item.course_id}: open ${openOf(before)} -> ${openOf(now)} (${written.length} plan${written.length > 1 ? 's' : ''})`);
        if (APPLY) fs.appendFileSync(file, before.map(plan => `${JSON.stringify(plan)}${EOL}`).join(''));
        changedItems += 1;
      }
      if (APPLY) await conn.commit(); else await conn.rollback();
    } catch (error) {
      await conn.rollback().catch(() => {});
      console.error(`  ${item.subscriber_id}: ${error.message}`);
    } finally { conn.release(); }
  }
  console.log(`${changedItems} items ${APPLY ? 'changed' : 'would change'}.`);
  if (APPLY && changedItems) console.log(`old rows of the changed plans: ${file}`);
  if (!APPLY) console.log('nothing was written. Re-run with --apply to change it.');
  await pool.end();
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exit(1); });
