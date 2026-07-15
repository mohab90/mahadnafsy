import { Eye } from 'lucide-react';

import { mysqlAdmin } from '../../lib/mysqlapi';
import type { LeadItem, SubscriberItem } from '../../types';

type StatusMessage = { type: 'success' | 'error'; text: string };

interface UnifiedClientCredentialsSectionProps {
  isAdmin: boolean;
  isOnlineManager: boolean;
  clientEmail: string;
  currentPassword: string | null;
  currentPasswordLoading: boolean;
  showCurrentPassword: boolean;
  setShowCurrentPassword: React.Dispatch<React.SetStateAction<boolean>>;
  showNewPassword: boolean;
  setShowNewPassword: React.Dispatch<React.SetStateAction<boolean>>;
  credNewPassword: string;
  setCredNewPassword: React.Dispatch<React.SetStateAction<string>>;
  credMsg: StatusMessage | null;
  accountDiag: Record<string, unknown> | null;
  setAccountDiag: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  accountDiagLoading: boolean;
  setAccountDiagLoading: React.Dispatch<React.SetStateAction<boolean>>;
  createAccMsg: StatusMessage | null;
  setCreateAccMsg: React.Dispatch<React.SetStateAction<StatusMessage | null>>;
  createAccLoading: boolean;
  setCreateAccLoading: React.Dispatch<React.SetStateAction<boolean>>;
  subscriber?: SubscriberItem;
  lead?: LeadItem;
}

export function UnifiedClientCredentialsSection({
  isAdmin,
  isOnlineManager,
  clientEmail,
  currentPassword,
  currentPasswordLoading,
  showCurrentPassword,
  setShowCurrentPassword,
  showNewPassword,
  setShowNewPassword,
  credNewPassword,
  setCredNewPassword,
  credMsg,
  accountDiag,
  setAccountDiag,
  accountDiagLoading,
  setAccountDiagLoading,
  createAccMsg,
  setCreateAccMsg,
  createAccLoading,
  setCreateAccLoading,
  subscriber,
  lead,
}: UnifiedClientCredentialsSectionProps) {
  if (!(isAdmin || isOnlineManager)) return null;

  const account = accountDiag?.account as Record<string, unknown> | undefined;
  const lastOtp = accountDiag?.lastOtp as Record<string, unknown> | undefined;
  const diagnosis = String(accountDiag?.diagnosis);
  const canCreateOrActivate = ['لا يوجد حساب بهذا البريد', 'الحساب موجود لكن غير مفعّل (is_active=0)'].includes(diagnosis);

  const checkAccount = async () => {
    setAccountDiagLoading(true);
    setAccountDiag(null);
    try {
      const result = await mysqlAdmin.checkAccount(clientEmail);
      setAccountDiag(result);
    } catch (error) {
      setAccountDiag({ error: (error as Error).message });
    } finally {
      setAccountDiagLoading(false);
    }
  };

  const createOrActivateAccount = async () => {
    if (!clientEmail) return;
    setCreateAccLoading(true);
    setCreateAccMsg(null);
    try {
      const result = await mysqlAdmin.createAccount({ email: clientEmail, name: subscriber?.name || lead?.name });
      setCreateAccMsg({ type: 'success', text: `✅ تم ${(result as Record<string, unknown>).action === 'created' ? 'إنشاء' : 'تفعيل'} الحساب وإرسال كلمة المرور للبريد` });
      const updated = await mysqlAdmin.checkAccount(clientEmail);
      setAccountDiag(updated);
    } catch (error) {
      setCreateAccMsg({ type: 'error', text: (error as Error).message });
    } finally {
      setCreateAccLoading(false);
    }
  };

  return (
    <div className="sm:col-span-2 border border-dashed border-indigo-200 rounded-xl p-4 bg-indigo-50/40">
      <p className="text-xs font-bold text-indigo-700 mb-3 flex items-center gap-1.5">🔐 بيانات الدخول</p>
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="text-xs text-gray-600 mb-1 block">كلمة المرور الحالية</label>
          <div className="relative">
            <input
              type={showCurrentPassword ? 'text' : 'password'}
              readOnly
              value={currentPasswordLoading ? '...' : (currentPassword ?? '')}
              placeholder={currentPasswordLoading ? 'جاري التحميل...' : 'لا توجد كلمة مرور مسجّلة'}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700 pr-10"
            />
            <button
              type="button"
              onClick={() => setShowCurrentPassword((visible) => !visible)}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-600 p-1">
              <Eye size={14} />
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-600 mb-1 block">كلمة المرور الجديدة</label>
          <div className="relative">
            <input
              type={showNewPassword ? 'text' : 'password'}
              placeholder="اتركه فارغاً إذا لا تريد تغييره"
              value={credNewPassword}
              onChange={(event) => setCredNewPassword(event.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-10"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword((visible) => !visible)}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-600 p-1">
              <Eye size={14} />
            </button>
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">6 أحرف على الأقل</p>
        </div>
      </div>

      {credMsg && (
        <div className={`mt-2 text-xs px-3 py-2 rounded-lg ${credMsg.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {credMsg.text}
        </div>
      )}

      {isAdmin && clientEmail && (
        <div className="mt-3 border-t border-indigo-100 pt-3">
          <button
            onClick={checkAccount}
            disabled={accountDiagLoading}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 disabled:opacity-50">
            🔍 {accountDiagLoading ? 'جاري الفحص...' : 'فحص حساب العميل'}
          </button>

          {accountDiag && (
            <div className={`mt-2 text-xs rounded-lg p-3 space-y-1 ${accountDiag.error ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-white border border-indigo-100'}`}>
              {accountDiag.error ? (
                <p>{String(accountDiag.error)}</p>
              ) : (
                <>
                  <p className={`font-extrabold ${!account ? 'text-red-600' : diagnosis === 'الحساب يبدو سليماً' ? 'text-green-700' : 'text-amber-600'}`}>
                    {diagnosis}
                  </p>
                  {account && <p className="text-gray-500">حالة الحساب: is_active = {String(account.is_active)} · has_password = {String(account.has_password)}</p>}
                  {lastOtp && <p className="text-gray-500">آخر OTP: نوع = {String(lastOtp.type)} · مستخدم = {String(lastOtp.used)}</p>}
                  {canCreateOrActivate && (
                    <div className="pt-1">
                      {createAccMsg && (
                        <p className={`mb-1 font-semibold ${createAccMsg.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>{createAccMsg.text}</p>
                      )}
                      <button
                        onClick={createOrActivateAccount}
                        disabled={createAccLoading}
                        className="px-3 py-1 bg-violet-600 text-white rounded text-xs font-bold hover:bg-violet-700 disabled:opacity-50">
                        {createAccLoading ? 'جاري الإنشاء...' : (diagnosis.includes('غير مفعّل') ? '🔓 تفعيل الحساب وإرسال كلمة مرور جديدة' : '➕ إنشاء حساب وإرسال كلمة المرور')}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-gray-400 mt-2">💡 إذا لم يكن للعميل حساب بعد، سيتم إنشاؤه تلقائياً عند تعيين كلمة مرور.</p>
    </div>
  );
}
