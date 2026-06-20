import React, { useState } from 'react';
import { AlertCircle, CalendarDays, CheckCircle2, Clock, Download, Plus, X } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { InstallmentEntry, InstallmentPlan, Currency, PaymentHistoryEntry } from '../../../../types';
import type { SubscriberItem } from '../../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  notify: NotifyFn;
  subscribers: SubscriberItem[];
}

export function FinancialInstallmentsPanel({ notify, subscribers }: Props) {
  const { updateSubscriber, courses, content } = useSiteData();

  const [isNewPlanOpen, setIsNewPlanOpen] = useState(false);
  const [newPlanSubId, setNewPlanSubId] = useState('');
  const [newPlanDraft, setNewPlanDraft] = useState<{
    courseId: string; courseTitle: string; totalAmount: number; currency: Currency; notes: string;
    entries: { dueDate: string; amount: number; note: string }[];
  }>({ courseId: '', courseTitle: '', totalAmount: 0, currency: 'EGP', notes: '', entries: [] });
  const [newEntry, setNewEntry] = useState({ dueDate: '', amount: 0, note: '' });
  const [payingEntry, setPayingEntry] = useState<{ subId: string; planId: string; entryId: string; paidAmount: number; paymentMethod: string } | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const sarRate = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
  const usdRate = parseFloat(content['exchange.usd_to_egp'] || '50') || 50;
  const toEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarRate : amt * usdRate;

  const DEFAULT_METHODS = ['خزنة الدقي', 'خزنة الفرع', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'احمد السعودية'];
  const PAYMENT_METHODS: string[] = content['finance.payment_methods']
    ? content['finance.payment_methods'].split('||').map((s: string) => s.trim()).filter(Boolean)
    : DEFAULT_METHODS;

  const exportCSV = (filename: string, rows: string[][], headers: string[]) => {
    const BOM = '﻿';
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
    const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const subscribersWithPlans = subscribers.filter(s => (s.installmentPlans?.length ?? 0) > 0);
  const allPlanEntries = subscribersWithPlans.flatMap(s =>
    (s.installmentPlans || []).flatMap(plan =>
      plan.entries.map(e => ({ ...e, subId: s.id, planId: plan.id }))
    )
  );
  const overdueEntries = allPlanEntries.filter(e => !e.paidAt && e.dueDate < today);
  const totalOutstanding = allPlanEntries.filter(e => !e.paidAt).reduce((sum, e) => sum + toEGP(e.amount, e.currency), 0);
  const totalOverdue = overdueEntries.reduce((sum, e) => sum + toEGP(e.amount, e.currency), 0);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-xs text-amber-700 font-bold mb-1">إجمالي المديونيات</p>
          <p className="text-xl font-extrabold text-amber-900">{totalOutstanding.toLocaleString('ar-EG')} ج.م</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-xs text-red-700 font-bold mb-1">متأخر السداد</p>
          <p className="text-xl font-extrabold text-red-900">{totalOverdue.toLocaleString('ar-EG')} ج.م</p>
          <p className="text-xs text-red-500 mt-0.5">{overdueEntries.length} دفعة متأخرة</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-xs text-emerald-700 font-bold mb-1">خطط الأقساط</p>
          <p className="text-xl font-extrabold text-emerald-900">
            {subscribersWithPlans.reduce((s, sub) => s + (sub.installmentPlans?.length || 0), 0)}
          </p>
          <p className="text-xs text-emerald-600 mt-0.5">{subscribersWithPlans.length} عميل</p>
        </div>
      </div>

      <div className="flex gap-2 justify-end flex-wrap">
        <button
          onClick={() => exportCSV(
            'installment-debts.csv',
            subscribersWithPlans.flatMap(s =>
              (s.installmentPlans ?? []).map(plan => {
                const paid = plan.entries.reduce((sum: number, e: { paidAt?: string; amount: number; paidAmount?: number }) => sum + (e.paidAmount ?? (e.paidAt ? e.amount : 0)), 0);
                return [s.name, s.phone, plan.courseTitle || '—', String(plan.totalAmount), plan.currency, String(paid), String(plan.totalAmount - paid)];
              })
            ),
            ['الاسم', 'الهاتف', 'الكورس', 'الإجمالي', 'العملة', 'المدفوع', 'المتبقي']
          )}
          className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl px-3 py-2 text-sm font-bold transition">
          <Download size={14} /> تصدير ديون CSV
        </button>
        <button onClick={() => { setIsNewPlanOpen(true); setNewPlanSubId(''); setNewPlanDraft({ courseId: '', courseTitle: '', totalAmount: 0, currency: 'EGP', notes: '', entries: [] }); setNewEntry({ dueDate: '', amount: 0, note: '' }); }}
          className="flex items-center gap-1.5 bg-primary-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary-700 transition">
          <Plus size={14} /> إضافة خطة أقساط جديدة
        </button>
      </div>

      {/* Plans list */}
      {subscribersWithPlans.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl py-12 text-center text-gray-400">
          <CalendarDays size={32} className="mx-auto mb-2 opacity-40" />
          <p>لا توجد خطط أقساط مسجلة بعد</p>
        </div>
      ) : (
        <div className="space-y-4">
          {subscribersWithPlans.map(sub => (
            <article key={sub.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 flex items-center gap-3">
                <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-xs font-bold text-primary-700">{sub.name.charAt(0)}</div>
                <div>
                  <p className="font-bold text-gray-900">{sub.name}</p>
                  <p className="text-xs text-gray-500">{sub.phone}</p>
                </div>
              </div>
              <div className="p-4 space-y-4">
                {(sub.installmentPlans || []).map(plan => {
                  const totalPaid = plan.entries.reduce((s, e) => s + (e.paidAmount ?? (e.paidAt ? e.amount : 0)), 0);
                  const pct = plan.totalAmount > 0 ? Math.round((totalPaid / plan.totalAmount) * 100) : 0;
                  return (
                    <div key={plan.id} className="border border-gray-200 rounded-xl p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-bold text-gray-800">{plan.courseTitle || 'خطة سداد'}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            إجمالي: {plan.totalAmount.toLocaleString()} {plan.currency} · مدفوع: {totalPaid.toLocaleString()} {plan.currency}
                          </p>
                        </div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pct >= 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{pct}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-3">
                        <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <div className="space-y-1.5">
                        {plan.entries.map(entry => {
                          const isOverdueEntry = !entry.paidAt && entry.dueDate < today;
                          return (
                            <div key={entry.id} className={`flex items-center gap-3 text-sm rounded-lg px-3 py-2 ${isOverdueEntry ? 'bg-red-50 border border-red-200' : entry.paidAt ? 'bg-emerald-50 border border-emerald-100' : 'bg-gray-50 border border-gray-100'}`}>
                              {entry.paidAt ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                                : isOverdueEntry ? <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                                : <Clock size={14} className="text-amber-500 flex-shrink-0" />}
                              <div className="flex-1">
                                <span className={`font-medium ${isOverdueEntry ? 'text-red-800' : entry.paidAt ? 'text-emerald-800' : 'text-gray-700'}`}>
                                  {entry.amount.toLocaleString()} {entry.currency}
                                </span>
                                <span className="text-xs text-gray-400 mr-2">استحقاق: {entry.dueDate}</span>
                                {entry.paidAt && <span className="text-xs text-emerald-600"> · سُدِّد: {entry.paidAt}</span>}
                                {isOverdueEntry && (
                                  <span className="text-xs text-red-600 font-bold">
                                    {' '}· متأخر {Math.floor((Date.now() - new Date(entry.dueDate).getTime()) / 86400000)} يوم
                                  </span>
                                )}
                                {entry.note && <span className="text-xs text-gray-400"> · {entry.note}</span>}
                              </div>
                              {!entry.paidAt && (
                                <button onClick={() => setPayingEntry({ subId: sub.id, planId: plan.id, entryId: entry.id, paidAmount: entry.amount, paymentMethod: '' })}
                                  className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded-lg hover:bg-emerald-700 transition flex-shrink-0">
                                  تم الدفع
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* New Plan Modal */}
      {isNewPlanOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsNewPlanOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" dir="rtl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">إضافة خطة أقساط</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">العميل *</label>
                <select value={newPlanSubId} onChange={e => setNewPlanSubId(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="">— اختر العميل —</option>
                  {[...subscribers].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(s => (
                    <option key={s.id} value={s.id}>{s.name} {s.phone ? `(${s.phone})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">الكورس / البرنامج (اختياري)</label>
                <select value={newPlanDraft.courseId} onChange={e => {
                  const c = courses.find(x => x.id === e.target.value);
                  setNewPlanDraft(d => ({ ...d, courseId: e.target.value, courseTitle: c?.title || d.courseTitle }));
                }} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="">— اختر كورس —</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">اسم الكورس / المنتج (نص حر)</label>
                <input value={newPlanDraft.courseTitle} onChange={e => setNewPlanDraft(d => ({ ...d, courseTitle: e.target.value }))}
                  placeholder="مثال: دبلوم الإرشاد النفسي"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">الإجمالي *</label>
                  <input type="number" min={0} value={newPlanDraft.totalAmount || ''}
                    onChange={e => setNewPlanDraft(d => ({ ...d, totalAmount: +e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">العملة</label>
                  <select value={newPlanDraft.currency} onChange={e => setNewPlanDraft(d => ({ ...d, currency: e.target.value as Currency }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    <option value="EGP">ج.م (EGP)</option>
                    <option value="SAR">ر.س (SAR)</option>
                    <option value="USD">$ (USD)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">ملاحظات</label>
                <input value={newPlanDraft.notes} onChange={e => setNewPlanDraft(d => ({ ...d, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-gray-700">الدفعات ({newPlanDraft.entries.length} دفعة)</p>
                <div className="flex gap-1.5 flex-wrap">
                  <input type="date" value={newEntry.dueDate} onChange={e => setNewEntry(d => ({ ...d, dueDate: e.target.value }))}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
                  <input type="number" min={0} placeholder="المبلغ" value={newEntry.amount || ''}
                    onChange={e => setNewEntry(d => ({ ...d, amount: +e.target.value }))}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs w-24" />
                  <input placeholder="ملاحظة" value={newEntry.note}
                    onChange={e => setNewEntry(d => ({ ...d, note: e.target.value }))}
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs flex-1 min-w-16" />
                  <button onClick={() => {
                    if (!newEntry.dueDate || !newEntry.amount) return;
                    setNewPlanDraft(d => ({ ...d, entries: [...d.entries, { ...newEntry }] }));
                    setNewEntry({ dueDate: '', amount: 0, note: '' });
                  }} className="bg-primary-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">
                    <Plus size={13} />
                  </button>
                </div>
                {newPlanDraft.entries.map((e, i) => (
                  <div key={i} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-gray-700">{e.dueDate} · {e.amount.toLocaleString()} {newPlanDraft.currency}{e.note ? ` · ${e.note}` : ''}</span>
                    <button onClick={() => setNewPlanDraft(d => ({ ...d, entries: d.entries.filter((_, j) => j !== i) }))}
                      className="text-red-400 hover:text-red-600"><X size={12} /></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => {
                    if (!newPlanSubId || !newPlanDraft.totalAmount || newPlanDraft.entries.length === 0) return;
                    const sub = subscribers.find(s => s.id === newPlanSubId);
                    if (!sub) return;
                    const plan: InstallmentPlan = {
                      id: `plan-${Date.now()}`,
                      courseId: newPlanDraft.courseId || undefined,
                      courseTitle: newPlanDraft.courseTitle || undefined,
                      totalAmount: newPlanDraft.totalAmount,
                      currency: newPlanDraft.currency,
                      notes: newPlanDraft.notes || undefined,
                      entries: newPlanDraft.entries.map((e, i) => ({
                        id: `entry-${Date.now()}-${i}`,
                        amount: e.amount, currency: newPlanDraft.currency,
                        dueDate: e.dueDate, note: e.note || undefined,
                      } as InstallmentEntry)),
                      createdAt: new Date().toISOString().slice(0, 10),
                    };
                    updateSubscriber({ ...sub, installmentPlans: [...(sub.installmentPlans || []), plan] });
                    if (newPlanDraft.courseId) {
                      void mysqlAdmin.addEnrollment(sub.id, newPlanDraft.courseId, null, 'limited', 15).catch(() => {});
                    }
                    notify('success', 'تم إنشاء خطة الأقساط بنجاح.');
                    setIsNewPlanOpen(false);
                    setNewPlanSubId('');
                    setNewPlanDraft({ courseId: '', courseTitle: '', totalAmount: 0, currency: 'EGP', notes: '', entries: [] });
                  }}
                  disabled={!newPlanSubId || !newPlanDraft.totalAmount || newPlanDraft.entries.length === 0}
                  className="flex-1 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-50">
                  حفظ الخطة
                </button>
                <button onClick={() => setIsNewPlanOpen(false)} className="px-5 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mark Paid Modal */}
      {payingEntry && (() => {
        const sub = subscribers.find(s => s.id === payingEntry.subId);
        const plan = sub?.installmentPlans?.find(p => p.id === payingEntry.planId);
        const entry = plan?.entries.find(e => e.id === payingEntry.entryId);
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPayingEntry(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" dir="rtl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-gray-900 mb-1">تأكيد سداد الدفعة</h3>
              <p className="text-sm text-gray-500 mb-4">{sub?.name} — {plan?.courseTitle || 'خطة سداد'}</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">المبلغ المدفوع فعلياً</label>
                  <input type="number" min={0}
                    value={payingEntry.paidAmount}
                    onChange={e => setPayingEntry(pe => pe ? { ...pe, paidAmount: +e.target.value } : null)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
                  <p className="text-xs text-gray-400 mt-0.5">المبلغ المستحق: {entry?.amount.toLocaleString()} {entry?.currency}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">وسيلة الدفع <span className="text-gray-400">(اختياري)</span></label>
                  <select value={payingEntry.paymentMethod}
                    onChange={e => setPayingEntry(pe => pe ? { ...pe, paymentMethod: e.target.value } : null)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                    <option value="">— اختر وسيلة الدفع —</option>
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      if (!sub) return;
                      const todayStr = new Date().toISOString().slice(0, 10);
                      const updatedPlans = (sub.installmentPlans || []).map(pl =>
                        pl.id !== payingEntry.planId ? pl : {
                          ...pl,
                          entries: pl.entries.map(en =>
                            en.id !== payingEntry.entryId ? en : {
                              ...en,
                              paidAt: todayStr,
                              paidAmount: payingEntry.paidAmount,
                            }
                          ),
                        }
                      );
                      const payHistEntry: PaymentHistoryEntry = {
                        id: `inst-${payingEntry.entryId}-${Date.now()}`,
                        amount: payingEntry.paidAmount,
                        currency: entry?.currency || plan?.currency || 'EGP',
                        paymentMethod: payingEntry.paymentMethod || undefined,
                        note: [
                          `قسط: ${plan?.courseTitle || 'خطة سداد'}`,
                          entry?.dueDate ? `استحقاق: ${entry.dueDate}` : '',
                          entry?.note || '',
                        ].filter(Boolean).join(' — ') || undefined,
                        paymentType: 'course',
                        courseId: plan?.courseId || undefined,
                        isInstallment: true,
                        at: todayStr,
                      };
                      let updatedCourseAccess = { ...(sub.courseAccess ?? {}) };
                      let updatedEnrolledIds = [...(sub.enrolledCourseIds ?? [])];
                      if (plan?.courseId) {
                        const prevInstCount = (sub.paymentHistory || []).filter(
                          p => p.isInstallment && p.courseId === plan.courseId
                        ).length;
                        if (prevInstCount === 0) {
                          const curAccess = updatedCourseAccess[plan.courseId];
                          const notFull = !curAccess || curAccess === 'preview' ||
                            (typeof curAccess === 'object' && curAccess.mode !== 'full' && curAccess.mode !== 'limited');
                          if (notFull) updatedCourseAccess[plan.courseId] = { mode: 'limited', lectureLimit: 15 };
                          if (!updatedEnrolledIds.includes(plan.courseId))
                            updatedEnrolledIds = [...updatedEnrolledIds, plan.courseId];
                        }
                      }
                      updateSubscriber({
                        ...sub,
                        installmentPlans: updatedPlans,
                        paymentHistory: [...(sub.paymentHistory || []), payHistEntry],
                        courseAccess: updatedCourseAccess,
                        enrolledCourseIds: updatedEnrolledIds,
                      });
                      void mysqlAdmin.saveSubscriberPayment(sub.id, payHistEntry as unknown as Record<string, unknown>).catch(() => {});
                      if (plan?.courseId) {
                        void mysqlAdmin.addEnrollment(sub.id, plan.courseId, null, 'limited', 15).catch(() => {});
                      }
                      notify('success', 'تم تسجيل دفعة القسط بنجاح.');
                      setPayingEntry(null);
                    }}
                    className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700">
                    تأكيد السداد
                  </button>
                  <button onClick={() => setPayingEntry(null)} className="px-5 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300">إلغاء</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
