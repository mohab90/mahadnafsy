'use strict';

// Which salary a month is priced at. The payroll run, and every place that turns «days» into money (the manager's penalty), take it from here so a day cannot
// cost one figure on the sheet and another on the payslip.
//
// An approved salary structure that covers the month (the newest one when two do) wins, with its allowances and approval trail; the basic salary typed on the
// employee's file (staff.base_salary) counts only when no structure covers the month.

const { PAY_MONTH_DAYS } = require('./payrollCalc');

// The LEFT JOIN condition of the structure that covers a month, for the staff alias `s` and the structure alias `ss`. Its eight placeholders take structureParams(y, m).
const STRUCTURE_FOR_MONTH_ON = `ss.staff_id=s.id AND ss.tenant_id=s.tenant_id
        AND ss.status='APPROVED'
        AND ss.effective_from<=LAST_DAY(STR_TO_DATE(CONCAT(?, '-', ?, '-01'),'%Y-%m-%d'))
        AND (ss.effective_to IS NULL OR ss.effective_to>=STR_TO_DATE(CONCAT(?, '-', ?, '-01'),'%Y-%m-%d'))
        AND NOT EXISTS (
          SELECT 1 FROM salary_structures newer
           WHERE newer.tenant_id=ss.tenant_id AND newer.staff_id=ss.staff_id
             AND newer.status='APPROVED'
             AND newer.effective_from<=LAST_DAY(STR_TO_DATE(CONCAT(?, '-', ?, '-01'),'%Y-%m-%d'))
             AND (newer.effective_to IS NULL OR newer.effective_to>=STR_TO_DATE(CONCAT(?, '-', ?, '-01'),'%Y-%m-%d'))
             AND newer.effective_from>ss.effective_from
        )`;
const structureParams = (year, month) => [year, month, year, month, year, month, year, month];

/**
 * The basic salary a month is priced at, in the currency it is written in.
 * @returns {Promise<{ base: number|null, currency: string, source: 'salary_structure'|'staff_file'|null }>}
 */
async function monthBaseSalary(db, tenantId, staffId, year, month) {
  const [[row]] = await db.query(
    `SELECT s.base_salary AS staff_base_salary, ss.base_salary, ss.currency
       FROM staff s LEFT JOIN salary_structures ss ON ${STRUCTURE_FOR_MONTH_ON}
      WHERE s.tenant_id=? AND s.id=? LIMIT 1`,
    [...structureParams(year, month), tenantId, staffId]);
  if (!row) return { base: null, currency: 'EGP', source: null };
  if (row.base_salary != null) return { base: Number(row.base_salary), currency: String(row.currency || 'EGP').toUpperCase(), source: 'salary_structure' };
  if (Number(row.staff_base_salary) > 0) return { base: Number(row.staff_base_salary), currency: 'EGP', source: 'staff_file' };
  return { base: null, currency: 'EGP', source: null };
}

/** The value of one day's pay in EGP (a thirtieth of the month's salary, converted), or null when the month has no salary. fx: currency -> EGP rate. */
async function dayPayEgp(db, tenantId, staffId, year, month, fx = {}) {
  const { base, currency } = await monthBaseSalary(db, tenantId, staffId, year, month);
  if (!(base > 0)) return null;
  const rate = currency === 'EGP' ? 1 : Number(fx[currency] || 1);
  return (base * rate) / PAY_MONTH_DAYS;
}

module.exports = { STRUCTURE_FOR_MONTH_ON, structureParams, monthBaseSalary, dayPayEgp };
