import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Ticket, Plus, Search, MessageSquare, Clock, CheckCircle, AlertCircle, XCircle, Star, X, Send, TrendingUp, Zap, ExternalLink, Download } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

type TicketStatus = 'open' | 'inprogress' | 'resolved' | 'closed';
type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
type TicketCategory = 'billing' | 'refund' | 'complaint' | 'technical' | 'course_access' | 'sales_inquiry' | 'consultation' | 'certificate' | 'general';

interface SupportTicket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  clientName: string;
  clientPhone?: string;
  clientEmail?: string;
  assigneeId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  respondedAt?: string;
  slaDueAt?: string;
  slaHours?: number;
  slaBreached?: boolean;
  escalatedTo?: string;
  escalatedAt?: string;
  messages: TicketMessage[];
  tags?: string[];
}

// Default SLA hours per priority
const SLA_BY_PRIORITY: Record<TicketPriority, number> = { urgent: 2, high: 4, medium: 24, low: 72 };

type CannedResponse = { id: string; title: string; body: string; category: string };

interface TicketMessage {
  id: string;
  text: string;
  author: string;
  isStaff: boolean;
  at: string;
}


const STATUS_CFG: Record<TicketStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  open:       { label: 'مفتوح',       color: 'text-blue-700',  bg: 'bg-blue-50 border-blue-200',   icon: <AlertCircle size={13} /> },
  inprogress: { label: 'جارٍ المعالجة', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', icon: <Clock size={13} /> },
  resolved:   { label: 'محلول',       color: 'text-green-700', bg: 'bg-green-50 border-green-200',  icon: <CheckCircle size={13} /> },
  closed:     { label: 'مغلق',        color: 'text-gray-600',  bg: 'bg-gray-50 border-gray-200',    icon: <XCircle size={13} /> },
};

const PRIORITY_CFG: Record<TicketPriority, { label: string; color: string; icon: string }> = {
  low:    { label: 'منخفضة', color: 'text-gray-500', icon: '🔵' },
  medium: { label: 'متوسطة', color: 'text-yellow-600', icon: '🟡' },
  high:   { label: 'عالية',  color: 'text-orange-600', icon: '🟠' },
  urgent: { label: 'عاجلة',  color: 'text-red-600', icon: '🔴' },
};

const CAT_LABELS: Record<TicketCategory, string> = {
  billing: '💳 مدفوعات وفواتير', refund: '💰 طلب استرداد', complaint: '⚠️ شكوى',
  technical: '💻 مشكلة تقنية', course_access: '📚 وصول للدورة', sales_inquiry: '🛒 استفسار مبيعات',
  consultation: '🩺 استشارة', certificate: '🎓 شهادات', general: '📌 عام',
};

const TicketsTab: React.FC<Props> = ({ notify }) => {
  const { staffMembers, subscribers } = useSiteData();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusHandledRef = useRef(false);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [slaFilter, setSlaFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [draft, setDraft] = useState<Partial<SupportTicket>>({});
  const [showCanned, setShowCanned] = useState(false);
  const [canned, setCanned] = useState<CannedResponse[]>([]);
  useEffect(() => {
    mysqlAdmin.adminGet<CannedResponse[]>('/admin/support/canned-responses').then(rows => setCanned(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, []);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const statusFromApi = (status?: string): TicketStatus => {
    if (status === 'in_progress') return 'inprogress';
    if (status === 'resolved' || status === 'closed' || status === 'open') return status;
    return 'open';
  };

  const statusToApi = (status: TicketStatus) => status === 'inprogress' ? 'in_progress' : status;

  const CATEGORY_KEYS: TicketCategory[] = ['billing', 'refund', 'complaint', 'technical', 'course_access', 'sales_inquiry', 'consultation', 'certificate', 'general'];
  const categoryFromApi = (category?: string): TicketCategory =>
    (CATEGORY_KEYS as string[]).includes(category || '') ? (category as TicketCategory) : 'general';

  const mapTicket = (row: any): SupportTicket => {
    const priority = (['low', 'medium', 'high', 'urgent'].includes(row.priority) ? row.priority : 'medium') as TicketPriority;
    const createdAt = row.created_at || row.createdAt || new Date().toISOString();
    const replies = Array.isArray(row.replies) ? row.replies : [];
    return {
      id: String(row.id),
      title: row.subject || row.title || 'تذكرة دعم',
      description: row.body || row.description || '',
      status: statusFromApi(row.status),
      priority,
      category: categoryFromApi(row.category),
      clientName: row.subscriber_name || row.clientName || row.subscriber_email || 'عميل',
      clientEmail: row.subscriber_email || row.clientEmail || '',
      assigneeId: row.assigned_to || row.assigneeId || '',
      createdAt,
      updatedAt: row.updated_at || row.updatedAt || createdAt,
      resolvedAt: row.resolved_at || row.resolvedAt || undefined,
      respondedAt: row.first_response_at || row.responded_at || row.respondedAt || undefined,
      slaDueAt: row.sla_due_at || row.slaDueAt || undefined,
      slaHours: row.sla_hours || row.slaHours || SLA_BY_PRIORITY[priority],
      slaBreached: row.sla === 'overdue' || !!(row.sla_breached || row.slaBreached),
      escalatedTo: row.escalated_to || row.escalatedTo || undefined,
      escalatedAt: row.escalated_at || row.escalatedAt || undefined,
      messages: replies.map((reply: any) => ({
        id: String(reply.id),
        text: reply.body || '',
        author: reply.author_name || (['client', 'subscriber'].includes(String(reply.author_type || '').toLowerCase()) ? 'العميل' : 'الإدارة'),
        isStaff: !['client', 'subscriber'].includes(String(reply.author_type || '').toLowerCase()),
        at: reply.created_at || new Date().toISOString(),
      })),
    };
  };

  const loadTickets = async () => {
    setLoading(true);
    try {
      const rows = await mysqlAdmin.adminGet<any[]>('/admin/tickets');
      setTickets(rows.map(mapTicket));
    } catch (error) {
      notify('error', 'تعذر تحميل تذاكر الدعم');
    } finally {
      setLoading(false);
      initialLoadDone.current = true;
    }
  };

  useEffect(() => { loadTickets(); }, []);

  useEffect(() => {
    if (selectedTicket) {
      const updated = tickets.find(t => t.id === selectedTicket.id);
      if (updated) setSelectedTicket(updated);
    }
  }, [tickets]);

  const supportTeam = staffMembers.filter(member =>
    member.status === 'active'
    && ['support', 'online_manager', 'collection', 'sales_collection_manager', 'accountant', 'sales', 'manager', 'admin']
      .includes(member.role)
  );

  const filtered = useMemo(() => tickets.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    if (slaFilter === 'breached' && !t.slaBreached) return false;
    if (slaFilter === 'ok' && t.slaBreached) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.title.toLowerCase().includes(q) || t.clientName.toLowerCase().includes(q) || (t.clientPhone || '').includes(q);
    }
    return true;
  }), [tickets, statusFilter, priorityFilter, slaFilter, search]);

  const stats = {
    open: tickets.filter(t => t.status === 'open').length,
    inprogress: tickets.filter(t => t.status === 'inprogress').length,
    resolved: tickets.filter(t => t.status === 'resolved').length,
    urgent: tickets.filter(t => t.priority === 'urgent' && t.status !== 'closed' && t.status !== 'resolved').length,
    breached: tickets.filter(t => t.slaBreached && t.status !== 'closed' && t.status !== 'resolved').length,
  };





  // Check SLA breaches every minute
  useEffect(() => {
    const check = () => {
      setTickets(prev => prev.map(t => {
        if (t.status === 'resolved' || t.status === 'closed') return t;
        if (t.respondedAt) return t.slaBreached ? { ...t, slaBreached: false } : t;
        const dueAt = t.slaDueAt
          ? new Date(t.slaDueAt).getTime()
          : new Date(t.createdAt).getTime() + (t.slaHours ?? SLA_BY_PRIORITY[t.priority]) * 3600 * 1000;
        const breached = Date.now() > dueAt;
        if (breached !== !!t.slaBreached) return { ...t, slaBreached: breached };
        return t;
      }));
    };
    check();
    const interval = setInterval(check, 60000);
    return () => clearInterval(interval);
  }, []);


  const createTicketApi = async () => {
    if (!draft.title?.trim() || !draft.description?.trim() || !draft.clientName?.trim()) {
      notify('error', 'أدخل العنوان ووصف المشكلة واسم العميل');
      return;
    }
    try {
      const { id } = await mysqlAdmin.adminPost<{ id: string }>('/admin/cs/tickets', {
        subject: draft.title,
        body: draft.description || '',
        name: draft.clientName,
        email: draft.clientEmail || '',
        category: draft.category || 'general',
        priority: draft.priority || 'medium',
        channel: 'phone',
      });
      if (draft.assigneeId && id) await mysqlAdmin.adminPut(`/admin/tickets/${id}/assign`, { staff_id: draft.assigneeId });
      setDraft({});
      setShowCreate(false);
      await loadTickets();
      notify('success', 'تم إنشاء التذكرة');
    } catch (error) {
      notify('error', 'تعذر إنشاء التذكرة');
    }
  };

  const updateStatusApi = async (id: string, status: TicketStatus) => {
    try {
      const closedReason = status === 'closed' ? window.prompt('اكتب سبب إغلاق التذكرة:')?.trim() : undefined;
      if (status === 'closed' && !closedReason) return;
      await mysqlAdmin.adminPut(`/admin/tickets/${id}/status`, {
        status: statusToApi(status),
        ...(closedReason ? { closed_reason: closedReason } : {}),
      });
      setTickets(prev => prev.map(t => t.id === id ? { ...t, status, updatedAt: new Date().toISOString(), ...(status === 'resolved' ? { resolvedAt: new Date().toISOString() } : {}) } : t));
      notify('success', `تم تحديث الحالة إلى "${STATUS_CFG[status].label}"`);
    } catch (error) {
      notify('error', 'تعذر تحديث حالة التذكرة');
    }
  };

  const assignTicketApi = async (id: string, staffId: string | null) => {
    try {
      await mysqlAdmin.adminPut(`/admin/tickets/${id}/assign`, { staff_id: staffId });
      setTickets(prev => prev.map(t => t.id === id ? { ...t, assigneeId: staffId || undefined, updatedAt: new Date().toISOString() } : t));
      notify('success', staffId ? 'تم تحويل التذكرة' : 'تم إلغاء الإسناد');
    } catch (error) {
      notify('error', 'تعذر تحويل التذكرة');
    }
  };

  const setCategoryApi = async (id: string, category: TicketCategory) => {
    try {
      await mysqlAdmin.adminPut(`/admin/tickets/${id}/route`, { category });
      setTickets(prev => prev.map(t => t.id === id ? { ...t, category, updatedAt: new Date().toISOString() } : t));
      notify('success', 'تم تصنيف التذكرة');
    } catch (error) {
      notify('error', 'تعذر تصنيف التذكرة');
    }
  };

  const setPriorityApi = async (id: string, priority: TicketPriority) => {
    try {
      await mysqlAdmin.adminPut(`/admin/tickets/${id}/priority`, { priority });
      setTickets(prev => prev.map(t => t.id === id ? { ...t, priority, updatedAt: new Date().toISOString() } : t));
      setSelectedTicket(prev => prev && prev.id === id ? { ...prev, priority } : prev);
      notify('success', `تم تغيير الأولوية إلى ${PRIORITY_CFG[priority].label}`);
    } catch (error) {
      notify('error', 'تعذر تغيير الأولوية');
    }
  };

  // ── Bulk actions on the current selection ────────────────────────────────
  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = (ids: string[]) => setSelectedIds(prev => prev.size === ids.length ? new Set() : new Set(ids));
  const clearSelection = () => setSelectedIds(new Set());

  const runBulk = async (label: string, fn: (id: string) => Promise<void>) => {
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    let ok = 0;
    for (const id of ids) {
      try { await fn(id); ok++; } catch { /* per-ticket error already surfaced by fn's own notify */ }
    }
    setBulkBusy(false);
    clearSelection();
    notify(ok === ids.length ? 'success' : 'error', `${label}: ${ok}/${ids.length} تذكرة`);
  };

  const bulkSetStatus = (status: TicketStatus) => {
    const closedReason = status === 'closed' ? window.prompt('اكتب سبب إغلاق التذاكر المحددة:')?.trim() : undefined;
    if (status === 'closed' && !closedReason) return;
    return runBulk('تحديث الحالة', id =>
      mysqlAdmin.adminPut(`/admin/tickets/${id}/status`, {
        status: statusToApi(status),
        ...(closedReason ? { closed_reason: closedReason } : {}),
      }).then(() => setTickets(prev => prev.map(t =>
        t.id === id ? { ...t, status, updatedAt: new Date().toISOString() } : t
      ))));
  };
  const bulkAssign = (staffId: string) => runBulk('التحويل', id =>
    mysqlAdmin.adminPut(`/admin/tickets/${id}/assign`, { staff_id: staffId || null })
      .then(() => setTickets(prev => prev.map(t => t.id === id ? { ...t, assigneeId: staffId || undefined, updatedAt: new Date().toISOString() } : t))));
  const bulkSetCategory = (category: TicketCategory) => runBulk('التصنيف', id =>
    mysqlAdmin.adminPut(`/admin/tickets/${id}/route`, { category })
      .then(() => setTickets(prev => prev.map(t => t.id === id ? { ...t, category, updatedAt: new Date().toISOString() } : t))));
  const bulkSetPriority = (priority: TicketPriority) => runBulk('تغيير الأولوية', id =>
    mysqlAdmin.adminPut(`/admin/tickets/${id}/priority`, { priority })
      .then(() => setTickets(prev => prev.map(t => t.id === id ? { ...t, priority, updatedAt: new Date().toISOString() } : t))));
  const bulkEscalate = () => {
    if (!window.confirm(`تصعيد ${selectedIds.size} تذكرة إلى الإدارة؟ سيتم تحويلها وإعادة تعيينها.`)) return;
    return runBulk('التصعيد', async id => { await escalateTicketApi(id, true); });
  };

  // Whatever the agent is looking at right now, as a file they can hand to
  // someone who does not have a dashboard login. BOM first so Excel opens the
  // Arabic columns as UTF-8 instead of mojibake.
  const exportSelected = () => {
    const rows = filtered.filter(t => selectedIds.size === 0 || selectedIds.has(t.id));
    if (rows.length === 0) { notify('info', 'لا توجد تذاكر للتصدير'); return; }
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['الرقم', 'الموضوع', 'العميل', 'البريد', 'الهاتف', 'الحالة', 'الأولوية', 'التصنيف', 'المسؤول', 'أُنشئت', 'آخر تحديث'];
    const csv = '﻿' + [
      header.map(cell).join(','),
      ...rows.map(t => [
        t.id, t.title, t.clientName, t.clientEmail, t.clientPhone,
        STATUS_CFG[t.status]?.label, PRIORITY_CFG[t.priority]?.label,
        CAT_LABELS[t.category], supportTeam.find(m => m.id === t.assigneeId)?.name || '',
        t.createdAt?.slice(0, 16).replace('T', ' '), t.updatedAt?.slice(0, 16).replace('T', ' '),
      ].map(cell).join(',')),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    notify('success', `تم تصدير ${rows.length} تذكرة`);
  };

  const addReplyApi = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    try {
      const currentText = replyText;
      await mysqlAdmin.adminPost(`/admin/tickets/${selectedTicket.id}/reply`, { body: currentText });
      const msg: TicketMessage = { id: Date.now().toString(), text: currentText, author: 'الإدارة', isStaff: true, at: new Date().toISOString() };
      setTickets(prev => prev.map(t => t.id === selectedTicket.id
        ? { ...t, status: t.status === 'open' ? 'inprogress' : t.status, messages: [...t.messages, msg], updatedAt: new Date().toISOString(), respondedAt: t.respondedAt || new Date().toISOString() }
        : t
      ));
      setReplyText('');
      setShowCanned(false);
      notify('success', 'تم إضافة الرد');
    } catch (error) {
      notify('error', 'تعذر إرسال الرد');
    }
  };

  // `silent` is for the bulk runner, which reports one summary at the end and
  // needs the failure to propagate so it can be counted rather than swallowed.
  const escalateTicketApi = async (id: string, silent = false) => {
    try {
      const res = await mysqlAdmin.adminPost<{ ok: boolean; assignee?: { id: string; name: string } }>(`/admin/tickets/${id}/escalate`, {});
      const managerName = res.assignee?.name || 'الإدارة';
      setTickets(prev => prev.map(t => t.id === id
        ? { ...t, escalatedTo: res.assignee?.id, escalatedAt: new Date().toISOString(), priority: 'urgent' as TicketPriority, assigneeId: res.assignee?.id || t.assigneeId, updatedAt: new Date().toISOString() }
        : t
      ));
      if (!silent) notify('info', `تم تصعيد التذكرة إلى ${managerName}`);
    } catch (error) {
      if (silent) throw error;
      notify('error', 'تعذر تصعيد التذكرة');
    }
  };

  const deleteTicketApi = async (id: string) => {
    try {
      await mysqlAdmin.adminDelete(`/admin/tickets/${id}`);
      setTickets(prev => prev.filter(t => t.id !== id));
      if (selectedTicket?.id === id) setSelectedTicket(null);
      notify('success', 'تم حذف التذكرة');
    } catch (error) {
      notify('error', 'تعذر حذف التذكرة');
    }
  };

  const selectTicketApi = async (ticket: SupportTicket, isSelected: boolean) => {
    if (isSelected) { setSelectedTicket(null); return; }
    setSelectedTicket(ticket);
    try {
      const row = await mysqlAdmin.adminGet<any>(`/admin/tickets/${ticket.id}`);
      const detailed = mapTicket(row);
      setTickets(prev => prev.map(t => t.id === detailed.id ? { ...t, ...detailed } : t));
      setSelectedTicket(detailed);
    } catch (error) {
      notify('error', 'تعذر تحميل تفاصيل التذكرة');
    }
  };

  // Deep-link: /dashboard/tickets?focus=<id> (e.g. from the unified CS inbox's
  // "فتح التفاصيل") auto-opens that ticket's conversation once tickets load,
  // then clears the param so closing it doesn't re-open on the next render.
  useEffect(() => {
    const focusId = searchParams.get('focus');
    if (!focusId || focusHandledRef.current || tickets.length === 0) return;
    const target = tickets.find(t => t.id === focusId);
    if (!target) return;
    focusHandledRef.current = true;
    selectTicketApi(target, false);
    const next = new URLSearchParams(searchParams);
    next.delete('focus');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, searchParams]);

  return (
    <div className="space-y-5" dir="rtl">
      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-3" />
          جاري تحميل التذاكر...
        </div>
      )}
      {!loading && (<>
      {/* Header */}
      <div className="bg-gradient-to-l from-cyan-700 to-blue-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Ticket size={22} /> تذاكر الدعم الفني</h2>
            <p className="text-blue-200 text-sm mt-0.5">إدارة ومتابعة طلبات وشكاوى العملاء</p>
          </div>
          <button onClick={() => { setShowCreate(true); setDraft({}); }}
            className="flex items-center gap-2 bg-white text-blue-700 font-bold px-4 py-2 rounded-xl hover:bg-blue-50 transition-colors text-sm">
            <Plus size={16} /> تذكرة جديدة
          </button>
        </div>
        <div className="grid grid-cols-5 gap-3 mt-4">
          {[
            { label: 'مفتوحة', value: stats.open, bg: 'bg-blue-500/30' },
            { label: 'جارية', value: stats.inprogress, bg: 'bg-amber-500/30' },
            { label: 'محلولة', value: stats.resolved, bg: 'bg-green-500/30' },
            { label: 'عاجلة', value: stats.urgent, bg: stats.urgent > 0 ? 'bg-red-500/30' : 'bg-white/10' },
            { label: 'تجاوزت SLA', value: stats.breached, bg: stats.breached > 0 ? 'bg-pink-500/30' : 'bg-white/10' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-2 text-center`}>
              <div className="text-2xl font-black">{s.value}</div>
              <div className="text-xs text-blue-200">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5" dir="rtl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-gray-800 text-lg">إنشاء تذكرة جديدة</h3>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <input value={draft.title || ''} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))}
                placeholder="عنوان المشكلة *" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <textarea value={draft.description || ''} onChange={e => setDraft(p => ({ ...p, description: e.target.value }))}
                placeholder="وصف تفصيلي للمشكلة..." rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none" />
              <div className="grid grid-cols-2 gap-3">
                <input value={draft.clientName || ''} onChange={e => setDraft(p => ({ ...p, clientName: e.target.value }))}
                  placeholder="اسم العميل *" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                <input value={draft.clientPhone || ''} onChange={e => setDraft(p => ({ ...p, clientPhone: e.target.value }))}
                  placeholder="رقم الهاتف" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <select value={draft.priority || 'medium'} onChange={e => setDraft(p => ({ ...p, priority: e.target.value as TicketPriority }))}
                  className="border border-gray-200 rounded-xl px-2 py-2 text-sm focus:outline-none">
                  {Object.entries(PRIORITY_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
                <select value={draft.category || 'general'} onChange={e => setDraft(p => ({ ...p, category: e.target.value as TicketCategory }))}
                  className="border border-gray-200 rounded-xl px-2 py-2 text-sm focus:outline-none">
                  {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select value={draft.assigneeId || ''} onChange={e => setDraft(p => ({ ...p, assigneeId: e.target.value }))}
                  className="border border-gray-200 rounded-xl px-2 py-2 text-sm focus:outline-none">
                  <option value="">— تعيين —</option>
                  {supportTeam.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3 mt-2">
                <button onClick={createTicketApi} className="flex-1 bg-blue-600 text-white py-2 rounded-xl font-bold text-sm hover:bg-blue-700">إنشاء التذكرة</button>
                <button onClick={() => setShowCreate(false)} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl font-bold text-sm hover:bg-gray-200">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative">
          <Search size={14} className="absolute right-3 top-2.5 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث..."
            className="pr-8 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-48" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
          <option value="all">كل الحالات</option>
          {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
          <option value="all">كل الأولويات</option>
          {Object.entries(PRIORITY_CFG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <select value={slaFilter} onChange={e => setSlaFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
          <option value="all">كل SLA</option>
          <option value="breached">⚠️ تجاوزت SLA</option>
          <option value="ok">✅ ضمن SLA</option>
        </select>
        <span className="text-sm text-gray-400 mr-auto">{filtered.length} تذكرة</span>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
          <span className="text-sm font-bold text-blue-800">{selectedIds.size} محددة</span>
          <select disabled={bulkBusy} onChange={e => { if (e.target.value) bulkSetStatus(e.target.value as TicketStatus); e.target.value = ''; }}
            defaultValue="" className="border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white disabled:opacity-50">
            <option value="" disabled>تغيير الحالة إلى...</option>
            {Object.entries(STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select disabled={bulkBusy} onChange={e => { bulkAssign(e.target.value); e.target.value = ''; }}
            defaultValue="" className="border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white disabled:opacity-50">
            <option value="" disabled>تحويل إلى موظف...</option>
            {supportTeam.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select disabled={bulkBusy} onChange={e => { if (e.target.value) bulkSetCategory(e.target.value as TicketCategory); e.target.value = ''; }}
            defaultValue="" className="border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white disabled:opacity-50">
            <option value="" disabled>تصنيف كـ...</option>
            {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select disabled={bulkBusy} onChange={e => { if (e.target.value) bulkSetPriority(e.target.value as TicketPriority); e.target.value = ''; }}
            defaultValue="" className="border border-blue-200 rounded-lg px-2 py-1.5 text-xs bg-white disabled:opacity-50">
            <option value="" disabled>تغيير الأولوية إلى...</option>
            {Object.entries(PRIORITY_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <button disabled={bulkBusy} onClick={bulkEscalate}
            className="text-xs px-3 py-1.5 rounded-lg border border-purple-300 bg-purple-50 text-purple-700 font-bold disabled:opacity-50 flex items-center gap-1">
            <TrendingUp size={12} /> تصعيد للإدارة
          </button>
          <button disabled={bulkBusy} onClick={exportSelected}
            className="text-xs px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 font-bold disabled:opacity-50 flex items-center gap-1">
            <Download size={12} /> تصدير CSV
          </button>
          <button disabled={bulkBusy} onClick={() => bulkSetStatus('closed')}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-700 text-white font-bold disabled:opacity-50">
            {bulkBusy ? 'جارٍ التنفيذ...' : '📦 أرشفة (إغلاق جماعي)'}
          </button>
          <button disabled={bulkBusy} onClick={clearSelection}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 mr-auto hover:bg-gray-50">إلغاء التحديد</button>
        </div>
      )}

      {/* Layout: list + detail */}
      <div className="flex gap-4" style={{ minHeight: '400px' }}>
        {/* Ticket list */}
        <div className={`space-y-2 ${selectedTicket ? 'w-[40%]' : 'w-full'} transition-all`}>
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Ticket size={40} className="mx-auto mb-3 opacity-20" />
              <p>لا توجد تذاكر</p>
            </div>
          ) : (<>
          <label className="flex items-center gap-2 text-xs text-gray-500 px-1 cursor-pointer select-none">
            <input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === filtered.length}
              onChange={() => toggleSelectAll(filtered.map(t => t.id))} className="rounded" />
            تحديد الكل
          </label>
          {filtered.map(ticket => {
            const s = STATUS_CFG[ticket.status];
            const p = PRIORITY_CFG[ticket.priority];
            const assignee = supportTeam.find(m => m.id === ticket.assigneeId);
            const age = Math.round((Date.now() - new Date(ticket.createdAt).getTime()) / 3600000);
            const ageLabel = age < 24 ? `منذ ${age}س` : `${Math.round(age / 24)} يوم`;
            const slaHours = ticket.slaHours ?? SLA_BY_PRIORITY[ticket.priority];
            const slaRemainingH = slaHours - age;
            const slaLabel = ticket.slaBreached ? '⚠️ تجاوز SLA' : slaRemainingH <= 2 ? `⏰ ${slaRemainingH}س` : null;
            const isSelected = selectedTicket?.id === ticket.id;
            return (
              <div key={ticket.id}
                onClick={() => selectTicketApi(ticket, isSelected)}
                className={`bg-white border rounded-xl p-3 cursor-pointer hover:shadow-md transition-all ${isSelected ? 'border-blue-400 shadow-md' : 'border-gray-200'} ${ticket.slaBreached ? 'border-l-4 border-l-pink-500' : ticket.priority === 'urgent' ? 'border-r-4 border-r-red-500' : ticket.priority === 'high' ? 'border-r-4 border-r-orange-400' : ''}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <input type="checkbox" checked={selectedIds.has(ticket.id)} onClick={e => e.stopPropagation()}
                      onChange={() => toggleSelect(ticket.id)} className="rounded mt-1 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-800 truncate">{ticket.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{ticket.clientName} {ticket.clientPhone && `· ${ticket.clientPhone}`}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full border shrink-0 flex items-center gap-0.5 ${s.bg} ${s.color}`}>
                    {s.icon} {s.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2 text-xs">
                  <span className={`${p.color} font-medium`}>{p.icon} {p.label}</span>
                  <span className="text-gray-400">·</span>
                  <span className="text-gray-400">{CAT_LABELS[ticket.category]}</span>
                  <span className="text-gray-300 mr-auto">·</span>
                  <span className="text-gray-400">{ageLabel}</span>
                  {assignee && <span className="text-indigo-500">@{assignee.name.split(' ')[0]}</span>}
                  {ticket.messages.length > 0 && <span className="text-gray-400 flex items-center gap-0.5"><MessageSquare size={9} /> {ticket.messages.length}</span>}
                  {slaLabel && <span className={`font-bold text-xs ${ticket.slaBreached ? 'text-pink-600' : 'text-amber-600'}`}>{slaLabel}</span>}
                  {ticket.escalatedAt && <span className="text-purple-500 text-xs flex items-center gap-0.5"><TrendingUp size={9} /> مُصعَّد</span>}
                </div>
              </div>
            );
          })}
          </>)}
        </div>

        {/* Ticket detail */}
        {selectedTicket && (
          <div className="flex-1 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: '600px' }}>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-gray-800">{selectedTicket.title}</h3>
                <p className="text-xs text-gray-400">{selectedTicket.clientName} · {selectedTicket.createdAt.slice(0, 10)}</p>
              </div>
              <button onClick={() => setSelectedTicket(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            {/* Actions */}
            <div className="px-4 py-2 border-b border-gray-50 flex gap-2 flex-wrap">
              {(['open', 'inprogress', 'resolved', 'closed'] as TicketStatus[]).map(s => (
                <button key={s} onClick={() => updateStatusApi(selectedTicket.id, s)}
                  className={`text-xs px-2 py-1 rounded-lg border transition-colors ${selectedTicket.status === s ? `${STATUS_CFG[s].bg} ${STATUS_CFG[s].color} font-bold` : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                  {STATUS_CFG[s].label}
                </button>
              ))}
              {!selectedTicket.escalatedAt && (
                <button onClick={() => escalateTicketApi(selectedTicket.id)}
                  className="text-xs px-2 py-1 rounded-lg border border-purple-200 text-purple-600 hover:bg-purple-50 flex items-center gap-1">
                  <TrendingUp size={11} /> تصعيد
                </button>
              )}
              {selectedTicket.escalatedAt && (
                <span className="text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-600 flex items-center gap-1">
                  <TrendingUp size={11} /> مُصعَّد {selectedTicket.escalatedAt.slice(0, 10)}
                </span>
              )}
              {selectedTicket.slaBreached && (
                <span className="text-xs px-2 py-1 rounded-lg bg-pink-50 text-pink-600 flex items-center gap-1">
                  <Zap size={11} /> تجاوز SLA
                </span>
              )}
              <select value={selectedTicket.assigneeId || ''} onChange={e => assignTicketApi(selectedTicket.id, e.target.value || null)}
                className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 bg-white">
                <option value="">— تحويل لموظف —</option>
                {supportTeam.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={selectedTicket.category} onChange={e => setCategoryApi(selectedTicket.id, e.target.value as TicketCategory)}
                className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 bg-white">
                {Object.entries(CAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {/* Priority was fixed at creation until now: the only way to raise a
                  mis-triaged ticket was to escalate it, which also hands it to
                  management. This changes the urgency without moving the owner. */}
              <select value={selectedTicket.priority} onChange={e => setPriorityApi(selectedTicket.id, e.target.value as TicketPriority)}
                className={`text-xs px-2 py-1 rounded-lg border bg-white font-bold ${PRIORITY_CFG[selectedTicket.priority]?.color || 'text-gray-600'} border-gray-200`}>
                {Object.entries(PRIORITY_CFG).map(([k, v]) => <option key={k} value={k}>أولوية: {v.label}</option>)}
              </select>
              <button onClick={() => {
                  const em = (selectedTicket.clientEmail || '').toLowerCase().trim();
                  const ph = (selectedTicket.clientPhone || '').replace(/\D/g, '');
                  const sub = subscribers.find(s =>
                    (em && (s.email || '').toLowerCase().trim() === em) ||
                    (ph.length >= 6 && (s.phone || '').replace(/\D/g, '').includes(ph))
                  );
                  if (sub) navigate(`/client/${sub.clientCode || sub.id}`);
                  else notify('info', 'لا يوجد عميل مسجّل بنفس البريد أو الهاتف');
                }}
                className="text-xs px-2 py-1 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 flex items-center gap-1">
                <ExternalLink size={11} /> ملف العميل
              </button>
              <button onClick={() => deleteTicketApi(selectedTicket.id)}
                className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 mr-auto">حذف</button>
            </div>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {selectedTicket.description && (
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">وصف المشكلة:</p>
                  <p className="text-sm text-gray-700">{selectedTicket.description}</p>
                </div>
              )}
              {selectedTicket.messages.map(msg => (
                <div key={msg.id} className={`flex ${msg.isStaff ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 ${msg.isStaff ? 'bg-blue-50 text-blue-800' : 'bg-gray-100 text-gray-800'}`}>
                    <p className="text-xs font-bold mb-0.5 opacity-60">{msg.author}</p>
                    <p className="text-sm">{msg.text}</p>
                    <p className="text-xs opacity-50 mt-1">{msg.at.slice(0, 16).replace('T', ' ')}</p>
                  </div>
                </div>
              ))}
            </div>
            {/* Canned responses picker */}
            {showCanned && (
              <div className="px-4 pb-2 border-t border-gray-100">
                <p className="text-xs text-gray-400 my-1.5">ردود جاهزة:</p>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {canned.length === 0 ? (
                    <p className="text-center text-gray-400 text-xs py-2">لا توجد ردود جاهزة محفوظة (أضِفها من قسم Inbox خدمة العملاء)</p>
                  ) : canned.map(c => (
                    <button key={c.id} onClick={() => { setReplyText(c.body); setShowCanned(false); }}
                      className="w-full text-right text-xs px-3 py-1.5 bg-gray-50 hover:bg-blue-50 rounded-lg text-gray-700 hover:text-blue-700 transition-colors">
                      <span className="font-bold">{c.title}</span> — <span className="opacity-70">{c.body.slice(0, 50)}…</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Reply */}
            <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
              <button onClick={() => setShowCanned(p => !p)} title="ردود جاهزة"
                className={`px-2 py-2 rounded-xl border text-xs transition-colors ${showCanned ? 'bg-blue-50 border-blue-300 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                <Star size={14} />
              </button>
              <input value={replyText} onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addReplyApi(); } }}
                placeholder="اكتب ردك هنا..."
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
              <button onClick={addReplyApi} className="bg-blue-600 text-white px-3 py-2 rounded-xl hover:bg-blue-700 transition-colors">
                <Send size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
      </>)}
    </div>
  );
};

export default TicketsTab;
