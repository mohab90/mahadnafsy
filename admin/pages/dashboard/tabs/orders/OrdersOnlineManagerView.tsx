// The online manager's view of their clients' payments.
import { cairoDateOnly, cairoMonthOnly, cairoDay } from '../../../../../shared/cairoDate';
import { paymentOrigin, PAYMENT_ORIGIN, PAYMENT_ORIGIN_CLASS } from '../../../../lib/paymentOrigin';
import { Search } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { OrdersTabProps } from './ordersTypes';
import type { OrderActions } from './useOrderActions';
import { useState } from 'react';
import { LinkTransferDialog, type TransferLink } from './LinkTransferDialog';

type LinkTarget = { id: string; name: string; amount: number; currency: string; method: string; reference: string; at: string };

export function OrdersOnlineManagerView({ props, actions }: { props: OrdersTabProps; actions: OrderActions }) {
  const { canManageFinancial, notify, courses, bundles, salesOwnSubscribers, daqqiSubSearch, setDaqqiSubSearch, daqqiAccDateFrom, setDaqqiAccDateFrom, daqqiAccDateTo, setDaqqiAccDateTo, omOrdReviewTab, setOmOrdReviewTab, reloadOrders, reloadSubscribers } = props;
  const { paymentBoxes, navigate, approveMethod, setApproveMethod, canAcceptDirectly } = actions;
  // Only the manager accepts a payment outright; everybody else ties it to the
  // transfer that brought the money, or rejects it (lib/paymentApprovalPolicy.js).
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const linkAndApprove = async (link: TransferLink | null) => {
    if (!linkTarget) return;
    setLinkBusy(true);
    try {
      const method = linkTarget.method || (link && 'method' in link ? link.method : undefined);
      await mysqlAdmin.adminPatch(`/admin/payments/${encodeURIComponent(linkTarget.id)}/status`, { status: 'paid', transfer: link, paymentMethod: method });
      setLinkTarget(null);
      await Promise.all([reloadSubscribers(), reloadOrders()]);
      notify('success', `✅ اتربطت دفعة ${linkTarget.name} بالتحويل واتعتمدت`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الربط');
    } finally { setLinkBusy(false); }
  };
              const omSubs = salesOwnSubscribers;
              const omAllPay = omSubs.flatMap(s => (s.paymentHistory||[]).map(p => ({
                ...p, clientName: s.name, clientCode: s.clientCode||s.id, clientId: s.id, subEmail: s.email,
              }))).sort((a,b)=>((b.at||'')>(a.at||'')?1:-1));
              const [omOrdDateFrom2, setOmOrdDateFrom2] = [daqqiAccDateFrom, setDaqqiAccDateFrom];
              const [omOrdDateTo2, setOmOrdDateTo2] = [daqqiAccDateTo, setDaqqiAccDateTo];
              const filteredOm = omAllPay.filter(p => {
                const d=cairoDay(p.at);
                if(omOrdDateFrom2&&d<omOrdDateFrom2) return false;
                if(omOrdDateTo2&&d>omOrdDateTo2) return false;
                if(daqqiSubSearch.trim()){
                  const q=daqqiSubSearch.toLowerCase();
                  if(!(p.clientName||'').toLowerCase().includes(q)&&!(p.clientCode||'').toLowerCase().includes(q)) return false;
                }
                return true;
              });
              const pendingOm   = filteredOm.filter(p=>p.status==='pending');
              const acceptedOm  = filteredOm.filter(p=>p.status!=='pending'&&p.status!=='failed'&&p.status!=='refunded');
              const failedOm    = filteredOm.filter(p=>p.status==='failed'||p.status==='refunded');
              const tabRowsOm = omOrdReviewTab==='review' ? pendingOm : omOrdReviewTab==='accepted' ? acceptedOm : failedOm;
              const todayOmStr = cairoDateOnly();
              const thisMonthOmStr = cairoMonthOnly();
              const toEGP = (p:{amount:unknown;currency?:string}) => {
                const n=Number(p.amount)||0;
                return p.currency==='SAR'?n*13:p.currency==='USD'?n*50:n;
              };
              const todayAmtOm  = acceptedOm.filter(p=>cairoDay(p.at)===todayOmStr).reduce((s,p)=>s+toEGP(p),0);
              const monthAmtOm  = acceptedOm.filter(p=>(p.at||'').startsWith(thisMonthOmStr)).reduce((s,p)=>s+toEGP(p),0);
              return (
                <article className="space-y-4" dir="rtl">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      {label:'إجمالي الدفعات', value:acceptedOm.length, color:'bg-slate-50 text-slate-700 border-slate-200'},
                      {label:'انتظار تأكيد',   value:pendingOm.length,  color:'bg-amber-50 text-amber-700 border-amber-200'},
                      {label:'تحصيل اليوم',    value:`${todayAmtOm.toLocaleString('ar-EG-u-nu-latn')} ج`, color:'bg-emerald-50 text-emerald-700 border-emerald-200'},
                      {label:'تحصيل الشهر',   value:`${monthAmtOm.toLocaleString('ar-EG-u-nu-latn')} ج`, color:'bg-blue-50 text-blue-700 border-blue-200'},
                    ].map(k=>(
                      <div key={k.label} className={`border rounded-xl px-3 py-3 ${k.color}`}>
                        <div className="text-xs font-medium mb-1">{k.label}</div>
                        <div className="text-xl font-extrabold">{k.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* Review tabs */}
                  <div className="flex gap-2">
                    {([
                      {key:'review' as const,  label:'قيد المراجعة', count:pendingOm.length,  color:'amber'},
                      {key:'accepted' as const,label:'مقبولة',        count:acceptedOm.length, color:'green'},
                      {key:'failed' as const,  label:'فاشلة',         count:failedOm.length,   color:'red'},
                    ]).map(({key,label,count,color}) => {
                      const active = omOrdReviewTab===key;
                      const cls:{[k:string]:string} = {
                        amber: active?'bg-amber-500 text-white border-amber-500':'text-amber-700 border-amber-200 hover:bg-amber-50',
                        green: active?'bg-green-600 text-white border-green-600':'text-green-700 border-green-200 hover:bg-green-50',
                        red:   active?'bg-red-600 text-white border-red-600':'text-red-700 border-red-200 hover:bg-red-50',
                      };
                      return <button key={key} onClick={()=>setOmOrdReviewTab(key)} className={`px-4 py-1.5 rounded-full text-sm font-bold border transition ${cls[color]}`}>{label} ({count})</button>;
                    })}
                  </div>
                  {/* Filters */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-[160px]">
                      <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                      <input value={daqqiSubSearch} onChange={e=>setDaqqiSubSearch(e.target.value)}
                        placeholder="بحث اسم عميل / كود..."
                        className="w-full border border-gray-200 rounded-lg pr-7 pl-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"/>
                    </div>
                    <input type="date" value={omOrdDateFrom2} onChange={e=>setOmOrdDateFrom2(e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="من"/>
                    <input type="date" value={omOrdDateTo2} onChange={e=>setOmOrdDateTo2(e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="إلى"/>
                    {(daqqiSubSearch||omOrdDateFrom2||omOrdDateTo2)&&(
                      <button onClick={()=>{setDaqqiSubSearch('');setOmOrdDateFrom2('');setOmOrdDateTo2('');}}
                        className="text-xs text-red-500 border border-red-200 rounded-lg px-2 py-1.5 bg-red-50 hover:bg-red-100">مسح</button>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">{tabRowsOm.length} دفعة — {tabRowsOm.reduce((s,p)=>s+toEGP(p),0).toLocaleString('ar-EG-u-nu-latn')} ج</span>
                  </div>
                  {/* Table */}
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[900px] border-collapse">
                        <thead>
                          <tr className="bg-gradient-to-l from-emerald-50 to-white text-gray-700">
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-right">رقم الطلب</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-right">العميل</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-right">الكورس</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">المبلغ</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">وسيلة الدفع</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">المصدر</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">الموظف</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">التاريخ</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">الحالة</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-right">ملاحظة</th>
                            {omOrdReviewTab==='review' && <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">إجراءات</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {tabRowsOm.slice(0,200).map((p,i)=>{
                            const cid = (p as {courseId?:string}).courseId||'';
                            const courseTitle = cid.startsWith('bundle:')?bundles.find(b=>b.id===cid.replace('bundle:',''))?.title||'مسار':courses.find(c=>c.id===cid)?.title||(p as {paymentType?:string}).paymentType||'—';
                            const isPending = p.status==='pending';
                            const payAmt = Number(p.amount)||0;
                            const payCur = (p as {currency?:string}).currency||'EGP';
                            const currSymbol = payCur==='SAR'?'ر.س':payCur==='USD'?'$':'ج';
                            const payId = (p as {id?:string}).id||`${i}`;
                            const storedMethod = ((p as {paymentMethod?:string}).paymentMethod||'').trim();
                            const origin = paymentOrigin(p as { source?: string | null; paymentMethod?: string | null });
                            return (
                              <tr key={payId} className={`hover:bg-emerald-50/20 ${isPending?'bg-amber-50/40':''}`}>
                                <td className="px-2 py-2 border border-gray-200 text-[10px] font-mono text-gray-400">#{payId.slice(-6)}</td>
                                <td className="px-2 py-2 border border-gray-200">
                                  <button onClick={()=>navigate(`/client/${p.clientCode}`)} className="font-semibold text-gray-800 hover:text-emerald-700 text-[11px]">{p.clientName}</button>
                                  {p.clientCode&&<div className="text-[9px] text-indigo-600 font-mono">#{p.clientCode}</div>}
                                </td>
                                <td className="px-2 py-2 border border-gray-200 text-[10px] text-gray-600 max-w-[140px] truncate" title={courseTitle}>{courseTitle}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center font-extrabold text-emerald-700">{payAmt.toLocaleString('ar-EG-u-nu-latn')} {currSymbol}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-600">{(p as {paymentMethod?:string}).paymentMethod||'—'}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center">
                                  <span title={PAYMENT_ORIGIN[origin].hint} className={`text-[10px] font-bold border rounded-full px-1.5 py-0.5 whitespace-nowrap ${PAYMENT_ORIGIN_CLASS[origin]}`}>
                                    {PAYMENT_ORIGIN[origin].label}
                                  </span>
                                </td>
                                <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500">{(p as {staffName?:string}).staffName||'—'}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500 whitespace-nowrap">{cairoDay((p as {at?:string}).at)||'—'}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center">
                                  {isPending
                                    ?<span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-bold">⏳ انتظار</span>
                                    :p.status==='failed'||p.status==='refunded'
                                      ?<span className="text-[10px] bg-red-100 text-red-700 border border-red-200 rounded-full px-1.5 py-0.5 font-bold">❌ {p.status==='refunded'?'مرتجع':'فاشلة'}</span>
                                      :<span className="text-[10px] bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5 py-0.5 font-bold">✅ مؤكد</span>}
                                </td>
                                <td className="px-2 py-2 border border-gray-200 text-[10px] text-gray-400 max-w-[100px] truncate">{(p as {note?:string}).note||'—'}</td>
                                {omOrdReviewTab==='review' && canManageFinancial && (
                                  <td className="px-2 py-2 border border-gray-200 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                       {canAcceptDirectly && (<>
                                         {!storedMethod && (
                                           <select
                                             aria-label="طريقة الدفع"
                                             value={approveMethod[payId] || ''}
                                             onChange={e=>setApproveMethod(prev=>({ ...prev, [payId]: e.target.value }))}
                                             className={`text-[10px] rounded-lg px-1 py-1 border-2 font-bold ${approveMethod[payId] ? 'border-gray-200 bg-white' : 'border-amber-400 bg-amber-50 text-amber-800'}`}
                                           >
                                             <option value="">طريقة الدفع…</option>
                                             {paymentBoxes.map((m: string) => <option key={m} value={m}>{m}</option>)}
                                           </select>
                                         )}
                                         <button disabled={!storedMethod && !approveMethod[payId]} onClick={async()=>{
                                           try {
                                             await mysqlAdmin.updatePaymentStatus(payId, 'paid', undefined, approveMethod[payId] || undefined);
                                             await Promise.all([reloadSubscribers(), reloadOrders()]);
                                             notify('success', 'تم اعتماد الدفعة وإنشاء القيد المحاسبي ✅');
                                           } catch (error) {
                                             notify('error', error instanceof Error ? error.message : 'تعذر اعتماد الدفعة');
                                           }
                                         }} className="text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-2 py-1 rounded-lg font-bold">قبول</button>
                                       </>)}
                                       <button type="button" onClick={()=>setLinkTarget({ id: payId, name: p.clientName || '', amount: payAmt, currency: payCur, method: storedMethod, reference: (p as {transactionId?:string}).transactionId || '', at: cairoDay((p as {at?:string}).at) })}
                                         className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-2 py-1 rounded-lg font-bold" title="ربط بالتحويل واعتماد">🔗 ربط</button>
                                       <button onClick={async()=>{
                                         try {
                                           await mysqlAdmin.updatePaymentStatus(payId, 'failed');
                                           await Promise.all([reloadSubscribers(), reloadOrders()]);
                                           notify('info', 'تم رفض الدفعة');
                                         } catch (error) {
                                           notify('error', error instanceof Error ? error.message : 'تعذر رفض الدفعة');
                                         }
                                      }} className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-lg font-bold">رفض</button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                          {tabRowsOm.length===0&&<tr><td colSpan={11} className="px-3 py-10 text-center text-gray-400">لا توجد مدفوعات مطابقة.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {linkTarget && (
                    <LinkTransferDialog title={linkTarget.name} customerName={linkTarget.name} amount={linkTarget.amount} currency={linkTarget.currency}
                      method={linkTarget.method} reference={linkTarget.reference} date={linkTarget.at} busy={linkBusy}
                      onConfirm={link => void linkAndApprove(link)} onClose={() => setLinkTarget(null)} />
                  )}
                </article>
              );
}
