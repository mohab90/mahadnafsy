// The server's signing secrets, on the system card.
//
// The API refuses to start once they are more than 370 days old, and the dates
// in the systemd unit are 2026-08-03 — so about 2027-08-08 the next restart
// would have taken the site down, and the first anyone would have heard of it
// was the site being down. From day 330 this turns amber; past 370 red, because
// the server is only still up until it next restarts. Dates only, never a key.
//
// Renders nothing for an account that cannot read it (the route is admin-only)
// and nothing on a machine with no rotation dates set.

import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { mysqlAdmin } from '../lib/mysqlapi';

type SecretFamily = {
  key: string;
  label: string;
  state: 'ok' | 'due' | 'expired' | 'unset';
  rotatedAt: string | null;
  ageDays: number | null;
  daysLeft: number | null;
  refusesBootAfter: string | null;
};

type RotationStatus = {
  state: 'ok' | 'due' | 'expired' | 'unset';
  warning: boolean;
  warnFromDays: number;
  refuseAfterDays: number;
  sealedDataKey: 'own' | 'jwt-fallback';
  secrets: SecretFamily[];
};

const TONE = {
  ok: 'bg-white border-gray-100 text-gray-700',
  due: 'bg-amber-50 border-amber-200 text-amber-900',
  expired: 'bg-red-50 border-red-200 text-red-900',
} as const;

export default function SecretRotationCard() {
  const [status, setStatus] = useState<RotationStatus | null>(null);

  useEffect(() => {
    let alive = true;
    mysqlAdmin.adminGet<RotationStatus>('/admin/system/secret-rotation')
      .then(result => { if (alive) setStatus(result); })
      .catch(() => { /* not an admin: the card is not theirs to see */ });
    return () => { alive = false; };
  }, []);

  if (!status || status.state === 'unset') return null;
  const tone = TONE[status.state];
  const dated = status.secrets.filter(item => item.state !== 'unset');

  return (
    <div className={`rounded-xl border p-4 ${tone}`} dir="rtl">
      <div className="flex items-center gap-2 font-bold text-sm">
        <KeyRound size={16} />
        {status.state === 'expired' && 'مفاتيح التشفير انتهت — أي ريستارت للسيرفر الموقع مش هيقوم'}
        {status.state === 'due' && 'مفاتيح التشفير محتاجة تتغير قريب'}
        {status.state === 'ok' && 'مفاتيح التشفير'}
      </div>
      <ul className="mt-2 space-y-1 text-xs">
        {dated.map(item => (
          <li key={item.key}>
            {item.label}: اتغيرت {item.rotatedAt} (من {item.ageDays} يوم)
            {item.state === 'expired'
              ? ' — عدّت الـ ' + status.refuseAfterDays + ' يوم'
              : ` — فاضل ${item.daysLeft} يوم، آخر يوم ${item.refusesBootAfter}`}
          </li>
        ))}
      </ul>
      {status.warning && (
        <p className="mt-2 text-xs">
          السيرفر بيرفض يشتغل بعد {status.refuseAfterDays} يوم من آخر تغيير. خطوات التغيير مكتوبة في ملف
          {' '}<span className="font-mono">deploy/systemd/mahad-api.service</span> — ابعتها للمسؤول التقني.
        </p>
      )}
      <p className="mt-1 text-[11px] opacity-80">
        {status.sealedDataKey === 'own'
          ? 'مفتاح التخزين المشفّر مستقل — تغيير المفاتيح مش هيأثر على التحقق الثنائي'
          : 'تنبيه: مفتاح التخزين المشفّر مأخوذ من JWT_SECRET — لازم يتفصل قبل تغيير المفاتيح وإلا التحقق الثنائي هيقف لكل الموظفين'}
      </p>
    </div>
  );
}
