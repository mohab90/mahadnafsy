'use strict';

// «حوافز المبيعات التلقائية في المسير» (10 Nov 2026). Payroll adds no sales commission of its own unless the owner switches it on here: the month's bonus plan
// and what is typed by hand are the pay over the salary. Switched on, a rule says how it is worked out — from the commission rules written at payment time
// (crm_commissions), or as a percentage of the month's course sales — for the whole team, one department or one employee; the closest rule wins
// (employee, then department, then team). Kept in tenant_settings section 'payroll_commission'. Pure: no database.

const MODES = Object.freeze(['OFF', 'RULES', 'PERCENT']);
const OFF = Object.freeze({ mode: 'OFF', rate: 0 });

const bad = message => Object.assign(new Error(message), { statusCode: 400 });

function normalizeRule(raw, where) {
  if (raw == null) return { ...OFF };
  const mode = String(raw.mode || 'OFF').toUpperCase();
  if (!MODES.includes(mode)) throw bad(`طريقة حساب غير معروفة في ${where}`);
  if (mode !== 'PERCENT') return { mode, rate: 0 };
  const rate = Number(raw.rate);
  if (!(Number.isFinite(rate) && rate > 0 && rate <= 100)) throw bad(`النسبة في ${where} لازم تكون أكبر من صفر ولحد 100`);
  return { mode, rate: Math.round(rate * 100) / 100 };
}

function normalizeScope(raw, label) {
  const scope = {};
  for (const [id, rule] of Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {})) {
    const key = String(id).trim();
    if (!key || key.length > 64) throw bad(`${label} غير صحيح`);
    scope[key] = normalizeRule(rule, label);
  }
  return scope;
}

/** The stored settings, checked: the team's rule (off unless set) and the rules that replace it for a department or an employee. */
function normalizeCommissionSettings(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    team: normalizeRule(source.team, 'قاعدة الفريق'),
    departments: normalizeScope(source.departments, 'قاعدة القسم'),
    staff: normalizeScope(source.staff, 'قاعدة الموظف'),
  };
}

/** The rule one employee is under: their own, else their department's, else the team's. */
function commissionRuleFor(settings, { staffId, departmentId }) {
  return settings.staff[staffId] || (departmentId != null && settings.departments[departmentId]) || settings.team;
}

/** What the rule pays for the month: `rules` is the employee's crm_commissions total { amt, cnt }, `sales` their course sales in EGP. */
function commissionOf(rule, { rules = null, sales = 0 } = {}) {
  if (rule.mode === 'RULES') return { amount: Number(rules?.amt) || 0, count: Number(rules?.cnt) || 0, source: 'crm_commissions' };
  if (rule.mode === 'PERCENT') return { amount: Math.round((Number(sales) || 0) * rule.rate) / 100, count: null, source: 'percent_of_sales' };
  return { amount: 0, count: null, source: 'off' };
}

module.exports = { MODES, normalizeCommissionSettings, commissionRuleFor, commissionOf };
