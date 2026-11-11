// The form of «حوافز المبيعات التلقائية في المسير» and the settings the server keeps (api/lib/payrollCommission.js): the team's rule, and a list of rules that
// replace it for a department or an employee. Pure, so what is sent can be tested without the screen.

export type CommissionMode = 'OFF' | 'RULES' | 'PERCENT';
export type CommissionRule = { mode: CommissionMode; rate: number };
export type CommissionSettings = { team: CommissionRule; departments: Record<string, CommissionRule>; staff: Record<string, CommissionRule> };
export type CommissionException = { scope: 'department' | 'staff'; id: string; mode: CommissionMode; rate: string };
export type CommissionForm = { team: { mode: CommissionMode; rate: string }; exceptions: CommissionException[] };

const rateText = (rule: CommissionRule) => (rule.mode === 'PERCENT' ? String(rule.rate) : '');

export function fromCommissionSettings(settings: CommissionSettings): CommissionForm {
  const rows = (scope: CommissionException['scope'], rules: Record<string, CommissionRule>) =>
    Object.entries(rules).map(([id, rule]) => ({ scope, id, mode: rule.mode, rate: rateText(rule) }));
  return { team: { mode: settings.team.mode, rate: rateText(settings.team) }, exceptions: [...rows('department', settings.departments), ...rows('staff', settings.staff)] };
}

/** What to save, or what is wrong with the form in the owner's words. */
export function toCommissionSettings(form: CommissionForm): { settings: CommissionSettings } | { error: string } {
  const ruleOf = (mode: CommissionMode, rate: string): CommissionRule | null => {
    if (mode !== 'PERCENT') return { mode, rate: 0 };
    const value = Number(rate);
    return rate.trim() !== '' && value > 0 && value <= 100 ? { mode, rate: value } : null;
  };
  const team = ruleOf(form.team.mode, form.team.rate);
  if (!team) return { error: 'اكتب نسبة الفريق (أكبر من صفر ولحد 100)' };
  const settings: CommissionSettings = { team, departments: {}, staff: {} };
  for (const row of form.exceptions) {
    const scope = row.scope === 'department' ? settings.departments : settings.staff;
    const label = row.scope === 'department' ? 'القسم' : 'الموظف';
    if (!row.id) return { error: `اختر ${label} في كل قاعدة أو احذفها` };
    if (scope[row.id]) return { error: `${label} متكرر في أكتر من قاعدة` };
    const rule = ruleOf(row.mode, row.rate);
    if (!rule) return { error: `اكتب النسبة في قاعدة ${label} (أكبر من صفر ولحد 100)` };
    scope[row.id] = rule;
  }
  return { settings };
}
