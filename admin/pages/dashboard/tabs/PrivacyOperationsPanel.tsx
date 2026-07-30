import React, { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Save, ShieldAlert, XCircle } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: Notify; }
interface Policy {
  residency_region: string;
  deployment_region: string;
  residency_verified: boolean;
  export_sla_days: number;
  erasure_sla_days: number;
  financial_retention_days: number;
  allow_self_service: boolean;
}
interface PrivacyRequest {
  id: string;
  subscriber_name?: string;
  subscriber_email?: string;
  client_code?: string;
  status: string;
  reason?: string;
  legal_hold_reason?: string;
  due_at: string;
  evidence_hash?: string;
}

const json = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
};

const PrivacyOperationsPanel: React.FC<Props> = ({ notify }) => {
  const [requests, setRequests] = useState<PrivacyRequest[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    setBusy('load');
    const [requestResult, policyResult] = await Promise.allSettled([
      fetch('/api/admin/privacy/requests', { credentials: 'include', headers: adminAuthHeaders() }).then(json),
      fetch('/api/admin/privacy/policy', { credentials: 'include', headers: adminAuthHeaders() }).then(json),
    ]);
    if (requestResult.status === 'fulfilled') setRequests(requestResult.value);
    else notify('error', requestResult.reason instanceof Error ? requestResult.reason.message : 'تعذر تحميل طلبات الخصوصية');
    if (policyResult.status === 'fulfilled') setPolicy(policyResult.value);
    setBusy('');
  };
  useEffect(() => { void load(); }, []);

  const decide = async (request: PrivacyRequest, decision: 'approve' | 'reject' | 'block') => {
    const note = decision === 'approve'
      ? window.prompt('ملاحظة الاعتماد (اختياري):', '') ?? ''
      : window.prompt(decision === 'block' ? 'سبب الحجز القانوني أو التشغيلي:' : 'سبب الرفض:');
    if (note === null || (decision !== 'approve' && !note.trim())) return;
    if (decision === 'approve' && !window.confirm('سيتم تعطيل الحساب ومحو البيانات الشخصية بعد فحص الالتزامات المفتوحة. تأكيد؟')) return;
    setBusy(request.id);
    try {
      const result = await fetch(`/api/admin/privacy/requests/${request.id}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ decision, note }),
      }).then(json);
      notify('success', result.status === 'completed' ? 'تم المحو والتحقق وحفظ دليل التنفيذ' : `تم تحديث الطلب إلى ${result.status}`);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر معالجة الطلب');
      await load();
    } finally { setBusy(''); }
  };

  const savePolicy = async () => {
    if (!policy) return;
    setBusy('policy');
    try {
      const result = await fetch('/api/admin/privacy/policy', {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify(policy),
      }).then(json);
      setPolicy(current => current ? { ...current, ...result.policy, residency_verified: result.residency_verified } : current);
      notify('success', 'تم حفظ سياسة الخصوصية والتحقق من منطقة الاستضافة');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ السياسة');
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {policy && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-gray-900">سياسة الإقامة والاحتفاظ بالبيانات</h3>
              <p className="text-xs text-gray-500">منطقة النشر الفعلية: {policy.deployment_region}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${policy.residency_verified ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {policy.residency_verified ? 'تم التحقق' : 'غير متحقق'}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <label className="text-xs font-bold text-gray-600">منطقة الإقامة
              <input value={policy.residency_region} onChange={event => setPolicy({ ...policy, residency_region: event.target.value })}
                className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" dir="ltr" />
            </label>
            {([
              ['export_sla_days', 'مهلة التصدير/يوم'],
              ['erasure_sla_days', 'مهلة المحو/يوم'],
              ['financial_retention_days', 'حفظ المالي/يوم'],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-xs font-bold text-gray-600">{label}
                <input type="number" value={policy[key]} onChange={event => setPolicy({ ...policy, [key]: Number(event.target.value) })}
                  className="mt-1 w-full rounded-lg border p-2 text-sm font-normal" />
              </label>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={policy.allow_self_service}
              onChange={event => setPolicy({ ...policy, allow_self_service: event.target.checked })} />
            السماح للعميل بالتصدير وطلب المحو من حسابه
          </label>
          <button onClick={savePolicy} disabled={busy === 'policy'}
            className="mt-4 flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            <Save size={14}/> حفظ السياسة
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-3">
          <h3 className="font-bold text-gray-900">طلبات محو بيانات العملاء</h3>
          <button onClick={load} disabled={busy === 'load'} className="flex items-center gap-1 text-xs text-gray-600">
            <RefreshCw size={13}/> تحديث
          </button>
        </div>
        <div className="divide-y">
          {!requests.length && <p className="p-8 text-center text-sm text-gray-400">لا توجد طلبات</p>}
          {requests.map(request => (
            <div key={request.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-gray-800">{request.subscriber_name || '[محذوف]'} <span className="text-xs text-gray-400">{request.client_code}</span></p>
                  <p className="text-xs text-gray-500">{request.subscriber_email}</p>
                  <p className="mt-1 text-xs text-gray-600">{request.reason || 'بدون سبب مضاف'}</p>
                  {request.legal_hold_reason && <p className="mt-1 text-xs font-bold text-amber-700">حجز: {request.legal_hold_reason}</p>}
                  {request.evidence_hash && <p className="mt-1 max-w-md truncate font-mono text-[10px] text-gray-400">Evidence: {request.evidence_hash}</p>}
                </div>
                <div className="text-left">
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{request.status}</span>
                  <p className="mt-2 text-[10px] text-gray-400">الاستحقاق {String(request.due_at).slice(0, 10)}</p>
                </div>
              </div>
              {['pending', 'blocked', 'failed'].includes(request.status) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => decide(request, 'approve')} disabled={busy === request.id}
                    className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white">
                    <CheckCircle2 size={13}/> اعتماد وتنفيذ
                  </button>
                  <button onClick={() => decide(request, 'block')} disabled={busy === request.id}
                    className="flex items-center gap-1 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800">
                    <ShieldAlert size={13}/> حجز
                  </button>
                  <button onClick={() => decide(request, 'reject')} disabled={busy === request.id}
                    className="flex items-center gap-1 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700">
                    <XCircle size={13}/> رفض
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PrivacyOperationsPanel;
