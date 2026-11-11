#!/usr/bin/env node
'use strict';

/**
 * Runs every employee of a month's payroll sheet (the HR workbook, «شهر 9 -2026» and the like) through the system's own payroll arithmetic
 * (lib/payrollCalc.js) and says, employee by employee, whether the net agrees to the piastre (8 Nov 2026: September 2026 — 26 of 26; every month
 * from February 2025 — 681 employee-months, none differing except rows the sheet left blank).
 *
 *   node tools/compare-payroll-sheet.cjs "<file>.xlsx"                 # every month tab
 *   node tools/compare-payroll-sheet.cjs "<file>.xlsx" "شهر 9 -2026"   # one tab
 *
 * Read-only: it opens the file and prints; it touches no database. The sheet holds real salaries — keep it, and what this prints, off the repository.
 *
 * The columns are found by their headings, so a month whose layout moved still reads:
 *   الراتب الاساسى → base salary · عدد ساعات العمل → the day's hours (8 when blank) · نسيان بصمة + تاخير بصمة + خصم اذن وتاخير → hours late (charged by the minute)
 *   اجازه بخصم → a day absent with permission (one day) · اجازه *2 → a day absent without it (two days) · سلف → advance · تامين → social insurance
 *   every «خصم …» column but «خصم اذن وتاخير» (خصم، خصم مكالمات او تارجيت …) + جزاءات → manual deduction · اجمالي الاوفر تايم + حافز + بدلات → the month's additions (the system has no overtime of its own: they go in as a bonus)
 *   صافى الراتب → the sheet's net.
 */
const fs = require('fs');
const path = require('path');
const { readXlsx } = require('../lib/xlsxRead');
const { computePayrollLine, UNEXCUSED_ABSENCE_DAYS } = require('../lib/payrollCalc');

const HEADINGS = {
  salary: 'الراتب الاساسى', hours: 'عدد ساعات العمل', forgot: 'نسيان بصمة', late: 'تاخير بصمة', permission: 'خصم اذن وتاخير',
  absentExcused: 'اجازه بخصم', absentTwice: 'اجازه *2', advance: 'سلف', insurance: 'تامين', penalties: 'جزاءات',
  overtime: 'اجمالي الاوفر تايم', incentive: 'حافز', allowances: 'بدلات', net: 'صافى الراتب', name: 'اسم الموظف',
};
const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const round2 = value => Math.round(value * 100) / 100;

/** The column of each heading, from the first row that holds the base salary's heading. */
function columnsOf(rows) {
  const at = rows.findIndex(row => row.some(cell => clean(cell) === HEADINGS.salary));
  if (at < 0) return null;
  const columns = {};
  for (const [key, heading] of Object.entries(HEADINGS)) {
    const index = rows[at].findIndex(cell => clean(cell) === heading);
    if (index >= 0) columns[key] = index;
  }
  // A month's other deductions are headed «خصم», «خصم مكالمات او تارجيت» and the like; «خصم اذن وتاخير» is lateness, read above.
  columns.deductions = rows[at].map((cell, index) => [clean(cell), index]).filter(([text]) => text.startsWith('خصم') && text !== HEADINGS.permission).map(([, index]) => index);
  return { headingRow: at, columns };
}

/** One tab compared: { employees, differing: [{ name, sheet, system, diff }] }. A row is an employee when it has a name and a salary and is not a total. */
function compareTab(tab) {
  const found = columnsOf(tab.rows);
  if (!found || found.columns.net === undefined) return null;
  const { columns } = found;
  const number = (row, key) => (columns[key] === undefined ? 0 : Number(row[columns[key]]) || 0);
  const results = [];
  for (const row of tab.rows.slice(found.headingRow + 1)) {
    const name = clean(row[columns.name]);
    const salary = number(row, 'salary');
    if (!name || !salary || /^اجمال/.test(name)) continue;
    const hours = number(row, 'hours') || 8;
    const lateHours = number(row, 'forgot') + number(row, 'late') + number(row, 'permission');
    const line = computePayrollLine(
      { deduction_social_insurance: number(row, 'insurance') },
      {
        baseSalary: salary, workdayMinutes: hours * 60,
        attendance: {
          absent_days: number(row, 'absentExcused') + number(row, 'absentTwice'), unexcused_absent_days: number(row, 'absentTwice'),
          absent_charged_days: number(row, 'absentExcused') + number(row, 'absentTwice') * UNEXCUSED_ABSENCE_DAYS,
          late_minutes: Math.round(lateHours * 60),
        },
        advanceDeduction: number(row, 'advance'), deduction: columns.deductions.reduce((sum, index) => sum + (Number(row[index]) || 0), 0) + number(row, 'penalties'),
        bonus: number(row, 'overtime') + number(row, 'incentive') + number(row, 'allowances'),
      });
    const sheetNet = row[columns.net] == null || row[columns.net] === '' ? null : number(row, 'net');
    results.push({ name, sheet: sheetNet, system: round2(line.netSalary), diff: sheetNet == null ? null : round2(line.netSalary - sheetNet) });
  }
  return { employees: results.length, results, differing: results.filter(item => item.diff == null || Math.abs(item.diff) >= 0.01) };
}

function main() {
  const [file, only] = process.argv.slice(2);
  if (!file) { console.error('usage: node tools/compare-payroll-sheet.cjs "<file>.xlsx" ["<tab>"]'); process.exit(2); }
  const tabs = readXlsx(fs.readFileSync(path.resolve(file))).filter(tab => (only ? clean(tab.name) === clean(only) : /^شهر/.test(clean(tab.name))));
  let all = 0; let bad = 0;
  for (const tab of tabs) {
    const result = compareTab(tab);
    if (!result) { console.log(`${clean(tab.name)}: no «${HEADINGS.salary}» / «${HEADINGS.net}» heading — skipped`); continue; }
    all += result.employees; bad += result.differing.length;
    console.log(`${clean(tab.name)}: ${result.employees} employees, ${result.employees - result.differing.length} agree to the piastre`);
    for (const item of result.differing) {
      console.log(`   ${item.name}: sheet ${item.sheet == null ? '(blank)' : item.sheet} · system ${item.system}${item.diff == null ? '' : ` · difference ${item.diff}`}`);
    }
  }
  console.log(`${all} employee-months, ${all - bad} agree, ${bad} to look at.`);
}

if (require.main === module) main();

module.exports = { compareTab, columnsOf };
