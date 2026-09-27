import React from 'react';
import { cairoDateOnly, cairoDay } from '../../../../../shared/cairoDate';
import { Download, Plus, Users } from 'lucide-react';
import type { Bundle, Course, StaffMember, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { errorMessage, paymentAmountInEGP } from '../onlineClientsUtils';
import { downloadCsv } from '../../../../../shared/csv';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type ViewTabKey = 'active'|'real-local'|'real-saudi'|'real-intl'|'finished'|'paused'|'refunded'|'old_data'|'old_local'|'old_intl'|'booked2024'|'booked2025';
type HousingInfo = { roundId: string; roundCode: string; receptionId: string; receptionName: string };
type Market = 'local' | 'saudi' | 'intl';

interface Props {
  isDaqqiClientsTab: boolean;
  allCombined: SubscriberItem[];
  isIntlSub: (s: SubscriberItem) => boolean;
  /** «محلي / سعودي / دولي» for an online client, null for a branch one. */
  marketOf: (s: SubscriberItem) => Market | null;
  bookedInYear: (s: SubscriberItem, year: number) => boolean;
  collOnlineViewTab: ViewTabKey;
  setCollOnlineViewTab: (v: ViewTabKey) => void;
  setCollOnlinePage: (n: number) => void;
  filtered: SubscriberItem[];
  isOnlineManager: boolean;
  isDaqqiManager: boolean;
  isAdmin: boolean;
  setOmNewSubOpen: (v: boolean) => void;
  /** «تابات القسم» — the staff-built tabs, which drew a gear of their own. */
  onOpenSectionTabs?: () => void;
  /** «إعدادات التحصيل» — who collects, how much, and their sheets. */
  onOpenCollectionSettings?: () => void;
  /** Where the staff-built tabs draw their buttons: here, beside the rest. */
  customTabsSlot?: (element: HTMLSpanElement | null) => void;
  /** A staff-built tab is open, so none of these is. */
  customTabOpen?: boolean;
  daqqiSettingsOpen: boolean;
  setDaqqiSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  collOnlineSelected: Set<string>;
  courses: Course[];
  bundles: Bundle[];
  staffMembers: StaffMember[];
  housingMap: Map<string, HousingInfo>;
  subCsDistributing: boolean;
  setSubCsDistributing: (v: boolean) => void;
  actionSubscribers: SubscriberItem[];
  reloadSubscribers: () => Promise<void>;
  notify: NotifyFn;
}

const MARKET_TAB: Partial<Record<ViewTabKey, Market>> = { 'real-local': 'local', 'real-saudi': 'saudi', 'real-intl': 'intl' };
const TERMINAL = ['finished', 'paused', 'refunded', 'refund_pending'];

export function ViewTabsBar({
  isDaqqiClientsTab, allCombined, isIntlSub, marketOf, bookedInYear, collOnlineViewTab, setCollOnlineViewTab,
  setCollOnlinePage, filtered, isOnlineManager, isDaqqiManager, isAdmin, setOmNewSubOpen, onOpenSectionTabs,
  onOpenCollectionSettings, customTabsSlot, customTabOpen = false,
  daqqiSettingsOpen, setDaqqiSettingsOpen, collOnlineSelected, courses, bundles, staffMembers, housingMap,
  subCsDistributing, setSubCsDistributing, actionSubscribers, reloadSubscribers, notify,
}: Props) {
  const courseTitles = (s: SubscriberItem) => (s.enrolledCourseIds || [])
    .map(id => courses.find(c => c.id === id)?.title || bundles.find(b => `bundle:${b.id}` === id)?.title || id).join(' | ');
  const toExport = () => (collOnlineSelected.size > 0 ? filtered.filter(s => collOnlineSelected.has(s.id)) : filtered);
  // One export, in the settings menu on both halves of the screen. The online
  // half had it among the filters and the Dokki half in its menu.
  const exportCsv = () => {
    const rows = toExport().map(s => {
      const paid = (s.paymentHistory || []).reduce((a, p) => a + paymentAmountInEGP(p), 0);
      const remaining = Math.max(0, (Number(s.totalValue) || 0) - paid);
      if (isDaqqiClientsTab) {
        const hInfo = housingMap.get(s.id);
        return [s.name, s.phone, s.email, s.branch || '', courseTitles(s), s.clientStatus || s.status || '', paid, remaining,
          hInfo?.roundCode || '', hInfo?.receptionName || '', cairoDay(s.createdAt), s.clientCode || ''];
      }
      const agent = staffMembers.find(st => st.id === s.assignedCsId)?.name || '';
      return [s.name, s.phone, s.email, s.branch || '', courseTitles(s), s.clientStatus || s.status || '', paid, remaining,
        agent, cairoDay(s.createdAt), s.clientCode || ''];
    });
    const header = isDaqqiClientsTab
      ? ['الاسم','الهاتف','الإيميل','الفرع','الكورسات','الحالة','المدفوع (ج.م)','المتبقي (ج.م)','الروند','الرسيبشن','تاريخ الاشتراك','الكود']
      : ['الاسم','الهاتف','الإيميل','الفرع','الكورسات','الحالة','المدفوع (ج.م)','المتبقي (ج.م)','مسئول التحصيل','تاريخ الاشتراك','الكود'];
    downloadCsv(`${isDaqqiClientsTab ? 'daqqi' : 'online'}-clients-${cairoDateOnly()}`, [header, ...rows]);
    setDaqqiSettingsOpen(false);
  };

  const menuItem = 'w-full text-right px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2';
  const unassignedCount = allCombined.filter(s => !s.assignedCsId).length;

  return (
    <div className="mb-3 border border-gray-200 rounded-2xl bg-gray-50 p-2">
      {/* One line: the tabs scroll sideways when they do not fit, and the
          buttons beside them stay put — so the settings menu is never clipped
          by the scrolling strip. */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5">
          {([
            { key: 'active'     as const, label: 'الكل',          color: 'blue'   },
            // What the client pays in: جنيه، ريال، دولار (onlineClientsUtils).
            { key: 'real-local' as const, label: '🇪🇬 محلي',       color: 'teal'   },
            { key: 'real-saudi' as const, label: '🇸🇦 سعودي',      color: 'emerald' },
            { key: 'real-intl'  as const, label: '🌍 دولي',        color: 'cyan'   },
            { key: 'finished'   as const, label: 'المنتهين',      color: 'green'  },
            { key: 'paused'     as const, label: 'المتوقفين',     color: 'amber'  },
            { key: 'refunded'   as const, label: 'المستردين',     color: 'red'    },
            ...(isDaqqiClientsTab ? [
              { key: 'booked2024' as const, label: 'عملاء 24',     color: 'purple' },
              { key: 'booked2025' as const, label: 'عملاء 25',     color: 'indigo' },
              { key: 'old_data'  as const, label: '📥 استيراد',    color: 'slate'  },
            ] : [
              { key: 'old_local' as const, label: '🏠 محلي قديم',  color: 'indigo' },
              { key: 'old_intl'  as const, label: '🌐 دولي قديم',  color: 'violet' },
            ]),
          ] as {key:ViewTabKey;label:string;color:string}[]).filter(vt => !isDaqqiClientsTab || !MARKET_TAB[vt.key]).map(vt => {
            const market = MARKET_TAB[vt.key];
            const base = vt.key === 'old_local' ? allCombined.filter(s => !isIntlSub(s)) : vt.key === 'old_intl' ? allCombined.filter(isIntlSub) : allCombined;
            const cnt = vt.key === 'active'
              ? allCombined.filter(s => !TERMINAL.includes(s.clientStatus||'')).length
              : market
              ? allCombined.filter(s => marketOf(s) === market && s.isActive !== false && !TERMINAL.includes(s.clientStatus||'') && (s.enrolledCourseIds||[]).length > 0).length
              : vt.key === 'booked2024' ? allCombined.filter(s => bookedInYear(s, 2024)).length
              : vt.key === 'booked2025' ? allCombined.filter(s => bookedInYear(s, 2025)).length
              : vt.key === 'old_data' ? allCombined.filter(s => ['old_data','daqqi_old_local','daqqi_old_intl'].includes(s.clientStatus||'')).length
              : (vt.key === 'old_local' || vt.key === 'old_intl') ? base.filter(s => s.clientStatus === vt.key).length
              : vt.key === 'refunded' ? allCombined.filter(s => s.clientStatus === 'refunded' || s.clientStatus === 'refund_pending').length
              : allCombined.filter(s => s.clientStatus === vt.key).length;
            const active = !customTabOpen && collOnlineViewTab === vt.key;
            const colorMap: Record<string,string> = {
              blue:    active ? 'bg-blue-600 text-white border-blue-600'       : 'border-blue-200 text-blue-700 hover:bg-blue-100',
              teal:    active ? 'bg-teal-600 text-white border-teal-600'       : 'border-teal-200 text-teal-700 hover:bg-teal-100',
              emerald: active ? 'bg-emerald-600 text-white border-emerald-600' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-100',
              cyan:    active ? 'bg-cyan-600 text-white border-cyan-600'       : 'border-cyan-200 text-cyan-700 hover:bg-cyan-100',
              green:   active ? 'bg-green-600 text-white border-green-600'     : 'border-green-200 text-green-700 hover:bg-green-100',
              amber:   active ? 'bg-amber-500 text-white border-amber-500'     : 'border-amber-200 text-amber-700 hover:bg-amber-100',
              red:     active ? 'bg-red-600 text-white border-red-600'         : 'border-red-200 text-red-700 hover:bg-red-100',
              purple:  active ? 'bg-purple-600 text-white border-purple-600'   : 'border-purple-200 text-purple-700 hover:bg-purple-100',
              slate:   active ? 'bg-slate-600 text-white border-slate-600'     : 'border-slate-200 text-slate-700 hover:bg-slate-100',
              indigo:  active ? 'bg-indigo-600 text-white border-indigo-600'   : 'border-indigo-200 text-indigo-700 hover:bg-indigo-100',
              violet:  active ? 'bg-violet-600 text-white border-violet-600'   : 'border-violet-200 text-violet-700 hover:bg-violet-100',
            };
            return (
              <button key={vt.key} onClick={() => { setCollOnlineViewTab(vt.key); setCollOnlinePage(1); }}
                className={`shrink-0 border rounded-xl px-3 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${colorMap[vt.color]}`}>
                {vt.label} <span className={`inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-extrabold ${active?'bg-white/30':'bg-gray-200 text-gray-600'}`}>{cnt}</span>
              </button>
            );
          })}
          {/* The staff-built tabs draw here, after the built-in ones — not in
              a strip of their own above the numbers. */}
          <span ref={customTabsSlot} className="contents" />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[10px] text-gray-400">{filtered.length} مطابق</span>
          {(isOnlineManager || isDaqqiManager || isAdmin) && (
            <button onClick={() => setOmNewSubOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition shadow-sm">
              <Plus size={12} /> مشترك جديد
            </button>
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
                  await reloadSubscribers();
                  notify('success', `✅ تم توزيع ${result.assigned} مشترك على ${result.staffCount} موظف`);
                } catch (e: unknown) {
                  notify('error', `❌ فشل التوزيع: ${errorMessage(e)}`);
                } finally { setSubCsDistributing(false); }
              }}
              className="relative flex items-center justify-center w-8 h-8 border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg transition disabled:opacity-60"
              title={`توزيع غير المُسندين (${unassignedCount})`}>
              {subCsDistributing ? <span className="w-3 h-3 border-2 border-teal-400 border-t-teal-700 rounded-full animate-spin"/> : <Users size={14}/>}
              {unassignedCount > 0 && !subCsDistributing && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 bg-teal-600 text-white text-[9px] font-extrabold rounded-full flex items-center justify-center px-0.5">{unassignedCount}</span>
              )}
            </button>
          )}
          <div className="relative">
            <button onClick={() => setDaqqiSettingsOpen(p => !p)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 bg-white hover:bg-gray-100 text-gray-700 rounded-xl text-xs font-bold transition">
              ⚙️ الإعدادات
            </button>
            {daqqiSettingsOpen && (
              <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 min-w-[220px] py-1">
                {onOpenSectionTabs && (
                  <button onClick={() => { onOpenSectionTabs(); setDaqqiSettingsOpen(false); }} className={menuItem}>
                    🗂️ تابات القسم
                  </button>
                )}
                {!isDaqqiClientsTab && onOpenCollectionSettings && (
                  <button onClick={() => { onOpenCollectionSettings(); setDaqqiSettingsOpen(false); }} className={menuItem}>
                    👥 التحصيل: التوزيع والشيتات
                  </button>
                )}
                <button onClick={exportCsv} className={menuItem}>
                  <Download size={14}/> {collOnlineSelected.size > 0 ? `تصدير المحدد (${collOnlineSelected.size})` : 'تصدير CSV'}
                </button>
                {isDaqqiClientsTab && (
                  <button onClick={() => { setCollOnlineViewTab('old_data'); setDaqqiSettingsOpen(false); }} className={menuItem}>
                    📂 استيراد داتا قديمة
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
