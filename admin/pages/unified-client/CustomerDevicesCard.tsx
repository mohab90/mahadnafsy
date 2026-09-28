import { useCallback, useEffect, useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';

import { cairoDateTime } from '../../../shared/cairoDate';
import { confirmDialog } from '../../../shared/ui/confirmDialog';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Device = { id: string; ip: string | null; userAgent: string | null; firstSeenAt: string; lastSeenAt: string };
type Devices = { devices: Device[]; max: number; hasAccount: boolean };

/** A short name for a device from its browser's user agent. */
function deviceName(userAgent: string | null) {
  const ua = userAgent || '';
  const system = /iPhone|iPad/.test(ua) ? 'آيفون' : /Android/.test(ua) ? 'أندرويد' : /Windows/.test(ua) ? 'ويندوز'
    : /Mac OS/.test(ua) ? 'ماك' : /Linux/.test(ua) ? 'لينكس' : 'جهاز';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${system} · ${browser}` : system;
}

/**
 * The devices the customer signs in from — two at most, the third is refused
 * (api/lib/customerDevices.js) — with each one's last IP, and «مسح الأجهزة» for
 * when they change phones.
 */
export function CustomerDevicesCard({ subscriberId }: { subscriberId: string }) {
  const [data, setData] = useState<Devices | null>(null);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => {
    setError('');
    mysqlAdmin.adminGet<Devices>(`/admin/subscribers/${encodeURIComponent(subscriberId)}/devices`)
      .then(setData)
      .catch(failure => setError(failure instanceof Error ? failure.message : 'تعذّر تحميل الأجهزة'));
  }, [subscriberId]);
  useEffect(load, [load]);

  const clear = async () => {
    if (!await confirmDialog('مسح أجهزة العميل؟ أول جهاز يدخل منه بعد كده هيتسجل من جديد.')) return;
    setClearing(true);
    try {
      await mysqlAdmin.adminDelete(`/admin/subscribers/${encodeURIComponent(subscriberId)}/devices`);
      load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'تعذّر المسح');
    } finally { setClearing(false); }
  };

  return (
    <div className="mt-3 rounded-xl border border-indigo-100 bg-white p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-extrabold text-gray-800">
          <MonitorSmartphone size={14} className="text-indigo-600" />
          الأجهزة {data ? `(${data.devices.length} من ${data.max})` : ''}
        </p>
        {!!data?.devices.length && (
          <button type="button" onClick={() => { void clear(); }} disabled={clearing}
            className="rounded-lg border border-red-200 px-2.5 py-1 font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
            {clearing ? 'جاري المسح…' : 'مسح الأجهزة'}
          </button>
        )}
      </div>
      {error && <p className="text-red-600">{error}</p>}
      {data && !data.hasAccount && <p className="text-gray-500">العميل لسه ملوش حساب دخول.</p>}
      {data?.hasAccount && data.devices.length === 0 && <p className="text-gray-500">لسه مدخلش من أي جهاز — أول جهازين يدخل منهم بيتسجلوا.</p>}
      <ul className="space-y-1.5">
        {data?.devices.map(device => (
          <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
            <span className="font-bold text-gray-700">{deviceName(device.userAgent)}</span>
            <span className="text-gray-500" dir="ltr">{device.ip || '—'}</span>
            <span className="text-gray-400">آخر دخول <span dir="ltr">{cairoDateTime(device.lastSeenAt)}</span></span>
          </li>
        ))}
      </ul>
      {data && data.devices.length >= data.max && (
        <p className="mt-2 text-amber-700">العميل وصل للحد — أي جهاز تالت بيتقفل برسالة «انت فتحت حسابك من أكتر من جهاز».</p>
      )}
    </div>
  );
}
