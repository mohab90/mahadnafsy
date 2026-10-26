import { useEffect, useState } from 'react';
import { Copy, KeyRound, ShieldCheck, Wand2, Wallet } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { Therapist } from '../../../../types';

// «حساب المحاضر»: the account a lecturer signs in with (e-mail, phone, password), made here beside the lecturer's profile and
// linked to it, and what they are paid — the hour of a lecture and the fee of a consultation. The account is the staff login
// (POST /admin/staff-account); the pay goes through the HR rate request (api/routes/hr/compensation.js), which another person
// approves — the owner's own request is approved on the spot.

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Rates = {
  id?: string; consultation_rate_type?: string; consultation_rate_value?: number; lecture_rate_per_hour?: number | null; pay_basis?: string | null;
  lecture_rate?: number | null; lecture_hours?: number | null; revenue_share_pct?: number | null; currency?: string;
  retention_bonus_type?: string | null; retention_bonus_value?: number | null;
} | null;

const ROLES: Array<[string, string]> = [['INSTRUCTOR', 'محاضر'], ['TRAINER', 'مدرّب'], ['CONSULTANT', 'مستشار'], ['EXPERT', 'خبير']];
const box = 'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm';
const label = 'mb-1 block text-xs font-bold text-gray-600';
const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  return `${[...bytes].map(value => alphabet[value % alphabet.length]).join('')}9`;
}

export function LecturerAccountSection({ draft, setDraft, notify }: { draft: Therapist; setDraft: (next: Therapist) => void; notify: Notify }) {
  const { staffMembers, reloadStaffMembers, isAdmin } = useSiteData();
  const linked = staffMembers.find(member => member.id === draft.staffId);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('INSTRUCTOR');
  const [busy, setBusy] = useState('');
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [rates, setRates] = useState({
    pay_basis: 'per_hour', lecture_rate_per_hour: '', lecture_rate: '', lecture_hours: '2', revenue_share_pct: '',
    consultation_rate_type: 'per_session', consultation_rate_value: '', currency: 'EGP', retention_bonus_type: '', retention_bonus_value: '',
  });
  const [ratesLoaded, setRatesLoaded] = useState('');

  // What is already on file for this lecturer.
  useEffect(() => {
    if (!draft.staffId || ratesLoaded === draft.staffId) return undefined;
    let alive = true;
    mysqlAdmin.adminGet<Rates>(`/admin/hr/instructors/${draft.staffId}/rates`).then(current => {
      if (!alive) return;
      setRatesLoaded(draft.staffId || '');
      if (!current) return;
      setRates({
        pay_basis: current.pay_basis || 'revenue_share', lecture_rate_per_hour: String(current.lecture_rate_per_hour ?? ''), lecture_rate: String(current.lecture_rate ?? ''),
        lecture_hours: String(current.lecture_hours ?? '2'), revenue_share_pct: String(current.revenue_share_pct ?? ''),
        consultation_rate_type: current.consultation_rate_type || 'per_session', consultation_rate_value: String(current.consultation_rate_value ?? ''),
        currency: current.currency || 'EGP', retention_bonus_type: current.retention_bonus_type || '', retention_bonus_value: String(current.retention_bonus_value ?? ''),
      });
    }).catch(() => setRatesLoaded(draft.staffId || ''));
    return () => { alive = false; };
  }, [draft.staffId, ratesLoaded]);

  const createAccount = async () => {
    if (!draft.name.trim()) { notify('error', 'اكتب اسم المحاضر الأول.'); return; }
    setBusy('account');
    try {
      const result = await mysqlAdmin.createStaffAccount({ name: draft.name.trim(), email: email.trim(), phone: phone.trim(), password, role }) as { staffId?: string };
      if (!result.staffId) throw new Error('الحساب اتعمل بس مرجعش رقمه — حدّث الصفحة');
      await reloadStaffMembers();
      setDraft({ ...draft, staffId: result.staffId });
      setCreated({ email: email.trim().toLowerCase(), password });
      setPassword('');
      notify('success', 'اتعمل حساب الدخول — اضغط «حفظ المحاضر» عشان يتربط بملفه.');
    } catch (error) { notify('error', errorText(error, 'تعذر إنشاء الحساب')); } finally { setBusy(''); }
  };

  const changePassword = async () => {
    if (!linked) return;
    setBusy('password');
    try {
      await mysqlAdmin.createStaffAccount({ staffId: linked.id, name: linked.name, email: linked.email, phone: linked.phone || '', role: String(linked.role || 'INSTRUCTOR').toUpperCase(), password });
      setCreated({ email: String(linked.email || '').toLowerCase(), password });
      setPassword('');
      notify('success', 'اتغيرت كلمة المرور — المحاضر هيحتاج يدخل بيها من جديد.');
    } catch (error) { notify('error', errorText(error, 'تعذر تغيير كلمة المرور')); } finally { setBusy(''); }
  };

  const copyLogin = async () => {
    if (!created) return;
    const text = `بيانات الدخول لبوابة المحاضر\nالرابط: ${window.location.origin}\nالإيميل: ${created.email}\nكلمة المرور: ${created.password}`;
    try { await navigator.clipboard.writeText(text); notify('info', 'اتنسخت بيانات الدخول'); } catch { notify('error', 'تعذر النسخ — انسخها يدوي'); }
  };

  const saveRates = async () => {
    if (!draft.staffId) return;
    setBusy('rates');
    try {
      const body = {
        ...rates,
        lecture_rate_per_hour: rates.pay_basis === 'per_hour' ? rates.lecture_rate_per_hour : 0,
        lecture_rate: rates.pay_basis === 'per_lecture' ? rates.lecture_rate : null,
        lecture_hours: rates.pay_basis === 'per_hour' ? rates.lecture_hours : null,
        revenue_share_pct: rates.pay_basis === 'revenue_share' ? rates.revenue_share_pct : null,
        consultation_rate_value: rates.consultation_rate_value || 0,
        retention_bonus_type: rates.retention_bonus_type || null,
        retention_bonus_value: rates.retention_bonus_value || null,
      };
      const proposal = await mysqlAdmin.adminPut<{ id: string }>(`/admin/hr/instructors/${draft.staffId}/rates`, body);
      // The owner has no one above them to approve it; anyone else's request waits for a second person.
      if (isAdmin && proposal.id) {
        try {
          await mysqlAdmin.adminPut(`/admin/hr/instructor-rate-proposals/${proposal.id}/status`, { status: 'APPROVED' });
          notify('success', 'اتحفظت المستحقات واتعتمدت.');
        } catch { notify('info', 'اتحفظت المستحقات وفي انتظار الاعتماد من «أجور المحاضرين» في الموارد البشرية.'); }
      } else {
        notify('info', 'اتبعتت المستحقات للاعتماد من «أجور المحاضرين» في الموارد البشرية.');
      }
    } catch (error) { notify('error', errorText(error, 'تعذر حفظ المستحقات')); } finally { setBusy(''); }
  };

  const setRate = (patch: Partial<typeof rates>) => setRates(current => ({ ...current, ...patch }));

  return (
    <div className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4" dir="rtl">
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-emerald-700" />
        <h4 className="font-bold text-gray-900">حساب دخول المحاضر</h4>
        {linked && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700"><ShieldCheck size={11} className="ml-1 inline" />عنده حساب: {linked.email}</span>}
      </div>

      {!linked ? (
        <>
          <p className="text-xs text-gray-600">اكتب إيميل المحاضر ورقمه وكلمة مرور (8 حروف على الأقل) — بيدخل بيهم على لوحة المعهد ويفتح له بوابته مباشرة.</p>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div><label className={label}>الإيميل</label><input type="email" dir="ltr" className={box} value={email} onChange={e => setEmail(e.target.value)} placeholder="dr.sara@example.com" /></div>
            <div><label className={label}>رقم الموبايل / واتساب</label><input dir="ltr" className={box} value={phone} onChange={e => setPhone(e.target.value)} placeholder="01012345678" /></div>
            <div>
              <label className={label}>كلمة المرور</label>
              <div className="flex gap-1.5">
                <input dir="ltr" className={box} value={password} onChange={e => setPassword(e.target.value)} placeholder="8 حروف أو أكتر" />
                <button type="button" title="توليد كلمة مرور" onClick={() => setPassword(randomPassword())} className="rounded-xl border border-gray-300 bg-white px-2.5 text-gray-600 hover:bg-gray-50"><Wand2 size={15} /></button>
              </div>
            </div>
            <div><label className={label}>الوظيفة</label><select className={box} value={role} onChange={e => setRole(e.target.value)}>{ROLES.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>
          </div>
          <button type="button" disabled={busy === 'account' || !email.trim() || password.length < 8} onClick={() => void createAccount()}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">إنشاء حساب الدخول وربطه بالمحاضر</button>
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className={label}>تغيير كلمة المرور</label>
            <div className="flex gap-1.5">
              <input dir="ltr" className={box} value={password} onChange={e => setPassword(e.target.value)} placeholder="كلمة مرور جديدة (8 حروف على الأقل)" />
              <button type="button" title="توليد كلمة مرور" onClick={() => setPassword(randomPassword())} className="rounded-xl border border-gray-300 bg-white px-2.5 text-gray-600 hover:bg-gray-50"><Wand2 size={15} /></button>
            </div>
          </div>
          <button type="button" disabled={busy === 'password' || password.length < 8} onClick={() => void changePassword()} className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">تغيير</button>
          <p className="w-full text-[11px] text-gray-500">رقم الواتساب اللي بتوصله عليه إشعارات الاستشارات هو رقم الموبايل على ملف الموظف.</p>
        </div>
      )}

      {created && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <span className="text-amber-900">الإيميل <b dir="ltr">{created.email}</b> · كلمة المرور <b dir="ltr">{created.password}</b> — خدها دلوقتي، مش هتظهر تاني.</span>
          <button type="button" onClick={() => void copyLogin()} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-bold text-amber-900"><Copy size={12} /> نسخ</button>
        </div>
      )}

      <div className="border-t border-emerald-200 pt-4">
        <div className="mb-2 flex items-center gap-2"><Wallet size={16} className="text-emerald-700" /><h4 className="font-bold text-gray-900">مستحقات المحاضر</h4></div>
        {!draft.staffId ? <p className="text-xs text-gray-500">اعمل حساب الدخول الأول عشان تحدد مستحقاته.</p> : (
          <>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className={label}>بيتحاسب على المحاضرات إزاي</label>
                <select className={box} value={rates.pay_basis} onChange={e => setRate({ pay_basis: e.target.value })}>
                  <option value="per_hour">بالساعة</option><option value="per_lecture">مبلغ ثابت للمحاضرة</option><option value="revenue_share">نسبة من دفعات كورساته</option>
                </select>
              </div>
              {rates.pay_basis === 'per_hour' && (<>
                <div><label className={label}>سعر ساعة المحاضرة</label><input type="number" min={0} className={box} value={rates.lecture_rate_per_hour} onChange={e => setRate({ lecture_rate_per_hour: e.target.value })} /></div>
                <div><label className={label}>ساعات المحاضرة الواحدة</label><input type="number" min={0} max={24} step="0.5" className={box} value={rates.lecture_hours} onChange={e => setRate({ lecture_hours: e.target.value })} /></div>
              </>)}
              {rates.pay_basis === 'per_lecture' && <div><label className={label}>سعر المحاضرة</label><input type="number" min={0} className={box} value={rates.lecture_rate} onChange={e => setRate({ lecture_rate: e.target.value })} /></div>}
              {rates.pay_basis === 'revenue_share' && <div><label className={label}>النسبة % من الدفعات</label><input type="number" min={0} max={100} className={box} value={rates.revenue_share_pct} onChange={e => setRate({ revenue_share_pct: e.target.value })} /></div>}
              <div><label className={label}>العملة</label><select className={box} value={rates.currency} onChange={e => setRate({ currency: e.target.value })}><option value="EGP">جنيه</option><option value="SAR">ريال</option><option value="USD">دولار</option></select></div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className={label}>أجره على الاستشارة</label>
                <select className={box} value={rates.consultation_rate_type} onChange={e => setRate({ consultation_rate_type: e.target.value })}>
                  <option value="per_session">مبلغ ثابت للجلسة</option><option value="percentage">نسبة % مما دفعه العميل</option><option value="per_hour">بالساعة</option>
                </select>
              </div>
              <div><label className={label}>{rates.consultation_rate_type === 'percentage' ? 'النسبة %' : rates.consultation_rate_type === 'per_hour' ? 'سعر الساعة' : 'مبلغ الجلسة'}</label><input type="number" min={0} className={box} value={rates.consultation_rate_value} onChange={e => setRate({ consultation_rate_value: e.target.value })} /></div>
              <div>
                <label className={label}>مكافأة تدوير العميل (اختياري)</label>
                <select className={box} value={rates.retention_bonus_type} onChange={e => setRate({ retention_bonus_type: e.target.value })}><option value="">بدون</option><option value="fixed">مبلغ ثابت</option><option value="percentage">نسبة %</option></select>
              </div>
              {rates.retention_bonus_type && <div><label className={label}>قيمة المكافأة</label><input type="number" min={0} className={box} value={rates.retention_bonus_value} onChange={e => setRate({ retention_bonus_value: e.target.value })} /></div>}
            </div>
            <p className="mt-2 text-[11px] text-gray-500">سعر الاستشارة اللي العميل بيدفعه بيتحدد تحت في «تفعيل خدمة الجلسات». ده أجر المحاضر نفسه.</p>
            <button type="button" disabled={busy === 'rates'} onClick={() => void saveRates()} className="mt-3 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">حفظ المستحقات</button>
          </>
        )}
      </div>
    </div>
  );
}
