import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen, Award, Clock, LogOut, User, ChevronRight, CheckCircle,
  Bell, Settings, MessageSquare, CreditCard, Play, Edit3, Camera,
  Save, X, Phone, AlertCircle,
  ChevronDown, ChevronUp, FileText,
  Users, Sparkles, Radio, Share2, Gift,
} from 'lucide-react';
import { mysqlAuth, mysqlClient } from '../lib/mysqlapi';
import type { PaymentProof } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import StudentEngagementHero from '../components/student-dashboard/StudentEngagementHero';
import { StudentDashboardSectionNav } from '../components/student-dashboard/StudentDashboardSectionNav';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';

const CourseCertificate = React.lazy(() => import('../components/CourseCertificate'));
const StudentCoursesTab = React.lazy(() => import('../components/student-dashboard/StudentCoursesTab').then((module) => ({ default: module.StudentCoursesTab })));
const StudentPaymentsTab = React.lazy(() => import('../components/student-dashboard/StudentPaymentsTab').then((module) => ({ default: module.StudentPaymentsTab })));
const StudentMaterialsTab = React.lazy(() => import('../components/student-dashboard/StudentMaterialsTab').then((module) => ({ default: module.StudentMaterialsTab })));
const StudentQuizTab = React.lazy(() => import('../components/student-dashboard/StudentQuizTab').then((module) => ({ default: module.StudentQuizTab })));
const StudentLoyaltyTab = React.lazy(() => import('../components/student-dashboard/StudentLoyaltyTab').then((module) => ({ default: module.StudentLoyaltyTab })));
const StudentSupportTab = React.lazy(() => import('../components/student-dashboard/StudentSupportTab').then((module) => ({ default: module.StudentSupportTab })));
const StudentReferralTab = React.lazy(() => import('../components/student-dashboard/StudentReferralTab').then((module) => ({ default: module.StudentReferralTab })));
const StudentConsultationsTab = React.lazy(() => import('../components/student-dashboard/StudentConsultationsTab').then((module) => ({ default: module.StudentConsultationsTab })));
const StudentNotificationsTab = React.lazy(() => import('../components/student-dashboard/StudentNotificationsTab').then((module) => ({ default: module.StudentNotificationsTab })));
const StudentLiveStreamsTab = React.lazy(() => import('../components/student-dashboard/StudentLiveStreamsTab').then((module) => ({ default: module.StudentLiveStreamsTab })));
const StudentCommunityTab = React.lazy(() => import('../components/student-dashboard/StudentCommunityTab').then((module) => ({ default: module.StudentCommunityTab })));
const StudentSettingsTab = React.lazy(() => import('../components/student-dashboard/StudentSettingsTab').then((module) => ({ default: module.StudentSettingsTab })));
const StudentCertificatesTab = React.lazy(() => import('../components/student-dashboard/StudentCertificatesTab').then((module) => ({ default: module.CertificatesTab })));
const VideoPlayer = React.lazy(() =>
  import('../components/UserDashboardVideoPlayer').then((module) => ({ default: module.VideoPlayer }))
);
const StudentTabFallback = () => (
  <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500" dir="rtl">
    جاري تحميل القسم...
  </div>
);


/* ─── helpers ─────────────────────────────────────────────────────────────── */
const AVATAR_COLORS = [
  'bg-primary-600', 'bg-red-500', 'bg-emerald-600',
  'bg-amber-500', 'bg-purple-600', 'bg-sky-600',
];
const pickColor = (email: string) =>
  AVATAR_COLORS[email.charCodeAt(0) % AVATAR_COLORS.length];

type Tab = 'overview' | 'learning' | 'consultations' | 'community' | 'account';
type LearningSection = 'courses' | 'certificates' | 'materials' | 'quiz' | 'live';
type AccountSection = 'payments' | 'notifications' | 'loyalty' | 'referral' | 'support' | 'settings';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const UserDashboard: React.FC = () => {
  useEffect(() => { document.title = 'حسابي | معهد الدراسات النفسية'; }, []);
  const { courses, subscribers, notifications, communityPosts, consultations, getCourseLectures, updateSubscriber, authUser, remoteReady, mySubscriberLoaded, isAdmin, content, currency, courseQuizzes, quizAttempts, addQuizAttempt, liveStreams, logout, refreshMySubscriber } = useSiteData();
  const navigate = useNavigate();

  // ── Direct staff check (for non-admin staff whose staffMembers won't be loaded) ──
  const [isStaffMember, setIsStaffMember] = useState<boolean | null>(null);
  const staffCheckDoneRef = useRef(false);
  useEffect(() => {
    if (!remoteReady || staffCheckDoneRef.current) return;
    const subscriber = subscribers.find(
      s => s.email.toLowerCase().trim() === (authUser?.email || '').toLowerCase().trim()
    );
    if (subscriber) { setIsStaffMember(false); staffCheckDoneRef.current = true; return; }
    if (!authUser?.uid) { setIsStaffMember(false); staffCheckDoneRef.current = true; return; }
    staffCheckDoneRef.current = true;
    mysqlClient.checkIsStaff().then((r) => {
      setIsStaffMember(r.isStaff);
    }).catch(() => setIsStaffMember(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteReady, subscribers]);

  /* dismissed notifications */
  const [dismissedNotifIds, setDismissedNotifIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('dismissed-notifs') || '[]'); } catch { return []; }
  });

  /* tabs */
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [learningSection, setLearningSection] = useState<LearningSection>('courses');
  const [accountSection, setAccountSection] = useState<AccountSection>('payments');
  const [realtimeNotice, setRealtimeNotice] = useState('');

  useRealtimeEvents<{ message?: string }>(
    'client:payment-updated',
    (payload) => {
      setRealtimeNotice(payload.message || 'تم تحديث بيانات المدفوعات الخاصة بك.');
      refreshMySubscriber();
    },
    Boolean(authUser && import.meta.env.VITE_WS_URL),
  );

  useRealtimeEvents<{ message?: string }>(
    'client:certificate-updated',
    (payload) => {
      setRealtimeNotice(payload.message || 'تم تحديث بيانات الشهادات الخاصة بك.');
      refreshMySubscriber();
    },
    Boolean(authUser && import.meta.env.VITE_WS_URL),
  );

  // Deep-link portal sections: ?tab=account&section=payments (used by PaymentSuccess, emails, etc.)
  const [dashSearchParams] = useSearchParams();
  useEffect(() => {
    const t = dashSearchParams.get('tab');
    const s = dashSearchParams.get('section');
    if (t && ['overview', 'learning', 'consultations', 'community', 'account'].includes(t)) setActiveTab(t as Tab);
    if (s && ['payments', 'notifications', 'loyalty', 'referral', 'support', 'settings'].includes(s)) {
      setActiveTab('account');
      setAccountSection(s as AccountSection);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh subscriber data when switching to courses tab (picks up newly-granted enrollments)
  useEffect(() => {
    if (activeTab === 'learning' && learningSection === 'courses' && authUser) {
      refreshMySubscriber();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, learningSection]);

  /* video player */
  const [playerCourseId, setPlayerCourseId] = useState<string | null>(null);

  /* referral */
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralStats, setReferralStats] = useState<{ uses: number; earnings: number } | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  useEffect(() => {
    if (!authUser?.uid) return;
    // only for non-admin subscribers
    const sub = subscribers.find(s => s.email.toLowerCase().trim() === (authUser.email || '').toLowerCase().trim());
    if (!sub) return;
    mysqlClient.getMyReferralCode().then(r => {
      setReferralCode(r.code);
      setReferralStats({ uses: r.uses, earnings: r.earnings });
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);

  /* certificate modal */
  const [certModal, setCertModal] = useState<{ courseId: string } | null>(null);

  /* payment proof upload */
  const [showProofForm, setShowProofForm] = useState(false);
  const [proofAmount, setProofAmount] = useState('');
  const [proofCurrency, setProofCurrency] = useState<'EGP' | 'SAR' | 'USD'>('EGP');
  const [proofMethod, setProofMethod] = useState<'instapay' | 'bank_transfer' | 'vodafone_cash' | 'fawry' | 'other'>('instapay');
  const [proofCourseId, setProofCourseId] = useState('');
  const [proofNote, setProofNote] = useState('');
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [proofImageName, setProofImageName] = useState('');
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofSuccess, setProofSuccess] = useState(false);
  const [proofError, setProofError] = useState('');
  const [myProofs, setMyProofs] = useState<PaymentProof[]>([]);
  const [proofsLoaded, setProofsLoaded] = useState(false);

  /* installment payment modal */
  const [installModal, setInstallModal] = useState<{ courseId: string; courseTitle: string; remaining: number } | null>(null);
  const [installAmount, setInstallAmount] = useState('');
  const [installIframeUrl, setInstallIframeUrl] = useState('');
  const [installLoading, setInstallLoading] = useState(false);
  const [installError, setInstallError] = useState('');

  /* profile editing */
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState('');

  /* English name for certificate */
  const [newNameEn, setNewNameEn] = useState('');
  const [nameEnMsg, setNameEnMsg] = useState('');

  /* password change */
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [showPw, setShowPw] = useState(false);

  /* avatar (stored in localStorage) */
  const [avatarDataUrl, setAvatarDataUrl] = useState<string>('');
  const avatarInputRef = useRef<HTMLInputElement>(null);

  /* quiz taking state */
  const [quizModal, setQuizModal] = useState<{ courseId: string; quizId: string } | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<number[]>([]);
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);

  useEffect(() => {
    if (authUser) {
      setNewName(authUser.displayName || '');
      const saved = localStorage.getItem(`avatar-${authUser.uid}`);
      if (saved) setAvatarDataUrl(saved);
    }
  }, [authUser]);

  // Keep nameEn in sync when subscriber loads
  useEffect(() => {
    const sub = subscribers.find(s =>
      s.email.toLowerCase().trim() === (authUser?.email || '').toLowerCase().trim()
    );
    if (sub?.nameEn) setNewNameEn(sub.nameEn);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribers]);

  // ── Heartbeat: report online presence every 30s ──────────────────────────
  useEffect(() => {
    if (!authUser) return;
    const fire = () => mysqlClient.heartbeat(authUser.displayName || authUser.email || '').catch(() => {});
    fire();
    const id = setInterval(fire, 30_000);
    return () => clearInterval(id);
  }, [authUser?.uid]);

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const subscriber = authUser?.email
    ? subscribers.find(
        s => s.email.toLowerCase().trim() === (authUser.email || '').toLowerCase().trim()
      )
    : undefined;

  /* ── Loading ── */
  if (authUser === undefined || !remoteReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  /* ── Not logged in ── */
  if (!authUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 text-center p-8">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
          <User size={40} className="text-gray-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800">يرجى تسجيل الدخول أولاً</h2>
        <Link to="/auth" className="bg-primary-600 hover:bg-primary-700 text-white px-8 py-3 rounded-xl font-bold transition">
          تسجيل الدخول
        </Link>
      </div>
    );
  }

  const displayName = authUser.displayName || authUser.email?.split('@')[0] || 'مستخدم';
  const avatarBg = pickColor(authUser.email || '');
  const adminDashboardUrl = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    ? 'http://127.0.0.1:4100'
    : 'https://admin.mahadnafsy.com';

  // If the user is authenticated but has no subscriber record, their account was deleted
  // from the CRM. Show a clear message.
  // Exception: if they are a staff member, redirect them to the admin dashboard.
  // Wait for mySubscriberLoaded before concluding subscriber is missing (prevents race condition).
  // Admin users: mySubscriberLoaded is never set (admin loader is skipped), so bypass the wait.
  if (remoteReady && !subscriber && !mySubscriberLoaded && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }
  if (remoteReady && (mySubscriberLoaded || isAdmin) && !subscriber) {
    // Wait until the async MySQL staff check resolves
    if (isStaffMember === null && !isAdmin) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      );
    }    if (isStaffMember && !isAdmin) {
      // Staff member — send them to the admin panel
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 text-center p-8" dir="rtl">
          <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center">
            <span className="text-4xl">🛡️</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-800">أهلاً {authUser.displayName || authUser.email?.split('@')[0]}</h2>
          <p className="text-gray-500 max-w-sm">حسابك كموظف — اللوحة الإدارية هي مكانك!</p>
          <button
            onClick={() => { window.location.href = adminDashboardUrl; }}
            className="bg-primary-600 hover:bg-primary-700 text-white px-8 py-3 rounded-xl font-bold transition"
          >انتقل للوحة الإدارية</button>
          <button
            onClick={() => { logout(); navigate('/'); }}
            className="text-sm text-gray-400 hover:text-gray-600 underline"
          >تسجيل الخروج</button>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 text-center p-8" dir="rtl">
        <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center">
          <span className="text-4xl">🎓</span>
        </div>
        <h2 className="text-2xl font-bold text-gray-800">مرحباً بك في معهد الدراسات النفسية!</h2>
        <p className="text-gray-600 max-w-sm">
          لم تنضم بعد إلى أي كورس.<br />
          تواصل معنا لتسجيلك وبدء رحلتك في علم النفس.
        </p>
        <p className="text-xs text-gray-400">{authUser.email}</p>
        <a
          href={`https://wa.me/${content['footer.whatsapp'] || '201096203090'}`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-xl font-bold transition flex items-center gap-2"
        >
          <span>💬</span> تواصل معنا على واتساب
        </a>
        <a
          href="/courses"
          className="bg-primary-600 hover:bg-primary-700 text-white px-8 py-3 rounded-xl font-bold transition"
        >
          استعرض كورساتنا
        </a>
        <button
          onClick={() => { logout(); navigate('/'); }}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          تسجيل الخروج
        </button>
      </div>
    );
  }

  if (!subscriber) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const enrolledCourses = subscriber
    ? courses.filter(c => subscriber.enrolledCourseIds.includes(String(c.id)))
    : [];

  const userConsultations = consultations.filter(
    c => c.clientEmail?.toLowerCase() === authUser.email?.toLowerCase()
  );

  // Per-course payment info (for installed subscriber)
  const subPayHistory = subscriber?.paymentHistory ?? [];
  const coursePayMap: Record<string, { paidEGP: number; expectedEGP?: number }> = {};
  subPayHistory.forEach(p => {
    // Only count course payments (not certificate/consultation/book/etc.) toward per-course totals
    const isCoursePayment = !p.paymentType || p.paymentType === 'course';
    if (p.courseId && isCoursePayment) {
      if (!coursePayMap[p.courseId]) coursePayMap[p.courseId] = { paidEGP: 0 };
      if (p.currency === 'EGP') coursePayMap[p.courseId].paidEGP += p.amount;
      if (p.isInstallment === false && p.courseExpected) coursePayMap[p.courseId].expectedEGP = p.courseExpected;
    }
  });

  /* ── handlers ── */
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target?.result as string;
      setAvatarDataUrl(url);
      localStorage.setItem(`avatar-${authUser.uid}`, url);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveName = async () => {
    if (!newName.trim()) return;
    setNameSaving(true);
    try {
      await mysqlAuth.updateProfile(newName.trim());
      setNameMsg('تم تحديث الاسم بنجاح ✓');
      setEditingName(false);
    } catch {
      setNameMsg('فشل التحديث، حاول مرة أخرى');
    }
    setNameSaving(false);
    setTimeout(() => setNameMsg(''), 3000);
  };

  const handleSaveNameEn = () => {
    const sub = subscribers.find(s =>
      s.email.toLowerCase().trim() === (authUser?.email || '').toLowerCase().trim()
    );
    if (!sub) return;
    updateSubscriber({ ...sub, nameEn: newNameEn.trim() });
    setNameEnMsg('Saved ✓');
    setTimeout(() => setNameEnMsg(''), 3000);
  };

  const handleInstallPay = () => {
    const amt = Number(installAmount);
    if (!amt || amt <= 0 || !installModal || !subscriber) return;
    const msg = encodeURIComponent(
      `مرحباً، أرغب في دفع قسط بمبلغ ${amt.toLocaleString()} ج.م\n` +
      `الكورس: ${installModal.courseTitle}\n` +
      `الاسم: ${subscriber.name || ''}\n` +
      `البريد الإلكتروني: ${subscriber.email || ''}`
    );
    window.open(`https://wa.me/201096203090?text=${msg}`, '_blank', 'noopener,noreferrer');
    setInstallIframeUrl('whatsapp_sent');
  };

  const handleChangePassword = async () => {
    if (pwNew.length < 8) { setPwMsg('Password must be at least 8 characters'); return; }
    if (pwNew !== pwConfirm) { setPwMsg('كلمتا المرور غير متطابقتين'); return; }
    if (pwNew.length < 6) { setPwMsg('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
    setPwSaving(true);
    try {
      await mysqlAuth.updatePassword(pwCurrent, pwNew);
      setPwMsg('تم تغيير كلمة المرور بنجاح ✓');
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('Current password incorrect')) {
        setPwMsg('كلمة المرور الحالية غير صحيحة');
      } else {
        setPwMsg('فشل تغيير كلمة المرور، حاول مرة أخرى');
      }
    }
    setPwSaving(false);
    setTimeout(() => setPwMsg(''), 4000);
  };

  const loadMyProofs = () => {
    mysqlClient.getMyPaymentProofs().then(rows => {
      setMyProofs(rows as unknown as PaymentProof[]);
      setProofsLoaded(true);
    }).catch(() => setProofsLoaded(true));
  };

  const handleProofImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setProofError('الصورة أكبر من 4 ميجابايت، يرجى ضغطها أولاً'); return; }
    setProofImageName(file.name);
    const reader = new FileReader();
    reader.onload = ev => setProofImage(ev.target?.result as string || null);
    reader.readAsDataURL(file);
  };

  const handleSubmitProof = async () => {
    if (!proofAmount || parseFloat(proofAmount) <= 0) { setProofError('أدخل المبلغ المدفوع'); return; }
    setProofSubmitting(true);
    setProofError('');
    try {
      const orders = await mysqlClient.getMyOrders();
      const pendingOrder = orders.find(order =>
        ['PENDING', 'PAYMENT_PENDING', 'AWAITING_PAYMENT'].includes(String(order.status).toUpperCase()) &&
        (!proofCourseId || String(order.item_id) === String(proofCourseId)) &&
        Number(order.amount) === Number(proofAmount) &&
        String(order.currency).toUpperCase() === proofCurrency
      );
      if (!pendingOrder) throw new Error('لا يوجد طلب معلّق مطابق. ابدأ الطلب من صفحة الكورس أولاً.');
      await mysqlClient.submitPaymentProof({
        order_id: pendingOrder.id,
        payment_method: proofMethod,
        proof_image: proofImage,
        note: proofNote || undefined,
      });
      setProofSuccess(true);
      setShowProofForm(false);
      setProofAmount(''); setProofNote(''); setProofImage(null); setProofImageName(''); setProofCourseId('');
      loadMyProofs();
      setTimeout(() => setProofSuccess(false), 5000);
    } catch (err: unknown) {
      setProofError(err instanceof Error ? err.message : 'حدث خطأ، حاول مرة أخرى');
    } finally { setProofSubmitting(false); }
  };

  /* ── Tabs ── */
  const unreadNotifications = notifications.filter(n => n.active && !dismissedNotifIds.includes(n.id));
  const approvedPosts = communityPosts.filter(p => !p.status || p.status === 'approved');
  const myQuizCount = enrolledCourses.filter(c => courseQuizzes.some(q => q.courseId === String(c.id))).length;
  const upcomingLives = liveStreams.filter(ls => {
    if (ls.status === 'ended') return false;
    if (ls.visibility === 'all_subscribers' && subscriber) return true;
    if (ls.visibility === 'community_and_subscribers' && subscriber) return true;
    if (ls.visibility === 'course_subscribers' && subscriber) {
      return ls.targetCourseIds.some(id => subscriber.enrolledCourseIds.includes(id));
    }
    return false;
  });
  /* ── Installment due alerts (for Bell count + Notifications tab) ── */
  const installmentAlerts = (() => {
    if (!subscriber?.installmentPlans?.length) return [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return subscriber.installmentPlans.flatMap(plan =>
      plan.entries
        .filter(e => !e.paidAt && e.dueDate <= next7)
        .map(e => ({
          planId: plan.id,
          entryId: e.id,
          courseTitle: plan.courseTitle || 'قسط عام',
          amount: e.amount,
          currency: plan.currency,
          dueDate: e.dueDate,
          isOverdue: e.dueDate < todayStr,
          daysOverdue: e.dueDate < todayStr ? Math.floor((Date.now() - new Date(e.dueDate).getTime()) / 86400000) : 0,
          daysLeft: e.dueDate >= todayStr ? Math.ceil((new Date(e.dueDate).getTime() - Date.now()) / 86400000) : 0,
        }))
    ).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  })();

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'overview',      label: 'الرئيسية',   icon: <Sparkles size={15} /> },
    { id: 'learning',      label: 'كورساتي',    icon: <BookOpen size={15} />,      count: enrolledCourses.length || undefined },
    { id: 'consultations', label: 'استشاراتي',  icon: <MessageSquare size={15} />, count: userConsultations.length || undefined },
    { id: 'community',     label: 'المجتمع',    icon: <Users size={15} />,          count: approvedPosts.length || undefined },
    { id: 'account',       label: 'حسابي',      icon: <User size={15} />,           count: (unreadNotifications.length + installmentAlerts.length) || undefined },
  ];

  const statusColors: Record<string, string> = {
    pending:   'bg-yellow-100 text-yellow-700',
    confirmed: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  const statusLabels: Record<string, string> = {
    pending: 'قيد الانتظار', confirmed: 'مؤكدة', completed: 'مكتملة', cancelled: 'ملغاة',
  };

  return (
    <>
      {/* Full-screen video player */}
      {playerCourseId && (
        <React.Suspense fallback={<div className="fixed inset-0 z-[100] bg-black flex items-center justify-center text-white" dir="rtl">جاري تحميل مشغل الفيديو...</div>}>
          <VideoPlayer courseId={playerCourseId} onClose={() => setPlayerCourseId(null)} />
        </React.Suspense>
      )}

      <div className="min-h-screen bg-gray-50" dir="rtl">

        {realtimeNotice && (
          <div className="flex items-start gap-3 bg-emerald-600 px-4 py-3 text-white">
            <Bell size={18} className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0 flex-1 text-sm font-medium">{realtimeNotice}</div>
            <button
              type="button"
              onClick={() => setRealtimeNotice('')}
              className="rounded-lg bg-white/10 px-2 py-1 text-xs font-bold hover:bg-white/20"
            >
              إغلاق
            </button>
          </div>
        )}

        {/* Notification banner */}
        {notifications
          .filter(n => n.active && !dismissedNotifIds.includes(n.id))
          .slice(0, 1)
          .map(n => {
            const bg = n.type === 'offer' ? 'bg-orange-500' : n.type === 'update' ? 'bg-blue-600' : 'bg-primary-600';
            return (
              <div key={n.id} className={`${bg} text-white px-4 py-3 flex items-start gap-3`}>
                <Bell size={18} className="flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm">{n.title}</span>
                  {n.body && <span className="text-white/90 text-sm mr-2">{n.body}</span>}
                </div>
                <button
                  onClick={() => {
                    const next = [...dismissedNotifIds, n.id];
                    setDismissedNotifIds(next);
                    localStorage.setItem('dismissed-notifs', JSON.stringify(next));
                  }}
                  className="flex-shrink-0 text-white/80 hover:text-white transition text-xl leading-none"
                >&times;</button>
              </div>
            );
          })}

        {/* ── Sidebar + content layout ── */}
        <div className="flex">

          {/* ── Right sidebar ── */}
          <aside className="w-64 bg-white border-l border-gray-100 flex-shrink-0 hidden md:flex flex-col h-screen sticky top-0 shadow-sm overflow-hidden">

            {/* Profile section */}
            <div className="p-5 border-b border-gray-100 flex-shrink-0">
              <div className="flex flex-col items-center text-center gap-2 mb-4">

                {/* Avatar */}
                <div className="relative group mt-1">
                  <div className={`w-20 h-20 rounded-full border-4 border-gray-100 overflow-hidden flex items-center justify-center text-2xl font-extrabold text-white ${!avatarDataUrl ? avatarBg : ''}`}>
                    {avatarDataUrl
                      ? <img src={avatarDataUrl} alt="avatar" className="w-full h-full object-cover" />
                      : displayName.charAt(0).toUpperCase()}
                  </div>
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                    title="تغيير الصورة"
                  >
                    <Camera size={18} className="text-white" />
                  </button>
                  <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
                </div>

                {/* Name editing */}
                {editingName ? (
                  <div className="flex items-center gap-1.5 w-full">
                    <input
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-gray-800 text-sm font-bold flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-primary-300"
                      autoFocus
                    />
                    <button onClick={handleSaveName} disabled={nameSaving} className="bg-green-500 hover:bg-green-600 p-1 rounded-lg text-white transition flex-shrink-0">
                      <Save size={12} />
                    </button>
                    <button onClick={() => setEditingName(false)} className="bg-gray-100 hover:bg-gray-200 p-1 rounded-lg transition flex-shrink-0">
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <h1 className="text-gray-800 font-extrabold text-base leading-snug">{displayName}</h1>
                    <button onClick={() => { setEditingName(true); setNewName(displayName); }} className="text-gray-300 hover:text-gray-500 transition" title="تعديل الاسم">
                      <Edit3 size={12} />
                    </button>
                  </div>
                )}

                {nameMsg && <p className="text-green-600 text-xs">{nameMsg}</p>}
                <p className="text-gray-400 text-xs">{authUser.email}</p>
              </div>

              {/* Stats mini grid */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'كورساتي',  val: enrolledCourses.length,     icon: <BookOpen size={12} />,      color: 'bg-sky-50 text-sky-600' },
                  { label: 'استشارات', val: userConsultations.length,   icon: <MessageSquare size={12} />, color: 'bg-violet-50 text-violet-600' },
                  { label: 'شهادات',   val: (subscriber?.extraCertificateRequests?.filter(r => r.status === 'issued').length || 0) + enrolledCourses.filter(c => { const lecs = getCourseLectures(c.id); const total = lecs.length; if (total === 0) return true; const watched = Object.entries(subscriber?.lectureProgress || {}).filter(([lid, pct]) => lecs.some(l => String(l.id) === lid) && (pct as number) >= 90).length; return watched === total; }).length, icon: <Award size={12} />, color: 'bg-amber-50 text-amber-600' },
                  { label: 'إشعارات', val: unreadNotifications.length,  icon: <Bell size={12} />,          color: 'bg-rose-50 text-rose-600' },
                ].map((s, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-2.5 flex items-center gap-2">
                    <span className={`p-1.5 rounded-lg ${s.color}`}>{s.icon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-gray-800 leading-none">{s.val}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{s.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Vertical tab navigation */}
            <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={[
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition',
                    activeTab === t.id
                      ? 'bg-primary-50 text-primary-700 font-bold'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800',
                  ].join(' ')}
                >
                  <span className={`flex-shrink-0 ${activeTab === t.id ? 'text-primary-600' : 'text-gray-400'}`}>{t.icon}</span>
                  <span className="flex-1 text-right">{t.label}</span>
                  {t.count !== undefined && t.count > 0 && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${activeTab === t.id ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'}`}>
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>

            {/* Logout */}
            <div className="p-4 border-t border-gray-100 flex-shrink-0">
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 text-red-500 hover:bg-red-50 border border-red-200 px-4 py-2.5 rounded-xl text-sm font-bold transition"
              >
                <LogOut size={14} /> تسجيل الخروج
              </button>
            </div>
          </aside>

          {/* ── Main content ── */}
          <main className="flex-1 min-w-0 bg-slate-50 pb-20 md:pb-0">
            <div className="px-4 py-5 md:px-7 md:py-7">

          {/* ════ OVERVIEW ════ */}
          {activeTab === 'overview' && (() => {
            const totalPaidEGP = (subscriber?.paymentHistory ?? []).filter(p => p.currency === 'EGP').reduce((s, p) => s + p.amount, 0);
            const totalPaidSAR = (subscriber?.paymentHistory ?? []).filter(p => p.currency === 'SAR').reduce((s, p) => s + p.amount, 0);
            const totalPaidUSD = (subscriber?.paymentHistory ?? []).filter(p => p.currency === 'USD').reduce((s, p) => s + p.amount, 0);
            const earnedCertsCount = (subscriber?.extraCertificateRequests?.filter(r => r.status === 'issued').length || 0)
              + enrolledCourses.filter(c => {
                  const lecs = getCourseLectures(c.id);
                  const total = lecs.length;
                  if (total === 0) return true;
                  const watched = Object.entries(subscriber?.lectureProgress || {}).filter(([lid, pct]) => lecs.some(l => String(l.id) === lid) && (pct as number) >= 90).length;
                  return watched === total;
                }).length;
            return (
              <div className="space-y-6">

                {/* Welcome + summary cards */}
                <div className="bg-white rounded-2xl border border-gray-100 p-5 glass-card-premium shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary-500/20 transition-all duration-300 hover:-translate-y-2 border-white/50 backdrop-blur-xl bg-white/70">
                  <h2 className="text-lg font-extrabold text-gray-800 mb-1">أهلاً، {displayName} 👋</h2>
                  <p className="text-gray-400 text-sm mb-5">هذه نظرة شاملة على حسابك ونشاطك</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: 'كورس مشترك',  val: enrolledCourses.length,      icon: <BookOpen size={18} />,      color: 'bg-sky-50 text-sky-600',     onClick: () => { setActiveTab('learning'); setLearningSection('courses'); } },
                      { label: 'استشارة',     val: userConsultations.length,    icon: <MessageSquare size={18} />, color: 'bg-violet-50 text-violet-600', onClick: () => setActiveTab('consultations') },
                      { label: 'شهادة',        val: earnedCertsCount,            icon: <Award size={18} />,         color: 'bg-amber-50 text-amber-600',  onClick: () => { setActiveTab('learning'); setLearningSection('certificates'); } },
                      { label: 'دفعة مسجلة',  val: subscriber?.paymentHistory?.length ?? 0, icon: <CreditCard size={18} />, color: 'bg-green-50 text-green-600', onClick: () => { setActiveTab('account'); setAccountSection('payments'); } },
                    ].map((s, i) => (
                      <button key={i} onClick={s.onClick}
                        className="flex flex-col items-center gap-1.5 p-4 rounded-2xl border border-gray-100 hover:shadow-md hover:border-gray-200 transition text-center">
                        <span className={`p-2.5 rounded-xl ${s.color}`}>{s.icon}</span>
                        <p className="text-2xl font-extrabold text-gray-800">{s.val}</p>
                        <p className="text-xs text-gray-400">{s.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Engagement hero — continue learning + progress + certificate */}
                <StudentEngagementHero
                  enrolledCourses={enrolledCourses}
                  lectureProgress={subscriber?.lectureProgress || {}}
                  getCourseLectures={(id) => getCourseLectures(String(id))}
                  onResume={(cid) => { setActiveTab('learning'); setLearningSection('courses'); setPlayerCourseId(cid); }}
                  onBrowse={() => navigate('/courses')}
                />

                {/* Referral CTA — surfaced on the home tab (was buried in account → referral) */}
                <button
                  onClick={() => { setActiveTab('account'); setAccountSection('referral'); }}
                  className="w-full text-right bg-gradient-to-l from-emerald-600 to-teal-600 rounded-2xl p-5 text-white shadow flex items-center justify-between gap-3 hover:from-emerald-700 hover:to-teal-700 transition">
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-2xl bg-white/20 grid place-items-center text-2xl">🎁</span>
                    <div>
                      <p className="font-extrabold text-base">ادعُ أصدقاءك واكسب مكافآت</p>
                      <p className="text-xs text-white/80">شارك كود الدعوة — كل صديق يشترك يفيدكما معاً</p>
                    </div>
                  </div>
                  <Share2 size={20} className="shrink-0 opacity-80" />
                </button>

                {/* Total paid summary */}
                <div className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-2xl p-5 text-white shadow">
                  <p className="text-sm font-bold text-white/70 mb-1">إجمالي ما دفعته</p>
                  <div className="flex flex-wrap gap-4 items-end">
                    {totalPaidEGP > 0 && <p className="text-3xl font-extrabold">{totalPaidEGP.toLocaleString()} <span className="text-base font-medium">ج.م</span></p>}
                    {totalPaidSAR > 0 && <p className="text-3xl font-extrabold">{totalPaidSAR.toLocaleString()} <span className="text-base font-medium">ر.س</span></p>}
                    {totalPaidUSD > 0 && <p className="text-3xl font-extrabold">{totalPaidUSD.toLocaleString()} <span className="text-base font-medium">$</span></p>}
                    {totalPaidEGP + totalPaidSAR + totalPaidUSD === 0 && <p className="text-xl font-bold text-white/60">لا توجد مدفوعات بعد</p>}
                  </div>
                  <button onClick={() => { setActiveTab('account'); setAccountSection('payments'); }} className="mt-3 text-xs text-white/70 hover:text-white underline transition">عرض سجل المدفوعات كاملاً ←</button>
                </div>

                {/* Enrolled courses quick view */}
                {enrolledCourses.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-extrabold text-gray-700 text-sm">كورساتي</h3>
                      <button onClick={() => { setActiveTab('learning'); setLearningSection('courses'); }} className="text-xs text-primary-600 hover:underline">عرض الكل</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {enrolledCourses.slice(0, 6).map(course => {
                        const lecs = getCourseLectures(course.id);
                        const total = lecs.length;
                        const watched = total > 0 ? Object.entries(subscriber?.lectureProgress || {}).filter(([lid, pct]) => lecs.some(l => String(l.id) === lid) && (pct as number) >= 90).length : 0;
                        const pct = total > 0 ? Math.round((watched / total) * 100) : 100; // no lectures = fully open course
                        const hasLectures = total > 0;
                        return (
                          <button
                            key={course.id}
                            onClick={() => setPlayerCourseId(String(course.id))}
                            className="bg-white rounded-2xl overflow-hidden border border-gray-100 flex gap-3 p-3 items-center hover: hover:border-primary-200 text-right w-full group glass-card-premium shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary-500/20 transition-all duration-300 hover:-translate-y-2 border-white/50 backdrop-blur-xl bg-white/70"
                          >
                            <div className="relative flex-shrink-0">
                              <img src={course.thumbnail} alt={course.title} className="w-14 h-14 rounded-xl object-cover" />
                              <div className="absolute inset-0 rounded-xl bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                <Play size={18} className="text-white" />
                              </div>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-gray-800 line-clamp-1 mb-1 group-hover:text-primary-600 transition">{course.title}</p>
                              {hasLectures ? (
                                <>
                                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                                    <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                  <p className="text-[11px] text-gray-400">{watched}/{total} محاضرة • {pct}% مكتمل</p>
                                </>
                              ) : (
                                <p className="text-[11px] text-primary-500 font-medium">▶ اضغط لمشاهدة الكورس</p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Recent payments quick view */}
                {(subscriber?.paymentHistory?.length ?? 0) > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-extrabold text-gray-700 text-sm">آخر المدفوعات</h3>
                      <button onClick={() => { setActiveTab('account'); setAccountSection('payments'); }} className="text-xs text-primary-600 hover:underline">عرض الكل</button>
                    </div>
                    <div className="bg-white rounded-2xl border border-gray-100 overflow-x-auto glass-card-premium shadow-xl shadow-gray-200/50 hover:shadow-2xl hover:shadow-primary-500/20 transition-all duration-300 hover:-translate-y-2 border-white/50 backdrop-blur-xl bg-white/70">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs">المبلغ</th>
                            <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs">طريقة الدفع</th>
                            <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs">ملاحظة</th>
                            <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs">التاريخ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(subscriber?.paymentHistory ?? []).slice(-5).reverse().map(p => (
                            <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                              <td className="px-4 py-2.5 font-bold text-primary-700">{p.amount.toLocaleString()} {p.currency === 'EGP' ? 'ج.م' : p.currency === 'SAR' ? 'ر.س' : '$'}</td>
                              <td className="px-4 py-2.5 text-gray-500 text-xs">{p.paymentMethod || '—'}</td>
                              <td className="px-4 py-2.5 text-gray-400 text-xs">{p.note || '—'}</td>
                              <td className="px-4 py-2.5 text-gray-400 text-xs">{p.at}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              </div>
            );
          })()}

          {/* ════ LEARNING SUB-NAV ════ */}
          {activeTab === 'learning' && (
            <StudentDashboardSectionNav
              items={[
                { id: 'courses' as LearningSection,      label: 'كورساتي',       icon: <BookOpen size={14} />,   count: enrolledCourses.length || 0 },
                { id: 'certificates' as LearningSection, label: 'شهاداتي',       icon: <Award size={14} /> },
                { id: 'materials' as LearningSection,    label: 'المادة العلمية', icon: <FileText size={14} /> },
                { id: 'quiz' as LearningSection,         label: 'اختباراتي',     icon: <CheckCircle size={14} />, count: myQuizCount || 0 },
                { id: 'live' as LearningSection,         label: 'البث المباشر',  icon: <Radio size={14} />,      count: upcomingLives.filter(l => l.status === 'live').length },
              ]}
              activeId={learningSection}
              onChange={setLearningSection}
            />
          )}

          {/* ════ COURSES ════ */}
          <React.Suspense fallback={<StudentTabFallback />}>
          {activeTab === 'learning' && learningSection === 'courses' && (
            <StudentCoursesTab
              enrolledCourses={enrolledCourses}
              subscriber={subscriber}
              coursePayMap={coursePayMap}
              contentWhatsapp={content['footer.whatsapp'] || '201096203090'}
              getCourseLectures={(id) => getCourseLectures(String(id))}
              onOpenPlayer={(courseId) => setPlayerCourseId(courseId)}
              onOpenCertificates={() => { setLearningSection('certificates'); }}
              setInstallModal={setInstallModal}
              setInstallAmount={setInstallAmount}
              setInstallIframeUrl={setInstallIframeUrl}
              setInstallError={setInstallError}
            />
          )}

          {/* ════ CONSULTATIONS ════ */}
          {activeTab === 'consultations' && <StudentConsultationsTab consultations={userConsultations} />}
          {/* Certificates */}
          {activeTab === 'learning' && learningSection === 'certificates' && subscriber && (
            <StudentCertificatesTab
              subscriber={subscriber}
              enrolledCourses={enrolledCourses}
              getCourseLectures={(id) => getCourseLectures(String(id))}
              setPlayerCourseId={setPlayerCourseId}
              setCertModal={setCertModal}
              content={content}
              refreshMySubscriber={refreshMySubscriber}
            />
          )}

          {/* Certificate modal */}
          {certModal && (() => {
            const course = courses.find(c => c.id === certModal.courseId);
            if (!course || !subscriber) return null;
            const courseLectures = getCourseLectures(course.id);
            const certNum = subscriber.clientCode || `PSY-${subscriber.id.slice(-6).toUpperCase()}`;
            const issuedDate = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
            const hoursLabel = course.duration || '';
            return (
              <CourseCertificate
                studentName={subscriber.name}
                studentNameEn={subscriber.nameEn}
                courseName={course.title}
                courseNameEn={course.titleEn}
                instructorName={course.instructor}
                lectureCount={courseLectures.length || Number(course.students)}
                hoursLabel={hoursLabel}
                certNumber={certNum}
                issuedAt={issuedDate}
                onClose={() => setCertModal(null)}
              />
            );
          })()}

          {/* Installment payment modal */}
          {installModal && (
            <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" dir="rtl" onClick={e => { if (e.target === e.currentTarget && !installIframeUrl) { setInstallModal(null); setInstallIframeUrl(''); } }}>
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="bg-amber-600 text-white px-6 py-4 flex items-center justify-between">
                  <div>
                    <p className="font-extrabold text-base">دفع قسط</p>
                    <p className="text-amber-100 text-xs mt-0.5 line-clamp-1">{installModal.courseTitle}</p>
                  </div>
                  <button onClick={() => { setInstallModal(null); setInstallIframeUrl(''); setInstallError(''); }} className="text-amber-100 hover:text-white transition">
                    <X size={22} />
                  </button>
                </div>
                <div className="p-6 space-y-4">
                  {installIframeUrl === 'whatsapp_sent' ? (
                    <div className="text-center space-y-4 py-4">
                      <div className="text-5xl">✅</div>
                      <p className="font-bold text-gray-800">تم فتح واتساب!</p>
                      <p className="text-sm text-gray-500">سيتواصل معك فريقنا لتأكيد استلام الدفعة وتسجيلها.</p>
                    </div>
                  ) : (
                    <>
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
                        <p className="text-amber-700"><strong>الباقي من المبلغ:</strong> {installModal.remaining.toLocaleString()} ج.م</p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1">المبلغ الذي تريد دفعه (ج.م)</label>
                        <input
                          type="number"
                          min={1}
                          max={installModal.remaining}
                          value={installAmount}
                          onChange={e => setInstallAmount(e.target.value)}
                          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-lg font-bold focus:border-amber-400 focus:outline-none"
                          placeholder="أدخل المبلغ"
                          dir="ltr"
                        />
                        <p className="text-[11px] text-gray-400 mt-1">الحد الأقصى: {installModal.remaining.toLocaleString()} ج.م</p>
                      </div>
                      {installError && (
                        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-700">
                          {installError}
                        </div>
                      )}
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 text-center">
                        الدفع الإلكتروني متوقف مؤقتاً — سيتم التواصل عبر واتساب
                      </div>
                      <button
                        onClick={handleInstallPay}
                        disabled={!installAmount || Number(installAmount) <= 0}
                        className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3.5 rounded-xl transition disabled:opacity-50"
                      >
                        <MessageSquare size={18} />
                        تواصل عبر واتساب — {Number(installAmount) > 0 ? `${Number(installAmount).toLocaleString()} ج.م` : '...'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ════ ACCOUNT SUB-NAV ════ */}
          {activeTab === 'account' && (
            <StudentDashboardSectionNav
              items={[
                { id: 'payments' as AccountSection,      label: 'المدفوعات',  icon: <CreditCard size={14} /> },
                { id: 'notifications' as AccountSection, label: 'الإشعارات', icon: <Bell size={14} />, count: (unreadNotifications.length + installmentAlerts.length) },
                { id: 'loyalty' as AccountSection,       label: 'الولاء', icon: <Gift size={14} /> },
                { id: 'referral' as AccountSection,      label: 'الإحالة',   icon: <Share2 size={14} /> },
                { id: 'support' as AccountSection,       label: 'الدعم',     icon: <MessageSquare size={14} /> },
                { id: 'settings' as AccountSection,      label: 'الإعدادات', icon: <Settings size={14} /> },
              ]}
              activeId={accountSection}
              onChange={setAccountSection}
            />
          )}

          {/* ════ PAYMENTS ════ */}
          {activeTab === 'account' && accountSection === 'payments' && (
            <StudentPaymentsTab
              subscriber={subscriber}
              enrolledCourses={enrolledCourses}
              coursePayMap={coursePayMap}
              showProofForm={showProofForm}
              proofAmount={proofAmount}
              proofCurrency={proofCurrency}
              proofMethod={proofMethod}
              proofCourseId={proofCourseId}
              proofNote={proofNote}
              proofImage={proofImage}
              proofImageName={proofImageName}
              proofSubmitting={proofSubmitting}
              proofSuccess={proofSuccess}
              proofError={proofError}
              myProofs={myProofs}
              proofsLoaded={proofsLoaded}
              setShowProofForm={setShowProofForm}
              setProofAmount={setProofAmount}
              setProofCurrency={setProofCurrency}
              setProofMethod={setProofMethod}
              setProofCourseId={setProofCourseId}
              setProofNote={setProofNote}
              setInstallModal={setInstallModal}
              setInstallAmount={setInstallAmount}
              setInstallIframeUrl={setInstallIframeUrl}
              setInstallError={setInstallError}
              onOpenCourses={() => { setActiveTab('learning'); setLearningSection('courses'); }}
              loadMyProofs={loadMyProofs}
              handleProofImageChange={handleProofImageChange}
              handleSubmitProof={handleSubmitProof}
            />
          )}

          {/* ════ MATERIALS ════ */}
          {activeTab === 'learning' && learningSection === 'materials' && (
            <StudentMaterialsTab subscriber={subscriber} enrolledCourses={enrolledCourses} />
          )}

          {/* ════ QUIZ TAB ════ */}
          {activeTab === 'learning' && learningSection === 'quiz' && (
            <StudentQuizTab
              subscriber={subscriber}
              enrolledCourses={enrolledCourses}
              courseQuizzes={courseQuizzes}
              quizAttempts={quizAttempts}
              quizModal={quizModal}
              quizAnswers={quizAnswers}
              quizSubmitted={quizSubmitted}
              quizScore={quizScore}
              setQuizModal={setQuizModal}
              setQuizAnswers={setQuizAnswers}
              setQuizSubmitted={setQuizSubmitted}
              setQuizScore={setQuizScore}
              addQuizAttempt={addQuizAttempt}
            />
          )}

          {/* ════ LIVE STREAMS TAB ════ */}
          {activeTab === 'learning' && learningSection === 'live' && (
            <StudentLiveStreamsTab upcomingLives={upcomingLives} />
          )}

          {/* ════ NOTIFICATIONS ════ */}
          {activeTab === 'account' && accountSection === 'notifications' && (
            <StudentNotificationsTab
              notifications={notifications}
              unreadNotifications={unreadNotifications}
              dismissedNotifIds={dismissedNotifIds}
              installmentAlerts={installmentAlerts}
              onMarkAllRead={() => {
                const allIds = notifications.map(n => n.id);
                setDismissedNotifIds(allIds);
                localStorage.setItem('dismissed-notifs', JSON.stringify(allIds));
              }}
              onDismissNotification={(id) => {
                const next = [...dismissedNotifIds, id];
                setDismissedNotifIds(next);
                localStorage.setItem('dismissed-notifs', JSON.stringify(next));
              }}
              onOpenPayments={() => {
                setActiveTab('account');
                setAccountSection('payments');
              }}
            />
          )}
          {activeTab === 'account' && accountSection === 'loyalty' && (
            <StudentLoyaltyTab />
          )}

          {/* ════ COMMUNITY ════ */}
          {activeTab === 'community' && (
            <StudentCommunityTab approvedPosts={approvedPosts} />
          )}


          {/* ════ REFERRAL ════ */}
          {activeTab === 'account' && accountSection === 'referral' && (
            <StudentReferralTab
              referralCode={referralCode}
              referralStats={referralStats}
              referralCopied={referralCopied}
              onCopied={() => {
                setReferralCopied(true);
                setTimeout(() => setReferralCopied(false), 2000);
              }}
            />
          )}
          {/* ════ SUPPORT TICKETS ════ */}
          {activeTab === 'account' && accountSection === 'support' && <StudentSupportTab token={localStorage.getItem('mahad-token') || ''} />}

          {/* ════ SETTINGS ════ */}
          {activeTab === 'account' && accountSection === 'settings' && (
            <StudentSettingsTab
              displayName={displayName}
              avatarDataUrl={avatarDataUrl}
              avatarBg={avatarBg}
              avatarInputRef={avatarInputRef}
              editingName={editingName}
              newName={newName}
              setEditingName={setEditingName}
              setNewName={setNewName}
              onSaveName={handleSaveName}
              nameSaving={nameSaving}
              nameMsg={nameMsg}
              newNameEn={newNameEn}
              setNewNameEn={setNewNameEn}
              onSaveNameEn={handleSaveNameEn}
              nameEnMsg={nameEnMsg}
              authUser={authUser}
              subscriber={subscriber}
              showPw={showPw}
              setShowPw={setShowPw}
              pwCurrent={pwCurrent}
              setPwCurrent={setPwCurrent}
              pwNew={pwNew}
              setPwNew={setPwNew}
              pwConfirm={pwConfirm}
              setPwConfirm={setPwConfirm}
              pwMsg={pwMsg}
              pwSaving={pwSaving}
              onChangePassword={handleChangePassword}
              onLogout={handleLogout}
            />
          )}
          </React.Suspense>

            </div>
          </main>
        </div>

        {/* Mobile bottom tab bar */}
        <div className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-100 flex z-50 shadow-md">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={[
                'flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium transition min-w-[48px]',
                activeTab === t.id ? 'text-primary-600' : 'text-gray-400',
              ].join(' ')}
            >
              {t.icon}
              <span className="text-[10px] leading-tight">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

export default UserDashboard;
