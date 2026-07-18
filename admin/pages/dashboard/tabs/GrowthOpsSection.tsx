import React, { useEffect, useState } from 'react';
import { Bell, Boxes, CheckCircle, DoorOpen, Loader2, QrCode, Route, Send, ShoppingCart, Zap } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export const GrowthOpsSection: React.FC<{ notify: NotifyFn }> = ({ notify }) => {
  const [pushEnabled, setPushEnabled] = useState<boolean | null>(null);
  const [checkoutHours, setCheckoutHours] = useState('24');
  const [checkoutLimit, setCheckoutLimit] = useState('100');
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string>('');
  const [classroomName, setClassroomName] = useState('');
  const [classroomId, setClassroomId] = useState('');
  const [bookingStart, setBookingStart] = useState('');
  const [bookingEnd, setBookingEnd] = useState('');
  const [checkinCode, setCheckinCode] = useState('');
  const [inventoryItemName, setInventoryItemName] = useState('');
  const [inventoryItemId, setInventoryItemId] = useState('');
  const [inventoryQty, setInventoryQty] = useState('1');

  useEffect(() => {
    mysqlAdmin.getPushPublicKey()
      .then(r => setPushEnabled(!!r.enabled))
      .catch(() => setPushEnabled(false));
  }, []);

  const runCheckout = async () => {
    setBusy('checkout');
    try {
      const result = await mysqlAdmin.runAbandonedCheckout(Number(checkoutHours), Number(checkoutLimit));
      const text = `تم الفحص: ${result.scanned} | أُرسل: ${result.sent} | فشل: ${result.failed} | تخطى: ${result.skipped}`;
      setLastResult(text);
      notify('success', text);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل تشغيل التذكيرات');
    } finally {
      setBusy(null);
    }
  };

  const runSmartRoute = async () => {
    setBusy('route');
    try {
      const result = await mysqlAdmin.smartRouteLeads('unassigned', 200);
      const text = `تم توزيع ${result.assigned || 0} ليد على ${result.reps || 0} موظف`;
      setLastResult(text);
      notify('success', text);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل التوزيع الذكي');
    } finally {
      setBusy(null);
    }
  };

  const saveClassroom = async () => {
    setBusy('classroom');
    try {
      const result = await mysqlAdmin.saveDokkiClassroom({ name: classroomName, capacity: 20, branch_id: 'branch-daqqi' });
      setClassroomId(result.id || '');
      notify('success', 'تم حفظ القاعة');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل حفظ القاعة');
    } finally {
      setBusy(null);
    }
  };

  const bookClassroom = async () => {
    setBusy('booking');
    try {
      await mysqlAdmin.bookDokkiClassroom({ classroom_id: classroomId, start_time: bookingStart, end_time: bookingEnd, purpose: 'حجز إداري' });
      notify('success', 'تم حجز القاعة');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل حجز القاعة');
    } finally {
      setBusy(null);
    }
  };

  const runCheckin = async () => {
    setBusy('checkin');
    try {
      await mysqlAdmin.checkinDokkiStudent(checkinCode);
      notify('success', 'تم تسجيل الحضور');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل تسجيل الحضور');
    } finally {
      setBusy(null);
    }
  };

  const saveInventory = async () => {
    setBusy('inventory');
    try {
      const result = inventoryItemId
        ? await mysqlAdmin.postDokkiInventoryTransaction({ item_id: inventoryItemId, type: 'IN', quantity: Number(inventoryQty), reason: 'إضافة من لوحة النمو' })
        : await mysqlAdmin.saveDokkiInventoryItem({ name: inventoryItemName, stock_quantity: Number(inventoryQty), branch_id: 'branch-daqqi' });
      if ('id' in result && !inventoryItemId) setInventoryItemId(String(result.id));
      notify('success', inventoryItemId ? 'تم تسجيل حركة المخزون' : 'تم إنشاء الصنف');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل حفظ المخزون');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-indigo-700 to-violet-700 p-5 text-white">
        <h3 className="flex items-center gap-2 text-lg font-bold"><Zap size={20} /> أدوات النمو والأتمتة</h3>
        <p className="mt-1 text-sm text-indigo-100">تشغيل مميزات V30 المصححة داخل V26: تذكيرات checkout، التوزيع الذكي، وإعداد Push.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl bg-amber-50 p-2 text-amber-700"><ShoppingCart size={18} /></div>
            <div>
              <h4 className="text-sm font-extrabold text-gray-800">تذكير الطلبات غير المكتملة</h4>
              <p className="text-xs text-gray-400">WhatsApp للطلبات pending</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={checkoutHours} onChange={e => setCheckoutHours(e.target.value)} type="number" min={1} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="الساعات" />
            <input value={checkoutLimit} onChange={e => setCheckoutLimit(e.target.value)} type="number" min={1} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="الحد" />
          </div>
          <button onClick={runCheckout} disabled={busy === 'checkout'} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy === 'checkout' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            تشغيل الآن
          </button>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Route size={18} /></div>
            <div>
              <h4 className="text-sm font-extrabold text-gray-800">التوزيع الذكي لليدات</h4>
              <p className="text-xs text-gray-400">توزيع غير المسند حسب أقل حمل</p>
            </div>
          </div>
          <button onClick={runSmartRoute} disabled={busy === 'route'} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy === 'route' ? <Loader2 size={15} className="animate-spin" /> : <Route size={15} />}
            توزيع غير المسند
          </button>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-700"><Bell size={18} /></div>
            <div>
              <h4 className="text-sm font-extrabold text-gray-800">Web Push</h4>
              <p className="text-xs text-gray-400">يتطلب VAPID keys في البيئة</p>
            </div>
          </div>
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold ${pushEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
            <CheckCircle size={15} />
            {pushEnabled === null ? 'جاري الفحص...' : pushEnabled ? 'مفعل' : 'غير مفعل'}
          </div>
        </div>
      </div>

      {lastResult && <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm font-bold text-indigo-700">{lastResult}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h4 className="mb-4 flex items-center gap-2 text-sm font-extrabold text-gray-800"><DoorOpen size={18} /> تشغيل الدقي الحضوري</h4>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-2 rounded-xl border border-gray-100 p-3">
            <p className="text-xs font-bold text-gray-500">القاعات والحجز</p>
            <input value={classroomName} onChange={e => setClassroomName(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="اسم القاعة" />
            <button onClick={saveClassroom} disabled={!classroomName || busy === 'classroom'} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {busy === 'classroom' ? <Loader2 size={14} className="animate-spin" /> : <DoorOpen size={14} />} حفظ قاعة
            </button>
            <input value={classroomId} onChange={e => setClassroomId(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="ID القاعة" />
            <input value={bookingStart} onChange={e => setBookingStart(e.target.value)} type="datetime-local" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <input value={bookingEnd} onChange={e => setBookingEnd(e.target.value)} type="datetime-local" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <button onClick={bookClassroom} disabled={!classroomId || !bookingStart || !bookingEnd || busy === 'booking'} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {busy === 'booking' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} حجز القاعة
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-gray-100 p-3">
            <p className="text-xs font-bold text-gray-500">تسجيل حضور QR</p>
            <input value={checkinCode} onChange={e => setCheckinCode(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="كود العميل / الإيميل / ID" />
            <button onClick={runCheckin} disabled={!checkinCode || busy === 'checkin'} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {busy === 'checkin' ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />} تسجيل حضور
            </button>
          </div>

          <div className="space-y-2 rounded-xl border border-gray-100 p-3">
            <p className="text-xs font-bold text-gray-500">المخزون</p>
            <input value={inventoryItemName} onChange={e => setInventoryItemName(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="اسم الصنف الجديد" />
            <input value={inventoryItemId} onChange={e => setInventoryItemId(e.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="ID صنف موجود للإضافة" />
            <input value={inventoryQty} onChange={e => setInventoryQty(e.target.value)} type="number" min={1} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="الكمية" />
            <button onClick={saveInventory} disabled={(!inventoryItemName && !inventoryItemId) || busy === 'inventory'} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              {busy === 'inventory' ? <Loader2 size={14} className="animate-spin" /> : <Boxes size={14} />} حفظ المخزون
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
