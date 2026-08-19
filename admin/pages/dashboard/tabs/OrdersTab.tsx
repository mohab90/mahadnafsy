import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight, CheckCircle, Clock, CreditCard, Download,
  Plus, Search, TrendingUp, Trash2, Wallet, XCircle,
} from 'lucide-react';
import type { Bundle, Course, OrderItem, StaffMember, SubscriberItem } from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type TransferForm = {
  amount: string;
  currency: 'EGP' | 'SAR' | 'USD';
  method: string;
  senderName: string;
  senderPhone: string;
  reference: string;
  note: string;
  date: string;
  time: string;
  status: 'paid' | 'pending';
};

type OrdersStats = {
  total: number;
  paid: number;
  failed: number;
  refunded: number;
  revenueEGP: number;
  revenueSAR: number;
  revenueUSD: number;
};

interface Props {
  isOnlineManager: boolean;
  isDaqqiManager: boolean;
  isAdmin: boolean;
  canManageFinancial: boolean;
  notify: NotifyFn;
  courses: Course[];
  bundles: Bundle[];

  // OM + Daqqi views
  salesOwnSubscribers: SubscriberItem[];
  daqqiSubSearch: string;
  setDaqqiSubSearch: (v: string) => void;
  daqqiAccDateFrom: string;
  setDaqqiAccDateFrom: (v: string) => void;
  daqqiAccDateTo: string;
  setDaqqiAccDateTo: (v: string) => void;

  // OM only
  omOrdReviewTab: 'review' | 'accepted' | 'failed';
  setOmOrdReviewTab: (v: 'review' | 'accepted' | 'failed') => void;

  // Admin view
  effectiveOrders: OrderItem[];
  filteredOrders: OrderItem[];
  ordersStats: OrdersStats;
  orderSearch: string;
  setOrderSearch: (v: string) => void;
  orderStatusFilter: 'all' | 'paid' | 'failed' | 'refunded';
  setOrderStatusFilter: (v: 'all' | 'paid' | 'failed' | 'refunded') => void;
  orderTypeFilter: 'all' | 'course' | 'bundle' | 'consultation';
  setOrderTypeFilter: (v: 'all' | 'course' | 'bundle' | 'consultation') => void;
  orderMethodFilter: string;
  setOrderMethodFilter: (v: string) => void;
  orderDateFrom: string;
  setOrderDateFrom: (v: string) => void;
  orderDateTo: string;
  setOrderDateTo: (v: string) => void;
  orderStaffFilter: string;
  setOrderStaffFilter: (v: string) => void;
  orderReviewTab: 'review' | 'accepted' | 'failed' | 'transfers';
  setOrderReviewTab: (v: 'review' | 'accepted' | 'failed' | 'transfers') => void;
  showAddTransfer: boolean;
  setShowAddTransfer: (v: boolean) => void;
  linkTransferModal: { row: OrderItem } | null;
  setLinkTransferModal: (v: { row: OrderItem } | null) => void;
  linkOrderModal: { row: OrderItem } | null;
  setLinkOrderModal: (v: { row: OrderItem } | null) => void;
  transferForm: TransferForm;
  setTransferForm: React.Dispatch<React.SetStateAction<TransferForm>>;
  currentStaff: StaffMember | null;
  authUser: { displayName?: string | null; email?: string | null; uid?: string } | null;
  content: Record<string, string>;
  updateOrderStatus: (id: string, status: 'paid' | 'failed' | 'refunded') => Promise<boolean>;
  addOrder: (order: OrderItem) => Promise<boolean>;
  deleteOrder: (id: string) => Promise<boolean>;
  reloadOrders: () => Promise<void>;
  reloadSubscribers: () => Promise<void>;
  exportFilteredOrdersCsv: (rows: OrderItem[]) => void;
}

export default function OrdersTab({
  isOnlineManager, isDaqqiManager, isAdmin, canManageFinancial,
  notify, courses, bundles,
  salesOwnSubscribers,
  daqqiSubSearch, setDaqqiSubSearch,
  daqqiAccDateFrom, setDaqqiAccDateFrom,
  daqqiAccDateTo, setDaqqiAccDateTo,
  omOrdReviewTab, setOmOrdReviewTab,
  effectiveOrders, filteredOrders, ordersStats,
  orderSearch, setOrderSearch,
  setOrderStatusFilter,
  orderTypeFilter, setOrderTypeFilter,
  orderMethodFilter, setOrderMethodFilter,
  orderDateFrom, setOrderDateFrom,
  orderDateTo, setOrderDateTo,
  orderStaffFilter, setOrderStaffFilter,
  orderReviewTab, setOrderReviewTab,
  showAddTransfer, setShowAddTransfer,
  linkTransferModal, setLinkTransferModal,
  linkOrderModal, setLinkOrderModal,
  transferForm, setTransferForm,
  currentStaff, authUser, content,
  updateOrderStatus, addOrder, deleteOrder, reloadOrders, reloadSubscribers, exportFilteredOrdersCsv,
}: Props) {
  const navigate = useNavigate();

  const handleConfirmOrder = async (row: OrderItem) => {
    if (!canManageFinancial) {
      notify('error', 'تأكيد المدفوعات يتطلب صلاحية الإدارة المالية.');
      return;
    }
    if (!isAdmin && row.staffId && row.staffId === currentStaff?.id) {
      notify('error', 'لا يمكنك تأكيد دفعة قمت بتسجيلها أنت.');
      return;
    }
    try {
      await mysqlAdmin.adminPost(`/admin/orders/${row.id}/confirm-payment`, {});
      await Promise.all([reloadOrders(), reloadSubscribers()]);
      notify('success', `✅ تم تأكيد دفعة ${row.customerName} بنجاح`);
    } catch {
      notify('error', 'تعذر تأكيد الدفعة — تحقق من أن الطلب لسه قيد المراجعة.');
    }
  };

  // ── Online Manager view ──────────────────────────────────────────────────
  if (isOnlineManager && !isAdmin) {
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
                                {omOrdReviewTab==='review' && canManageFinancial && (
                                  <td className="px-2 py-2 border border-gray-200 text-center">
                                    <div className="flex items-center justify-center gap-1">
                                       <button onClick={async()=>{
                                         try {
                                           await mysqlAdmin.updatePaymentStatus(payId, 'paid');
                                           await Promise.all([reloadSubscribers(), reloadOrders()]);
                                           notify('success', 'تم اعتماد الدفعة وإنشاء القيد المحاسبي ✅');
                                         } catch (error) {
                                           notify('error', error instanceof Error ? error.message : 'تعذر اعتماد الدفعة');
                                         }
                                       }} className="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded-lg font-bold">قبول</button>
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
                          {tabRowsOm.length===0&&<tr><td colSpan={10} className="px-3 py-10 text-center text-gray-400">لا توجد مدفوعات مطابقة.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </article>
              );
  }

  // ── Daqqi Manager view ───────────────────────────────────────────────────
  if (isDaqqiManager && !isAdmin) {
              const daqqiSubs = salesOwnSubscribers;
              const daqqiOrdAllPay = daqqiSubs.flatMap(s => (s.paymentHistory||[]).map(p => ({
                ...p, clientName: s.name, clientCode: s.clientCode||s.id, clientId: s.id,
              }))).filter(p => (p.currency==='EGP'||!p.currency) && p.status!=='failed').sort((a,b)=>((b.at||'')>(a.at||'')?1:-1));
              const [daqqiOrdDateFrom2, setDaqqiOrdDateFrom2] = [daqqiAccDateFrom, setDaqqiAccDateFrom];
              const [daqqiOrdDateTo2, setDaqqiOrdDateTo2] = [daqqiAccDateTo, setDaqqiAccDateTo];
              const filtered2 = daqqiOrdAllPay.filter(p => {
                const d=(p.at||'').slice(0,10);
                if(daqqiOrdDateFrom2&&d<daqqiOrdDateFrom2) return false;
                if(daqqiOrdDateTo2&&d>daqqiOrdDateTo2) return false;
                if(daqqiSubSearch.trim()){
                  const q=daqqiSubSearch.toLowerCase();
                  if(!(p.clientName||'').toLowerCase().includes(q)&&!(p.clientCode||'').toLowerCase().includes(q)&&!(p.paymentMethod||'').toLowerCase().includes(q)) return false;
                }
                return true;
              });
              const todayOrd=new Date().toISOString().slice(0,10);
              const thisMonthOrd=new Date().toISOString().slice(0,7);
              const sumOrd=(arr:{amount:unknown}[])=>arr.reduce((s,p)=>s+(Number(p.amount)||0),0);
              const confirmedPay=daqqiOrdAllPay.filter(p=>p.status!=='pending');
              const pendingPay=daqqiOrdAllPay.filter(p=>p.status==='pending');
              const todayAmt=sumOrd(confirmedPay.filter(p=>(p.at||'').slice(0,10)===todayOrd));
              const monthAmt=sumOrd(confirmedPay.filter(p=>(p.at||'').startsWith(thisMonthOrd)));
              return (
                <article className="space-y-4" dir="rtl">
                  {/* KPI */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      {label:'إجمالي الدفعات',  value:confirmedPay.length,                      color:'bg-slate-50 text-slate-700 border-slate-200'},
                      {label:'انتظار تأكيد',     value:pendingPay.length,                         color:'bg-amber-50 text-amber-700 border-amber-200'},
                      {label:'محصّل اليوم',      value:`${todayAmt.toLocaleString()} ج.م`,        color:'bg-emerald-50 text-emerald-700 border-emerald-200'},
                      {label:'محصّل هذا الشهر', value:`${monthAmt.toLocaleString()} ج.م`,        color:'bg-blue-50 text-blue-700 border-blue-200'},
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
                    <span className="text-xs text-gray-400 ml-auto">{filtered2.length} دفعة — {sumOrd(filtered2.filter(p=>p.status!=='pending')).toLocaleString()} ج.م</span>
                    <button onClick={()=>{
                      const rows=[['العميل','الكود','الكورس','المبلغ','وسيلة الدفع','الموظف','التاريخ','الحالة','ملاحظة'],...filtered2.map(p=>[p.clientName,p.clientCode,courses.find(c=>c.id===p.courseId)?.title||p.paymentType||'',''+p.amount,p.paymentMethod||'',p.staffName||'',(p.at||'').slice(0,10),p.status==='pending'?'انتظار':'مؤكد',p.note||''])];
                      const csv=rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
                      const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
                      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`daqqi_payments_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
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
                                <td className="px-2 py-2 border border-gray-200 text-center font-extrabold text-emerald-700">{Number(p.amount).toLocaleString()} ج.م</td>
                                <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-600">{p.paymentMethod||'—'}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500">{p.staffName||'—'}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center text-[10px] text-gray-500 whitespace-nowrap">{(p.at||'').slice(0,10)||'—'}</td>
                                <td className="px-2 py-2 border border-gray-200 text-center">
                                  {isPending
                                    ?<span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-1.5 py-0.5 font-bold">⏳ انتظار</span>
                                    :<span className="text-[10px] bg-green-100 text-green-700 border border-green-200 rounded-full px-1.5 py-0.5 font-bold">✅ مؤكد</span>}
                                </td>
                                <td className="px-2 py-2 border border-gray-200 text-[10px] text-gray-400 max-w-[100px] truncate">{p.note||'—'}</td>
                              </tr>
                            );
                          })}
                          {filtered2.length===0&&<tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">لا توجد مدفوعات مطابقة.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </article>
              );
  }

  // ── Admin / default view ─────────────────────────────────────────────────
  {
              const todayStr     = new Date().toISOString().slice(0, 10);
              const thisMonthStr = new Date().toISOString().slice(0, 7);
              const toEGP = (r: { amount: number; currency?: string }) =>
                r.currency === 'SAR' ? r.amount * 13 : r.currency === 'USD' ? r.amount * 50 : r.amount;

              const paidAll    = effectiveOrders.filter(r => r.status === 'paid');
              const pendingAll = effectiveOrders.filter(r => r.status === 'pending');
              const failedAll  = effectiveOrders.filter(r => r.status === 'failed' || r.status === 'refunded');

              const todayRevEGP  = paidAll.filter(r => (r.createdAt || '').slice(0, 10) === todayStr).reduce((s, r) => s + toEGP(r), 0);
              const monthRevEGP  = paidAll.filter(r => (r.createdAt || '').startsWith(thisMonthStr)).reduce((s, r) => s + toEGP(r), 0);

              // last 7 days daily revenue for mini-chart
              const last7 = Array.from({ length: 7 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - (6 - i));
                const ds = d.toISOString().slice(0, 10);
                const rev = paidAll.filter(r => (r.createdAt || '').slice(0, 10) === ds).reduce((s, r) => s + toEGP(r), 0);
                const label = d.toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short' });
                return { ds, rev, label };
              });
              const maxRev = Math.max(...last7.map(d => d.rev), 1);

              // unique staff names for filter
              const staffNames = Array.from(new Set(effectiveOrders.map(r => r.staffName).filter(Boolean))) as string[];

              const tabRows = orderReviewTab === 'review'
                ? filteredOrders.filter(r => r.status === 'pending' && r.type !== 'transfer')
                : orderReviewTab === 'accepted'
                  ? filteredOrders.filter(r => (r.status === 'paid' || !r.status) && r.type !== 'transfer')
                  : orderReviewTab === 'transfers'
                    ? effectiveOrders.filter(r => r.type === 'transfer').sort((a,b)=>((b.createdAt||'')>(a.createdAt||'')?1:-1))
                    : filteredOrders.filter(r => (r.status === 'failed' || r.status === 'refunded') && r.type !== 'transfer');

              const tabTotal = tabRows.reduce((s, r) => s + toEGP(r), 0);

              const clearFilters = () => {
                setOrderSearch(''); setOrderTypeFilter('all'); setOrderMethodFilter('all');
                setOrderStaffFilter('all'); setOrderDateFrom(''); setOrderDateTo(''); setOrderStatusFilter('all');
              };
              const hasFilters = orderSearch || orderTypeFilter !== 'all' || orderMethodFilter !== 'all'
                || orderStaffFilter !== 'all' || orderDateFrom || orderDateTo;

              const payMethodBadge = (m: string | undefined) => {
                const map: Record<string, { label: string; cls: string }> = {
                  cash:          { label: 'نقدي',          cls: 'bg-gray-100 text-gray-700' },
                  transfer:      { label: 'تحويل بنكي',    cls: 'bg-blue-100 text-blue-700' },
                  vodafone_cash: { label: 'فودافون كاش',   cls: 'bg-red-100 text-red-700' },
                  instapay:      { label: 'انستا باي',     cls: 'bg-purple-100 text-purple-700' },
                  online_paymob: { label: 'أونلاين/بطاقة', cls: 'bg-indigo-100 text-indigo-700' },
                  card:          { label: 'بطاقة بنكية',   cls: 'bg-cyan-100 text-cyan-700' },
                  wallet:        { label: 'محفظة',          cls: 'bg-teal-100 text-teal-700' },
                  manual:        { label: 'يدوي',           cls: 'bg-orange-100 text-orange-700' },
                };
                const key = (m || '').toLowerCase();
                const info = map[key] || { label: m || '—', cls: 'bg-gray-100 text-gray-500' };
                return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${info.cls}`}>{info.label}</span>;
              };

              const typeBadge = (t: string | undefined) => {
                const map: Record<string, { label: string; cls: string }> = {
                  course:       { label: 'كورس',       cls: 'bg-emerald-100 text-emerald-700' },
                  bundle:       { label: 'مسار',        cls: 'bg-violet-100 text-violet-700' },
                  consultation: { label: 'استشارة',    cls: 'bg-amber-100 text-amber-700' },
                  certificate:  { label: 'شهادة',      cls: 'bg-sky-100 text-sky-700' },
                };
                const info = map[t || ''] || { label: t || '—', cls: 'bg-gray-100 text-gray-500' };
                return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${info.cls}`}>{info.label}</span>;
              };

              return (
                <div className="space-y-4" dir="rtl">
                  {/* ── Header ── */}
                  <div className="bg-gradient-to-l from-emerald-600 to-teal-700 rounded-2xl px-5 py-4 text-white shadow-lg">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <h2 className="text-lg font-extrabold flex items-center gap-2">
                          <CreditCard size={20} /> الطلبات والمدفوعات
                        </h2>
                        <p className="text-emerald-100 text-xs mt-0.5">إجمالي {effectiveOrders.length} طلب مسجّل في النظام</p>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="text-center bg-white/10 rounded-xl px-4 py-2">
                          <div className="text-xs text-emerald-100">إيراد اليوم</div>
                          <div className="text-xl font-extrabold">{todayRevEGP.toLocaleString()} ج</div>
                        </div>
                        <div className="text-center bg-white/10 rounded-xl px-4 py-2">
                          <div className="text-xs text-emerald-100">إيراد الشهر</div>
                          <div className="text-xl font-extrabold">{monthRevEGP.toLocaleString()} ج</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── KPI Cards ── */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                      { label: 'إجمالي الطلبات', value: effectiveOrders.length, icon: CreditCard, bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', itext: 'text-slate-400' },
                      { label: 'مدفوعات مؤكدة',  value: paidAll.length,         icon: CheckCircle, bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', itext: 'text-emerald-400' },
                      { label: 'قيد المراجعة',   value: pendingAll.length,      icon: Clock,       bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   itext: 'text-amber-400' },
                      { label: 'فاشلة / مرتجع',  value: failedAll.length,       icon: XCircle,     bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700',     itext: 'text-red-400' },
                      { label: 'إيراد EGP',       value: `${ordersStats.revenueEGP.toLocaleString()} ج`, icon: Wallet, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', itext: 'text-blue-400' },
                      { label: 'إيراد SAR',       value: `${ordersStats.revenueSAR.toLocaleString()} ر.س`, icon: TrendingUp, bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', itext: 'text-violet-400' },
                    ].map(k => {
                      const Icon = k.icon;
                      return (
                        <div key={k.label} className={`${k.bg} ${k.border} border rounded-xl px-3 py-3 flex flex-col gap-1`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-[10px] font-semibold ${k.text}`}>{k.label}</span>
                            <Icon size={14} className={k.itext} />
                          </div>
                          <div className={`text-lg font-extrabold ${k.text}`}>{k.value}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Mini Revenue Chart (last 7 days) ── */}
                  <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold text-gray-700 flex items-center gap-1.5"><TrendingUp size={13} className="text-emerald-500"/>الإيراد — آخر 7 أيام</h4>
                      <span className="text-[10px] text-gray-400">بالجنيه المصري (مكافئ)</span>
                    </div>
                    <div className="flex items-end gap-1.5 h-16">
                      {last7.map(d => {
                        const pct = maxRev > 0 ? Math.round((d.rev / maxRev) * 100) : 0;
                        const isToday = d.ds === todayStr;
                        return (
                          <div key={d.ds} className="flex-1 flex flex-col items-center gap-1" title={`${d.label}: ${d.rev.toLocaleString()} ج`}>
                            <div className="w-full flex flex-col justify-end h-12 relative group">
                              <div
                                className={`w-full rounded-t-md transition-all ${isToday ? 'bg-emerald-500' : 'bg-emerald-200 group-hover:bg-emerald-400'}`}
                                style={{ height: `${Math.max(pct, 4)}%` }}
                              />
                              {d.rev > 0 && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] text-gray-500 whitespace-nowrap hidden group-hover:block bg-white border border-gray-200 rounded px-1">
                                  {d.rev.toLocaleString()}
                                </div>
                              )}
                            </div>
                            <span className={`text-[9px] ${isToday ? 'font-bold text-emerald-600' : 'text-gray-400'}`}>{d.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Status Tabs + Add Transfer Button ── */}
                  <div className="flex flex-wrap items-center gap-2">
                    {([
                      { key: 'review'    as const, label: 'قيد المراجعة',   count: filteredOrders.filter(r => r.status === 'pending' && r.type !== 'transfer').length,   color: 'amber' },
                      { key: 'accepted'  as const, label: 'مدفوعات مؤكدة', count: filteredOrders.filter(r => (r.status === 'paid' || !r.status) && r.type !== 'transfer').length, color: 'green' },
                      { key: 'failed'    as const, label: 'فاشلة / مرتجع', count: filteredOrders.filter(r => (r.status === 'failed' || r.status === 'refunded') && r.type !== 'transfer').length, color: 'red' },
                      { key: 'transfers' as const, label: 'التحويلات',      count: effectiveOrders.filter(r => r.type === 'transfer').length, color: 'blue' },
                    ]).map(({ key, label, count, color }) => {
                      const active = orderReviewTab === key;
                      const cls: Record<string, string> = {
                        amber: active ? 'bg-amber-500 text-white border-amber-500 shadow-amber-200 shadow-md' : 'text-amber-700 border-amber-200 hover:bg-amber-50',
                        green: active ? 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-200 shadow-md' : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50',
                        red:   active ? 'bg-red-600 text-white border-red-600 shadow-red-200 shadow-md' : 'text-red-700 border-red-200 hover:bg-red-50',
                        blue:  active ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200 shadow-md' : 'text-blue-700 border-blue-200 hover:bg-blue-50',
                      };
                      return (
                        <button key={key} onClick={() => setOrderReviewTab(key)}
                          className={`px-5 py-2 rounded-full text-sm font-bold border transition ${cls[color]}`}>
                          {label}
                          <span className={`mr-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-white/25' : 'bg-gray-100 text-gray-600'}`}>{count}</span>
                        </button>
                      );
                    })}
                    <div className="flex-1" />
                    {/* ── Add Transfer Button ── */}
                    <button onClick={() => {
                      setTransferForm({ amount: '', currency: 'EGP', method: '', senderName: '', senderPhone: '', reference: '', note: '', date: new Date().toISOString().slice(0,10), time: new Date().toTimeString().slice(0,5), status: 'paid' });
                      setShowAddTransfer(true);
                    }}
                      className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-full shadow-md shadow-blue-200 transition">
                      <Plus size={15} /> إضافة تحويل
                    </button>
                  </div>

                  {/* ── Filters ── */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      {/* Search */}
                      <div className="relative flex-1 min-w-[200px]">
                        <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)}
                          placeholder="بحث برقم الطلب، اسم العميل، المنتج..."
                          className="w-full border border-gray-200 rounded-xl pr-7 pl-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                      </div>
                      {/* Type */}
                      <select value={orderTypeFilter} onChange={e => setOrderTypeFilter(e.target.value as 'all'|'course'|'bundle'|'consultation')}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                        <option value="all">كل الأنواع</option>
                        <option value="course">كورس</option>
                        <option value="bundle">مسار تعليمي</option>
                        <option value="consultation">استشارة</option>
                        <option value="certificate">شهادة</option>
                      </select>
                      {/* Method */}
                      <select value={orderMethodFilter} onChange={e => setOrderMethodFilter(e.target.value)}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                        <option value="all">كل الوسائل</option>
                        <option value="cash">نقدي</option>
                        <option value="transfer">تحويل بنكي</option>
                        <option value="vodafone_cash">فودافون كاش</option>
                        <option value="instapay">انستا باي</option>
                        <option value="online_paymob">أونلاين / بطاقة</option>
                        <option value="card">بطاقة بنكية</option>
                        <option value="wallet">محفظة إلكترونية</option>
                        <option value="manual">يدوي</option>
                      </select>
                      {/* Staff */}
                      {staffNames.length > 0 && (
                        <select value={orderStaffFilter} onChange={e => setOrderStaffFilter(e.target.value)}
                          className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                          <option value="all">كل الموظفين</option>
                          {staffNames.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      {/* Quick presets */}
                      {[
                        { label: 'اليوم',   from: todayStr, to: todayStr },
                        { label: 'هذا الأسبوع', from: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0,10); })(), to: todayStr },
                        { label: 'هذا الشهر', from: `${thisMonthStr}-01`, to: todayStr },
                      ].map(p => (
                        <button key={p.label} onClick={() => { setOrderDateFrom(p.from); setOrderDateTo(p.to); }}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition font-medium ${orderDateFrom === p.from && orderDateTo === p.to ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                          {p.label}
                        </button>
                      ))}
                      <input type="date" value={orderDateFrom} onChange={e => setOrderDateFrom(e.target.value)}
                        className="border border-gray-200 rounded-xl px-2 py-1.5 text-xs bg-white focus:outline-none" title="من تاريخ" />
                      <span className="text-gray-400 text-xs">—</span>
                      <input type="date" value={orderDateTo} onChange={e => setOrderDateTo(e.target.value)}
                        className="border border-gray-200 rounded-xl px-2 py-1.5 text-xs bg-white focus:outline-none" title="إلى تاريخ" />
                      {hasFilters && (
                        <button onClick={clearFilters}
                          className="text-xs text-red-500 border border-red-200 rounded-lg px-2.5 py-1.5 bg-red-50 hover:bg-red-100 font-medium">
                          ✕ مسح الفلاتر
                        </button>
                      )}
                      <div className="flex-1" />
                      {/* Summary */}
                      <span className="text-xs text-gray-500 font-medium bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                        {tabRows.length} طلب · {tabTotal.toLocaleString()} ج
                      </span>
                      {/* Export — the active review tab's rows, matching the count shown above (PAY-12) */}
                      <button onClick={() => exportFilteredOrdersCsv(tabRows)} disabled={tabRows.length === 0}
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition ${tabRows.length === 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-900 hover:bg-black text-white'}`}>
                        <Download size={12} /> تصدير CSV
                      </button>
                    </div>
                  </div>

                  {/* ── Transfers Table (separate view) ── */}
                  {orderReviewTab === 'transfers' ? (() => {
                    const transfers = tabRows;
                    const totalEGP = transfers.filter(r => r.status === 'paid').reduce((s, r) => s + toEGP(r), 0);
                    return (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {[
                            { label: 'إجمالي التحويلات', value: transfers.length, cls: 'bg-blue-50 border-blue-200 text-blue-700' },
                            { label: 'محصّل',             value: transfers.filter(r=>r.status==='paid').length, cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
                            { label: 'قيد التأكيد',      value: transfers.filter(r=>r.status==='pending').length, cls: 'bg-amber-50 border-amber-200 text-amber-700' },
                            { label: 'إجمالي محصّل',     value: `${totalEGP.toLocaleString()} ج`, cls: 'bg-violet-50 border-violet-200 text-violet-700' },
                          ].map(k => (
                            <div key={k.label} className={`border rounded-xl px-3 py-3 ${k.cls}`}>
                              <div className="text-[10px] font-semibold mb-1">{k.label}</div>
                              <div className="text-xl font-extrabold">{k.value}</div>
                            </div>
                          ))}
                        </div>
                        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs min-w-[800px] border-collapse">
                              <thead>
                                <tr className="bg-gradient-to-l from-blue-50 to-white text-gray-700 border-b border-gray-200">
                                  <th className="px-3 py-3 font-bold text-right border-l border-gray-100">#</th>
                                  <th className="px-3 py-3 font-bold text-right border-l border-gray-100">المُحوِّل / المرجع</th>
                                  <th className="px-3 py-3 font-bold text-center border-l border-gray-100">المبلغ</th>
                                  <th className="px-3 py-3 font-bold text-center border-l border-gray-100">وسيلة الدفع</th>
                                  <th className="px-3 py-3 font-bold text-right border-l border-gray-100">ملاحظة</th>
                                  <th className="px-3 py-3 font-bold text-center border-l border-gray-100">المُسجِّل</th>
                                  <th className="px-3 py-3 font-bold text-center border-l border-gray-100">التاريخ</th>
                                  <th className="px-3 py-3 font-bold text-center border-l border-gray-100">الحالة</th>
                                  <th className="px-3 py-3 font-bold text-center">إجراءات</th>
                                </tr>
                              </thead>
                              <tbody>
                                {transfers.slice(0, 300).map((row, i) => {
                                  const isPending = row.status === 'pending';
                                  const isFailed  = row.status === 'failed' || row.status === 'refunded';
                                  const rowBg = isPending ? 'bg-amber-50/40 hover:bg-amber-50/70' : isFailed ? 'bg-red-50/30 hover:bg-red-50/60' : 'hover:bg-blue-50/20';
                                  const fmtDate = (() => {
                                    if (!row.createdAt) return '—';
                                    const d = new Date(row.createdAt.replace(' ','T'));
                                    return isNaN(d.getTime()) ? row.createdAt : d.toLocaleString('ar-EG-u-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
                                  })();
                                  return (
                                    <tr key={row.id} className={`border-b border-gray-100 ${rowBg} transition-colors`}>
                                      <td className="px-3 py-2.5 font-mono text-gray-400 border-l border-gray-100 whitespace-nowrap">
                                        <span className="text-[9px]">#{row.id.slice(-6)}</span>
                                        <div className="text-[8px] text-gray-300">{i+1}</div>
                                      </td>
                                      <td className="px-3 py-2.5 border-l border-gray-100">
                                        <div className="font-semibold text-gray-800 text-[11px]">{row.customerName || '—'}</div>
                                        {row.transactionId && <div className="text-[9px] text-blue-500 font-mono">ref: {row.transactionId}</div>}
                                      </td>
                                      <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                        <span className="font-extrabold text-blue-700 text-[12px]">{row.amount?.toLocaleString()}</span>
                                        <span className="text-[9px] text-gray-400 mr-0.5">{row.currency || 'EGP'}</span>
                                      </td>
                                      <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                        {payMethodBadge(row.paymentMethod)}
                                      </td>
                                      <td className="px-3 py-2.5 border-l border-gray-100 max-w-[180px]">
                                        <span className="text-[10px] text-gray-600 line-clamp-2">{row.itemTitle || '—'}</span>
                                      </td>
                                      <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-500">{row.staffName || '—'}</td>
                                      <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-500 whitespace-nowrap" dir="ltr">{fmtDate}</td>
                                      <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                        {isPending
                                          ? <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-bold">⏳ انتظار</span>
                                          : isFailed
                                            ? <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5 font-bold">✕ ملغي</span>
                                            : <span className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-bold">✓ محصّل</span>}
                                      </td>
                                      <td className="px-3 py-2.5 text-center">
                                        <div className="flex items-center justify-center gap-1">
                                          {isPending && canManageFinancial && (
                                            <>
                                              <button onClick={() => handleConfirmOrder(row)}
                                                className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded-lg font-bold transition">✓</button>
                                              <button onClick={() => updateOrderStatus(row.id, 'failed')}
                                                className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-lg font-bold transition">✕</button>
                                            </>
                                          )}
                                          {canManageFinancial && (
                                            <button onClick={() => setLinkTransferModal({ row })}
                                              className="text-[10px] bg-violet-600 hover:bg-violet-700 text-white px-2 py-1 rounded-lg font-bold transition" title="ربط بدفعة عميل">
                                              🔗 ربط
                                            </button>
                                          )}
                                          {isAdmin && (
                                            <button onClick={() => deleteOrder(row.id)}
                                              className="text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition" title="حذف">
                                              <Trash2 size={11} />
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                                {transfers.length === 0 && (
                                  <tr>
                                    <td colSpan={9} className="py-12 text-center text-gray-400">
                                      <div className="flex flex-col items-center gap-2">
                                        <ArrowUpRight size={28} className="text-gray-200" />
                                        <span className="text-sm">لا توجد تحويلات مسجّلة بعد</span>
                                        <button onClick={() => { setTransferForm({ amount:'', currency:'EGP', method:'', senderName:'', senderPhone:'', reference:'', note:'', date:new Date().toISOString().slice(0,10), time:new Date().toTimeString().slice(0,5), status:'paid' }); setShowAddTransfer(true); }}
                                          className="mt-2 text-xs bg-blue-600 text-white px-4 py-1.5 rounded-full font-bold hover:bg-blue-700 transition">
                                          + إضافة أول تحويل
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                              {transfers.length > 0 && (
                                <tfoot>
                                  <tr className="bg-gradient-to-l from-blue-50 to-white border-t-2 border-blue-100">
                                    <td colSpan={2} className="px-3 py-2.5 font-bold text-gray-600 text-xs">الإجمالي ({transfers.filter(r=>r.status==='paid').length} محصّل)</td>
                                    <td className="px-3 py-2.5 text-center font-extrabold text-blue-700 text-[12px]">{totalEGP.toLocaleString()} ج</td>
                                    <td colSpan={6} />
                                  </tr>
                                </tfoot>
                              )}
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })() : (
                  /* ── Normal Orders Table ── */
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[1000px] border-collapse">
                        <thead>
                          <tr className="bg-gradient-to-l from-emerald-50 to-white text-gray-700 border-b border-gray-200">
                            <th className="px-3 py-3 font-bold text-right border-l border-gray-100">#</th>
                            <th className="px-3 py-3 font-bold text-right border-l border-gray-100">العميل</th>
                            <th className="px-3 py-3 font-bold text-right border-l border-gray-100">المنتج</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">النوع</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">المبلغ</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">وسيلة الدفع</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">المنفذ</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">التاريخ</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">الحالة</th>
                            <th className="px-3 py-3 font-bold text-center">إجراءات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tabRows.slice(0, 300).map((row, i) => {
                            const isPending  = row.status === 'pending';
                            const isFailed   = row.status === 'failed' || row.status === 'refunded';
                            const rowBg = isPending ? 'bg-amber-50/40 hover:bg-amber-50/70' : isFailed ? 'bg-red-50/30 hover:bg-red-50/60' : 'hover:bg-emerald-50/20';
                            const fmtDate = (() => {
                              if (!row.createdAt) return '—';
                              const d = new Date(row.createdAt.replace(' ', 'T'));
                              return isNaN(d.getTime()) ? row.createdAt : d.toLocaleString('ar-EG-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
                            })();
                            const productTitle = (() => {
                              const t = (row.itemTitle || '').toLowerCase().trim();
                              if (t === 'course') return 'كورس'; if (t === 'certificate') return 'شهادة';
                              if (t === 'consultation') return 'استشارة'; if (t === 'bundle') return 'مسار تعليمي';
                              return row.itemTitle || '—';
                            })();
                            return (
                              <tr key={row.id} className={`border-b border-gray-100 ${rowBg} transition-colors`}>
                                <td className="px-3 py-2.5 font-mono text-gray-400 border-l border-gray-100 whitespace-nowrap">
                                  <span className="text-[9px]">#{row.id.slice(-6)}</span>
                                  <div className="text-[8px] text-gray-300">{i + 1}</div>
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100">
                                  {row.subscriberId
                                    ? <button onClick={() => navigate(`/client/${row.subscriberId}`)}
                                        className="font-semibold text-gray-800 hover:text-emerald-700 text-[11px] text-right block hover:underline underline-offset-2">{row.customerName || '—'}</button>
                                    : <span className="text-gray-600 text-[11px]">{row.customerName || '—'}</span>}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 max-w-[160px]">
                                  <span className="text-[11px] text-gray-700 line-clamp-1" title={productTitle}>{productTitle}</span>
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                  {typeBadge(row.type)}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                  <span className="font-extrabold text-emerald-700 text-[12px]">{row.amount?.toLocaleString()}</span>
                                  <span className="text-[9px] text-gray-400 mr-0.5">{row.currency || 'EGP'}</span>
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                  {payMethodBadge(row.paymentMethod)}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-500">
                                  {row.staffName || '—'}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-500 whitespace-nowrap" dir="ltr">
                                  {fmtDate}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                  {isPending
                                    ? <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-bold">⏳ انتظار</span>
                                    : isFailed
                                      ? <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5 font-bold">{row.status === 'refunded' ? '↩ مرتجع' : '✕ فاشلة'}</span>
                                      : <span className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-bold">✓ مؤكد</span>}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    {isPending && canManageFinancial && (
                                      <>
                                        <button onClick={() => handleConfirmOrder(row)}
                                          className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded-lg font-bold transition">
                                          ✓ قبول
                                        </button>
                                        <button onClick={() => updateOrderStatus(row.id, 'failed')}
                                          className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-lg font-bold transition">
                                          ✕ رفض
                                        </button>
                                        <button onClick={() => setLinkOrderModal({ row })}
                                          className="text-[10px] bg-violet-600 hover:bg-violet-700 text-white px-2 py-1 rounded-lg font-bold transition" title="ربط بتحويل وتأكيد">
                                          🔗 ربط
                                        </button>
                                      </>
                                    )}
                                    {isAdmin && (
                                      <button onClick={() => deleteOrder(row.id)}
                                        className="text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition" title="حذف">
                                        <Trash2 size={11} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {tabRows.length === 0 && (
                            <tr>
                              <td colSpan={10} className="py-12 text-center text-gray-400">
                                <div className="flex flex-col items-center gap-2">
                                  <CreditCard size={28} className="text-gray-200" />
                                  <span className="text-sm">لا توجد طلبات في هذا التصنيف</span>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {tabRows.length > 0 && (
                          <tfoot>
                            <tr className="bg-gradient-to-l from-emerald-50 to-white border-t-2 border-emerald-100">
                              <td colSpan={4} className="px-3 py-2.5 font-bold text-gray-600 text-xs">الإجمالي ({tabRows.length} طلب)</td>
                              <td className="px-3 py-2.5 text-center font-extrabold text-emerald-700 text-[12px]">{tabTotal.toLocaleString()} ج</td>
                              <td colSpan={5} />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                    {tabRows.length > 300 && (
                      <div className="text-center text-xs text-gray-400 py-3 border-t border-gray-100">
                        يعرض أول 300 طلب. استخدم الفلاتر لتضييق النتائج.
                      </div>
                    )}
                  </div>
                  )} {/* end transfers ternary */}

                  {/* ══════════════════════════════════════════
                      LINK TRANSFER → PENDING ORDER MODAL
                  ══════════════════════════════════════════ */}
                  {linkTransferModal && (() => {
                    const transfer = linkTransferModal.row;
                    const pendingOrders = effectiveOrders.filter(r => r.status === 'pending' && r.type !== 'transfer');
                    return (
                      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" dir="rtl">
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLinkTransferModal(null)} />
                        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] flex flex-col">
                          <div className="flex items-center justify-between flex-shrink-0">
                            <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                              🔗 ربط التحويل بدفعة عميل
                            </h3>
                            <button onClick={() => setLinkTransferModal(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition">
                              <XCircle size={18} />
                            </button>
                          </div>
                          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm flex-shrink-0">
                            <div className="font-bold text-blue-800">التحويل المحدد</div>
                            <div className="text-blue-600 text-xs mt-1">{transfer.customerName} — {transfer.paymentMethod}{transfer.transactionId ? ` · ref: ${transfer.transactionId}` : ''} — {transfer.amount?.toLocaleString()} {transfer.currency}</div>
                          </div>
                          <p className="text-xs text-gray-500 flex-shrink-0">اختر دفعة عميل قيد المراجعة لربطها بهذا التحويل وتأكيدها تلقائياً.</p>
                          <div className="overflow-y-auto flex-1 space-y-2 min-h-0">
                            {pendingOrders.length === 0 ? (
                              <div className="text-center py-8 text-gray-400 text-sm">لا توجد دفعات قيد المراجعة حالياً</div>
                            ) : pendingOrders.map(order => (
                              <button key={order.id}
                                onClick={async () => {
                                  try {
                                    await mysqlAdmin.adminPost(`/admin/orders/${order.id}/confirm-payment`, { linkedTransferId: transfer.id });
                                    await Promise.all([reloadOrders(), reloadSubscribers()]);
                                    notify('success', `✅ تم ربط التحويل بدفعة ${order.customerName} (${order.itemTitle}) وتأكيدها`);
                                    setLinkTransferModal(null);
                                    setOrderReviewTab('accepted');
                                  } catch {
                                    notify('error', 'تعذر ربط التحويل — قد يكون مستخدَمًا بالفعل لطلب آخر.');
                                  }
                                }}
                                className="w-full text-right border border-gray-200 hover:border-violet-400 hover:bg-violet-50 rounded-xl px-4 py-3 transition group">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="font-semibold text-gray-800 text-sm group-hover:text-violet-700 truncate">{order.customerName}</div>
                                    <div className="text-xs text-gray-500 mt-0.5 truncate">{order.itemTitle} · {order.paymentMethod}</div>
                                    <div className="text-[10px] text-gray-400 mt-0.5 font-mono">#{order.id.slice(-8)}</div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="font-extrabold text-emerald-700 text-sm">{order.amount?.toLocaleString()} {order.currency}</div>
                                    <div className="text-[10px] text-gray-400">{(order.createdAt || '').slice(0, 10)}</div>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                          <div className="flex-shrink-0 pt-2 border-t border-gray-100">
                            <button onClick={() => setLinkTransferModal(null)}
                              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                              إلغاء
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ══════════════════════════════════════════
                      LINK PENDING ORDER → TRANSFER MODAL
                  ══════════════════════════════════════════ */}
                  {linkOrderModal && (() => {
                    const order = linkOrderModal.row;
                    const usedTransferIds = new Set(effectiveOrders.map(r => r.linkedTransferId).filter(Boolean));
                    const availableTransfers = effectiveOrders.filter(r => r.type === 'transfer' && r.status === 'paid' && !usedTransferIds.has(r.id));
                    return (
                      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" dir="rtl">
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLinkOrderModal(null)} />
                        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] flex flex-col">
                          <div className="flex items-center justify-between flex-shrink-0">
                            <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                              🔗 ربط الدفعة بتحويل وتأكيدها
                            </h3>
                            <button onClick={() => setLinkOrderModal(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition">
                              <XCircle size={18} />
                            </button>
                          </div>
                          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm flex-shrink-0">
                            <div className="font-bold text-amber-800">الدفعة المحددة</div>
                            <div className="text-amber-600 text-xs mt-1">{order.customerName} — {order.itemTitle} — {order.amount?.toLocaleString()} {order.currency}</div>
                          </div>
                          <p className="text-xs text-gray-500 flex-shrink-0">اختر تحويلاً من القائمة لربط هذه الدفعة به. سيتم تأكيد الدفعة تلقائياً.</p>
                          <div className="overflow-y-auto flex-1 space-y-2 min-h-0">
                            {availableTransfers.length === 0 ? (
                              <div className="text-center py-8 text-gray-400 text-sm">لا توجد تحويلات متاحة — أضف تحويلاً أولاً من تبويب "التحويلات"</div>
                            ) : availableTransfers.map(transfer => (
                              <button key={transfer.id}
                                onClick={async () => {
                                  try {
                                    await mysqlAdmin.adminPost(`/admin/orders/${order.id}/confirm-payment`, { linkedTransferId: transfer.id });
                                    await Promise.all([reloadOrders(), reloadSubscribers()]);
                                    notify('success', `✅ تم ربط دفعة ${order.customerName} بتحويل ${transfer.customerName} وتأكيدها`);
                                    setLinkOrderModal(null);
                                    setOrderReviewTab('accepted');
                                  } catch {
                                    notify('error', 'تعذر ربط التحويل — قد يكون مستخدَمًا بالفعل لطلب آخر.');
                                  }
                                }}
                                className="w-full text-right border border-gray-200 hover:border-violet-400 hover:bg-violet-50 rounded-xl px-4 py-3 transition group">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="font-semibold text-gray-800 text-sm group-hover:text-violet-700 truncate">{transfer.customerName}</div>
                                    <div className="text-xs text-gray-500 mt-0.5 truncate">{transfer.paymentMethod}{transfer.transactionId ? ` · ref: ${transfer.transactionId}` : ''}</div>
                                    <div className="text-[10px] text-gray-400 mt-0.5 font-mono">#{transfer.id.slice(-8)}</div>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="font-extrabold text-blue-700 text-sm">{transfer.amount?.toLocaleString()} {transfer.currency}</div>
                                    <div className="text-[10px] text-gray-400">{(transfer.createdAt || '').slice(0, 10)}</div>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                          <div className="flex-shrink-0 pt-2 border-t border-gray-100">
                            <button onClick={() => setLinkOrderModal(null)}
                              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                              إلغاء
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ══════════════════════════════════════════
                      ADD TRANSFER MODAL
                  ══════════════════════════════════════════ */}
                  {showAddTransfer && (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" dir="rtl">
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddTransfer(false)} />
                      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                            <ArrowUpRight size={18} className="text-blue-600" /> إضافة تحويل وارد
                          </h3>
                          <button onClick={() => setShowAddTransfer(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition">
                            <XCircle size={18} />
                          </button>
                        </div>
                        <p className="text-xs text-gray-500">سجّل أي تحويل بنكي أو دفعة واردة بدون ربطها بعميل أو كورس معين.</p>

                        {/* Amount + Currency */}
                        <div className="flex gap-2">
                          <div className="flex-1">
                            <label className="text-xs font-semibold text-gray-700 mb-1 block">المبلغ *</label>
                            <input type="number" min="0" step="0.01"
                              value={transferForm.amount}
                              onChange={e => setTransferForm(f => ({...f, amount: e.target.value}))}
                              placeholder="0.00"
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                          </div>
                          <div className="w-24">
                            <label className="text-xs font-semibold text-gray-700 mb-1 block">العملة</label>
                            <select value={transferForm.currency} onChange={e => setTransferForm(f => ({...f, currency: e.target.value as 'EGP'|'SAR'|'USD'}))}
                              className="w-full border border-gray-200 rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
                              <option value="EGP">ج.م</option>
                              <option value="SAR">ر.س</option>
                              <option value="USD">$</option>
                            </select>
                          </div>
                        </div>

                        {/* Payment Method — from finance settings */}
                        {(() => {
                          const DEFAULT_METHODS = ['خزنة الدقي', 'خزنة الفرع', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'احمد السعودية'];
                          const financeMethods: string[] = content['finance.payment_methods']
                            ? content['finance.payment_methods'].split('||').map((s: string) => s.trim()).filter(Boolean)
                            : DEFAULT_METHODS;
                          if (!transferForm.method && financeMethods.length > 0) {
                            setTransferForm(f => ({...f, method: financeMethods[0]}));
                          }
                          return (
                            <div>
                              <label className="text-xs font-semibold text-gray-700 mb-1 block">
                                وسيلة الدفع * <span className="text-[10px] text-blue-500 font-normal">(من إعدادات الحسابات)</span>
                              </label>
                              <select value={transferForm.method} onChange={e => setTransferForm(f => ({...f, method: e.target.value}))}
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200">
                                {financeMethods.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                          );
                        })()}

                        {/* Sender Name + Phone */}
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs font-semibold text-gray-700 mb-1 block">اسم المُحوِّل <span className="text-gray-400 font-normal">(اختياري)</span></label>
                            <input type="text"
                              value={transferForm.senderName}
                              onChange={e => setTransferForm(f => ({...f, senderName: e.target.value}))}
                              placeholder="مثال: محمد أحمد"
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-700 mb-1 block">رقم المُحوِّل <span className="text-gray-400 font-normal">(اختياري)</span></label>
                            <input type="tel"
                              value={transferForm.senderPhone}
                              onChange={e => setTransferForm(f => ({...f, senderPhone: e.target.value}))}
                              placeholder="01xxxxxxxxx"
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-200" />
                          </div>
                        </div>

                        {/* Reference */}
                        <div>
                          <label className="text-xs font-semibold text-gray-700 mb-1 block">رقم المرجع / الإيصال <span className="text-gray-400 font-normal">(اختياري)</span></label>
                          <input type="text"
                            value={transferForm.reference}
                            onChange={e => setTransferForm(f => ({...f, reference: e.target.value}))}
                            placeholder="مثال: TXN-123456"
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-200" />
                        </div>

                        {/* Date + Time */}
                        <div className="flex gap-2 flex-wrap">
                          <div className="flex-1 min-w-[120px]">
                            <label className="text-xs font-semibold text-gray-700 mb-1 block">التاريخ</label>
                            <input type="date"
                              value={transferForm.date}
                              onChange={e => setTransferForm(f => ({...f, date: e.target.value}))}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                          </div>
                          <div className="w-28">
                            <label className="text-xs font-semibold text-gray-700 mb-1 block">الوقت</label>
                            <input type="time"
                              value={transferForm.time}
                              onChange={e => setTransferForm(f => ({...f, time: e.target.value}))}
                              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => setShowAddTransfer(false)}
                            className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">
                            إلغاء
                          </button>
                          <button
                            disabled={!transferForm.amount || Number(transferForm.amount) <= 0}
                            onClick={async () => {
                              if (!transferForm.amount || Number(transferForm.amount) <= 0) return;
                              const timeStr = transferForm.time || new Date().toTimeString().slice(0,5);
                              const now = new Date(`${transferForm.date}T${timeStr}`).toISOString();
                              const senderLabel = [transferForm.senderName, transferForm.senderPhone].filter(Boolean).join(' — ');
                              const newTransfer: import('../../../types').OrderItem = {
                                id: `TRF-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`,
                                type: 'transfer',
                                itemId: 'transfer',
                                itemTitle: transferForm.note || (senderLabel ? `تحويل من ${senderLabel}` : 'تحويل وارد'),
                                amount: Number(transferForm.amount),
                                currency: transferForm.currency,
                                paymentMethod: transferForm.method,
                                customerName: senderLabel || 'غير محدد',
                                status: transferForm.status,
                                createdAt: now,
                                transactionId: transferForm.reference || undefined,
                                staffId: currentStaff?.id,
                                staffName: currentStaff?.name || authUser?.displayName || 'Admin',
                              };
                              const saved = await addOrder(newTransfer);
                              if (!saved) {
                                notify('error', 'تعذر حفظ التحويل في قاعدة البيانات.');
                                return;
                              }
                              setShowAddTransfer(false);
                              setOrderReviewTab('transfers');
                              notify('success', `تم تسجيل التحويل بنجاح (${Number(transferForm.amount).toLocaleString()} ${transferForm.currency}) ✓`);
                            }}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white py-2.5 rounded-xl text-sm font-bold transition">
                            حفظ التحويل
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
  }
}
