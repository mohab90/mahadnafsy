import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Copy, Edit2, Play, Plus, Save, Settings, Trash2, Zap } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { useBranches } from '../../../hooks/useBranches';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { AutomationWorkflow, AutomationTrigger, AutomationAction } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  notify: NotifyFn;
  setActiveTab: (tab: string) => void;
}

type WorkflowDraft = {
  name: string; description: string; trigger: string; action: string;
  actionConfig: Record<string, string>; enabled: boolean;
};

const TRIGGER_LABELS: Partial<Record<AutomationTrigger, string>> = {
  new_subscriber: '👤 عميل جديد يسجل',
  new_lead: '🧲 عميل محتمل جديد',
  lead_converted: '✅ ليد تحول لمشترك',
  lead_status_changed: '🔄 تغيير حالة الليد',
  lead_score_threshold: '📊 الليد وصل سكور معين',
  subscriber_inactive_x_days: '😴 مشترك غير نشط',
  subscription_expiring_soon: '⏰ اشتراك على وشك الانتهاء',
  no_contact_x_days: '📵 بدون تواصل X أيام',
  new_payment: '💰 دفعة جديدة ناجحة',
  payment_failed: '❌ فشل الدفع',
  payment_partial: '🔸 دفع جزئي',
  refund_requested: '↩ طلب استرداد',
  course_enrolled: '🎓 تسجيل في كورس',
  subscriber_course_completed: '🏆 إتمام كورس',
  course_progress_stalled: '🛑 توقف التقدم',
  certificate_requested: '📜 طلب شهادة',
  new_consultation: '📅 عرض استشارة جديد',
  consultation_confirmed: '✅ استشارة مؤكدة',
  consultation_cancelled: '❌ استشارة ملغاة',
  consultation_completed: '🎯 استشارة مكتملة',
  community_post_pending: '💬 منشور ينتظر مراجعة',
  new_join_request: '📝 طلب انضمام جديد',
  new_contact_message: '📨 رسالة تواصل جديدة',
  whatsapp_message_received: '📱 رسالة واتساب واردة',
  messenger_message_received: '💬 رسالة ماسنجر واردة',
  ai_agent_escalated: '🤖 AI طلب تدخل بشري',
  conversation_unassigned: '👤 محادثة بدون موظف',
  conversation_idle_x_hours: '😴 محادثة خاملة',
};

const ACTION_LABELS: Partial<Record<AutomationAction, string>> = {
  notify_admin: '🔔 إشعار المسؤول',
  send_whatsapp: '📱 إرسال واتساب',
  send_email: '📧 إرسال بريد إلكتروني',
  send_notification: '🔔 إشعار للعميل',
  send_template_message: '📝 إرسال رسالة قالب',
  add_note: '📝 إضافة ملاحظة',
  update_lead_status: '🔄 تحديث حالة الليد',
  add_followup_reminder: '⏰ إضافة تذكير متابعة',
  enroll_course: '🎓 تسجيل في كورس',
  assign_staff: '👤 تعيين موظف',
  escalate_to_human: '🙋 تحويل لموظف',
  ai_auto_reply: '🤖 رد AI تلقائي',
  tag_conversation: '🏷 وضع تاج على المحادثة',
  close_conversation: '✅ إغلاق المحادثة',
  generate_certificate: '📜 إصدار شهادة',
};

const blankWf = (): WorkflowDraft => ({
  name: '', description: '', trigger: 'new_subscriber',
  action: 'notify_admin', actionConfig: {}, enabled: true,
});

const AutomationTab: React.FC<Props> = ({ notify, setActiveTab }) => {
  const { automationWorkflows, addAutomationWorkflow, updateAutomationWorkflow, deleteAutomationWorkflow, staffMembers, courses, bundles } = useSiteData();
  const instituteBranches = useBranches();

  const [automationFormOpen, setAutomationFormOpen] = useState(false);
  const [editingWorkflowId, setEditingWorkflowId] = useState('');
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraft>(blankWf());

  // WhatsApp Config state
  const [waProvider, setWaProvider] = useState<'meta' | 'green-api'>('meta');
  const [waInstanceId, setWaInstanceId] = useState('');
  const [waApiToken, setWaApiToken] = useState('');
  const [waHasToken, setWaHasToken] = useState(false);
  const [waMetaPhoneId, setWaMetaPhoneId] = useState('');
  const [waMetaToken, setWaMetaToken] = useState('');
  const [waHasMetaToken, setWaHasMetaToken] = useState(false);
  const [waSaving, setWaSaving] = useState(false);
  const [waLoaded, setWaLoaded] = useState(false);

  // Facebook Webhook state
  const [fbToken, setFbToken] = useState('mahad_fb_2025');
  const [fbPageToken, setFbPageToken] = useState('');
  const [fbDefaultBranch, setFbDefaultBranch] = useState('');
  const [fbDefaultCourseId, setFbDefaultCourseId] = useState('');
  const [fbDefaultSalesId, setFbDefaultSalesId] = useState('');
  const [fbSaving, setFbSaving] = useState(false);
  const [fbCopied, setFbCopied] = useState(false);
  const FB_WEBHOOK_URL = 'https://mahadnafsy.com/api/webhooks/facebook-leads';
  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(FB_WEBHOOK_URL).then(() => { setFbCopied(true); setTimeout(() => setFbCopied(false), 2000); });
  };
  useEffect(() => {
    mysqlAdmin.getFbLeadConfig().then((cfg: any) => {
      if (cfg.webhookVerifyToken) setFbToken(cfg.webhookVerifyToken);
      if (cfg.hasToken) setFbPageToken('••••••••');
      if (cfg.defaultBranch) setFbDefaultBranch(cfg.defaultBranch);
      if (cfg.defaultInterestedCourseId) setFbDefaultCourseId(cfg.defaultInterestedCourseId);
      if (cfg.defaultAssignedSalesId) setFbDefaultSalesId(cfg.defaultAssignedSalesId);
    }).catch(() => {});
  }, []);
  const saveFbConfig = async () => {
    setFbSaving(true);
    try {
      await mysqlAdmin.saveFbLeadConfig({
        webhookVerifyToken: fbToken.trim(),
        pageAccessToken: fbPageToken.trim(),
        enabled: true,
        defaultBranch: fbDefaultBranch || null,
        defaultInterestedCourseId: fbDefaultCourseId || null,
        defaultAssignedSalesId: fbDefaultSalesId || null,
      });
      notify('success', 'تم حفظ إعدادات Facebook Lead Ads ✅');
    } catch { notify('error', 'خطأ في الحفظ'); }
    setFbSaving(false);
  };

  useEffect(() => {
    mysqlAdmin.getWhatsAppConfig().then(cfg => {
      setWaProvider(cfg.provider || 'meta');
      setWaInstanceId(cfg.instanceId || '');
      setWaHasToken(cfg.hasToken);
      setWaMetaPhoneId(cfg.metaPhoneId || '');
      setWaHasMetaToken(cfg.hasMetaToken);
      setWaLoaded(true);
    }).catch(() => setWaLoaded(true));
  }, []);

  const handleSaveWaConfig = async () => {
    if (waProvider === 'green-api') {
      if (!waInstanceId.trim() || (!waApiToken.trim() && !waHasToken)) {
        notify('error', 'Instance ID والـ API Token مطلوبان');
        return;
      }
    } else { // meta
      if (!waMetaPhoneId.trim() || (!waMetaToken.trim() && !waHasMetaToken)) {
        notify('error', 'Phone Number ID والـ Access Token مطلوبان');
        return;
      }
    }
    setWaSaving(true);
    try {
      await mysqlAdmin.saveWhatsAppConfig({
        provider: waProvider,
        instanceId: waInstanceId.trim(),
        apiToken: waApiToken.trim(),       // blank → server keeps existing
        metaPhoneId: waMetaPhoneId.trim(),
        metaToken: waMetaToken.trim(),     // blank → server keeps existing
      });
      if (waProvider === 'green-api' && waApiToken.trim()) { setWaHasToken(true); setWaApiToken(''); }
      if (waProvider === 'meta' && waMetaToken.trim()) { setWaHasMetaToken(true); setWaMetaToken(''); }
      notify('success', 'تم حفظ إعدادات WhatsApp ✅');
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'فشل الحفظ');
    } finally {
      setWaSaving(false);
    }
  };

  const handleSaveWorkflow = () => {
    if (!workflowDraft.name.trim()) return;
    if (editingWorkflowId) {
      const existing = automationWorkflows.find(w => w.id === editingWorkflowId);
      if (existing) {
        updateAutomationWorkflow({
          ...existing,
          name: workflowDraft.name,
          description: workflowDraft.description,
          trigger: workflowDraft.trigger as AutomationTrigger,
          action: workflowDraft.action as AutomationAction,
          actionConfig: workflowDraft.actionConfig,
          enabled: workflowDraft.enabled,
        });
        notify('success', `تم تحديث الوركفلو "${workflowDraft.name}"`);
      }
    } else {
      addAutomationWorkflow({
        id: `wf-${Date.now()}`,
        name: workflowDraft.name,
        description: workflowDraft.description,
        trigger: workflowDraft.trigger as AutomationTrigger,
        action: workflowDraft.action as AutomationAction,
        actionConfig: workflowDraft.actionConfig,
        enabled: workflowDraft.enabled,
        createdAt: new Date().toISOString().slice(0, 10),
        triggerCount: 0,
      });
      notify('success', `تم إنشاء الوركفلو "${workflowDraft.name}"`);
    }
    setAutomationFormOpen(false);
    setEditingWorkflowId('');
    setWorkflowDraft(blankWf());
  };

  const handleEditWorkflow = (wf: AutomationWorkflow) => {
    setEditingWorkflowId(wf.id);
    setWorkflowDraft({
      name: wf.name,
      description: wf.description || '',
      trigger: wf.trigger,
      action: wf.action,
      actionConfig: wf.actionConfig || {},
      enabled: wf.enabled,
    });
    setAutomationFormOpen(true);
  };

  const enabledCount = automationWorkflows.filter(w => w.enabled).length;
  const totalRuns = automationWorkflows.reduce((s, w) => s + (w.triggerCount || 0), 0);

  // ── Run Engine ────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [runResults, setRunResults] = useState<{ name: string; matchedLeads: number; actionsRun: number }[] | null>(null);
  const handleRunAll = async () => {
    if (!enabledCount) { notify('info', 'لا توجد وركفلو نشطة لتشغيلها'); return; }
    setRunning(true);
    setRunResults(null);
    try {
      const data = await mysqlAdmin.adminPost<{ ok: boolean; ran: number; results: any[] }>('/api/admin/automation-workflows/run', {});
      setRunResults(data.results);
      const acted = data.results.reduce((s: number, r: any) => s + r.actionsRun, 0);
      notify('success', `✅ تم تشغيل ${data.ran} وركفلو — ${acted} إجراء تم تنفيذه`);
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'فشل تشغيل الأتوميشن');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-l from-violet-700 to-indigo-700 rounded-2xl p-5 text-white flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
            <Zap size={24} />
          </div>
          <div>
            <h2 className="text-xl font-extrabold">الأتوميشن والوركفلو ⚡</h2>
            <p className="text-violet-200 text-sm mt-0.5">أتمتة الإجراءات المتكررة وحفظ الوقت</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-2xl font-extrabold">{automationWorkflows.length}</p>
            <p className="text-violet-200 text-xs">وركفلو</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-extrabold text-green-300">{enabledCount}</p>
            <p className="text-violet-200 text-xs">نشط</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-extrabold text-amber-300">{totalRuns}</p>
            <p className="text-violet-200 text-xs">تشغيل</p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500">
          {automationWorkflows.length === 0 ? 'لا توجد وركفلو بعد — أنشئ أول واحدة الآن' : `${automationWorkflows.length} وركفلو — ${enabledCount} نشط`}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRunAll}
            disabled={running || enabledCount === 0}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl transition text-sm"
            title="تشغيل جميع الوركفلو النشطة الآن"
          >
            {running ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Play size={15} />}
            {running ? 'جاري التشغيل...' : 'تشغيل الأتوميشن الآن'}
          </button>
          <button
            onClick={() => {
              if (automationFormOpen && !editingWorkflowId) {
                setAutomationFormOpen(false);
              } else {
                setEditingWorkflowId('');
                setWorkflowDraft(blankWf());
                setAutomationFormOpen(true);
              }
            }}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-bold px-4 py-2.5 rounded-xl transition text-sm"
          >
            <Plus size={16} /> {automationFormOpen && !editingWorkflowId ? 'إلغاء' : 'وركفلو جديد'}
          </button>
        </div>
      </div>

      {/* Run results panel */}
      {runResults && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
          <p className="font-bold text-emerald-900 mb-3 flex items-center gap-2 text-sm"><CheckCircle size={15}/> نتائج آخر تشغيل</p>
          <div className="space-y-2">
            {runResults.map((r, i) => (
              <div key={i} className="flex items-center justify-between bg-white border border-emerald-100 rounded-xl px-3 py-2">
                <span className="text-sm font-bold text-gray-800">{r.name}</span>
                <div className="flex gap-3 text-xs">
                  <span className="text-blue-700 font-bold">{r.matchedLeads} مطابق</span>
                  <span className={`font-bold ${r.actionsRun > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{r.actionsRun} إجراء</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create/Edit form */}
      {automationFormOpen && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5 space-y-4">
          <h3 className="font-extrabold text-violet-900 flex items-center gap-2">
            <Zap size={16} /> {editingWorkflowId ? 'تعديل الوركفلو' : 'إنشاء وركفلو جديد'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-700 mb-1">اسم الوركفلو *</label>
              <input value={workflowDraft.name} onChange={e => setWorkflowDraft(p => ({ ...p, name: e.target.value }))}
                placeholder="مثال: رسالة ترحيب للمشتركين الجدد"
                className="w-full border border-violet-300 bg-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-500" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-700 mb-1">الوصف (اختياري)</label>
              <input value={workflowDraft.description} onChange={e => setWorkflowDraft(p => ({ ...p, description: e.target.value }))}
                placeholder="وصف مختصر لما يفعله هذا الوركفلو"
                className="w-full border border-gray-300 bg-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400" />
            </div>

            {/* Trigger */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">🎯 التريجر — متى يتفعل؟</label>
              <select value={workflowDraft.trigger} onChange={e => setWorkflowDraft(p => ({ ...p, trigger: e.target.value }))}
                className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400">
                {(Object.entries(TRIGGER_LABELS) as [string, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* Action */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">⚡ الأكشن — ماذا يفعل؟</label>
              <select value={workflowDraft.action} onChange={e => setWorkflowDraft(p => ({ ...p, action: e.target.value }))}
                className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400">
                {(Object.entries(ACTION_LABELS) as [string, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* Action config — message text */}
            {['send_whatsapp', 'send_email', 'send_notification', 'send_template_message', 'add_note', 'notify_admin'].includes(workflowDraft.action) && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700 mb-1">📝 نص الرسالة</label>
                <textarea value={workflowDraft.actionConfig.message || ''} rows={3}
                  onChange={e => setWorkflowDraft(p => ({ ...p, actionConfig: { ...p.actionConfig, message: e.target.value } }))}
                  placeholder="مرحباً {{name}}، شكراً لانضمامك لمعهد الدراسات النفسية..."
                  className="w-full border border-gray-300 bg-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400 resize-none" />
                <p className="text-[11px] text-gray-400 mt-1">يمكن استخدام: {'{{name}}'} {'{{email}}'} {'{{phone}}'} {'{{course}}'}</p>
              </div>
            )}
            {workflowDraft.action === 'update_lead_status' && (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">الحالة الجديدة</label>
                <select value={workflowDraft.actionConfig.status || ''} onChange={e => setWorkflowDraft(p => ({ ...p, actionConfig: { ...p.actionConfig, status: e.target.value } }))}
                  className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400">
                  <option value="">— اختر —</option>
                  {[['new','جديد'],['contacted','تم التواصل'],['interested','مهتم'],['not_interested','غير مهتم'],['no_answer','لا يرد'],['converted','تحول لمشترك'],['closed','مغلق']].map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            )}
            {workflowDraft.action === 'assign_staff' && (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">الموظف المعين</label>
                <select value={workflowDraft.actionConfig.staffId || ''} onChange={e => setWorkflowDraft(p => ({ ...p, actionConfig: { ...p.actionConfig, staffId: e.target.value } }))}
                  className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400">
                  <option value="">— اختر موظف —</option>
                  {staffMembers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {['subscriber_inactive_x_days', 'no_contact_x_days', 'conversation_idle_x_hours'].includes(workflowDraft.trigger) && (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">عدد الأيام / الساعات</label>
                <input type="number" min={1} value={workflowDraft.actionConfig.days || ''}
                  onChange={e => setWorkflowDraft(p => ({ ...p, actionConfig: { ...p.actionConfig, days: e.target.value } }))}
                  placeholder="مثال: 7"
                  className="w-full border border-gray-300 bg-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-violet-400" />
              </div>
            )}

            {/* Enabled toggle */}
            <div className="sm:col-span-2 flex items-center gap-3">
              <button onClick={() => setWorkflowDraft(p => ({ ...p, enabled: !p.enabled }))}
                className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${workflowDraft.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${workflowDraft.enabled ? 'translate-x-6' : ''}`} />
              </button>
              <span className="text-sm font-bold text-gray-700">{workflowDraft.enabled ? '✅ نشط' : '⏸ متوقف'}</span>
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={handleSaveWorkflow} disabled={!workflowDraft.name.trim()}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white font-bold px-5 py-2.5 rounded-xl transition text-sm">
              <Save size={15} /> {editingWorkflowId ? 'حفظ التعديلات' : 'إنشاء الوركفلو'}
            </button>
            <button onClick={() => { setAutomationFormOpen(false); setEditingWorkflowId(''); setWorkflowDraft(blankWf()); }}
              className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition text-sm">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* Workflow list */}
      {automationWorkflows.length === 0 && !automationFormOpen ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center shadow-sm">
          <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Zap size={28} className="text-violet-500" />
          </div>
          <p className="font-bold text-gray-700 mb-2">لا توجد وركفلو بعد</p>
          <p className="text-gray-400 text-sm mb-6">أنشئ وركفلو لأتمتة إجراءات مثل إرسال رسائل ترحيب، تنبيه الفريق، تحديث حالة العملاء...</p>
          <button onClick={() => { setWorkflowDraft(blankWf()); setAutomationFormOpen(true); }}
            className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-bold px-6 py-3 rounded-xl transition">
            <Plus size={16} /> إنشاء أول وركفلو
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {automationWorkflows.map(wf => (
            <div key={wf.id} className={`bg-white rounded-2xl border shadow-sm p-4 flex items-start gap-4 hover:shadow-md transition ${wf.enabled ? 'border-gray-100' : 'border-gray-100 opacity-70'}`}>
              {/* Toggle */}
              <button onClick={() => updateAutomationWorkflow({ ...wf, enabled: !wf.enabled })}
                className={`relative mt-0.5 w-11 h-6 rounded-full transition-colors flex-shrink-0 ${wf.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${wf.enabled ? 'translate-x-5' : ''}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <p className="font-bold text-gray-900 text-sm">{wf.name}</p>
                  {wf.triggerCount ? (
                    <span className="text-[11px] bg-violet-100 text-violet-700 font-bold px-2 py-0.5 rounded-full">
                      {wf.triggerCount} تشغيل
                    </span>
                  ) : null}
                  {!wf.enabled && <span className="text-[11px] bg-gray-100 text-gray-500 font-bold px-2 py-0.5 rounded-full">متوقف</span>}
                </div>
                {wf.description && <p className="text-xs text-gray-400 mb-2">{wf.description}</p>}
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="bg-blue-50 text-blue-700 font-bold px-2.5 py-1 rounded-lg">
                    {TRIGGER_LABELS[wf.trigger] || wf.trigger}
                  </span>
                  <span className="text-gray-300">→</span>
                  <span className="bg-violet-50 text-violet-700 font-bold px-2.5 py-1 rounded-lg">
                    {ACTION_LABELS[wf.action] || wf.action}
                  </span>
                  {wf.lastTriggeredAt && (
                    <span className="text-gray-400">آخر تشغيل: {wf.lastTriggeredAt.slice(0, 10)}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => handleEditWorkflow(wf)}
                  className="p-2 text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition">
                  <Edit2 size={15} />
                </button>
                <button onClick={() => { if (confirm(`حذف "${wf.name}"؟`)) { deleteAutomationWorkflow(wf.id); notify('info', `تم حذف "${wf.name}"`); } }}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-sm text-blue-700">
        <p className="font-bold mb-1 flex items-center gap-2"><AlertCircle size={15} /> ملاحظة هامة</p>
        <p className="text-xs leading-relaxed">الوركفلو تُحفظ في MySQL وتُفعَل من خلال كود الـ context عند وقوع الحدث. بعض الأكشنات (مثل إرسال واتساب) تحتاج إلى ربط قنوات الرسائل من تبويب <button className="underline font-bold" onClick={() => setActiveTab('messaging_agent')}>وكيل المراسلة</button>.</p>
      </div>

      {/* ── WhatsApp Config ──────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 bg-emerald-50">
          <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center">
            <Settings size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">إعدادات WhatsApp</h3>
            <p className="text-xs text-gray-500">للإشعارات التلقائية: إيصالات الدفع، تذكير الأقساط، رسائل الترحيب</p>
          </div>
          {waLoaded && (
            <span className={`mr-auto text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${(waProvider === 'meta' ? waHasMetaToken : waHasToken) ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
              {(waProvider === 'meta' ? waHasMetaToken : waHasToken) ? <><CheckCircle size={12} /> متصل</> : '⚙ غير مضبوط'}
            </span>
          )}
        </div>
        <div className="p-5 space-y-4" dir="rtl">
          {/* Provider selector */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1 block">مزوّد الإرسال</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setWaProvider('meta')}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border transition ${waProvider === 'meta' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300'}`}>
                واتساب الرسمي (Meta)
              </button>
              <button type="button" onClick={() => setWaProvider('green-api')}
                className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border transition ${waProvider === 'green-api' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300'}`}>
                Green-API
              </button>
            </div>
          </div>

          {waProvider === 'meta' ? (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
                <p className="font-bold mb-1">واتساب الرسمي (WhatsApp Cloud API):</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>من <span className="font-mono font-bold">developers.facebook.com</span> → تطبيقك → WhatsApp</li>
                  <li>انسخ <b>Phone Number ID</b> و<b>Access Token</b> (دائم)</li>
                  <li>ملاحظة: خارج نافذة 24 ساعة، يسمح Meta بالقوالب المعتمدة فقط</li>
                </ol>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 block">Phone Number ID *</label>
                  <input value={waMetaPhoneId} onChange={e => setWaMetaPhoneId(e.target.value)}
                    placeholder="مثال: 1029xxxxxxxxxx"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 block">
                    Access Token * {waHasMetaToken && <span className="font-normal text-emerald-600">(محفوظ — اتركه فارغاً للإبقاء على القديم)</span>}
                  </label>
                  <input type="password" value={waMetaToken} onChange={e => setWaMetaToken(e.target.value)}
                    placeholder={waHasMetaToken ? '••••••••••••••••' : 'الصق الـ Access Token هنا'}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono" />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
                <p className="font-bold mb-1">كيفية الحصول على البيانات:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>سجّل في <span className="font-mono font-bold">green-api.com</span> (الحساب المجاني كافٍ)</li>
                  <li>أنشئ Instance واربطه بهاتفك عبر QR Code</li>
                  <li>انسخ Instance ID و API Token من لوحة التحكم</li>
                </ol>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 block">Instance ID *</label>
                  <input value={waInstanceId} onChange={e => setWaInstanceId(e.target.value)}
                    placeholder="مثال: 7103xxxxxxxx"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono" />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1 block">
                    API Token * {waHasToken && <span className="font-normal text-emerald-600">(محفوظ — اتركه فارغاً للإبقاء على القديم)</span>}
                  </label>
                  <input type="password" value={waApiToken} onChange={e => setWaApiToken(e.target.value)}
                    placeholder={waHasToken ? '••••••••••••••••' : 'الصق الـ API Token هنا'}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono" />
                </div>
              </div>
            </>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveWaConfig}
              disabled={waSaving || (waProvider === 'meta'
                ? (!waMetaPhoneId.trim() || (!waMetaToken.trim() && !waHasMetaToken))
                : (!waInstanceId.trim() || (!waApiToken.trim() && !waHasToken)))}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 rounded-xl transition text-sm disabled:opacity-50">
              {waSaving
                ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <Save size={15} />}
              {waSaving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
            </button>
            {waHasToken && (
              <span className="text-xs text-emerald-700 flex items-center gap-1">
                <CheckCircle size={13} /> الإشعارات التلقائية جاهزة
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Facebook / Instagram Lead Ads Webhook ────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3 bg-blue-50">
          <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <div>
            <h3 className="font-bold text-gray-900">Facebook / Instagram Lead Ads</h3>
            <p className="text-xs text-gray-500">استقبال الليدز من إعلانات الليد تلقائياً عبر Webhook</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          {/* Webhook URL */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">رابط الـ Webhook (انسخه في Facebook)</label>
            <div className="flex gap-2 items-center">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-700 select-all dir-ltr" dir="ltr">
                {FB_WEBHOOK_URL}
              </code>
              <button onClick={copyWebhookUrl}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition ${fbCopied ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                <Copy size={13} /> {fbCopied ? 'تم!' : 'نسخ'}
              </button>
            </div>
          </div>

          {/* Verify Token */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">Verify Token (ضعه في Facebook أيضاً)</label>
            <input value={fbToken} onChange={e => setFbToken(e.target.value)} dir="ltr"
              placeholder="mahad_fb_2025"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>

          {/* Page Access Token */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">Page Access Token <span className="text-red-500">*</span></label>
            <input value={fbPageToken} onChange={e => setFbPageToken(e.target.value)} dir="ltr" type="password"
              placeholder="EAAxxxxx... (من Facebook Developers → Tools → Graph API Explorer)"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono" />
            <p className="text-xs text-gray-400 mt-1">مطلوب لجلب بيانات العميل (اسم، تليفون، إيميل) من Facebook تلقائياً</p>
          </div>

          {/* Default Branch */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">الفرع الافتراضي لليدز من فيسبوك</label>
            <select value={fbDefaultBranch} onChange={e => setFbDefaultBranch(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="">— بدون فرع محدد —</option>
              {instituteBranches.map(b => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
          </div>

          {/* Default Course */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">الكورس الافتراضي لليدز من فيسبوك <span className="text-red-500">*</span></label>
            {!fbDefaultCourseId && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700 font-bold mb-2">
                ⚠️ لم تحدد كورساً افتراضياً — الليدز القادمة من فيسبوك لن يكون لها كورس محدد!
              </div>
            )}
            <select value={fbDefaultCourseId} onChange={e => setFbDefaultCourseId(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="">— بدون كورس محدد —</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>

          {/* Default Sales Rep */}
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">موظف السيلز الافتراضي (أو يتوزع تلقائياً)</label>
            <select value={fbDefaultSalesId} onChange={e => setFbDefaultSalesId(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="">توزيع تلقائي (Round-Robin)</option>
              {staffMembers.filter(s => s.role === 'sales').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <button onClick={saveFbConfig} disabled={fbSaving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-60">
            <Save size={14} /> {fbSaving ? 'جاري الحفظ...' : 'حفظ إعدادات Facebook'}
          </button>

          {/* Instructions */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs space-y-1.5">
            <p className="font-bold text-blue-800 mb-2">📋 خطوات الربط:</p>
            <ol className="space-y-1.5 text-blue-700 list-decimal list-inside leading-relaxed">
              <li>اذهب إلى <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="underline font-bold">developers.facebook.com</a> → My Apps → أضف تطبيق</li>
              <li>أضف منتج <strong>Webhooks</strong> → اختر <strong>Page</strong></li>
              <li>الصق رابط الـ Webhook + أدخل الـ Verify Token المحفوظ أعلاه</li>
              <li>اشترك في حقل <strong>leadgen</strong></li>
              <li>اربط الصفحة بـ <strong>Lead Ads</strong> → Subscribed Pages</li>
            </ol>
            <p className="text-blue-600 mt-2">✅ بعد الربط، أي ليد جديد من إعلانات فيسبوك سيظهر تلقائياً في CRM</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AutomationTab;
