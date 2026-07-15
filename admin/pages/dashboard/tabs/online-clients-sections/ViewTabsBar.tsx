import React from 'react';
import { Download, Plus, Users } from 'lucide-react';
import type { Bundle, Course, StaffMember, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { errorMessage, paymentAmountInEGP } from '../onlineClientsUtils';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type ViewTabKey = 'active'|'real-local'|'real-intl'|'finished'|'paused'|'refunded'|'old_data'|'old_local'|'old_intl';
type HousingInfo = { roundId: string; roundCode: string; receptionId: string; receptionName: string };

interface Props {
  isDaqqiClientsTab: boolean;
  allCombined: SubscriberItem[];
  isIntlSub: (s: SubscriberItem) => boolean;
  collOnlineViewTab: ViewTabKey;
  setCollOnlineViewTab: (v: ViewTabKey) => void;
  setCollOnlinePage: (n: number) => void;
  filtered: SubscriberItem[];
  isOnlineManager: boolean;
  isDaqqiManager: boolean;
  isAdmin: boolean;
  setOmNewSubOpen: (v: boolean) => void;
  daqqiSettingsOpen: boolean;
  setDaqqiSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  collOnlineSelected: Set<string>;
  courses: Course[];
  bundles: Bundle[];
  housingMap: Map<string, HousingInfo>;
  subCsDistributing: boolean;
  setSubCsDistributing: (v: boolean) => void;
  actionSubscribers: SubscriberItem[];
  updateSubscriber: (s: SubscriberItem) => void;
  notify: NotifyFn;
}

export function ViewTabsBar({
  isDaqqiClientsTab, allCombined, isIntlSub, collOnlineViewTab, setCollOnlineViewTab,
  setCollOnlinePage, filtered, isOnlineManager, isDaqqiManager, isAdmin, setOmNewSubOpen,
  daqqiSettingsOpen, setDaqqiSettingsOpen, collOnlineSelected, courses, bundles, housingMap,
  subCsDistributing, setSubCsDistributing, actionSubscribers, updateSubscriber, notify,
}: Props) {
  return (
    <div className="mb-3 border border-gray-200 rounded-2xl bg-gray-50 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          { key: 'active'          as const, label: 'الكل',               color: 'blue'   },
          { key: 'real-local'       as const, label: '🇪🇬 فعلي محلي',       color: 'teal'   },
          { key: 'real-intl'        as const, label: '🌍 فعلي دولي',        color: 'cyan'   },
          { key: 'finished'         as const, label: 'المنتهين',           color: 'green'  },
          { key: 'paused'           as const, label: 'المتوقفين',          color: 'amber'  },
          { key: 'refunded'         as const, label: 'المستردين',          color: 'red'    },
          ...(isDaqqiClientsTab ? [
            { key: 'old_data'  as const, label: '📥 استيراد',      color: 'slate'  },
          ] : [
            { key: 'old_local' as const, label: '🏠 محلي قديم',   color: 'indigo' },
            { key: 'old_intl'  as const, label: '🌐 دولي قديم',   color: 'violet' },
          ]),
        ] as {key:ViewTabKey;label:string;color:string}[]).filter(vt => !isDaqqiClientsTab || (vt.key !== 'real-local' && vt.key !== 'real-intl')).map(vt => {
          const base = vt.key === 'real-local' ? allCombined.filter(s => !isIntlSub(s)) : vt.key === 'real-intl' ? allCombined.filter(isIntlSub) : vt.key === 'old_local' ? allCombined.filter(s => !isIntlSub(s)) : vt.key === 'old_intl' ? allCombined.filter(isIntlSub) : allCombined;
          const cnt = vt.key === 'active'
            ? allCombined.filter(s => !['finished','paused','refunded','refund_pending'].includes(s.clientStatus||'')).length
            : (vt.key === 'real-local' || vt.key === 'real-intl')
            ? base.filter(s => !['finished','paused','refunded','refund_pending'].includes(s.clientStatus||'') && (s.enrolledCourseIds||[]).length > 0).length
            : vt.key === 'old_data' ? allCombined.filter(s => ['old_data','daqqi_old_local','daqqi_old_intl'].includes(s.clientStatus||'')).length
            : (vt.key === 'old_local' || vt.key === 'old_intl') ? base.filter(s => s.clientStatus === vt.key).length
            : vt.key === 'refunded' ? allCombined.filter(s => s.clientStatus === 'refunded' || s.clientStatus === 'refund_pending').length
            : allCombined.filter(s => s.clientStatus === vt.key).length;
          const active = collOnlineViewTab === vt.key;
          const colorMap: Record<string,string> = {
            blue:   active ? 'bg-blue-600 text-white border-blue-600'    : 'border-blue-200 text-blue-700 hover:bg-blue-100',
            teal:   active ? 'bg-teal-600 text-white border-teal-600'    : 'border-teal-200 text-teal-700 hover:bg-teal-100',
            cyan:   active ? 'bg-cyan-600 text-white border-cyan-600'    : 'border-cyan-200 text-cyan-700 hover:bg-cyan-100',
            green:  active ? 'bg-green-600 text-white border-green-600'  : 'border-green-200 text-green-700 hover:bg-green-100',
            amber:  active ? 'bg-amber-500 text-white border-amber-500'  : 'border-amber-200 text-amber-700 hover:bg-amber-100',
            red:    active ? 'bg-red-600 text-white border-red-600'      : 'border-red-200 text-red-700 hover:bg-red-100',
            purple: active ? 'bg-purple-600 text-white border-purple-600': 'border-purple-200 text-purple-700 hover:bg-purple-100',
            slate:  active ? 'bg-slate-600 text-white border-slate-600'  : 'border-slate-200 text-slate-700 hover:bg-slate-100',
            indigo: active ? 'bg-indigo-600 text-white border-indigo-600': 'border-indigo-200 text-indigo-700 hover:bg-indigo-100',
            violet: active ? 'bg-violet-600 text-white border-violet-600': 'border-violet-200 text-violet-700 hover:bg-violet-100',
          };
          return (
            <button key={vt.key} onClick={() => { setCollOnlineViewTab(vt.key); setCollOnlinePage(1); }}
              className={`border rounded-xl px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${colorMap[vt.color]}`}>
            {vt.label} <span className={`inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] rounded-full text-[10px] font-extrabold ${active?'bg-white/30':'bg-gray-200 text-gray-600'}`}>{cnt}</span>
            </button>
          );
        })}
        <span className="flex-1"/>
        <span className="text-[10px] text-gray-400">{filtered.length} مطابق</span>
        {(isOnlineManager || isDaqqiManager || isAdmin) && (
          <button onClick={() => setOmNewSubOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition shadow-sm">
            <Plus size={12} /> مشترك جديد
          </button>
        )}
        {isDaqqiClientsTab && (
          <div className="relative">
            <button onClick={() => setDaqqiSettingsOpen(p => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold transition">
              ⚙️ الإعدادات
            </button>
            {daqqiSettingsOpen && (
              <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 min-w-[160px] py-1">
                <button onClick={() => {
                  const toExport = collOnlineSelected.size > 0 ? filtered.filter(s => collOnlineSelected.has(s.id)) : filtered;
                  const header = 'الاسم,الهاتف,الإيميل,الفرع,الكورسات,الحالة,المدفوع (ج.م),المتبقي (ج.م),الروند,الرسيبشن,تاريخ الاشتراك,الكود\n';
                  const rows = toExport.map(s => {
                    const paid = (s.paymentHistory||[]).reduce((a,p)=>a+paymentAmountInEGP(p),0);
                    const total = Number(s.totalValue)||0;
                    const crs = (s.enrolledCourseIds||[]).map(id=>courses.find(c=>c.id===id)?.title||bundles.find(b=>`bundle:${b.id}`===id)?.title||id).join(' | ');
                    const hInfo = housingMap.get(s.id);
                    return [s.name,s.phone,s.email,s.branch||'',crs,s.clientStatus||s.status||'',paid,Math.max(0,total-paid),hInfo?.roundCode||'',hInfo?.receptionName||'',(s.createdAt||'').slice(0,10),s.clientCode||''].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(',');
                  }).join('\n');
                  const blob = new Blob(['﻿'+header+rows],{type:'text/csv;charset=utf-8;'});
                  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`daqqi-clients-${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(a.href);
                  setDaqqiSettingsOpen(false);
                }} className="w-full text-right px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <Download size={12}/> تصدير CSV
                </button>
                <button onClick={() => { setCollOnlineViewTab('old_data'); setDaqqiSettingsOpen(false); }}
                  className="w-full text-right px-4 py-2 text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  📂 استيراد داتا قديمة
                </button>
              </div>
            )}
          </div>
        )}
        {(!isDaqqiClientsTab && (isOnlineManager || isAdmin)) && (
          <button
            disabled={subCsDistributing}
            onClick={async () => {
              const unassigned = actionSubscribers.filter(s => !s.assignedCsId);
              if (!confirm(`توزيع ${unassigned.length} مشترك غير مُسند على موظفي التحصيل؟`)) return;
              setSubCsDistributing(true);
              try {
                const result = await mysqlAdmin.bulkAssignCollection();
                notify('success', `✅ تم توزيع ${result.assigned} مشترك على ${result.staffCount} موظف`);
                const fresh = (await mysqlAdmin.listAllSubscribers()) as unknown as SubscriberItem[];
                fresh.forEach(s => updateSubscriber(s));
              } catch (e: unknown) {
                notify('error', `❌ فشل التوزيع: ${errorMessage(e)}`);
              } finally { setSubCsDistributing(false); }
            }}
            className="relative flex items-center justify-center w-7 h-7 border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg transition disabled:opacity-60"
            title={`توزيع غير المُسندين (${allCombined.filter(s => !s.assignedCsId).length})`}>
            {subCsDistributing ? <span className="w-3 h-3 border-2 border-teal-400 border-t-teal-700 rounded-full animate-spin"/> : <Users size={13}/>}
            {allCombined.filter(s => !s.assignedCsId).length > 0 && !subCsDistributing && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 bg-teal-600 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center px-0.5">{allCombined.filter(s => !s.assignedCsId).length}</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
