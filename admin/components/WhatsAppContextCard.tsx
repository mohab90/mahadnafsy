import { useNavigate } from 'react-router-dom';
import { BookOpen, CalendarClock, ExternalLink, GraduationCap, UserRound, Wallet } from 'lucide-react';
import { branchLabels, normBranchKey } from '../pages/unified-client/constants';
import { cairoDay } from '../../shared/cairoDate';

// What the system knows about a WhatsApp number, as a card above the chat — «أي رقم يكون مربوط بالسيستم ياخد بياناته ويبقى
// مسجل اسم العميل وفوق يظهر اسم الكورس المهتم بيه وتفاصيله» (19 Oct 2026). Served by GET /api/staff/whatsapp-web/context.

export type WaContext = {
  phone: string;
  subscriber: null | {
    id: string; clientCode: string | null; name: string; branch: string | null; owner: string | null; active: boolean; since: string | null;
    courses: Array<{ id: string; title: string; progress: number; since: string | null }>;
    money?: { paid: Array<{ currency: string; amount: number; count: number }>; lastPaymentAt: string | null; waiting: number };
  };
  lead: null | {
    id: string; clientCode: string | null; name: string; branch: string | null; status: string | null; source: string | null;
    interestLevel: string | null; owner: string | null; nextFollowUp: string | null; lastFollowUp: string | null; notes: string | null;
    since: string | null; dealValue: number | null;
    interested: Array<{ id: string; title: string; price: number }>;
    enrolled: { id: string; title: string } | null;
  };
};

const LEAD_STATUS: Record<string, string> = {
  new: 'جديد', contacted: 'اتكلّم معاه', interested: 'مهتم', follow_up: 'متابعة', negotiating: 'بيتفاوض', converted: 'اتحوّل لعميل',
  lost: 'مفقود', wrong_number: 'رقم غلط', not_interested: 'مش مهتم', pending: 'معلّق',
};
const branchName = (branch: string | null) => (branch ? branchLabels[normBranchKey(branch)] || branch : '');
const money = (value: number, currency: string) => `${Math.round(value).toLocaleString('ar-EG-u-nu-latn')} ${currency}`;

export function WhatsAppContextCard({ context, compact = false }: { context: WaContext; compact?: boolean }) {
  const navigate = useNavigate();
  const { subscriber, lead } = context;
  if (!subscriber && !lead) return null;
  const name = subscriber?.name || lead?.name || '';
  const code = subscriber?.clientCode || lead?.clientCode || null;
  const branch = branchName(subscriber?.branch || lead?.branch || null);
  const owner = subscriber?.owner || lead?.owner || null;
  const interested = lead?.interested || [];
  const held = subscriber?.courses || [];
  const lastLead = lead && !subscriber;
  const chip = 'inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold';

  return (
    <section dir="rtl" className="rounded-2xl border border-green-200 bg-gradient-to-l from-green-50 to-white p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700"><UserRound size={16} /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-gray-900">{name || '—'}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {subscriber && <span className={`${chip} bg-blue-100 text-blue-800`}>عميل</span>}
            {lead && <span className={`${chip} bg-amber-100 text-amber-800`}>{lastLead ? 'عميل محتمل' : 'كان عميل محتمل'}{lead.status ? ` · ${LEAD_STATUS[lead.status] || lead.status}` : ''}</span>}
            {code && <span className={`${chip} bg-gray-100 text-gray-600`} dir="ltr">{code}</span>}
            {branch && <span className={`${chip} bg-teal-50 text-teal-700`}>{branch}</span>}
            {owner && <span className={`${chip} bg-indigo-50 text-indigo-700`}>المسئول: {owner}</span>}
          </div>
        </div>
        {!compact && code && (
          <div className="flex shrink-0 items-center gap-1.5">
            {/* The next things a rep does after reading the chat: book / take a payment, or open the whole file. */}
            <button type="button" onClick={() => navigate(`/client/${code}?pay=now`)} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 font-bold text-white hover:bg-emerald-700">
              <Wallet size={12} /> حجز / دفع
            </button>
            <button type="button" onClick={() => navigate(`/client/${code}`)} className="inline-flex items-center gap-1 rounded-lg border border-green-300 bg-white px-2.5 py-1 font-bold text-green-800 hover:bg-green-50">
              <ExternalLink size={12} /> ملف العميل
            </button>
          </div>
        )}
      </div>

      {/* The course: what they asked about, or what they hold — the first thing a rep needs before writing. */}
      {(interested.length > 0 || held.length > 0 || lead?.enrolled) && (
        <div className="mt-2 space-y-1">
          {interested.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className={`${chip} bg-rose-50 text-rose-700`}><BookOpen size={11} /> مهتم بـ</span>
              {interested.map(course => (
                <span key={course.id} className="rounded-lg border border-rose-100 bg-white px-2 py-0.5 font-bold text-gray-800">
                  {course.title}{course.price > 0 && <span className="mr-1 font-normal text-gray-500">{money(course.price, 'ج')}</span>}
                </span>
              ))}
            </p>
          )}
          {held.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5">
              <span className={`${chip} bg-emerald-50 text-emerald-700`}><GraduationCap size={11} /> مشترك في</span>
              {held.map(course => (
                <span key={course.id} className="rounded-lg border border-emerald-100 bg-white px-2 py-0.5 font-bold text-gray-800">
                  {course.title}{course.progress > 0 && <span className="mr-1 font-normal text-gray-500">{course.progress}%</span>}
                </span>
              ))}
            </p>
          )}
          {lead?.enrolled && !held.length && (
            <p className="flex items-center gap-1.5"><span className={`${chip} bg-emerald-50 text-emerald-700`}><GraduationCap size={11} /> حجز</span><b className="text-gray-800">{lead.enrolled.title}</b></p>
          )}
        </div>
      )}

      {!compact && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-600">
          {subscriber?.money && (
            <span className="inline-flex items-center gap-1"><Wallet size={12} className="text-emerald-600" />
              {subscriber.money.paid.length ? <>دفع {subscriber.money.paid.map(row => money(row.amount, row.currency)).join(' + ')}</> : 'لسه ما دفعش'}
              {subscriber.money.waiting > 0 && <b className="mr-1 text-amber-700">· {subscriber.money.waiting} دفعة مستنية</b>}
              {subscriber.money.lastPaymentAt && <span className="text-gray-400">· آخر دفعة {cairoDay(subscriber.money.lastPaymentAt)}</span>}
            </span>
          )}
          {lead?.nextFollowUp && <span className="inline-flex items-center gap-1"><CalendarClock size={12} className="text-sky-600" /> متابعة {cairoDay(lead.nextFollowUp)}</span>}
          {lead?.source && <span>المصدر: {lead.source}</span>}
          {lead?.since && <span>اتسجّل {cairoDay(lead.since)}</span>}
          {lead?.dealValue ? <span>قيمة الصفقة {money(lead.dealValue, '')}</span> : null}
        </div>
      )}
      {!compact && lead?.notes && <p className="mt-1.5 line-clamp-2 rounded-lg bg-white/70 px-2 py-1 text-[11px] text-gray-600" title={lead.notes}>{lead.notes}</p>}
    </section>
  );
}
