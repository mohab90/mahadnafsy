import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { BadgeCheck, Building2, CalendarCheck2, Gavel, Smile, Wallet } from 'lucide-react';
import { CAIRO_TIME_ZONE } from '../../../../shared/cairoDate';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import MyHrFilePanel from '../staff-settings/MyHrFilePanel';
import type { MyDisciplinary, MyHrSnapshot } from './useMyHr';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

const egp = (value: number) => `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn')} ج.م`;
const longDate = (value: string | null) => value
  ? new Date(value).toLocaleDateString('ar-EG-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric', timeZone: CAIRO_TIME_ZONE })
  : '—';
const EMPLOYMENT: Record<string, string> = { full_time: 'دوام كامل', part_time: 'دوام جزئي', contractor: 'متعاقد' };
const DISCIPLINARY_STATUS: Record<string, string> = { open: 'جديد', acknowledged: 'تم الاطلاع', appealed: 'قيد التظلم', closed: 'مغلق' };

const Card = ({ icon: Icon, title, tone, children }: { icon: typeof Wallet; title: string; tone: string; children: ReactNode }) => (
  <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
    <h3 className="mb-4 flex items-center gap-2 font-extrabold text-gray-900">
      <span className={`grid h-8 w-8 place-items-center rounded-xl ${tone}`}><Icon size={16} /></span>{title}
    </h3>
    {children}
  </section>
);

const Line = ({ label, value, strong = false }: { label: string; value: ReactNode; strong?: boolean }) => (
  <div className="flex items-center justify-between gap-3 border-b border-gray-50 py-2 text-sm last:border-0">
    <span className="text-gray-500">{label}</span>
    <span className={strong ? 'font-extrabold text-gray-900' : 'font-semibold text-gray-800'}>{value}</span>
  </div>
);

/**
 * ملفي الوظيفي — what the institute holds about the job: the contract side,
 * the salary, this month's attendance, the leave balance, anything disciplinary
 * (which only the employee can acknowledge or appeal), their papers and the
 * pay history.
 */
export function MyJobFileSection({ hr, disciplinary, setDisciplinary, notify }: {
  hr: MyHrSnapshot | null;
  disciplinary: MyDisciplinary[];
  setDisciplinary: (rows: MyDisciplinary[]) => void;
  notify: Notify;
}) {
  const [appealing, setAppealing] = useState('');
  const [appealNote, setAppealNote] = useState('');
  const [busy, setBusy] = useState('');

  const act = async (recordId: string, action: 'acknowledge' | 'appeal') => {
    setBusy(recordId);
    try {
      const response = await fetch(`/api/staff/me/disciplinary/${encodeURIComponent(recordId)}/${action}`, {
        method: 'PUT', credentials: 'include', headers: adminAuthHeaders(true),
        body: JSON.stringify(action === 'appeal' ? { appeal_note: appealNote } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر تنفيذ الإجراء');
      const refreshed = await fetch('/api/staff/me/disciplinary', { credentials: 'include', headers: adminAuthHeaders() }).then(r => r.json());
      if (Array.isArray(refreshed)) setDisciplinary(refreshed);
      setAppealing(''); setAppealNote('');
      notify('success', action === 'acknowledge' ? 'تم تأكيد الاطلاع' : 'اتبعت التظلم للموارد البشرية');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء');
    } finally { setBusy(''); }
  };

  const salaryTotal = hr?.salary
    ? Number(hr.salary.base_salary) + Number(hr.salary.housing_allowance || 0) + Number(hr.salary.transport_allowance || 0)
      + Number(hr.commission?.thisMonth?.total || 0)
    : 0;
  const balance = hr?.leaveBalance;
  const usedRatio = balance ? Math.min(1, (balance.usedDays || 0) / (balance.annualEntitlement || 21)) : 0;
  const ring = 2 * Math.PI * 34;

  return (
    <div className="space-y-5">
      {!hr ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
          بياناتك الوظيفية مش متسجلة لسه — تواصل مع الموارد البشرية.
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card icon={Building2} title="بياناتي الوظيفية" tone="bg-indigo-50 text-indigo-600">
            <Line label="تاريخ التعيين" value={longDate(hr.staff.hire_date || hr.staff.joined_at)} />
            <Line label="القسم" value={hr.staff.department_name || '—'} />
            <Line label="نوع التعاقد" value={EMPLOYMENT[hr.staff.employment_type || ''] || hr.staff.employment_type || '—'} />
          </Card>

          <Card icon={Wallet} title="راتبي" tone="bg-emerald-50 text-emerald-600">
            {hr.salary ? (
              <>
                <Line label="الراتب الأساسي" value={egp(hr.salary.base_salary)} />
                <Line label="بدل سكن" value={egp(hr.salary.housing_allowance)} />
                <Line label="بدل مواصلات" value={egp(hr.salary.transport_allowance)} />
                <Line label="عمولة الشهر" value={<span className="text-emerald-700">{egp(hr.commission?.thisMonth?.total || 0)}</span>} />
                <div className="mt-3 flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2.5">
                  <span className="text-sm font-extrabold text-emerald-900">الإجمالي المتوقع</span>
                  <span className="text-lg font-black text-emerald-700">{egp(salaryTotal)}</span>
                </div>
              </>
            ) : <p className="py-6 text-center text-sm text-gray-400">هيكل راتبك لسه متحددش — تواصل مع الموارد البشرية.</p>}
          </Card>

          <Card icon={CalendarCheck2} title="حضوري الشهر ده" tone="bg-sky-50 text-sky-600">
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                ['حضور', hr.attendance.present_days, 'text-emerald-700 bg-emerald-50'],
                ['غياب', hr.attendance.absent_days, 'text-red-700 bg-red-50'],
                ['تأخير', hr.attendance.late_days, 'text-amber-700 bg-amber-50'],
                ['دقايق تأخير', hr.attendance.total_late_minutes, 'text-gray-700 bg-gray-50'],
              ].map(([label, value, tone]) => (
                <div key={label as string} className={`rounded-xl px-2 py-3 ${tone}`}>
                  <div className="text-xl font-black">{Number(value || 0)}</div>
                  <div className="text-[10px] font-bold opacity-80">{label}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card icon={BadgeCheck} title="رصيد الإجازات" tone="bg-blue-50 text-blue-600">
            <div className="flex items-center gap-5">
              <div className="relative h-24 w-24 flex-shrink-0">
                <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
                  <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                  <circle cx="40" cy="40" r="34" fill="none" stroke="#3b82f6" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={ring} strokeDashoffset={ring * (1 - usedRatio)} />
                </svg>
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div><div className="text-lg font-black text-gray-900">{balance?.remaining ?? 0}</div><div className="text-[9px] text-gray-400">يوم متبقي</div></div>
                </div>
              </div>
              <div className="flex-1">
                <Line label="المستحق السنوي" value={`${balance?.annualEntitlement ?? 0} يوم`} />
                <Line label="المستخدم" value={`${balance?.usedDays ?? 0} يوم`} />
                <Line label="المتبقي" value={`${balance?.remaining ?? 0} يوم`} strong />
              </div>
            </div>
          </Card>
        </div>
      )}

      <Card icon={Gavel} title="التنبيهات والجزاءات" tone="bg-rose-50 text-rose-600">
        {disciplinary.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">سجلك نضيف — مفيش أي تنبيهات 👏</p>
        ) : (
          <div className="space-y-3">
            {disciplinary.map(record => (
              <div key={record.id} className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-gray-900">{record.title}</div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {longDate(record.incident_date)} · {record.severity === 'high' ? 'عالية' : record.severity === 'low' ? 'منخفضة' : 'متوسطة'}
                    </div>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-bold text-gray-600">{DISCIPLINARY_STATUS[record.status] || record.status}</span>
                </div>
                {record.description && <p className="mt-2 whitespace-pre-wrap text-gray-700">{record.description}</p>}
                {record.action_taken && <p className="mt-2 text-xs text-gray-600">الإجراء: {record.action_taken}</p>}
                {record.appeal_note && <p className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-800">تظلمي: {record.appeal_note}</p>}
                {['open', 'acknowledged'].includes(record.status) && (
                  <div className="mt-3 space-y-2">
                    {appealing === record.id && (
                      <textarea value={appealNote} onChange={e => setAppealNote(e.target.value)} rows={3} maxLength={5000}
                        placeholder="اكتب سبب التظلم بوضوح" className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm" />
                    )}
                    <div className="flex flex-wrap gap-2">
                      {record.status === 'open' && (
                        <button type="button" disabled={busy === record.id} onClick={() => void act(record.id, 'acknowledge')}
                          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">تأكيد الاطلاع</button>
                      )}
                      {appealing === record.id ? (
                        <>
                          <button type="button" disabled={busy === record.id || !appealNote.trim()} onClick={() => void act(record.id, 'appeal')}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">إرسال التظلم</button>
                          <button type="button" onClick={() => { setAppealing(''); setAppealNote(''); }} className="rounded-lg bg-white px-3 py-1.5 text-xs text-gray-600">إلغاء</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => { setAppealing(record.id); setAppealNote(''); }}
                          className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">تقديم تظلم</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <MyHrFilePanel />
      <SatisfactionCard notify={notify} />
    </div>
  );
}

/** The monthly, anonymous «رضاك عن العمل» — moved here from the old ملفي الوظيفي page. */
function SatisfactionCard({ notify }: { notify: Notify }) {
  const [responded, setResponded] = useState<boolean | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    fetch('/api/staff/me/enps', { credentials: 'include', headers: adminAuthHeaders() })
      .then(r => (r.ok ? r.json() : null))
      .then(payload => { if (payload) { setResponded(!!payload.responded); if (payload.responded) setScore(payload.score); } })
      .catch(() => setResponded(false));
  }, []);
  useEffect(load, [load]);

  const send = async () => {
    if (score === null) return;
    setSending(true);
    try {
      const response = await fetch('/api/staff/me/enps', {
        method: 'POST', credentials: 'include', headers: adminAuthHeaders(true), body: JSON.stringify({ score, comment }),
      });
      if (!response.ok) throw new Error();
      setResponded(true);
      notify('success', 'شكراً إنك شاركتنا رأيك 💚');
    } catch { notify('error', 'تعذر إرسال التقييم'); } finally { setSending(false); }
  };

  return (
    <Card icon={Smile} title="رضاك عن الشغل" tone="bg-amber-50 text-amber-600">
      {responded ? (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          اتسجل تقييمك للشهر ده{score !== null ? ` (${score}/10)` : ''}.
          <button type="button" onClick={() => setResponded(false)} className="mr-2 text-xs text-emerald-800 underline">تعديل</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">قد إيه ممكن ترشّح الشغل هنا لصاحبك؟ (0 = مستحيل، 10 = أكيد) — الرد سري وبيظهر للإدارة مجمّع بس.</p>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }, (_, n) => n).map(n => (
              <button key={n} type="button" onClick={() => setScore(n)}
                className={`h-9 w-9 rounded-lg text-sm font-bold transition ${score === n
                  ? (n >= 9 ? 'bg-emerald-600 text-white' : n >= 7 ? 'bg-amber-500 text-white' : 'bg-red-500 text-white')
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{n}</button>
            ))}
          </div>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="ملاحظة (اختياري)…"
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <button type="button" onClick={() => void send()} disabled={sending || score === null}
            className="rounded-xl bg-gray-800 px-5 py-2 text-sm font-bold text-white hover:bg-gray-900 disabled:opacity-50">
            {sending ? 'جارٍ الإرسال…' : 'إرسال التقييم'}
          </button>
        </div>
      )}
    </Card>
  );
}
