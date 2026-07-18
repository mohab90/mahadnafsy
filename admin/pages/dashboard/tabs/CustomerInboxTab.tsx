import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase,
  CheckCircle2,
  GraduationCap,
  Inbox,
  Mail,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  Ticket,
  XCircle,
} from 'lucide-react';

import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';

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

function workflowPriorityToTicketPriority(priority: InboxPriority) {
  if (priority === 'urgent') return 'urgent';
  if (priority === 'high') return 'high';
  return 'medium';
}

export default function CustomerInboxTab({ notify }: { notify: NotifyFn }) {
  const navigate = useNavigate();
  const { contactMessages, joinUsApplications } = useSiteData();
  const [tickets, setTickets] = useState<any[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | InboxSource>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InboxStatus>('all');
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, { status: InboxStatus; originalStatus: string }>>({});

  const loadRemote = useCallback(async () => {
    setLoading(true);
    try {
      const [ticketRows, refundRows] = await Promise.all([
        mysqlAdmin.adminGet<any[]>('/admin/tickets').catch(() => []),
        mysqlAdmin.adminGet<RefundRow[]>('/admin/finance/refunds').catch(() => []),
      ]);
      setTickets(Array.isArray(ticketRows) ? ticketRows : []);
      setRefunds(Array.isArray(refundRows) ? refundRows : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل صندوق خدمة العملاء');
    } finally {
      setLoading(false);
    }
  }, [notify]);

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
    }));

    const contactItems = contactMessages.map((row) => ({
      id: row.id,
      source: 'contact' as const,
      title: row.subject || 'رسالة من الموقع',
      person: row.name,
      contact: row.phone || row.email || '',
      detail: row.message,
      status: mapStatus(row.status),
      originalStatus: row.status,
      createdAt: row.createdAt,
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
    }));

    const joinItems = joinUsApplications.map((row) => ({
      id: row.id,
      source: row.type === 'consultant' ? 'join_consultant' as const : ['instructor', 'lecturer', 'teacher', 'academic'].includes(String(row.type || '').toLowerCase()) ? 'join_instructor' as const : 'join_staff' as const,
      title: row.type === 'consultant' ? 'طلب انضمام استشاري' : ['instructor', 'lecturer', 'teacher', 'academic'].includes(String(row.type || '').toLowerCase()) ? 'طلب انضمام محاضر' : 'طلب انضمام موظف',
      person: row.name,
      contact: row.phone || row.email,
      detail: row.specialty || row.message || '',
      status: mapStatus(row.status),
      originalStatus: row.status,
      createdAt: row.createdAt,
    }));

    return [...ticketItems, ...contactItems, ...refundItems, ...joinItems]
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [contactMessages, joinUsApplications, refunds, tickets]);

  const resolvedItems = useMemo(() => items.map((item) => {
    const override = statusOverrides[`${item.source}-${item.id}`];
    return override ? { ...item, ...override } : item;
  }), [items, statusOverrides]);

  const updateItemStatus = useCallback(async (item: InboxItem, target: InboxStatus) => {
    const key = `${item.source}-${item.id}`;
    setUpdatingKey(key);
    try {
      let originalStatus: string = target;
      if (item.source === 'ticket') {
        originalStatus = target === 'done' ? 'resolved' : target === 'closed' ? 'closed' : 'in_progress';
        await mysqlAdmin.adminPut(`/admin/tickets/${encodeURIComponent(item.id)}`, {
          status: originalStatus,
          priority: target === 'pending' ? 'high' : workflowPriorityToTicketPriority(resolveWorkflow(item).priority),
        });
      } else if (item.source === 'contact') {
        originalStatus = target === 'done' ? 'replied' : 'read';
        await mysqlAdmin.updateContactMessage(item.id, originalStatus);
      } else if (item.source === 'refund') {
        originalStatus = target === 'rejected' ? 'REJECTED' : 'APPROVED';
        await mysqlAdmin.adminPut(`/admin/finance/refunds/${encodeURIComponent(item.id)}`, {
          status: originalStatus,
          notes: target === 'rejected' ? 'Rejected from unified inbox' : 'Approved from unified inbox',
        });
      } else {
        originalStatus = target === 'done' ? 'accepted' : target === 'rejected' ? 'rejected' : 'reviewed';
        await mysqlAdmin.updateJoinUs(item.id, originalStatus);
      }
      setStatusOverrides((current) => ({ ...current, [key]: { status: target, originalStatus } }));
      notify('success', 'تم تحديث حالة العنصر');
      if (item.source === 'ticket' || item.source === 'refund') loadRemote();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحديث الحالة');
    } finally {
      setUpdatingKey(null);
    }
  }, [loadRemote, notify]);

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
            <p className="mt-1 text-sm text-slate-500">يجمع الدعم، التواصل، الاستردادات، وطلبات انضمام المحاضرين/الاستشاريين في شاشة تشغيل واحدة.</p>
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
                <div key={`${item.source}-${item.id}`} className="grid gap-3 p-4 transition hover:bg-slate-50 xl:grid-cols-[180px_1fr_260px_130px_150px] xl:items-center">
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
                    <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-bold ${workflow.priority === 'urgent' ? 'bg-red-600 text-white' : workflow.priority === 'high' ? 'bg-amber-600 text-white' : 'bg-slate-200 text-slate-700'}`}>{workflow.priority}</span>
                  </div>
                  <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                    {STATUS_LABEL[item.status]}{item.originalStatus ? ` · ${item.originalStatus}` : ''}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {!['done', 'closed', 'rejected'].includes(item.status) && item.source !== 'refund' && (
                      <button
                        type="button"
                        disabled={updatingKey === `${item.source}-${item.id}`}
                        onClick={() => updateItemStatus(item, 'pending')}
                        className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                      >
                        <RefreshCw size={12} /> قيد المراجعة
                      </button>
                    )}
                    {!['done', 'closed'].includes(item.status) && (
                      <button
                        type="button"
                        disabled={updatingKey === `${item.source}-${item.id}`}
                        onClick={() => updateItemStatus(item, 'done')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <CheckCircle2 size={12} /> إنهاء
                      </button>
                    )}
                    {!['done', 'closed', 'rejected'].includes(item.status) && (item.source === 'refund' || item.source.startsWith('join_')) && (
                      <button
                        type="button"
                        disabled={updatingKey === `${item.source}-${item.id}`}
                        onClick={() => updateItemStatus(item, 'rejected')}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                      >
                        <XCircle size={12} /> رفض
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/dashboard/${meta.tab}`)}
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
    </div>
  );
}
