import { useState } from 'react';
import { Mail } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

const input = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';

/**
 * The employee changes the email they sign in with. Two steps: the new address and the current password (a code is mailed to the NEW
 * address), then the code. The server moves the login and the employee record together once the code comes back.
 */
export function ChangeEmailCard({ currentEmail, notify, onChanged }: { currentEmail: string; notify: Notify; onChanged?: (email: string) => void }) {
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);

  const fail = (error: unknown, fallback: string) => notify('error', error instanceof Error && error.message ? error.message : fallback);

  const request = async () => {
    setBusy(true);
    try {
      const result = await mysqlAdmin.requestMyEmailChange(newEmail.trim(), password);
      setSentTo(result.sentTo || newEmail.trim());
      setCode('');
      notify('success', 'بعتنا كود على الإيميل الجديد');
    } catch (error) { fail(error, 'تعذّر إرسال الكود، حاول تاني'); } finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const result = await mysqlAdmin.confirmMyEmailChange(newEmail.trim(), code.trim());
      notify('success', 'اتغيّر الإيميل — ادخل بيه من دلوقتي');
      onChanged?.(result.email);
      setNewEmail(''); setPassword(''); setCode(''); setSentTo('');
    } catch (error) { fail(error, 'الكود غلط أو منتهي'); } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-extrabold text-gray-900"><Mail size={16} className="text-indigo-500" /> تغيير الإيميل</h3>
      <p className="text-xs text-gray-500">الإيميل الحالي: <span dir="ltr" className="font-bold text-gray-700">{currentEmail}</span> — هو اللي بتدخل بيه، ومنه بيجيلك كود نسيان كلمة المرور.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">الإيميل الجديد</span>
          <input type="email" dir="ltr" autoComplete="off" value={newEmail} onChange={e => { setNewEmail(e.target.value); setSentTo(''); }} className={input} /></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">كلمة المرور الحالية</span>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={input} /></label>
      </div>
      {sentTo ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">الكود اللي وصل على {sentTo}</span>
            <input inputMode="numeric" dir="ltr" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} className={input} /></label>
          <button type="button" onClick={() => void confirm()} disabled={busy || code.length !== 6}
            className="self-end rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? 'جارٍ التأكيد…' : 'تأكيد الإيميل'}</button>
        </div>
      ) : (
        <button type="button" onClick={() => void request()} disabled={busy || !newEmail.includes('@') || !password}
          className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">{busy ? 'جارٍ الإرسال…' : 'ابعتلي كود تأكيد'}</button>
      )}
    </section>
  );
}
