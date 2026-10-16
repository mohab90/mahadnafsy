import { Plus, X } from 'lucide-react';
import { Modal } from '../../../../shared/ui/Modal';
import { cairoDateOnly } from '../../../../shared/cairoDate';

/**
 * «مشترك جديد» — one form for the management, the collection accounts and the Dokki desk.
 *
 * «في حسابات التحصيل وحسابات الدقي عند اضافه مشترك جديد بيظهر حجز ودفع ودا غلط المفروض يظهر زر مشترك جديد
 * زي اللى بيظهر عند الادارة … بنفس تفاصيله سواء في الاونلاين او الدقي» (16 Oct 2026). Management's form
 * lived inline in OnlineClientsTab and the other two accounts opened the booking dialog instead.
 *
 *   variant 'account'  management: the login (e-mail + password), each course with its access, price or
 *                      discount, the first payment — created through /admin/create-account.
 *   variant 'booking'  collection and Dokki: the same form without the login — name, number, the course
 *                      with its price or discount, the first payment, the referrer and a note — recorded
 *                      through the booking endpoint, so a collection officer's customer still waits for
 *                      the manager and a Dokki one still lands on the branch's books.
 */
export type NewSubscriberCourse = { courseId: string; accessType: 'full' | 'limited'; videoCount: string; discount: string; customPrice: string };
export type NewSubscriberDraft = {
  name: string; phone: string; email: string; password: string; branch: string;
  amount: string; currency: 'EGP' | 'SAR' | 'USD'; paymentMethod: string; date: string; transactionId: string;
  note: string; referredBy: string; courses: NewSubscriberCourse[];
};

export const blankCourse = (): NewSubscriberCourse => ({ courseId: '', accessType: 'full', videoCount: '', discount: '', customPrice: '' });
export const blankNewSubscriber = (): NewSubscriberDraft => ({
  name: '', phone: '', email: '', password: '', branch: '', amount: '', currency: 'EGP', paymentMethod: '',
  date: cairoDateOnly(), transactionId: '', note: '', referredBy: '', courses: [blankCourse()],
});

type CourseOption = { id: string; title: string; titleAr?: string };

export function NewSubscriberModal({ variant, branchLabel = '', draft, setDraft, courses, bundles, paymentBoxes, saving, lockPrice = false, onSubmit, onClose }: {
  variant: 'account' | 'booking';
  /** The branch the client is recorded on, named in the heading of the booking form. */
  branchLabel?: string;
  draft: NewSubscriberDraft;
  setDraft: (update: (current: NewSubscriberDraft) => NewSubscriberDraft) => void;
  courses: CourseOption[];
  bundles: CourseOption[];
  paymentBoxes: string[];
  saving: boolean;
  /** A collection officer does not set a client's price: the list price stands. */
  lockPrice?: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const account = variant === 'account';
  const setCourse = (index: number, patch: Partial<NewSubscriberCourse>) =>
    setDraft(d => ({ ...d, courses: d.courses.map((course, j) => (j === index ? { ...course, ...patch } : course)) }));
  const hasCourse = draft.courses.some(course => course.courseId);
  const phoneOk = draft.phone.replace(/\D/g, '').length >= 9;
  const paying = Number(draft.amount) > 0;
  // A client is reached by phone, and money is not recorded against one without (the server refuses it: PHONE_REQUIRED).
  const incomplete = !draft.name.trim() || !phoneOk
    || (account && (!draft.email.trim() || !draft.password.trim()))
    || (paying && !draft.paymentMethod)
    // The booking records a course with its first payment: a course with no money has nowhere to be recorded.
    || (!account && hasCourse && !paying);
  const input = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200';

  return (
    <Modal open onClose={onClose}
      title={account ? '🌐 مشترك أونلاين جديد' : `🧾 مشترك جديد${branchLabel ? ` — ${branchLabel}` : ''}`}
      subtitle={account ? 'إنشاء حساب عميل أونلاين' : 'تسجيل العميل وأول حجز له'}
      tone="emerald" size="md" align="sheet">
      <div className="space-y-4">
        {/* بيانات الحساب */}
        <div>
          <p className="text-xs font-extrabold text-gray-500 uppercase mb-2">{account ? '👤 بيانات الحساب' : '👤 بيانات العميل'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">الاسم الكامل *</label>
              <input type="text" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} className={input} placeholder="اسم العميل" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">رقم الهاتف *</label>
              <input type="tel" value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} className={input} placeholder="+201xxxxxxxxx" dir="ltr" />
            </div>
          </div>
          {account && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">البريد الإلكتروني *</label>
                <input type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} className={input} placeholder="email@example.com" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">كلمة المرور *</label>
                <input type="text" value={draft.password} onChange={e => setDraft(d => ({ ...d, password: e.target.value }))} className={`${input} font-mono`} placeholder="كلمة مرور" dir="ltr" />
              </div>
            </div>
          )}
        </div>

        {/* الكورسات */}
        <div>
          <p className="text-xs font-extrabold text-gray-500 uppercase mb-2">{account ? '🎓 الكورسات والصلاحيات' : '🎓 الكورس'}</p>
          <div className="border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">{account ? 'اختر الكورس/الباقة وحدد الصلاحية' : 'اختر الكورس/الباقة — بيتسجل مع أول دفعة'}</span>
              {account && (
                <button onClick={() => setDraft(d => ({ ...d, courses: [...d.courses, blankCourse()] }))}
                  className="flex items-center gap-1 text-xs text-emerald-700 font-bold border border-emerald-200 bg-emerald-50 rounded-lg px-2 py-1 hover:bg-emerald-100">
                  <Plus size={11} /> إضافة
                </button>
              )}
            </div>
            {(account ? draft.courses : draft.courses.slice(0, 1)).map((c, i) => (
              <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <select value={c.courseId} onChange={e => setCourse(i, { courseId: e.target.value })}
                    className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                    <option value="">— اختر الكورس —</option>
                    {courses.map(co => <option key={co.id} value={co.id}>🎓 {co.titleAr || co.title}</option>)}
                    {bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.titleAr || b.title}</option>)}
                  </select>
                  {account && draft.courses.length > 1 && (
                    <button onClick={() => setDraft(d => ({ ...d, courses: d.courses.filter((_, j) => j !== i) }))}
                      className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50"><X size={13} /></button>
                  )}
                </div>
                {account && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500">الصلاحية:</span>
                    <button onClick={() => setCourse(i, { accessType: 'full', videoCount: '' })}
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full border transition ${c.accessType === 'full' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}>صلاحية كاملة</button>
                    <button onClick={() => setCourse(i, { accessType: 'limited' })}
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full border transition ${c.accessType === 'limited' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}>عدد فيديوهات</button>
                    {c.accessType === 'limited' && (
                      <input type="number" min="1" value={c.videoCount} onChange={e => setCourse(i, { videoCount: e.target.value })}
                        className="w-16 border border-blue-200 rounded-lg px-2 py-0.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-200" placeholder="عدد" />
                    )}
                  </div>
                )}
                {!lockPrice && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500 mb-0.5 block">سعر مخصص (ج.م)</label>
                      <input type="number" min="0" value={c.customPrice} onChange={e => setCourse(i, { customPrice: e.target.value, discount: '' })}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-200" placeholder="السعر الأصلي" />
                    </div>
                    <div className="text-[10px] text-gray-400 pt-4">أو</div>
                    <div className="w-20">
                      <label className="text-[10px] text-gray-500 mb-0.5 block">خصم %</label>
                      <input type="number" min="0" max="100" value={c.discount} onChange={e => setCourse(i, { discount: e.target.value, customPrice: '' })}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-200" placeholder="0" />
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!account && <p className="text-[11px] text-gray-400">كورس تاني للعميل ده بيتسجل من «حجز / دفعة» بعد ما يتضاف.</p>}
          </div>
        </div>

        {/* الدفعة الأولى */}
        <div className="bg-gradient-to-l from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-3 space-y-3">
          <p className="text-xs font-extrabold text-emerald-700 flex items-center gap-1">💳 دفعة أولى {account ? '(اختياري)' : hasCourse ? '' : '(اختياري)'}</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 mb-1">المبلغ</label>
              <input type="number" min="0" value={draft.amount} onChange={e => setDraft(d => ({ ...d, amount: e.target.value }))}
                className="w-full border border-emerald-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="0" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-600 mb-1">العملة</label>
              <select value={draft.currency} onChange={e => setDraft(d => ({ ...d, currency: e.target.value as 'EGP' | 'SAR' | 'USD' }))}
                className="w-full border border-emerald-200 rounded-xl px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                <option value="EGP">ج.م — جنيه مصري</option>
                <option value="SAR">ر.س — ريال سعودي</option>
                <option value="USD">$ — دولار</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-gray-600 mb-1">طريقة الدفع</label>
            <select value={draft.paymentMethod} onChange={e => setDraft(d => ({ ...d, paymentMethod: e.target.value }))}
              className="w-full border border-emerald-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
              <option value="">— اختر طريقة الدفع —</option>
              {paymentBoxes.map(pm => <option key={pm} value={pm}>{pm}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 mb-1">تاريخ الدفع</label>
              <input type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))}
                className="w-full border border-emerald-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-600 mb-1">رقم الإيصال</label>
              <input type="text" value={draft.transactionId} onChange={e => setDraft(d => ({ ...d, transactionId: e.target.value }))}
                className="w-full border border-emerald-200 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="اختياري" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">رقم المحوِّل</label>
            <input type="text" value={draft.referredBy} onChange={e => setDraft(d => ({ ...d, referredBy: e.target.value }))} className={input} placeholder="كود أو اسم (اختياري)" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">ملاحظات</label>
            <input type="text" value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} className={input} placeholder="أي ملاحظات..." />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-100">إلغاء</button>
        <button disabled={saving || incomplete} onClick={onSubmit}
          className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition">
          {saving ? '⏳ جاري الحفظ...' : account ? '✅ إنشاء الحساب' : '✅ تسجيل المشترك'}
        </button>
      </div>
    </Modal>
  );
}
