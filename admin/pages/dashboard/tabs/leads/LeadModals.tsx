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


import { TagInput } from './leadShared';

export function AddLeadModal({ courses, bundles, salesReps, leads, sources, branches, onClose, onSave }: {
  courses: Course[];
  bundles: Bundle[];
  salesReps: { id: string; name: string }[];
  leads: LeadItem[];
  sources: string[];
  branches: { id: string; label: string }[];
  onClose: () => void;
  onSave: (draft: typeof EMPTY_LEAD_DRAFT & { interestedCourseIds: string[] }) => Promise<void>;
}) {
  const [draft, setDraft] = useState({ ...EMPTY_LEAD_DRAFT });
  const [selectedCourses, setSelectedCourses] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [dupInfo, setDupInfo] = useState<{ name: string; status: LeadStatus } | null>(null);

  const set = (k: keyof typeof EMPTY_LEAD_DRAFT, v: string) =>
    setDraft(d => ({ ...d, [k]: v }));

  const toggleCourse = (id: string) =>
    setSelectedCourses(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

  const handleSubmit = async (overrideDup = false) => {
    if (!draft.name.trim()) return setErr('الاسم مطلوب');
    if (!draft.phone.trim()) return setErr('رقم الهاتف مطلوب');
    if (!draft.branch) return setErr('الفرع مطلوب — اختر الفرع أولاً');
    if (!overrideDup) {
      const normalise = (p?: string | null) => (p || '').replace(/\D/g, '');
      const draftPhone = normalise(draft.phone);
      const dup = leads.find(l => !l.hidden && draftPhone.length >= 7 && normalise(l.phone) === draftPhone);
      if (dup) { setDupInfo({ name: dup.name, status: dup.status }); return; }
    }
    setDupInfo(null);
    setSaving(true);
    setErr('');
    try {
      await onSave({ ...draft, interestedCourseIds: selectedCourses });
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden" dir="rtl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-l from-primary-50 to-white">
          <div className="flex items-center gap-2">
            <UserPlus size={18} className="text-primary-600" />
            <h3 className="font-bold text-gray-900">إضافة ليد جديد</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {err && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">{err}</div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-bold text-gray-600 mb-1 block">الاسم *</label>
              <input value={draft.name} onChange={e => set('name', e.target.value)}
                placeholder="اسم العميل"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">رقم الهاتف *</label>
              <input value={draft.phone} onChange={e => set('phone', e.target.value)}
                placeholder="01XXXXXXXXX" dir="ltr"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">البريد الإلكتروني</label>
              <input value={draft.email} onChange={e => set('email', e.target.value)}
                placeholder="example@email.com" dir="ltr"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">مستوى الاهتمام</label>
              <div className="flex gap-1.5">
                {(['high', 'medium', 'low'] as const).map(il => (
                  <button key={il} onClick={() => set('interestLevel', il)}
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
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">مصدر الليد</label>
              <select value={draft.source} onChange={e => set('source', e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white">
                <option value="">—</option>
                {sources.map(src => <option key={src} value={src}>{src}</option>)}
              </select>
            </div>
          </div>

          {/* Branch — required */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">
              🏢 الفرع <span className="text-red-500">*</span>
            </label>
            <select
              value={draft.branch}
              onChange={e => set('branch', e.target.value)}
              className={`w-full border rounded-xl px-3 py-2 text-sm bg-white ${!draft.branch ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
            >
              <option value="">— اختر الفرع (مطلوب) *</option>
              {(branches.length > 0
                ? branches
                : Object.entries(BRANCH_ENUM_LABELS).map(([id, label]) => ({ id, label }))
              ).map(b => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>

          {salesReps.length > 0 && (
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">تعيين لمندوب</label>
              <select value={draft.autoAssign ? '__auto__' : draft.assignedSalesId}
                onChange={e => {
                  if (e.target.value === '__auto__') {
                    setDraft(d => ({ ...d, autoAssign: true, assignedSalesId: '' }));
                  } else {
                    setDraft(d => ({ ...d, autoAssign: false, assignedSalesId: e.target.value }));
                  }
                }}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                <option value="">— غير معين</option>
                <option value="__auto__">🤖 توزيع تلقائي (الأقل تحميلاً)</option>
                <option value="__rr__">🔄 Round-Robin (بالتسلسل)</option>
                {salesReps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {draft.autoAssign && (
                <p className="text-xs text-emerald-600 mt-1">✓ سيتم تعيين الليد تلقائياً للمندوب الأقل عبئاً</p>
              )}
              {draft.assignedSalesId === '__rr__' && (
                <p className="text-xs text-blue-600 mt-1">🔄 سيتم التوزيع بالتسلسل بين المندوبين</p>
              )}
            </div>
          )}

          {/* Interested courses + bundles — scrollable checkbox list */}
          {(courses.length > 0 || bundles.length > 0) && (
            <div>
              <label className="text-xs font-bold text-gray-600 mb-1 block">الكورسات والمسارات المهتم بها</label>
              <div className="border border-gray-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                {courses.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-wide sticky top-0">كورسات</div>
                    {courses.map(c => (
                      <label key={c.id} className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-blue-50 transition border-b border-gray-50 last:border-0 ${selectedCourses.includes(c.id) ? 'bg-blue-50' : ''}`}>
                        <input type="checkbox" checked={selectedCourses.includes(c.id)} onChange={() => toggleCourse(c.id)} className="accent-primary-600 w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-sm text-gray-800">{c.title}</span>
                      </label>
                    ))}
                  </>
                )}
                {bundles.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 bg-teal-50 border-b border-teal-100 text-[10px] font-bold text-teal-600 uppercase tracking-wide sticky top-0">مسارات تعليمية</div>
                    {bundles.map(b => (
                      <label key={b.id} className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-teal-50 transition border-b border-gray-50 last:border-0 ${selectedCourses.includes(b.id) ? 'bg-teal-50' : ''}`}>
                        <input type="checkbox" checked={selectedCourses.includes(b.id)} onChange={() => toggleCourse(b.id)} className="accent-teal-600 w-3.5 h-3.5 flex-shrink-0" />
                        <span className="text-sm text-gray-800">📚 {b.title}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
              {selectedCourses.length > 0 && (
                <p className="text-[11px] text-primary-600 font-medium mt-1">✓ {selectedCourses.length} {selectedCourses.length === 1 ? 'عنصر مختار' : 'عناصر مختارة'}</p>
              )}
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظات</label>
            <textarea value={draft.notes} onChange={e => set('notes', e.target.value)}
              rows={2} placeholder="أي تفاصيل إضافية..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block flex items-center gap-1">
              <Tag size={11} /> تصنيفات
            </label>
            <TagInput tags={draft.tags} onChange={tags => setDraft(d => ({ ...d, tags }))} />
          </div>

          {/* Duplicate warning */}
          {dupInfo && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3">
              <p className="text-xs font-bold text-amber-800">⚠️ رقم الهاتف موجود بالفعل!</p>
              <p className="text-xs text-amber-700 mt-0.5">الليد: <strong>{dupInfo.name}</strong> — {STATUS_CFG[dupInfo.status].label}</p>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={() => handleSubmit(true)}
                  className="text-xs bg-amber-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-amber-700 transition">
                  إضافة رغم ذلك
                </button>
                <button type="button" onClick={() => setDupInfo(null)}
                  className="text-xs bg-gray-100 px-3 py-1.5 rounded-lg text-gray-700 hover:bg-gray-200 transition">
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={() => handleSubmit()} disabled={saving}
            className="flex-1 bg-primary-600 text-white py-2.5 rounded-xl font-bold hover:bg-primary-700 transition disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Plus size={16} />}
            {saving ? 'جاري الحفظ...' : 'حفظ الليد'}
          </button>
          <button onClick={onClose} className="px-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ── Bulk WhatsApp Modal ───────────────────────────────────────────────────────
export function BulkWhatsAppModal({ selectedLeads, onClose, notify }: {
  selectedLeads: LeadItem[];
  onClose: () => void;
  notify: NotifyFn;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  const handleSend = async () => {
    if (!message.trim()) return;
    setSending(true);
    try {
      const phones = selectedLeads.map(l => l.phone).filter(Boolean);
      const r = await mysqlAdmin.sendWhatsAppBulk(phones, message.trim());
      setResult({ sent: r.sent, failed: r.failed });
      notify('success', `تم إرسال ${r.sent} رسالة بنجاح`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'فشل الإرسال');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-emerald-50">
          <h3 className="font-bold text-gray-900 flex items-center gap-2">
            💬 إرسال واتساب جماعي ({selectedLeads.length} عميل)
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {result ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-2">✅</div>
              <p className="font-bold text-gray-900">تم الإرسال!</p>
              <p className="text-sm text-gray-500 mt-1">مُرسَل: {result.sent} · فشل: {result.failed}</p>
              <button onClick={onClose} className="mt-4 bg-primary-600 text-white px-6 py-2 rounded-xl font-bold">إغلاق</button>
            </div>
          ) : (
            <>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-gray-600 max-h-24 overflow-y-auto">
                {selectedLeads.slice(0, 5).map(l => (
                  <span key={l.id} className="inline-block bg-white border border-gray-200 rounded-full px-2 py-0.5 text-xs mr-1 mb-1">{l.name} ({l.phone})</span>
                ))}
                {selectedLeads.length > 5 && <span className="text-xs text-gray-400">+{selectedLeads.length - 5} آخرين</span>}
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">نص الرسالة *</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)}
                  rows={5} placeholder="اكتب الرسالة هنا..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
                <p className="text-xs text-gray-400 mt-1">{message.length} حرف</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handleSend} disabled={sending || !message.trim()}
                  className="flex-1 bg-emerald-600 text-white py-2.5 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-2">
                  {sending ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : '💬'}
                  {sending ? 'جاري الإرسال...' : 'إرسال'}
                </button>
                <button onClick={onClose} className="px-4 bg-gray-100 text-gray-700 rounded-xl">إلغاء</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CSV Import Button ─────────────────────────────────────────────────────────
export function CsvImportButton({ notify, onImported }: { notify: NotifyFn; onImported: () => void }) {
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      // Parse CSV — first line is header
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) throw new Error('الملف فارغ أو لا يحتوي بيانات');
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const leads = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = vals[i] || ''; });
        return {
          name: row['name'] || row['الاسم'] || row['اسم'] || '',
          phone: row['phone'] || row['هاتف'] || row['رقم الهاتف'] || row['mobile'] || '',
          email: row['email'] || row['بريد'] || '',
          source: row['source'] || row['المصدر'] || 'استيراد CSV',
          notes: row['notes'] || row['ملاحظات'] || '',
        };
      }).filter(l => l.name && l.phone);

      if (leads.length === 0) throw new Error('لم يتم العثور على أعمدة name/phone');
      const r = await mysqlAdmin.importLeads(leads);
      notify('success', `تم استيراد ${r.imported} ليد · تخطي: ${r.skipped}`);
      onImported();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'فشل الاستيراد');
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      <button onClick={() => inputRef.current?.click()} disabled={loading}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition disabled:opacity-60">
        {loading ? <span className="w-4 h-4 border-2 border-indigo-400 border-t-indigo-700 rounded-full animate-spin" /> : <Upload size={15} />}
        استيراد CSV
      </button>
    </>
  );
}

// ── WhatsApp Per-Rep Modal ───────────────────────────────────────────────────
export function WhatsAppRepModal({ rep, leads, onClose, notify }: {
  rep: { id: string; name: string };
  leads: LeadItem[];
  onClose: () => void;
  notify: NotifyFn;
}) {
  const storageKey = `wa_rep_${rep.id}`;
  const stored = useMemo(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; } }, [storageKey]);
  const [instanceId, setInstanceId] = useState<string>(stored.instanceId || '');
  const [apiToken, setApiToken] = useState<string>(stored.apiToken || '');
  const [view, setView] = useState<'setup' | 'inbox' | 'send'>('setup');
  const [chats, setChats] = useState<Array<{ id: string; name?: string; lastMessage?: { textMessage?: string } }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ type: string; textMessage?: string; timestamp?: number }>>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [sendPhone, setSendPhone] = useState('');
  const [sendMsg, setSendMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [saved, setSaved] = useState(!!stored.instanceId);

  const saveCredentials = () => {
    localStorage.setItem(storageKey, JSON.stringify({ instanceId, apiToken }));
    setSaved(true);
    notify('success', `تم حفظ بيانات واتساب لـ ${rep.name}`);
  };

  const loadChats = async () => {
    if (!instanceId || !apiToken) { notify('error', 'أدخل بيانات الاتصال أولاً'); return; }
    setChatLoading(true);
    try {
      const data = await mysqlAdmin.waProxyChats(instanceId, apiToken);
      setChats(Array.isArray(data) ? (data as typeof chats).slice(0, 40) : []);
    } catch { notify('error', 'فشل — تأكد من صحة بيانات الاتصال'); }
    finally { setChatLoading(false); }
  };

  const loadHistory = async (chatId: string) => {
    setHistLoading(true);
    try {
      const data = await mysqlAdmin.waProxyChatHistory(instanceId, apiToken, chatId, 30);
      setHistory(Array.isArray(data) ? (data as typeof history) : []);
      setSelectedChatId(chatId);
    } catch { notify('error', 'فشل تحميل الرسائل'); }
    finally { setHistLoading(false); }
  };

  const handleSend = async () => {
    if (!sendPhone.trim() || !sendMsg.trim()) return;
    if (!instanceId || !apiToken) { notify('error', 'أدخل بيانات الاتصال أولاً'); return; }
    setSending(true);
    try {
      await mysqlAdmin.waProxySend(instanceId, apiToken, sendPhone.trim(), sendMsg.trim());
      notify('success', 'تم إرسال الرسالة بنجاح');
      setSendMsg('');
    } catch (e) { notify('error', e instanceof Error ? e.message : 'فشل الإرسال'); }
    finally { setSending(false); }
  };

  const VIEWS: Array<['setup' | 'inbox' | 'send', string, React.ElementType]> = [
    ['setup', 'الإعداد', Link2],
    ['inbox', 'البريد الوارد', Inbox],
    ['send', 'إرسال رسالة', MessageSquare],
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden max-h-[88vh] flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-l from-emerald-50 to-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-100 rounded-full flex items-center justify-center">
              <MessageSquare size={18} className="text-emerald-600" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">واتساب شخصي — {rep.name}</h3>
              <p className="text-xs text-gray-500">إرسال واستقبال من رقمك الخاص</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-gray-100 flex-shrink-0">
          {VIEWS.map(([v, lbl, Ic]) => (
            <button key={v}
              onClick={() => { setView(v); if (v === 'inbox' && chats.length === 0) loadChats(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-bold transition border-b-2 ${
                view === v ? 'border-emerald-500 text-emerald-700 bg-emerald-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              <Ic size={14} /> {lbl}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* SETUP */}
          {view === 'setup' && (
            <div className="p-5 space-y-4 overflow-y-auto">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-xs font-bold text-amber-800 mb-2">📱 كيفية الإعداد:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs text-amber-700">
                  <li>اذهب إلى <strong>green-api.com</strong> — أنشئ Instance مجاني واربطه بهاتفك</li>
                  <li>انسخ <strong>Instance ID</strong> و<strong>API Token</strong> من لوحة التحكم</li>
                  <li>الصقهما هنا واضغط حفظ ✅</li>
                </ol>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">Instance ID</label>
                  <input value={instanceId} onChange={e => setInstanceId(e.target.value)}
                    placeholder="1234567890" dir="ltr"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">API Token</label>
                  <input value={apiToken} onChange={e => setApiToken(e.target.value)}
                    type="password" placeholder="••••••••••" dir="ltr"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono" />
                </div>
              </div>
              <button onClick={saveCredentials}
                className="w-full bg-emerald-600 text-white py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition flex items-center justify-center gap-2">
                <Link2 size={16} /> {saved ? '✓ تحديث بيانات الاتصال' : 'ربط الواتساب'}
              </button>
              {saved && (
                <p className="text-center text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl">
                  ✅ الواتساب مربوط — استخدم تبويبي الإرسال والبريد الوارد
                </p>
              )}
            </div>
          )}

          {/* INBOX */}
          {view === 'inbox' && (
            <div className="flex-1 flex overflow-hidden" style={{ minHeight: 0 }}>
              {/* Chats list */}
              <div className="w-64 flex-shrink-0 border-l border-gray-100 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
                  <span className="text-xs font-bold text-gray-600">{chats.length} محادثة</span>
                  <button onClick={loadChats} className="text-xs text-primary-600 hover:text-primary-800 font-bold">تحديث</button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {chatLoading && <div className="flex justify-center py-10"><span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>}
                  {!chatLoading && chats.length === 0 && (
                    <div className="text-center py-10">
                      <Inbox size={28} className="text-gray-300 mx-auto mb-2" />
                      <p className="text-xs text-gray-400">لا توجد محادثات</p>
                      <button onClick={loadChats} className="mt-2 text-xs text-primary-600 font-bold">تحميل</button>
                    </div>
                  )}
                  {chats.map(chat => (
                    <button key={chat.id} onClick={() => loadHistory(chat.id)}
                      className={`w-full text-right px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition ${
                        selectedChatId === chat.id ? 'bg-emerald-50 border-r-2 border-r-emerald-500' : ''
                      }`}>
                      <p className="text-xs font-bold text-gray-900 truncate">{chat.name || chat.id.replace('@c.us', '').replace('@g.us', ' (مجموعة)')}</p>
                      {chat.lastMessage?.textMessage && (
                        <p className="text-[10px] text-gray-400 truncate mt-0.5">{chat.lastMessage.textMessage}</p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              {/* Message history */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {!selectedChatId ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-2">
                    <MessageSquare size={32} className="text-gray-200" />
                    <p className="text-sm text-gray-400">اختر محادثة من القائمة</p>
                  </div>
                ) : histLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
                    {history.length === 0 && <p className="text-center text-xs text-gray-400 py-10">لا توجد رسائل</p>}
                    {history.map((msg, i) => (
                      <div key={i} className={`flex ${msg.type === 'outgoing' ? 'justify-start' : 'justify-end'}`}>
                        <div className={`max-w-xs px-3 py-2 rounded-2xl text-xs shadow-sm ${
                          msg.type === 'outgoing' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-800 border border-gray-200'
                        }`}>
                          <p className="leading-relaxed">{msg.textMessage || '[رسالة غير نصية]'}</p>
                          {msg.timestamp && (
                            <p className={`text-[10px] mt-1 ${msg.type === 'outgoing' ? 'text-emerald-100' : 'text-gray-400'}`}>
                              {new Date(msg.timestamp * 1000).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SEND */}
          {view === 'send' && (
            <div className="p-5 space-y-4 overflow-y-auto">
              {!saved && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 text-center font-bold">
                  ⚠️ قم بإعداد بيانات الاتصال في تبويب "الإعداد" أولاً
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">رقم الهاتف</label>
                <div className="flex gap-2">
                  <input value={sendPhone} onChange={e => setSendPhone(e.target.value)}
                    placeholder="01XXXXXXXXX" dir="ltr"
                    className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
                  <select onChange={e => e.target.value && setSendPhone(e.target.value)}
                    className="border border-gray-200 rounded-xl px-2 py-2 text-xs bg-white">
                    <option value="">— اختر ليد</option>
                    {leads.filter(l => l.assignedSalesId === rep.id && l.phone).slice(0, 80).map(l => (
                      <option key={l.id} value={l.phone}>{l.name} ({l.phone})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 mb-1 block">نص الرسالة</label>
                <textarea value={sendMsg} onChange={e => setSendMsg(e.target.value)}
                  rows={5} placeholder="اكتب رسالتك هنا..."
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" />
              </div>
              <button onClick={handleSend} disabled={sending || !sendPhone.trim() || !sendMsg.trim()}
                className="w-full bg-emerald-600 text-white py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition disabled:opacity-60 flex items-center justify-center gap-2">
                {sending ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <MessageSquare size={16} />}
                {sending ? 'جارٍ الإرسال...' : 'إرسال عبر واتسابك الشخصي'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

