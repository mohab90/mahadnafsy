import { useState, useEffect, useRef } from 'react';
import { Zap, Play, Pause, Plus, Trash2, Save, X, Bell } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface AutoRule {
  id: string;
  name: string;
  trigger: string;
  action: string;
  condition: string;
  enabled: boolean;
  runCount: number;
  lastRun?: string;
}

const TRIGGERS = [
  { value: 'new_lead', label: 'ليد جديد' },
  { value: 'lead_status_change', label: 'تغيير حالة ليد' },
  { value: 'lead_no_answer_3days', label: 'ليد بدون رد 3 أيام' },
  { value: 'subscription_created', label: 'اشتراك جديد' },
  { value: 'subscription_expiring', label: 'اشتراك على وشك الانتهاء' },
  { value: 'payment_received', label: 'دفعة مستلمة' },
  { value: 'consultation_scheduled', label: 'استشارة مجدولة' },
];

const ACTIONS = [
  { value: 'send_whatsapp', label: 'إرسال واتساب' },
  { value: 'send_sms', label: 'إرسال SMS' },
  { value: 'send_email', label: 'إرسال بريد إلكتروني' },
  { value: 'assign_lead', label: 'إسناد ليد تلقائي' },
  { value: 'create_notification', label: 'إنشاء إشعار داخلي' },
  { value: 'add_tag', label: 'إضافة تصنيف' },
  { value: 'change_status', label: 'تغيير حالة تلقائي' },
];

const DEFAULT_RULES: AutoRule[] = [
  { id: '1', name: 'ترحيب بالليدات الجديدة', trigger: 'new_lead', action: 'send_whatsapp', condition: 'الكل', enabled: false, runCount: 0 },
  { id: '2', name: 'تنبيه للمتابعة بعد 3 أيام', trigger: 'lead_no_answer_3days', action: 'create_notification', condition: 'الكل', enabled: false, runCount: 0 },
  { id: '3', name: 'تأكيد الاشتراك', trigger: 'subscription_created', action: 'send_email', condition: 'الكل', enabled: false, runCount: 0 },
  { id: '4', name: 'تذكير انتهاء الاشتراك', trigger: 'subscription_expiring', action: 'send_whatsapp', condition: 'قبل 7 أيام', enabled: false, runCount: 0 },
];

export default function AutomationDashboardTab({ notify }: { notify: NotifyFn }) {
  const { subscribers } = useSiteData();
  const [rules, setRules] = useState<AutoRule[]>(DEFAULT_RULES);
  const [addingNew, setAddingNew] = useState(false);
  const [newRule, setNewRule] = useState({ name: '', trigger: 'new_lead', action: 'send_whatsapp', condition: 'الكل' });
  const [autoStats, setAutoStats] = useState<{
    followup_due: number; followup_overdue: number;
    payment_due_3d: number; payment_overdue: number;
    reminders_sent_today: number; drip_campaigns_active: number; workflows_active: number;
  } | null>(null);
  const rulesLoaded = useRef(false);
  const saveRulesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load rules from API
  useEffect(() => {
    mysqlAdmin.adminGet<{ ok: boolean; data: AutoRule[] | null }>('/admin/kv/automation_rules')
      .then(res => { if (res.data?.length) setRules(res.data); })
      .catch(() => {})
      .finally(() => { rulesLoaded.current = true; });
  }, []);

  // Load live automation stats
  useEffect(() => {
    mysqlAdmin.adminGet<typeof autoStats>('/admin/automation/stats')
      .then(data => setAutoStats(data))
      .catch(() => {});
  }, []);

  // Persist rules debounced
  useEffect(() => {
    if (!rulesLoaded.current) return;
    if (saveRulesTimer.current) clearTimeout(saveRulesTimer.current);
    saveRulesTimer.current = setTimeout(() => {
      mysqlAdmin.adminPut('/admin/kv/automation_rules', rules).catch(() => {});
    }, 800);
  }, [rules]);

  function toggleRule(id: string) {
    setRules(rs => rs.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
    notify('info', 'تغيير حالة الأتوميشن');
  }

  function deleteRule(id: string) {
    setRules(rs => rs.filter(r => r.id !== id));
    notify('success', 'تم حذف القاعدة');
  }

  function addRule() {
    if (!newRule.name.trim()) { notify('error', 'اكتب اسم القاعدة'); return; }
    const id = Date.now().toString();
    setRules(rs => [...rs, { ...newRule, id, enabled: false, runCount: 0 }]);
    setNewRule({ name: '', trigger: 'new_lead', action: 'send_whatsapp', condition: 'الكل' });
    setAddingNew(false);
    notify('success', 'تم إضافة القاعدة');
  }

  const enabledCount = rules.filter(r => r.enabled).length;
  const totalRunCount = rules.reduce((a, r) => a + r.runCount, 0);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-violet-600 to-fuchsia-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Zap size={22} />لوحة الأتوميشن</h2>
        <p className="text-violet-100 text-sm mt-1">أتمتة المهام المتكررة — ليدات، اشتراكات، إشعارات</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي القواعد', val: rules.length, color: 'violet' },
          { label: 'القواعد النشطة', val: enabledCount, color: 'emerald' },
          { label: 'إجمالي التشغيل', val: totalRunCount, color: 'blue' },
          { label: 'القواعد المعطلة', val: rules.length - enabledCount, color: 'gray' },
        ].map(k => (
          <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 text-center`}>
            <div className="text-2xl font-extrabold text-gray-900">{k.val}</div>
            <div className="text-xs text-gray-500 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Live automation stats */}
      {autoStats && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Bell size={15} className="text-violet-500" />إحصائيات الأتوميشن الفعلية</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-x-reverse divide-gray-100">
            {[
              { label: 'متابعات اليوم', val: autoStats.followup_due, warn: false, icon: '📞' },
              { label: 'متابعات متأخرة', val: autoStats.followup_overdue, warn: autoStats.followup_overdue > 0, icon: '⏰' },
              { label: 'دفعات خلال 3 أيام', val: autoStats.payment_due_3d, warn: false, icon: '💳' },
              { label: 'دفعات متأخرة', val: autoStats.payment_overdue, warn: autoStats.payment_overdue > 0, icon: '⚠️' },
              { label: 'تذكيرات أُرسلت اليوم', val: autoStats.reminders_sent_today, warn: false, icon: '📨' },
              { label: 'حملات تلقائية نشطة', val: autoStats.drip_campaigns_active, warn: false, icon: '🔄' },
              { label: 'سير عمل نشطة', val: autoStats.workflows_active, warn: false, icon: '⚡' },
              { label: 'إجمالي المشتركين', val: subscribers.length, warn: false, icon: '👥' },
            ].map(s => (
              <div key={s.label} className={`px-4 py-4 text-center ${s.warn ? 'bg-red-50' : ''}`}>
                <div className="text-lg mb-0.5">{s.icon}</div>
                <div className={`text-xl font-black ${s.warn ? 'text-red-600' : 'text-gray-900'}`}>{s.val}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coming soon note */}
      <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 flex items-start gap-3">
        <Zap size={18} className="text-violet-500 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-bold text-violet-800 text-sm">تفعيل القواعد يتم تلقائياً</div>
          <p className="text-violet-600 text-xs mt-1">تذكيرات المتابعات والدفعات تعمل تلقائياً من الخادم كل يوم. يمكنك هنا إضافة قواعد مخصصة إضافية.</p>
        </div>
      </div>

      {/* Rules list */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Zap size={16} className="text-violet-500" />قواعد الأتوميشن</h3>
          <button onClick={() => setAddingNew(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded-xl text-xs font-bold hover:bg-violet-700 transition">
            <Plus size={13} />إضافة قاعدة
          </button>
        </div>

        {/* Add new form */}
        {addingNew && (
          <div className="p-4 bg-violet-50 border-b border-violet-100 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={newRule.name} onChange={e => setNewRule(r => ({ ...r, name: e.target.value }))}
                placeholder="اسم القاعدة" className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              <input value={newRule.condition} onChange={e => setNewRule(r => ({ ...r, condition: e.target.value }))}
                placeholder="الشرط (اختياري)" className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300" />
              <select value={newRule.trigger} onChange={e => setNewRule(r => ({ ...r, trigger: e.target.value }))}
                className="border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white">
                {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <select value={newRule.action} onChange={e => setNewRule(r => ({ ...r, action: e.target.value }))}
                className="border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white">
                {ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={addRule} className="px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-bold hover:bg-violet-700 transition flex items-center gap-1"><Save size={14} />حفظ</button>
              <button onClick={() => setAddingNew(false)} className="px-4 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition flex items-center gap-1"><X size={14} />إلغاء</button>
            </div>
          </div>
        )}

        <div className="divide-y divide-gray-50">
          {rules.map(rule => {
            const triggerLabel = TRIGGERS.find(t => t.value === rule.trigger)?.label || rule.trigger;
            const actionLabel = ACTIONS.find(a => a.value === rule.action)?.label || rule.action;
            return (
              <div key={rule.id} className="flex items-center gap-4 px-4 py-4 hover:bg-gray-50 transition">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${rule.enabled ? 'bg-emerald-100' : 'bg-gray-100'}`}>
                  <Zap size={18} className={rule.enabled ? 'text-emerald-600' : 'text-gray-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-800 text-sm">{rule.name}</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg">عند: {triggerLabel}</span>
                    <span className="text-[10px] bg-violet-50 text-violet-700 px-2 py-0.5 rounded-lg">نفذ: {actionLabel}</span>
                    {rule.condition && <span className="text-[10px] bg-gray-50 text-gray-600 px-2 py-0.5 rounded-lg">شرط: {rule.condition}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => toggleRule(rule.id)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition ${rule.enabled ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {rule.enabled ? <><Pause size={12} />إيقاف</> : <><Play size={12} />تفعيل</>}
                  </button>
                  <button onClick={() => deleteRule(rule.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition"><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
          {rules.length === 0 && (
            <div className="px-4 py-10 text-center text-gray-400">لا توجد قواعد — أضف قاعدة جديدة</div>
          )}
        </div>
      </div>
    </div>
  );
}
