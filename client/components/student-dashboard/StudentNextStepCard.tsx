import React, { useEffect, useState } from 'react';
import { Award, CalendarClock, PlayCircle, Wallet } from 'lucide-react';
import { mysqlClient, type MyNextStep } from '../../lib/mysqlapi';
import { CERT_STATUS_META, isCertificateEarned, type CertRequestStatus } from '../../lib/certificateStatus';
import { moneySuffix, type InstallmentModalState } from '../../lib/itemBalance';
import { CAIRO_TIME_ZONE, cairoDateOnly } from '../../../shared/cairoDate';
import type { Course, CourseLectureItem, ExtraCertificateRequest, ItemBalance } from '../../types';

// «خطوتك الجاية» — the one card at the top of the client's portal that says what
// to do next: the next session of the round they sit in at Dokki or Tagamoa,
// what is still owed and a way to pay it, where their certificate stands, and
// the next lecture online with «كمّل».
//
// «كارت خطوتك الجاية» (11 Oct 2026). Each of these was on the page, but on four
// different tabs, and the session was nowhere: a client in a round had to ask
// the desk when their next lecture was.
//
// What the portal already loads is read from its props; the round, its money and
// the earned certificates come from GET /api/me/next-step.

interface Props {
  subscriberId?: string;
  balances: ItemBalance[];
  certificateRequests: ExtraCertificateRequest[];
  enrolledCourses: Course[];
  lectureProgress: Record<string, number>;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  onPay: (value: InstallmentModalState) => void;
  onResume: (courseId: string) => void;
  onCertificates: () => void;
}

const WATCHED_PCT = 90;
const money = (amount: number) => amount.toLocaleString('ar-EG-u-nu-latn');

function sessionDay(date: string): string {
  if (date === cairoDateOnly()) return 'النهارده';
  if (date === cairoDateOnly(Date.now() + 86400000)) return 'بكرة';
  // Noon UTC, so the day cannot slip across midnight in Cairo.
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: CAIRO_TIME_ZONE,
  });
}

/** The first lecture not yet watched, in the first course that has one. Pure. */
export function nextOnlineLecture(
  courses: Course[], progress: Record<string, number>, lecturesOf: (courseId: string) => CourseLectureItem[],
): { course: Course; lecture: CourseLectureItem } | null {
  for (const course of courses) {
    const lecture = [...lecturesOf(String(course.id))]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .find(item => (Number(progress[String(item.id)]) || 0) < WATCHED_PCT);
    if (lecture) return { course, lecture };
  }
  return null;
}

/**
 * Everything owed, item by item: the portal's own balances first, then a
 * round's when the course or track it is for is not already among them.
 */
export function owedItems(balances: ItemBalance[], rounds: MyNextStep['rounds'], courses: Course[]) {
  const titleOf = (courseId: string | null) => courses.find(course => String(course.id) === String(courseId))?.title || '';
  const items = balances
    .filter(balance => balance.remaining > 0)
    .map(balance => ({ item: balance.item, title: balance.title || titleOf(balance.courseId), remaining: balance.remaining, currency: balance.currency }));
  const known = new Set(balances.map(balance => balance.item));
  for (const round of rounds) {
    if (round.remaining > 0 && !known.has(round.item)) {
      known.add(round.item);
      items.push({ item: round.item, title: round.title || titleOf(round.courseId), remaining: round.remaining, currency: round.currency });
    }
  }
  return items;
}

const Row: React.FC<{ icon: React.ReactNode; tone: string; children: React.ReactNode; action?: React.ReactNode }> = ({ icon, tone, children, action }) => (
  <div className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-3">
    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}>{icon}</span>
    <div className="min-w-0 flex-1 text-sm">{children}</div>
    {action}
  </div>
);

const actionClass = 'shrink-0 rounded-xl px-3 py-2 text-xs font-bold text-white transition';

export const StudentNextStepCard: React.FC<Props> = ({
  subscriberId, balances, certificateRequests, enrolledCourses, lectureProgress, getCourseLectures,
  onPay, onResume, onCertificates,
}) => {
  const [step, setStep] = useState<MyNextStep | null>(null);
  useEffect(() => {
    if (!subscriberId) return;
    let cancelled = false;
    mysqlClient.getMyNextStep()
      .then(data => { if (!cancelled) setStep(data); })
      .catch(() => { /* the card shows what the page already has */ });
    return () => { cancelled = true; };
  }, [subscriberId]);

  const session = step?.session || null;
  const owed = owedItems(balances, step?.rounds || [], enrolledCourses);
  const pendingCertificate = certificateRequests.find(request => !isCertificateEarned(request.status));
  const earned = step?.certificates?.[0] || null;
  const next = nextOnlineLecture(enrolledCourses, lectureProgress, getCourseLectures);

  if (!session && owed.length === 0 && !pendingCertificate && !earned && !next) return null;

  const resume = (courseId: string, lectureId: string) => {
    // The player opens on the lecture it last remembers; this makes it the one named here.
    try { if (subscriberId) localStorage.setItem(`last-lecture:${subscriberId}:${courseId}`, lectureId); } catch { /* storage unavailable */ }
    onResume(courseId);
  };

  return (
    <section className="rounded-2xl border border-primary-100 bg-gradient-to-br from-primary-50 to-white p-4 shadow-sm" aria-label="خطوتك الجاية">
      <h2 className="mb-3 text-base font-extrabold text-gray-800">خطوتك الجاية 👣</h2>
      <div className="space-y-2.5">
        {session && (
          <Row icon={<CalendarClock size={18} />} tone="bg-sky-100 text-sky-700">
            <p className="font-bold text-gray-800">محاضرتك الجاية في فرع {session.branchLabel}: المحاضرة {session.lecture}</p>
            <p className="truncate text-xs text-gray-500">
              {session.courseTitle && <>{session.courseTitle} · </>}روند {session.code}
            </p>
            <p className="text-xs font-semibold text-sky-700">
              {sessionDay(session.date)} · {session.timeSlot}{session.room ? ` · قاعة ${session.room}` : ''}
            </p>
          </Row>
        )}

        {owed.slice(0, 3).map(item => (
          <Row
            key={item.item}
            icon={<Wallet size={18} />}
            tone="bg-amber-100 text-amber-700"
            action={(
              <button
                type="button"
                onClick={() => onPay({ courseId: item.item, courseTitle: item.title, remaining: item.remaining, currency: item.currency })}
                className={`${actionClass} bg-amber-500 hover:bg-amber-600`}
              >
                ادفع الباقي
              </button>
            )}
          >
            <p className="font-bold text-gray-800">باقي عليك {money(item.remaining)} {moneySuffix(item.currency)}</p>
            <p className="truncate text-xs text-gray-500">{item.title || 'الكورس'}</p>
          </Row>
        ))}

        {(pendingCertificate || earned) && (
          <Row
            icon={<Award size={18} />}
            tone="bg-violet-100 text-violet-700"
            action={(
              <button type="button" onClick={onCertificates} className={`${actionClass} bg-violet-600 hover:bg-violet-700`}>
                شهاداتي
              </button>
            )}
          >
            {pendingCertificate ? (
              <>
                <p className="font-bold text-gray-800">شهادتك: {CERT_STATUS_META[pendingCertificate.status as CertRequestStatus]?.label || pendingCertificate.status}</p>
                <p className="truncate text-xs text-gray-500">{pendingCertificate.customName || 'طلب شهادة'}</p>
              </>
            ) : earned && (
              <>
                <p className="font-bold text-gray-800">🎓 شهادتك جاهزة</p>
                <p className="truncate text-xs text-gray-500">{earned.courseTitle || 'الكورس'}</p>
              </>
            )}
          </Row>
        )}

        {next && (
          <Row
            icon={<PlayCircle size={18} />}
            tone="bg-emerald-100 text-emerald-700"
            action={(
              <button type="button" onClick={() => resume(String(next.course.id), String(next.lecture.id))} className={`${actionClass} bg-emerald-600 hover:bg-emerald-700`}>
                كمّل
              </button>
            )}
          >
            <p className="truncate font-bold text-gray-800">{next.lecture.title}</p>
            <p className="truncate text-xs text-gray-500">المحاضرة الجاية أونلاين · {next.course.title}</p>
          </Row>
        )}
      </div>
    </section>
  );
};
