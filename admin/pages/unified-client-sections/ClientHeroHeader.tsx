import React from 'react';
import { NavigateFunction } from 'react-router-dom';
import {
  ArrowRight, Phone, MessageSquare, Edit2, Trash2, Mail,
  CheckCircle, Copy, Award, CalendarCheck2, CalendarDays, Shield,
} from 'lucide-react';
import { LeadItem, SubscriberItem, ExtraCertificateType } from '../../types';
import { branchLabels, normBranchKey, statusLabels } from '../unifiedClient.constants';

interface Props {
  navigate: NavigateFunction;
  isSub: boolean;
  subscriber?: SubscriberItem;
  lead?: LeadItem;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientCode: string;
  clientBranch?: string;
  codeCopied: boolean;
  setCodeCopied: (v: boolean) => void;
  allCommsCount: number;
  heroPaidEGP: number;
  heroCourseCount: number;
  lastCommDate: string | null;
  linkedSub?: SubscriberItem;
  isAdmin: boolean;
  canManageCourseAccess: boolean;
  instOverdueCount: number;
  setShowConvertModal: (v: boolean) => void;
  setShowAddComm: (v: boolean) => void;
  setShowInstPlanForm: (v: boolean) => void;
  setShowExtraCertForm: (v: boolean) => void;
  setExtraCertDraft: (v: { courseId: string; type: ExtraCertificateType | ''; certExpected: string; certPaid: string }) => void;
  setShowAccessModal: (v: boolean) => void;
  setEditing: (v: boolean) => void;
  setActiveTab: (tab: 'overview' | 'communications' | 'payments' | 'courses' | 'certificates' | 'installments' | 'consultations' | 'daqqi' | 'edit') => void;
  updateSubscriber: (item: SubscriberItem) => void;
  deleteSubscriber: (id: string) => void;
  deleteLead: (id: string) => void;
}

export function ClientHeroHeader({
  navigate, isSub, subscriber, lead, clientName, clientPhone, clientEmail, clientCode, clientBranch,
  codeCopied, setCodeCopied, allCommsCount, heroPaidEGP, heroCourseCount, lastCommDate, linkedSub,
  isAdmin, canManageCourseAccess, instOverdueCount,
  setShowConvertModal, setShowAddComm, setShowInstPlanForm, setShowExtraCertForm, setExtraCertDraft,
  setShowAccessModal, setEditing, setActiveTab, updateSubscriber, deleteSubscriber, deleteLead,
}: Props) {
  return (
    <>
      {/* ══════════════════ HERO HEADER ══════════════════ */}
      <div className="bg-gradient-to-br from-slate-800 via-slate-750 to-slate-900 text-white shadow-xl">
        <div className="max-w-7xl mx-auto px-4 pt-4 pb-5">

          {/* Breadcrumb nav */}
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-4 flex-wrap">
            <button onClick={() => navigate('/dashboard')} className="hover:text-white flex items-center gap-1 transition-colors">
              <ArrowRight size={13} /> لوحة التحكم
            </button>
            <span className="text-slate-600">/</span>
            <button onClick={() => navigate(isSub ? '/dashboard/subscribers' : '/dashboard')} className="hover:text-white transition-colors">
              {isSub ? 'المشتركون' : 'العملاء المحتملون'}
            </button>
            <span className="text-slate-600">/</span>
            <span className="text-slate-200 font-semibold">{clientName}</span>
            {/* code badge */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname.replace(/\/[^/]+$/, '')}#/client/${clientCode}`).catch(() => {});
                setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000);
              }}
              className="flex items-center gap-1 px-2 py-0.5 bg-slate-700 text-slate-300 border border-slate-600 rounded-full text-[10px] font-mono hover:bg-slate-600 transition-colors"
            >
              <Copy size={8} /> {clientCode.slice(0, 12)}
              {codeCopied && <span className="text-green-400 font-bold mr-1">✓</span>}
            </button>
          </div>

          {/* Avatar + name + status + contact */}
          <div className="flex items-start gap-4 mb-5">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center font-black text-3xl shadow-lg flex-shrink-0 ${isSub ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 'bg-gradient-to-br from-blue-400 to-blue-600'}`}>
              {clientName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-extrabold text-white leading-tight">{clientName}</h1>
                {isSub ? (
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${subscriber!.status === 'active' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'}`}>
                    {subscriber!.status === 'active' ? '● مشترك نشط' : '● متوقف'}
                  </span>
                ) : lead && (
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-slate-600/50 text-slate-300 border-slate-500/30`}>
                    {statusLabels[lead.status] || lead.status}
                  </span>
                )}
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${isSub ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700/30' : 'bg-blue-900/40 text-blue-300 border-blue-700/30'}`}>
                  {isSub ? 'مشترك' : 'عميل محتمل'}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap text-slate-400 text-xs">
                {clientPhone && <span className="flex items-center gap-1"><Phone size={11} /> {clientPhone}</span>}
                {clientEmail && <span className="flex items-center gap-1 truncate max-w-[200px]"><Mail size={11} /> {clientEmail}</span>}
                {clientBranch && <span className="flex items-center gap-1">📍 {branchLabels[normBranchKey(clientBranch)] || clientBranch}</span>}
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/10">
              <p className="text-2xl font-extrabold text-white">{allCommsCount}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">رسالة / تواصل</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/10">
              <p className="text-2xl font-extrabold text-emerald-300">{heroPaidEGP > 0 ? heroPaidEGP.toLocaleString() : '—'}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">ج.م مدفوع</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/10">
              <p className="text-2xl font-extrabold text-blue-300">{heroCourseCount}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">كورس مسجّل</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl px-3 py-2.5 border border-white/10">
              <p className="text-sm font-extrabold text-slate-200 truncate">{lastCommDate ?? 'لا يوجد'}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">آخر تواصل</p>
            </div>
          </div>

          {/* Action buttons row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Primary: call + WA + contact + booking/installment */}
            {clientPhone && (
              <>
                <a href={`https://wa.me/${clientPhone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 bg-green-500 hover:bg-green-400 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                  <MessageSquare size={14} /> واتس أب
                </a>
                <a href={`tel:${clientPhone}`}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                  <Phone size={14} /> اتصال
                </a>
              </>
            )}
            {/* Lead-only: حجز / ملف المشترك */}
            {lead && lead.status !== 'converted' ? (
              <button onClick={() => setShowConvertModal(true)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                <CalendarCheck2 size={14} /> حجز
              </button>
            ) : lead && lead.status === 'converted' && linkedSub ? (
              <button onClick={() => navigate(`/client/${linkedSub.clientCode || linkedSub.id}`)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors">
                <CheckCircle size={14} /> ملف المشترك
              </button>
            ) : null}
            {/* ── Action buttons strip ── */}
            {/* تسجيل تواصل */}
            <button onClick={() => setShowAddComm(true)}
              className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
              <Phone size={14} /> تواصل
            </button>
            {/* خطة أقساط (مشترك فقط) */}
            {isSub && (
              <button onClick={() => setShowInstPlanForm(true)}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                <CalendarDays size={14} /> أقساط
              </button>
            )}
            {/* طلب شهادة (مشترك فقط) */}
            {isSub && (
              <button onClick={() => { setShowExtraCertForm(true); setExtraCertDraft({ courseId: '', type: '', certExpected: '', certPaid: '' }); }}
                className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                <Award size={14} /> شهادة
              </button>
            )}
            {/* صلاحية الفيديوهات */}
            {canManageCourseAccess && isSub && (
              <button onClick={() => setShowAccessModal(true)}
                className="px-3 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors border border-violet-500/30 shadow-sm">
                <Shield size={14} /> صلاحية
              </button>
            )}
            {/* تعديل البيانات */}
            <button onClick={() => { setEditing(true); setActiveTab('edit'); }}
              className="px-3 py-2 bg-white/15 hover:bg-white/25 text-white border border-white/20 rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors">
              <Edit2 size={14} /> تعديل
            </button>
            {/* إيقاف / تفعيل (admin) */}
            {isSub && isAdmin && (
              <button
                onClick={() => updateSubscriber({ ...subscriber!, status: subscriber!.status === 'active' ? 'paused' : 'active' })}
                className="px-3 py-2 bg-amber-600/80 hover:bg-amber-500 text-white rounded-xl text-sm font-medium transition-colors border border-amber-500/30">
                {subscriber!.status === 'active' ? 'إيقاف' : 'تفعيل'}
              </button>
            )}
            {/* حذف (admin) */}
            {isAdmin && (
              <button
                onClick={() => {
                  if (!window.confirm(`هل تريد حذف ${clientName}؟`)) return;
                  if (subscriber) { deleteSubscriber(subscriber.id); navigate('/dashboard/subscribers'); }
                  else if (lead) { deleteLead(lead.id); navigate('/dashboard'); }
                }}
                className="px-3 py-2 bg-red-600/80 hover:bg-red-500 text-white rounded-xl text-sm font-medium flex items-center gap-1.5 transition-colors border border-red-500/30">
                <Trash2 size={14} /> حذف
              </button>
            )}
          </div>
        </div>
      </div>


      {/* ══ Overdue installments warning banner ══ */}
      {isSub && instOverdueCount > 0 && (
        <div className="bg-red-600 text-white px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="text-lg">🔴</span>
            لدى هذا العميل {instOverdueCount} {instOverdueCount === 1 ? 'قسط متأخر' : 'أقساط متأخرة'} —
            يجب المتابعة
          </div>
          <button onClick={() => setActiveTab('installments')}
            className="text-xs bg-white text-red-700 font-bold px-3 py-1.5 rounded-lg hover:bg-red-50 transition flex-shrink-0">
            عرض الأقساط ←
          </button>
        </div>
      )}
    </>
  );
}
