import React from 'react';
import { ExternalLink, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSiteData } from '../../context/SiteDataContext';
import { type LeadItem, type SubscriberItem } from '../../types';
import { blankPaymentDraft, type PaymentDraft } from '../../components/PaymentModal';
import { normBranchId } from './dashboardShared';

interface Props {
  quickBookOpen: boolean;
  setQuickBookOpen: (open: boolean) => void;
  quickBookSearch: string;
  setQuickBookSearch: (s: string) => void;
  setLeadPayRow: (row: LeadItem | null) => void;
  setLeadPayDraft: (draft: PaymentDraft | ((prev: PaymentDraft) => PaymentDraft)) => void;
  setSubPayRow: (row: SubscriberItem | null) => void;
  setSubPayDraft: (draft: PaymentDraft | ((prev: PaymentDraft) => PaymentDraft)) => void;
}

export default function QuickBookModal({
  quickBookOpen,
  setQuickBookOpen,
  quickBookSearch,
  setQuickBookSearch,
  setLeadPayRow,
  setLeadPayDraft,
  setSubPayRow,
  setSubPayDraft,
}: Props) {
  const { leads, subscribers } = useSiteData();
  const navigate = useNavigate();

  return (
    <>
      {!quickBookOpen && (
        <button
          onClick={() => { setQuickBookOpen(true); setQuickBookSearch(''); }}
          className="fixed bottom-6 left-6 z-40 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl shadow-2xl px-4 py-3 font-bold text-sm transition hover:scale-105 active:scale-95"
          title="حجز جديد / تسجيل دفعة">
          <Search size={18} />
          <span>حجز / دفعة</span>
        </button>
      )}

      {quickBookOpen && (() => {
        const q = quickBookSearch.trim().toLowerCase();
        const matchedLeads: LeadItem[] = q.length < 2 ? [] : leads
          .filter(l => !['converted', 'lost'].includes(l.status))
          .filter(l =>
            l.name.toLowerCase().includes(q) ||
            (l.phone || '').includes(q) ||
            (l.email || '').toLowerCase().includes(q)
          )
          .slice(0, 8);
        const matchedSubs: SubscriberItem[] = q.length < 2 ? [] : subscribers
          .filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.phone || '').replace(/\D/g,'').includes(q.replace(/\D/g,'')) ||
            (s.email || '').toLowerCase().includes(q)
          )
          .slice(0, 8);
        const hasResults = matchedLeads.length > 0 || matchedSubs.length > 0;
        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => setQuickBookOpen(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl" dir="rtl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <Search size={20} className="text-emerald-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-extrabold text-gray-900 text-lg">البحث داخل قاعدة العملاء</h3>
                  <p className="text-xs text-gray-400 mt-0.5">ابحث بالاسم أو رقم الهاتف أو الإيميل لحجز أو تسجيل دفعة</p>
                </div>
                <button onClick={() => setQuickBookOpen(false)} className="text-gray-400 hover:text-gray-700 rounded-lg p-1.5"><X size={20} /></button>
              </div>
              <div className="px-6 pt-5 pb-3">
                <div className="relative">
                  <Search size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-emerald-500" />
                  <input
                    autoFocus
                    type="text"
                    placeholder="اسم العميل / رقم الهاتف / الإيميل..."
                    value={quickBookSearch}
                    onChange={e => setQuickBookSearch(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-10 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300"
                  />
                </div>
              </div>
              <div className="px-4 pb-5 space-y-1 max-h-96 overflow-y-auto">
                {q.length < 2 && (
                  <p className="text-center text-xs text-gray-400 py-6">اكتب 2 حرف أو أكثر للبحث</p>
                )}
                {q.length >= 2 && !hasResults && (
                  <p className="text-center text-xs text-gray-400 py-6">لا توجد نتائج</p>
                )}
                {matchedLeads.length > 0 && (
                  <>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-2 pt-2">عملاء CRM (ليدز)</p>
                    {matchedLeads.map(lead => (
                      <div key={lead.id} className="flex items-center gap-2 rounded-xl hover:bg-amber-50 transition px-1">
                        <button
                          onClick={() => {
                            setQuickBookOpen(false);
                            setLeadPayRow(lead);
                            setLeadPayDraft(blankPaymentDraft({
                              courseId: lead.interestedCourseIds?.[0] || lead.enrolledCourseId || '',
                              currency: (['ONLINE_SAUDI', 'ONLINE_ABROAD'].includes((lead.branch || '').toUpperCase().replace(/[-\s]/g,'_'))) ? 'SAR' : 'EGP',
                              branch: lead.branch || '',
                              email: lead.email || '',
                            }));
                          }}
                          className="flex-1 flex items-center gap-3 px-3 py-2.5 text-right">
                          <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-sm flex-shrink-0">{lead.name.charAt(0)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-800 text-sm truncate">{lead.name}</p>
                            <p className="text-xs text-gray-400 truncate">{lead.phone}{lead.email ? ' · ' + lead.email : ''}</p>
                          </div>
                          <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">ليد</span>
                        </button>
                        <button
                          onClick={() => { setQuickBookOpen(false); navigate(`/client/${lead.clientCode || lead.id}`); }}
                          title="فتح صفحة العميل المحتمل"
                          className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-amber-700 hover:bg-amber-100">
                          <ExternalLink size={15} />
                        </button>
                      </div>
                    ))}
                  </>
                )}
                {matchedSubs.length > 0 && (
                  <>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-2 pt-2">عملاء الأونلاين</p>
                    {matchedSubs.map(sub => (
                      <div key={sub.id} className="flex items-center gap-2 rounded-xl hover:bg-blue-50 transition px-1">
                        <button
                          onClick={() => {
                            setQuickBookOpen(false);
                            setSubPayRow(sub);
                            setSubPayDraft(blankPaymentDraft({
                              currency: normBranchId(sub.branch) === 'ONLINE_ABROAD' ? 'SAR' : 'EGP',
                              courseId: sub.enrolledCourseIds?.[0] || '',
                            }));
                            setSubPayDraft(prev => ({ ...prev, bookingType: (sub.enrolledCourseIds||[]).length > 0 ? 'installment' : 'new_booking' }));
                          }}
                          className="flex-1 flex items-center gap-3 px-3 py-2.5 text-right">
                          <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm flex-shrink-0">{sub.name.charAt(0)}</div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-800 text-sm truncate">{sub.name}</p>
                            <p className="text-xs text-gray-400 truncate">{sub.phone}{sub.email ? ' · ' + sub.email : ''}</p>
                          </div>
                          <span className="text-[10px] bg-blue-100 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full font-bold flex-shrink-0">مشترك</span>
                        </button>
                        <button
                          onClick={() => { setQuickBookOpen(false); navigate(`/client/${sub.clientCode || sub.id}`); }}
                          title="فتح صفحة العميل"
                          className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-primary-700 hover:bg-primary-50">
                          <ExternalLink size={15} />
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
