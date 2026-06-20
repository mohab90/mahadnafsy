/**
 * BranchWorkspaceHub — gives every institute branch its own workspace: pick a
 * branch, then work inside branch-scoped tabs (clients, accounting). Branches are
 * read from the settings-managed list (content['institute.branches'] via
 * useBranches), so adding a branch in Settings instantly creates its workspace.
 * Existing tabs are reused with their branch filters pinned to the selected branch.
 */
import React, { Suspense, useState } from 'react';
import { Building2, Users, CreditCard, Settings2 } from 'lucide-react';
import { useBranches } from '../../hooks/useBranches';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const ClientDbTab = React.lazy(() => import('./tabs/ClientDbTab'));
const FinancialTab = React.lazy(() => import('./tabs/FinancialTab'));

const SUB_TABS = [
  { key: 'clients',    label: 'العملاء',  icon: Users },
  { key: 'accounting', label: 'الحسابات', icon: CreditCard },
] as const;
type SubKey = typeof SUB_TABS[number]['key'];

const Spinner = () => (
  <div className="flex items-center justify-center py-20">
    <span className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

export default function BranchWorkspaceHub({ notify, onNavigateTab }: { notify: NotifyFn; onNavigateTab?: (tab: string) => void }) {
  const branches = useBranches();
  const [branchId, setBranchId] = useState<string>(() => branches[0]?.id || '');
  const [sub, setSub] = useState<SubKey>('clients');

  if (branches.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center max-w-lg mx-auto" dir="rtl">
        <div className="w-12 h-12 rounded-2xl bg-brand-50 grid place-items-center mx-auto mb-3"><Building2 className="text-brand-600" /></div>
        <h3 className="font-extrabold text-gray-800">لا توجد فروع بعد</h3>
        <p className="text-sm text-gray-500 mt-1">أضف فروع مؤسستك من <b>الإعدادات ← الفروع</b> لتظهر لكل فرع مساحة عمل خاصة.</p>
        <button onClick={() => onNavigateTab?.('system_settings')}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-brand-fg rounded-xl text-sm font-bold">
          <Settings2 size={15} /> فتح الإعدادات
        </button>
      </div>
    );
  }

  const active = branches.find(b => b.id === branchId) || branches[0];
  const branchUpper = (active?.id || '').toUpperCase();

  return (
    <div className="space-y-4" dir="rtl">
      {/* Branch selector */}
      <div className="bg-white border border-gray-200 rounded-2xl p-3">
        <div className="flex items-center gap-2 mb-2 text-gray-500 text-xs font-bold"><Building2 size={14} /> اختر الفرع</div>
        <div className="flex flex-wrap gap-2">
          {branches.map(b => (
            <button key={b.id} onClick={() => setBranchId(b.id)}
              aria-pressed={b.id === active?.id}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition ${b.id === active?.id ? 'bg-brand-600 text-brand-fg shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setSub(t.key)}
              aria-current={sub === t.key ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${sub === t.key ? 'bg-brand-600 text-brand-fg shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
        <span className="mr-auto self-center text-xs text-gray-400">الفرع الحالي: <b className="text-gray-700">{active?.label}</b></span>
      </div>

      {/* Branch-scoped content — keyed by branch so each switch remounts cleanly */}
      <Suspense fallback={<Spinner />}>
        {sub === 'clients' && <ClientDbTab key={`cl-${branchUpper}`} notify={notify} lockedBranch={branchUpper} />}
        {sub === 'accounting' && <FinancialTab key={`fin-${branchUpper}`} notify={notify} branchFilter={branchUpper} onNavigateTab={onNavigateTab} />}
      </Suspense>
    </div>
  );
}
