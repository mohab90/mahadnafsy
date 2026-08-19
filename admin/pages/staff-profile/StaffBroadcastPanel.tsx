import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone, Send, Users, Building2, UserRound, Check } from 'lucide-react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type { StaffMember } from '../../types';
import { fmtNum } from './types';

type Audiences = {
  total: number;
  roles: { role: string; label: string; count: number }[];
  branches: { id: string; label: string; count: number }[];
};
type Mode = 'all' | 'role' | 'branch' | 'staff';

/**
 * Group messaging composer. A broadcast fans out into each recipient's own
 * thread server-side, so read state stays per-person and nobody shares a
 * mailbox — see api/routes/hr/staffprofile.js.
 */
export default function StaffBroadcastPanel({
  staffMembers, notify,
}: {
  staffMembers: StaffMember[];
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [audiences, setAudiences] = useState<Audiences | null>(null);
  const [mode, setMode] = useState<Mode>('all');
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<{ label: string; recipients: number } | null>(null);

  // The default-seeding reads role/branchId through functional updates rather
  // than closing over them. Depending on them made `load` a new function every
  // time it seeded a default, which is why the effect below could not list it:
  // doing so would have re-fetched the audiences a second time on mount.
  const load = useCallback(() => {
    mysqlAdmin.getBroadcastAudiences()
      .then(data => {
        const next = data as unknown as Audiences;
        setAudiences(next);
        if (next.roles.length) setRole(current => current || next.roles[0].role);
        if (next.branches.length) setBranchId(current => current || next.branches[0].id);
      })
      .catch(error => notify('error', error instanceof Error ? error.message : 'تعذر تحميل قوائم الإرسال'));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const activeStaff = useMemo(
    () => staffMembers.filter(member => member.status !== 'inactive'),
    [staffMembers],
  );
  const searchable = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return activeStaff;
    return activeStaff.filter(member =>
      String(member.name || '').toLowerCase().includes(query)
      || String(member.email || '').toLowerCase().includes(query));
  }, [activeStaff, search]);

  const recipientCount = useMemo(() => {
    if (!audiences) return 0;
    if (mode === 'all') return audiences.total;
    if (mode === 'role') return audiences.roles.find(r => r.role === role)?.count || 0;
    if (mode === 'branch') return audiences.branches.find(b => b.id === branchId)?.count || 0;
    return picked.length;
  }, [audiences, mode, role, branchId, picked]);

  const send = async () => {
    const text = body.trim();
    if (!text) { notify('error', 'اكتب نص الرسالة'); return; }
    if (mode === 'staff' && picked.length === 0) { notify('error', 'اختر موظفًا واحدًا على الأقل'); return; }
    if (recipientCount === 0) { notify('error', 'لا يوجد مستلمون لهذا الاختيار'); return; }
    if (!window.confirm(`إرسال الرسالة إلى ${recipientCount} موظف؟`)) return;
    setSending(true);
    try {
      const payload: Record<string, unknown> = { target: mode, body: text };
      if (mode === 'role') payload.role = role;
      if (mode === 'branch') payload.branchId = branchId;
      if (mode === 'staff') payload.staffIds = picked;
      const result = await mysqlAdmin.sendStaffBroadcast(payload) as unknown as { label: string; recipients: number };
      setLastSent({ label: result.label, recipients: result.recipients });
      setBody('');
      setPicked([]);
      notify('success', `تم إرسال الرسالة إلى ${result.recipients} موظف (${result.label})`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إرسال الرسالة الجماعية');
    } finally { setSending(false); }
  };

  const MODES: { key: Mode; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { key: 'all', label: 'كل الفريق', icon: Users },
    { key: 'role', label: 'فريق بعينه', icon: Users },
    { key: 'branch', label: 'فرع', icon: Building2 },
    { key: 'staff', label: 'أفراد محددين', icon: UserRound },
  ];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" dir="rtl">
      <div className="mb-4">
        <h3 className="flex items-center gap-2 text-base font-bold text-gray-800">
          <Megaphone size={18} className="text-violet-600" /> رسالة جماعية للفريق
        </h3>
        <p className="mt-0.5 text-xs text-gray-400">
          تُرسل لكل مستلم في محادثته الخاصة، ويوصله إشعار. يقدر يرد عليك من صفحته.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {MODES.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setMode(key)}
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition ${
              mode === key ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
            }`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {mode === 'role' && (
        <select value={role} onChange={e => setRole(e.target.value)}
          className="mb-4 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm">
          {(audiences?.roles || []).map(r => (
            <option key={r.role} value={r.role}>{r.label} — {r.count} موظف</option>
          ))}
        </select>
      )}

      {mode === 'branch' && (
        <select value={branchId} onChange={e => setBranchId(e.target.value)}
          className="mb-4 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm">
          {(audiences?.branches || []).map(b => (
            <option key={b.id} value={b.id}>{b.label} — {b.count} موظف</option>
          ))}
        </select>
      )}

      {mode === 'staff' && (
        <div className="mb-4">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو البريد..."
            className="mb-2 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-2">
            {searchable.length === 0 ? (
              <p className="py-4 text-center text-xs text-gray-400">لا نتائج</p>
            ) : searchable.map(member => {
              const on = picked.includes(member.id);
              return (
                <button key={member.id}
                  onClick={() => setPicked(list => on ? list.filter(x => x !== member.id) : [...list, member.id])}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-right text-xs transition ${
                    on ? 'bg-violet-50 font-bold text-violet-800' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? 'border-violet-500 bg-violet-500 text-white' : 'border-gray-300'}`}>
                    {on && <Check size={11} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{member.name}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">{member.role}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <textarea value={body} onChange={e => setBody(e.target.value)}
        rows={3} placeholder="نص الرسالة الجماعية..."
        className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-200" />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">
          سيستلمها {fmtNum(recipientCount)} موظف
        </span>
        <button onClick={() => void send()} disabled={sending || !body.trim() || recipientCount === 0}
          className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
          <Send size={15} /> {sending ? 'جارٍ الإرسال...' : 'إرسال للجميع'}
        </button>
      </div>

      {lastSent && (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
          ✅ آخر إرسال: {lastSent.label} — {fmtNum(lastSent.recipients)} مستلم
        </p>
      )}
    </div>
  );
}
