import React from 'react';
import { X } from 'lucide-react';
import type { SubscriberItem, Bundle, Course } from '../../types';

export type InstPlanDraft = {
  courseId: string;
  currency: 'EGP' | 'SAR' | 'USD';
  amountPerInst: string;
  numInstallments: string;
  inputMode: 'count' | 'amount';
  startDate: string;
  intervalDays: string;
  notes: string;
};
type InstBookingInfo = { currency: 'EGP' | 'SAR' | 'USD'; expectedEGP: number; paidEGP: number; remainingEGP: number };

interface Props {
  subscriber: SubscriberItem;
  clientName: string;
  bundles: Bundle[];
  courses: Course[];
  instPlanDraft: InstPlanDraft;
  setInstPlanDraft: React.Dispatch<React.SetStateAction<InstPlanDraft>>;
  getInstBookingInfo: (courseIdOrBundle: string) => InstBookingInfo;
  onCreate: () => void;
  onClose: () => void;
}

/** "خطة أقساط جديدة" modal (extracted from UnifiedClientPage). */
export default function InstallmentPlanModal({
  subscriber, clientName, bundles, courses, instPlanDraft, setInstPlanDraft, getInstBookingInfo, onCreate, onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-lg shadow">📅</div>
            <div>
              <p className="font-extrabold text-gray-900 text-sm">خطة أقساط جديدة</p>
              <p className="text-[11px] text-gray-400">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          {/* ── 1. Course / Bundle selector ── */}
          <div>
            <label className="text-xs font-bold text-gray-700 mb-1.5 block">📚 الكورس أو المسار</label>
            {(() => {
              const completeBundles = bundles.filter(b =>
                b.courses.length > 0 && b.courses.every(cc => subscriber.enrolledCourseIds.includes(cc.id))
              );
              const bundleCourseIds = new Set(completeBundles.flatMap(b => b.courses.map(cc => cc.id)));
              const soloEnrolled = subscriber.enrolledCourseIds.filter(cId => !bundleCourseIds.has(cId));
              return (
                <div className="space-y-1.5">
                  {completeBundles.map(b => {
                    const val = `bundle:${b.id}`;
                    const info = getInstBookingInfo(val);
                    const isActive = instPlanDraft.courseId === val;
                    return (
                      <button key={val} type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, courseId: val, currency: info.currency, amountPerInst: '', numInstallments: '3' })}
                        className={`w-full text-right px-3 py-2.5 rounded-xl border-2 text-sm transition ${isActive ? 'border-purple-500 bg-white' : 'border-gray-200 bg-white hover:border-purple-200'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-gray-800">📌 {b.title}</span>
                          <span className="text-[10px] font-bold text-purple-600">{b.courses.length} كورس</span>
                        </div>
                        {info.expectedEGP > 0 && (
                          <div className="text-[10px] text-gray-400 mt-0.5 flex gap-2">
                            <span>الإجمالي: {info.expectedEGP.toLocaleString()} ج.م</span>
                            <span>·</span><span className="text-green-600">مدفوع: {info.paidEGP.toLocaleString()}</span>
                            <span>·</span><span className={`font-bold ${info.remainingEGP > 0 ? 'text-red-600' : 'text-green-600'}`}>متبقي: {info.remainingEGP.toLocaleString()}</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                  {soloEnrolled.map(cId => {
                    const mc = courses.find(x => x.id === cId);
                    const info = getInstBookingInfo(cId);
                    const isActive = instPlanDraft.courseId === cId;
                    return (
                      <button key={cId} type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, courseId: cId, currency: info.currency, amountPerInst: '', numInstallments: '3' })}
                        className={`w-full text-right px-3 py-2.5 rounded-xl border-2 text-sm transition ${isActive ? 'border-purple-500 bg-white' : 'border-gray-200 bg-white hover:border-purple-200'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-gray-800">🎓 {mc?.title || cId}</span>
                        </div>
                        {info.expectedEGP > 0 && (
                          <div className="text-[10px] text-gray-400 mt-0.5 flex gap-2">
                            <span>الإجمالي: {info.expectedEGP.toLocaleString()} ج.م</span>
                            <span>·</span><span className="text-green-600">مدفوع: {info.paidEGP.toLocaleString()}</span>
                            <span>·</span><span className={`font-bold ${info.remainingEGP > 0 ? 'text-red-600' : 'text-green-600'}`}>متبقي: {info.remainingEGP.toLocaleString()}</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* ── 2. Auto-info card ── */}
          {instPlanDraft.courseId && (() => {
            const info = getInstBookingInfo(instPlanDraft.courseId);
            if (!info.expectedEGP) return null;
            const currLabel = instPlanDraft.currency === 'SAR' ? 'ر.س' : instPlanDraft.currency === 'USD' ? '$' : 'ج.م';
            return (
              <div className="bg-white border border-purple-200 rounded-xl px-4 py-3 grid grid-cols-3 gap-3 text-center text-xs">
                <div><p className="text-gray-400">إجمالي الكورس</p><p className="font-extrabold text-gray-800 text-base">{info.expectedEGP.toLocaleString()} <span className="text-[10px] font-normal">{currLabel}</span></p></div>
                <div><p className="text-gray-400">مدفوع بالفعل</p><p className="font-extrabold text-green-600 text-base">{info.paidEGP.toLocaleString()} <span className="text-[10px] font-normal">{currLabel}</span></p></div>
                <div><p className="text-gray-400">المتبقي للأقساط</p><p className={`font-extrabold text-base ${info.remainingEGP > 0 ? 'text-red-600' : 'text-green-600'}`}>{info.remainingEGP > 0 ? info.remainingEGP.toLocaleString() : '✅ مكتمل'} {info.remainingEGP > 0 ? <span className="text-[10px] font-normal">{currLabel}</span> : null}</p></div>
              </div>
            );
          })()}

          {/* ── 3. Count / amount controls ── */}
          {instPlanDraft.courseId && getInstBookingInfo(instPlanDraft.courseId).remainingEGP > 0 && (() => {
            const info = getInstBookingInfo(instPlanDraft.courseId);
            const remaining = info.remainingEGP;
            const currLabel = instPlanDraft.currency === 'SAR' ? 'ر.س' : instPlanDraft.currency === 'USD' ? '$' : 'ج.م';
            const n = Math.max(1, Number(instPlanDraft.numInstallments) || 1);
            const perInstCalc = instPlanDraft.inputMode === 'count' ? Math.floor(remaining / n) : (Number(instPlanDraft.amountPerInst) || 0);
            const numCalc = instPlanDraft.inputMode === 'amount' && Number(instPlanDraft.amountPerInst) > 0 ? Math.ceil(remaining / Number(instPlanDraft.amountPerInst)) : n;
            return (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, inputMode: 'count', amountPerInst: '' })}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition ${instPlanDraft.inputMode === 'count' ? 'border-purple-500 bg-purple-100 text-purple-700' : 'border-gray-200 bg-white text-gray-500'}`}>
                    أحدد عدد الأقساط
                  </button>
                  <button type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, inputMode: 'amount', numInstallments: '' })}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition ${instPlanDraft.inputMode === 'amount' ? 'border-purple-500 bg-purple-100 text-purple-700' : 'border-gray-200 bg-white text-gray-500'}`}>
                    أحدد قيمة القسط
                  </button>
                </div>
                {instPlanDraft.inputMode === 'count' ? (
                  <div>
                    <label className="text-xs font-bold text-gray-700 mb-1.5 block">عدد الأقساط</label>
                    <div className="flex gap-1.5 flex-wrap mb-2">
                      {[2, 3, 4, 6, 8, 12].map(nt => (
                        <button key={nt} type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, numInstallments: String(nt) })}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ${instPlanDraft.numInstallments === String(nt) ? 'border-purple-500 bg-purple-100 text-purple-700' : 'border-gray-200 bg-white text-gray-600 hover:border-purple-200'}`}>
                          {nt} <span className="font-normal text-[10px]">({Math.floor(remaining / nt).toLocaleString()} {currLabel})</span>
                        </button>
                      ))}
                    </div>
                    <input type="number" min="1" max="60" value={instPlanDraft.numInstallments}
                      onChange={e => setInstPlanDraft({ ...instPlanDraft, numInstallments: e.target.value })}
                      placeholder="أو اكتب العدد يدوياً"
                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                    {perInstCalc > 0 && <p className="text-xs text-purple-700 font-bold mt-1">👉 كل قسط ≈ {perInstCalc.toLocaleString()} {currLabel}</p>}
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-bold text-gray-700 mb-1.5 block">قيمة القسط الواحد ({currLabel})</label>
                    <input type="number" min="1" value={instPlanDraft.amountPerInst}
                      onChange={e => setInstPlanDraft({ ...instPlanDraft, amountPerInst: e.target.value })}
                      placeholder={`مثال: ${Math.floor(remaining / 3).toLocaleString()}`}
                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                    {numCalc > 0 && Number(instPlanDraft.amountPerInst) > 0 && (
                      <p className="text-xs text-purple-700 font-bold mt-1">👉 العدد المطلوب ≈ {numCalc} قسط</p>
                    )}
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold text-gray-700 mb-1.5 block">تكرار القسط</label>
                  <div className="flex gap-2">
                    {[['30', 'كل شهر'], ['14', 'كل أسبوعين'], ['7', 'كل أسبوع']].map(([d, lbl]) => (
                      <button key={d} type="button" onClick={() => setInstPlanDraft({ ...instPlanDraft, intervalDays: d })}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold border-2 transition ${instPlanDraft.intervalDays === d ? 'border-purple-500 bg-purple-100 text-purple-700' : 'border-gray-200 bg-white text-gray-600 hover:border-purple-200'}`}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-bold text-gray-700 mb-1 block">تاريخ القسط القادم</label>
                    <input type="date" value={instPlanDraft.startDate}
                      onChange={e => setInstPlanDraft({ ...instPlanDraft, startDate: e.target.value })}
                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-700 mb-1 block">ملاحظة (اختياري)</label>
                    <input type="text" value={instPlanDraft.notes}
                      onChange={e => setInstPlanDraft({ ...instPlanDraft, notes: e.target.value })}
                      placeholder="مثال: متفق مع العميل"
                      className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                {(perInstCalc > 0 || numCalc > 0) && (
                  <div className="bg-white border border-purple-200 rounded-xl px-4 py-3 text-xs space-y-1">
                    <p className="font-bold text-purple-700 mb-1.5">📊 ملخص الخطة</p>
                    <div className="flex justify-between"><span className="text-gray-500">المتبقي للتقسيط</span><span className="font-bold">{remaining.toLocaleString()} {currLabel}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">عدد الأقساط</span><span className="font-bold text-purple-700">{instPlanDraft.inputMode === 'amount' ? numCalc : n} قسط</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">قيمة كل قسط</span><span className="font-bold text-purple-700">{perInstCalc.toLocaleString()} {currLabel}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">أول قسط</span><span className="font-bold">{instPlanDraft.startDate}</span></div>
                  </div>
                )}
              </div>
            );
          })()}

          {instPlanDraft.courseId && getInstBookingInfo(instPlanDraft.courseId).remainingEGP === 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 font-bold text-center">✅ هذا الكورس/المسار مدفوع بالكامل — لا يحتاج تقسيط</div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onCreate}
              disabled={!instPlanDraft.courseId || !instPlanDraft.numInstallments || getInstBookingInfo(instPlanDraft.courseId).remainingEGP === 0}
              className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-bold hover:bg-purple-700 disabled:opacity-40">
              💾 إنشاء الخطة
            </button>
            <button onClick={onClose}
              className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
