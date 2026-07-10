import React from 'react';
import { X } from 'lucide-react';
import type { LeadItem, LeadStatus, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type ConvertType = 'finished'|'paused'|'refunded'|'daqqi'|'leads'|'online'|'';

interface Props {
  convertRow: SubscriberItem | null;
  setConvertRow: (row: SubscriberItem | null) => void;
  convertType: ConvertType;
  setConvertType: (t: ConvertType) => void;
  isDaqqiClientsTab: boolean;
  convertAttendedLive: boolean;
  setConvertAttendedLive: (v: boolean) => void;
  convertGotCert: boolean;
  setConvertGotCert: (v: boolean) => void;
  convertPauseReason: string;
  setConvertPauseReason: (v: string) => void;
  convertRefundReason: string;
  setConvertRefundReason: (v: string) => void;
  convertRefundAmount: string;
  setConvertRefundAmount: (v: string) => void;
  convertRefundMethod: string;
  setConvertRefundMethod: (v: string) => void;
  convertSaving: boolean;
  setConvertSaving: (v: boolean) => void;
  updateSubscriber: (s: SubscriberItem) => void;
  setSalesOwnSubscribers: React.Dispatch<React.SetStateAction<SubscriberItem[]>>;
  deleteSubscriber: (id: string) => void;
  addLead: (lead: LeadItem) => void;
  notify: NotifyFn;
}

export function ConvertClientModal({
  convertRow, setConvertRow, convertType, setConvertType, isDaqqiClientsTab,
  convertAttendedLive, setConvertAttendedLive, convertGotCert, setConvertGotCert,
  convertPauseReason, setConvertPauseReason, convertRefundReason, setConvertRefundReason,
  convertRefundAmount, setConvertRefundAmount, convertRefundMethod, setConvertRefundMethod,
  convertSaving, setConvertSaving, updateSubscriber, setSalesOwnSubscribers, deleteSubscriber,
  addLead, notify,
}: Props) {
  if (!convertRow) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl" onClick={e=>{if(e.target===e.currentTarget)setConvertRow(null);}}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-orange-50">
          <div>
            <h3 className="font-extrabold text-gray-900">🔄 تحويل العميل</h3>
            <p className="text-xs text-gray-500 mt-0.5">{convertRow.name}</p>
          </div>
          <button onClick={()=>setConvertRow(null)} className="text-gray-400 hover:text-gray-700"><X size={20}/></button>
        </div>
        <div className="p-5">
          {!convertType ? (
            <div className="space-y-2">
              <p className="text-sm font-bold text-gray-700 mb-3">اختر نوع التحويل:</p>
              {([
                {key:'finished' as const, label:'✅ منتهي',            cls:'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'},
                {key:'paused'   as const, label:'⏸ متوقف',             cls:'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'},
                {key:'refunded' as const, label:'↩️ استرداد',          cls:'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'},
                {key:'leads'    as const, label:'👥 عملاء محتملين',    cls:'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'},
                isDaqqiClientsTab
                  ? {key:'online' as const, label:'🌐 تحويل لأونلاين', cls:'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100'}
                  : {key:'daqqi'  as const, label:'🏢 فرع الدقي',      cls:'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'},
              ] as {key:'finished'|'paused'|'refunded'|'leads'|'daqqi'|'online';label:string;cls:string}[]).map(opt => (
                <button key={opt.key} onClick={()=>setConvertType(opt.key)}
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm font-bold transition ${opt.cls}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {convertType === 'finished' && (
                <>
                  <p className="text-sm font-bold text-gray-700 mb-1">هل حضر العميل اللايف؟</p>
                  <div className="flex gap-2">
                    <button onClick={()=>setConvertAttendedLive(true)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${convertAttendedLive ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 hover:bg-gray-50'}`}>✅ نعم</button>
                    <button onClick={()=>setConvertAttendedLive(false)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${!convertAttendedLive ? 'bg-gray-600 text-white border-gray-600' : 'border-gray-200 hover:bg-gray-50'}`}>❌ لا</button>
                  </div>
                  <p className="text-sm font-bold text-gray-700 mb-1">هل استلم العميل شهادته؟</p>
                  <div className="flex gap-2">
                    <button onClick={()=>setConvertGotCert(true)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${convertGotCert ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 hover:bg-gray-50'}`}>✅ نعم</button>
                    <button onClick={()=>setConvertGotCert(false)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${!convertGotCert ? 'bg-gray-600 text-white border-gray-600' : 'border-gray-200 hover:bg-gray-50'}`}>❌ لا</button>
                  </div>
                </>
              )}
              {convertType === 'paused' && (
                <>
                  <label className="block text-sm font-bold text-gray-700 mb-1">سبب التوقف:</label>
                  <textarea value={convertPauseReason} onChange={e=>setConvertPauseReason(e.target.value)}
                    rows={3} placeholder="اكتب سبب التوقف..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 resize-none" />
                </>
              )}
              {convertType === 'refunded' && (
                <>
                  <label className="block text-sm font-bold text-gray-700 mb-1">سبب الاسترداد: <span className="text-red-500">*</span></label>
                  <textarea value={convertRefundReason} onChange={e=>setConvertRefundReason(e.target.value)}
                    rows={3} placeholder="اكتب سبب الاسترداد..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none" />
                  <label className="block text-sm font-bold text-gray-700 mb-1 mt-2">المبلغ المطلوب للاسترداد (ج.م):</label>
                  <input type="number" min="0" value={convertRefundAmount} onChange={e=>setConvertRefundAmount(e.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
                  <label className="block text-sm font-bold text-gray-700 mb-1 mt-2">طريقة تحويل الاسترداد:</label>
                  <select value={convertRefundMethod} onChange={e=>setConvertRefundMethod(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 bg-white">
                    <option value="">اختر الطريقة (اختياري)</option>
                    <option value="bank">تحويل بنكي</option>
                    <option value="vodafone">فودافون كاش</option>
                    <option value="instapay">إنستاباي</option>
                    <option value="cash">كاش</option>
                    <option value="other">أخرى</option>
                  </select>
                </>
              )}
              {convertType === 'leads' && (
                <p className="text-sm text-gray-600 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                  سيتم نقل هذا العميل بشكل مباشر إلى صفحة العملاء المحتملين وحذفه من عملاء الأونلاين. هل أنت متأكد؟
                </p>
              )}
              {convertType === 'daqqi' && (
                <p className="text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                  سيتم تحويل هذا العميل إلى فرع الدقي. هل أنت متأكد؟
                </p>
              )}
              {convertType === 'online' && (
                <p className="text-sm text-gray-600 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2">
                  سيتم تحويل هذا العميل من فرع الدقي إلى الأونلاين. هل أنت متأكد؟
                </p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <button onClick={()=>setConvertType('')} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm hover:bg-gray-50">رجوع</button>
                <button disabled={convertSaving || (convertType==='paused' && !convertPauseReason.trim()) || (convertType==='refunded' && !convertRefundReason.trim()) || (convertType as string)===''}
                  onClick={async()=>{
                    if (!convertRow) return;
                    setConvertSaving(true);
                    try {
                      const answers: Record<string,unknown> = {};
                      if (convertType === 'finished') { answers.attendedLive = convertAttendedLive; answers.gotCert = convertGotCert; }
                      if (convertType === 'paused')   { answers.pauseReason  = convertPauseReason; }
                      if (convertType === 'refunded') { answers.refundReason = convertRefundReason; answers.refundAmount = convertRefundAmount; answers.refundMethod = convertRefundMethod; }
                      if (convertType === 'daqqi')    { answers.transferToDaqqi = true; }
                      if (convertType === 'online') {
                        const { crm_json: _dropCrm2, ...onlineRowClean } = convertRow as SubscriberItem & { crm_json?: unknown };
                        const onlineUpdated: SubscriberItem = { ...onlineRowClean, branch: 'ONLINE_EGYPT' as const, clientStatus: 'active' as const, transferDate: new Date().toISOString().slice(0,10) };
                        updateSubscriber(onlineUpdated);
                        setSalesOwnSubscribers(prev => prev.map(s => s.id === onlineUpdated.id ? onlineUpdated : s));
                        await mysqlAdmin.saveSubscriber(onlineUpdated as unknown as Record<string,unknown>);
                        setConvertRow(null);
                        notify('success', `✅ تم تحويل ${convertRow.name} إلى الأونلاين`);
                        setConvertSaving(false);
                        return;
                      }
                      if (convertType === 'leads') {
                        // Create a real lead from this subscriber
                        const subAsLead: LeadItem = {
                          id: `lead-${convertRow.id}-${Date.now()}`,
                          name: convertRow.name || '',
                          email: convertRow.email || '',
                          phone: convertRow.phone || '',
                          source: isDaqqiClientsTab ? 'محول من الدقي' : 'محول من أونلاين',
                          status: 'new' as LeadStatus,
                          leadType: 'course',
                          enrolledCourseId: (convertRow.enrolledCourseIds||[])[0] || '',
                          branch: (convertRow.branch || 'other') as any,
                          interestLevel: 'medium',
                          assignedSalesId: convertRow.assignedCsId || '',
                          assignedSalesName: '',
                          communications: [],
                          notes: convertRow.notes || '',
                          createdAt: new Date().toISOString().slice(0,10),
                        };
                        // Delete subscriber FIRST so addLead doesn't get blocked by isSubscriber check
                        deleteSubscriber(convertRow.id);
                        setSalesOwnSubscribers(prev => prev.filter(s => s.id !== convertRow.id));
                        await addLead(subAsLead);
                        setConvertRow(null);
                        notify('success', `✅ تم تحويل ${convertRow.name} إلى العملاء المحتملين`);
                        setConvertSaving(false);
                        return;
                      }
                      // Strip any stale crm_json property to prevent nesting in DB
                      const { crm_json: _dropCrm, ...convertRowClean } = convertRow as SubscriberItem & { crm_json?: unknown };
                      const updated: SubscriberItem = {
                        ...convertRowClean,
                        clientStatus: convertType === 'daqqi' ? undefined : convertType,
                        transferAnswers: answers,
                        transferDate: new Date().toISOString().slice(0,10),
                        ...(convertType === 'daqqi' ? { branch: 'DAQQI' as const } : {}),
                      };
                      // Update local state immediately for snappy UI
                      updateSubscriber(updated);
                      setSalesOwnSubscribers(prev => prev.map(s => s.id === updated.id ? updated : s));
                      // Await explicit server save so errors are caught and shown
                      await mysqlAdmin.saveSubscriber(updated as unknown as Record<string,unknown>);
                      setConvertRow(null);
                      const typeLabel = convertType === 'finished' ? 'منتهي' : convertType === 'paused' ? 'متوقف' : convertType === 'refunded' ? 'قائمة طلبات الاسترداد (ينتظر موافقة)' : 'فرع الدقي';
                      notify('success', `✅ تم تحويل العميل إلى ${typeLabel}`);
                    } catch (err: unknown) {
                      notify('error', '❌ فشل التحويل: ' + (err instanceof Error ? err.message : String(err)));
                    } finally {
                      setConvertSaving(false);
                    }
                  }}
                  className="flex-1 bg-orange-600 text-white rounded-xl px-3 py-2 text-sm font-bold hover:bg-orange-700 disabled:opacity-50 transition">
                  {convertSaving ? '⏳...' : '✅ تأكيد التحويل'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
