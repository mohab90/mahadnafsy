import React, { useState } from 'react';
import { UserCheck, X } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { ROLE_LABELS } from '../../../../constants/permissions';
import { useModalKeyboard } from '../../../../../shared/ui/useModalKeyboard';

/**
 * The hire form.
 *
 * "تعيين مباشر" used to send only branch_id, while POST .../applicants/:id/hire
 * reads email, password and role as well. An applicant who applied without an
 * email — or with a personal address nobody wants as the work login — therefore
 * got "حدد بريدًا إلكترونيًا صحيحًا" and no way to supply one, and there was no
 * way to set the role or the password at all. The endpoint always accepted these
 * fields; nothing was ever asking for them.
 *
 * The password is optional here on purpose. Left blank the API creates the staff
 * record without one and the person sets it through the normal reset flow, which
 * is better than a desk operator inventing passwords for other people.
 */
const ROLE_OPTIONS = Object.entries(ROLE_LABELS) as [string, string][];

interface Props {
  applicant: { id: string; name: string; email: string | null; applicant_branch: string | null; job_branch: string | null; stage: string };
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
  onClose: () => void;
  onHired: () => void;
}

const HireModal: React.FC<Props> = ({ applicant, notify, onClose, onHired }) => {
  const [email, setEmail] = useState(applicant.email || '');
  const panelRef = useModalKeyboard<HTMLFormElement>(onClose);
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('SUPPORT');
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      notify('error', 'اكتب بريدًا إلكترونيًا صحيحًا لحساب الموظف');
      return;
    }
    if (password && password.length < 8) {
      notify('error', 'كلمة المرور 8 أحرف على الأقل');
      return;
    }
    setSaving(true);
    try {
      await mysqlAdmin.hireHrApplicant(applicant.id, {
        email: trimmed,
        role,
        ...(password ? { password } : {}),
        branch_id: applicant.applicant_branch || applicant.job_branch || undefined,
      });
      notify('success', `تم إنشاء سجل ${applicant.name} كموظف — فعّله من دليل الموظفين`);
      onHired();
      onClose();
    } catch (error) {
      // The API's own message is the useful one here: it distinguishes "already
      // hired", "email already used by a staff record" and "must reach the offer
      // stage first", and each needs a different action from the desk.
      notify('error', error instanceof Error ? error.message : 'فشل التعيين');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form
        ref={panelRef}
        onClick={event => event.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-2xl"
        dir="rtl"
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
            <UserCheck size={18} className="text-emerald-600" /> تعيين {applicant.name}
          </h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        {applicant.stage !== 'offer' && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            المرشح لسه في مرحلة «{applicant.stage}». التعيين بيتطلب مرحلة «عرض وظيفي» الأول — انقله بزرار «عرض وظيفي».
          </p>
        )}

        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">بريد الدخول *</label>
          <input
            required type="email" dir="ltr" value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="name@mahadnafsy.com"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-gray-400">ده اللي الموظف هيسجّل دخوله بيه. ممكن يكون غير البريد اللي قدّم بيه.</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">الوظيفة / الصلاحية *</label>
          <select
            value={role} onChange={event => setRole(event.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            {ROLE_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">كلمة المرور (اختياري)</label>
          <input
            type="password" dir="ltr" value={password} minLength={8}
            onChange={event => setPassword(event.target.value)}
            placeholder="اتركها فاضية والموظف يعملها بنفسه"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-gray-400">
            الأفضل تسيبها فاضية — الموظف يعمل كلمة المرور بنفسه من «نسيت كلمة المرور».
          </p>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="submit" disabled={saving}
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'جارٍ التعيين...' : 'تعيين'}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200">
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );
};

export default HireModal;
