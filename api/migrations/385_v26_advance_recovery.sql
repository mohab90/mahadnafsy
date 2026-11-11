-- 11 Nov 2026, the owner on salary advances «موافق لعمود السلف»: an advance the salary could not absorb is no longer forgotten. The payroll run reads every
-- DISBURSED advance whose deduction month is this month or earlier and takes what is still owed (amount - recovered_amount), oldest first, only as far as the salary
-- carries it; recovered_amount grows when the run is PAID (never at CALCULATE), and the advance becomes DEDUCTED when it is fully recovered.
ALTER TABLE salary_advances ADD COLUMN IF NOT EXISTS recovered_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER amount;

-- Advances of past months that are still DISBURSED: before this migration a paid run recorded what it could absorb on the employee's payroll item
-- (advance_deductions) but not against the advance. That figure is credited to the advance only when it is exact — the employee had that one advance for that
-- month (so nothing has to be split), it is in EGP (so nothing is converted), it was disbursed before the run was paid, and exactly one paid run covers the month.
-- Every other case stays at 0 for the owner to check: node api/tools/advance-recovery-audit.cjs lists them with what the paid runs deducted.
UPDATE salary_advances a
  JOIN (
    SELECT a2.id, LEAST(a2.amount, pi.advance_deductions) AS recovered
      FROM salary_advances a2
      JOIN payroll_runs pr ON pr.tenant_id=a2.tenant_id AND pr.status='PAID' AND pr.month=a2.deduct_month AND pr.year=a2.deduct_year
      JOIN payroll_items pi ON pi.payroll_run_id=pr.id AND pi.tenant_id=a2.tenant_id AND pi.staff_id=a2.staff_id
     WHERE a2.status='DISBURSED' AND a2.currency='EGP' AND pi.advance_deductions>0
       AND (a2.disbursed_at IS NULL OR pr.paid_at IS NULL OR a2.disbursed_at<=pr.paid_at)
       AND (SELECT COUNT(*) FROM salary_advances o
             WHERE o.tenant_id=a2.tenant_id AND o.staff_id=a2.staff_id AND o.deduct_month=a2.deduct_month AND o.deduct_year=a2.deduct_year
               AND o.status IN ('DISBURSED','DEDUCTED'))=1
       AND (SELECT COUNT(*) FROM payroll_runs pr2
              JOIN payroll_items pi2 ON pi2.payroll_run_id=pr2.id AND pi2.tenant_id=pr2.tenant_id
             WHERE pr2.tenant_id=a2.tenant_id AND pr2.status='PAID' AND pr2.month=a2.deduct_month AND pr2.year=a2.deduct_year
               AND pi2.staff_id=a2.staff_id)=1
  ) exact ON exact.id=a.id
  SET a.recovered_amount=exact.recovered
  WHERE a.recovered_amount=0;
