import { useState } from 'react';
import { Eye, Search } from 'lucide-react';
import { cairoDateOnly, cairoDaysAgo } from '../../../../../shared/cairoDate';
import { BRANCHES, BRANCH_LABELS_AR } from '../../../../constants/branches';
import type { Bundle, Course, DaqqiRound, StaffMember } from '../../../../types';

// The date filter's quick ranges, in Cairo days; «مخصص» opens the two dates.
const DATE_PRESETS: [string, string, number][] = [
  ['today', 'النهارده', 0], ['yesterday', 'أمس', 1], ['7', 'آخر 7 أيام', 6], ['15', 'آخر 15 يوم', 14], ['30', 'آخر 30 يوم', 29],
];

type HousingInfo = { roundId: string; roundCode: string; receptionId: string; receptionName: string };

interface Props {
  isDaqqiClientsTab: boolean;
  collOnlineSearch: string;
  setCollOnlineSearch: (v: string) => void;
  setCollOnlinePage: (n: number) => void;
  daqqiHousingFilter: 'all'|'housed'|'unhoused';
  setDaqqiHousingFilter: (v: 'all'|'housed'|'unhoused') => void;
  daqqiRoundFilter: string;
  setDaqqiRoundFilter: (v: string) => void;
  salesOwnDaqqiRounds: DaqqiRound[];
  housingMap: Map<string, HousingInfo>;
  daqqiReceptionFilter: string;
  setDaqqiReceptionFilter: (v: string) => void;
  // عملائي spans every branch, so which one is a filter rather than a hidden
  // exclusion. Empty means all of them.
  clientBranchFilter: string;
  setClientBranchFilter: (value: string) => void;
  collOnlineStatusFilter: string;
  setCollOnlineStatusFilter: (v: string) => void;
  collOnlineRemainingFilter: 'all'|'has_remaining'|'paid';
  setCollOnlineRemainingFilter: (v: 'all'|'has_remaining'|'paid') => void;
  collOnlineCollectionFilter: string;
  setCollOnlineCollectionFilter: (v: string) => void;
  isOnlineManager: boolean;
  isAdmin: boolean;
  onlineTeamMembers: StaffMember[];
  staffMembers: StaffMember[];
  collOnlineCertFilter: 'all'|'has_cert'|'no_cert';
  setCollOnlineCertFilter: (v: 'all'|'has_cert'|'no_cert') => void;
  collOnlineCourseFilter: string;
  setCollOnlineCourseFilter: (v: string) => void;
  courses: Course[];
  bundles: Bundle[];
  collOnlineDateFrom: string;
  setCollOnlineDateFrom: (v: string) => void;
  collOnlineDateTo: string;
  setCollOnlineDateTo: (v: string) => void;
  vc: Record<string, boolean>;
  toggleCol: (col: string) => void;
}

export function FiltersToolbar({
  isDaqqiClientsTab, collOnlineSearch, setCollOnlineSearch, setCollOnlinePage,
  daqqiHousingFilter, setDaqqiHousingFilter, daqqiRoundFilter, setDaqqiRoundFilter,
  salesOwnDaqqiRounds, housingMap, daqqiReceptionFilter, setDaqqiReceptionFilter,
  clientBranchFilter, setClientBranchFilter,
  collOnlineStatusFilter, setCollOnlineStatusFilter, collOnlineRemainingFilter, setCollOnlineRemainingFilter,
  collOnlineCollectionFilter, setCollOnlineCollectionFilter, isOnlineManager, isAdmin,
  onlineTeamMembers, staffMembers, collOnlineCertFilter, setCollOnlineCertFilter,
  collOnlineCourseFilter, setCollOnlineCourseFilter, courses, bundles,
  collOnlineDateFrom, setCollOnlineDateFrom, collOnlineDateTo, setCollOnlineDateTo,
  vc, toggleCol,
}: Props) {
  const [datePreset, setDatePreset] = useState(collOnlineDateFrom || collOnlineDateTo ? 'custom' : '');
  const pickDate = (preset: string) => {
    setDatePreset(preset);
    setCollOnlinePage(1);
    const quick = DATE_PRESETS.find(([key]) => key === preset);
    if (quick) {
      const [, , back] = quick;
      setCollOnlineDateFrom(cairoDaysAgo(back));
      setCollOnlineDateTo(preset === 'yesterday' ? cairoDaysAgo(1) : cairoDateOnly());
    } else if (preset === '') {
      setCollOnlineDateFrom('');
      setCollOnlineDateTo('');
    }
  };
  return (
    <>
      {/* One line: the filters scroll sideways rather than wrapping into three. */}
      <div className="flex flex-nowrap gap-2 mb-3 items-center overflow-x-auto whitespace-nowrap pb-1 [&>*]:shrink-0">
        <div className="relative min-w-0 w-[140px]">
          <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={collOnlineSearch} onChange={e=>{setCollOnlineSearch(e.target.value);setCollOnlinePage(1);}}
            placeholder="بحث اسم / هاتف..."
            className="w-full border border-gray-200 rounded-lg pr-7 pl-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-teal-200" />
        </div>
        {isDaqqiClientsTab && (
          <>
            <select value={daqqiHousingFilter} onChange={e=>{setDaqqiHousingFilter(e.target.value as 'all'|'housed'|'unhoused');setCollOnlinePage(1);}}
              className="border border-indigo-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
              <option value="all">كل التسكين</option>
              <option value="housed">مسكنين ✅</option>
              <option value="unhoused">غير مسكنين ❌</option>
            </select>
            <select value={daqqiRoundFilter} onChange={e=>{setDaqqiRoundFilter(e.target.value);setCollOnlinePage(1);}}
              className="border border-indigo-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none max-w-[180px]">
              <option value="">كل الروندات</option>
              {(salesOwnDaqqiRounds ?? []).map((r: DaqqiRound) => (
                <option key={r.id} value={r.id}>{r.code} — {r.receptionName}</option>
              ))}
            </select>
            {/* فلتر رسيبشن الدقي */}
            {(() => {
              const uniqueReceptions = Array.from(
                new Map([...housingMap.values()].map(h => [h.receptionId, { id: h.receptionId, name: h.receptionName }])).values()
              );
              return uniqueReceptions.length > 0 ? (
                <select value={daqqiReceptionFilter} onChange={e=>{setDaqqiReceptionFilter(e.target.value);setCollOnlinePage(1);}}
                  className="border border-indigo-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none max-w-[160px]">
                  <option value="">كل الريسبشن</option>
                  {uniqueReceptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              ) : null;
            })()}
          </>
        )}
        {!isDaqqiClientsTab && (
          <select value={clientBranchFilter} onChange={e=>{setClientBranchFilter(e.target.value);setCollOnlinePage(1);}}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="الفرع">
            <option value="">كل الفروع</option>
            {BRANCHES.map(b => <option key={b} value={b}>{BRANCH_LABELS_AR[b]}</option>)}
          </select>
        )}
        <select value={collOnlineStatusFilter} onChange={e=>{setCollOnlineStatusFilter(e.target.value);setCollOnlinePage(1);}}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
          <option value="">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="paused">موقوف</option>
          <option value="finished">منتهي</option>
          <option value="refund_pending">استرداد قيد التنفيذ</option>
          <option value="refunded">مسترد</option>
        </select>
        <select value={collOnlineRemainingFilter} onChange={e=>{setCollOnlineRemainingFilter(e.target.value as 'all'|'has_remaining'|'paid');setCollOnlinePage(1);}}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
          <option value="all">كل المدفوعات</option>
          <option value="has_remaining">لديه متبقي</option>
          <option value="paid">مكتمل الدفع</option>
        </select>
        {/* فلتر مسئول التحصيل — للأونلاين فقط */}
        {!isDaqqiClientsTab && (
          <select value={collOnlineCollectionFilter} onChange={e=>{setCollOnlineCollectionFilter(e.target.value);setCollOnlinePage(1);}}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none max-w-[150px]">
            <option value="">كل مسئولي التحصيل</option>
            {(isOnlineManager ? onlineTeamMembers : isAdmin ? staffMembers : staffMembers).filter(s => (s.role||'').toLowerCase() === 'collection').map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        {/* فلتر الشهادات */}
        <select value={collOnlineCertFilter} onChange={e=>{setCollOnlineCertFilter(e.target.value as 'all'|'has_cert'|'no_cert');setCollOnlinePage(1);}}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none">
          <option value="all">كل الشهادات</option>
          <option value="has_cert">لديه شهادة</option>
          <option value="no_cert">بدون شهادة</option>
        </select>
        <select value={collOnlineCourseFilter} onChange={e=>{setCollOnlineCourseFilter(e.target.value);setCollOnlinePage(1);}}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none max-w-[160px]">
          <option value="">كل الكورسات</option>
          {courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
          {bundles.map(b=><option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📦 {b.title}</option>)}
        </select>
        <select value={datePreset} onChange={e => pickDate(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="تاريخ الاشتراك">
          <option value="">كل التواريخ</option>
          {DATE_PRESETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          <option value="custom">من — إلى</option>
        </select>
        {datePreset === 'custom' && (<>
          <input type="date" value={collOnlineDateFrom} onChange={e=>{setCollOnlineDateFrom(e.target.value);setCollOnlinePage(1);}}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="من تاريخ" />
          <input type="date" value={collOnlineDateTo} onChange={e=>{setCollOnlineDateTo(e.target.value);setCollOnlinePage(1);}}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="إلى تاريخ" />
        </>)}
        {(collOnlineSearch||clientBranchFilter||collOnlineStatusFilter||collOnlineRemainingFilter!=='all'||collOnlineCourseFilter||collOnlineDateFrom||collOnlineDateTo||collOnlineCollectionFilter||collOnlineCertFilter!=='all'||daqqiHousingFilter!=='all'||daqqiRoundFilter||daqqiReceptionFilter) && (
          <button onClick={()=>{setCollOnlineSearch('');setClientBranchFilter('');setCollOnlineStatusFilter('');setCollOnlineRemainingFilter('all');setCollOnlineCourseFilter('');setCollOnlineDateFrom('');setCollOnlineDateTo('');setDatePreset('');setCollOnlineCollectionFilter('');setCollOnlineCertFilter('all');setDaqqiHousingFilter('all');setDaqqiRoundFilter('');setDaqqiReceptionFilter('');setCollOnlinePage(1);}}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-gray-50 text-gray-500 hover:bg-gray-100">مسح الفلاتر</button>
        )}
        {/* Export lives in ⚙️ الإعدادات now, on both halves of the screen. */}
      </div>

      {/* Column visibility toggles */}
      <details className="mb-3 group">
        <summary className="cursor-pointer text-xs text-gray-500 flex items-center gap-1 select-none w-fit">
          <Eye size={12} />تحكم في الأعمدة <span className="text-gray-300 group-open:rotate-180 inline-block transition-transform">▼</span>
        </summary>
        <div className="flex flex-wrap gap-2 mt-2 pr-1">
          {([
            ['courses','الكورسات'],['value','القيمة'],['paid','المدفوع'],['remaining','المتبقي'],
            ['installments','الأقساط'],['status','الحالة'],['sales','المسئول'],['followup','موعد المتابعة'],
            ['contact','ملاحظات التواصل'],['createdAt','تاريخ الاشتراك'],['certificates','الشهادات'],
          ] as [string,string][]).map(([col,label]) => (
            <label key={col} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <input type="checkbox" checked={vc[col]!==false} onChange={()=>toggleCol(col)} className="accent-teal-500" />
              {label}
            </label>
          ))}
        </div>
      </details>
    </>
  );
}
