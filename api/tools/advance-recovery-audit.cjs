'use strict';
// Salary-advance recovery audit: READ-ONLY (migration 385, 11 Nov 2026).
//
// Before migration 385 a paid payroll run recorded what it could take of an advance on the employee's payslip (payroll_items.advance_deductions) but not against
// the advance, and an advance the salary could not absorb stayed DISBURSED and was never read again. The migration credits recovered_amount only where that is
// exact (one advance for the month, in EGP, one paid run). This lists every DISBURSED advance whose deduction month is before the current month, with what its
// recovered_amount is now and what the paid runs of that month deducted from that employee, so the owner can check the ones the migration left at 0.
//
// Only SELECT statements are issued, the session is READ ONLY, and it starts only when the DB_* variables are in the environment (no .env is read).
//
//   DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=... DB_PASSWORD=... DB_NAME=... node tools/advance-recovery-audit.cjs [--json]
//
// Exit code: 0 = nothing to check, 1 = advances to check, 2 = could not run.

const mysql = require('mysql2/promise');

const QUERY = `
  SELECT a.id, a.tenant_id, a.staff_id, s.name AS staff_name, a.amount, a.recovered_amount, a.currency, a.deduct_month, a.deduct_year, a.disbursed_at,
         (SELECT COUNT(*) FROM salary_advances o WHERE o.tenant_id=a.tenant_id AND o.staff_id=a.staff_id AND o.deduct_month=a.deduct_month
             AND o.deduct_year=a.deduct_year AND o.status IN ('DISBURSED','DEDUCTED')) AS advances_that_month,
         (SELECT COALESCE(SUM(pi.advance_deductions),0) FROM payroll_runs pr JOIN payroll_items pi ON pi.payroll_run_id=pr.id AND pi.tenant_id=pr.tenant_id
            WHERE pr.tenant_id=a.tenant_id AND pr.status='PAID' AND pr.month=a.deduct_month AND pr.year=a.deduct_year AND pi.staff_id=a.staff_id) AS paid_runs_deducted,
         (SELECT COUNT(*) FROM payroll_runs pr JOIN payroll_items pi ON pi.payroll_run_id=pr.id AND pi.tenant_id=pr.tenant_id
            WHERE pr.tenant_id=a.tenant_id AND pr.status='PAID' AND pr.month=a.deduct_month AND pr.year=a.deduct_year AND pi.staff_id=a.staff_id) AS paid_items
    FROM salary_advances a JOIN staff s ON s.id=a.staff_id AND s.tenant_id=a.tenant_id
   WHERE a.status='DISBURSED' AND a.deduct_year*12 + a.deduct_month < ?
   ORDER BY a.tenant_id, s.name, a.deduct_year, a.deduct_month`;

function verdict(row) {
  const owed = Number(row.amount) - Number(row.recovered_amount);
  if (Number(row.paid_runs_deducted) > 0 && Number(row.recovered_amount) === 0) {
    return `CHECK: paid run(s) deducted ${row.paid_runs_deducted} from this employee that month but recovered_amount is 0 (${row.advances_that_month} advance(s) that month, ${row.currency}) — set it by hand`;
  }
  if (Number(row.paid_items) === 0) return `owed ${owed} — no paid run covers ${row.deduct_month}/${row.deduct_year}; the next run takes it`;
  return `owed ${owed} — the next run takes it`;
}

async function main() {
  const need = ['DB_HOST', 'DB_USER', 'DB_NAME'];
  const missing = need.filter(key => !process.env[key]);
  if (missing.length) { console.error(`Set ${missing.join(', ')} in the environment (no .env is read).`); process.exit(2); }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME,
  });
  try {
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
    const [rows] = await conn.query(QUERY, [now.getFullYear() * 12 + now.getMonth() + 1]);
    const out = rows.map(row => ({ ...row, verdict: verdict(row) }));
    if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
    else {
      for (const row of out) console.log(`${row.staff_name} | ${row.deduct_month}/${row.deduct_year} | ${row.amount} ${row.currency} | recovered ${row.recovered_amount} | paid runs took ${row.paid_runs_deducted} | ${row.verdict}`);
      console.log(`${out.length} disbursed advance(s) from past months; ${out.filter(row => row.verdict.startsWith('CHECK')).length} to check by hand.`);
    }
    process.exitCode = out.some(row => row.verdict.startsWith('CHECK')) ? 1 : 0;
  } finally { await conn.end(); }
}

main().catch(error => { console.error(error.message); process.exit(2); });
