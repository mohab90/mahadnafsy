import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Award, BarChart2, Bell, BookOpen, CalendarPlus, CheckCheck, CheckCircle,
  ChevronDown, Clock, Columns, CreditCard, Download, ExternalLink, EyeOff, Eye,
  FolderKanban, Globe, Inbox, Link2, MapPin, MessageCircle, MessageSquare, MessageSquareText,
  Phone, Plus, RefreshCw, Search, Settings, Share2, Star, Tag, Trash2, TrendingUp,
  Upload, UserPlus, Wallet, X,
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
  AccessMode, CourseAccessSetting,
} from '../../../../types';
import { CrmSettingsModal, DEFAULT_CRM_SETTINGS } from '../CrmSettingsModal';
import PaymentModal, { PaymentDraft, blankPaymentDraft } from '../../../../components/PaymentModal';
import type { CrmSettings, NotifyFn } from '../CrmSettingsModal';
import { DEFAULT_SOURCES, ONLINE_EXCLUDED_SOURCES, isOnlineSource, EMPTY_LEAD_DRAFT } from '../crmConstants';
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
                              {new Date(msg.timestamp * 1000).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
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
export function LeadCard({ lead, score, onSelect, onStatusChange, onBook, onContact, instituteBranches, courses, bundles }: {
  lead: LeadItem;
  score: number;
  onSelect: () => void;
  onStatusChange: (status: LeadStatus) => void;
  onBook?: (lead: LeadItem) => void;
  onContact?: (lead: LeadItem) => void;
  instituteBranches: { id: string; label: string }[];
  courses: Course[];
  bundles: Bundle[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = !!(lead.nextFollowUpDate && lead.nextFollowUpDate < today);
  const daysOverdue = isOverdue
    ? Math.floor((Date.now() - new Date(lead.nextFollowUpDate!).getTime()) / 86_400_000)
    : 0;
  const lastComm = (lead.communications && lead.communications.length > 0)
    ? [...lead.communications].sort((a, b) => b.date.localeCompare(a.date))[0]
    : null;
  const waPhone = `https://wa.me/2${(lead.phone || '').replace(/^0/, '')}`;

  const rotLevel = getRottenLevel(lead);
  const rotCfg = ROTTEN_CFG[rotLevel];

  return (
    <div
      className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition cursor-pointer group overflow-hidden"
      onClick={onSelect}
      dir="rtl"
    >
      {/* Rotting decay strip at top */}
      {rotLevel > 0 && <div className={`h-1.5 w-full ${rotCfg.bar} rounded-t-xl`} />}
      <div className="p-3">
      {/* Name + Score */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="font-bold text-gray-900 text-sm leading-tight flex-1 min-w-0 truncate">{lead.name}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          {rotLevel > 0 && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${rotCfg.badge}`}>{rotCfg.label}</span>
          )}
          <ScoreBadge score={score} />
        </div>
      </div>

      {/* Phone */}
      <p className="text-xs text-gray-500 mb-1.5 font-mono" dir="ltr">{lead.phone}</p>

      {/* Sales + Branch + Interest row */}
      <div className="flex flex-wrap gap-1 mb-1.5">
        {lead.assignedSalesName && (
          <span className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded-full">
            <span className="w-3 h-3 bg-blue-200 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0">
              {lead.assignedSalesName.charAt(0)}
            </span>
            <span className="truncate max-w-[64px]">{lead.assignedSalesName}</span>
          </span>
        )}
        {getLeadBranchRaw(lead) && (
          <span className="inline-flex items-center text-[10px] bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-full">
            {(() => {
              const bn = (lead.branch || '').toUpperCase().replace(/[-\s]/g, '_');
              return instituteBranches.find(b => b.id.toUpperCase().replace(/[-\s]/g, '_') === bn)?.label
                || BRANCH_ENUM_LABELS[bn]
                || getLeadBranchRaw(lead);
            })()}
          </span>
        )}
        {lead.interestLevel && (
          <span className="text-[10px] text-gray-500">{IL_LABEL[lead.interestLevel]}</span>
        )}
      </div>

      {/* Interested courses */}
      {(lead.interestedCourseIds?.length || 0) > 0 && (
        <div className="flex flex-wrap gap-0.5 mb-1.5">
          {(lead.interestedCourseIds || []).slice(0, 2).map(id => {
            const resolvedId = id.startsWith('bundle:') ? id.replace('bundle:', '') : id;
            const cTitle = courses.find(c => c.id === id)?.title
              || bundles.find(b => b.id === resolvedId)?.title
              || bundles.find(b => b.id === id)?.title;
            if (!cTitle) return null;
            return (
              <span key={id} className="inline-flex items-center text-[9px] bg-primary-50 text-primary-700 border border-primary-200 px-1.5 py-0.5 rounded-full">
                🎓 {cTitle.length > 16 ? cTitle.slice(0, 16) + '…' : cTitle}
              </span>
            );
          })}
          {(lead.interestedCourseIds?.length || 0) > 2 && (
            <span className="text-[9px] text-gray-400">+{(lead.interestedCourseIds!.length) - 2}</span>
          )}
        </div>
      )}

      {/* Follow-up reminder */}
      {lead.nextFollowUpDate && (
        <div className={`inline-flex items-center gap-1 text-[10px] rounded-lg px-2 py-0.5 mb-1.5 ${
          isOverdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
        }`}>
          <Clock size={9} />
          {isOverdue ? `متأخر ${daysOverdue} يوم` : `متابعة: ${lead.nextFollowUpDate}`}
        </div>
      )}

      {/* Last communication block */}
      {lastComm ? (
        <div className="bg-gray-50 border border-gray-100 rounded-lg px-2 py-1.5 mb-1.5">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[11px]">{COMM_ICON[lastComm.type] || '📋'}</span>
            <span className="text-[10px] font-bold text-gray-700">{COMM_LABEL[lastComm.type] || lastComm.type}</span>
            <span className="mr-auto text-[9px] text-gray-400" dir="ltr">{lastComm.date?.slice(0, 10)}</span>
          </div>
          {lastComm.notes && (
            <p className="text-[10px] text-gray-600 leading-tight line-clamp-2">{lastComm.notes}</p>
          )}
          {lastComm.outcome && (
            <p className="text-[10px] text-emerald-600 mt-0.5">↩ {lastComm.outcome}</p>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-gray-300 italic mb-1.5">لا يوجد تواصل مسجل</p>
      )}

      {/* Tags */}
      {(lead.tags?.length || 0) > 0 && (
        <div className="flex flex-wrap gap-0.5 mb-1.5">
          {(lead.tags || []).slice(0, 3).map(tag => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-bold">{tag}</span>
          ))}
          {(lead.tags?.length || 0) > 3 && <span className="text-[9px] text-gray-400">+{(lead.tags?.length || 0) - 3}</span>}
        </div>
      )}

      {/* Meta row: comms count + source + date */}
      <div className="flex items-center gap-1.5 mb-2 text-[9px] text-gray-400">
        {(lead.communications?.length || 0) > 0 && (
          <span className="bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">
            {lead.communications!.length} تواصل
          </span>
        )}
        {lead.source && (
          <span className="bg-gray-50 border border-gray-100 px-1.5 py-0.5 rounded-full">{lead.source}</span>
        )}
        {lead.createdAt && (
          <span className="mr-auto">
            {new Date(lead.createdAt).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-1" onClick={e => e.stopPropagation()}>
        <select
          value={lead.status}
          onChange={e => onStatusChange(e.target.value as LeadStatus)}
          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1 bg-gray-50">
          {(Object.keys(STATUS_CFG) as LeadStatus[]).filter(s => s !== 'converted').map(s => (
            <option key={s} value={s}>{STATUS_CFG[s].label}</option>
          ))}
        </select>
        <div className="grid grid-cols-4 gap-0.5">
          <a href={waPhone} target="_blank" rel="noreferrer" title="واتساب"
            className="h-7 rounded-lg bg-gray-50 text-gray-400 hover:bg-green-50 hover:text-green-600 flex items-center justify-center transition">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
          </a>
          <button
            onClick={e => { e.stopPropagation(); if (onContact) onContact(lead); else window.location.href = `tel:${lead.phone}`; }}
            title="تسجيل اتصال"
            className="h-7 rounded-lg bg-gray-50 text-gray-400 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-center transition">
            <Phone size={13}/>
          </button>
          <button onClick={onSelect} title="تعديل / تفاصيل"
            className="h-7 rounded-lg bg-gray-50 text-gray-500 hover:bg-primary-50 hover:text-primary-600 flex items-center justify-center transition">
            <ExternalLink size={11}/>
          </button>
          {onBook && (
            <button onClick={() => onBook(lead)} title="حجز ودفع"
              className="h-7 rounded-lg bg-gray-50 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600 flex items-center justify-center transition">
              <Wallet size={11}/>
            </button>
          )}
        </div>
      </div>
      </div>{/* end p-3 */}
    </div>
  );
}

// ── Multi-select dropdown ────────────────────────────────────────────────────
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
