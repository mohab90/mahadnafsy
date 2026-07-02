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



export function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [inp, setInp] = useState('');
  const add = (tag: string) => { const t = tag.trim(); if (t && !tags.includes(t)) onChange([...tags, t]); setInp(''); };
  const remove = (tag: string) => onChange(tags.filter(t => t !== tag));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1 min-h-[22px]">
        {tags.map(tag => (
          <span key={tag} className="flex items-center gap-0.5 px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full text-[10px] font-bold">
            {tag}
            <button type="button" onClick={() => remove(tag)} className="hover:text-red-600 leading-none"><X size={10} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input value={inp} onChange={e => setInp(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(inp); } }}
          placeholder="اكتب تاج ثم Enter..."
          className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
        {inp.trim() && <button type="button" onClick={() => add(inp)} className="bg-indigo-600 text-white px-2 py-1.5 rounded-lg text-xs"><Plus size={12} /></button>}
      </div>
      <div className="flex flex-wrap gap-1">
        {PRESET_TAGS.filter(t => !tags.includes(t)).map(t => (
          <button type="button" key={t} onClick={() => add(t)}
            className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-700 rounded-full border border-gray-200 transition">+ {t}</button>
        ))}
      </div>
    </div>
  );
}

export function getScoreBreakdown(lead: LeadItem) {
  const statusScore: Partial<Record<LeadStatus, number>> = {
    new: 5, contacted: 15, interested: 35, no_answer: 8, not_interested: 0, closed: 50, converted: 100, lost: 0,
  };
  const ilScore = lead.interestLevel === 'high' ? 30 : lead.interestLevel === 'medium' ? 15 : 5;
  const commScore = Math.min((lead.communications?.length || 0) * 5, 25);
  return [
    { label: 'حالة الليد',       pts: statusScore[lead.status] ?? 0, max: 50 },
    { label: 'مستوى الاهتمام',  pts: ilScore, max: 30, tip: lead.interestLevel !== 'high' ? `ارفع لـ عالي +${30 - ilScore}` : '' },
    { label: 'تواصلات',          pts: commScore, max: 25, tip: commScore < 25 ? `سجّل تواصل إضافي +${25 - commScore}` : '' },
    { label: 'موعد متابعة',     pts: lead.nextFollowUpDate ? 5 : 0, max: 5, tip: !lead.nextFollowUpDate ? 'أضف موعد +5' : '' },
    { label: 'كورسات مهتم بها', pts: (lead.interestedCourseIds?.length || 0) > 0 ? 10 : 0, max: 10, tip: !(lead.interestedCourseIds?.length) ? 'أضف كورس +10' : '' },
  ];
}

export function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-gray-400';
  return (
    <span className={`${color} text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full`}>{score}</span>
  );
}

// ── Lead Journey Timeline Component ──────────────────────────────────────────
export interface TimelineEvent {
  id: string;
  leadId: string;
  eventType: string;
  description: string;
  meta: Record<string, string>;
  at: string;
}

export const EVENT_CFG: Record<string, { icon: string; color: string; label: string }> = {
  created:        { icon: '🌱', color: 'border-emerald-400 bg-emerald-50',  label: 'إنشاء' },
  status_changed: { icon: '🔄', color: 'border-blue-400 bg-blue-50',        label: 'تغيير حالة' },
  communication:  { icon: '💬', color: 'border-primary-400 bg-primary-50',  label: 'تواصل' },
  assigned:       { icon: '👤', color: 'border-purple-400 bg-purple-50',    label: 'تعيين' },
  followup_set:   { icon: '📅', color: 'border-amber-400 bg-amber-50',      label: 'موعد متابعة' },
  converted:      { icon: '🎉', color: 'border-green-500 bg-green-50',      label: 'تحويل' },
};

export function LeadJourneyTimeline({ leadId, communications }: {
  leadId: string;
  communications?: CommunicationRecord[];
}) {
  const [dbEvents, setDbEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    mysqlAdmin.getLeadTimeline(leadId)
      .then((rows) => setDbEvents((rows as unknown as TimelineEvent[]) || []))
      .catch(() => setDbEvents([]))
      .finally(() => setLoading(false));
  }, [leadId]);

  // Merge DB events + local communications (fallback for older leads with no DB events)
  const allEvents = useMemo(() => {
    const events: Array<{ id: string; eventType: string; description: string; at: string; fromDb: boolean }> = [
      ...dbEvents.map(e => ({ id: e.id, eventType: e.eventType, description: e.description, at: String(e.at), fromDb: true })),
    ];
    // Only add comm records that aren't already in DB events
    if (dbEvents.length === 0 && (communications || []).length > 0) {
      (communications || []).forEach(c => {
        const TYPE_AR: Record<string, string> = { call: '📞 مكالمة', whatsapp: '💬 واتساب', email: '✉️ إيميل', meeting: '🤝 اجتماع', note: '📝 ملاحظة', payment_followup: '💰 متابعة دفع', new_course_sale: '🎓 بيع كورس', certificate: '📜 شهادة' };
        events.push({ id: c.id, eventType: 'communication', description: `${TYPE_AR[c.type] || c.type}${c.notes ? ': ' + c.notes : ''}`, at: c.date, fromDb: false });
      });
    }
    return events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }, [dbEvents, communications]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-gray-400">
        <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin" />
        جاري تحميل رحلة الليد...
      </div>
    );
  }

  if (allEvents.length === 0) return null;

  return (
    <div>
      <label className="text-xs font-bold text-gray-600 mb-3 block flex items-center gap-1.5">
        <MapPin size={11} /> رحلة الليد <span className="text-gray-400 font-normal">({allEvents.length} حدث)</span>
      </label>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute right-[7px] top-3 bottom-3 w-0.5 bg-gray-200" />
        <div className="space-y-3 pr-6">
          {allEvents.map(ev => {
            const cfg = EVENT_CFG[ev.eventType] || { icon: '●', color: 'border-gray-300 bg-gray-50', label: ev.eventType };
            const dateStr = ev.at ? String(ev.at).slice(0, 16).replace('T', ' ') : '';
            return (
              <div key={ev.id} className="relative">
                {/* Dot */}
                <div className={`absolute -right-6 top-2.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center text-[8px] bg-white ${cfg.color.split(' ')[0]}`}>
                  <span>{cfg.icon.codePointAt(0)! > 127 ? '' : cfg.icon}</span>
                </div>
                <div className={`rounded-xl px-3 py-2 border ${cfg.color}`}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-wide opacity-60">{cfg.icon} {cfg.label}</span>
                    <span className="text-[9px] text-gray-400 shrink-0">{dateStr}</span>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{ev.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Quick Edit Panel ──────────────────────────────────────────────────────────

export function MultiSelectDropdown({ label, options, selected, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const toggle = (v: string) => {
    const next = new Set(selected);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange(next);
  };
  const displayLabel = selected.size === 0
    ? label
    : selected.size === 1
      ? (options.find(o => selected.has(o.value))?.label ?? label)
      : `${label} (${selected.size})`;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition ${
          selected.size > 0
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300'
        }`}>
        {displayLabel}
        <span className="text-[10px] opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 end-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[190px] py-1 max-h-64 overflow-y-auto">
          <button
            onClick={() => { onChange(new Set()); setOpen(false); }}
            className="w-full text-right px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition">
            ✓ الكل (إلغاء التصفية)
          </button>
          <div className="border-t border-gray-100 my-1" />
          {options.map(opt => (
            <button key={opt.value} onClick={() => toggle(opt.value)}
              className={`w-full text-right flex items-center gap-2 px-3 py-1.5 text-xs transition ${
                selected.has(opt.value) ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-700 hover:bg-gray-50'
              }`}>
              <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                selected.has(opt.value) ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
              }`}>
                {selected.has(opt.value) && <span className="text-white text-[8px] font-bold leading-none">✓</span>}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LeadTable component (from LeadsTab) ─────────────────────────────────────
export type CertPricingMap = Record<string, { egyptianEGP: number; residentEGP: number; residentSAR: number; foreignUSD: number }>;

// ── Compatibility aliases & helpers ──────────────────────────────────────────
export const LEAD_STATUS_CFG = STATUS_CFG;

export const crmSourceLabels: Record<string, { label: string; color: string }> = {
  'واتساب':    { label: 'واتساب',    color: 'bg-green-100 text-green-800' },
  'فيسبوك':   { label: 'فيسبوك',   color: 'bg-blue-100 text-blue-800' },
  'إنستغرام': { label: 'إنستغرام', color: 'bg-pink-100 text-pink-800' },
  'توصية':    { label: 'توصية',    color: 'bg-amber-100 text-amber-800' },
  'الموقع':   { label: 'الموقع',   color: 'bg-indigo-100 text-indigo-800' },
  'جوجل':     { label: 'جوجل',     color: 'bg-red-100 text-red-800' },
  'شات الـAI': { label: 'AI', color: 'bg-purple-100 text-purple-800' },
  'تسجيل دخول': { label: 'تسجيل', color: 'bg-gray-100 text-gray-700' },
  'Google Sheet': { label: 'Sheet', color: 'bg-teal-100 text-teal-800' },
  'أخرى':     { label: 'أخرى',     color: 'bg-gray-100 text-gray-600' },
};

export const formatWaPhone = (p: string) => {
  const d = p.replace(/\D/g, '');
  if (!d) return p;
  if (d.startsWith('0')) return '2' + d;
  if (d.startsWith('2') || d.startsWith('9') || d.startsWith('1')) return d;
  return d;
};

export const normBranchId = (v: string | null | undefined): string => {
  if (!v) return '';
  return v.toUpperCase().replace(/[-\s]/g, '_');
};

export const mkPromoCode = (name: string) =>
  name.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '').slice(0, 12);

export const crmStatusLabels: Record<string, string> = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم', interested_booking: 'مهتم بالحجز',
  interested_followup: 'مهتم ومتابعة', postpone_month: 'هيأجل >شهر', not_interested: 'مش مهتم',
  no_answer: 'لا يرد', no_answer_wa: 'لا يرد+واتس', no_answer_nowa: 'لا يرد-واتس',
  wrong_number: 'رقم غلط/مقفول', with_colleague: 'مع زميل آخر',
  not_interested_hidden: 'مش مهتم ومخفي', closed: 'مغلق', converted: 'تحول لمشترك', lost: 'مفقود', other: 'أخرى',
};

export const paymentTypeLabels: Record<string, string> = {
  course: 'دورة', bundle: 'باقة', certificate: 'شهادة',
  consultation: 'استشارة', deposit: 'عربون', installment: 'قسط', other: 'أخرى',
};

// ── ArchiveTab component (extracted to comply with Rules of Hooks) ───────────
export interface ArchiveTabProps {
  leads: LeadItem[];
  staffMembers: StaffMember[];
  addLead: (l: Partial<LeadItem>) => Promise<unknown>;
  updateLead: (l: LeadItem) => void;
  notify: NotifyFn;
  courses: Course[];
  bundles: Bundle[];
  navigate: ReturnType<typeof useNavigate>;
  deleteLead: (id: string) => void | Promise<void>;
  addSubscriber: (s: SubscriberItem) => Promise<boolean>;
  updateSubscriber: (s: SubscriberItem) => void | Promise<void>;
  subscribers: SubscriberItem[];
  salesReps: StaffMember[];
  isSalesOnly: boolean;
  onBook: (lead: LeadItem) => void;
  branchOptions: { id: string; label: string }[];
  sources: string[];
  title?: string;
  defaultSource?: string;
}
