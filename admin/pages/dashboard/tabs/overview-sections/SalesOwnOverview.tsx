import React from 'react';
import { Activity, AlertCircle, BarChart3, Clock, Percent, TrendingUp, UserCheck, UserPlus } from 'lucide-react';
import type { LeadItem, OrderItem, StaffMember, SubscriberItem } from '../../../../types';
import ActionCenter from '../../ActionCenter';
import { formatWaPhone } from '../../dashboardShared';

interface Props {
  salesOwnLeads: LeadItem[];
  salesOwnSubscribers: SubscriberItem[];
  salesOwnOrders: OrderItem[];
  currentStaff: StaffMember;
  myMonthlyTarget: number;
  navigate: (path: string) => void;
  setActiveTab: (tab: string) => void;
}

export default function SalesOwnOverview({ salesOwnLeads, salesOwnSubscribers, salesOwnOrders, currentStaff, myMonthlyTarget, navigate, setActiveTab }: Props) {
                const myLeads = salesOwnLeads;
                const myNew = myLeads.filter(l => l.status === 'new').length;
                const myContacted = myLeads.filter(l => l.status === 'contacted').length;
                const myInterested = myLeads.filter(l => l.status === 'interested').length;
                const myConverted = myLeads.filter(l => l.status === 'converted').length;
                const myLost = myLeads.filter(l => ['lost','not_interested_hidden'].includes(l.status || '')).length;
                const mySubs = salesOwnSubscribers;
                const myOrders = salesOwnOrders;
                const myRevenueSubs = mySubs.flatMap(s => s.paymentHistory || []).reduce((acc, p) => {
                  const egp = p.currency === 'EGP' ? p.amount : p.currency === 'SAR' ? p.amount * 13 : p.amount * 50;
                  const month = (p.at || '').slice(0, 7);
                  const thisMonth = new Date().toISOString().slice(0, 7);
                  if (month === thisMonth) acc.thisMonth += egp;
                  acc.total += egp;
                  return acc;
                }, { thisMonth: 0, total: 0 });
                const myCommRate = currentStaff.commissionRate || 0;
                const myCommission = myCommRate > 0 ? Math.round(myRevenueSubs.thisMonth * myCommRate / 100) : 0;

                // Weekly call trend (last 7 days)
                const todayStr = new Date().toISOString().slice(0, 10);
                const thisMonthStr = new Date().toISOString().slice(0, 7);
                const last7Days = Array.from({ length: 7 }, (_, i) => {
                  const d = new Date(); d.setDate(d.getDate() - (6 - i));
                  return d.toISOString().slice(0, 10);
                });
                const callsByDay = last7Days.map(day => ({
                  day,
                  label: new Date(day).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short' }),
                  count: myLeads.reduce((n, l) => n + (l.communications || []).filter(c => c.date?.slice(0,10) === day).length, 0),
                }));
                const maxCalls = Math.max(...callsByDay.map(d => d.count), 1);
                const todayCalls = callsByDay.find(d => d.day === todayStr)?.count ?? 0;
                const monthlyTarget = myMonthlyTarget;

                // Top sources for my leads
                const mySourceMap = myLeads.reduce((m, l) => { if (l.source) { m[l.source] = (m[l.source] || 0) + 1; } return m; }, {} as Record<string, number>);
                const mySources = Object.entries(mySourceMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
                const maxSrc = Math.max(...mySources.map(([,n]) => n), 1);

                // Recent conversions
                const recentConversions = myLeads.filter(l => l.status === 'converted')
                  .sort((a, b) => (b.updatedAt || b.createdAt || '') > (a.updatedAt || a.createdAt || '') ? 1 : -1)
                  .slice(0, 5);

                const myCards = [
                  { title: 'عملائي المحتملون', value: myLeads.length, icon: UserPlus, bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
                  { title: 'محوّلون هذا الشهر', value: myLeads.filter(l => l.status === 'converted' && (l.updatedAt || l.createdAt || '').slice(0,7) === thisMonthStr).length, icon: TrendingUp, bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
                  { title: 'عملائي', value: mySubs.length, icon: UserCheck, bg: 'bg-teal-50', text: 'text-teal-600', border: 'border-teal-200' },
                  { title: 'مكالمات اليوم', value: todayCalls, icon: Activity, bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
                  { title: 'إيراداتي هذا الشهر', value: `${Math.round(myRevenueSubs.thisMonth).toLocaleString('ar-EG-u-nu-latn')} ج`, icon: BarChart3, bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
                  { title: 'عمولتي هذا الشهر', value: myCommRate > 0 ? `${myCommission.toLocaleString('ar-EG-u-nu-latn')} ج` : '—', icon: Percent, bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200' },
                  { title: 'معدل التحويل', value: `${myLeads.length > 0 ? Math.round((myConverted / myLeads.length) * 100) : 0}%`, icon: TrendingUp, bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200' },
                  { title: 'متابعات متأخرة', value: myLeads.filter(l => l.nextFollowUpDate && l.nextFollowUpDate < todayStr && !['converted','lost'].includes(l.status || '')).length, icon: Clock, bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
                ];
                return (
                  <div className="space-y-6">
                    {/* Mission control — what needs action now (admin-gated; null for others) */}
                    <ActionCenter onNavigate={(link) => { if (link) setActiveTab(link); }} />
                    {/* Welcome banner */}
                    <div className="bg-gradient-to-l from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-4 text-amber-800 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-amber-200 flex items-center justify-center text-amber-800 font-extrabold text-lg flex-shrink-0">
                        {(currentStaff.name || '?').charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm">مرحباً {currentStaff.name} 👋</p>
                        <p className="text-xs text-amber-700 mt-0.5">هذه أرقامك الشخصية فقط</p>
                      </div>
                      {myCommRate > 0 && <span className="mr-auto text-xs text-orange-700 font-bold bg-orange-100 px-2.5 py-1 rounded-full">نسبة عمولتك: {myCommRate}%</span>}
                    </div>

                    {/* KPI cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {myCards.map(item => {
                        const Icon = item.icon;
                        return (
                          <article key={item.title} className={`bg-white border ${item.border} rounded-2xl p-4 shadow-sm flex items-center gap-3`}>
                            <div className={`w-10 h-10 rounded-xl ${item.bg} flex items-center justify-center flex-shrink-0`}>
                              <Icon size={18} className={item.text} />
                            </div>
                            <div>
                              <p className="text-[11px] text-gray-500 leading-tight">{item.title}</p>
                              <h3 className="text-xl font-extrabold text-gray-900 mt-0.5">{item.value}</h3>
                            </div>
                          </article>
                        );
                      })}
                    </div>

                    {/* Monthly target progress */}
                    {(() => {
                      const pct = Math.min(Math.round((myConverted / monthlyTarget) * 100), 100);
                      const remaining = Math.max(monthlyTarget - myConverted, 0);
                      return (
                        <article className="bg-white border border-emerald-200 rounded-2xl p-5 shadow-sm">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="font-bold text-gray-900 flex items-center gap-2"><TrendingUp size={17} className="text-emerald-500" />تقدم الهدف الشهري</h3>
                            <span className="text-xs text-gray-500">{myConverted} من {monthlyTarget} محوّل</span>
                          </div>
                          <div className="h-4 bg-gray-100 rounded-full overflow-hidden mb-2">
                            <div
                              className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-gray-500">
                            <span className={`font-bold ${pct >= 100 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{pct}%</span>
                            <span>{remaining > 0 ? `متبقي ${remaining} محوّل للوصول للهدف` : '🎯 تحققت الهدف!'}</span>
                          </div>
                        </article>
                      );
                    })()}

                    {/* Two columns: Funnel + Weekly calls */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Conversion Funnel */}
                      <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                        <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><BarChart3 size={17} className="text-primary-500" />مسار التحويل</h3>
                        <div className="space-y-3">
                          {[
                            { label: 'جديد', count: myNew, color: 'bg-blue-500', pill: 'bg-blue-50 text-blue-700' },
                            { label: 'تم التواصل', count: myContacted, color: 'bg-violet-500', pill: 'bg-violet-50 text-violet-700' },
                            { label: 'مهتم', count: myInterested, color: 'bg-amber-500', pill: 'bg-amber-50 text-amber-700' },
                            { label: 'محوّل', count: myConverted, color: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700' },
                            { label: 'غير مهتم/ضائع', count: myLost, color: 'bg-red-400', pill: 'bg-red-50 text-red-600' },
                          ].map(s => (
                            <div key={s.label}>
                              <div className="flex items-center justify-between mb-1 text-xs">
                                <span className={`font-bold px-2 py-0.5 rounded-full ${s.pill}`}>{s.label}</span>
                                <span className="font-bold text-gray-800">{s.count} ({myLeads.length > 0 ? Math.round((s.count / myLeads.length) * 100) : 0}%)</span>
                              </div>
                              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full ${s.color} rounded-full`} style={{ width: `${myLeads.length > 0 ? (s.count / myLeads.length) * 100 : 0}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </article>

                      {/* Weekly call trend */}
                      <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                        <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><Activity size={17} className="text-blue-500" />مكالمات آخر 7 أيام</h3>
                        <div className="flex items-end gap-2 h-32">
                          {callsByDay.map(d => (
                            <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                              <span className="text-[10px] text-gray-500 font-bold">{d.count > 0 ? d.count : ''}</span>
                              <div
                                className={`w-full rounded-t-lg transition-all ${d.day === todayStr ? 'bg-blue-500' : 'bg-blue-200'}`}
                                style={{ height: `${Math.max((d.count / maxCalls) * 100, d.count > 0 ? 10 : 4)}%` }}
                              />
                              <span className={`text-[9px] ${d.day === todayStr ? 'text-blue-600 font-extrabold' : 'text-gray-400'}`}>{d.label}</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-xs text-gray-400 mt-2 text-center">
                          مجموع 7 أيام: {callsByDay.reduce((s, d) => s + d.count, 0)} مكالمة
                        </p>
                      </article>
                    </div>

                    {/* Top sources + Recent conversions */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                      {/* Top sources */}
                      {mySources.length > 0 && (
                        <article className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
                          <h3 className="font-bold text-gray-900 mb-5 flex items-center gap-2"><UserPlus size={17} className="text-amber-500" />أهم مصادر عملائي</h3>
                          <div className="space-y-3">
                            {mySources.map(([src, cnt]) => (
                              <div key={src}>
                                <div className="flex justify-between text-xs mb-1">
                                  <span className="text-gray-700 font-medium truncate">{src}</span>
                                  <span className="font-bold text-gray-900 ml-2">{cnt}</span>
                                </div>
                                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(cnt / maxSrc) * 100}%` }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </article>
                      )}

                      {/* Recent conversions */}
                      <article className="bg-white border border-emerald-100 rounded-2xl p-6 shadow-sm">
                        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><UserCheck size={17} className="text-emerald-500" />آخر التحويلات</h3>
                        {recentConversions.length === 0
                          ? <p className="text-sm text-gray-400 text-center py-4">لا توجد تحويلات بعد</p>
                          : (
                            <div className="space-y-2">
                              {recentConversions.map(l => (
                                <div key={l.id} className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 gap-2">
                                  <div className="min-w-0 flex-1">
                                    <button onClick={() => navigate(`/client/${l.clientCode || l.id}`)}
                                      className="font-semibold text-gray-800 text-sm hover:text-primary-700 hover:underline truncate text-right block">
                                      {l.name}
                                    </button>
                                    <p className="text-[11px] text-gray-400">{(l.updatedAt || l.createdAt || '').slice(0, 10)}</p>
                                  </div>
                                  <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex-shrink-0">محوّل ✓</span>
                                </div>
                              ))}
                            </div>
                          )
                        }
                      </article>
                    </div>

                    {/* ── Pending installments widget ─────────────────────── */}
                    {(() => {
                      const pendingSubs = mySubs.filter(s => {
                        const expEGP = s.expectedTotals?.EGP ||
                          (s.paymentHistory || []).filter(p => !p.isInstallment && p.currency === 'EGP').reduce((a, p) => a + (p.courseExpected || 0), 0);
                        if (!expEGP) return false;
                        const paidEGP = (s.paymentHistory || []).filter(p => !p.isInstallment && p.currency === 'EGP').reduce((a, p) => a + (Number(p.amount) || 0), 0);
                        return paidEGP < expEGP;
                      }).map(s => {
                        const expEGP = s.expectedTotals?.EGP ||
                          (s.paymentHistory || []).filter(p => !p.isInstallment && p.currency === 'EGP').reduce((a, p) => a + (p.courseExpected || 0), 0);
                        const paidEGP = (s.paymentHistory || []).filter(p => !p.isInstallment && p.currency === 'EGP').reduce((a, p) => a + (Number(p.amount) || 0), 0);
                        return { ...s, _remaining: expEGP - paidEGP };
                      }).sort((a, b) => b._remaining - a._remaining);
                      if (pendingSubs.length === 0) return null;
                      return (
                        <article className="bg-white border border-amber-200 rounded-2xl p-6 shadow-sm">
                          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <AlertCircle size={17} className="text-amber-500" />
                            أقساط معلقة
                            <span className="mr-1 text-xs font-extrabold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pendingSubs.length} عميل</span>
                          </h3>
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {pendingSubs.map(s => (
                              <div key={s.id} className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 gap-3">
                                <div className="min-w-0 flex-1">
                                  <button onClick={() => navigate(`/client/${s.clientCode || s.id}`)}
                                    className="font-semibold text-gray-800 text-sm hover:text-primary-700 hover:underline block truncate text-right">
                                    {s.name}
                                  </button>
                                  <p className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                                    <a href={`tel:${s.phone}`} className="text-blue-600 hover:underline">{s.phone}</a>
                                    {s.phone && (
                                      <a href={`https://wa.me/${formatWaPhone(s.phone)}`} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-green-500 text-white text-[9px] font-bold">W</a>
                                    )}
                                  </p>
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <p className="text-red-600 font-extrabold text-sm">{s._remaining.toLocaleString('ar-EG-u-nu-latn')} ج.م</p>
                                  <p className="text-[10px] text-gray-400">متبقي من الإجمالي</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </article>
                      );
                    })()}
                    {/* ── Today's follow-ups ──────────────────────────────── */}
                    {(() => {
                      const dueToday = myLeads.filter(l => l.nextFollowUpDate === todayStr && !['converted','lost'].includes(l.status || ''));
                      const overdue = myLeads.filter(l => l.nextFollowUpDate && l.nextFollowUpDate < todayStr && !['converted','lost'].includes(l.status || ''));
                      if (dueToday.length === 0 && overdue.length === 0) return null;
                      return (
                        <article className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
                          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <Clock size={17} className="text-red-500" />
                            متابعات مطلوبة
                            {overdue.length > 0 && <span className="text-xs font-extrabold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{overdue.length} متأخرة</span>}
                            {dueToday.length > 0 && <span className="text-xs font-extrabold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{dueToday.length} اليوم</span>}
                          </h3>
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {[...overdue.map(l => ({ ...l, _urgent: true })), ...dueToday.map(l => ({ ...l, _urgent: false }))].map(l => (
                              <div key={l.id} className={`flex items-center justify-between border rounded-xl px-3 py-2.5 gap-3 ${l._urgent ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                                <div className="min-w-0 flex-1">
                                  <button onClick={() => navigate(`/client/${l.clientCode || l.id}`)}
                                    className="font-semibold text-gray-800 text-sm hover:text-primary-700 hover:underline block truncate text-right">
                                    {l.name}
                                  </button>
                                  <p className="text-[11px] text-gray-500 mt-0.5">
                                    {l._urgent ? `⚠️ منذ ${l.nextFollowUpDate}` : `📅 اليوم`}
                                    {l.lastContactNote && <span className="mr-2 text-gray-400 truncate">· {l.lastContactNote.slice(0, 40)}</span>}
                                  </p>
                                </div>
                                <a href={`https://wa.me/${formatWaPhone(l.phone)}`} target="_blank" rel="noopener noreferrer"
                                  className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-green-500 text-white font-bold text-xs hover:bg-green-600">W</a>
                              </div>
                            ))}
                          </div>
                        </article>
                      );
                    })()}
                  </div>
                );
}
