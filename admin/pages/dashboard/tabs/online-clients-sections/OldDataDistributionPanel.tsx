import React from 'react';
import { Plus } from 'lucide-react';
import type { StaffMember, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type DistribPlanEntry = { staffId: string; count: string };

interface Props {
  isDaqqiClientsTab: boolean;
  isAdmin: boolean;
  isDaqqiManager: boolean;
  filtered: SubscriberItem[];
  daqqiOldDistribPlan: DistribPlanEntry[];
  setDaqqiOldDistribPlan: React.Dispatch<React.SetStateAction<DistribPlanEntry[]>>;
  daqqiOldDistributing: boolean;
  setDaqqiOldDistributing: (v: boolean) => void;
  staffMembers: StaffMember[];
  subscribers: SubscriberItem[];
  salesOwnSubscribers: SubscriberItem[];
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  notify: NotifyFn;
}

export function OldDataDistributionPanel({
  isDaqqiClientsTab, isAdmin, isDaqqiManager, filtered, daqqiOldDistribPlan, setDaqqiOldDistribPlan,
  daqqiOldDistributing, setDaqqiOldDistributing, staffMembers, subscribers, salesOwnSubscribers,
  setSalesOwnSubscribers, notify,
}: Props) {
  if (!(isAdmin || isDaqqiManager)) return null;

  return (
    <div className="mb-4 bg-gradient-to-l from-indigo-50 to-violet-50 border border-indigo-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base">📊</span>
        <h4 className="font-extrabold text-indigo-800 text-sm">{isDaqqiClientsTab ? 'توزيع العملاء على فريق الدقي' : 'توزيع العملاء على مسئولي التحصيل'}</h4>
        <span className="text-xs text-indigo-500">({filtered.filter(s => !s.assignedCsId).length} غير موزع من أصل {filtered.length})</span>
      </div>
      <div className="space-y-2">
        {daqqiOldDistribPlan.map((entry, idx) => {
          const csMembers = isDaqqiClientsTab
              ? staffMembers.filter(s => s.role === 'daqqi_manager' || s.role === 'reception_daqqi')
              : staffMembers.filter(s => (s.role||'').toLowerCase() === 'collection');
          return (
            <div key={idx} className="flex items-center gap-2 flex-wrap">
              <select value={entry.staffId} onChange={e => setDaqqiOldDistribPlan(prev => prev.map((p,i) => i===idx ? {...p,staffId:e.target.value} : p))}
                className="border border-indigo-200 rounded-xl px-3 py-1.5 text-xs bg-white focus:ring-2 focus:ring-indigo-200 focus:outline-none min-w-[160px]">
                <option value="">{isDaqqiClientsTab ? '— اختر من فريق الدقي —' : '— اختر مسئول تحصيل —'}</option>
                {csMembers.map(s => <option key={s.id} value={s.id}>{s.name} ({(salesOwnSubscribers.length>0?salesOwnSubscribers:subscribers).filter(sub=>sub.assignedCsId===s.id).length} موزع)</option>)}
              </select>
              <input type="number" min="1" max={filtered.filter(s=>!s.assignedCsId).length} placeholder="عدد العملاء"
                value={entry.count} onChange={e => setDaqqiOldDistribPlan(prev => prev.map((p,i) => i===idx ? {...p,count:e.target.value} : p))}
                className="border border-indigo-200 rounded-xl px-3 py-1.5 text-xs w-28 focus:ring-2 focus:ring-indigo-200 focus:outline-none" />
              {daqqiOldDistribPlan.length > 1 && (
                <button onClick={() => setDaqqiOldDistribPlan(prev => prev.filter((_,i) => i!==idx))}
                  className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 text-sm">✕</button>
              )}
            </div>
          );
        })}
        <div className="flex items-center gap-2 pt-1">
          <button onClick={() => setDaqqiOldDistribPlan(prev => [...prev, {staffId:'',count:''}])}
            className="flex items-center gap-1 text-xs font-bold text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl transition">
            <Plus size={11}/> إضافة مسئول
          </button>
          <button disabled={daqqiOldDistributing || daqqiOldDistribPlan.every(e=>!e.staffId||!e.count)}
            onClick={async () => {
              const unassigned = filtered.filter(s => !s.assignedCsId);
              let offset = 0; let totalDone = 0;
              setDaqqiOldDistributing(true);
              try {
                for (const entry of daqqiOldDistribPlan) {
                  if (!entry.staffId || !entry.count) continue;
                  const n = Math.min(Number(entry.count)||0, unassigned.length - offset);
                  if (n <= 0) continue;
                  const batch = unassigned.slice(offset, offset + n);
                  offset += n;
                  const staffMember = staffMembers.find(s => s.id === entry.staffId);
                  for (const sub of batch) {
                    try {
                      await mysqlAdmin.saveSubscriber({ ...sub, assignedCsId: entry.staffId, assignedCsName: staffMember?.name || '' } as any);
                      setSalesOwnSubscribers(prev => prev.map(s => s.id === sub.id ? {...s, assignedCsId: entry.staffId, assignedCsName: staffMember?.name||''} as any : s));
                      totalDone++;
                    } catch {}
                  }
                }
                notify('success', `✅ تم توزيع ${totalDone} عميل على ${isDaqqiClientsTab ? 'فريق الدقي' : 'مسئولي التحصيل'}`);
                setDaqqiOldDistribPlan([{staffId:'',count:''}]);
              } finally { setDaqqiOldDistributing(false); }
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 transition">
            {daqqiOldDistributing ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"/> جاري...</> : '🚀 توزيع'}
          </button>
        </div>
      </div>
    </div>
  );
}
