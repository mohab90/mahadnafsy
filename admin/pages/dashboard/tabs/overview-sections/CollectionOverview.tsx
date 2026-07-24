import { Clock, Settings2, TrendingUp } from 'lucide-react';
import type { StaffMember, SubscriberItem } from '../../../../types';

interface Props {
  salesOwnSubscribers: SubscriberItem[];
  currentStaff: StaffMember;
  collMonthlyTarget: number;
  saveCollMonthlyTarget: (val: number) => void;
  navigate: (path: string) => void;
}

export default function CollectionOverview({ salesOwnSubscribers, currentStaff, collMonthlyTarget, saveCollMonthlyTarget, navigate }: Props) {
                const allSubs = salesOwnSubscribers;
                const now2 = new Date();
                const todayStr2 = now2.toISOString().slice(0, 10);
                const thisMonthStr2 = now2.toISOString().slice(0, 7);
                const thisWeekStartStr = (() => { const d=new Date(now2); d.setDate(d.getDate()-d.getDay()); return d.toISOString().slice(0,10); })();
                const onlineSubs = allSubs; // collection sees all subscribers (branch may be null for many)
                // ── Financial calculations (EGP equivalent) ──
                const allPayments = allSubs.flatMap(s => (s.paymentHistory||[]).map(p => ({...p, subId: s.id})));
                const toEGP = (p: {amount?: number|string; currency?: string}) => {
                  const n = Number(p.amount)||0;
                  return p.currency==='SAR' ? n*13 : p.currency==='USD' ? n*50 : n;
                };
                const collTodayRevOv  = allPayments.filter(p=>(p.at||'').slice(0,10)===todayStr2).reduce((s,p)=>s+toEGP(p),0);
                const collWeekRevOv   = allPayments.filter(p=>(p.at||'').slice(0,10)>=thisWeekStartStr).reduce((s,p)=>s+toEGP(p),0);
                const collMonthRevOv  = allPayments.filter(p=>(p.at||'').slice(0,7)===thisMonthStr2).reduce((s,p)=>s+toEGP(p),0);
                // Total remaining across all subs
                const collTotalRemOv  = allSubs.reduce((sum,s)=>{
                  const hist=s.paymentHistory||[];
                  const cpMap:Record<string,number>={};
                  hist.forEach(p=>{ if(p.courseId&&p.courseExpected&&!cpMap[p.courseId]) cpMap[p.courseId]=Number(p.courseExpected)||0; });
                  const exp=Object.values(cpMap).reduce((a,b)=>a+b,0);
                  const paid=hist.reduce((a,p)=>a+toEGP(p),0);
                  return sum+Math.max(0,exp-paid);
                },0);
                // Monthly target comes from server-persisted component state (collMonthlyTarget).
                const collPct = Math.min(100, Math.round((collMonthRevOv / Math.max(1, collMonthlyTarget)) * 100));
                const daysInMonthOv = new Date(now2.getFullYear(), now2.getMonth()+1, 0).getDate();
                const dayOfMonthOv = now2.getDate();
                const daysLeftOv = daysInMonthOv - dayOfMonthOv;
                const dailyPaceOv = collMonthRevOv / Math.max(1, dayOfMonthOv);
                const projectedOv = Math.round(dailyPaceOv * daysInMonthOv);
                // Overdue & due today
                const overdueInstSubs = allSubs.filter(s =>(s.installmentPlans||[]).some(p=>(p.entries||[]).some(e=>!e.paidAt&&e.dueDate<todayStr2)));
                const dueTodaySubs = allSubs.filter(s =>(s.installmentPlans||[]).some(p=>(p.entries||[]).some(e=>!e.paidAt&&e.dueDate===todayStr2)));
                const dueThisWeekSubs = allSubs.filter(s=>(s.installmentPlans||[]).some(p=>(p.entries||[]).some(e=>!e.paidAt&&e.dueDate>todayStr2&&e.dueDate<=new Date(Date.now()+7*86400000).toISOString().slice(0,10))));
                // Commission estimate (assume 1% of monthly collections)
                const commissionRate = 0.01;
                const estCommission = Math.round(collMonthRevOv * commissionRate);
                const commissionTarget = Math.round(collMonthlyTarget * commissionRate);
                const fmtM = (n:number) => n>=1000000 ? `${(n/1000000).toFixed(1)}M` : n>=1000 ? `${(n/1000).toFixed(0)}K` : String(Math.round(n));
                // Monthly collection by day (last 30 days)
                const last30 = Array.from({length:30},(_,i)=>{
                  const d=new Date(now2); d.setDate(d.getDate()-29+i);
                  const ds=d.toISOString().slice(0,10);
                  return { day: ds.slice(8), rev: allPayments.filter(p=>(p.at||'').slice(0,10)===ds).reduce((s,p)=>s+toEGP(p),0) };
                });
                const maxDay = Math.max(...last30.map(d=>d.rev),1);
                const motivOv =
                  collPct>=100 ? { text:'🏆 حققت الهدف الشهري! أداء استثنائي!', cls:'from-yellow-400 to-amber-500' } :
                  collPct>=75  ? { text:'🔥 أنت على بُعد خطوة من الهدف!', cls:'from-emerald-500 to-green-600' } :
                  collPct>=50  ? { text:'💪 أكثر من النصف! واصل الضغط!', cls:'from-blue-500 to-indigo-600' } :
                  collPct>=25  ? { text:'⚡ بداية قوية — حافظ على الزخم!', cls:'from-violet-500 to-purple-600' } :
                               { text:'🚀 كل تحصيل يقربك من الـ 160 ألف!', cls:'from-teal-500 to-cyan-600' };
                const circR = 54; const circC = 2*Math.PI*circR;
                const circDash = circC - (collPct/100)*circC;
                return (
                  <div className="space-y-4 w-full" dir="rtl">
                    {/* Hero banner */}
                    <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${motivOv.cls} p-5 text-white shadow-xl`}>
                      <div className="absolute inset-0 opacity-10" style={{backgroundImage:'radial-gradient(circle at 20% 80%, white 1px, transparent 1px)',backgroundSize:'25px 25px'}} />
                      <div className="relative flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full border-4 border-white/30 bg-white/20 flex items-center justify-center flex-shrink-0 text-2xl font-extrabold">
                          {(currentStaff.name||'?').charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-white/70">مرحباً يا</div>
                          <div className="text-xl font-extrabold truncate">{currentStaff.name}</div>
                          <div className="text-xs text-white/70 mt-0.5">مسؤول التحصيل · {onlineSubs.length} عميل أونلاين</div>
                        </div>
                        <div className="text-left flex-shrink-0">
                          <div className="text-xs text-white/70">تحصيل اليوم</div>
                          <div className="text-2xl font-black">{fmtM(collTodayRevOv)} ج</div>
                        </div>
                      </div>
                      <div className="mt-3 text-sm font-bold">{motivOv.text}</div>
                    </div>
                    {/* 8 KPI tiles */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { label:'تحصيل اليوم',     value:`${fmtM(collTodayRevOv)} ج`,   sub:'مدفوعات اليوم',         icon:'📅', cls:'border-emerald-200 bg-emerald-50 text-emerald-800' },
                        { label:'تحصيل الأسبوع',  value:`${fmtM(collWeekRevOv)} ج`,   sub:'هذا الأسبوع',            icon:'📆', cls:'border-blue-200 bg-blue-50 text-blue-800' },
                        { label:'تحصيل الشهر',    value:`${fmtM(collMonthRevOv)} ج`,  sub:`من هدف ${fmtM(collMonthlyTarget)} ج`, icon:'💰', cls:'border-violet-200 bg-violet-50 text-violet-800' },
                        { label:'متبقي في الشيت', value:`${fmtM(collTotalRemOv)} ج`,  sub:'إجمالي مديونيات',        icon:'⏳', cls:'border-red-200 bg-red-50 text-red-800' },
                        { label:'عمولة الشهر',    value:`${fmtM(estCommission)} ج`,   sub:`هدف العمولة ${fmtM(commissionTarget)} ج`, icon:'💎', cls:'border-amber-200 bg-amber-50 text-amber-800' },
                        { label:'أقساط متأخرة',   value:overdueInstSubs.length,        sub:'عميل متأخر',             icon:'🔴', cls:'border-red-200 bg-red-50 text-red-800' },
                        { label:'مستحق اليوم',    value:dueTodaySubs.length,           sub:'عميل مستحق',             icon:'🟡', cls:'border-amber-200 bg-amber-50 text-amber-800' },
                        { label:'مستحق هذا الأسبوع', value:dueThisWeekSubs.length,     sub:'خلال 7 أيام',            icon:'📋', cls:'border-cyan-200 bg-cyan-50 text-cyan-800' },
                      ].map(m=>(
                        <div key={m.label} className={`border rounded-xl p-3 ${m.cls}`}>
                          <div className="text-lg mb-0.5">{m.icon}</div>
                          <div className="text-xl font-extrabold leading-tight">{m.value}</div>
                          <div className="text-[10px] font-medium opacity-60">{m.sub}</div>
                          <div className="text-xs font-bold mt-1">{m.label}</div>
                        </div>
                      ))}
                    </div>
                    {/* Target progress */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center gap-2 mb-4">
                        <TrendingUp size={18} className="text-teal-600" />
                        <h3 className="font-extrabold text-gray-900">تقدمك نحو هدف التحصيل الشهري</h3>
                        <span className="mr-auto text-xs text-gray-400">{now2.toLocaleDateString('ar-EG-u-nu-latn',{month:'long',year:'numeric'})}</span>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="relative flex-shrink-0 w-28 h-28">
                          <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
                            <circle cx="64" cy="64" r={circR} fill="none" stroke="#e5e7eb" strokeWidth="10" />
                            <circle cx="64" cy="64" r={circR} fill="none"
                              stroke={collPct>=100?'#f59e0b':collPct>=75?'#10b981':collPct>=50?'#3b82f6':'#8b5cf6'}
                              strokeWidth="10" strokeLinecap="round"
                              strokeDasharray={circC} strokeDashoffset={circDash}
                              style={{transition:'stroke-dashoffset 1s ease'}} />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-2xl font-black text-gray-900">{collPct}%</span>
                            <span className="text-[10px] text-gray-400">من الهدف</span>
                          </div>
                        </div>
                        <div className="flex-1 space-y-3">
                          <div>
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                              <span>المحصَّل: <strong className="text-gray-800">{fmtM(collMonthRevOv)} ج</strong></span>
                              <span>الهدف: <strong className="text-gray-800">{fmtM(collMonthlyTarget)} ج</strong></span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                              <div className="h-3 rounded-full transition-all duration-1000" style={{
                                width:`${collPct}%`,
                                background: collPct>=100?'linear-gradient(90deg,#f59e0b,#d97706)':collPct>=75?'linear-gradient(90deg,#10b981,#059669)':collPct>=50?'linear-gradient(90deg,#3b82f6,#2563eb)':'linear-gradient(90deg,#8b5cf6,#7c3aed)'
                              }} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                              <div className="text-gray-400">معدل التحصيل اليومي</div>
                              <div className="font-bold text-gray-800">{fmtM(dailyPaceOv)} ج / يوم</div>
                            </div>
                            <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                              <div className="text-gray-400">التوقع بنهاية الشهر</div>
                              <div className={`font-bold ${projectedOv>=collMonthlyTarget?'text-emerald-600':'text-amber-600'}`}>{fmtM(projectedOv)} ج</div>
                            </div>
                          </div>
                          {collPct < 100 && (
                            <div className="text-xs text-gray-500 bg-teal-50 border border-teal-100 rounded-lg px-3 py-2">
                              💡 تحتاج <strong className="text-teal-700">{fmtM(collMonthlyTarget-collMonthRevOv)} ج</strong> إضافي خلال {daysLeftOv} يوم
                              {daysLeftOv>0 && ` — أي ${fmtM((collMonthlyTarget-collMonthRevOv)/daysLeftOv)} ج / يوم`}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Daily chart (last 30 days) */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                      <h3 className="font-extrabold text-gray-900 flex items-center gap-2 mb-4"><span className="text-lg">📊</span>التحصيلات اليومية (آخر 30 يوم)</h3>
                      <div className="flex items-end gap-0.5 h-24">
                        {last30.map((d,i)=>(
                          <div key={i} className="flex-1 flex flex-col items-center" title={`${d.day}: ${d.rev.toLocaleString()} ج`}>
                            <div className="w-full rounded-t-sm transition-all duration-500"
                              style={{height:`${Math.max(2,(d.rev/maxDay)*88)}px`, background: d.rev>0 ? (i===last30.length-1?'#10b981':'#6366f1') : '#e5e7eb', opacity: d.rev===0?0.3:1}} />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                        <span>{last30[0]?.day}</span><span>{last30[14]?.day}</span><span>{last30[29]?.day}</span>
                      </div>
                    </div>
                    {/* Overdue installments */}
                    {overdueInstSubs.length > 0 && (
                      <article className="bg-red-50 border border-red-200 rounded-2xl p-4 shadow-sm">
                        <h3 className="font-bold text-red-800 mb-3 flex items-center gap-2">
                          <Clock size={16} className="text-red-600" />🔴 أقساط متأخرة ({overdueInstSubs.length} عميل)
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {overdueInstSubs.slice(0,20).map(s=>{
                            const nd=(s.installmentPlans||[]).flatMap(p=>(p.entries||[]).filter(e=>!e.paidAt).map(e=>({date:e.dueDate,amount:e.amount,cur:p.currency}))).sort((a,b)=>a.date.localeCompare(b.date))[0];
                            const cf=(c:string)=>c==='SAR'?'ر.س':c==='USD'?'$':'ج';
                            return (
                              <button key={s.id} onClick={()=>navigate(`/client/${s.clientCode||s.id}`)}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-red-100 text-red-700 border-red-300 hover:opacity-80">
                                {s.name}{nd&&<span className="opacity-70 mr-1">({nd.amount.toLocaleString()} {cf(nd.cur)} — {nd.date})</span>}
                              </button>
                            );
                          })}
                          {overdueInstSubs.length>20&&<span className="text-xs text-red-600 font-bold">+ {overdueInstSubs.length-20} أخرى</span>}
                        </div>
                      </article>
                    )}
                    {dueTodaySubs.length > 0 && (
                      <article className="bg-amber-50 border border-amber-200 rounded-2xl p-4 shadow-sm">
                        <h3 className="font-bold text-amber-800 mb-3 flex items-center gap-2">
                          <Clock size={16} className="text-amber-600" />🟡 أقساط مستحقة اليوم ({dueTodaySubs.length} عميل)
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {dueTodaySubs.slice(0,20).map(s=>{
                            const nd=(s.installmentPlans||[]).flatMap(p=>(p.entries||[]).filter(e=>!e.paidAt).map(e=>({date:e.dueDate,amount:e.amount,cur:p.currency}))).sort((a,b)=>a.date.localeCompare(b.date))[0];
                            const cf=(c:string)=>c==='SAR'?'ر.س':c==='USD'?'$':'ج';
                            return (
                              <button key={s.id} onClick={()=>navigate(`/client/${s.clientCode||s.id}`)}
                                className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-amber-100 text-amber-700 border-amber-300 hover:opacity-80">
                                {s.name}{nd&&<span className="opacity-70 mr-1">({nd.amount.toLocaleString()} {cf(nd.cur)})</span>}
                              </button>
                            );
                          })}
                        </div>
                      </article>
                    )}
                    {/* Monthly target setting */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
                      <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2"><Settings2 size={15} className="text-gray-400" />إعداد هدف التحصيل الشهري</h3>
                      <div className="flex items-center gap-3">
                        <input type="number" defaultValue={collMonthlyTarget}
                          onBlur={e=>{ saveCollMonthlyTarget(Number(e.target.value)); }}
                          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-teal-300" placeholder="160000" dir="ltr" />
                        <span className="text-xs text-gray-500">ج.م / شهر</span>
                        <span className="text-xs text-gray-400">(يُحفظ في قاعدة البيانات عند المغادرة)</span>
                      </div>
                    </div>
                  </div>
                );
}
