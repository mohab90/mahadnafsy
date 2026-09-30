import { Briefcase, Crown, Settings2, Shield, UserCog } from 'lucide-react';
import type { TabKey } from '../navigation';
import { ChangePasswordCard } from './ChangePasswordCard';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

const OWNER_LINKS: { tab: TabKey; label: string; icon: typeof Crown }[] = [
  { tab: 'hr', label: 'الموظفين وصلاحياتهم', icon: UserCog },
  { tab: 'system_settings', label: 'إعدادات الإدارة', icon: Settings2 },
  { tab: 'settings_hub', label: 'مركز الإعدادات', icon: Briefcase },
  { tab: 'security_center', label: 'الأمان والصيانة', icon: Shield },
];

/**
 * «ملفي» for an account with no staff record. The owner signs in with a users
 * row and no employee file, so the employee pages had nothing to show and the
 * owner could not even change their own password.
 */
export default function OwnerProfilePage({ name, email, isOwner, notify, onNavigate }: {
  name: string; email: string; isOwner: boolean; notify: Notify; onNavigate: (tab: TabKey) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-primary-600 text-white"><Crown size={22} /></span>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-extrabold text-gray-900">{name || email}</h2>
          <p className="truncate text-sm text-gray-500" dir="ltr">{email}</p>
          {isOwner && <span className="mt-1 inline-block rounded-lg bg-primary-50 px-2 py-0.5 text-xs font-bold text-primary-700">مالك النظام — صلاحيات كاملة</span>}
        </div>
      </section>

      {isOwner ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {OWNER_LINKS.map(({ tab, label, icon: Icon }) => (
            <button key={tab} type="button" onClick={() => onNavigate(tab)}
              className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 text-sm font-bold text-gray-700 shadow-sm transition hover:border-primary-200 hover:text-primary-700">
              <Icon size={20} className="text-primary-600" /> {label}
            </button>
          ))}
        </section>
      ) : (
        <p className="rounded-2xl border border-gray-200 bg-white p-5 text-sm leading-relaxed text-gray-500">
          حسابك مش مربوط بسجل موظف، فصفحات الموظف مش ظاهرة. لو المفروض يكون مربوط، أضف السجل من الموارد البشرية ← الموظفين بنفس البريد.
        </p>
      )}

      <ChangePasswordCard notify={notify} />
    </div>
  );
}
