import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { User, Clock, FileText, Activity, Calendar, Star, Shield, Edit2, Plus, X, CheckCircle, XCircle } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const ACTION_LABEL: Record<string, string> = {
  login: 'تسجيل دخول', logout: 'تسجيل خروج',
  create: 'إنشاء', update: 'تحديث', delete: 'حذف',
  assign: 'إسناد', convert: 'تحويل', payment: 'دفع',
  view: 'مشاهدة', export: 'تصدير',
};

export default function MyHrTab({ notify }: { notify: NotifyFn }) {
  const { staffMembers, activityLogs, leads, orders, authUser, staffScopedLeads, staffScopedSubscribers } = useSiteData() as any;
  const [activeSection, setActiveSection] = useState<'overview' | 'activity' | 'performance' | 'leaves'>('overview');

  // Use scoped data for non-admin staff; fall back to full context for admins
  const effectiveLeads = (staffScopedLeads?.length > 0 ? staffScopedLeads : leads) || [];
  const effectiveOrders = useMemo(() => {
    if (orders?.length > 0) return orders;
    // Build synthetic orders from scoped subscribers payment history
    return (staffScopedSubscribers || []).flatMap((s: any) =>
      (s.paymentHistory || []).map((p: any) => ({
        id: p.id, staffId: p.staffId, amount: Number(p.amount) || 0,
        currency: p.currency || 'EGP', status: 'paid', createdAt: p.at || s.createdAt || '',
      }))
    );
  }, [orders, staffScopedSubscribers]);

  // ── Leaves state ─────────────────────────────────────────────
  const [myLeavesList, setMyLeavesList] = useState<any[]>([]);
  const [loadingMyLeaves, setLoadingMyLeaves] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ type: 'ANNUAL', start_date: '', end_date: '', reason: '' });

  const LEAVE_TYPE_LABELS: Record<string, string> = {
    ANNUAL: 'إجازة سنوية', SICK: 'إجازة مرضية', UNPAID: 'إجازة بدون راتب',
    MATERNITY: 'إجازة أمومة', EMERGENCY: 'إجازة طارئة',
    PERMISSION: 'إذن', OTHER: 'أخرى',
  };
  const LEAVE_STATUS_LABELS: Record<string, string> = {
    PENDING: 'معلق', APPROVED: 'موافق عليه', REJECTED: 'مرفوض', CANCELLED: 'ملغي',
  };
  const LEAVE_STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-700', APPROVED: 'bg-emerald-100 text-emerald-700',
    REJECTED: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-500',
  };

  const me = useMemo(() =>
    staffMembers.find((s: any) => s.id === (authUser as any)?.id || s.email === (authUser as any)?.email),
    [staffMembers, authUser]
  );

  const MONTH = new Date().toISOString().slice(0, 7);
  const monthStart = `${MONTH}-01`;

  const myLogs = useMemo(() =>
    (activityLogs || []).filter((l: any) => l.staffId === me?.id || l.userId === me?.id)
                 .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))
                 .slice(0, 50),
    [activityLogs, me]
  );

  const myLeads = useMemo(() =>
    effectiveLeads.filter((l: any) => l.assignedSalesId === me?.id || effectiveLeads.length === (staffScopedLeads?.length || 0)),
    [effectiveLeads, me, staffScopedLeads]
  );

  const myMonthLeads = myLeads.filter((l: any) => (l.createdAt || '') >= monthStart);
  const myMonthConverted = myMonthLeads.filter((l: any) => l.status === 'converted');
  const myMonthRevenue = useMemo(() =>
    effectiveOrders.filter((o: any) => o.staffId === me?.id && (o.createdAt || '') >= monthStart && o.status === 'paid')
          .reduce((acc: number, o: any) => acc + (Number(o.amount) || 0), 0),
    [effectiveOrders, me, monthStart]
  );

  const ROLE_LABEL: Record<string, string> = {
    sales: 'سيلز', collection: 'تحصيل', support: 'خدمة عملاء',
    manager: 'مدير', online_manager: 'مدير أونلاين', consultant: 'استشاري',
    admin: 'مدير النظام', hr: 'موارد بشرية', sales_collection_manager: 'مدير مبيعات وتحصيل',
  };

  const fetchMyLeaves = useCallback(async () => {
    if (!me?.id) return;
    setLoadingMyLeaves(true);
    try {
      const res = await fetch(`/api/admin/hr/leaves?staff_id=${me.id}`, { credentials: 'include' });
      if (res.ok) setMyLeavesList(await res.json());
    } catch { /* silently fail */ } finally { setLoadingMyLeaves(false); }
  }, [me?.id]);

  useEffect(() => { if (activeSection === 'leaves') fetchMyLeaves(); }, [activeSection, fetchMyLeaves]);

  const submitLeave = useCallback(async () => {
    if (!leaveForm.start_date || !leaveForm.end_date || !me?.id) return;
    try {
      const res = await fetch('/api/admin/hr/leaves', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: me.id, leave_type: leaveForm.type, start_date: leaveForm.start_date, end_date: leaveForm.end_date, reason: leaveForm.reason }),
      });
      if (res.ok) {
        notify('success', 'تم إرسال طلب الإجازة ✅');
        setShowLeaveForm(false);
        setLeaveForm({ type: 'ANNUAL', start_date: '', end_date: '', reason: '' });
        fetchMyLeaves();
      } else { const d = await res.json(); notify('error', d.error || 'فشل الإرسال'); }
    } catch { notify('error', 'خطأ في الاتصال'); }
  }, [leaveForm, me?.id, notify, fetchMyLeaves]);

  const SECTIONS = [
    { key: 'overview', label: 'نظرة عامة', icon: User },
    { key: 'activity', label: 'سجل النشاط', icon: Activity },
    { key: 'performance', label: 'أدائي', icon: Star },
    { key: 'leaves', label: 'إجازاتي', icon: Calendar },
  ] as const;

  if (!me && !authUser) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400">
        <User size={40} className="mx-auto mb-3 text-gray-300" />
        <p>لم يتم العثور على بياناتك في النظام</p>
      </div>
    );
  }

  const profile = me || authUser;

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-slate-700 to-gray-800 rounded-2xl p-5 text-white">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-2xl font-extrabold flex-shrink-0">
            {(profile?.name || 'أ').charAt(0)}
          </div>
          <div>
            <h2 className="text-xl font-bold">{profile?.name || 'الموظف'}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="bg-white/20 px-2 py-0.5 rounded-lg text-xs">{ROLE_LABEL[profile?.role || ''] || profile?.role || '—'}</span>
              {profile?.email && <span className="text-gray-300 text-xs">{profile.email}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-2 flex-wrap">
        {SECTIONS.map(s => {
          const Icon = s.icon;
          return (
            <button key={s.key} onClick={() => setActiveSection(s.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition ${activeSection === s.key ? 'bg-gray-800 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              <Icon size={15} />{s.label}
            </button>
          );
        })}
      </div>

      {/* Overview */}
      {activeSection === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'ليداتي (الكل)', val: myLeads.length, color: 'blue' },
              { label: 'الشهر الحالي', val: myMonthLeads.length, color: 'indigo' },
              { label: 'تحويلات الشهر', val: myMonthConverted.length, color: 'emerald' },
              { label: 'إيراد الشهر', val: `${(myMonthRevenue / 1000).toFixed(1)}ك ج`, color: 'violet' },
            ].map(k => (
              <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 text-center`}>
                <div className="text-xl font-extrabold text-gray-900">{k.val}</div>
                <div className="text-xs text-gray-500 mt-1">{k.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><FileText size={16} className="text-gray-500" />معلوماتي الشخصية</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {[
                { label: 'الاسم', val: profile?.name },
                { label: 'البريد الإلكتروني', val: profile?.email },
                { label: 'الدور الوظيفي', val: ROLE_LABEL[profile?.role || ''] || profile?.role },
                { label: 'الحالة', val: me?.status === 'active' ? 'نشط' : 'غير نشط' },
                { label: 'تاريخ الانضمام', val: me?.createdAt?.slice(0, 10) || '—' },
                { label: 'آخر تحديث', val: me?.updatedAt?.slice(0, 10) || '—' },
              ].map(f => (
                <div key={f.label} className="flex gap-2">
                  <span className="text-gray-500 w-32 flex-shrink-0">{f.label}:</span>
                  <span className="font-semibold text-gray-800">{f.val || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Activity log */}
      {activeSection === 'activity' && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Activity size={16} />سجل نشاطي</h3>
            <span className="text-xs text-gray-400">{myLogs.length} سجل</span>
          </div>
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {myLogs.length === 0 ? (
              <div className="p-10 text-center text-gray-400">لا توجد سجلات نشاط</div>
            ) : (
              myLogs.map((log, i) => (
                <div key={log.id || i} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition">
                  <div className="w-2 h-2 rounded-full bg-gray-300 mt-2 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800">
                      <span className="font-semibold">{ACTION_LABEL[log.action] || log.action}</span>
                      {log.description && <span className="text-gray-500"> — {log.description}</span>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{(log.createdAt || '').slice(0, 16).replace('T', ' ')}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Performance */}
      {activeSection === 'performance' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Star size={16} className="text-amber-500" />أدائي هذا الشهر</h3>
            <div className="space-y-4">
              {[
                { label: 'ليدات مُسندة', current: myMonthLeads.length, max: 30 },
                { label: 'تحويلات', current: myMonthConverted.length, max: myMonthLeads.length || 1 },
                { label: 'معدل التحويل', current: myMonthLeads.length > 0 ? Math.round((myMonthConverted.length / myMonthLeads.length) * 100) : 0, max: 100, isPercent: true },
              ].map(m => (
                <div key={m.label}>
                  <div className="flex items-center justify-between mb-1 text-sm">
                    <span className="text-gray-700">{m.label}</span>
                    <span className="font-bold text-gray-900">{m.current}{m.isPercent ? '%' : ''}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-2 rounded-full transition-all ${m.current / m.max > 0.7 ? 'bg-emerald-400' : m.current / m.max > 0.4 ? 'bg-amber-400' : 'bg-gray-300'}`}
                      style={{ width: `${Math.min(100, (m.current / m.max) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-amber-800 text-sm">
            <strong>ملاحظة:</strong> بيانات الأداء تعكس الليدات والطلبات المسندة لك شخصياً في النظام.
          </div>
        </div>
      )}

      {/* Leaves section */}
      {activeSection === 'leaves' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Calendar size={16}/> إجازاتي وطلباتي</h3>
            <button onClick={() => setShowLeaveForm(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition flex items-center gap-2"><Plus size={14}/> طلب إجازة جديدة</button>
          </div>

          {loadingMyLeaves ? (
            <div className="text-center py-8 text-gray-400">
              <div className="animate-spin w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full mx-auto mb-3"/>
              <p className="text-sm">جاري تحميل إجازاتك...</p>
            </div>
          ) : (
            <div className="space-y-2">
              {myLeavesList.length === 0 ? (
                <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center text-gray-400">
                  <Calendar size={36} className="mx-auto mb-2 opacity-20"/>
                  <p className="text-sm">لا توجد طلبات إجازة</p>
                  <p className="text-xs mt-1 text-gray-300">اضغط "طلب إجازة جديدة" لتقديم طلب</p>
                </div>
              ) : myLeavesList.map(leave => (
                <div key={leave.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${LEAVE_STATUS_COLORS[leave.status] || 'bg-gray-100'}`}>{LEAVE_STATUS_LABELS[leave.status] || leave.status}</span>
                    <span className="text-xs font-bold text-gray-700">{LEAVE_TYPE_LABELS[leave.leave_type] || leave.leave_type}</span>
                    <span className="text-xs text-gray-500">{leave.start_date?.slice(0, 10)} — {leave.end_date?.slice(0, 10)}</span>
                    <span className="text-xs text-gray-500 font-semibold">{leave.total_days} {leave.total_days === 1 ? 'يوم' : 'أيام'}</span>
                  </div>
                  {leave.reason && <p className="text-xs text-gray-400">{leave.reason}</p>}
                  {leave.approved_by_name && leave.status !== 'PENDING' && (
                    <p className="text-[10px] text-gray-400 mt-1">
                      {leave.status === 'APPROVED' ? <CheckCircle size={10} className="inline text-emerald-500 mr-1"/> : <XCircle size={10} className="inline text-red-400 mr-1"/>}
                      بواسطة: {leave.approved_by_name}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Leave form modal */}
          {showLeaveForm && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowLeaveForm(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" dir="rtl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2"><Calendar size={16}/> طلب إجازة جديدة</h3>
                  <button onClick={() => setShowLeaveForm(false)} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
                </div>
                <div className="space-y-3">
                  <select value={leaveForm.type} onChange={e => setLeaveForm(f => ({ ...f, type: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    {Object.entries(LEAVE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-xs text-gray-500 mb-1 block">من تاريخ</label><input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(f => ({ ...f, start_date: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
                    <div><label className="text-xs text-gray-500 mb-1 block">إلى تاريخ</label><input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(f => ({ ...f, end_date: e.target.value }))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"/></div>
                  </div>
                  <textarea placeholder="سبب الإجازة (اختياري)" value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none"/>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={submitLeave} disabled={!leaveForm.start_date || !leaveForm.end_date} className="flex-1 py-2 bg-slate-700 text-white rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50">إرسال الطلب</button>
                  <button onClick={() => setShowLeaveForm(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
