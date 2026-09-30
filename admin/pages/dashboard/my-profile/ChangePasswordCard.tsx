import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { mysqlAuth } from '../../../lib/mysqlapi';
import { useAuth } from '../../../context/AuthContext';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

const input = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';

/**
 * The signed-in account changes its own password. The server ends every
 * session of the account when it does, this one included, so a success signs
 * out and the next sign-in uses the new password.
 */
export function ChangePasswordCard({ notify }: { notify: Notify }) {
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);

  const problem = next && next.length < 8 ? 'كلمة المرور الجديدة 8 أحرف على الأقل'
    : repeat && repeat !== next ? 'التأكيد مش زي كلمة المرور الجديدة' : '';

  const save = async () => {
    setSaving(true);
    try {
      await mysqlAuth.updatePassword(current, next);
      notify('success', 'اتغيرت كلمة المرور — ادخل تاني بالكلمة الجديدة');
      setTimeout(logout, 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      notify('error', message === 'Current password incorrect' ? 'كلمة المرور الحالية غلط' : 'تعذر تغيير كلمة المرور، حاول تاني');
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="flex items-center gap-2 font-extrabold text-gray-900"><KeyRound size={16} className="text-indigo-500" /> تغيير كلمة المرور</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">كلمة المرور الحالية</span>
          <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} className={input} /></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">الجديدة (8 أحرف على الأقل)</span>
          <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} className={input} /></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">تأكيد الجديدة</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} className={input} /></label>
      </div>
      {problem && <p className="text-xs font-bold text-red-600">{problem}</p>}
      <button type="button" onClick={() => void save()} disabled={saving || !current || !next || next !== repeat || Boolean(problem)}
        className="w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
        {saving ? 'جارٍ التغيير…' : 'تغيير كلمة المرور'}
      </button>
    </section>
  );
}
