import React from 'react';
import { Edit2, Eye } from 'lucide-react';
import { BranchType, LeadItem, StaffMember, SubscriberItem, Course, Bundle } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

export type SubDraft = {
  name: string; email: string; phone: string;
  branch: BranchType | undefined;
  expectedEGP: string; expectedSAR: string; expectedUSD: string;
  assignedSalesId: string; assignedSalesName: string;
  assignedCsId: string; assignedCsName: string;
  discount: string;
};
type Msg = { type: 'success' | 'error'; text: string } | null;

interface Props {
  isSub: boolean;
  subscriber?: SubscriberItem;
  lead?: LeadItem;
  subDraft: SubDraft;
  setSubDraft: React.Dispatch<React.SetStateAction<SubDraft>>;
  leadDraft: LeadItem;
  setLeadDraft: React.Dispatch<React.SetStateAction<LeadItem>>;
  branchLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  salesStaffList: StaffMember[];
  csStaffList: StaffMember[];
  courses: Course[];
  bundles: Bundle[];
  isAdmin: boolean;
  isOnlineManager: boolean;
  currentPassword: string | null;
  currentPasswordLoading: boolean;
  showCurrentPassword: boolean;
  setShowCurrentPassword: React.Dispatch<React.SetStateAction<boolean>>;
  credNewPassword: string;
  setCredNewPassword: React.Dispatch<React.SetStateAction<string>>;
  showNewPassword: boolean;
  setShowNewPassword: React.Dispatch<React.SetStateAction<boolean>>;
  credMsg: Msg;
  setCredMsg: React.Dispatch<React.SetStateAction<Msg>>;
  clientEmail: string;
  accountDiag: Record<string, unknown> | null;
  setAccountDiag: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  accountDiagLoading: boolean;
  setAccountDiagLoading: React.Dispatch<React.SetStateAction<boolean>>;
  createAccMsg: Msg;
  setCreateAccMsg: React.Dispatch<React.SetStateAction<Msg>>;
  createAccLoading: boolean;
  setCreateAccLoading: React.Dispatch<React.SetStateAction<boolean>>;
  isSaving: boolean;
  onSaveSub: () => void;
  onSaveLead: () => void;
}

/** Edit client (subscriber or lead) details + credentials/account tools.
 *  Extracted from UnifiedClientPage. */
export default function EditClientTab(p: Props) {
  const {
    isSub, subscriber, lead, subDraft, setSubDraft, leadDraft, setLeadDraft,
    branchLabels, statusLabels, salesStaffList, csStaffList, courses, bundles,
    isAdmin, isOnlineManager, currentPassword, currentPasswordLoading,
    showCurrentPassword, setShowCurrentPassword, credNewPassword, setCredNewPassword,
    showNewPassword, setShowNewPassword, credMsg, setCredMsg, clientEmail, accountDiag, setAccountDiag,
    accountDiagLoading, setAccountDiagLoading, createAccMsg, setCreateAccMsg,
    createAccLoading, setCreateAccLoading, isSaving, onSaveSub, onSaveLead,
  } = p;
  return (
    <div id="section-edit" className="space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-1 h-5 rounded-full bg-gray-400 flex-shrink-0" />
        <h3 className="font-extrabold text-gray-800 text-sm flex items-center gap-2 flex-1">
          <Edit2 size={14} className="text-gray-500" /> تعديل بيانات العميل
        </h3>
      </div>
      {isSub ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label className="text-xs text-gray-600 mb-1 block">الاسم</label>
            <input value={subDraft.name} onChange={e => setSubDraft({ ...subDraft, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="text-xs text-gray-600 mb-1 block">الهاتف</label>
            <input value={subDraft.phone} onChange={e => setSubDraft({ ...subDraft, phone: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="text-xs text-gray-600 mb-1 block">البريد الإلكتروني</label>
            <input value={subDraft.email} onChange={e => setSubDraft({ ...subDraft, email: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            <p className="text-[10px] text-amber-600 mt-0.5">⚠️ تغيير الإيميل سيُحدّث بيانات الدخول أيضاً</p>
          </div>
          <div><label className="text-xs text-gray-600 mb-1 block">الفرع</label>
            <select value={subDraft.branch || ''} onChange={e => setSubDraft({ ...subDraft, branch: (e.target.value as BranchType) || undefined })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">— الفرع —</option>
              {Object.entries(branchLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">🧑‍💼 السيلز / المبيعات</label>
            <select value={subDraft.assignedSalesId} onChange={e => { const s = salesStaffList.find((x: StaffMember) => x.id === e.target.value); setSubDraft({ ...subDraft, assignedSalesId: e.target.value, assignedSalesName: s?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">— بدون تحديد —</option>
              {salesStaffList.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">🎧 خدمة العملاء</label>
            <select value={subDraft.assignedCsId} onChange={e => { const s = csStaffList.find((x: StaffMember) => x.id === e.target.value); setSubDraft({ ...subDraft, assignedCsId: e.target.value, assignedCsName: s?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">— بدون تحديد —</option>
              {csStaffList.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">الخصم (ج.م)</label>
            <input type="number" min="0" value={subDraft.discount} onChange={e => setSubDraft({ ...subDraft, discount: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div className="sm:col-span-2">
            <p className="text-xs font-bold text-gray-600 mb-2">💰 المبالغ المتوقعة</p>
            <div className="grid grid-cols-3 gap-2">
              {[['expectedEGP', 'ج.م'], ['expectedSAR', 'ر.س'], ['expectedUSD', '$']].map(([f, l]) => (
                <div key={f}><label className="text-[10px] text-gray-400 block mb-0.5">{l}</label>
                  <input type="number" min="0" value={(subDraft as unknown as Record<string, string>)[f]} onChange={e => setSubDraft({ ...subDraft, [f]: e.target.value })} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
              ))}
            </div>
          </div>
          {/* ── Credentials Section (admin + online manager) ── */}
          {(isAdmin || isOnlineManager) && (
          <div className="sm:col-span-2 border border-dashed border-indigo-200 rounded-xl p-4 bg-indigo-50/40">
            <p className="text-xs font-bold text-indigo-700 mb-3 flex items-center gap-1.5">🔐 بيانات الدخول</p>
            <div className="grid grid-cols-1 gap-3">
              {/* Current password display */}
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
                    onClick={() => setShowCurrentPassword(prev => !prev)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-indigo-600 p-1">
                    <Eye size={14} />
                  </button>
                </div>
              </div>
              {/* New password input */}
              <div>
                <label className="text-xs text-gray-600 mb-1 block">كلمة المرور الجديدة</label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="اتركه فارغاً إذا لا تريد تغييره"
                    value={credNewPassword}
                    onChange={e => setCredNewPassword(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(prev => !prev)}
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
            {/* ── Account Diagnostic ── */}
            {isAdmin && clientEmail && (
              <div className="mt-3 border-t border-indigo-100 pt-3">
                <button
                  onClick={async () => {
                    setAccountDiagLoading(true); setAccountDiag(null);
                    try { const r = await mysqlAdmin.checkAccount(clientEmail); setAccountDiag(r as Record<string, unknown>); }
                    catch (e: unknown) { setAccountDiag({ error: (e as Error).message }); }
                    finally { setAccountDiagLoading(false); }
                  }}
                  disabled={accountDiagLoading}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 disabled:opacity-50">
                  🔍 {accountDiagLoading ? 'جاري الفحص...' : 'فحص حساب العميل'}
                </button>
                {accountDiag && (
                  <div className={`mt-2 text-xs rounded-lg p-3 space-y-1 ${(accountDiag as Record<string, unknown>).error ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-white border border-indigo-100'}`}>
                    {(accountDiag as Record<string, unknown>).error
                      ? <p>{String((accountDiag as Record<string, unknown>).error)}</p>
                      : <>
                        <p className={`font-extrabold ${!(accountDiag as Record<string, unknown>).account ? 'text-red-600' : (accountDiag as Record<string, unknown>).diagnosis === 'الحساب يبدو سليماً' ? 'text-green-700' : 'text-amber-600'}`}>
                          {String((accountDiag as Record<string, unknown>).diagnosis)}
                        </p>
                        {(accountDiag as Record<string, unknown>).account && <p className="text-gray-500">حالة الحساب: is_active = {String(((accountDiag as Record<string, unknown>).account as Record<string, unknown>).is_active)} · has_password = {String(((accountDiag as Record<string, unknown>).account as Record<string, unknown>).has_password)}</p>}
                        {(accountDiag as Record<string, unknown>).lastOtp && <p className="text-gray-500">آخر OTP: نوع = {String(((accountDiag as Record<string, unknown>).lastOtp as Record<string, unknown>).type)} · مستخدم = {String(((accountDiag as Record<string, unknown>).lastOtp as Record<string, unknown>).used)}</p>}
                        {(['لا يوجد حساب بهذا البريد', 'الحساب موجود لكن غير مفعّل (is_active=0)'].includes(String((accountDiag as Record<string, unknown>).diagnosis))) && (
                          <div className="pt-1">
                            {createAccMsg && (
                              <p className={`mb-1 font-semibold ${createAccMsg.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>{createAccMsg.text}</p>
                            )}
                            <button
                              onClick={async () => {
                                if (!clientEmail) return;
                                setCreateAccLoading(true); setCreateAccMsg(null);
                                try {
                                  const r = await mysqlAdmin.createAccount({ email: clientEmail, name: subscriber?.name || lead?.name });
                                  setCreateAccMsg({ type: 'success', text: `✅ تم ${(r as Record<string, unknown>).action === 'created' ? 'إنشاء' : 'تفعيل'} الحساب وإرسال كلمة المرور للبريد` });
                                  const updated = await mysqlAdmin.checkAccount(clientEmail);
                                  setAccountDiag(updated as Record<string, unknown>);
                                } catch (e: unknown) { setCreateAccMsg({ type: 'error', text: (e as Error).message }); }
                                finally { setCreateAccLoading(false); }
                              }}
                              disabled={createAccLoading}
                              className="px-3 py-1 bg-violet-600 text-white rounded text-xs font-bold hover:bg-violet-700 disabled:opacity-50">
                              {createAccLoading ? 'جاري الإنشاء...' : (String((accountDiag as Record<string, unknown>).diagnosis).includes('غير مفعّل') ? '🔓 تفعيل الحساب وإرسال كلمة مرور جديدة' : '➕ إنشاء حساب وإرسال كلمة المرور')}
                            </button>
                          </div>
                        )}
                      </>
                    }
                  </div>
                )}
              </div>
            )}
            <p className="text-[10px] text-gray-400 mt-2">💡 إذا لم يكن للعميل حساب بعد، سيتم إنشاؤه تلقائياً عند تعيين كلمة مرور.</p>
          </div>
          )}
          <div className="sm:col-span-2 flex gap-2 pt-2">
            <button onClick={onSaveSub} disabled={isSaving} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">{isSaving ? 'جاري الحفظ...' : 'حفظ التعديلات'}</button>
            <button onClick={() => { setCredMsg(null); setCredNewPassword(''); setShowCurrentPassword(false); setShowNewPassword(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex-1 py-2 bg-gray-200 rounded-lg text-sm">إلغاء</button>
          </div>
        </div>
      ) : lead ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[['name', 'الاسم', 'text'], ['email', 'البريد الإلكتروني', 'email'], ['phone', 'رقم الهاتف', 'tel'], ['source', 'المصدر', 'text']].map(([f, l, t]) => (
            <div key={f}><label className="text-xs text-gray-600 mb-1 block">{l}</label>
              <input type={t} value={(leadDraft as unknown as Record<string, string>)[f] || ''} onChange={e => setLeadDraft({ ...leadDraft, [f]: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          ))}
          <div><label className="text-xs text-gray-600 mb-1 block">الفرع</label>
            <select value={leadDraft.branch || ''} onChange={e => setLeadDraft({ ...leadDraft, branch: e.target.value as BranchType })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">اختر الفرع</option>
              {Object.entries(branchLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">الحالة</label>
            <select value={leadDraft.status} onChange={e => setLeadDraft({ ...leadDraft, status: e.target.value as LeadItem['status'] })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">درجة الاهتمام</label>
            <select value={leadDraft.interestLevel || ''} onChange={e => setLeadDraft({ ...leadDraft, interestLevel: e.target.value as LeadItem['interestLevel'] })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">اختر</option><option value="low">منخفض</option><option value="medium">متوسط</option><option value="high">مرتفع</option>
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">🧑‍💼 السيلز المسئول</label>
            <select value={leadDraft.assignedSalesId || ''} onChange={e => { const s = salesStaffList.find((x: StaffMember) => x.id === e.target.value); setLeadDraft({ ...leadDraft, assignedSalesId: e.target.value, assignedSalesName: s?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">بدون تحديد</option>
              {salesStaffList.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">🎧 خدمة العملاء</label>
            <select value={leadDraft.assignedCsId || ''} onChange={e => { const s = csStaffList.find((x: StaffMember) => x.id === e.target.value); setLeadDraft({ ...leadDraft, assignedCsId: e.target.value, assignedCsName: s?.name || '' }); }} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">— بدون تحديد —</option>
              {csStaffList.map((s: StaffMember) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">الكورس</label>
            <select value={leadDraft.enrolledCourseId || ''} onChange={e => setLeadDraft({ ...leadDraft, enrolledCourseId: e.target.value || undefined })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="">بدون تحديد</option>
              {(() => {
                const bundledIds = new Set(bundles.flatMap(b => b.courses.map(x => x.id)));
                return (<>
                  {bundles.map(b => (
                    <optgroup key={b.id} label={`📌 ${b.title}`}>
                      {b.courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </optgroup>
                  ))}
                  <optgroup label="🎓 الكورسات الفردية">
                    {courses.filter(c => !bundledIds.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </optgroup>
                </>);
              })()}
            </select></div>
          <div><label className="text-xs text-gray-600 mb-1 block">موعد المتابعة</label>
            <input type="date" value={leadDraft.nextFollowUpDate || ''} onChange={e => setLeadDraft({ ...leadDraft, nextFollowUpDate: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div className="sm:col-span-2 flex gap-2 pt-2">
            <button onClick={onSaveLead} disabled={isSaving} className="flex-1 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">حفظ التعديلات</button>
            <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex-1 py-2 bg-gray-200 rounded-lg text-sm">إلغاء</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
