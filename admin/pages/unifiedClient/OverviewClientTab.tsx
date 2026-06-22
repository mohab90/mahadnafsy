import React from 'react';
import { Clock, BookOpen, CreditCard, MessageSquare, Activity, CheckCircle, Info } from 'lucide-react';
import { Course, SubscriberItem, LeadItem, CommunicationRecord, ConsultationItem, InstallmentPlan, PaymentHistoryEntry, PaymentRecord, SubscriberCertificate } from '../../types';

type Booking = { paidEGP: number; expectedEGP?: number; discount?: number };
type CommMeta = { icon: React.ReactNode; color: string; label: string };

interface Props {
  isSub: boolean;
  subscriber?: SubscriberItem;
  lead?: LeadItem;
  allComms: (CommunicationRecord & { _src?: string })[];
  getCourseLectures: (courseId: string) => unknown[];
  subInstallmentPlans: InstallmentPlan[];
  todayStr: string;
  leadPayments: PaymentRecord[];
  courses: Course[];
  bundles: { id: string; title: string }[];
  leadPaidEGP: number;
  leadRemaining: number;
  bookingMap: Record<string, Booking>;
  subCerts: SubscriberCertificate[];
  enrolledCourse?: Course | null;
  subConsults: ConsultationItem[];
  subHistory: PaymentHistoryEntry[];
  commTypeMeta: Record<string, CommMeta>;
  setActiveTab: (tab: 'communications') => void;
}

/** Read-only client overview (pulse, lead banner, courses, comms, timeline).
 *  Extracted from UnifiedClientPage. */
export default function OverviewClientTab(p: Props) {
  const {
    isSub, subscriber, lead, allComms, getCourseLectures, subInstallmentPlans, todayStr,
    leadPayments, courses, bundles, leadPaidEGP, leadRemaining, bookingMap, subCerts,
    enrolledCourse, subConsults, subHistory, commTypeMeta, setActiveTab,
  } = p;
  return (
    <div className="space-y-5">
      {/* ─── Client Pulse ─── */}
      {(() => {
        const regDate = isSub ? subscriber!.createdAt : lead?.createdAt;
        const daysSinceReg = regDate ? Math.floor((Date.now() - new Date(regDate).getTime()) / 86400000) : null;
        const lastCommDate = allComms[0]?.date;
        const daysSinceComm = lastCommDate ? Math.floor((Date.now() - new Date(lastCommDate).getTime()) / 86400000) : null;
        const totalLec = isSub ? subscriber!.enrolledCourseIds.reduce((acc, cId) => acc + getCourseLectures(cId).length, 0) : 0;
        const doneLec = isSub ? Object.values(subscriber!.lectureProgress || {}).filter(v => (v as number) > 0).length : 0;
        const pulsePct = totalLec > 0 ? Math.round((doneLec / totalLec) * 100) : null;
        const overdueAmt = isSub ? subInstallmentPlans.flatMap(pl => pl.entries.filter(e => !e.paidAt && e.dueDate < todayStr)).reduce((s, e) => s + e.amount, 0) : 0;
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-slate-50 rounded-2xl p-4 text-center border border-slate-200">
              <p className="font-extrabold text-slate-700 text-2xl leading-none">{daysSinceReg ?? '—'}</p>
              <p className="text-[11px] text-slate-400 mt-1 font-semibold">يوم منذ التسجيل</p>
            </div>
            <div className={`rounded-2xl p-4 text-center border ${
              daysSinceComm === null ? 'bg-amber-50 border-amber-200' :
              daysSinceComm > 30 ? 'bg-red-50 border-red-200' :
              daysSinceComm > 7 ? 'bg-amber-50 border-amber-200' :
              'bg-emerald-50 border-emerald-200'
            }`}>
              <p className={`font-extrabold text-2xl leading-none ${
                daysSinceComm === null ? 'text-amber-600' :
                daysSinceComm > 30 ? 'text-red-600' :
                daysSinceComm > 7 ? 'text-amber-600' : 'text-emerald-600'
              }`}>{daysSinceComm ?? '—'}</p>
              <p className={`text-[11px] mt-1 font-semibold ${
                daysSinceComm === null ? 'text-amber-500' :
                daysSinceComm > 30 ? 'text-red-400' :
                daysSinceComm > 7 ? 'text-amber-500' : 'text-emerald-500'
              }`}>{daysSinceComm === null ? 'لا تواصل بعد' : 'يوم منذ تواصل'}</p>
            </div>
            {isSub ? (
              <div className={`rounded-2xl p-4 text-center border ${
                pulsePct === null ? 'bg-gray-50 border-gray-200' :
                pulsePct === 100 ? 'bg-emerald-50 border-emerald-200' :
                pulsePct >= 50 ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'
              }`}>
                <p className={`font-extrabold text-2xl leading-none ${
                  pulsePct === null ? 'text-gray-400' :
                  pulsePct === 100 ? 'text-emerald-600' :
                  pulsePct >= 50 ? 'text-amber-600' : 'text-blue-600'
                }`}>{pulsePct !== null ? `${pulsePct}%` : '—'}</p>
                <p className="text-[11px] text-gray-400 mt-1 font-semibold">إتمام المحاضرات</p>
              </div>
            ) : (
              <div className={`rounded-2xl p-4 text-center border ${
                lead?.interestLevel === 'high' ? 'bg-green-50 border-green-200' :
                lead?.interestLevel === 'medium' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'
              }`}>
                <p className={`font-extrabold text-2xl leading-none ${
                  lead?.interestLevel === 'high' ? 'text-green-600' :
                  lead?.interestLevel === 'medium' ? 'text-amber-600' : 'text-gray-400'
                }`}>{lead?.interestLevel === 'high' ? '🔥' : lead?.interestLevel === 'medium' ? '〽️' : lead?.interestLevel ? '▽' : '—'}</p>
                <p className="text-[11px] text-gray-400 mt-1 font-semibold">{lead?.interestLevel === 'high' ? 'اهتمام مرتفع' : lead?.interestLevel === 'medium' ? 'اهتمام متوسط' : 'مستوى الاهتمام'}</p>
              </div>
            )}
            {isSub ? (
              <div className={`rounded-2xl p-4 text-center border ${overdueAmt > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <p className={`font-extrabold leading-none ${overdueAmt > 0 ? 'text-red-600 text-lg' : 'text-emerald-600 text-2xl'}`}>
                  {overdueAmt > 0 ? overdueAmt.toLocaleString() : '✓'}
                </p>
                <p className={`text-[11px] mt-1 font-semibold ${overdueAmt > 0 ? 'text-red-400' : 'text-emerald-500'}`}>
                  {overdueAmt > 0 ? 'ج.م متأخر' : 'لا متأخرات'}
                </p>
              </div>
            ) : (
              <div className="bg-blue-50 rounded-2xl p-4 text-center border border-blue-200">
                <p className="font-extrabold text-blue-700 text-2xl leading-none">{leadPayments.length}</p>
                <p className="text-[11px] text-blue-400 mt-1 font-semibold">دفعة مسجّلة</p>
              </div>
            )}
          </div>
        );
      })()}

      {/* ─── Lead Status + Follow-up Banner (leads only) ─── */}
      {!isSub && lead && (
        <div className="rounded-2xl border overflow-hidden shadow-sm">
          <div className={`px-4 py-3 flex items-center justify-between flex-wrap gap-2 ${
            lead.status === 'converted' ? 'bg-emerald-600' :
            lead.status === 'lost' || lead.status === 'not_interested' ? 'bg-red-500' :
            lead.status === 'interested' || lead.status === 'interested_followup' ? 'bg-blue-600' :
            'bg-slate-600'
          }`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">
                {lead.status === 'converted' ? '✅' : lead.status === 'lost' ? '❌' : lead.status === 'interested' ? '⭐' : lead.status === 'new' ? '🆕' : '📋'}
              </span>
              <div>
                <p className="text-white font-extrabold text-sm">{
                  ({ new: 'عميل جديد', contacted: 'تم التواصل', interested: 'مهتم', interested_followup: 'مهتم ومتابعة',
                    not_interested: 'غير مهتم', lost: 'خسرنا', converted: 'تم الحجز / التحويل' } as Record<string, string>)[lead.status] || lead.status
                }</p>
                <p className="text-white/70 text-[11px]">آخر تحديث: {lead.lastFollowUp?.slice(0, 10) || '—'}</p>
              </div>
            </div>
            {lead.nextFollowUpDate && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${
                lead.nextFollowUpDate < new Date().toISOString().slice(0, 10) ? 'bg-red-100 text-red-700' :
                lead.nextFollowUpDate === new Date().toISOString().slice(0, 10) ? 'bg-orange-100 text-orange-700' :
                'bg-white/20 text-white'
              }`}>
                <Clock size={12} />
                {lead.nextFollowUpDate < new Date().toISOString().slice(0, 10)
                  ? `متأخر — ${lead.nextFollowUpDate}`
                  : `متابعة: ${lead.nextFollowUpDate}`}
              </div>
            )}
          </div>
          <div className="bg-white p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {lead.source && (
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">المصدر</p>
                <p className="font-bold text-gray-800 text-sm">📢 {lead.source}</p>
              </div>
            )}
            {lead.interestLevel && (
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">مستوى الاهتمام</p>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                  lead.interestLevel === 'high' ? 'bg-green-100 text-green-700' :
                  lead.interestLevel === 'medium' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {lead.interestLevel === 'high' ? '⭐ مرتفع' : lead.interestLevel === 'medium' ? '〽️ متوسط' : '▽ منخفض'}
                </span>
              </div>
            )}
            {lead.createdAt && (
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">تاريخ التسجيل</p>
                <p className="font-bold text-gray-800 text-sm">📅 {lead.createdAt?.slice(0, 10)}</p>
              </div>
            )}
            {lead.assignedSalesName && (
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">السيلز</p>
                <p className="font-bold text-indigo-700 text-sm">👤 {lead.assignedSalesName}</p>
              </div>
            )}
            {lead.tags && lead.tags.length > 0 && (
              <div className="col-span-2 sm:col-span-3 bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-2">التاجات</p>
                <div className="flex flex-wrap gap-1.5">
                  {lead.tags.map(tag => (
                    <span key={tag} className="px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-bold">🏷️ {tag}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Interested Courses (leads) ─── */}
      {!isSub && (lead?.interestedCourseIds?.length || 0) > 0 && (
        <div>
          <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
            <BookOpen size={15} className="text-blue-500" /> الكورسات المهتم بها
          </p>
          <div className="space-y-2">
            {(lead!.interestedCourseIds || []).map(id => {
              const resolvedId = id.startsWith('bundle:') ? id.replace('bundle:', '') : id;
              const course = courses.find(c => c.id === id);
              const bundle = bundles.find(b => b.id === resolvedId) || bundles.find(b => b.id === id);
              const title = course?.title || bundle?.title || id;
              const isBundle = id.startsWith('bundle:') || !!bundle;
              return (
                <div key={id} className="flex items-center gap-3 bg-white border border-blue-100 rounded-xl px-4 py-2.5 shadow-sm hover:border-blue-300 transition">
                  <span className="text-lg flex-shrink-0">{isBundle ? '📦' : '🎓'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 text-sm leading-tight truncate">{title}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{isBundle ? 'باقة' : 'كورس'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Lead bookings / payments ─── */}
      {!isSub && leadPayments.length > 0 && (
        <div>
          <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
            <CreditCard size={15} className="text-emerald-600" /> الحجوزات والمدفوعات
          </p>
          <div className="space-y-2">
            {leadPayments.map(pay => (
              <div key={pay.id} className="bg-gradient-to-l from-emerald-50 to-white border border-emerald-100 rounded-xl p-4 flex items-center justify-between gap-3 shadow-sm">
                <div>
                  <p className="font-bold text-emerald-700 text-base">{pay.amount.toLocaleString()} {pay.currency}</p>
                  {pay.courseId && <p className="text-xs text-gray-500 mt-0.5">🎓 {courses.find(c => c.id === pay.courseId)?.title || pay.courseId}</p>}
                  {pay.note && <p className="text-xs text-gray-400 mt-0.5 italic">{pay.note}</p>}
                </div>
                <div className="text-left flex-shrink-0">
                  <p className="text-[11px] text-gray-400 font-semibold">{pay.date?.slice(0, 10)}</p>
                  {pay.paymentType && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-bold mt-1 block text-center">{pay.paymentType}</span>}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="font-bold text-emerald-700 text-sm">الإجمالي المدفوع</span>
            <span className="font-extrabold text-emerald-800 text-lg">{leadPaidEGP.toLocaleString()} ج.م</span>
          </div>
        </div>
      )}

      {/* ─── Subscriber Enrolled Courses (rich) ─── */}
      {isSub && subscriber!.enrolledCourseIds.length > 0 && (
        <div>
          <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
            <BookOpen size={15} className="text-emerald-600" /> الكورسات المشترك بها
          </p>
          <div className="space-y-3">
            {subscriber!.enrolledCourseIds.map(courseId => {
              const course = courses.find(c => c.id === courseId);
              const bm = bookingMap[courseId];
              const hasCert = subCerts.some(c => c.courseId === courseId);
              const totalLec = getCourseLectures(courseId).length;
              const watched = Number(subscriber!.lectureProgress?.[courseId]) || 0;
              const pct = totalLec > 0 ? Math.round((watched / totalLec) * 100) : 0;
              const expectedForCourse = bm?.expectedEGP ?? (courses.find(c => c.id === courseId)?.price?.EGP ?? 0);
              const paidForCourse = bm?.paidEGP ?? 0;
              const remaining = expectedForCourse > 0 ? Math.max(0, expectedForCourse - paidForCourse) : null;
              return (
                <div key={courseId} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
                  <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-l from-emerald-50 to-white border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🎓</span>
                      <p className="font-extrabold text-gray-800 text-sm">{course?.title || courseId}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {hasCert && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full flex-shrink-0">🏆 شهادة</span>}
                      {remaining === 0 && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">✅ مكتمل</span>}
                      {remaining != null && remaining > 0 && <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">💳 متبقي</span>}
                    </div>
                  </div>
                  <div className="px-4 py-3">
                    {(bm || expectedForCourse > 0) ? (
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div className="bg-green-50 rounded-xl p-2.5 text-center border border-green-100">
                          <p className="font-extrabold text-green-700 text-sm">{paidForCourse.toLocaleString()}</p>
                          <p className="text-[10px] text-gray-400">مدفوع (ج.م)</p>
                        </div>
                        {expectedForCourse > 0 && (
                          <div className="bg-blue-50 rounded-xl p-2.5 text-center border border-blue-100">
                            <p className="font-extrabold text-blue-700 text-sm">{expectedForCourse.toLocaleString()}</p>
                            <p className="text-[10px] text-gray-400">الإجمالي (ج.م)</p>
                          </div>
                        )}
                        {remaining != null && (
                          <div className={`rounded-xl p-2.5 text-center border ${remaining === 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                            <p className={`font-extrabold text-sm ${remaining === 0 ? 'text-green-700' : 'text-red-600'}`}>{remaining === 0 ? '✅' : remaining.toLocaleString()}</p>
                            <p className="text-[10px] text-gray-400">{remaining === 0 ? 'مكتمل' : 'متبقي (ج.م)'}</p>
                          </div>
                        )}
                        {bm?.discount && bm.discount > 0 && (
                          <div className="col-span-3 bg-orange-50 rounded-xl px-3 py-1.5 flex items-center justify-between border border-orange-100">
                            <span className="text-[10px] text-orange-600 font-semibold">🏷️ خصم مطبّق</span>
                            <span className="font-bold text-orange-700 text-sm">{bm.discount.toLocaleString()} ج.م</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mb-3 italic">لا توجد مدفوعات مسجلة لهذا الكورس</p>
                    )}
                    {totalLec > 0 && (
                      <div>
                        <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                          <span>تقدم المشاهدة</span><span>{watched}/{totalLec} ({pct}%)</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className={`h-2 rounded-full transition-all ${pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Lead enrolled course (simple) ─── */}
      {!isSub && enrolledCourse && (lead?.interestedCourseIds?.length || 0) === 0 && (
        <div className="border border-blue-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="bg-gradient-to-l from-blue-50 to-white px-4 py-3 border-b border-blue-100 flex items-center gap-2">
            <BookOpen size={14} className="text-blue-600" />
            <p className="font-extrabold text-blue-800 text-sm">الكورس المهتم به</p>
          </div>
          <div className="p-4 bg-white">
            <p className="font-bold text-gray-800 mb-3">{enrolledCourse.title}</p>
            {leadPaidEGP > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-green-50 rounded-xl p-2.5 text-center border border-green-100">
                  <p className="font-extrabold text-green-700">{leadPaidEGP.toLocaleString()} ج.م</p>
                  <p className="text-[10px] text-gray-400">مدفوع</p>
                </div>
                {leadRemaining > 0 && (
                  <div className="bg-red-50 rounded-xl p-2.5 text-center border border-red-100">
                    <p className="font-extrabold text-red-600">{leadRemaining.toLocaleString()} ج.م</p>
                    <p className="text-[10px] text-gray-400">متبقي</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Contact history strip ─── */}
      {allComms.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="font-extrabold text-gray-800 text-sm flex items-center gap-2">
              <MessageSquare size={14} className="text-indigo-500" /> سجل التواصل ({allComms.length})
            </p>
            <button onClick={() => setActiveTab('communications')}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold hover:underline">
              عرض الكل ←
            </button>
          </div>
          <div className="space-y-2">
            {allComms.slice(0, 4).map(comm => {
              const c = comm as CommunicationRecord & { _src?: string };
              const meta = commTypeMeta[c.type] || commTypeMeta.note;
              return (
                <div key={c.id} className="flex gap-3 bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:border-indigo-200 transition">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${meta.color}`}>{meta.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
                      <span className="text-[10px] text-gray-400">{c.date?.slice(0, 10)}</span>
                    </div>
                    {c.notes && <p className="text-xs text-gray-700 line-clamp-2 leading-snug">{c.notes}</p>}
                    {c.outcome && <p className="text-[10px] text-emerald-600 mt-0.5 flex items-center gap-1"><CheckCircle size={10} />{c.outcome}</p>}
                    {c.nextFollowUp && <p className="text-[10px] text-orange-600 mt-0.5 flex items-center gap-1"><Clock size={10} />متابعة: {c.nextFollowUp}</p>}
                  </div>
                </div>
              );
            })}
            {allComms.length > 4 && (
              <button onClick={() => setActiveTab('communications')}
                className="w-full py-2 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-xl border border-dashed border-indigo-200 transition font-semibold">
                + {allComms.length - 4} تواصل آخر — عرض الكل
              </button>
            )}
          </div>
        </div>
      )}

      {/* ─── Consultations ─── */}
      {subConsults.length > 0 && (
        <div>
          <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
            <Activity size={14} className="text-purple-600" /> الاستشارات ({subConsults.length})
          </p>
          <div className="space-y-2">
            {subConsults.slice(0, 3).map(c => (
              <div key={c.id} className="border border-gray-100 rounded-xl p-3 bg-white flex items-center justify-between gap-2 shadow-sm">
                <div>
                  <p className="font-semibold text-sm text-gray-800">{c.therapistName}</p>
                  <p className="text-xs text-gray-500">{c.sessionDate} · {c.sessionType === 'individual' ? 'فردية' : c.sessionType === 'couple' ? 'زوجية' : 'عائلية'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[11px] font-bold shrink-0 ${c.status === 'completed' ? 'bg-green-100 text-green-700' : c.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                  {c.status === 'completed' ? 'مكتملة' : c.status === 'confirmed' ? 'مؤكدة' : 'معلقة'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Unified Activity Timeline ─── */}
      {(() => {
        type TEvent = { date: string; type: 'payment' | 'comm' | 'enrollment'; title: string; subtitle?: string; color: string; icon: React.ReactNode };
        const events: TEvent[] = [];
        subHistory.forEach(pay => {
          events.push({ date: pay.at || '', type: 'payment', icon: '💳', color: 'bg-emerald-100 text-emerald-700', title: `${pay.amount.toLocaleString()} ${pay.currency}`, subtitle: [pay.isInstallment ? 'قسط' : 'حجز جديد', pay.paymentType === 'course' ? (courses.find(c => c.id === pay.courseId)?.title || '') : pay.paymentType, pay.paymentMethod].filter(Boolean).join(' · ') });
        });
        leadPayments.forEach(pay => {
          events.push({ date: pay.date || '', type: 'payment', icon: '💰', color: 'bg-blue-100 text-blue-700', title: `${pay.amount.toLocaleString()} ${pay.currency}`, subtitle: pay.note || undefined });
        });
        allComms.forEach(c => {
          const cm = commTypeMeta[c.type] || commTypeMeta.note;
          events.push({ date: c.date || '', type: 'comm', icon: cm.icon, color: `${cm.color}`, title: cm.label, subtitle: c.notes?.slice(0, 80) || undefined });
        });
        if (events.length === 0) return null;
        const sorted = events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
        return (
          <div>
            <p className="font-extrabold text-gray-800 text-sm mb-3 flex items-center gap-2">
              <Activity size={14} className="text-slate-500" /> سجل النشاط الكامل
              <span className="text-[10px] text-gray-400 font-normal">({events.length} حدث)</span>
            </p>
            <div className="relative">
              <div className="absolute right-4 top-0 bottom-0 w-px bg-gray-200" />
              <div className="space-y-3 pr-10">
                {sorted.map((ev, i) => (
                  <div key={i} className="relative">
                    <div className={`absolute -right-[1.85rem] top-2 w-5 h-5 rounded-full flex items-center justify-center text-xs ${ev.color} border-2 border-white shadow-sm`}>
                      {ev.icon}
                    </div>
                    <div className={`border rounded-xl px-3 py-2 ${ev.type === 'payment' ? 'border-emerald-100 bg-emerald-50/40' : ev.type === 'enrollment' ? 'border-purple-100 bg-purple-50/40' : 'border-gray-100 bg-white'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-800 leading-tight">{ev.title}</p>
                          {ev.subtitle && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">{ev.subtitle}</p>}
                        </div>
                        <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0">{ev.date?.slice(0, 10)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {events.length > 12 && (
                  <div className="text-xs text-gray-400 text-center py-1">+ {events.length - 12} أحداث أقدم</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {allComms.length === 0 && !enrolledCourse && (subscriber?.enrolledCourseIds.length || 0) === 0 && (lead?.interestedCourseIds?.length || 0) === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Info size={48} className="mx-auto mb-3 text-gray-200" />
          <p className="text-sm font-semibold">لا توجد بيانات بعد</p>
          <p className="text-xs mt-1">ابدأ بتسجيل تواصل أو حجز كورس</p>
        </div>
      )}
    </div>
  );
}
