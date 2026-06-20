/**
 * OnlineSubscriberModal — unified "new online subscriber" account-creation modal.
 * Single source of truth for creating an online LMS account (with per-course
 * access levels, custom price/discount, optional first-payment fields and
 * referral code). Calls mysqlAdmin.createAccount.
 *
 * Extracted from OnlineClientsTab so the form lives in one reusable place.
 */
import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { mysqlAdmin } from '../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type CourseRow = {
  courseId: string;
  accessType: 'full' | 'limited';
  videoCount: string;
  discount: string;
  customPrice: string;
};

type Draft = {
  name: string; phone: string; email: string; password: string;
  amount: string; currency: 'EGP' | 'SAR' | 'USD';
  paymentMethod: string; date: string; transactionId: string;
  note: string; referredBy: string; courses: CourseRow[];
};

const blank = (): Draft => ({
  name: '', phone: '', email: '', password: '',
  amount: '', currency: 'EGP', paymentMethod: '', date: new Date().toISOString().slice(0, 10),
  transactionId: '', note: '', referredBy: '',
  courses: [{ courseId: '', accessType: 'full', videoCount: '', discount: '', customPrice: '' }],
});

interface Props {
  isOpen: boolean;
  onClose: () => void;
  notify: NotifyFn;
  /** Called after a successful account creation */
  onSuccess?: () => void;
}

export default function OnlineSubscriberModal({ isOpen, onClose, notify, onSuccess }: Props) {
  const { courses, bundles, content } = useSiteData();
  const [draft, setDraft] = useState<Draft>(blank);
  const [saving, setSaving] = useState(false);

  const pmList: string[] = content['finance.payment_methods']
    ? content['finance.payment_methods'].split('||').map((s: string) => s.trim()).filter(Boolean)
    : ['كاش', 'فودافون كاش', 'انستاباي', 'تحويل بنكي', 'بطاقة ائتمان', 'خزنة الدقي'];

  const reset = () => setDraft(blank());
  const close = () => { onClose(); reset(); };

  if (!isOpen) return null;

  const canSubmit = !saving && draft.name.trim() && draft.email.trim() && draft.password.trim();

  const handleSubmit = async () => {
    if (!draft.name.trim() || !draft.email.trim() || !draft.password.trim()) return;
    setSaving(true);
    try {
      const validCourses = draft.courses.filter(c => c.courseId).map(c => ({
        courseId: c.courseId,
        accessType: c.accessType,
        ...(c.accessType === 'limited' && c.videoCount ? { videoCount: String(c.videoCount) } : {}),
        ...(c.customPrice ? { customPrice: Number(c.customPrice) } : {}),
        ...(c.discount ? { discount: Number(c.discount) } : {}),
      }));
      const amountNum = Number(draft.amount);
      await mysqlAdmin.createAccount({
        name: draft.name.trim(),
        email: draft.email.trim(),
        password: draft.password,
        phone: draft.phone.trim(),
        ...(validCourses.length > 0 ? { courses: validCourses } : {}),
        ...(draft.referredBy.trim() ? { referredBy: draft.referredBy.trim() } : {}),
        // Record the optional first payment atomically with the account (was silently dropped before)
        ...(amountNum > 0 ? {
          firstPayment: {
            amount: amountNum,
            currency: draft.currency,
            paymentMethod: draft.paymentMethod || undefined,
            date: draft.date || undefined,
            transactionId: draft.transactionId || undefined,
            note: draft.note || undefined,
            courseId: validCourses[0]?.courseId || undefined,
          },
        } : {}),
      });
      notify('success', `✅ تم إنشاء حساب ${draft.name.trim()} بنجاح`);
      onSuccess?.();
      close();
    } catch (err: unknown) {
      notify('error', '❌ فشل إنشاء الحساب: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" dir="rtl"
      onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-l from-emerald-600 to-teal-600 text-white">
          <div>
            <h3 className="font-extrabold text-base">🌐 مشترك أونلاين جديد</h3>
            <p className="text-xs text-emerald-100 mt-0.5">إنشاء حساب عميل أونلاين</p>
          </div>
          <button onClick={close} className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* بيانات الحساب */}
          <div>
            <p className="text-xs font-extrabold text-gray-500 uppercase mb-2">👤 بيانات الحساب</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">الاسم الكامل *</label>
                <input type="text" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="اسم العميل" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">رقم الهاتف</label>
                <input type="tel" value={draft.phone} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="+201xxxxxxxxx" dir="ltr" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">البريد الإلكتروني *</label>
                <input type="email" value={draft.email} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="email@example.com" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">كلمة المرور *</label>
                <input type="text" value={draft.password} onChange={e => setDraft(d => ({ ...d, password: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="كلمة مرور" dir="ltr" />
              </div>
            </div>
          </div>
          {/* الكورسات */}
          <div>
            <p className="text-xs font-extrabold text-gray-500 uppercase mb-2">🎓 الكورسات والصلاحيات</p>
            <div className="border border-gray-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">اختر الكورس/الباقة وحدد الصلاحية</span>
                <button onClick={() => setDraft(d => ({ ...d, courses: [...d.courses, { courseId: '', accessType: 'full', videoCount: '', discount: '', customPrice: '' }] }))}
                  className="flex items-center gap-1 text-xs text-emerald-700 font-bold border border-emerald-200 bg-emerald-50 rounded-lg px-2 py-1 hover:bg-emerald-100">
                  <Plus size={11} /> إضافة
                </button>
              </div>
              {draft.courses.map((c, i) => (
                <div key={i} className="bg-gray-50 border border-gray-200 rounded-xl p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <select value={c.courseId} onChange={e => setDraft(d => ({ ...d, courses: d.courses.map((x, j) => j === i ? { ...x, courseId: e.target.value } : x) }))}
                      className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                      <option value="">— اختر الكورس —</option>
                      {courses.map(co => <option key={co.id} value={co.id}>🎓 {co.titleAr || co.title}</option>)}
                      {bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.titleAr || b.title}</option>)}
                    </select>
                    {draft.courses.length > 1 && (
                      <button onClick={() => setDraft(d => ({ ...d, courses: d.courses.filter((_, j) => j !== i) }))}
                        className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50"><X size={13} /></button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500">الصلاحية:</span>
                    <button onClick={() => setDraft(d => ({ ...d, courses: d.courses.map((x, j) => j === i ? { ...x, accessType: 'full', videoCount: '' } : x) }))}
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full border transition ${c.accessType === 'full' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}>صلاحية كاملة</button>
                    <button onClick={() => setDraft(d => ({ ...d, courses: d.courses.map((x, j) => j === i ? { ...x, accessType: 'limited' } : x) }))}
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full border transition ${c.accessType === 'limited' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}`}>عدد فيديوهات</button>
                    {c.accessType === 'limited' && (
                      <input type="number" min="1" value={c.videoCount} onChange={e => setDraft(d => ({ ...d, courses: d.courses.map((x, j) => j === i ? { ...x, videoCount: e.target.value } : x) }))}
                        className="w-16 border border-blue-200 rounded-lg px-2 py-0.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-blue-200" placeholder="عدد" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500 mb-0.5 block">سعر مخصص (ج.م)</label>
                      <input type="number" min="0" value={c.customPrice} onChange={e => setDraft(d => ({ ...d, courses: d.courses.map((x, j) => j === i ? { ...x, customPrice: e.target.value, discount: '' } : x) }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-200" placeholder="السعر الأصلي" />
                    </div>
                    <div className="text-[10px] text-gray-400 pt-4">أو</div>
                    <div className="w-20">
                      <label className="text-[10px] text-gray-500 mb-0.5 block">خصم %</label>
                      <input type="number" min="0" max="100" value={c.discount} onChange={e => setDraft(d => ({ ...d, courses: d.courses.map((x, j) => j === i ? { ...x, discount: e.target.value, customPrice: '' } : x) }))}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-emerald-200" placeholder="0" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* الدفعة الأولى */}
          <div className="bg-gradient-to-l from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-3 space-y-3">
            <p className="text-xs font-extrabold text-emerald-700 flex items-center gap-1">💳 دفعة أولى (اختياري)</p>
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
                {pmList.map(pm => <option key={pm} value={pm}>{pm}</option>)}
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
              <input type="text" value={draft.referredBy} onChange={e => setDraft(d => ({ ...d, referredBy: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="كود أو اسم (اختياري)" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">ملاحظات</label>
              <input type="text" value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200" placeholder="أي ملاحظات..." />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={close} className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-100">إلغاء</button>
          <button disabled={!canSubmit} onClick={handleSubmit}
            className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 transition">
            {saving ? '⏳ جاري الإنشاء...' : '✅ إنشاء الحساب'}
          </button>
        </div>
      </div>
    </div>
  );
}
