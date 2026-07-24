import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { Bundle, Course, SubscriberItem } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  salesOwnSubscribers: SubscriberItem[];
  updateSubscriber: (s: SubscriberItem) => void;
  courses: Course[];
  bundles: Bundle[];
  notify: NotifyFn;
  daqqiSubSearch: string;
  setDaqqiSubSearch: (v: string) => void;
  daqqiAccDateFrom: string;
  setDaqqiAccDateFrom: (v: string) => void;
  daqqiAccDateTo: string;
  setDaqqiAccDateTo: (v: string) => void;
  omOrdReviewTab: 'review' | 'accepted' | 'failed';
  setOmOrdReviewTab: (v: 'review' | 'accepted' | 'failed') => void;
}

export default function OrdersOnlineManagerView({
  salesOwnSubscribers, updateSubscriber, courses, bundles, notify,
  daqqiSubSearch, setDaqqiSubSearch,
  daqqiAccDateFrom, setDaqqiAccDateFrom,
  daqqiAccDateTo, setDaqqiAccDateTo,
  omOrdReviewTab, setOmOrdReviewTab,
}: Props) {
  const navigate = useNavigate();
  const omSubs = salesOwnSubscribers;
  const omAllPay = omSubs.flatMap(s => (s.paymentHistory||[]).map(p => ({
    ...p, clientName: s.name, clientCode: s.clientCode||s.id, clientId: s.id, subEmail: s.email,
  }))).sort((a,b)=>((b.at||'')>(a.at||'')?1:-1));
  const [omOrdDateFrom2, setOmOrdDateFrom2] = [daqqiAccDateFrom, setDaqqiAccDateFrom];
  const [omOrdDateTo2, setOmOrdDateTo2] = [daqqiAccDateTo, setDaqqiAccDateTo];
  const filteredOm = omAllPay.filter(p => {
    const d=(p.at||'').slice(0,10);
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
  const todayOmStr = new Date().toISOString().slice(0,10);
  const thisMonthOmStr = new Date().toISOString().slice(0,7);
  const toEGP = (p:{amount:unknown;currency?:string}) => {
    const n=Number(p.amount)||0;
    return p.currency==='SAR'?n*13:p.currency==='USD'?n*50:n;
  };
  const todayAmtOm  = acceptedOm.filter(p=>(p.at||'').slice(0,10)===todayOmStr).reduce((s,p)=>s+toEGP(p),0);
  const monthAmtOm  = acceptedOm.filter(p=>(p.at||'').startsWith(thisMonthOmStr)).reduce((s,p)=>s+toEGP(p),0);
  return (
    <article className="space-y-4" dir="rtl">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {label:'إجمالي الدفعات', value:acceptedOm.length, color:'bg-slate-50 text-slate-700 border-slate-200'},
          {label:'انتظار تأكيد',   value:pendingOm.length,  color:'bg-amber-50 text-amber-700 border-amber-200'},
          {label:'تحصيل اليوم',    value:`${todayAmtOm.toLocaleString()} ج`, color:'bg-emerald-50 text-emerald-700 border-emerald-200'},
          {label:'تحصيل الشهر',   value:`${monthAmtOm.toLocaleString()} ج`, color:'bg-blue-50 text-blue-700 border-blue-200'},
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
        <span className="text-xs text-gray-400 ml-auto">{tabRowsOm.length} دفعة — {tabRowsOm.reduce((s,p)=>s+toEGP(p),0).toLocaleString()} ج</span>
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
                return (
                  <tr key={payId} className={`hover:bg-emerald-50/20 ${isPending?'bg-amber-50/40':''}`}>
                    <td className="px-2 py-2 border border-gray-200 text-[10px] font-mono text-gray-400">#{payId.slice(-6)}</td>
                    <td className="px-2 py-2 border border-gray-200">
                      <button onClick={()=>navigate(`/client/${p.clientCode}`)} className="font-semibold text-gray-800 hover:text-emerald-700 text-[11px]">{p.clientName}</button>
                      {p.clientCode&&<div className="text-[9px] text-indigo-600 font-mono">#{p.clientCode}</div>}
                    </td>
                    <td className="px-2 py-2 border border-gray-200 text-[10px] text-gray-600 max-w-[140px] truncate" title={courseTitle}>{courseTitle}</td>
                    <td className="px-2 py-2 border border-gray-200 text-center font-extrabold text-emerald-700">{payAmt.toLocaleString()} {currSymbol}</td>
                    <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-600">{(p as {paymentMethod?:string}).paymentMethod||'—'}</td>
                    <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500">{(p as {staffName?:string}).staffName||'—'}</td>
                    <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500 whitespace-nowrap">{((p as {at?:string}).at||'').slice(0,10)||'—'}</td>
                    <td className="px-2 py-2 border border-gray-200 text-center">
                      {isPending
                        ?<span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-bold">⏳ انتظار</span>
                        :p.status==='failed'||p.status==='refunded'
                          ?<span className="text-[10px] bg-red-100 text-red-700 border border-red-200 rounded-full px-1.5 py-0.5 font-bold">❌ {p.status==='refunded'?'مرتجع':'فاشلة'}</span>
                          :<span className="text-[10px] bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5 py-0.5 font-bold">✅ مؤكد</span>}
                    </td>
                    <td className="px-2 py-2 border border-gray-200 text-[10px] text-gray-400 max-w-[100px] truncate">{(p as {note?:string}).note||'—'}</td>
                    {omOrdReviewTab==='review' && (
                      <td className="px-2 py-2 border border-gray-200 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={async()=>{
                            const sub = omSubs.find(s=>s.id===p.clientId);
                            if(!sub) return;
                            const newPH = (sub.paymentHistory||[]).map(ph=>ph.id===payId?{...ph,status:'paid' as const}:ph);
                            const updated = {...sub, paymentHistory: newPH};
                            updateSubscriber(updated);
                            await mysqlAdmin.saveSubscriber(updated as unknown as Record<string, unknown>);
                            notify('success', 'تم قبول الدفعة ✅');
                          }} className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded-lg font-bold">قبول</button>
                          <button onClick={async()=>{
                            const sub = omSubs.find(s=>s.id===p.clientId);
                            if(!sub) return;
                            const newPH = (sub.paymentHistory||[]).map(ph=>ph.id===payId?{...ph,status:'failed' as const}:ph);
                            const updated = {...sub, paymentHistory: newPH};
                            updateSubscriber(updated);
                            await mysqlAdmin.saveSubscriber(updated as unknown as Record<string, unknown>);
                            notify('info', 'تم رفض الدفعة');
                          }} className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-lg font-bold">رفض</button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {tabRowsOm.length===0&&<tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">لا توجد مدفوعات مطابقة.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </article>
  );
}
