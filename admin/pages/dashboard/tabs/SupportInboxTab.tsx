import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw, Inbox, Mail, LifeBuoy, Clock, AlertTriangle, ArrowUpCircle, Send, CheckCircle2, X, User, Link2, ArrowRightLeft, BarChart3, Trash2, ExternalLink, RotateCcw, Star } from 'lucide-react';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

interface InboxTicket {
  id: string; subject: string; subscriber_name: string | null; subscriber_email: string | null;
  status: string; priority: string; category: string; department: string | null; channel: string;
  assigned_to: string | null; assignee_name: string | null; sla_due_at: string | null;
  first_response_at: string | null; escalated_at: string | null; created_at: string;
  reply_count: number; sla: string; kind: 'ticket';
}
interface InboxContact {
  id: string; subject: string; subscriber_name: string | null; subscriber_email: string | null;
  phone: string | null; preview: string; status: string; priority: string; created_at: string; kind: 'contact';
}
type CatMeta = Record<string, { label: string; department: string; priority: string }>;
interface Stats {
  counts: { open: number; in_progress: number; closed: number; overdue: number; avg_first_response_min: number | null };
  byDept?: { department: string; total: number; open: number }[];
  workload?: { id: string; name: string; role: string; open_tickets: number; closed_tickets: number }[];
}

interface TicketDetail extends InboxTicket {
  body: string; closed_reason: string | null;
  replies: { id: string; author_type: string; author_name: string; body: string; created_at: string }[];
  timeline: { event_type: string; actor_name: string | null; from_value: string | null; to_value: string | null; detail: string | null; created_at: string }[];
  linked: null | { type: string; id?: string; name?: string; email?: string; phone?: string; client_code?: string; amount?: number; currency?: string; payment_type?: string };
}

// SLA badge presentation.
const SLA_BADGE: Record<string, { label: string; cls: string }> = {
  overdue:   { label: 'متأخرة', cls: 'bg-red-100 text-red-700' },
  due_soon:  { label: 'تقترب',  cls: 'bg-amber-100 text-amber-700' },
  ontime:    { label: 'ضمن الوقت', cls: 'bg-emerald-50 text-emerald-600' },
  answered:  { label: 'تم الرد', cls: 'bg-blue-50 text-blue-600' },
  closed:    { label: 'مغلقة',  cls: 'bg-gray-100 text-gray-500' },
};
const STATUS_LABEL: Record<string, string> = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'محلولة', closed: 'مغلقة' };
const PRIO_CLS: Record<string, string> = { high: 'bg-rose-100 text-rose-700', urgent: 'bg-red-200 text-red-800', medium: 'bg-sky-100 text-sky-700', low: 'bg-gray-100 text-gray-500' };
const fmt = (s: string | null) => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

function StatCards({ s }: { s: Stats | null }) {
  const c = s?.counts;
  const cards: [string, number | string, string][] = [
    ['مفتوحة', c?.open ?? 0, 'text-indigo-600 bg-indigo-50'],
    ['قيد المعالجة', c?.in_progress ?? 0, 'text-sky-600 bg-sky-50'],
    ['متأخرة (SLA)', c?.overdue ?? 0, 'text-red-600 bg-red-50'],
    ['محلولة', c?.closed ?? 0, 'text-emerald-600 bg-emerald-50'],
    ['متوسط أول رد', c?.avg_first_response_min != null ? `${Math.round(c.avg_first_response_min)}د` : '—', 'text-violet-600 bg-violet-50'],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
      {cards.map(([lbl, val, cls]) => (
        <div key={lbl} className={`rounded-xl p-3 text-center border border-gray-100 ${cls.split(' ')[1]}`}>
          <div className={`text-2xl font-extrabold ${cls.split(' ')[0]}`}>{val}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{lbl}</div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsPanel({ s, depts }: { s: Stats | null; depts: Record<string, string> }) {
  const byDept = (s?.byDept || []).filter(d => d.department && d.department !== '—').sort((a, b) => b.open - a.open);
  const workload = (s?.workload || []).slice(0, 6);
  const maxDept = Math.max(1, ...byDept.map(d => Number(d.total)));
  const c = s?.counts;
  const resolutionRate = c && (Number(c.open) + Number(c.in_progress) + Number(c.closed)) > 0
    ? Math.round(Number(c.closed) / (Number(c.open) + Number(c.in_progress) + Number(c.closed)) * 100) : null;
  if (!byDept.length && !workload.length) return null;
  return (
    <details className="bg-white border border-gray-100 rounded-2xl p-3 group">
      <summary className="cursor-pointer text-xs font-bold text-gray-600 flex items-center gap-2 select-none list-none">
        <BarChart3 size={14} className="text-indigo-500" /> تحليلات خدمة العملاء
        {resolutionRate != null && <span className="mr-auto text-[11px] text-emerald-600">معدل الحل {resolutionRate}%</span>}
      </summary>
      <div className="grid md:grid-cols-2 gap-4 mt-3">
        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1.5">الحِمل حسب القسم (مفتوح / إجمالي)</div>
          <div className="space-y-1.5">
            {byDept.map(d => (
              <div key={d.department} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-600 w-16 shrink-0">{depts[d.department] || d.department}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                  <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(Number(d.total) / maxDept) * 100}%` }} />
                </div>
                <span className="text-[11px] text-gray-500 w-12 text-left shrink-0">{d.open}/{d.total}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-bold text-gray-500 mb-1.5">حِمل الوكلاء (تذاكر مفتوحة)</div>
          <div className="space-y-1.5">
            {workload.map(w => (
              <div key={w.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-gray-700 flex-1 truncate">{w.name}</span>
                <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 font-bold">{w.open_tickets} مفتوح</span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">{w.closed_tickets} محلول</span>
              </div>
            ))}
            {!workload.length && <p className="text-[11px] text-gray-400">لا يوجد وكلاء مُسندة إليهم تذاكر</p>}
          </div>
        </div>
      </div>
    </details>
  );
}

function TicketRow({ t, onClick }: { t: InboxTicket; onClick: () => void }) {
  const sla = SLA_BADGE[t.sla];
  return (
    <div onClick={onClick} role="button"
      className="flex items-start gap-3 p-3.5 cursor-pointer hover:bg-indigo-50 transition">
      <span className="mt-0.5 w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-rose-50 text-rose-600"><LifeBuoy size={15} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-gray-800 text-sm">{t.subscriber_name || t.subscriber_email || '—'}</span>
          {sla && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${sla.cls}`}>{sla.label}</span>}
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${PRIO_CLS[t.priority] || PRIO_CLS.medium}`}>{t.priority}</span>
          {t.escalated_at && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 flex items-center gap-0.5"><ArrowUpCircle size={9} />مُصعّدة</span>}
          <span className="text-[10px] text-gray-400">{fmt(t.created_at)}</span>
        </div>
        <p className="text-sm text-gray-700 truncate">{t.subject}</p>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-400 flex-wrap">
          <span className="px-1.5 py-0.5 rounded bg-gray-100">{STATUS_LABEL[t.status] || t.status}</span>
          {t.assignee_name && <span className="flex items-center gap-0.5"><User size={10} />{t.assignee_name}</span>}
          {t.reply_count > 0 && <span>{t.reply_count} رد</span>}
        </div>
      </div>
    </div>
  );
}

export default function SupportInboxTab({ onOpen, notify }: { onOpen?: (tab: string) => void; notify?: Notify }) {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<InboxTicket[]>([]);
  const [contacts, setContacts] = useState<InboxContact[]>([]);
  const [cats, setCats] = useState<CatMeta>({});
  const [depts, setDepts] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ department: '', category: '', status: 'open', sla: '', q: '' });
  const [sel, setSel] = useState<TicketDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  void onOpen;

  // Canned (admin-managed) reply templates
  const [canned, setCanned] = useState<{ id: string; title: string; body: string; category: string }[]>([]);
  const [showCanned, setShowCanned] = useState(false);
  const [cannedManageOpen, setCannedManageOpen] = useState(false);
  const [cannedDraft, setCannedDraft] = useState<{ id?: string; title: string; body: string }>({ title: '', body: '' });
  const loadCanned = useCallback(() => {
    fetch('/api/admin/support/canned-responses', { credentials: 'include' })
      .then(r => r.json()).then(rows => setCanned(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, []);
  useEffect(() => { loadCanned(); }, [loadCanned]);
  const saveCanned = async () => {
    if (!cannedDraft.title.trim() || !cannedDraft.body.trim()) { notify?.('error', 'العنوان والنص مطلوبان'); return; }
    const url = cannedDraft.id ? `/api/admin/support/canned-responses/${cannedDraft.id}` : '/api/admin/support/canned-responses';
    try {
      const r = await fetch(url, { method: cannedDraft.id ? 'PUT' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: cannedDraft.title, body: cannedDraft.body }) });
      if (!r.ok) throw new Error();
      setCannedDraft({ title: '', body: '' }); loadCanned(); notify?.('success', 'تم الحفظ');
    } catch { notify?.('error', 'تعذر الحفظ'); }
  };
  const deleteCanned = async (id: string) => {
    try { await fetch(`/api/admin/support/canned-responses/${id}`, { method: 'DELETE', credentials: 'include' }); loadCanned(); } catch { notify?.('error', 'تعذر الحذف'); }
  };

  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/cs/inbox?${qs}`, { credentials: 'include' }).then(r => r.json()),
      fetch('/api/admin/cs/stats', { credentials: 'include' }).then(r => r.json()),
    ]).then(([inbox, st]) => {
      setTickets(inbox.tickets || []); setContacts(inbox.contacts || []);
      setCats(inbox.categories || {}); setDepts(inbox.departments || {}); setStats(st);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [qs]);
  useEffect(() => { load(); }, [load]);

  const openTicket = (id: string) => {
    fetch(`/api/admin/tickets/${id}`, { credentials: 'include' }).then(r => r.json()).then(setSel).catch(() => {});
  };
  const sendReply = async () => {
    if (!sel || !reply.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/tickets/${sel.id}/reply`, { credentials: 'include', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: reply }) });
      if (!r.ok) throw new Error();
      setReply(''); notify?.('success', 'تم إرسال الرد'); openTicket(sel.id); load();
    } catch { notify?.('error', 'فشل الإرسال'); } finally { setBusy(false); }
  };
  const putJson = async (url: string, body: object, ok: string) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      notify?.('success', ok); if (sel) openTicket(sel.id); load();
    } catch { notify?.('error', 'فشل تنفيذ العملية'); } finally { setBusy(false); }
  };
  const postJson = async (url: string, body: object, ok: string) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      notify?.('success', ok); if (sel) openTicket(sel.id); load();
    } catch { notify?.('error', 'فشل تنفيذ العملية'); } finally { setBusy(false); }
  };
  const convertContact = (id: string, category: string) =>
    postJson(`/api/admin/cs/contact/${id}/convert`, { category }, 'تم تحويل الرسالة إلى تذكرة');
  const goToCustomer = () => {
    if (sel?.linked?.type === 'subscriber' && sel.linked.client_code) navigate(`/client/${sel.linked.client_code}`);
    else notify?.('info', 'لا يوجد عميل مسجّل مرتبط بهذه التذكرة');
  };
  const transferToRefund = async () => {
    if (!sel) return;
    if (sel.linked?.type !== 'subscriber' || !sel.linked.id) { notify?.('error', 'لا يمكن إنشاء استرداد — لا يوجد عميل مسجّل مرتبط بهذه التذكرة'); return; }
    if (!window.confirm(`إنشاء طلب استرداد للعميل ${sel.linked.name || ''} من هذه التذكرة؟`)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/admin/refund-requests/by-admin', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriber_id: sel.linked.id, amount: 0, reason: `محوّل من تذكرة دعم: ${sel.subject}` }),
      });
      if (!r.ok) throw new Error();
      await putJson(`/api/admin/tickets/${sel.id}/route`, { category: 'refund' }, 'تم إنشاء طلب استرداد وتحويل التذكرة');
    } catch { notify?.('error', 'تعذر إنشاء طلب الاسترداد'); } finally { setBusy(false); }
  };
  const deleteTicket = async () => {
    if (!sel) return;
    if (!window.confirm('حذف هذه التذكرة نهائياً؟ لا يمكن التراجع.')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/tickets/${sel.id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error();
      notify?.('success', 'تم حذف التذكرة'); setSel(null); load();
    } catch { notify?.('error', 'تعذر حذف التذكرة'); } finally { setBusy(false); }
  };
  const deleteContact = async (id: string) => {
    if (!window.confirm('حذف هذه الرسالة نهائياً؟')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/contact-messages/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) throw new Error();
      notify?.('success', 'تم حذف الرسالة'); load();
    } catch { notify?.('error', 'فشل الحذف'); } finally { setBusy(false); }
  };

  const Sel = ({ v, onChange, children, cls = '' }: { v: string; onChange: (v: string) => void; children: React.ReactNode; cls?: string }) => (
    <select value={v} onChange={e => onChange(e.target.value)} className={`text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white ${cls}`}>{children}</select>
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-extrabold text-gray-800 text-base flex items-center gap-2"><Inbox size={18} className="text-indigo-600" /> مركز خدمة العملاء</h3>
        <button onClick={load} className="text-xs text-indigo-600 hover:underline flex items-center gap-1"><RefreshCw size={12} /> تحديث</button>
      </div>

      <StatCards s={stats} />
      <AnalyticsPanel s={stats} depts={depts} />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap bg-white border border-gray-100 rounded-xl p-2">
        <Sel v={f.department} onChange={v => setF({ ...f, department: v })}><option value="">كل الأقسام</option>{Object.entries(depts).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Sel>
        <Sel v={f.category} onChange={v => setF({ ...f, category: v })}><option value="">كل التصنيفات</option>{Object.entries(cats).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</Sel>
        <Sel v={f.status} onChange={v => setF({ ...f, status: v })}><option value="">كل الحالات</option><option value="open">مفتوحة/قيد المعالجة</option><option value="resolved">محلولة</option><option value="closed">مغلقة</option></Sel>
        <Sel v={f.sla} onChange={v => setF({ ...f, sla: v })}><option value="">كل SLA</option><option value="overdue">متأخرة</option><option value="due_soon">تقترب</option><option value="ontime">ضمن الوقت</option></Sel>
        <input value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="بحث..." className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 flex-1 min-w-[120px]" />
        {loading && <Loader2 size={14} className="animate-spin text-indigo-500" />}
      </div>

      {/* Untriaged website contact messages → convert to routed ticket */}
      {contacts.length > 0 && (
        <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-3">
          <div className="flex items-center gap-2 mb-2 text-xs font-bold text-blue-700"><Mail size={14} /> رسائل تواصل غير مُصنّفة ({contacts.length}) — حوّلها لتذكرة موجّهة</div>
          <div className="space-y-2">
            {contacts.map(c => (
              <div key={c.id} className="bg-white rounded-xl p-3 border border-blue-100 shadow-sm">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-gray-800 text-sm">{c.subscriber_name || '—'}</span>
                      <span className="text-[10px] text-gray-400">{fmt(c.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-gray-500 flex-wrap">
                      {c.subscriber_email && <a href={`mailto:${c.subscriber_email}`} className="hover:text-indigo-600">{c.subscriber_email}</a>}
                      {c.phone && <a href={`https://wa.me/${String(c.phone).replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">📱 {c.phone}</a>}
                    </div>
                  </div>
                  <button onClick={() => deleteContact(c.id)} disabled={busy} title="حذف الرسالة"
                    className="text-gray-300 hover:text-red-500 shrink-0 p-1"><Trash2 size={15} /></button>
                </div>
                {c.subject && <p className="text-xs font-semibold text-gray-700 mt-1.5">{c.subject}</p>}
                <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{c.preview}</p>
                <div className="flex items-center gap-2 mt-2">
                  <select defaultValue="" onChange={e => e.target.value && convertContact(c.id, e.target.value)} disabled={busy}
                    className="text-[11px] border border-blue-200 rounded-lg px-2 py-1 bg-white text-blue-700">
                    <option value="">↳ حوّل إلى تذكرة…</option>
                    {Object.entries(cats).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ticket list */}
      {tickets.length === 0 && !loading ? (
        <div className="text-center py-12 text-gray-400"><Inbox size={40} className="mx-auto mb-2 text-gray-200" /><p>لا توجد تذاكر مطابقة</p></div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-2xl divide-y divide-gray-50">
          {tickets.map(t => <TicketRow key={t.id} t={t} onClick={() => openTicket(t.id)} />)}
        </div>
      )}

      {/* Ticket drawer */}
      {sel && (
        <div className="fixed inset-0 z-50 flex justify-start" dir="rtl">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSel(null)} />
          <div className="relative bg-white w-full max-w-lg h-full overflow-y-auto shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-extrabold text-gray-800">{sel.subject}</h4>
                <div className="flex items-center gap-2 flex-wrap mt-1 text-[11px]">
                  <span className={`px-1.5 py-0.5 rounded-full font-bold ${PRIO_CLS[sel.priority] || PRIO_CLS.medium}`}>{sel.priority}</span>
                  <span className="px-1.5 py-0.5 rounded bg-gray-100">{STATUS_LABEL[sel.status] || sel.status}</span>
                  {sel.department && <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">{depts[sel.department] || sel.department}</span>}
                  {sel.sla_due_at && <span className="text-gray-400 flex items-center gap-0.5"><Clock size={10} />استحقاق {fmt(sel.sla_due_at)}</span>}
                </div>
              </div>
              <button onClick={() => setSel(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
            </div>

            <div className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">{sel.body}</div>

            {sel.linked && (
              <div className="text-xs bg-emerald-50 border border-emerald-100 rounded-lg p-2.5 flex items-center gap-2 flex-wrap">
                <Link2 size={13} className="text-emerald-600 shrink-0" />
                <span className="text-emerald-800">
                  {sel.linked.type === 'payment' ? `دفعة ${sel.linked.amount} ${sel.linked.currency || ''} (${sel.linked.payment_type || ''})` : `عميل: ${sel.linked.name || ''} ${sel.linked.client_code ? '#' + sel.linked.client_code : ''} ${sel.linked.phone || ''}`}
                </span>
                {sel.linked.type === 'subscriber' && sel.linked.client_code && (
                  <button onClick={goToCustomer} className="mr-auto flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-bold underline shrink-0">
                    <ExternalLink size={12} /> ملف العميل
                  </button>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap border-y border-gray-100 py-3">
              <Sel v={sel.category} onChange={v => putJson(`/api/admin/tickets/${sel.id}/route`, { category: v }, 'تمت إعادة التوجيه')} cls="!py-1">
                {Object.entries(cats).map(([k, m]) => <option key={k} value={k}>↦ {m.label}</option>)}
              </Sel>
              {sel.status !== 'in_progress' && <button disabled={busy} onClick={() => putJson(`/api/admin/tickets/${sel.id}/status`, { status: 'in_progress' }, 'قيد المعالجة')} className="text-xs px-2.5 py-1.5 rounded-lg bg-sky-100 text-sky-700 font-bold">قيد المعالجة</button>}
              <button disabled={busy} onClick={() => putJson(`/api/admin/tickets/${sel.id}/status`, { status: 'resolved' }, 'تم الحل')} className="text-xs px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-700 font-bold flex items-center gap-1"><CheckCircle2 size={12} />حل</button>
              <button disabled={busy} onClick={() => putJson(`/api/admin/tickets/${sel.id}/status`, { status: 'closed' }, 'تم الإغلاق')} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-bold">إغلاق</button>
              {!sel.escalated_at && <button disabled={busy} onClick={() => postJson(`/api/admin/tickets/${sel.id}/escalate`, {}, 'تم التصعيد للإدارة')} className="text-xs px-2.5 py-1.5 rounded-lg bg-purple-100 text-purple-700 font-bold flex items-center gap-1"><AlertTriangle size={12} />تصعيد</button>}
              {sel.category !== 'refund' && <button disabled={busy} onClick={transferToRefund} className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-100 text-amber-700 font-bold flex items-center gap-1"><RotateCcw size={12} />نقل للاسترداد</button>}
              <button disabled={busy} onClick={deleteTicket} className="text-xs px-2.5 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 font-bold mr-auto flex items-center gap-1"><Trash2 size={12} />حذف</button>
            </div>

            {/* Timeline */}
            {sel.timeline?.length > 0 && (
              <div>
                <div className="text-[11px] font-bold text-gray-500 mb-1 flex items-center gap-1"><ArrowRightLeft size={12} />سجل الرحلة</div>
                <div className="space-y-1">
                  {sel.timeline.map((ev, i) => (
                    <div key={i} className="text-[11px] text-gray-500 flex items-center gap-2">
                      <span className="text-gray-300">{fmt(ev.created_at)}</span>
                      <span className="font-semibold text-gray-700">{ev.event_type}</span>
                      {ev.to_value && <span className="text-indigo-500">{ev.to_value}</span>}
                      {ev.actor_name && <span className="text-gray-400">— {ev.actor_name}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Replies */}
            <div className="space-y-2">
              {sel.replies?.map(r => (
                <div key={r.id} className={`text-sm rounded-lg p-2.5 ${r.author_type === 'staff' ? 'bg-indigo-50' : 'bg-gray-50'}`}>
                  <div className="text-[10px] text-gray-400 mb-0.5">{r.author_name} · {fmt(r.created_at)}</div>
                  <div className="text-gray-700 whitespace-pre-wrap">{r.body}</div>
                </div>
              ))}
            </div>

            {/* Canned responses picker */}
            {showCanned && (
              <div className="border border-gray-100 rounded-lg p-2 bg-gray-50 max-h-40 overflow-y-auto space-y-1">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[11px] text-gray-400">ردود جاهزة</span>
                  <button onClick={() => { setCannedManageOpen(true); setShowCanned(false); }} className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold">إدارة ⚙</button>
                </div>
                {canned.length === 0 ? (
                  <p className="text-[11px] text-gray-400 text-center py-2">لا توجد ردود جاهزة محفوظة</p>
                ) : canned.map(c => (
                  <button key={c.id} onClick={() => { setReply(c.body); setShowCanned(false); }}
                    className="w-full text-right text-xs px-3 py-1.5 bg-white hover:bg-indigo-50 rounded-lg text-gray-700 hover:text-indigo-700 transition-colors">
                    <span className="font-bold">{c.title}</span> — <span className="opacity-70">{c.body.slice(0, 50)}…</span>
                  </button>
                ))}
              </div>
            )}
            {/* Reply box */}
            <div className="flex items-end gap-2 sticky bottom-0 bg-white pt-2">
              <button onClick={() => setShowCanned(v => !v)} title="ردود جاهزة"
                className={`px-2 py-2 rounded-lg border text-xs transition-colors ${showCanned ? 'bg-indigo-50 border-indigo-300 text-indigo-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                <Star size={14} />
              </button>
              <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} placeholder="اكتب رداً..." className="flex-1 text-sm border border-gray-200 rounded-lg p-2 resize-none" />
              <button disabled={busy || !reply.trim()} onClick={sendReply} className="px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-40 flex items-center gap-1"><Send size={14} /></button>
            </div>
          </div>
        </div>
      )}
      <p className="text-[11px] text-gray-400 text-center">يوجّه كل مشكلة إلى القسم المناسب تلقائياً، يتتبّع زمن الاستجابة (SLA)، ويسجّل رحلة كل تذكرة عبر الأقسام.</p>

      {/* Canned responses management modal */}
      {cannedManageOpen && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => { setCannedManageOpen(false); setCannedDraft({ title: '', body: '' }); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">إدارة الردود الجاهزة</h3>
              <button onClick={() => { setCannedManageOpen(false); setCannedDraft({ title: '', body: '' }); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="space-y-2 border border-gray-100 rounded-xl p-3 bg-gray-50">
                <p className="text-xs font-semibold text-gray-500">{cannedDraft.id ? 'تعديل رد' : 'إضافة رد جديد'}</p>
                <input value={cannedDraft.title} onChange={e => setCannedDraft(d => ({ ...d, title: e.target.value }))}
                  placeholder="العنوان (مثال: تأكيد الحل)"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                <textarea value={cannedDraft.body} onChange={e => setCannedDraft(d => ({ ...d, body: e.target.value }))}
                  placeholder="نص الرد الجاهز..." rows={3}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
                <div className="flex gap-2">
                  <button onClick={saveCanned} className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-indigo-700">{cannedDraft.id ? 'حفظ التعديل' : 'إضافة'}</button>
                  {cannedDraft.id && <button onClick={() => setCannedDraft({ title: '', body: '' })} className="px-4 py-1.5 rounded-lg text-sm border border-gray-200 text-gray-600 hover:bg-gray-50">إلغاء</button>}
                </div>
              </div>
              <div className="space-y-1.5">
                {canned.length === 0 && <p className="text-center text-gray-400 text-sm py-4">لا توجد ردود محفوظة بعد</p>}
                {canned.map(c => (
                  <div key={c.id} className="flex items-start gap-2 border border-gray-100 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-gray-800">{c.title}</div>
                      <div className="text-xs text-gray-500 truncate">{c.body}</div>
                    </div>
                    <button onClick={() => setCannedDraft({ id: c.id, title: c.title, body: c.body })} className="text-xs text-indigo-600 hover:text-indigo-700 flex-shrink-0">تعديل</button>
                    <button onClick={() => deleteCanned(c.id)} className="text-xs text-red-500 hover:text-red-600 flex-shrink-0">حذف</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
