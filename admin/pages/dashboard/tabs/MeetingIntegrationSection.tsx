import { useEffect, useState } from 'react';
import { CheckCircle2, PlugZap, Video } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { arabicReason } from '../../../lib/apiErrorText';

type Status = {
  provider: 'zoom' | 'google_meet' | null; configured: boolean; updatedAt: string | null;
  zoom: { accountId: string; clientId: string; hasSecret: boolean; hostUser: string };
  google: { delegatedUser: string; serviceAccountReady: boolean; serviceAccountEmail: string };
};
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const box = 'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm';
const label = 'mb-1 block text-xs font-bold text-gray-600';

/**
 * «السيستم يربط API بزوم أو جوجل ميت … يبقى أساسي ميبقاش كل محاضر يختار هو»: the one video account of the institute. Once it is saved,
 * every live and every consultation gets its room from the system; the lecturer only presses «ابدأ».
 */
export function MeetingIntegrationSection({ notify }: { notify: NotifyFn }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState<'zoom' | 'google_meet'>('zoom');
  const [zoom, setZoom] = useState({ accountId: '', clientId: '', clientSecret: '', hostUser: '' });
  const [delegatedUser, setDelegatedUser] = useState('');
  const [busy, setBusy] = useState('');

  const apply = (next: Status) => {
    setStatus(next);
    if (next.provider) setProvider(next.provider);
    setZoom(current => ({ ...current, accountId: next.zoom.accountId, clientId: next.zoom.clientId, hostUser: next.zoom.hostUser, clientSecret: '' }));
    setDelegatedUser(next.google.delegatedUser);
  };

  useEffect(() => {
    mysqlAdmin.adminGet<Status>('/admin/meeting-integration').then(apply).catch(error => notify('error', arabicReason(error, 'تعذّر تحميل إعدادات الربط')));
    // Loaded once, when the section opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    setBusy('save');
    try {
      apply(await mysqlAdmin.adminPut<Status>('/admin/meeting-integration', { provider, zoom, google: { delegatedUser } }));
      notify('success', 'اتحفظ الربط');
    } catch (error) { notify('error', arabicReason(error, 'تعذّر حفظ الربط')); } finally { setBusy(''); }
  };

  const test = async () => {
    setBusy('test');
    try {
      await mysqlAdmin.adminPost('/admin/meeting-integration/test', {});
      notify('success', 'الربط شغال — اتعمل اجتماع تجربة واتمسح.');
    } catch (error) { notify('error', arabicReason(error, 'الربط مش شغال')); } finally { setBusy(''); }
  };

  if (!status) return <p className="py-10 text-center text-sm text-gray-400">جاري التحميل…</p>;
  return (
    <div className="space-y-5" dir="rtl">
      <div className={`flex items-center gap-3 rounded-2xl border p-4 ${status.configured ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        {status.configured ? <CheckCircle2 className="text-emerald-600" /> : <PlugZap className="text-amber-600" />}
        <div className="text-sm">
          <p className="font-extrabold text-gray-900">{status.configured ? `الربط شغال مع ${status.provider === 'zoom' ? 'Zoom' : 'Google Meet'}` : 'الربط لسه مش مفعّل'}</p>
          <p className="text-xs text-gray-600">
            {status.configured
              ? 'غرف اللايفات والاستشارات بيعملها السيستم لوحده، والمحاضر مبيكتبش رابط ولا بيختار منصة.'
              : 'لحد ما تفعّله، المحاضر لسه بيكتب رابط اللايف بإيده.'}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {([['zoom', 'Zoom', 'اجتماعات Zoom باسم حساب المعهد'], ['google_meet', 'Google Meet', 'غرفة Meet من Google Calendar']] as const).map(([key, title, hint]) => (
          <button key={key} type="button" onClick={() => setProvider(key)}
            className={`rounded-2xl border p-4 text-right transition ${provider === key ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <p className="flex items-center gap-2 font-extrabold text-gray-900"><Video size={16} /> {title}</p>
            <p className="text-xs text-gray-500">{hint}</p>
          </button>
        ))}
      </div>

      {provider === 'zoom' ? (
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-600">
            من <b dir="ltr">marketplace.zoom.us</b> اعمل تطبيق «Server-to-Server OAuth» وفعّل له صلاحيات <b dir="ltr">meeting:write:admin</b> و<b dir="ltr">meeting:delete:admin</b>، وانسخ المفاتيح التلاتة هنا.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className={label}>Account ID</label><input dir="ltr" className={box} value={zoom.accountId} onChange={e => setZoom({ ...zoom, accountId: e.target.value })} /></div>
            <div><label className={label}>Client ID</label><input dir="ltr" className={box} value={zoom.clientId} onChange={e => setZoom({ ...zoom, clientId: e.target.value })} /></div>
            <div>
              <label className={label}>Client Secret {status.zoom.hasSecret && <span className="font-normal text-emerald-700">(محفوظ — سيبه فاضي عشان يفضل زي ما هو)</span>}</label>
              <input dir="ltr" type="password" autoComplete="off" className={box} value={zoom.clientSecret} onChange={e => setZoom({ ...zoom, clientSecret: e.target.value })} />
            </div>
            <div><label className={label}>إيميل صاحب الاجتماعات (اختياري)</label><input dir="ltr" className={box} value={zoom.hostUser} onChange={e => setZoom({ ...zoom, hostUser: e.target.value })} placeholder="لو فاضي بيستخدم صاحب الحساب" /></div>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-600">
            Google Meet بيشتغل من نفس الـ service account بتاع جوجل درايف (<b dir="ltr">GOOGLE_SERVICE_ACCOUNT_EMAIL</b> و<b dir="ltr">GOOGLE_PRIVATE_KEY</b> على السيرفر).
            لازم من لوحة Google Workspace تدّيله «Domain-wide delegation» بصلاحية <b dir="ltr">https://www.googleapis.com/auth/calendar.events</b>، وتكتب هنا إيميل المستخدم اللي الاجتماعات بتتعمل باسمه.
          </p>
          <p className={`text-xs font-bold ${status.google.serviceAccountReady ? 'text-emerald-700' : 'text-red-600'}`}>
            {status.google.serviceAccountReady ? `الـ service account جاهز على السيرفر: ${status.google.serviceAccountEmail}` : 'الـ service account مش متظبط على السيرفر لسه — اطلب من المطوّر يضيف المفاتيح.'}
          </p>
          <div><label className={label}>إيميل مستخدم Workspace</label><input dir="ltr" className={box} value={delegatedUser} onChange={e => setDelegatedUser(e.target.value)} placeholder="meetings@your-institute.com" /></div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy === 'save'} onClick={() => void save()} className="rounded-xl bg-primary-600 px-5 py-2 text-sm font-bold text-white hover:bg-primary-700 disabled:opacity-50">{busy === 'save' ? '⏳…' : 'حفظ الربط'}</button>
        <button type="button" disabled={busy === 'test' || !status.configured} onClick={() => void test()} className="rounded-xl border border-primary-300 bg-white px-5 py-2 text-sm font-bold text-primary-700 hover:bg-primary-50 disabled:opacity-50">{busy === 'test' ? '⏳…' : 'جرّب الربط'}</button>
      </div>
    </div>
  );
}
