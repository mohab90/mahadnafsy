import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { DiscountRule } from '../../../../types';
import { useSiteData } from '../../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type PromoCode = { id: string; code: string; discount_type: 'percent' | 'fixed'; discount_value: number; min_order_amount: number; max_uses: number | null; used_count: number; expires_at: string | null; active: number };

interface Props {
  notify: NotifyFn;
  policyDrafts: Record<string, string>;
  setPolicyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export function DiscountsView({ notify, policyDrafts, setPolicyDrafts }: Props) {
  const { discounts, addDiscount, updateDiscount, deleteDiscount, courses, bundles, therapists, content, setContentValue } = useSiteData();
  const [discountDraft, setDiscountDraft] = useState<Omit<DiscountRule, 'id' | 'createdAt'>>({ type: 'course', targetId: '', discountPercent: 10, label: '', promoCode: '', active: true, expiresAt: '' });
  const [editingDiscountId, setEditingDiscountId] = useState('');
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoForm, setPromoForm] = useState({ code: '', discount_type: 'percent' as 'percent' | 'fixed', discount_value: 10, min_order_amount: 0, max_uses: '', expires_at: '' });
  const [promoFormOpen, setPromoFormOpen] = useState(false);

  const loadPromoCodes = async () => {
    setPromoLoading(true);
    try {
      const rows = await mysqlAdmin.listPromoCodes() as unknown as PromoCode[];
      setPromoCodes(rows);
    } catch { /* ignore */ } finally { setPromoLoading(false); }
  };
  useEffect(() => { loadPromoCodes(); }, []);

    const activeDiscounts = discounts.filter(d => d.active && (!d.expiresAt || d.expiresAt >= new Date().toISOString().slice(0,10)));
    const expiredDiscounts = discounts.filter(d => !d.active || (d.expiresAt && d.expiresAt < new Date().toISOString().slice(0,10)));
    const startEdit = (d: DiscountRule) => {
      setEditingDiscountId(d.id);
      setDiscountDraft({ type: d.type, targetId: d.targetId || '', discountPercent: d.discountPercent, label: d.label || '', promoCode: d.promoCode || '', active: d.active, expiresAt: d.expiresAt || '' });
    };
    const cancelEdit = () => { setEditingDiscountId(''); setDiscountDraft({ type: 'course', targetId: '', discountPercent: 10, label: '', promoCode: '', active: true, expiresAt: '' }); };
    const saveDiscount = () => {
      if (!discountDraft.discountPercent || discountDraft.discountPercent <= 0 || discountDraft.discountPercent > 100) { alert('نسبة الخصم يجب أن تكون بين 1 و 100'); return; }
      if (editingDiscountId) {
        updateDiscount({ ...discountDraft, id: editingDiscountId, createdAt: discounts.find(d => d.id === editingDiscountId)?.createdAt || new Date().toISOString() } as DiscountRule);
      } else {
        addDiscount({ ...discountDraft, id: `disc-${Date.now()}`, createdAt: new Date().toISOString() } as DiscountRule);
      }
      cancelEdit();
    };
    const typeLabel: Record<string, string> = { course: 'كورس بعينه', bundle: 'مسار/باقة', all_courses: 'كل الكورسات', therapist_consultation: 'مستشار بعينه', all_consultations: 'كل الاستشارات' };
    return (
      <div className="space-y-5 animate-fade-in" dir="rtl">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-extrabold flex items-center gap-2">🎫 الخصومات والكوبونات</h2>
              <p className="text-emerald-100 text-sm mt-1">إدارة كوبونات الخصم وعروض الأسعار</p>
            </div>
            <div className="flex gap-3 text-center">
              <div className="bg-white/20 rounded-xl px-4 py-2"><p className="text-2xl font-black">{discounts.length}</p><p className="text-xs">إجمالي</p></div>
              <div className="bg-white/20 rounded-xl px-4 py-2"><p className="text-2xl font-black text-green-200">{activeDiscounts.length}</p><p className="text-xs">نشطة</p></div>
              <div className="bg-white/20 rounded-xl px-4 py-2"><p className="text-2xl font-black text-red-200">{expiredDiscounts.length}</p><p className="text-xs">منتهية</p></div>
            </div>
          </div>
        </div>

        {/* Cash Discount Setting */}
        <div className="bg-white border border-emerald-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">💵 خصم الدفع الفوري (الكاش)</h3>
          <p className="text-sm text-gray-500 mb-3">نسبة خصم تُطبَّق تلقائياً على الكورسات والمسارات عند الدفع بالكاش في صفحة الدفع. اضبطها على 0 لإلغاء التفعيل.</p>
          <div className="flex items-center gap-3 max-w-xs">
            <input
              type="number"
              min="0"
              max="100"
              className="border border-gray-300 rounded-xl px-4 py-2.5 text-sm w-32"
              placeholder="0"
              value={policyDrafts['checkout.cashDiscountPercent'] ?? content['checkout.cashDiscountPercent'] ?? ''}
              onChange={(e) => setPolicyDrafts(prev => ({ ...prev, 'checkout.cashDiscountPercent': e.target.value }))}
            />
            <span className="text-gray-600 font-bold">%</span>
            {policyDrafts['checkout.cashDiscountPercent'] !== undefined && (
              <>
                <button
                  onClick={() => {
                    setContentValue('checkout.cashDiscountPercent', policyDrafts['checkout.cashDiscountPercent'] ?? '');
                    setPolicyDrafts(prev => { const next = { ...prev }; delete next['checkout.cashDiscountPercent']; return next; });
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-sm"
                >
                  حفظ
                </button>
                <button
                  onClick={() => setPolicyDrafts(prev => { const next = { ...prev }; delete next['checkout.cashDiscountPercent']; return next; })}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm"
                >
                  إلغاء
                </button>
              </>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4">{editingDiscountId ? '✏️ تعديل كوبون' : '➕ إضافة كوبون جديد'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">نوع الخصم</label>
              <select value={discountDraft.type} onChange={e => setDiscountDraft(p => ({ ...p, type: e.target.value as DiscountRule['type'], targetId: '' }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                <option value="course">كورس بعينه</option>
                <option value="bundle">مسار/باقة بعينها</option>
                <option value="all_courses">كل الكورسات</option>
                <option value="therapist_consultation">مستشار بعينه</option>
                <option value="all_consultations">كل الاستشارات</option>
              </select>
            </div>
            {(discountDraft.type === 'course') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اختر الكورس</label>
                <select value={discountDraft.targetId || ''} onChange={e => setDiscountDraft(p => ({ ...p, targetId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="">— اختر كورساً —</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
            )}
            {(discountDraft.type === 'bundle') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اختر المسار/الباقة</label>
                <select value={discountDraft.targetId || ''} onChange={e => setDiscountDraft(p => ({ ...p, targetId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="">— اختر مساراً —</option>
                  {bundles.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
              </div>
            )}
            {(discountDraft.type === 'therapist_consultation') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اختر المستشار</label>
                <select value={discountDraft.targetId || ''} onChange={e => setDiscountDraft(p => ({ ...p, targetId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="">— اختر مستشاراً —</option>
                  {therapists.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">نسبة الخصم %</label>
              <input type="number" min={1} max={100} value={discountDraft.discountPercent}
                onChange={e => setDiscountDraft(p => ({ ...p, discountPercent: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">كود الكوبون (اختياري)</label>
              <input type="text" placeholder="مثال: PSYCH20" value={discountDraft.promoCode || ''}
                onChange={e => setDiscountDraft(p => ({ ...p, promoCode: e.target.value.toUpperCase() }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">اسم/وصف الخصم</label>
              <input type="text" placeholder="مثال: خصم العيد" value={discountDraft.label || ''}
                onChange={e => setDiscountDraft(p => ({ ...p, label: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الانتهاء (اختياري)</label>
              <input type="date" value={discountDraft.expiresAt || ''}
                onChange={e => setDiscountDraft(p => ({ ...p, expiresAt: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={discountDraft.active} onChange={e => setDiscountDraft(p => ({ ...p, active: e.target.checked }))} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-gray-700">نشط الآن</span>
              </label>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={saveDiscount} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition">
              {editingDiscountId ? 'حفظ التعديل' : 'إضافة الكوبون'}
            </button>
            {editingDiscountId && (
              <button onClick={cancelEdit} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-bold transition">إلغاء</button>
            )}
          </div>
        </div>

        {/* Discounts List */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4">قائمة الكوبونات ({discounts.length})</h3>
          {discounts.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-5xl mb-3">🎫</div>
              <p className="font-medium">لا يوجد كوبونات بعد</p>
              <p className="text-sm mt-1">استخدم الفورم أعلاه لإضافة أول كوبون خصم</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-100 text-gray-500 text-right">
                    <th className="pb-3 font-semibold">الوصف</th>
                    <th className="pb-3 font-semibold">الكود</th>
                    <th className="pb-3 font-semibold">النوع</th>
                    <th className="pb-3 font-semibold">الخصم</th>
                    <th className="pb-3 font-semibold">الانتهاء</th>
                    <th className="pb-3 font-semibold">الحالة</th>
                    <th className="pb-3 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {discounts.map(d => {
                    const isExpired = d.expiresAt && d.expiresAt < new Date().toISOString().slice(0,10);
                    const targetName = d.type === 'course' ? (courses.find(c => c.id === d.targetId)?.title || d.targetId) :
                      d.type === 'bundle' ? (bundles.find(b => b.id === d.targetId)?.title || d.targetId) :
                      d.type === 'therapist_consultation' ? (therapists.find(t => t.id === d.targetId)?.name || d.targetId) : '';
                    return (
                      <tr key={d.id} className={`border-b border-gray-50 hover:bg-gray-50 transition ${editingDiscountId === d.id ? 'bg-emerald-50' : ''}`}>
                        <td className="py-3 font-medium text-gray-800">{d.label || '—'}{targetName && <span className="block text-xs text-gray-400">{targetName}</span>}</td>
                        <td className="py-3"><span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs font-bold">{d.promoCode || '—'}</span></td>
                        <td className="py-3 text-gray-600 text-xs">{typeLabel[d.type] || d.type}</td>
                        <td className="py-3"><span className="bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-lg text-sm">{d.discountPercent}%</span></td>
                        <td className="py-3 text-xs text-gray-500">{d.expiresAt || 'بلا تاريخ'}</td>
                        <td className="py-3">
                          {isExpired ? (
                            <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-lg font-medium">منتهي</span>
                          ) : d.active ? (
                            <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-lg font-medium">نشط</span>
                          ) : (
                            <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-lg font-medium">موقف</span>
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <button onClick={() => startEdit(d)} className="px-3 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition">تعديل</button>
                            <button onClick={() => updateDiscount({ ...d, active: !d.active })}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${d.active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                              {d.active ? 'وقف' : 'تفعيل'}
                            </button>
                            <button onClick={() => { if (window.confirm('حذف هذا الكوبون؟')) deleteDiscount(d.id); }}
                              className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-bold transition">حذف</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── New Promo Codes Section (Backend DB) ── */}
        <div className="bg-white border border-purple-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">🎟️ كوبونات الدفع (مع تتبع الاستخدام)</h3>
            <button
              onClick={() => setPromoFormOpen(o => !o)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold transition"
            >
              <Plus size={15} /> إضافة كوبون
            </button>
          </div>

          {promoFormOpen && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4">
              <h4 className="font-bold text-gray-700 mb-3 text-sm">➕ كوبون جديد</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">كود الكوبون *</label>
                  <input type="text" value={promoForm.code} onChange={e => setPromoForm(p => ({ ...p, code: e.target.value.toUpperCase().replace(/\s/g,'') }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder="PSYCH20" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">نوع الخصم</label>
                  <select value={promoForm.discount_type} onChange={e => setPromoForm(p => ({ ...p, discount_type: e.target.value as 'percent' | 'fixed' }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
                    <option value="percent">نسبة مئوية %</option>
                    <option value="fixed">مبلغ ثابت</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">قيمة الخصم *</label>
                  <input type="number" min={1} value={promoForm.discount_value} onChange={e => setPromoForm(p => ({ ...p, discount_value: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">الحد الأدنى للطلب (EGP)</label>
                  <input type="number" min={0} value={promoForm.min_order_amount} onChange={e => setPromoForm(p => ({ ...p, min_order_amount: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">أقصى استخدام (فارغ = بلا حد)</label>
                  <input type="number" min={1} value={promoForm.max_uses} onChange={e => setPromoForm(p => ({ ...p, max_uses: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder="بلا حد" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">تاريخ الانتهاء (اختياري)</label>
                  <input type="date" value={promoForm.expires_at} onChange={e => setPromoForm(p => ({ ...p, expires_at: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={async () => {
                    if (!promoForm.code.trim()) { notify('error', 'كود الكوبون مطلوب'); return; }
                    try {
                      await mysqlAdmin.createPromoCode({ code: promoForm.code, discount_type: promoForm.discount_type, discount_value: promoForm.discount_value, min_order_amount: promoForm.min_order_amount, max_uses: promoForm.max_uses ? Number(promoForm.max_uses) : null, expires_at: promoForm.expires_at || null } as Record<string, unknown>);
                      notify('success', 'تم إنشاء الكوبون');
                      setPromoForm({ code: '', discount_type: 'percent', discount_value: 10, min_order_amount: 0, max_uses: '', expires_at: '' });
                      setPromoFormOpen(false);
                      loadPromoCodes();
                    } catch (err) { notify('error', err instanceof Error ? err.message : 'خطأ في الإنشاء'); }
                  }}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold transition"
                >
                  حفظ الكوبون
                </button>
                <button onClick={() => setPromoFormOpen(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm">إلغاء</button>
              </div>
            </div>
          )}

          {promoLoading ? (
            <div className="text-center py-8 text-gray-400">جارٍ التحميل...</div>
          ) : promoCodes.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <div className="text-4xl mb-2">🎟️</div>
              <p>لا توجد كوبونات دفع بعد</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-100 text-gray-500 text-right">
                    <th className="pb-3 font-semibold">الكود</th>
                    <th className="pb-3 font-semibold">الخصم</th>
                    <th className="pb-3 font-semibold">الحد الأدنى</th>
                    <th className="pb-3 font-semibold">الاستخدام</th>
                    <th className="pb-3 font-semibold">الانتهاء</th>
                    <th className="pb-3 font-semibold">الحالة</th>
                    <th className="pb-3 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {promoCodes.map(pc => {
                    const isExpired = pc.expires_at && pc.expires_at < new Date().toISOString().slice(0, 10);
                    const isFull = pc.max_uses != null && pc.used_count >= pc.max_uses;
                    return (
                      <tr key={pc.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                        <td className="py-3">
                          <span className="font-mono bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold text-xs">{pc.code}</span>
                        </td>
                        <td className="py-3 font-bold text-purple-700">
                          {pc.discount_value}{pc.discount_type === 'percent' ? '%' : ' EGP'}
                        </td>
                        <td className="py-3 text-xs text-gray-500">{pc.min_order_amount > 0 ? `${pc.min_order_amount} EGP` : '—'}</td>
                        <td className="py-3 text-xs">
                          <span className={isFull ? 'text-red-600 font-bold' : 'text-gray-600'}>
                            {pc.used_count} / {pc.max_uses ?? '∞'}
                          </span>
                        </td>
                        <td className="py-3 text-xs text-gray-500">{pc.expires_at ?? '—'}</td>
                        <td className="py-3">
                          {isExpired || isFull ? (
                            <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-lg font-medium">{isFull ? 'مكتمل' : 'منتهي'}</span>
                          ) : pc.active ? (
                            <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-lg font-medium">نشط</span>
                          ) : (
                            <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-lg font-medium">موقف</span>
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                try {
                                  await mysqlAdmin.updatePromoCode(pc.id, { active: pc.active ? 0 : 1 } as Record<string, unknown>);
                                  loadPromoCodes();
                                } catch (err) { notify('error', err instanceof Error ? err.message : 'خطأ'); }
                              }}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${pc.active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                            >
                              {pc.active ? 'وقف' : 'تفعيل'}
                            </button>
                            <button
                              onClick={async () => {
                                if (!window.confirm(`حذف الكوبون ${pc.code}؟`)) return;
                                try {
                                  await mysqlAdmin.deletePromoCode(pc.id);
                                  notify('success', 'تم حذف الكوبون');
                                  loadPromoCodes();
                                } catch (err) { notify('error', err instanceof Error ? err.message : 'خطأ'); }
                              }}
                              className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-bold transition"
                            >
                              حذف
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
}
