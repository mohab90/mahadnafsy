import { useEffect, useState } from 'react';
import { adminAuthHeaders } from '../lib/adminAuthHeaders';

/**
 * Where an employee's message goes (8 Oct 2026: «كل فريق يقدر يبعت للفريق التاني
 * … للدقي فقط او خدمه العملاء فقط او فريق الاونلاين فقط او الادارة فقط او لمدير
 * محدد او للفريق كله»). The value is the scope POST /api/staff/me/messages takes:
 * 'management', 'team', 'team:<key>', 'manager:<staffId>' or 'all'. The teams
 * and managers come from GET /api/staff/me/messages/targets — only those with
 * someone in them.
 */
type Targets = {
  teams: Array<{ scope: string; label: string; count: number }>;
  managers: Array<{ scope: string; label: string; role: string }>;
  everyone: number;
};

let cached: Promise<Targets | null> | null = null;
const loadTargets = () => {
  cached = cached || fetch('/api/staff/me/messages/targets', { credentials: 'include', headers: adminAuthHeaders() })
    .then(response => (response.ok ? response.json() : null))
    .catch(() => null)
    .then(result => { if (!result) cached = null; return result; });
  return cached;
};

/** What the sender is told once it went. */
export function sentLabel(scope: string, targets: Targets | null): string {
  if (scope === 'management') return 'وصلت للإدارة';
  if (scope === 'team') return 'وصلت لفريقك';
  if (scope === 'all') return 'وصلت للفريق كله';
  const team = targets?.teams.find(item => item.scope === scope);
  if (team) return `وصلت لـ${team.label}`;
  const manager = targets?.managers.find(item => item.scope === scope);
  if (manager) return `وصلت لـ${manager.label}`;
  return 'اتبعتت';
}

export function useStaffMessageTargets() {
  const [targets, setTargets] = useState<Targets | null>(null);
  useEffect(() => {
    let alive = true;
    void loadTargets().then(result => { if (alive) setTargets(result); });
    return () => { alive = false; };
  }, []);
  return targets;
}

export function StaffMessageScopeSelect({ value, onChange, targets, className }: {
  value: string;
  onChange: (scope: string) => void;
  targets: Targets | null;
  className?: string;
}) {
  return (
    <select value={value} onChange={event => onChange(event.target.value)} className={className}>
      <option value="management">الإدارة</option>
      <option value="team">فريقي</option>
      {targets && targets.teams.length > 0 && (
        <optgroup label="فريق تاني">
          {targets.teams.map(team => <option key={team.scope} value={team.scope}>{team.label} ({team.count})</option>)}
        </optgroup>
      )}
      {targets && targets.managers.length > 0 && (
        <optgroup label="مدير محدد">
          {targets.managers.map(manager => <option key={manager.scope} value={manager.scope}>{manager.label} — {manager.role}</option>)}
        </optgroup>
      )}
      <option value="all">الفريق كله{targets ? ` (${targets.everyone})` : ''}</option>
    </select>
  );
}
