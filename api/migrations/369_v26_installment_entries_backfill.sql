-- 7 Nov 2026 (plan 9.5, «الأقساط لجدول مفهرس»): one row per instalment of a plan in installment_entries, so «what is overdue» is an indexed range read instead of every plan's
-- JSON arrays walked in JavaScript.
--
-- installment_plans keeps a plan as parallel JSON arrays (installment_amounts, due_dates, paid_dates). The table installment_entries (migration 014, with
-- idx_entry_due (tenant_id, due_date, paid)) was never written to; from this release the writers keep it in step (lib/installmentEntries.js syncPlanEntries, called after
-- every write of a plan) and a nightly job recounts it. This copies what exists: an entry is a plan's i-th instalment that has a due date; it is paid when paid_dates[i] is
-- set. The plan stays the source: the table can always be rebuilt from it (lib/installmentEntries.js rebuildInstallmentEntries).
-- Plans have at most a few dozen instalments; sixty positions are walked.
--
-- The row carries its client (subscriber_id): the list joins entries -> clients without going through the plan first (the optimiser started from the clients and took 11 s
-- for the 120,000 overdue rows of the lab; from the entries' own index it is a range read).
--
-- Rollback: the readers fall back to the plans when the table is empty; DELETE FROM installment_entries clears it.

ALTER TABLE installment_entries ADD COLUMN IF NOT EXISTS subscriber_id VARCHAR(100) DEFAULT NULL;

INSERT IGNORE INTO installment_entries (id, plan_id, tenant_id, seq, due_date, amount, paid, paid_at, payment_id, subscriber_id)
SELECT CONCAT(ip.id, '-', n.i + 1), ip.id, ip.tenant_id, n.i,
       STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(ip.due_dates, CONCAT('$[', n.i, ']'))), 10), '%Y-%m-%d'),
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ip.installment_amounts, CONCAT('$[', n.i, ']'))), 'null') + 0, ip.total_amount / NULLIF(ip.installments_count, 0), 0),
       COALESCE(JSON_UNQUOTE(JSON_EXTRACT(ip.paid_dates, CONCAT('$[', n.i, ']'))) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}', 0),
       IF(JSON_UNQUOTE(JSON_EXTRACT(ip.paid_dates, CONCAT('$[', n.i, ']'))) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}',
          STR_TO_DATE(LEFT(JSON_UNQUOTE(JSON_EXTRACT(ip.paid_dates, CONCAT('$[', n.i, ']'))), 10), '%Y-%m-%d'), NULL),
       NULLIF(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(ip.payment_ids, CONCAT('$[', n.i, ']'))), 'null'), ''),
       ip.subscriber_id
  FROM installment_plans ip
  JOIN (SELECT 0 AS i UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
        UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15 UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19
        UNION ALL SELECT 20 UNION ALL SELECT 21 UNION ALL SELECT 22 UNION ALL SELECT 23 UNION ALL SELECT 24 UNION ALL SELECT 25 UNION ALL SELECT 26 UNION ALL SELECT 27 UNION ALL SELECT 28 UNION ALL SELECT 29
        UNION ALL SELECT 30 UNION ALL SELECT 31 UNION ALL SELECT 32 UNION ALL SELECT 33 UNION ALL SELECT 34 UNION ALL SELECT 35 UNION ALL SELECT 36 UNION ALL SELECT 37 UNION ALL SELECT 38 UNION ALL SELECT 39
        UNION ALL SELECT 40 UNION ALL SELECT 41 UNION ALL SELECT 42 UNION ALL SELECT 43 UNION ALL SELECT 44 UNION ALL SELECT 45 UNION ALL SELECT 46 UNION ALL SELECT 47 UNION ALL SELECT 48 UNION ALL SELECT 49
        UNION ALL SELECT 50 UNION ALL SELECT 51 UNION ALL SELECT 52 UNION ALL SELECT 53 UNION ALL SELECT 54 UNION ALL SELECT 55 UNION ALL SELECT 56 UNION ALL SELECT 57 UNION ALL SELECT 58 UNION ALL SELECT 59) n
    ON n.i < COALESCE(NULLIF(ip.installments_count, 0), JSON_LENGTH(ip.due_dates), 0)
 WHERE JSON_VALID(ip.due_dates)
   AND JSON_UNQUOTE(JSON_EXTRACT(ip.due_dates, CONCAT('$[', n.i, ']'))) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}';
