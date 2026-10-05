// The Dokki manager's view of their clients' payments.
import { cairoDateOnly, cairoMonthOnly, cairoDay } from '../../../../../shared/cairoDate';
import { paymentOrigin, PAYMENT_ORIGIN, PAYMENT_ORIGIN_CLASS } from '../../../../lib/paymentOrigin';
import { Download, Search } from 'lucide-react';
import { downloadCsv } from '../../../../../shared/csv';
import type { OrdersTabProps } from './ordersTypes';
import type { OrderActions } from './useOrderActions';

export function OrdersDaqqiView({ props, actions }: { props: OrdersTabProps; actions: OrderActions }) {
  const { courses, salesOwnSubscribers, daqqiSubSearch, setDaqqiSubSearch, daqqiAccDateFrom, setDaqqiAccDateFrom, daqqiAccDateTo, setDaqqiAccDateTo } = props;
  const { navigate } = actions;
              const daqqiSubs = salesOwnSubscribers;
              const daqqiOrdAllPay = daqqiSubs.flatMap(s => (s.paymentHistory||[]).map(p => ({
                ...p, clientName: s.name, clientCode: s.clientCode||s.id, clientId: s.id,
              }))).filter(p => (p.currency==='EGP'||!p.currency) && p.status!=='failed').sort((a,b)=>((b.at||'')>(a.at||'')?1:-1));
              const daqqiOrdDateFrom2 = daqqiAccDateFrom;
              const daqqiOrdDateTo2 = daqqiAccDateTo;
              const filtered2 = daqqiOrdAllPay.filter(p => {
                const d=cairoDay(p.at);
                if(daqqiOrdDateFrom2&&d<daqqiOrdDateFrom2) return false;
                if(daqqiOrdDateTo2&&d>daqqiOrdDateTo2) return false;
                if(daqqiSubSearch.trim()){
                  const q=daqqiSubSearch.toLowerCase();
                  if(!(p.clientName||'').toLowerCase().includes(q)&&!(p.clientCode||'').toLowerCase().includes(q)&&!(p.paymentMethod||'').toLowerCase().includes(q)) return false;
                }
                return true;
              });
              const todayOrd=cairoDateOnly();
              const thisMonthOrd=cairoMonthOnly();
              const sumOrd=(arr:{amount:unknown}[])=>arr.reduce((s,p)=>s+(Number(p.amount)||0),0);
              const confirmedPay=daqqiOrdAllPay.filter(p=>p.status!=='pending');
              const pendingPay=daqqiOrdAllPay.filter(p=>p.status==='pending');
              const todayAmt=sumOrd(confirmedPay.filter(p=>cairoDay(p.at)===todayOrd));
              const monthAmt=sumOrd(confirmedPay.filter(p=>(p.at||'').startsWith(thisMonthOrd)));
              return (
                <article className="space-y-4" dir="rtl">
                  {/* KPI */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      {label:'إجمالي الدفعات',  value:confirmedPay.length,                      color:'bg-slate-50 text-slate-700 border-slate-200'},
                      {label:'انتظار تأكيد',     value:pendingPay.length,                         color:'bg-amber-50 text-amber-700 border-amber-200'},
                      {label:'محصّل اليوم',      value:`${todayAmt.toLocaleString('ar-EG-u-nu-latn')} ج.م`,        color:'bg-emerald-50 text-emerald-700 border-emerald-200'},
                      {label:'محصّل هذا الشهر', value:`${monthAmt.toLocaleString('ar-EG-u-nu-latn')} ج.م`,        color:'bg-blue-50 text-blue-700 border-blue-200'},
                    ].map(k=>(
                      <div key={k.label} className={`border rounded-xl px-3 py-3 ${k.color}`}>
                        <div className="text-xs font-medium mb-1">{k.label}</div>
                        <div className="text-xl font-extrabold">{k.value}</div>
                      </div>
                    ))}
                  </div>
                  {/* Filters */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-[160px]">
                      <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                      <input value={daqqiSubSearch} onChange={e=>setDaqqiSubSearch(e.target.value)}
                        placeholder="بحث اسم عميل / كود..."
                        className="w-full border border-gray-200 rounded-lg pr-7 pl-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-purple-200"/>
                    </div>
                    <input type="date" value={daqqiAccDateFrom} onChange={e=>setDaqqiAccDateFrom(e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="من"/>
                    <input type="date" value={daqqiAccDateTo} onChange={e=>setDaqqiAccDateTo(e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none" title="إلى"/>
                    {(daqqiSubSearch||daqqiAccDateFrom||daqqiAccDateTo)&&(
                      <button onClick={()=>{setDaqqiSubSearch('');setDaqqiAccDateFrom('');setDaqqiAccDateTo('');}}
                        className="text-xs text-red-500 border border-red-200 rounded-lg px-2 py-1.5 bg-red-50 hover:bg-red-100">مسح</button>
                    )}
                    <span className="text-xs text-gray-400 ml-auto">{filtered2.length} دفعة — {sumOrd(filtered2.filter(p=>p.status!=='pending')).toLocaleString('ar-EG-u-nu-latn')} ج.م</span>
                    <button onClick={()=>{
                      const rows=[['العميل','الكود','الكورس','المبلغ','وسيلة الدفع','الموظف','التاريخ','الحالة','ملاحظة'],...filtered2.map(p=>[p.clientName,p.clientCode,courses.find(c=>c.id===p.courseId)?.title||p.paymentType||'',''+p.amount,p.paymentMethod||'',p.staffName||'',cairoDay(p.at),p.status==='pending'?'انتظار':'مؤكد',p.note||''])];
                      downloadCsv(`daqqi_payments_${cairoDateOnly()}`, rows);
                    }} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700">
                      <Download size={12}/> تصدير CSV
                    </button>
                  </div>
                  {/* Payments table */}
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[750px] border-collapse">
                        <thead>
                          <tr className="bg-gradient-to-l from-purple-50 to-white text-gray-700">
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-right">العميل</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-right">الكورس</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">المبلغ</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">وسيلة الدفع</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">المصدر</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">الموظف</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">التاريخ</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-center">الحالة</th>
                            <th className="px-3 py-2.5 font-bold border border-gray-200 text-right">ملاحظة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered2.slice(0,200).map((p,i)=>{
                            const courseTitle=courses.find(c=>c.id===p.courseId)?.titleAr||courses.find(c=>c.id===p.courseId)?.title||p.paymentType||'—';
                            const isPending=p.status==='pending';
                            return (
                              <tr key={i} className={`hover:bg-purple-50/20 ${isPending?'bg-amber-50/40':''}`}>
                                <td className="px-2 py-2 border border-gray-200">
                                  <button onClick={()=>navigate(`/client/${p.clientCode}`)} className="font-semibold text-gray-800 hover:text-purple-700 text-[11px]">{p.clientName}</button>
                                  {p.clientCode&&<div className="text-[9px] text-indigo-600 font-mono">#{p.clientCode}</div>}
                                </td>
                                <td className="px-2 py-2 border border-gray-200 text-[10px] text-gray-600 max-w-[120px] truncate" title={courseTitle}>{courseTitle}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center font-extrabold text-emerald-700">{Number(p.amount).toLocaleString('ar-EG-u-nu-latn')} ج.م</td>
                                <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-600">{p.paymentMethod||'—'}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center">
                                  <span title={PAYMENT_ORIGIN[paymentOrigin(p)].hint} className={`text-[10px] font-bold border rounded-full px-1.5 py-0.5 whitespace-nowrap ${PAYMENT_ORIGIN_CLASS[paymentOrigin(p)]}`}>
                                    {PAYMENT_ORIGIN[paymentOrigin(p)].label}
                                  </span>
                                </td>
                                <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500">{p.staffName||'—'}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500 whitespace-nowrap">{cairoDay(p.at)||'—'}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center">
                                  {isPending
                                    ?<span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-bold">⏳ انتظار</span>
                                    :<span className="text-[10px] bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5 py-0.5 font-bold">✅ مؤكد</span>}
                                </td>
                                <td className="px-2 py-2 border border-gray-200 text-[10px] text-gray-400 max-w-[100px] truncate">{p.note||'—'}</td>
                              </tr>
                            );
                          })}
                          {filtered2.length===0&&<tr><td colSpan={9} className="px-3 py-10 text-center text-gray-400">لا توجد مدفوعات مطابقة.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </article>
              );
}
