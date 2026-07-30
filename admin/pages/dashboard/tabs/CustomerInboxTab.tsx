import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Inbox,
  Mail,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Star,
  Ticket,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';

import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { hasPermission, type PermissionKey, type RoleKey } from '../../../constants/permissions';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type InboxSource = 'ticket' | 'contact' | 'refund' | 'join_instructor' | 'join_consultant' | 'join_staff';
type InboxStatus = 'open' | 'pending' | 'done' | 'rejected' | 'closed';
type InboxPriority = 'urgent' | 'high' | 'normal';

type InboxItem = {
  id: string;
  source: InboxSource;
  title: string;
  person: string;
  contact?: string;
  detail?: string;
  status: InboxStatus;
  createdAt?: string;
  amount?: string;
  originalStatus?: string;
  raw?: Record<string, unknown>;
};

type RefundRow = {
  id: string;
  subscriber_name?: string;
  subscriber_email?: string;
  amount?: number;
  currency?: string;
  reason?: string;
  status?: string;
  created_at?: string;
  refund_method?: string;
  payment_id?: string | null;
};

const SOURCE_META: Record<InboxSource, { label: string; icon: React.ComponentType<{ size?: number }>; tab: string; tone: string }> = {
  ticket: { label: 'تذكرة دعم', icon: Ticket, tab: 'tickets', tone: 'blue' },
  contact: { label: 'رسالة تواصل', icon: Mail, tab: 'contacts', tone: 'indigo' },
  refund: { label: 'طلب استرداد', icon: RotateCcw, tab: 'refund_requests', tone: 'amber' },
  join_instructor: { label: 'طلب محاضر', icon: GraduationCap, tab: 'lecturer_applications', tone: 'emerald' },
  join_consultant: { label: 'طلب استشاري', icon: Briefcase, tab: 'lecturer_applications', tone: 'violet' },
  join_staff: { label: 'طلب موظف', icon: Briefcase, tab: 'staff_applications', tone: 'slate' },
};

const STATUS_LABEL: Record<InboxStatus, string> = {
  open: 'مفتوح',
  pending: 'قيد المراجعة',
  done: 'مكتمل',
  rejected: 'مرفوض',
  closed: 'مغلق',
};

function mapStatus(raw?: string): InboxStatus {
  const value = String(raw || '').toLowerCase();
  if (['resolved', 'replied', 'approved', 'accepted', 'done'].includes(value)) return 'done';
  if (['rejected', 'failed'].includes(value)) return 'rejected';
  if (['closed'].includes(value)) return 'closed';
  if (['pending', 'reviewed', 'in_progress', 'inprogress', 'read'].includes(value)) return 'pending';
  return 'open';
}

function fmtDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function resolveWorkflow(item: InboxItem): { priority: InboxPriority; owner: string; slaLabel: string; slaClass: string } {
  const created = item.createdAt ? new Date(item.createdAt).getTime() : Date.now();
  const ageHours = Math.max(0, Math.round((Date.now() - created) / 36e5));
  const isClosed = ['done', 'rejected', 'closed'].includes(item.status);
  const ownerBySource: Record<InboxSource, string> = {
    ticket: 'Support',
    contact: 'CX',
    refund: 'Finance',
    join_instructor: 'Academic HR',
    join_consultant: 'Academic HR',
    join_staff: 'HR',
  };
  const urgent = !isClosed && (item.source === 'refund' || ageHours >= 24);
  const high = !urgent && !isClosed && (item.source === 'ticket' || ageHours >= 8);
  return {
    priority: urgent ? 'urgent' : high ? 'high' : 'normal',
    owner: ownerBySource[item.source],
    slaLabel: isClosed ? 'SLA closed' : ageHours >= 24 ? `SLA late ${ageHours}h` : `SLA ${ageHours}h`,
    slaClass: isClosed ? 'bg-emerald-50 text-emerald-700' : urgent ? 'bg-red-50 text-red-700' : high ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600',
  };
}

type TicketReply = { id: string; text: string; author: string; isStaff: boolean; at: string };
type LinkedEntity = { type: string; id?: string; name?: string; client_code?: string } | null;
type CannedResponse = { id: string; title: string; body: string; category: string };

export default function CustomerInboxTab({ notify }: { notify: NotifyFn }) {
  const navigate = useNavigate();
  const { joinUsApplications, isAdmin, authUser, staffMembers } = useSiteData();
  const [tickets, setTickets] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | InboxSource>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InboxStatus>('all');
  const [statusOverrides, setStatusOverrides] = useState<Record<string, { status: InboxStatus; originalStatus: string }>>({});
  const currentStaff = staffMembers.find(member =>
    String(member.email || '').toLowerCase() === String(authUser?.email || '').toLowerCase()
  );
  const permissionSubject = currentStaff ? {
    role: currentStaff.role as RoleKey,
    permissions: currentStaff.permissions as PermissionKey[] | undefined,
  } : null;
  const canManageFinancial = isAdmin || hasPermission(permissionSubject, 'manage_financial');
  const canManageJoinUs = isAdmin || hasPermission(permissionSubject, 'manage_join_us');

  // Detail drawer state — opens the full item + all its actions inline (no navigation).
  const [detailItem, setDetailItem] = useState<InboxItem | null>(null);
  const [ticketReplies, setTicketReplies] = useState<TicketReply[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [refundNote, setRefundNote] = useState('');
  const [linkedEntity, setLinkedEntity] = useState<LinkedEntity>(null);

  // Canned (admin-managed) reply templates
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  const [showCanned, setShowCanned] = useState(false);
  const [cannedManageOpen, setCannedManageOpen] = useState(false);
  const [cannedDraft, setCannedDraft] = useState<{ id?: string; title: string; body: string }>({ title: '', body: '' });
  const loadCanned = useCallback(() => {
    mysqlAdmin.adminGet<CannedResponse[]>('/admin/support/canned-responses').then(rows => setCanned(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, []);
  useEffect(() => { loadCanned(); }, [loadCanned]);
  const saveCanned = async () => {
    if (!cannedDraft.title.trim() || !cannedDraft.body.trim()) { notify('error', 'العنوان والنص مطلوبان'); return; }
    try {
      if (cannedDraft.id) await mysqlAdmin.adminPut(`/admin/support/canned-responses/${cannedDraft.id}`, { title: cannedDraft.title, body: cannedDraft.body });
      else await mysqlAdmin.adminPost('/admin/support/canned-responses', { title: cannedDraft.title, body: cannedDraft.body });
      setCannedDraft({ title: '', body: '' }); loadCanned(); notify('success', 'تم الحفظ');
    } catch { notify('error', 'تعذر الحفظ'); }
  };
  const deleteCanned = async (id: string) => {
    try { await mysqlAdmin.adminDelete(`/admin/support/canned-responses/${id}`); loadCanned(); } catch { notify('error', 'تعذر الحذف'); }
  };

  const loadRemote = useCallback(async () => {
    setLoading(true);
    try {
      const [inbox, refundRows] = await Promise.all([
        mysqlAdmin.adminGet<{ tickets: any[]; contacts: any[] }>('/admin/cs/inbox'),
        canManageFinancial ? mysqlAdmin.adminGet<RefundRow[]>('/admin/finance/refunds') : Promise.resolve([]),
      ]);
      setTickets(Array.isArray(inbox?.tickets) ? inbox.tickets : []);
      setContacts(Array.isArray(inbox?.contacts) ? inbox.contacts : []);
      setRefunds(Array.isArray(refundRows) ? refundRows : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل صندوق خدمة العملاء');
    } finally {
      setLoading(false);
    }
  }, [canManageFinancial, notify]);

  useEffect(() => { loadRemote(); }, [loadRemote]);

  const items = useMemo<InboxItem[]>(() => {
    const ticketItems = tickets.map((row) => ({
      id: String(row.id),
      source: 'ticket' as const,
      title: row.subject || row.title || 'تذكرة دعم',
      person: row.subscriber_name || row.clientName || row.subscriber_email || 'عميل',
      contact: row.subscriber_email || row.clientEmail || '',
      detail: row.body || row.description || '',
      status: mapStatus(row.status),
      originalStatus: row.status,
      createdAt: row.created_at || row.createdAt,
      raw: row,
    }));

    const contactItems = contacts.map((row) => ({
      id: row.id,
      source: 'contact' as const,
      title: row.subject || 'رسالة من الموقع',
      person: row.name,
      contact: row.phone || row.email || '',
      detail: row.message,
      status: mapStatus(row.status),
      originalStatus: row.status,
      createdAt: row.created_at || row.createdAt,
      raw: row as unknown as Record<string, unknown>,
    }));

    const refundItems = refunds.map((row) => ({
      id: String(row.id),
      source: 'refund' as const,
      title: 'طلب استرداد مالي',
      person: row.subscriber_name || row.subscriber_email || 'عميل',
      contact: row.subscriber_email || '',
      detail: row.reason || '',
      status: mapStatus(row.status),
      originalStatus: row.status,
      createdAt: row.created_at,
      amount: `${Math.round(Number(row.amount || 0)).toLocaleString('ar-EG')} ${row.currency || 'EGP'}`,
      raw: row as unknown as Record<string, unknown>,
    }));

    const joinItems = (canManageJoinUs ? joinUsApplications : []).map((row) => ({
      id: row.id,
      source: row.type === 'consultant' ? 'join_consultant' as const : ['instructor', 'lecturer', 'teacher', 'academic'].includes(String(row.type || '').toLowerCase()) ? 'join_instructor' as const : 'join_staff' as const,
      title: row.type === 'consultant' ? 'طلب انضمام استشاري' : ['instructor', 'lecturer', 'teacher', 'academic'].includes(String(row.type || '').toLowerCase()) ? 'طلب انضمام محاضر' : 'طلب انضمام موظف',
      person: row.name,
      contact: row.phone || row.email,
      detail: row.specialty || row.message || '',
      status: mapStatus(row.status),
      originalStatus: row.status,
      createdAt: row.createdAt,
      raw: row as unknown as Record<string, unknown>,
    }));

    return [...ticketItems, ...contactItems, ...refundItems, ...joinItems]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [canManageJoinUs, contacts, joinUsApplications, refunds, tickets]);

  const resolvedItems = useMemo(() => items.map((item) => {
    const override = statusOverrides[`${item.source}-${item.id}`];
    return override ? { ...item, ...override } : item;
  }), [items, statusOverrides]);

  // ── Open the detail drawer for an item (fetches ticket conversation on demand) ──
  const openDetail = useCallback(async (item: InboxItem) => {
    setDetailItem(item);
    setReplyText('');
    setRefundNote('');
    setTicketReplies([]);
    setLinkedEntity(null);
    if (item.source === 'ticket') {
      setDetailLoading(true);
      try {
        const row = await mysqlAdmin.adminGet<any>(`/admin/tickets/${encodeURIComponent(item.id)}`);
        setLinkedEntity(row?.linked || null);
        const replies = Array.isArray(row?.replies) ? row.replies : Array.isArray(row?.messages) ? row.messages : [];
        setTicketReplies(replies.map((r: any) => ({
          id: String(r.id),
          text: r.body || r.text || '',
          author: r.author_name || (['client', 'subscriber'].includes(String(r.author_type || '').toLowerCase()) ? 'العميل' : 'الإدارة'),
          isStaff: !['client', 'subscriber'].includes(String(r.author_type || '').toLowerCase()),
          at: r.created_at || r.at || '',
        })));
      } catch (error) {
        notify('error', error instanceof Error ? error.message : 'تعذر تحميل محادثة التذكرة');
      } finally {
        setDetailLoading(false);
      }
    }
  }, [notify]);

  const closeDetail = () => { setDetailItem(null); setTicketReplies([]); setReplyText(''); setRefundNote(''); setLinkedEntity(null); };

  const goToCustomer = useCallback(() => {
    if (linkedEntity?.type === 'subscriber' && linkedEntity.client_code) navigate(`/client/${linkedEntity.client_code}`);
    else notify('info', 'لا يوجد عميل مسجّل مرتبط بهذا العنصر');
  }, [linkedEntity, navigate, notify]);

  const deleteTicketApi = useCallback(async (item: InboxItem) => {
    if (!window.confirm('أرشفة هذه التذكرة؟ ستختفي من قوائم العمل مع الاحتفاظ بسجلها للمراجعة.')) return;
    setActionBusy(true);
    try {
      await mysqlAdmin.adminDelete(`/admin/tickets/${encodeURIComponent(item.id)}`);
      notify('success', 'تمت أرشفة التذكرة مع الاحتفاظ بسجلها');
      closeDetail(); loadRemote();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حذف التذكرة');
    } finally { setActionBusy(false); }
  }, [loadRemote, notify]);

  // ── Status transitions (used by both the row quick-actions and the drawer) ──
  const updateItemStatus = useCallback(async (item: InboxItem, target: InboxStatus) => {
    const key = `${item.source}-${item.id}`;
    setActionBusy(true);
    try {
      let originalStatus: string = target;
      if (item.source === 'ticket') {
        // Real route is /status; accepts open|in_progress|resolved|closed.
        originalStatus = target === 'done' ? 'resolved' : target === 'closed' ? 'closed' : 'in_progress';
        const closedReason = originalStatus === 'closed'
          ? window.prompt('سبب إغلاق التذكرة (إلزامي):')?.trim()
          : '';
        if (originalStatus === 'closed' && !closedReason) return;
        await mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}/status`, {
          status: originalStatus,
          ...(closedReason ? { closed_reason: closedReason } : {}),
        });
      } else if (item.source === 'contact') {
        originalStatus = target === 'done' ? 'replied' : 'read';
        await mysqlAdmin.adminPut(`/admin/cs/contact/${encodeURIComponent(item.id)}/status`, {
          status: originalStatus,
        });
      } else if (item.source === 'refund') {
        originalStatus = target === 'rejected' ? 'REJECTED' : 'APPROVED';
        await mysqlAdmin.adminPut(`/admin/finance/refunds/${encodeURIComponent(item.id)}`, {
          status: originalStatus,
          notes: refundNote || (target === 'rejected' ? 'مرفوض من صندوق خدمة العملاء' : 'مقبول من صندوق خدمة العملاء'),
        });
      } else {
        originalStatus = target === 'done' ? 'accepted' : target === 'rejected' ? 'rejected' : 'reviewed';
        await mysqlAdmin.updateJoinUs(item.id, originalStatus);
      }
      setStatusOverrides((current) => ({ ...current, [key]: { status: target, originalStatus } }));
      notify('success', 'تم تحديث حالة العنصر');
      if (item.source === 'ticket' || item.source === 'refund') loadRemote();
      closeDetail();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحديث الحالة');
    } finally {
      setActionBusy(false);
    }
  }, [loadRemote, notify, refundNote]);

  // ── Ticket-only actions available from the drawer ──
  const sendTicketReply = useCallback(async (item: InboxItem) => {
    if (!replyText.trim()) return;
    setActionBusy(true);
    try {
      const result = await mysqlAdmin.adminPost<{ reply: { id: string; body: string; author_name: string; created_at: string } }>(
        `/admin/tickets/${encodeURIComponent(item.id)}/reply`,
        { body: replyText.trim() },
      );
      setTicketReplies((prev) => [...prev, {
        id: result.reply.id,
        text: result.reply.body,
        author: result.reply.author_name,
        isStaff: true,
        at: result.reply.created_at,
      }]);
      setReplyText('');
      notify('success', 'تم إرسال الرد');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إرسال الرد');
    } finally { setActionBusy(false); }
  }, [notify, replyText]);

  const escalateTicket = useCallback(async (item: InboxItem) => {
    setActionBusy(true);
    try {
      await mysqlAdmin.adminPost(`/admin/tickets/${encodeURIComponent(item.id)}/escalate`, {});
      notify('success', 'تم تصعيد التذكرة للإدارة');
      loadRemote();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر التصعيد');
    } finally { setActionBusy(false); }
  }, [loadRemote, notify]);

  const routeTicketToRefund = useCallback(async (item: InboxItem) => {
    setActionBusy(true);
    try {
      await mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}/route`, { category: 'refund' });
      if (linkedEntity?.type === 'subscriber' && linkedEntity.id) {
        notify('success', 'تم تحويل التذكرة لقسم الاسترداد. اختَر الدفعة الأصلية من الملف المالي قبل إنشاء الطلب.');
      } else {
        notify('success', 'تم تحويل التذكرة لقسم الاسترداد');
      }
      loadRemote();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر التحويل');
    } finally { setActionBusy(false); }
  }, [linkedEntity, loadRemote, notify]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resolvedItems.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (!q) return true;
      return [item.title, item.person, item.contact, item.detail, item.originalStatus]
        .some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [query, resolvedItems, sourceFilter, statusFilter]);

  const sourceCounts = useMemo(() => {
    return resolvedItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.source] = (acc[item.source] || 0) + 1;
      return acc;
    }, {});
  }, [resolvedItems]);

  const openCount = resolvedItems.filter((item) => item.status === 'open' || item.status === 'pending').length;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-extrabold text-slate-900">
              <Inbox size={20} className="text-indigo-600" /> Inbox خدمة العملاء الموحد
            </h2>
            <p className="mt-1 text-sm text-slate-500">اضغط أي عنصر لفتح تفاصيله وكل إجراءاته (رد · حالة · تصعيد · موافقة/رفض) في نفس الشاشة — بدون الانتقال لصفحة أخرى.</p>
          </div>
          <button
            onClick={loadRemote}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-white disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-3">
            <p className="text-xs font-bold text-indigo-600">إجمالي الرسائل</p>
            <p className="text-2xl font-black text-indigo-800">{resolvedItems.length}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
            <p className="text-xs font-bold text-amber-600">مفتوح/معلق</p>
            <p className="text-2xl font-black text-amber-800">{openCount}</p>
          </div>
          {(Object.keys(SOURCE_META) as InboxSource[]).map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => setSourceFilter(sourceFilter === source ? 'all' : source)}
              className={`rounded-xl border p-3 text-right transition ${sourceFilter === source ? 'border-indigo-300 bg-white shadow-sm' : 'border-slate-100 bg-slate-50 hover:bg-white'}`}
            >
              <p className="text-xs font-bold text-slate-500">{SOURCE_META[source].label}</p>
              <p className="text-xl font-black text-slate-800">{sourceCounts[source] || 0}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="بحث بالاسم أو الهاتف أو البريد أو النص..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-9 pl-3 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
          <option value="all">كل المصادر</option>
          {(Object.keys(SOURCE_META) as InboxSource[]).map((source) => <option key={source} value={source}>{SOURCE_META[source].label}</option>)}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
          <option value="all">كل الحالات</option>
          {(Object.keys(STATUS_LABEL) as InboxStatus[]).map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-slate-400">
          <MessageSquare size={34} className="mx-auto mb-3" />
          لا توجد عناصر مطابقة للفلاتر الحالية.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {filtered.map((item) => {
              const meta = SOURCE_META[item.source];
              const Icon = meta.icon;
              const workflow = resolveWorkflow(item);
              return (
                <div
                  key={`${item.source}-${item.id}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetail(item)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openDetail(item); }}
                  className="grid cursor-pointer gap-3 p-4 transition hover:bg-indigo-50/40 xl:grid-cols-[180px_1fr_240px_120px_120px] xl:items-center"
                >
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                      <Icon size={16} />
                    </span>
                    <div>
                      <p className="text-xs font-bold text-slate-500">{meta.label}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(item.createdAt)}</p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-slate-900">{item.title}</p>
                      {item.amount && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">{item.amount}</span>}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">{item.person} {item.contact ? <span className="text-slate-400">· {item.contact}</span> : null}</p>
                    {item.detail && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{item.detail}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${workflow.slaClass}`}>{workflow.slaLabel}</span>
                    <span className="w-fit rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{workflow.owner}</span>
                  </div>
                  <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                    {STATUS_LABEL[item.status]}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openDetail(item); }}
                    className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-700"
                  >
                    فتح التفاصيل
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Detail drawer: full item + every action, inline (no navigation) ── */}
      {detailItem && (() => {
        const item = detailItem;
        const meta = SOURCE_META[item.source];
        const Icon = meta.icon;
        const workflow = resolveWorkflow(item);
        const raw = (item.raw || {}) as Record<string, any>;
        const isClosed = ['done', 'closed', 'rejected'].includes(item.status);
        return (
          <div className="fixed inset-0 z-50 flex justify-start bg-black/40" onClick={(e) => { if (e.target === e.currentTarget) closeDetail(); }}>
            <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl" dir="rtl">
              {/* header */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Icon size={18} /></span>
                  <div>
                    <p className="text-[11px] font-bold text-slate-400">{meta.label} · {fmtDate(item.createdAt)}</p>
                    <h3 className="text-lg font-extrabold text-slate-900">{item.title}</h3>
                    <p className="mt-0.5 text-sm text-slate-600">{item.person}{item.contact ? ` · ${item.contact}` : ''}</p>
                  </div>
                </div>
                <button onClick={closeDetail} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
              </div>

              {/* body */}
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">الحالة: {STATUS_LABEL[item.status]}</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${workflow.slaClass}`}>{workflow.slaLabel}</span>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">المسؤول: {workflow.owner}</span>
                  {item.amount && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">{item.amount}</span>}
                </div>

                {item.source === 'ticket' && linkedEntity?.type === 'subscriber' && linkedEntity.client_code && (
                  <button onClick={goToCustomer} className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                    <ExternalLink size={13} /> ملف العميل{linkedEntity.name ? `: ${linkedEntity.name}` : ''}
                  </button>
                )}

                {item.detail && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                    {item.detail}
                  </div>
                )}

                {item.source === 'refund' && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border border-slate-100 p-2"><span className="text-slate-400">المبلغ:</span> <b>{item.amount}</b></div>
                    <div className="rounded-lg border border-slate-100 p-2"><span className="text-slate-400">طريقة الاسترداد:</span> {raw.refund_method || '—'}</div>
                    <div className="col-span-2 rounded-lg border border-slate-100 p-2"><span className="text-slate-400">رقم الدفعة:</span> {raw.payment_id || '—'}</div>
                  </div>
                )}

                {/* Ticket conversation */}
                {item.source === 'ticket' && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-400">المحادثة</p>
                    {detailLoading ? (
                      <p className="text-center text-sm text-slate-400 py-4">جاري تحميل المحادثة...</p>
                    ) : ticketReplies.length === 0 ? (
                      <p className="text-xs text-slate-400">لا توجد ردود بعد.</p>
                    ) : (
                      <div className="space-y-2">
                        {ticketReplies.map((r) => (
                          <div key={r.id} className={`rounded-xl p-3 text-sm ${r.isStaff ? 'bg-indigo-50 text-indigo-900' : 'bg-slate-100 text-slate-800'}`}>
                            <p className="mb-1 text-[10px] font-bold text-slate-400">{r.author} · {fmtDate(r.at)}</p>
                            <p className="whitespace-pre-wrap">{r.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {showCanned && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 max-h-36 overflow-y-auto space-y-1">
                        <div className="flex items-center justify-between px-1">
                          <span className="text-[11px] text-slate-400">ردود جاهزة</span>
                          <button onClick={() => { setCannedManageOpen(true); setShowCanned(false); }} className="text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold">إدارة ⚙</button>
                        </div>
                        {canned.length === 0 ? (
                          <p className="text-[11px] text-slate-400 text-center py-2">لا توجد ردود جاهزة محفوظة</p>
                        ) : canned.map((c) => (
                          <button key={c.id} onClick={() => { setReplyText(c.body); setShowCanned(false); }}
                            className="w-full text-right text-xs px-3 py-1.5 bg-white hover:bg-indigo-50 rounded-lg text-slate-700 hover:text-indigo-700 transition-colors">
                            <span className="font-bold">{c.title}</span> — <span className="opacity-70">{c.body.slice(0, 50)}…</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-end gap-2 pt-1">
                      <button onClick={() => setShowCanned(v => !v)} title="ردود جاهزة"
                        className={`rounded-xl border px-2.5 py-2 text-xs transition-colors ${showCanned ? 'border-indigo-300 bg-indigo-50 text-indigo-600' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
                        <Star size={14} />
                      </button>
                      <textarea
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        rows={2}
                        placeholder="اكتب ردًا للعميل..."
                        className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                      />
                      <button
                        onClick={() => sendTicketReply(item)}
                        disabled={actionBusy || !replyText.trim()}
                        className="inline-flex items-center gap-1 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Send size={14} /> إرسال
                      </button>
                    </div>
                  </div>
                )}

                {item.source === 'refund' && !isClosed && (
                  <textarea
                    value={refundNote}
                    onChange={(e) => setRefundNote(e.target.value)}
                    rows={2}
                    placeholder="ملاحظة إدارية على قرار الاسترداد (اختياري)..."
                    className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
                  />
                )}
              </div>

              {/* actions footer — every action, by source */}
              <div className="border-t border-slate-100 bg-slate-50 p-4">
                <p className="mb-2 text-[11px] font-bold text-slate-400">الإجراءات</p>
                <div className="flex flex-wrap gap-2">
                  {item.source === 'refund' ? (
                    isClosed ? (
                      <span className="text-sm text-slate-400">تم حسم هذا الطلب — لا توجد إجراءات إضافية.</span>
                    ) : (
                      <>
                        <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'done')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={15} /> موافقة على الاسترداد</button>
                        <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'rejected')} className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"><XCircle size={15} /> رفض الطلب</button>
                      </>
                    )
                  ) : item.source === 'ticket' ? (
                    <>
                      {!['pending'].includes(item.status) && <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'pending')} className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"><RefreshCw size={15} /> تحت المتابعة</button>}
                      {!['done'].includes(item.status) && <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'done')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={15} /> تم الحل</button>}
                      {!['closed'].includes(item.status) && <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'closed')} className="inline-flex items-center gap-1 rounded-xl bg-slate-600 px-3 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50"><X size={15} /> إغلاق</button>}
                      <button disabled={actionBusy} onClick={() => escalateTicket(item)} className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50">⚠️ تصعيد للإدارة</button>
                      <button disabled={actionBusy} onClick={() => routeTicketToRefund(item)} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50"><RotateCcw size={15} /> تحويل لقسم الاسترداد</button>
                      {isAdmin && <button disabled={actionBusy} onClick={() => deleteTicketApi(item)} className="inline-flex items-center gap-1 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 size={15} /> أرشفة</button>}
                    </>
                  ) : item.source === 'contact' ? (
                    <>
                      {item.status !== 'pending' && <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'pending')} className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"><RefreshCw size={15} /> تعليم كمقروء</button>}
                      {item.status !== 'done' && <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'done')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={15} /> تم الرد</button>}
                    </>
                  ) : (
                    // join_* requests
                    isClosed ? (
                      <span className="text-sm text-slate-400">تم حسم هذا الطلب.</span>
                    ) : (
                      <>
                        <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'pending')} className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"><RefreshCw size={15} /> قيد المراجعة</button>
                        <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'done')} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={15} /> قبول</button>
                        <button disabled={actionBusy} onClick={() => updateItemStatus(item, 'rejected')} className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"><XCircle size={15} /> رفض</button>
                      </>
                    )
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Canned responses management modal */}
      {cannedManageOpen && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => { setCannedManageOpen(false); setCannedDraft({ title: '', body: '' }); }}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900">إدارة الردود الجاهزة</h3>
              <button onClick={() => { setCannedManageOpen(false); setCannedDraft({ title: '', body: '' }); }} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3 overflow-y-auto">
              <div className="space-y-2 border border-slate-100 rounded-xl p-3 bg-slate-50">
                <p className="text-xs font-semibold text-slate-500">{cannedDraft.id ? 'تعديل رد' : 'إضافة رد جديد'}</p>
                <input value={cannedDraft.title} onChange={(e) => setCannedDraft((d) => ({ ...d, title: e.target.value }))}
                  placeholder="العنوان (مثال: تأكيد الحل)"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                <textarea value={cannedDraft.body} onChange={(e) => setCannedDraft((d) => ({ ...d, body: e.target.value }))}
                  placeholder="نص الرد الجاهز..." rows={3}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
                <div className="flex gap-2">
                  <button onClick={saveCanned} className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-indigo-700">{cannedDraft.id ? 'حفظ التعديل' : 'إضافة'}</button>
                  {cannedDraft.id && <button onClick={() => setCannedDraft({ title: '', body: '' })} className="px-4 py-1.5 rounded-lg text-sm border border-slate-200 text-slate-600 hover:bg-slate-50">إلغاء</button>}
                </div>
              </div>
              <div className="space-y-1.5">
                {canned.length === 0 && <p className="text-center text-slate-400 text-sm py-4">لا توجد ردود محفوظة بعد</p>}
                {canned.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 border border-slate-100 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-slate-800">{c.title}</div>
                      <div className="text-xs text-slate-500 truncate">{c.body}</div>
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
