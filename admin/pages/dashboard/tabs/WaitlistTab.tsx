import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Phone, Mail, Users, RefreshCw, XCircle, Loader2, Filter, UserPlus } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useSiteData } from '../../../context/SiteDataContext';
import type { LeadItem } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type WaitlistEntry = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  course_id: string | null;
  course_name: string | null;
  notes: string | null;
  status: 'waiting' | 'contacted' | 'enrolled' | 'converted' | 'cancelled';
  branch: string;
  created_at: string;
  updated_at: string;
};

const STATUS_LABELS: Record<WaitlistEntry['status'], string> = {
  waiting: 'في الانتظار',
  contacted: 'تم التواصل',
  enrolled: 'مُسجَّل',
  converted: 'تم التحويل إلى Lead',
  cancelled: 'ملغى',
};

const STATUS_COLORS: Record<WaitlistEntry['status'], string> = {
  waiting: 'bg-amber-100 text-amber-800',
  contacted: 'bg-blue-100 text-blue-800',
  enrolled: 'bg-emerald-100 text-emerald-800',
  converted: 'bg-violet-100 text-violet-800',
  cancelled: 'bg-gray-100 text-gray-500',
};

const BRANCH_LABELS: Record<string, string> = {
  DAQQI: 'الدقي', TAGAMOA: 'التجمع', ONLINE_EGYPT: 'أونلاين مصر',
  ONLINE_SAUDI: 'أونلاين السعودية', ONLINE_ABROAD: 'أونلاين الخارج', OTHER: 'أخرى',
};

export default function WaitlistTab({ notify }: { notify: NotifyFn }) {
  const { addLead, issueClientCodeAsync } = useSiteData();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('waiting');
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (branchFilter) params.set('branch', branchFilter);
      const data = await mysqlAdmin.adminGet<WaitlistEntry[]>(`/admin/waitlist?${params}`);
      setEntries(Array.isArray(data) ? data : []);
    } catch { notify('error', 'فشل تحميل قائمة الانتظار'); }
    finally { setLoading(false); }
  }, [statusFilter, branchFilter, notify]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: WaitlistEntry['status']) => {
    setUpdatingId(id);
    try {
      await mysqlAdmin.adminPatch(`/admin/waitlist/${id}`, { status });
      setEntries(prev => prev.map(e => e.id === id ? { ...e, status } : e));
      notify('success', `تم تحديث الحالة إلى: ${STATUS_LABELS[status]}`);
    } catch { notify('error', 'فشل تحديث الحالة'); }
    finally { setUpdatingId(null); }
  };

  const convertToLead = async (entry: WaitlistEntry) => {
    if (!window.confirm(`تحويل "${entry.name}" إلى Lead؟`)) return;
    setConvertingId(entry.id);
    try {
      const clientCode = await issueClientCodeAsync();
      const lead: LeadItem = {
        id: crypto.randomUUID(),
        name: entry.name,
        phone: entry.phone,
        email: entry.email || '',
        status: 'new',
        leadType: 'general',
        interestLevel: 'medium',
        source: 'waitlist',
        branch: (entry.branch as LeadItem['branch']) || 'DAQQI',
        notes: entry.notes ? `من قائمة الانتظار: ${entry.notes}` : 'من قائمة الانتظار',
        communications: [],
        interestedCourseIds: entry.course_id ? [entry.course_id] : [],
        createdAt: new Date().toISOString(),
        clientCode,
      };
      await addLead(lead);
      // SUB-03: this only creates a lead, not a real course enrollment — status
      // must say 'converted', not 'enrolled'.
      await mysqlAdmin.adminPatch(`/admin/waitlist/${entry.id}`, { status: 'converted' });
      setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: 'converted' } : e));
      notify('success', `تم تحويل ${entry.name} إلى Lead بكود ${clientCode}`);
    } catch { notify('error', 'فشل تحويل العميل إلى Lead'); }
    finally { setConvertingId(null); }
  };

  const statsByStatus = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1; return acc;
  }, {});

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">قائمة الانتظار</h2>
          <p className="text-sm text-gray-500 mt-0.5">إدارة طلبات الانتضمام المعلقة حسب الفرع</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm font-bold transition">
          <RefreshCw size={14} /> تحديث
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['waiting','contacted','enrolled','converted','cancelled'] as WaitlistEntry['status'][]).map(s => (
          <button key={s} onClick={() => setStatusFilter(s === statusFilter ? '' : s)}
            className={`p-4 rounded-2xl border text-right transition ${statusFilter === s ? 'border-primary-400 bg-primary-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <p className="text-2xl font-extrabold text-gray-900">{statsByStatus[s] || 0}</p>
            <p className="text-sm text-gray-500 mt-0.5">{STATUS_LABELS[s]}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Filter size={14} className="text-gray-400" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">كل الحالات</option>
          {(Object.entries(STATUS_LABELS) as [WaitlistEntry['status'], string][]).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white">
          <option value="">كل الفروع</option>
          {Object.entries(BRANCH_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-primary-500" />
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <Users size={40} className="mb-2 opacity-30" />
            <p className="text-sm">لا توجد طلبات</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs font-semibold">
                  <th className="px-4 py-3 text-right">الاسم</th>
                  <th className="px-4 py-3 text-right">التواصل</th>
                  <th className="px-4 py-3 text-right">الكورس</th>
                  <th className="px-4 py-3 text-right">الفرع</th>
                  <th className="px-4 py-3 text-right">الحالة</th>
                  <th className="px-4 py-3 text-right">التاريخ</th>
                  <th className="px-4 py-3 text-right">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-medium text-gray-900">{e.name}</td>
                    <td className="px-4 py-3">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-gray-700"><Phone size={11} />{e.phone}</div>
                        {e.email && <div className="flex items-center gap-1 text-gray-500 text-xs"><Mail size={11} />{e.email}</div>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{e.course_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{BRANCH_LABELS[e.branch] || e.branch}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_COLORS[e.status]}`}>
                        {STATUS_LABELS[e.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{e.created_at?.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      {(updatingId === e.id || convertingId === e.id) ? (
                        <Loader2 size={14} className="animate-spin text-gray-400" />
                      ) : (
                        <div className="flex gap-1">
                          {e.status === 'waiting' && (
                            <button onClick={() => updateStatus(e.id, 'contacted')}
                              className="p-1 rounded-lg hover:bg-blue-50 text-blue-600 transition" title="تم التواصل">
                              <Phone size={14} />
                            </button>
                          )}
                          {(e.status === 'waiting' || e.status === 'contacted') && (
                            <button onClick={() => updateStatus(e.id, 'enrolled')}
                              className="p-1 rounded-lg hover:bg-emerald-50 text-emerald-600 transition" title="تسجيل">
                              <CheckCircle2 size={14} />
                            </button>
                          )}
                          {(e.status === 'waiting' || e.status === 'contacted') && (
                            <button onClick={() => convertToLead(e)}
                              className="p-1 rounded-lg hover:bg-violet-50 text-violet-600 transition" title="تحويل إلى Lead">
                              <UserPlus size={14} />
                            </button>
                          )}
                          {e.status !== 'cancelled' && (
                            <button onClick={() => updateStatus(e.id, 'cancelled')}
                              className="p-1 rounded-lg hover:bg-red-50 text-red-400 transition" title="إلغاء">
                              <XCircle size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
