import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../../../shared/ui/Modal';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, ArrowUpCircle, CheckCircle2, Clock, ExternalLink, Inbox, Mail, MessageSquare,
  Plus, RefreshCw, RotateCcw, Search, Send, Star, Ticket, Trash2, UserCheck, X,
} from 'lucide-react';

import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import { promptDialog } from '../../../../shared/ui/promptDialog';
import { CAIRO_TIME_ZONE } from '../../../../shared/cairoDate';

// «محتاجين نطور صفحه تذاكر الدعم … تكون بخلاص صفحه الانبوكس اللى بتيجي المشاكل
// من الموقع لان نفس المشاكل كدا بتتعرض مرتين … ازرار اجراءات لكل مشكله وللادارة
// تقدر تحذف المشكله» (8 Oct 2026). One page now: every support ticket — the
// website's, a phone call's, one opened from a client's row in Dokki or online —
// and the website's «مشكلة تقنية» messages not yet made a ticket. The old
// «تذاكر الدعم» screen read the same tickets a second time; it is gone, and its
// links open this page.
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type InboxSource = 'ticket' | 'contact';
type InboxStatus = 'open' | 'pending' | 'done' | 'closed';

type InboxItem = {
  id: string;
  source: InboxSource;
  title: string;
  person: string;
  phone?: string;
  email?: string;
  clientCode?: string;
  detail?: string;
  status: InboxStatus;
  category?: string;
  priority: string;
  department?: string;
  assignedTo?: string;
  assigneeName?: string;
  sla?: string;
  escalated: boolean;
  replies: number;
  resolution?: string;
  createdAt?: string;
};

const STATUS_META: Record<InboxStatus, { label: string; cls: string }> = {
  open: { label: 'جديدة', cls: 'bg-amber-100 text-amber-800' },
  pending: { label: 'تحت المتابعة', cls: 'bg-blue-100 text-blue-800' },
  done: { label: 'اتحلت', cls: 'bg-emerald-100 text-emerald-800' },
  closed: { label: 'مقفولة', cls: 'bg-slate-100 text-slate-600' },
};
const CATEGORY_LABEL: Record<string, string> = {
  client_problem: 'مشكلة عميل', complaint: 'شكوى', technical: 'مشكلة تقنية', course_access: 'وصول للكورس',
  billing: 'مدفوعات', refund: 'استرداد', certificate: 'شهادات', consultation: 'استشارة',
  sales_inquiry: 'استفسار مبيعات', hr_inquiry: 'موارد بشرية', general: 'عام',
};
const PRIORITY_META: Record<string, { label: string; cls: string }> = {
  urgent: { label: 'عاجلة', cls: 'text-red-700' },
  high: { label: 'عالية', cls: 'text-orange-700' },
  medium: { label: 'متوسطة', cls: 'text-slate-600' },
  low: { label: 'منخفضة', cls: 'text-slate-400' },
};

function mapStatus(raw?: string): InboxStatus {
  const value = String(raw || '').toLowerCase();
  if (['resolved', 'replied', 'done'].includes(value)) return 'done';
  if (value === 'closed') return 'closed';
  if (['in_progress', 'inprogress', 'pending', 'read'].includes(value)) return 'pending';
  return 'open';
}

function fmtDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'short', timeStyle: 'short', timeZone: CAIRO_TIME_ZONE });
}

const ageHours = (item: InboxItem) =>
  item.createdAt ? Math.max(0, (Date.now() - new Date(item.createdAt).getTime()) / 3600000) : 0;
const isWaiting = (item: InboxItem) => item.status === 'open' || item.status === 'pending';
// The ticket's own SLA (api/lib/ticketRouting.js) when it has one; a website
// message has none, so a full day unanswered is late.
const isOverdue = (item: InboxItem) => isWaiting(item) && (item.sla ? item.sla === 'overdue' : ageHours(item) > 24);
const waitedFor = (item: InboxItem) => {
  const hours = Math.round(ageHours(item));
  return hours < 1 ? 'وصلت دلوقتي' : hours < 24 ? `مستنية ${hours} ساعة` : `مستنية ${Math.round(hours / 24)} يوم`;
};

type TicketReply = { id: string; text: string; author: string; isStaff: boolean; at: string };
type TimelineRow = { event_type: string; actor_name?: string; to_value?: string; detail?: string; created_at: string };
type CannedResponse = { id: string; title: string; body: string; category: string };
const EVENT_LABEL: Record<string, string> = {
  created: 'اتفتحت', routed: 'اتوجهت', assigned: 'اتسلمت', replied: 'رد', status_changed: 'الحالة اتغيرت',
  escalated: 'اتصعدت للإدارة', converted: 'اتحولت من رسالة', priority_changed: 'الأولوية اتغيرت', archived: 'اتحذفت', note: 'ملاحظة',
};

const btn = 'inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50';

export default function CustomerInboxTab({ notify }: { notify: NotifyFn }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, staffMembers, currentStaff } = useSiteData();
  const [tickets, setTickets] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'waiting' | 'overdue' | 'all' | InboxStatus>('waiting');
  const [sourceFilter, setSourceFilter] = useState<'all' | InboxSource>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [department, setDepartment] = useState<'' | 'all'>('');
  const [creating, setCreating] = useState(false);

  // The drawer: the conversation, its record and every action on one problem.
  const [detailItem, setDetailItem] = useState<InboxItem | null>(null);
  const [ticketReplies, setTicketReplies] = useState<TicketReply[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState('');

  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [showCanned, setShowCanned] = useState(false);
  const [cannedManageOpen, setCannedManageOpen] = useState(false);
  const [cannedDraft, setCannedDraft] = useState<{ id?: string; title: string; body: string }>({ title: '', body: '' });
  const loadCanned = useCallback(() => {
    mysqlAdmin.adminGet<CannedResponse[]>('/admin/support/canned-responses').then(rows => setCanned(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, []);
  useEffect(() => { loadCanned(); }, [loadCanned]);
  const saveCanned = async () => {
    if (!cannedDraft.title.trim() || !cannedDraft.body.trim()) { notify('error', 'العنوان والنص مطلوبين'); return; }
    try {
      if (cannedDraft.id) await mysqlAdmin.adminPut(`/admin/support/canned-responses/${cannedDraft.id}`, { title: cannedDraft.title, body: cannedDraft.body });
      else await mysqlAdmin.adminPost('/admin/support/canned-responses', { title: cannedDraft.title, body: cannedDraft.body });
      setCannedDraft({ title: '', body: '' }); loadCanned(); notify('success', 'اتحفظ');
    } catch { notify('error', 'تعذر الحفظ'); }
  };
  const deleteCanned = async (id: string) => {
    try { await mysqlAdmin.adminDelete(`/admin/support/canned-responses/${id}`); loadCanned(); } catch { notify('error', 'تعذر الحذف'); }
  };

  const loadRemote = useCallback(async () => {
    setLoading(true);
    try {
      const inbox = await mysqlAdmin.adminGet<{ tickets: any[]; contacts: any[] }>(`/admin/cs/inbox${department ? `?department=${department}` : ''}`);
      setTickets(Array.isArray(inbox?.tickets) ? inbox.tickets : []);
      setContacts(Array.isArray(inbox?.contacts) ? inbox.contacts : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل المشاكل');
    } finally {
      setLoading(false);
    }
  }, [notify, department]);
  useEffect(() => { loadRemote(); }, [loadRemote]);

  const items = useMemo<InboxItem[]>(() => [
    ...tickets.map((row): InboxItem => ({
      id: String(row.id),
      source: 'ticket',
      title: row.subject || 'تذكرة',
      person: row.subscriber_name || row.subscriber_email || 'عميل',
      phone: row.subscriber_phone || '',
      email: row.subscriber_email || '',
      clientCode: row.client_code || '',
      detail: row.body || '',
      status: mapStatus(row.status),
      category: row.category,
      priority: String(row.priority || 'medium'),
      department: row.department,
      assignedTo: row.assigned_to || '',
      assigneeName: row.assignee_name || '',
      sla: row.sla,
      escalated: !!row.escalated_at,
      replies: Number(row.reply_count || 0),
      resolution: row.resolution_note || '',
      createdAt: row.created_at,
    })),
    ...contacts.map((row): InboxItem => ({
      id: String(row.id),
      source: 'contact',
      title: 'رسالة «مشكلة تقنية» من الموقع',
      person: row.subscriber_name || 'زائر',
      phone: row.phone || '',
      email: row.subscriber_email || '',
      detail: row.preview || '',
      status: mapStatus(row.status),
      priority: String(row.priority || 'medium'),
      escalated: false,
      replies: 0,
      createdAt: row.created_at,
    })),
  ], [contacts, tickets]);

  const counts = useMemo(() => ({
    waiting: items.filter(isWaiting).length,
    overdue: items.filter(isOverdue).length,
    open: items.filter(item => item.status === 'open').length,
    pending: items.filter(item => item.status === 'pending').length,
    done: items.filter(item => item.status === 'done').length,
    closed: items.filter(item => item.status === 'closed').length,
    all: items.length,
    oldestHours: Math.round(Math.max(0, ...items.filter(isWaiting).map(ageHours))),
  }), [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mine = currentStaff?.id ? String(currentStaff.id) : '';
    return items.filter(item => {
      if (view === 'waiting' ? !isWaiting(item) : view === 'overdue' ? !isOverdue(item) : view !== 'all' && item.status !== view) return false;
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (priorityFilter && item.priority !== priorityFilter) return false;
      if (ownerFilter === 'mine' ? item.assignedTo !== mine : ownerFilter === 'none' ? !!item.assignedTo : ownerFilter && item.assignedTo !== ownerFilter) return false;
      if (!q) return true;
      return [item.title, item.person, item.phone, item.email, item.clientCode, item.detail]
        .some(value => String(value || '').toLowerCase().includes(q));
    })
      // Waiting first, the longest-waiting at the top: reading down is the order to work in.
      .sort((a, b) => (Number(isWaiting(b)) - Number(isWaiting(a))) || (ageHours(b) - ageHours(a)));
  }, [items, view, sourceFilter, categoryFilter, priorityFilter, ownerFilter, query, currentStaff]);

  const owners = useMemo(() => {
    const seen = new Map<string, string>();
    items.forEach(item => { if (item.assignedTo) seen.set(item.assignedTo, item.assigneeName || 'موظف'); });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'));
  }, [items]);
  const categories = useMemo(() => [...new Set(items.map(item => item.category).filter(Boolean) as string[])], [items]);

  const run = useCallback(async (id: string, action: () => Promise<unknown>, ok: string) => {
    setBusy(id);
    try {
      await action();
      notify('success', ok);
      await loadRemote();
      return true;
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء');
      return false;
    } finally { setBusy(''); }
  }, [loadRemote, notify]);

  const openDetail = useCallback(async (item: InboxItem) => {
    setDetailItem(item);
    setReplyText('');
    setTicketReplies([]);
    setTimeline([]);
    if (item.source !== 'ticket') return;
    setDetailLoading(true);
    try {
      const row = await mysqlAdmin.adminGet<any>(`/admin/tickets/${encodeURIComponent(item.id)}`);
      setTicketReplies((Array.isArray(row?.replies) ? row.replies : []).map((r: any) => ({
        id: String(r.id),
        text: r.body || '',
        author: r.author_name || (String(r.author_type || '').toUpperCase() === 'CLIENT' ? 'العميل' : 'خدمة العملاء'),
        isStaff: String(r.author_type || '').toUpperCase() !== 'CLIENT',
        at: r.created_at || '',
      })));
      setTimeline(Array.isArray(row?.timeline) ? row.timeline : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل المحادثة');
    } finally { setDetailLoading(false); }
  }, [notify]);
  const closeDetail = () => { setDetailItem(null); setTicketReplies([]); setTimeline([]); setReplyText(''); };

  // A link from a notification or the old tickets page (?focus=<ticket>) opens
  // that one, once, then drops the parameter.
  const focusHandled = useRef(false);
  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (!focusId || focusHandled.current || !items.length) return;
    const target = items.find(item => item.id === focusId);
    if (!target) return;
    focusHandled.current = true;
    void openDetail(target);
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    setSearchParams(next, { replace: true });
  }, [items, searchParams, setSearchParams, openDetail]);

  // ── The actions, the same from the row and from the drawer ──
  const take = (item: InboxItem) => currentStaff && run(item.id,
    () => mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}/assign`, { staff_id: currentStaff.id }), 'استلمتها');
  const assign = (item: InboxItem, staffId: string) => {
    const picked = staffMembers.find(member => member.id === staffId);
    return run(item.id, () => mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}/assign`, { staff_id: staffId || null }),
      staffId ? `اتحولت لـ${picked?.name || 'الزميل'}` : 'اتشال المسئول');
  };
  const follow = (item: InboxItem) => run(item.id,
    () => mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}/status`, { status: 'in_progress' }), 'بقت تحت المتابعة');
  // «تتسجل في حسابه ان كان عنده مشكله كذا ومسئول خدمه العملاء حلها بكذا»: the
  // fix is asked for, and written on the ticket and on the client's file.
  const resolve = async (item: InboxItem, status: 'resolved' | 'closed') => {
    const answer = await promptDialog({
      title: status === 'resolved' ? 'اتحلت إزاي؟' : 'سبب القفل',
      message: status === 'resolved'
        ? 'اكتب المشكلة اتحلت إزاي — بيتسجل على التذكرة وفي ملف العميل.'
        : 'ليه بتتقفل من غير حل؟ — بيتسجل على التذكرة وفي ملف العميل.',
      placeholder: status === 'resolved' ? 'الحل' : 'السبب',
      confirmLabel: status === 'resolved' ? 'اتحلت' : 'قفل',
    });
    if (answer === null) return;
    const reason = answer.trim();
    if (status === 'closed' && !reason) { notify('error', 'سبب القفل مطلوب'); return; }
    const done = await run(item.id, () => mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}/status`, {
      status, ...(reason ? { closed_reason: reason } : {}),
    }), status === 'resolved' ? 'اتسجلت إنها اتحلت' : 'اتقفلت');
    if (done) closeDetail();
  };
  const reopen = (item: InboxItem) => run(item.id,
    () => mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}/status`, { status: 'open' }), 'اتفتحت تاني');
  const escalate = async (item: InboxItem) => {
    const reason = await promptDialog('تصعيد للإدارة — اكتب السبب:');
    if (reason === null) return;
    await run(item.id, () => mysqlAdmin.adminPost(`/admin/tickets/${encodeURIComponent(item.id)}/escalate`, { reason }), 'اتصعدت للإدارة');
  };
  const setPriority = (item: InboxItem, priority: string) => run(item.id,
    () => mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}/priority`, { priority }), 'الأولوية اتغيرت');
  const reroute = (item: InboxItem, category: string) => run(item.id,
    () => mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}/route`, { category }), 'اتحولت للقسم المسئول');
  const deleteTicketApi = async (item: InboxItem) => {
    if (!await confirmDialog(`حذف «${item.title}»؟ بتختفي من الشغل، وسجلها بيفضل للمراجعة.`)) return;
    const done = await run(item.id, () => mysqlAdmin.adminDelete(item.source === 'ticket'
      ? `/admin/tickets/${encodeURIComponent(item.id)}`
      : `/admin/contact-messages/${encodeURIComponent(item.id)}`), 'اتحذفت');
    if (done) closeDetail();
  };
  const convert = (item: InboxItem) => run(item.id,
    () => mysqlAdmin.adminPost(`/admin/cs/contact/${encodeURIComponent(item.id)}/convert`, { category: 'technical' }), 'اتحولت لتذكرة');
  const markContact = (item: InboxItem, status: 'read' | 'replied') => run(item.id,
    () => mysqlAdmin.adminPut(`/admin/cs/contact/${encodeURIComponent(item.id)}/status`, { status }), status === 'replied' ? 'اتسجل إنه اترد عليها' : 'اتقرت');

  const sendReply = async (item: InboxItem) => {
    if (!replyText.trim()) return;
    setBusy(item.id);
    try {
      const result = await mysqlAdmin.adminPost<{ reply: { id: string; body: string; author_name: string; created_at: string } }>(
        `/admin/tickets/${encodeURIComponent(item.id)}/reply`, { body: replyText.trim() });
      setTicketReplies(prev => [...prev, { id: result.reply.id, text: result.reply.body, author: result.reply.author_name, isStaff: true, at: result.reply.created_at }]);
      setReplyText('');
      notify('success', 'الرد اتبعت');
      void loadRemote();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إرسال الرد');
    } finally { setBusy(''); }
  };

  const rowActions = (item: InboxItem) => {
    const working = busy === item.id;
    const closed = item.status === 'done' || item.status === 'closed';
    const mine = !!currentStaff && item.assignedTo === String(currentStaff.id);
    return (
      <div className="flex flex-nowrap items-center gap-1" onClick={event => event.stopPropagation()}>
        <button onClick={() => void openDetail(item)} className={`${btn} bg-slate-800 text-white hover:bg-slate-900`}>
          <MessageSquare size={10} /> {item.source === 'ticket' ? 'رد' : 'فتح'}
        </button>
        {item.source === 'ticket' ? (
          <>
            {!closed && !mine && currentStaff && (
              <button disabled={working} onClick={() => void take(item)} className={`${btn} border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}><UserCheck size={10} /> استلام</button>
            )}
            {!closed && (
              <button disabled={working} onClick={() => void resolve(item, 'resolved')} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}><CheckCircle2 size={10} /> اتحلت</button>
            )}
            {!closed && !item.escalated && (
              <button disabled={working} onClick={() => void escalate(item)} className={`${btn} border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100`}><ArrowUpCircle size={10} /> تصعيد</button>
            )}
            {closed && (
              <button disabled={working} onClick={() => void reopen(item)} className={`${btn} border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}><RotateCcw size={10} /> فتح تاني</button>
            )}
            {item.clientCode && (
              <button onClick={() => navigate(`/client/${item.clientCode}`)} className={`${btn} border border-gray-200 bg-white text-gray-600 hover:bg-gray-100`}><ExternalLink size={10} /> الملف</button>
            )}
          </>
        ) : (
          <>
            <button disabled={working} onClick={() => void convert(item)} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}><Ticket size={10} /> تحويل لتذكرة</button>
            {item.status !== 'done' && (
              <button disabled={working} onClick={() => void markContact(item, 'replied')} className={`${btn} border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}><CheckCircle2 size={10} /> اترد عليها</button>
            )}
          </>
        )}
        {isAdmin && <button disabled={working} onClick={() => void deleteTicketApi(item)} title="حذف — للإدارة" className={`${btn} border border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}><Trash2 size={10} /> حذف</button>}
      </div>
    );
  };

  const selectCls = 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-bold text-slate-700';
  const views: Array<[typeof view, string, number, string]> = [
    ['waiting', 'مستنية رد', counts.waiting, 'border-amber-200 bg-amber-50 text-amber-800'],
    ['overdue', 'عدّت الوقت', counts.overdue, 'border-rose-200 bg-rose-50 text-rose-800'],
    ['pending', 'تحت المتابعة', counts.pending, 'border-blue-200 bg-blue-50 text-blue-800'],
    ['done', 'اتحلت', counts.done, 'border-emerald-200 bg-emerald-50 text-emerald-800'],
    ['all', 'الكل', counts.all, 'border-slate-200 bg-slate-50 text-slate-700'],
  ];

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-slate-900">
              <Inbox size={20} className="text-indigo-600" /> مشاكل العملاء والتذاكر
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              كل مشكلة مرة واحدة: تذاكر الموقع والتليفون، والمشاكل اللي اتفتحت من صف العميل في الدقي والأونلاين، ورسائل «مشكلة تقنية» من صفحة التواصل.
              الحل بيتسجل في ملف العميل.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700">
              <Plus size={14} /> تذكرة جديدة
            </button>
            <button onClick={() => void loadRemote()} disabled={loading} className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-white disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
            </button>
          </div>
        </div>

        {counts.overdue > 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800">
            <AlertCircle size={15} /> {counts.overdue} مشكلة عدّت وقت الرد — أقدم واحدة مستنية {counts.oldestHours} ساعة.
          </div>
        ) : counts.waiting > 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
            <Clock size={15} /> {counts.waiting} مشكلة مستنية رد — كلها في وقتها.
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
            <CheckCircle2 size={15} /> مفيش مشكلة مستنية رد.
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {views.map(([key, label, count, cls]) => (
            <button key={key} type="button" onClick={() => setView(key)}
              className={`rounded-xl border px-3 py-2 text-right transition ${cls} ${view === key ? 'ring-2 ring-indigo-300' : 'opacity-80 hover:opacity-100'}`}>
              <p className="text-[11px] font-bold">{label}</p>
              <p className="text-xl font-black">{count}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Every filter, small, on one row. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالاسم أو التليفون أو الكود أو النص"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-9 pl-3 text-xs outline-none focus:ring-2 focus:ring-indigo-200" />
        </div>
        <select value={sourceFilter} onChange={event => setSourceFilter(event.target.value as typeof sourceFilter)} className={selectCls} aria-label="المصدر">
          <option value="all">كل المصادر</option>
          <option value="ticket">تذاكر</option>
          <option value="contact">رسائل الموقع</option>
        </select>
        <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)} className={selectCls} aria-label="النوع">
          <option value="">كل الأنواع</option>
          {categories.map(key => <option key={key} value={key}>{CATEGORY_LABEL[key] || key}</option>)}
        </select>
        <select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)} className={selectCls} aria-label="الأولوية">
          <option value="">كل الأولويات</option>
          {Object.entries(PRIORITY_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
        <select value={ownerFilter} onChange={event => setOwnerFilter(event.target.value)} className={selectCls} aria-label="المسئول">
          <option value="">كل المسئولين</option>
          {currentStaff && <option value="mine">بتاعتي</option>}
          <option value="none">من غير مسئول</option>
          {owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {isAdmin && (
          <select value={department} onChange={event => setDepartment(event.target.value as typeof department)} className={selectCls} aria-label="القسم">
            <option value="">خدمة العملاء والمصعّد</option>
            <option value="all">كل الأقسام</option>
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-14 text-center text-sm text-slate-400">
          <MessageSquare size={30} className="mx-auto mb-2" />
          {loading ? 'جاري التحميل…' : 'مفيش مشاكل بالفلاتر دي.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 text-right font-bold">المشكلة</th>
                <th className="px-3 py-2 text-right font-bold">العميل</th>
                <th className="px-3 py-2 text-right font-bold">المسئول</th>
                <th className="px-3 py-2 text-right font-bold">الحالة</th>
                <th className="px-3 py-2 text-right font-bold">من امتى</th>
                <th className="px-3 py-2 text-right font-bold">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={`${item.source}-${item.id}`} onClick={() => void openDetail(item)}
                  className={`cursor-pointer border-t border-slate-100 align-top hover:bg-indigo-50/40 ${isOverdue(item) ? 'bg-rose-50/40' : ''}`}>
                  <td className="max-w-[320px] px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {item.source === 'contact' ? <Mail size={12} className="text-indigo-500" /> : <Ticket size={12} className="text-slate-400" />}
                      <span className="font-bold text-slate-900">{item.title}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {item.category && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">{CATEGORY_LABEL[item.category] || item.category}</span>}
                      <span className={`text-[10px] font-bold ${PRIORITY_META[item.priority]?.cls || ''}`}>{PRIORITY_META[item.priority]?.label || item.priority}</span>
                      {item.escalated && <span className="text-[10px] font-bold text-purple-600">⚠ مصعّدة</span>}
                      {item.replies > 0 && <span className="text-[10px] text-slate-400">{item.replies} رد</span>}
                    </div>
                    {item.detail && <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{item.detail}</p>}
                    {item.resolution && <p className="mt-0.5 line-clamp-2 text-[11px] font-bold text-emerald-700">الحل: {item.resolution}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="whitespace-nowrap font-bold text-slate-800">{item.person}</div>
                    {item.phone && <div className="text-right text-[11px] text-slate-500" dir="ltr">{item.phone}</div>}
                    {item.clientCode && <div className="text-[10px] text-slate-400">{item.clientCode}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">{item.assigneeName || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_META[item.status].cls}`}>{STATUS_META[item.status].label}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="text-[11px] text-slate-500">{fmtDate(item.createdAt)}</div>
                    {isWaiting(item) && <div className={`text-[10px] font-bold ${isOverdue(item) ? 'text-rose-600' : 'text-amber-600'}`}>{waitedFor(item)}</div>}
                  </td>
                  <td className="px-3 py-2">{rowActions(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailItem && (() => {
        const item = items.find(row => row.source === detailItem.source && row.id === detailItem.id) || detailItem;
        const working = busy === item.id;
        const closed = item.status === 'done' || item.status === 'closed';
        return (
          <Modal open onClose={closeDetail} title={item.title} subtitle={`${item.person}${item.phone ? ` · ${item.phone}` : ''}`} align="drawer" size="lg" bodyClassName="p-0">
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATUS_META[item.status].cls}`}>{STATUS_META[item.status].label}</span>
                {item.category && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{CATEGORY_LABEL[item.category] || item.category}</span>}
                {item.assigneeName && <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">المسئول: {item.assigneeName}</span>}
                {isWaiting(item) && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isOverdue(item) ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>{waitedFor(item)}</span>}
                {item.clientCode && (
                  <button onClick={() => navigate(`/client/${item.clientCode}`)} className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                    <ExternalLink size={12} /> ملف العميل
                  </button>
                )}
              </div>

              {item.detail && <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">{item.detail}</div>}
              {item.resolution && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><b>الحل:</b> {item.resolution}</div>}

              {item.source === 'ticket' && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-400">المحادثة</p>
                  {detailLoading ? (
                    <p className="py-4 text-center text-sm text-slate-400">جاري التحميل…</p>
                  ) : ticketReplies.length === 0 ? (
                    <p className="text-xs text-slate-400">مفيش ردود لسه.</p>
                  ) : ticketReplies.map(reply => (
                    <div key={reply.id} className={`rounded-xl p-3 text-sm ${reply.isStaff ? 'bg-indigo-50 text-indigo-900' : 'bg-slate-100 text-slate-800'}`}>
                      <p className="mb-1 text-[10px] font-bold text-slate-400">{reply.author} · {fmtDate(reply.at)}</p>
                      <p className="whitespace-pre-wrap">{reply.text}</p>
                    </div>
                  ))}
                  {showCanned && (
                    <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[11px] text-slate-400">ردود جاهزة</span>
                        <button onClick={() => { setCannedManageOpen(true); setShowCanned(false); }} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">إدارة ⚙</button>
                      </div>
                      {canned.length === 0 ? <p className="py-2 text-center text-[11px] text-slate-400">مفيش ردود جاهزة</p> : canned.map(c => (
                        <button key={c.id} onClick={() => { setReplyText(c.body); setShowCanned(false); }}
                          className="w-full rounded-lg bg-white px-3 py-1.5 text-right text-xs text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700">
                          <span className="font-bold">{c.title}</span> — <span className="opacity-70">{c.body.slice(0, 50)}…</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-2 pt-1">
                    <button onClick={() => setShowCanned(v => !v)} title="ردود جاهزة"
                      className={`rounded-xl border px-2.5 py-2 text-xs ${showCanned ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                      <Star size={14} />
                    </button>
                    <textarea value={replyText} onChange={event => setReplyText(event.target.value)} rows={2} placeholder="اكتب ردك للعميل…"
                      className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200" />
                    <button onClick={() => void sendReply(item)} disabled={working || !replyText.trim()}
                      className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
                      <Send size={14} /> إرسال
                    </button>
                  </div>
                  {timeline.length > 0 && (
                    <details className="rounded-xl border border-slate-100 bg-white p-3">
                      <summary className="cursor-pointer text-xs font-bold text-slate-500">سجل التذكرة ({timeline.length})</summary>
                      <ol className="mt-2 space-y-1">
                        {timeline.map((event, index) => (
                          <li key={index} className="text-[11px] text-slate-600">
                            <span className="text-slate-400">{fmtDate(event.created_at)}</span> · <b>{EVENT_LABEL[event.event_type] || event.event_type}</b>
                            {event.to_value ? ` → ${event.to_value}` : ''}{event.actor_name ? ` · ${event.actor_name}` : ''}{event.detail ? ` — ${event.detail}` : ''}
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50 p-4">
              <p className="mb-2 text-[11px] font-bold text-slate-400">الإجراءات</p>
              <div className="flex flex-wrap items-center gap-2">
                {item.source === 'ticket' ? (
                  <>
                    {item.status === 'open' && <button disabled={working} onClick={() => void follow(item)} className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"><Clock size={13} /> تحت المتابعة</button>}
                    {!closed && <button disabled={working} onClick={() => void resolve(item, 'resolved')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={13} /> اتحلت</button>}
                    {!closed && <button disabled={working} onClick={() => void resolve(item, 'closed')} className="inline-flex items-center gap-1 rounded-xl bg-slate-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"><X size={13} /> قفل</button>}
                    {closed && <button disabled={working} onClick={() => void reopen(item)} className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 disabled:opacity-50"><RotateCcw size={13} /> فتح تاني</button>}
                    {!closed && !item.escalated && <button disabled={working} onClick={() => void escalate(item)} className="inline-flex items-center gap-1 rounded-xl border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-700 disabled:opacity-50"><ArrowUpCircle size={13} /> تصعيد للإدارة</button>}
                    <select disabled={working} value={item.assignedTo || ''} onChange={event => void assign(item, event.target.value)} className={selectCls} aria-label="تحويل لزميل">
                      <option value="">— تحويل لزميل —</option>
                      {staffMembers.filter(member => member.status === 'active').map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                    </select>
                    <select disabled={working} value={item.category || 'general'} onChange={event => void reroute(item, event.target.value)} className={selectCls} aria-label="النوع">
                      {Object.entries(CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>النوع: {label}</option>)}
                    </select>
                    <select disabled={working} value={item.priority} onChange={event => void setPriority(item, event.target.value)} className={selectCls} aria-label="الأولوية">
                      {Object.entries(PRIORITY_META).map(([key, meta]) => <option key={key} value={key}>أولوية: {meta.label}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <button disabled={working} onClick={() => void convert(item)} className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><Ticket size={13} /> تحويل لتذكرة</button>
                    {item.status === 'open' && <button disabled={working} onClick={() => void markContact(item, 'read')} className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><RefreshCw size={13} /> اتقرت</button>}
                    {item.status !== 'done' && <button disabled={working} onClick={() => void markContact(item, 'replied')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"><CheckCircle2 size={13} /> اترد عليها</button>}
                  </>
                )}
                {isAdmin && <button disabled={working} onClick={() => void deleteTicketApi(item)} className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={13} /> حذف</button>}
              </div>
            </div>
          </Modal>
        );
      })()}

      {creating && <NewTicketModal notify={notify} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void loadRemote(); }} />}

      {cannedManageOpen && (
        <Modal open onClose={() => setCannedManageOpen(false)} title="الردود الجاهزة" layer="over">
          <div className="space-y-3 overflow-y-auto p-5">
            <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">{cannedDraft.id ? 'تعديل رد' : 'رد جديد'}</p>
              <input value={cannedDraft.title} onChange={event => setCannedDraft(d => ({ ...d, title: event.target.value }))} placeholder="العنوان"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              <textarea value={cannedDraft.body} onChange={event => setCannedDraft(d => ({ ...d, body: event.target.value }))} placeholder="نص الرد" rows={3}
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              <div className="flex gap-2">
                <button onClick={() => void saveCanned()} className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm text-white hover:bg-indigo-700">{cannedDraft.id ? 'حفظ' : 'إضافة'}</button>
                {cannedDraft.id && <button onClick={() => setCannedDraft({ title: '', body: '' })} className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50">إلغاء</button>}
              </div>
            </div>
            {canned.map(c => (
              <div key={c.id} className="flex items-start gap-2 rounded-lg border border-slate-100 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800">{c.title}</div>
                  <div className="truncate text-xs text-slate-500">{c.body}</div>
                </div>
                <button onClick={() => setCannedDraft({ id: c.id, title: c.title, body: c.body })} className="text-xs text-indigo-600">تعديل</button>
                <button onClick={() => void deleteCanned(c.id)} className="text-xs text-red-500">حذف</button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// A problem taken by phone or in person. The phone number finds the client on
// the server, so the ticket and its resolution land on their file.
function NewTicketModal({ notify, onClose, onCreated }: { notify: NotifyFn; onClose: () => void; onCreated: () => void }) {
  const [draft, setDraft] = useState({ subject: '', body: '', name: '', phone: '', category: 'client_problem', priority: '' });
  const [saving, setSaving] = useState(false);
  const field = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';
  const save = async () => {
    if (!draft.subject.trim() || !draft.body.trim()) { notify('error', 'اكتب عنوان المشكلة وتفاصيلها'); return; }
    setSaving(true);
    try {
      await mysqlAdmin.adminPost('/admin/cs/tickets', {
        subject: draft.subject.trim(), body: draft.body.trim(), name: draft.name.trim(), phone: draft.phone.trim(),
        category: draft.category, ...(draft.priority ? { priority: draft.priority } : {}), channel: 'phone',
      });
      notify('success', 'التذكرة اتفتحت');
      onCreated();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر فتح التذكرة');
    } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="تذكرة جديدة" size="sm">
      <div className="space-y-2">
        <input value={draft.subject} onChange={event => setDraft(d => ({ ...d, subject: event.target.value }))} placeholder="عنوان المشكلة *" className={field} />
        <textarea value={draft.body} onChange={event => setDraft(d => ({ ...d, body: event.target.value }))} rows={3} placeholder="المشكلة بالتفصيل *" className={`${field} resize-none`} />
        <div className="grid grid-cols-2 gap-2">
          <input value={draft.name} onChange={event => setDraft(d => ({ ...d, name: event.target.value }))} placeholder="اسم العميل" className={field} />
          <input value={draft.phone} onChange={event => setDraft(d => ({ ...d, phone: event.target.value }))} placeholder="التليفون" dir="ltr" className={field} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select value={draft.category} onChange={event => setDraft(d => ({ ...d, category: event.target.value }))} className={field} aria-label="النوع">
            {Object.entries(CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select value={draft.priority} onChange={event => setDraft(d => ({ ...d, priority: event.target.value }))} className={field} aria-label="الأولوية">
            <option value="">الأولوية حسب النوع</option>
            {Object.entries(PRIORITY_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
          </select>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 py-2 text-sm hover:bg-slate-50">إلغاء</button>
          <button disabled={saving} onClick={() => void save()} className="flex-1 rounded-xl bg-indigo-600 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? '⏳…' : 'فتح التذكرة'}</button>
        </div>
      </div>
    </Modal>
  );
}
