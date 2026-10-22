import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, Home, MessageCircle, Upload, Clock, LayoutDashboard, Receipt, XCircle, CreditCard, Loader2, PlayCircle } from 'lucide-react';
import { instituteWhatsApp } from '../lib/whatsappLink';
import { useSiteData } from '../context/SiteDataContext';
import { setCanonical } from '../lib/useSeo';
import { purchaseFromReturn, trackPurchase } from '../lib/tracking';
import { CAIRO_TIME_ZONE } from '../../shared/cairoDate';

/**
 * Where a customer lands after paying — by card or by transfer.
 *
 * /success is the Paymob redirection_url (see paymobCallbackUrls in
 * api/routes/public-orders.js), so it is the last thing a card payer sees. It
 * used to be written for one case only — "we received your request, now upload
 * your transfer receipt" — which meant a customer who had just paid by card was
 * told their payment was not done and asked to send a receipt for money that
 * had already left their account. A *declined* card was worse: same green tick,
 * same «تم استلام طلبك! 🎉».
 *
 * Paymob appends its result to the redirect, so the three cases are told apart
 * here. The redirect is only ever used to say what happened — the webhook,
 * which is HMAC-verified, is what actually records the payment, and the copy
 * below says so rather than promising access this page cannot grant.
 */
const TRANSFER_STEPS = [
  { icon: CheckCircle, title: 'استلمنا طلبك', desc: 'وصلنا طلب الاشتراك بنجاح', done: true },
  { icon: Receipt, title: 'ارفع إيصال التحويل', desc: 'من حسابك — يسرّع التفعيل كثيراً' },
  { icon: Clock, title: 'مراجعة وتأكيد', desc: 'فريقنا يراجع ويأكّد الدفع' },
  { icon: LayoutDashboard, title: 'ابدأ التعلّم', desc: 'يُفتح المحتوى في حسابك فوراً بعد التأكيد' },
];

const CARD_STEPS = [
  { icon: CreditCard, title: 'تمت عملية الدفع', desc: 'البنك وافق على العملية', done: true },
  { icon: Clock, title: 'تأكيد من بوابة الدفع', desc: 'بنستلم التأكيد وبنسجّل الدفعة — عادة خلال دقائق' },
  { icon: LayoutDashboard, title: 'ابدأ التعلّم', desc: 'يُفتح المحتوى في حسابك بعد تسجيل الدفعة' },
];

// The order as GET /api/me/orders/:id/status reads it.
type OrderStatus = {
  status: string; type: string; itemTitle: string; courseId: string | null; bundleId: string | null;
  startCourseId: string | null; planEntry: boolean; proof: { status: string; reviewDueAt: string | null } | null;
};
type Tracked = { state: 'checking' | 'paid' | 'failed' | 'timeout' | 'unknown'; order?: OrderStatus };
const POLL_EVERY_MS = 3000;
const POLL_FOR_MS = 90 * 1000;

/**
 * Follows the order Paymob returned to until the verified callback marks it paid
 * (or failed), for a minute and a half at most. The redirect only says what the
 * bank answered; the order's status is what opened the course.
 */
function useOrderStatus(orderId: string, poll: boolean): Tracked {
  const [tracked, setTracked] = useState<Tracked>({ state: orderId ? 'checking' : 'unknown' });
  useEffect(() => {
    if (!orderId) return undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const tick = async () => {
      try {
        const res = await fetch(`/api/me/orders/${encodeURIComponent(orderId)}/status`, { credentials: 'include' });
        if (res.status === 401 || res.status === 404) { if (!stopped) setTracked({ state: 'unknown' }); return; }
        const order = await res.json() as OrderStatus;
        if (stopped) return;
        if (order.status === 'paid') { setTracked({ state: 'paid', order }); return; }
        if (order.status === 'failed') { setTracked({ state: 'failed', order }); return; }
        setTracked({ state: 'checking', order });
      } catch { /* a dropped request is retried on the next tick */ }
      if (stopped) return;
      if (!poll || Date.now() - started > POLL_FOR_MS) { setTracked(prev => ({ ...prev, state: poll ? 'timeout' : 'unknown' })); return; }
      timer = setTimeout(tick, POLL_EVERY_MS);
    };
    void tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [orderId, poll]);
  return tracked;
}

const reviewDueLabel = (iso: string | null | undefined) => {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return 'خلال 24 ساعة';
  return `قبل ${at.toLocaleString('ar-EG-u-nu-latn', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: CAIRO_TIME_ZONE })}`;
};

const PaymentSuccess: React.FC = () => {
  const { content } = useSiteData();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // Paymob sends success=true/false; arriving with neither means this is the
  // manual checkout's own confirmation, which is what the page always was.
  const paymobResult = searchParams.get('success');
  const outcome = paymobResult === null ? 'transfer' : paymobResult.toLowerCase() === 'true' ? 'card' : 'declined';
  // The merchant order id is «<order>~<attempt>» (api/lib/paymobGateway.js); a
  // transfer confirmation names its order as ?order=.
  const orderId = String(searchParams.get('merchant_order_id') || searchParams.get('order') || '').split('~')[0].trim();
  const tracked = useOrderStatus(outcome === 'declined' ? '' : orderId, outcome === 'card');
  const startCourseId = tracked.state === 'paid' && !tracked.order?.planEntry ? tracked.order?.startCourseId || null : null;
  const playHref = startCourseId ? `/my-account?tab=learning&play=${encodeURIComponent(startCourseId)}` : '';

  // Paid for a course: straight into its first lecture, not the payments list.
  useEffect(() => {
    if (!playHref) return undefined;
    const timer = setTimeout(() => navigate(playHref), 2500);
    return () => clearTimeout(timer);
  }, [playHref, navigate]);

  useEffect(() => {
    setCanonical('/success');
    document.title = outcome === 'declined'
      ? 'لم تتم عملية الدفع | معهد الدراسات النفسية'
      : 'تم استلام طلبك | معهد الدراسات النفسية';
  }, [outcome]);

  // The ad's Purchase, for a card the bank accepted. Its id is the order's, the
  // one the server's copy carries when the verified callback lands, so Meta
  // counts the two once (lib/tracking.ts, api/lib/metaCapi.js).
  useEffect(() => {
    if (outcome !== 'card') return;
    const purchase = purchaseFromReturn(searchParams);
    if (purchase) trackPurchase(purchase);
  }, [outcome, searchParams]);

  const whatsapp = instituteWhatsApp(content);

  if (outcome === 'declined' || tracked.state === 'failed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10" dir="rtl">
        <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line sm:p-10">
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 ring-1 ring-red-100">
              <XCircle size={44} className="text-red-600" />
            </div>
            <h1 className="mb-2 text-2xl font-black text-ink sm:text-3xl">لم تتم عملية الدفع</h1>
            <p className="mb-6 leading-relaxed text-muted-body">
              البنك رفض العملية ولم يُخصم منك أي مبلغ. تقدر تجرب بطاقة تانية، أو تدفع بالتحويل ونفعّل حسابك بعد المراجعة.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Link
              to="/courses"
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800"
            >
              <CreditCard size={20} />
              حاول مرة أخرى
            </Link>
            <Link
              to="/my-account?section=payments"
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-7 font-extrabold text-ink transition hover:border-ink/40"
            >
              <Upload size={20} />
              ادفع بالتحويل وارفع الإيصال
            </Link>
            {whatsapp && (
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-7 font-extrabold text-ink transition hover:border-ink/40"
              >
                <MessageCircle size={20} className="text-green-600" />
                تواصل معنا عبر واتساب
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  const paidByCard = outcome === 'card';
  const steps = paidByCard ? CARD_STEPS : TRANSFER_STEPS;
  const confirmed = tracked.state === 'paid';
  const underReview = !paidByCard && tracked.order?.proof?.status === 'PENDING';
  const courseHref = tracked.order?.courseId ? `/course/${encodeURIComponent(tracked.order.courseId)}`
    : tracked.order?.bundleId ? `/bundle/${encodeURIComponent(tracked.order.bundleId)}` : '';

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10" dir="rtl">
      <div className="w-full max-w-lg rounded-[28px] bg-white p-6 shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line sm:p-10">
        <div className="text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-green-50 ring-1 ring-green-100">
            <CheckCircle size={44} className="text-green-600" />
          </div>
          <h1 className="mb-2 text-2xl font-black text-ink sm:text-3xl">
            {confirmed ? 'تم تأكيد الدفع! 🎉' : paidByCard ? 'تم الدفع بنجاح! 🎉' : underReview ? 'إيصالك قيد المراجعة' : 'تم استلام طلبك! 🎉'}
          </h1>
          <p className="mb-6 leading-relaxed text-muted-body">
            {confirmed
              ? (tracked.order?.planEntry ? 'القسط اتسجّل والمحتوى اتفتح في حسابك على قد اللي اتدفع.' : startCourseId ? 'الكورس اتفتح في حسابك — هنوديك لأول محاضرة دلوقتي.' : 'الدفعة اتسجّلت في حسابك.')
              : paidByCard
                ? (tracked.state === 'checking'
                  ? 'وصلنا تأكيد البنك، وبنستنى تأكيد بوابة الدفع علشان نفتح المحتوى — ثواني.'
                  : 'وصلنا تأكيد الدفع من البنك. بنسجّل الدفعة ونفتح المحتوى في حسابك — لو مافتحش خلال شوية، كلمنا واتساب ونظبطه فوراً.')
                : underReview
                  ? `فريق الحسابات بيراجع الإيصال وهيفعّل وصولك ${reviewDueLabel(tracked.order?.proof?.reviewDueAt)}.`
                  : 'خطوة واحدة بسيطة تفصلك عن بدء رحلتك — ارفع إيصال التحويل وفريقنا هيأكّد ويفعّل حسابك بسرعة.'}
          </p>
          {paidByCard && tracked.state === 'checking' && (
            <p className="mb-5 flex items-center justify-center gap-2 text-sm font-bold text-muted"><Loader2 size={16} className="animate-spin text-primary-700" /> بنأكد الدفعة...</p>
          )}
        </div>

        {/* Next-steps timeline */}
        <ol className="space-y-3 mb-6">
          {steps.map((s, i) => {
            const Ic = s.icon;
            return (
              <li key={s.title} className={`flex items-start gap-3 rounded-2xl border p-3 ${s.done ? 'border-green-100 bg-green-50' : 'border-line bg-paper'}`}>
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${s.done ? 'bg-green-600 text-white' : 'border border-line bg-white text-muted-soft'}`}>
                  <Ic size={17} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-black text-ink">{i + 1}. {s.title}</p>
                  <p className="text-xs leading-relaxed text-muted">{s.desc}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mb-6 flex items-center gap-2 rounded-2xl bg-paper px-4 py-3 text-sm text-muted-strong ring-1 ring-line">
          <Clock size={16} className="shrink-0 text-gold-deep" />
          <span>عادةً بنرد ونفعّل خلال ساعات العمل (السبت – الخميس).</span>
        </div>

        <div className="flex flex-col gap-3">
          {playHref ? (
            <Link
              to={playHref}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800"
            >
              <PlayCircle size={20} /> ابدأ أول محاضرة
            </Link>
          ) : (
            <Link
              to={paidByCard || underReview ? (confirmed && tracked.order?.planEntry ? '/my-account?section=payments' : '/my-account?tab=learning') : '/my-account?section=payments'}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800"
            >
              {paidByCard || underReview ? <><LayoutDashboard size={20} /> الذهاب لحسابي</> : <><Upload size={20} /> ارفع إيصال التحويل الآن</>}
            </Link>
          )}
          {courseHref && (
            <Link
              to={courseHref}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-7 font-extrabold text-ink transition hover:border-ink/40"
            >
              صفحة الكورس
            </Link>
          )}
          {whatsapp && (
            <a
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-7 font-extrabold text-ink transition hover:border-ink/40"
            >
              <MessageCircle size={20} className="text-green-600" />
              تواصل معنا عبر واتساب
            </a>
          )}
          <Link
            to="/"
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl font-extrabold text-muted transition hover:bg-paper hover:text-ink"
          >
            <Home size={20} />
            العودة للرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PaymentSuccess;
