import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, AlertCircle, Archive, Award, BarChart2, Bell, BookOpen, CalendarPlus, CheckCheck, CheckCircle,
  ChevronDown, Clock, Columns, CreditCard, Download, ExternalLink, EyeOff, Eye,
  FolderKanban, Globe, Inbox, Link2, MapPin, MessageCircle, MessageSquare, MessageSquareText,
  Phone, Plus, RefreshCw, Search, Settings, Share2, Star, Tag, Trash2, TrendingUp,
  Upload, UserPlus, Users, Wallet, X,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { useSiteData } from '../../../../context/SiteDataContext';
import { useBranches } from '../../../../hooks/useBranches';
import { mysqlAdmin, mysqlClient } from '../../../../lib/mysqlapi';
import { useResizableCols } from '../../../../components/useResizableCols';
import type {
  LeadItem, LeadStatus, CommunicationRecord, SalesTarget, Course, Bundle,
  BranchType, FacebookLeadAdsConfig, PaymentHistoryEntry, PaymentItemType,
  SubscriberItem, StaffMember, AccessMode, CourseAccessSetting,
} from '../../../../types';
import { CrmSettingsModal, DEFAULT_CRM_SETTINGS } from '../CrmSettingsModal';
import PaymentModal, { PaymentDraft, blankPaymentDraft } from '../../../../components/PaymentModal';
import type { CrmSettings, NotifyFn } from '../CrmSettingsModal';
import { DEFAULT_SOURCES, ONLINE_EXCLUDED_SOURCES, isOnlineSource, EMPTY_LEAD_DRAFT } from '../crmConstants';
import { LeadTable } from '../LeadTable';
import {
  BRANCH_ENUM_LABELS,
  COMM_ICON,
  COMM_LABEL,
  IL_LABEL,
  PIE_COLORS,
  PIPELINE_COLS,
  PRESET_TAGS,
  ROTTEN_CFG,
  STATUS_CFG,
  calcLeadScore,
  getLeadBranchRaw,
  getRottenLevel,
  // getScoreBreakdown intentionally NOT imported — this file defines a richer local version
} from '../leadUtils';


import { ScoreBadge, TagInput, getScoreBreakdown, LeadJourneyTimeline } from './leadShared';

export function QuickEditPanel({ lead, onClose, onSave, courses, bundles, notify, instituteBranches }: {
  lead: LeadItem;
  onClose: () => void;
  onSave: (updated: LeadItem) => void;
  courses: Course[];
  bundles: Bundle[];
  notify: NotifyFn;
  instituteBranches: { id: string; label: string }[];
}) {
  const [draft, setDraft] = useState<LeadItem>({ ...lead });
  const [commNote, setCommNote] = useState('');
  const [commType, setCommType] = useState<CommunicationRecord['type']>('call');
  const [deactivating, setDeactivating] = useState(false);

  const handleDeactivateUser = async () => {
    if (!lead.email) return notify('error', 'لا يوجد بريد إلكتروني لهذا العميل');
    if (!window.confirm(`هل أنت متأكد أنك تريد تعطيل حساب "${lead.name}"؟\nلن يتمكن من تسجيل الدخول بعد ذلك.`)) return;
    setDeactivating(true);
    try {
      // Find user by email first
      const users = await mysqlAdmin.listAllUsers() as Array<{ id: string; email: string; name: string; is_active: number }>;
      const user = users.find(u => u.email?.toLowerCase() === lead.email?.toLowerCase());
      if (!user) { notify('error', 'لم يتم العثور على حساب لهذا العميل'); return; }
      await mysqlAdmin.deactivateUser(user.id);
      notify('success', `تم تعطيل حساب ${lead.name} بنجاح — لن يتمكن من الدخول`);
    } catch (e) {
      notify('error', 'فشل تعطيل الحساب، حاول مرة أخرى');
    } finally {
      setDeactivating(false);
    }
  };

  const addComm = () => {
    if (!commNote.trim()) return;
    const rec: CommunicationRecord = {
      id: `cr-${Date.now()}`, type: commType,
      date: new Date().toISOString().slice(0, 10), notes: commNote.trim(),
    };
    setDraft(d => ({ ...d, communications: [...(d.communications || []), rec] }));
    setCommNote('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-end" onClick={onClose}>
      <div className="bg-white h-full w-full max-w-md shadow-2xl overflow-y-auto flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 flex items-center justify-between px-5 py-4 z-10">
          <div>
            <h3 className="font-bold text-gray-900">{draft.name}</h3>
            <p className="text-xs text-gray-500">{draft.phone} · <ScoreBadge score={calcLeadScore(draft)} /></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-4 flex-1">
          {/* Status */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-2 block">الحالة</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(STATUS_CFG) as LeadStatus[]).filter(s => s !== 'converted').map(s => (
                <button key={s} onClick={() => setDraft(d => ({ ...d, status: s }))}
                  className={`text-xs px-2 py-1.5 rounded-lg border font-medium transition ${
                    draft.status === s
                      ? STATUS_CFG[s].color + ' ring-2 ring-offset-0 ring-current'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {STATUS_CFG[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* Interest level */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-2 block">مستوى الاهتمام</label>
            <div className="flex gap-2">
              {(['high', 'medium', 'low'] as const).map(il => (
                <button key={il} onClick={() => setDraft(d => ({ ...d, interestLevel: il }))}
                  className={`flex-1 text-xs py-1.5 rounded-lg border transition ${
                    draft.interestLevel === il
                      ? 'bg-primary-50 border-primary-300 text-primary-800 font-bold'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {IL_LABEL[il]}
                </button>
              ))}
            </div>
          </div>

          {/* Next follow-up */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">موعد المتابعة القادمة</label>
            <input type="date" value={draft.nextFollowUpDate || ''}
              onChange={e => setDraft(d => ({ ...d, nextFollowUpDate: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>

          {/* Branch */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">الفرع</label>
            {(() => {
              const normB = (v: string) => v.toUpperCase().replace(/[-\s]/g, '_');
              const branchSelectId = draft.branch
                ? (instituteBranches.find(b => normB(b.id) === normB(draft.branch || ''))?.id ?? draft.branch)
                : '';
              return (
                <select value={branchSelectId} onChange={e => setDraft(d => ({ ...d, branch: (e.target.value || undefined) as typeof d.branch }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                  <option value="">— غير محدد</option>
                  {instituteBranches.map(b => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
              );
            })()}
          </div>

          {/* Interested courses + bundles (editable) */}
          {(courses.length > 0 || bundles.length > 0) && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-600 mb-1 block">الكورسات والمسارات المهتم بها</label>
              {courses.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {courses.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => setDraft(d => ({
                        ...d,
                        interestedCourseIds: (d.interestedCourseIds || []).includes(c.id)
                          ? (d.interestedCourseIds || []).filter(id => id !== c.id)
                          : [...(d.interestedCourseIds || []), c.id],
                      }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${
                        (draft.interestedCourseIds || []).includes(c.id)
                          ? 'bg-primary-600 text-white border-primary-600'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      {c.title}
                    </button>
                  ))}
                </div>
              )}
              {bundles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {bundles.map(b => (
                    <button key={b.id} type="button"
                      onClick={() => setDraft(d => ({
                        ...d,
                        interestedCourseIds: (d.interestedCourseIds || []).includes(b.id)
                          ? (d.interestedCourseIds || []).filter(id => id !== b.id)
                          : [...(d.interestedCourseIds || []), b.id],
                      }))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${
                        (draft.interestedCourseIds || []).includes(b.id)
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                      📚 {b.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظات</label>
            <textarea value={draft.notes || ''} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              rows={2} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
          </div>

          {/* Add communication */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-gray-700 flex items-center gap-1"><MessageCircle size={12} /> سجل تواصل جديد</p>
            <div className="flex gap-1.5">
              <select value={commType} onChange={e => setCommType(e.target.value as CommunicationRecord['type'])}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                <option value="call">📞 مكالمة</option>
                <option value="whatsapp">💬 واتساب</option>
                <option value="email">✉️ إيميل</option>
                <option value="meeting">🤝 اجتماع</option>
                <option value="note">📝 ملاحظة</option>
              </select>
              <input value={commNote} onChange={e => setCommNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addComm()}
                placeholder="ملاحظة التواصل..."
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
              <button onClick={addComm} className="bg-primary-600 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold">
                <Plus size={13} />
              </button>
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto">
              {(draft.communications || []).slice().reverse().slice(0, 5).map(c => (
                <div key={c.id} className="text-xs text-gray-600 bg-white border border-gray-100 rounded-lg px-2 py-1">
                  <span className="font-medium text-gray-400">{c.date}</span> · {c.notes}
                </div>
              ))}
            </div>
          </div>

          {/* Phone quick links */}
          <div className="flex gap-2">
            <a href={`tel:${draft.phone}`}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-gray-200 rounded-xl py-2 hover:bg-gray-50 text-gray-600 font-medium">
              <Phone size={13} /> اتصال
            </a>
            <a href={`https://wa.me/2${draft.phone.replace(/^0/, '')}`} target="_blank" rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-emerald-200 rounded-xl py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium">
              💬 واتساب
            </a>
          </div>

          {/* ── Tags ── */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block flex items-center gap-1">
              <Tag size={11} /> تصنيفات
            </label>
            <TagInput tags={draft.tags || []} onChange={tags => setDraft(d => ({ ...d, tags }))} />
          </div>

          {/* ── AI Score Breakdown ── */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-700">تحليل السكور</span>
              <ScoreBadge score={calcLeadScore(draft)} />
            </div>
            <div className="space-y-1.5">
              {getScoreBreakdown(draft).map(item => (
                <div key={item.label}>
                  <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
                    <span>{item.label}</span>
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-gray-700">{item.pts}/{item.max}</span>
                      {item.tip && <span className="text-amber-600 font-bold">→ {item.tip}</span>}
                    </div>
                  </div>
                  <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full transition-all"
                      style={{ width: `${Math.round((item.pts / item.max) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Journey Timeline (DB-backed) ── */}
          <LeadJourneyTimeline leadId={lead.id} communications={draft.communications} />
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 space-y-2">
          <div className="flex gap-3">
            <button onClick={() => onSave(draft)}
              className="flex-1 bg-primary-600 text-white py-2.5 rounded-xl font-bold hover:bg-primary-700 transition">
              حفظ التغييرات
            </button>
            <button onClick={onClose} className="px-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
          </div>
          {lead.source === 'تسجيل دخول' && (
            <button
              onClick={handleDeactivateUser}
              disabled={deactivating}
              className="w-full text-xs py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 transition font-bold disabled:opacity-50">
              {deactivating ? 'جاري التعطيل...' : '🚫 تعطيل حساب المستخدم (منع الدخول)'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lead Card ─────────────────────────────────────────────────────────────────
