import React from 'react';
import { NavigateFunction } from 'react-router-dom';
import {
  Phone, MessageSquare, CreditCard, BookOpen, Activity, Key, Tag,
  Award, DollarSign, CalendarDays, Clock, CheckCircle, Copy, Edit2,
} from 'lucide-react';
import {
  LeadItem, SubscriberItem, Course, ExtraCertificateType,
  UserSessionData,
} from '../../types';
import { branchLabels, normBranchKey, statusLabels, EXTRA_TYPE_LABELS } from '../unifiedClient.constants';

type Tab = 'overview' | 'communications' | 'payments' | 'courses' | 'certificates' | 'installments' | 'consultations' | 'daqqi' | 'edit';

interface ExtraCertDraft { courseId: string; type: ExtraCertificateType | ''; certExpected: string; certPaid: string }

interface Props {
  navigate: NavigateFunction;
  isSub: boolean;
  subscriber?: SubscriberItem;
  lead?: LeadItem;
  linkedLead?: LeadItem;
  linkedSub?: SubscriberItem;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientBranch?: string;
  courses: Course[];
  getCourseLectures: (courseId: string) => unknown[];
  sessionData: UserSessionData | null;
  allComms: { date: string }[];
  subPaidTotals: { EGP: number; SAR: number; USD: number };
  subRemainingEGP: number;
  bookingMap: Record<string, { paidEGP: number; expectedEGP?: number; discount?: number }>;
  subInstallmentPlans: NonNullable<SubscriberItem['installmentPlans']>;
  instOverdueCount: number;
  instSoonCount: number;
  todayStr: string;
  subCerts: NonNullable<SubscriberItem['certificates']>;
  extraReqs: NonNullable<SubscriberItem['extraCertificateRequests']>;
  enrolledCourse?: Course | null;
  leadPaidEGP: number;
  leadRemaining: number;
  discountBase: number;
  quickNote: string;
  saveQuickNote: (val: string) => void;
  promoCopied: boolean;
  setPromoCopied: (v: boolean) => void;
  handleGeneratePromo: () => void;
  isAdmin: boolean;
  editing: boolean;
  setEditing: (v: boolean) => void;
  setActiveTab: (tab: Tab) => void;
  setShowAddComm: (v: boolean) => void;
  setShowSubPayForm: (v: boolean) => void;
  setShowLeadPayForm: (v: boolean) => void;
  setShowGrantForm: (v: boolean) => void;
  setGrantDraft: (v: { courseId: string; note: string }) => void;
  setShowLegacyPayForm: (v: boolean) => void;
  setShowExtraCertForm: (v: boolean) => void;
  setExtraCertDraft: (v: ExtraCertDraft) => void;
  setShowInstPlanForm: (v: boolean) => void;
  setShowPayDetailModal: (v: boolean) => void;
  updateSubscriber: (item: SubscriberItem) => void;
}

export function ClientSidebar({
  navigate, isSub, subscriber, lead, linkedLead, linkedSub,
  clientName, clientPhone, clientEmail, clientBranch,
  courses, getCourseLectures, sessionData, allComms,
  subPaidTotals, subRemainingEGP, bookingMap,
  subInstallmentPlans, instOverdueCount, instSoonCount, todayStr,
  subCerts, extraReqs, enrolledCourse, leadPaidEGP, leadRemaining,
  discountBase, quickNote, saveQuickNote, promoCopied, setPromoCopied, handleGeneratePromo,
  isAdmin, editing, setEditing, setActiveTab,
  setShowAddComm, setShowSubPayForm, setShowLeadPayForm, setShowGrantForm, setGrantDraft,
  setShowLegacyPayForm, setShowExtraCertForm, setExtraCertDraft, setShowInstPlanForm,
  setShowPayDetailModal, updateSubscriber,
}: Props) {
  return (
    <div className="w-full lg:w-72 flex-shrink-0 space-y-3">

      {/* ── 1. Profile Card ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className={`h-1.5 ${isSub ? (subscriber!.status === 'active' ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-amber-400 to-orange-500') : 'bg-gradient-to-r from-blue-400 to-indigo-500'}`} />
        <div className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl shadow flex-shrink-0 ${isSub ? (subscriber!.status === 'active' ? 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white' : 'bg-gradient-to-br from-amber-400 to-orange-500 text-white') : 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'}`}>
              {clientName.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-gray-900 leading-tight truncate">{clientName}</p>
              <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${isSub ? (subscriber!.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700') : 'bg-blue-100 text-blue-700'}`}>
                {isSub ? (subscriber!.status === 'active' ? '● مشترك نشط' : '● متوقف') : (lead ? (statusLabels[lead.status] || lead.status) : 'عميل محتمل')}
              </span>
            </div>
          </div>

          {/* Quick contact buttons */}
          {clientPhone && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <a href={`tel:${clientPhone}`} className="flex items-center justify-center gap-1.5 py-2 bg-blue-50 text-blue-700 rounded-xl text-xs font-bold hover:bg-blue-100 transition border border-blue-100">
                <Phone size={13} /> اتصال
              </a>
              <a href={`https://wa.me/${clientPhone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 py-2 bg-green-50 text-green-700 rounded-xl text-xs font-bold hover:bg-green-100 transition border border-green-100">
                <MessageSquare size={13} /> واتساب
              </a>
            </div>
          )}

          {/* Info rows */}
          <div className="divide-y divide-gray-50 text-xs">
            {clientPhone && (
              <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">📞 الهاتف</span><span className="font-semibold text-gray-700">{clientPhone}</span></div>
            )}
            {clientEmail && (
              <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">✉️ البريد</span><a href={`mailto:${clientEmail}`} className="text-blue-600 hover:underline truncate max-w-[130px]">{clientEmail}</a></div>
            )}
            <div className="flex items-center justify-between py-1.5">
              <span className="text-gray-400">📍 الفرع</span>
              <span className="font-semibold text-gray-700">{clientBranch ? (branchLabels[normBranchKey(clientBranch)] || clientBranch) : '—'}</span>
            </div>
            <div className="flex items-center justify-between py-1.5">
              <span className="text-gray-400">🗓️ التسجيل</span>
              <span className="text-gray-600">{(isSub ? subscriber!.createdAt : lead?.createdAt)?.slice(0, 10) || '—'}</span>
            </div>
            {(isSub ? subscriber!.assignedSalesName : lead?.assignedSalesName) && (
              <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">🧑‍💼 السيلز</span><span className="font-semibold text-indigo-700">{isSub ? subscriber!.assignedSalesName : lead?.assignedSalesName}</span></div>
            )}
            {(isSub ? subscriber!.assignedCsName : lead?.assignedCsName) && (
              <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">🎧 خدمة العملاء</span><span className="font-semibold text-purple-700">{isSub ? subscriber!.assignedCsName : lead?.assignedCsName}</span></div>
            )}
            {(isSub ? linkedLead?.source : lead?.source) && (
              <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">📢 المصدر</span><span className="font-semibold text-gray-700">{isSub ? linkedLead?.source : lead?.source}</span></div>
            )}
            {!isSub && lead?.interestLevel && (
              <div className="flex items-center justify-between py-1.5">
                <span className="text-gray-400">⭐ الاهتمام</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${lead.interestLevel === 'high' ? 'bg-green-100 text-green-700' : lead.interestLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                  {lead.interestLevel === 'high' ? 'مرتفع' : lead.interestLevel === 'medium' ? 'متوسط' : 'منخفض'}
                </span>
              </div>
            )}
            {!isSub && lead?.nextFollowUpDate && (
              <div className="flex items-center justify-between py-1.5"><span className="text-gray-400">⏰ متابعة</span><span className="text-orange-600 font-bold">{lead.nextFollowUpDate}</span></div>
            )}
          </div>
        </div>
      </div>

      {/* ── 2. Financial summary (subscriber) ── */}
      {isSub && subscriber!.enrolledCourseIds.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5"><CreditCard size={13} className="text-emerald-500" /> الملخص المالي</p>
            <button onClick={() => setShowPayDetailModal(true)} className="text-[10px] text-blue-500 hover:underline font-semibold">تفاصيل ←</button>
          </div>
          {/* Totals row */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            {subPaidTotals.EGP > 0 && (
              <div className="bg-emerald-50 rounded-xl p-2.5 text-center border border-emerald-100">
                <p className="font-extrabold text-emerald-700 text-sm">{subPaidTotals.EGP.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ج.م</p>
              </div>
            )}
            {subRemainingEGP > 0 && (
              <div className="bg-red-50 rounded-xl p-2.5 text-center border border-red-100">
                <p className="font-extrabold text-red-600 text-sm">{subRemainingEGP.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">متبقي ج.م</p>
              </div>
            )}
            {subPaidTotals.SAR > 0 && (
              <div className="bg-blue-50 rounded-xl p-2.5 text-center border border-blue-100">
                <p className="font-extrabold text-blue-700 text-sm">{subPaidTotals.SAR.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ر.س</p>
              </div>
            )}
          </div>
          {/* Per-course list */}
          <div className="space-y-1.5">
            {subscriber!.enrolledCourseIds.map(cId => {
              const c = courses.find(x => x.id === cId);
              const bm = bookingMap[cId];
              const remaining = bm?.expectedEGP != null ? Math.max(0, bm.expectedEGP - bm.paidEGP) : null;
              return (
                <div key={cId} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                  <p className="font-semibold text-gray-800 text-xs truncate flex-1">{c?.title || cId}</p>
                  {bm ? (
                    <div className="flex-shrink-0 text-left">
                      <p className="text-[11px] font-bold text-emerald-700">{bm.paidEGP.toLocaleString()} ج.م</p>
                      {remaining !== null && remaining > 0 && <p className="text-[10px] text-red-600">باقي {remaining.toLocaleString()}</p>}
                      {remaining === 0 && <p className="text-[10px] text-emerald-600 font-bold">✅ مكتمل</p>}
                    </div>
                  ) : <span className="text-[10px] text-gray-400 italic flex-shrink-0">لا مدفوعات</span>}
                </div>
              );
            })}
          </div>
          {/* Discount badge */}
          {subscriber!.discount != null && subscriber!.discount > 0 && (
            <div className="mt-2 flex items-center justify-between bg-orange-50 border border-orange-100 rounded-xl px-3 py-1.5">
              <span className="text-xs text-orange-600">🏷️ خصم</span>
              <span className="font-extrabold text-orange-700 text-xs">{subscriber!.discount.toLocaleString()} ج.م</span>
            </div>
          )}
        </div>
      )}

      {/* ── 2b. Lead course (lead only) ── */}
      {!isSub && enrolledCourse && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3"><BookOpen size={13} className="text-blue-500" /> الكورس المهتم به</p>
          <div className="bg-blue-50 rounded-xl px-3 py-2.5 border border-blue-100">
            <p className="font-bold text-blue-800 text-xs">{enrolledCourse.title}</p>
            {leadPaidEGP > 0 && (
              <div className="flex items-center justify-between mt-1.5 flex-wrap gap-1">
                <span className="text-[10px] text-emerald-700 font-bold">{leadPaidEGP.toLocaleString()} ج.م مدفوع</span>
                {leadRemaining > 0 && <span className="text-[10px] text-red-600 font-bold">متبقي {leadRemaining.toLocaleString()}</span>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 3. Installment alerts ── */}
      {isSub && subInstallmentPlans.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <button onClick={() => setActiveTab('installments')} className="flex items-center gap-2 w-full text-xs font-extrabold text-gray-700 mb-3 hover:text-purple-600 transition">
            <CalendarDays size={13} className="text-purple-500" /> خطط الأقساط
            {instOverdueCount > 0 && <span className="mr-auto bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">{instOverdueCount} متأخر</span>}
            {instOverdueCount === 0 && instSoonCount > 0 && <span className="mr-auto bg-amber-400 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">{instSoonCount} قريب</span>}
          </button>
          <div className="space-y-1.5">
            {subInstallmentPlans.map(plan => {
              const unpaid = plan.entries.filter(e => !e.paidAt);
              const paid = plan.entries.filter(e => e.paidAt);
              const nextDue = unpaid.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
              const isOverdue = nextDue && nextDue.dueDate < todayStr;
              return (
                <div key={plan.id} className={`rounded-xl px-3 py-2.5 border ${isOverdue ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
                  <p className="font-semibold text-xs text-gray-800 truncate mb-1">{plan.courseTitle || courses.find(c => c.id === plan.courseId)?.title || plan.courseId}</p>
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <span className="text-[10px] text-emerald-700 font-bold">{paid.length}/{plan.entries.length} ✓</span>
                    {nextDue && <span className={`text-[10px] font-bold ${isOverdue ? 'text-red-600' : 'text-amber-600'}`}>{isOverdue ? '⚠️' : '⏰'} {nextDue.dueDate} — {nextDue.amount.toLocaleString()} ج.م</span>}
                    {!nextDue && <span className="text-[10px] text-emerald-600 font-bold">✅ مكتمل</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 4. Certificates ── */}
      {isSub && (subCerts.length > 0 || extraReqs.length > 0) && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3">
            <Award size={13} className="text-amber-500" /> الشهادات
            <span className="mr-auto text-[10px] font-normal text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{subCerts.length + extraReqs.filter(r => r.status === 'issued').length}</span>
          </p>
          <div className="space-y-1.5">
            {subCerts.map(cert => {
              const certCourse = courses.find(c => c.id === cert.courseId);
              return (
                <div key={cert.id} className="flex items-center gap-2 bg-amber-50 rounded-xl px-2.5 py-2 border border-amber-100">
                  <span>🏆</span><span className="text-xs font-semibold text-amber-800 truncate">{certCourse?.title || cert.courseId}</span>
                </div>
              );
            })}
            {extraReqs.map(req => (
              <div key={req.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-xl px-2.5 py-2 border border-gray-100">
                <span className="text-xs text-gray-700 truncate">{req.customName || EXTRA_TYPE_LABELS[req.type] || req.type}</span>
                <span className={`text-[10px] font-bold flex-shrink-0 ${req.status === 'issued' ? 'text-emerald-600' : req.status === 'paid' ? 'text-blue-600' : 'text-amber-600'}`}>
                  {req.status === 'issued' ? '✅' : req.status === 'paid' ? '💳' : '⏳'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 5. Activity stats ── */}
      {isSub && (sessionData || subscriber!.lectureProgress) && (() => {
        const totalLectures = subscriber!.enrolledCourseIds.reduce((acc, cId) => acc + getCourseLectures(cId).length, 0);
        const completedLectures = Object.values(subscriber!.lectureProgress || {}).filter((p) => (p as number) > 0).length;
        const completionPct = totalLectures > 0 ? Math.round((completedLectures / totalLectures) * 100) : null;
        return (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3"><Activity size={13} className="text-teal-500" /> نشاط العميل</p>
            <div className="space-y-2 text-xs">
              {sessionData?.visitCount != null && (
                <div className="flex items-center justify-between"><span className="text-gray-400">زيارات الموقع</span><span className="font-bold text-indigo-700">{sessionData.visitCount} مرة</span></div>
              )}
              {sessionData?.lastActiveAt && (
                <div className="flex items-center justify-between"><span className="text-gray-400">آخر نشاط</span><span className="font-semibold text-gray-700">{new Date(sessionData.lastActiveAt).toLocaleDateString('ar-EG-u-nu-latn')}</span></div>
              )}
              {completionPct !== null && (
                <div>
                  <div className="flex items-center justify-between mb-1"><span className="text-gray-400">إتمام المحاضرات</span><span className={`font-bold ${completionPct === 100 ? 'text-emerald-600' : completionPct >= 50 ? 'text-amber-600' : 'text-gray-600'}`}>{completionPct}%</span></div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5"><div className={`h-1.5 rounded-full transition-all ${completionPct === 100 ? 'bg-emerald-500' : completionPct >= 50 ? 'bg-amber-400' : 'bg-blue-400'}`} style={{ width: `${completionPct}%` }} /></div>
                </div>
              )}
            </div>
            {allComms.length > 0 ? (
              <div className="mt-2 flex items-center justify-between text-xs pt-2 border-t border-gray-50">
                <span className="text-gray-400">📅 آخر تواصل</span><span className="font-semibold text-gray-700">{allComms[0].date?.slice(0, 10)}</span>
              </div>
            ) : (
              <div className="mt-2 text-xs text-amber-600 bg-amber-50 rounded-xl px-2.5 py-1.5 flex items-center gap-1 border border-amber-100">⚠️ لم يتم التواصل بعد</div>
            )}
            {(() => {
              const overdueAmt = subInstallmentPlans.flatMap(p => p.entries.filter(e => !e.paidAt && e.dueDate < todayStr)).reduce((s, e) => s + e.amount, 0);
              return overdueAmt > 0 ? (
                <div className="mt-2 flex items-center justify-between text-xs bg-red-50 rounded-xl px-2.5 py-1.5 border border-red-100">
                  <span className="text-red-600 font-bold">🔴 أقساط متأخرة</span><span className="text-red-700 font-extrabold">{overdueAmt.toLocaleString()} ج.م</span>
                </div>
              ) : null;
            })()}
          </div>
        );
      })()}

      {/* ── 6. Quick Actions Grid ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-3">إجراءات سريعة</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => { setActiveTab('communications'); setShowAddComm(true); }}
            className="flex flex-col items-center gap-1.5 py-3 bg-blue-50 text-blue-700 rounded-2xl hover:bg-blue-100 transition border border-blue-100">
            <Phone size={18} /><span className="text-[11px] font-bold">تسجيل تواصل</span>
          </button>
          {isSub ? (
            <button onClick={() => { setActiveTab('payments'); setShowSubPayForm(true); }}
              className="flex flex-col items-center gap-1.5 py-3 bg-emerald-50 text-emerald-700 rounded-2xl hover:bg-emerald-100 transition border border-emerald-100">
              <CreditCard size={18} /><span className="text-[11px] font-bold">تسجيل دفعة</span>
            </button>
          ) : (
            <button onClick={() => setShowLeadPayForm(true)}
              className="flex flex-col items-center gap-1.5 py-3 bg-emerald-50 text-emerald-700 rounded-2xl hover:bg-emerald-100 transition border border-emerald-100">
              <DollarSign size={18} /><span className="text-[11px] font-bold">تسجيل دفعة</span>
            </button>
          )}
          {isSub && (
            <>
              <button onClick={() => { setShowGrantForm(true); setGrantDraft({ courseId: '', note: '' }); }}
                className="flex flex-col items-center gap-1.5 py-3 bg-violet-50 text-violet-700 rounded-2xl hover:bg-violet-100 transition border border-violet-100">
                <Key size={18} /><span className="text-[11px] font-bold">منح كورس</span>
              </button>
              <button onClick={() => setShowLegacyPayForm(true)}
                className="flex flex-col items-center gap-1.5 py-3 bg-amber-50 text-amber-700 rounded-2xl hover:bg-amber-100 transition border border-amber-100">
                <Clock size={18} /><span className="text-[11px] font-bold">مدفوع قديم</span>
              </button>
              <button onClick={() => { setActiveTab('certificates'); setShowExtraCertForm(true); setExtraCertDraft({ courseId: '', type: '', certExpected: '', certPaid: '' }); }}
                className="flex flex-col items-center gap-1.5 py-3 bg-orange-50 text-orange-700 rounded-2xl hover:bg-orange-100 transition border border-orange-100">
                <Award size={18} /><span className="text-[11px] font-bold">إصدار شهادة</span>
              </button>
              <button onClick={() => setShowInstPlanForm(true)}
                className="flex flex-col items-center gap-1.5 py-3 bg-purple-50 text-purple-700 rounded-2xl hover:bg-purple-100 transition border border-purple-100">
                <CalendarDays size={18} /><span className="text-[11px] font-bold">خطة أقساط</span>
              </button>
            </>
          )}
          <button onClick={() => { setEditing(!editing); setActiveTab('edit'); }}
            className="flex flex-col items-center gap-1.5 py-3 bg-gray-50 text-gray-600 rounded-2xl hover:bg-gray-100 transition border border-gray-100">
            <Edit2 size={18} /><span className="text-[11px] font-bold">تعديل البيانات</span>
          </button>
        </div>
      </div>

      {/* ── 7. Internal notes ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-2">📌 ملاحظة داخلية</p>
        <textarea
          value={quickNote}
          onChange={e => saveQuickNote(e.target.value)}
          placeholder="ملاحظة خاصة بالفريق (لا تظهر للعميل)..."
          rows={3}
          className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-100 bg-gray-50"
        />
      </div>

      {/* ── 8. Promo code (lead only) ── */}
      {!isSub && lead && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3"><Tag size={13} className="text-purple-500" /> كود الخصم</p>
          {lead.promoCode ? (
            <div className="flex items-center gap-2 bg-purple-50 rounded-xl px-3 py-2.5 border border-purple-100">
              <span className="font-mono font-bold text-purple-700 flex-1">{lead.promoCode}</span>
              <button onClick={() => { navigator.clipboard.writeText(lead.promoCode!).then(() => { setPromoCopied(true); setTimeout(() => setPromoCopied(false), 2000); }); }}>
                {promoCopied ? <CheckCircle size={14} className="text-emerald-600" /> : <Copy size={14} className="text-purple-500" />}
              </button>
            </div>
          ) : (
            <button onClick={handleGeneratePromo} className="w-full py-2.5 bg-purple-50 text-purple-700 rounded-xl text-xs hover:bg-purple-100 flex items-center justify-center gap-2 border border-purple-100 font-bold transition">
              <Tag size={13} /> توليد كود خصم
            </button>
          )}
        </div>
      )}

      {/* ── 9. Discount quick-setter (subscriber only) ── */}
      {isSub && discountBase > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 mb-3"><Tag size={13} className="text-orange-500" /> خصم سريع</p>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {[5, 10, 15, 20, 25, 30].map(pct => {
              const val = Math.round(discountBase * pct / 100);
              const isActive = subscriber!.discount === val;
              return (
                <button key={pct} onClick={() => updateSubscriber({ ...subscriber!, discount: val })}
                  className={`py-1.5 rounded-xl text-xs font-bold border-2 transition ${isActive ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300'}`}>
                  {pct}%<span className="block text-[9px] font-normal text-gray-400">{val.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
          {subscriber!.discount && subscriber!.discount > 0 && (
            <button onClick={() => updateSubscriber({ ...subscriber!, discount: 0 })} className="w-full py-1.5 text-xs text-red-500 hover:bg-red-50 rounded-xl transition">
              ✕ إلغاء الخصم ({subscriber!.discount.toLocaleString()} ج.م)
            </button>
          )}
          <p className="text-[10px] text-gray-400 mt-1.5 text-center">محسوبة من {discountBase.toLocaleString()} ج.م</p>
        </div>
      )}

      {/* ── 10. Linked subscriber cross-link (lead view only) ── */}
      {!isSub && linkedSub && (
        <div className="bg-emerald-50 rounded-2xl border border-emerald-200 p-4">
          <p className="text-xs font-extrabold text-emerald-700 flex items-center gap-1.5 mb-2"><CheckCircle size={13} /> ملف المشترك</p>
          <p className="font-bold text-emerald-800 text-sm">{linkedSub.name}</p>
          <p className="text-xs text-emerald-600 mb-2">{linkedSub.enrolledCourseIds.length} كورس مسجل</p>
          <button onClick={() => navigate(`/client/${linkedSub.clientCode || linkedSub.id}`)} className="w-full py-2 bg-emerald-600 text-white rounded-xl text-xs hover:bg-emerald-700 flex items-center justify-center gap-1.5 font-bold transition">
            <BookOpen size={12} /> عرض الملف الكامل
          </button>
        </div>
      )}

    </div>
  );
}
