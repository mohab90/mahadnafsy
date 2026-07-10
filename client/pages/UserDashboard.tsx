import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen, Award, Clock, LogOut, User, ChevronRight, Star, CheckCircle,
  Bell, Settings, MessageSquare, CreditCard, Play, Lock, Edit3, Camera,
  Eye, EyeOff, Save, X, Calendar, Video, Phone, AlertCircle,
  ChevronDown, ChevronUp, FileText, Download, Loader2, DollarSign,
  Users, Sparkles, ExternalLink, ThumbsUp, Radio, Share2, Copy, Gift, Plus,
} from 'lucide-react';
import { mysqlAuth, mysqlClient } from '../lib/mysqlapi';
import type { PaymentProof } from '../types';
import { useSiteData } from '../context/SiteDataContext';
import CourseCertificate from '../components/CourseCertificate';
import StudentEngagementHero from '../components/student-dashboard/StudentEngagementHero';
import { StudentCoursesTab } from '../components/student-dashboard/StudentCoursesTab';
import { StudentPaymentsTab } from '../components/student-dashboard/StudentPaymentsTab';
import { StudentMaterialsTab } from '../components/student-dashboard/StudentMaterialsTab';
import { StudentQuizTab } from '../components/student-dashboard/StudentQuizTab';
import PaymentsTab from './PaymentsTab';
import { OverviewTab } from './dashboard-sections/OverviewTab';
import { ConsultationsTab } from './dashboard-sections/ConsultationsTab';
import { CertificatesTab } from './dashboard-sections/CertificatesTab';
import { LiveStreamsTab } from './dashboard-sections/LiveStreamsTab';
import { NotificationsTab } from './dashboard-sections/NotificationsTab';
import { CommunityTab } from './dashboard-sections/CommunityTab';
import { ReferralTab } from './dashboard-sections/ReferralTab';
import { SettingsTab } from './dashboard-sections/SettingsTab';
import { SupportTab } from './dashboard-sections/SupportTab';

const VideoPlayer = React.lazy(() =>
  import('../components/UserDashboardVideoPlayer').then((module) => ({ default: module.VideoPlayer }))
);


/* ─── helpers ─────────────────────────────────────────────────────────────── */
const AVATAR_COLORS = [
  'bg-primary-600', 'bg-red-500', 'bg-emerald-600',
  'bg-amber-500', 'bg-purple-600', 'bg-sky-600',
];
const pickColor = (email: string) =>
  AVATAR_COLORS[email.charCodeAt(0) % AVATAR_COLORS.length];

type Tab = 'overview' | 'learning' | 'consultations' | 'community' | 'payments' | 'account';
type LearningSection = 'courses' | 'certificates' | 'materials' | 'quiz' | 'live';
type AccountSection = 'payments' | 'notifications' | 'referral' | 'support' | 'settings';

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

  // Deep-link portal sections: ?tab=account&section=payments (used by PaymentSuccess, emails, etc.)
  const [dashSearchParams] = useSearchParams();
  useEffect(() => {
    const t = dashSearchParams.get('tab');
    const s = dashSearchParams.get('section');
    if (t && ['overview', 'learning', 'consultations', 'community', 'payments', 'account'].includes(t)) setActiveTab(t as Tab);
    if (s && ['payments', 'notifications', 'referral', 'support', 'settings'].includes(s)) {
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

  const subscriber = subscribers.find(
    s => s.email.toLowerCase().trim() === (authUser.email || '').toLowerCase().trim()
  );

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
  // Admin users without a subscriber record → send to admin dashboard directly
  if (isAdmin && !subscriber) {
    navigate('/dashboard');
    return null;
  }
  if (remoteReady && mySubscriberLoaded && !subscriber) {
    // Wait until the async MySQL staff check resolves
    if (isStaffMember === null) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      );
    }    if (isStaffMember) {
      // Staff member — send them to the admin panel
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 text-center p-8" dir="rtl">
          <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center">
            <span className="text-4xl">🛡️</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-800">أهلاً {authUser.displayName || authUser.email?.split('@')[0]}</h2>
          <p className="text-gray-500 max-w-sm">حسابك كموظف — اللوحة الإدارية هي مكانك!</p>
          <button
            onClick={() => navigate('/dashboard')}
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
        <h2 className="text-2xl font-bold text-gray-800">مرحباً بك في معهد مهاد!</h2>
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
      await mysqlClient.submitPaymentProof({
        amount: parseFloat(proofAmount),
        currency: proofCurrency,
        course_id: proofCourseId || null,
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
    { id: 'payments',      label: 'مدفوعاتي',   icon: <CreditCard size={15} />,     count: installmentAlerts.length || undefined },
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
                      ? <img loading="lazy" decoding="async" src={avatarDataUrl} alt="avatar" className="w-full h-full object-cover" />
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
          {activeTab === 'overview' && (
            <OverviewTab
              displayName={displayName}
              enrolledCourses={enrolledCourses}
              userConsultations={userConsultations}
              subscriber={subscriber}
              getCourseLectures={getCourseLectures}
              setActiveTab={setActiveTab}
              setLearningSection={setLearningSection}
              setAccountSection={setAccountSection}
              setPlayerCourseId={setPlayerCourseId}
            />
          )}



          {/* ════ LEARNING SUB-NAV ════ */}
          {activeTab === 'learning' && (
            <div className="flex gap-2 mb-5 flex-wrap">
              {([
                { id: 'courses' as LearningSection,      label: 'كورساتي',       icon: <BookOpen size={14} />,   count: enrolledCourses.length || 0 },
                { id: 'certificates' as LearningSection, label: 'شهاداتي',       icon: <Award size={14} /> },
                { id: 'materials' as LearningSection,    label: 'المادة العلمية', icon: <FileText size={14} /> },
                { id: 'quiz' as LearningSection,         label: 'اختباراتي',     icon: <CheckCircle size={14} />, count: myQuizCount || 0 },
                { id: 'live' as LearningSection,         label: 'البث المباشر',  icon: <Radio size={14} />,      count: upcomingLives.filter(l => l.status === 'live').length },
              ] as { id: LearningSection; label: string; icon: React.ReactNode; count?: number }[]).map(s => (
                <button key={s.id} onClick={() => setLearningSection(s.id)}
                  className={[
                    'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition',
                    learningSection === s.id ? 'bg-primary-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300',
                  ].join(' ')}>
                  {s.icon} {s.label}
                  {s.count !== undefined && s.count > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${learningSection === s.id ? 'bg-white/25 text-white' : 'bg-primary-100 text-primary-700'}`}>{s.count}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* ════ COURSES ════ */}
          {activeTab === 'learning' && learningSection === 'courses' && (
            <StudentCoursesTab
              enrolledCourses={enrolledCourses}
              subscriber={subscriber}
              coursePayMap={coursePayMap}
              contentWhatsapp={content['footer.whatsapp'] || '201096203090'}
              getCourseLectures={getCourseLectures}
              onOpenPlayer={(courseId) => setPlayerCourseId(courseId)}
              onOpenCertificates={() => { setLearningSection('certificates'); }}
              setInstallModal={setInstallModal}
              setInstallAmount={setInstallAmount}
              setInstallIframeUrl={setInstallIframeUrl}
              setInstallError={setInstallError}
            />
          )}

          {/* ════ CONSULTATIONS ════ */}
          {activeTab === 'consultations' && (
            <ConsultationsTab
              userConsultations={userConsultations}
              statusColors={statusColors}
              statusLabels={statusLabels}
            />
          )}

          {/* ════ CERTIFICATES ════ */}
          {activeTab === 'learning' && learningSection === 'certificates' && (
            <CertificatesTab
              subscriber={subscriber}
              enrolledCourses={enrolledCourses}
              getCourseLectures={getCourseLectures}
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
          {activeTab === 'payments' && (
            <PaymentsTab
              subscriber={subscriber}
              currency={currency}
              onGoToCertificates={() => { setActiveTab('learning'); setLearningSection('certificates'); }}
              onPaid={() => { if (authUser) refreshMySubscriber(); }}
            />
          )}

          {activeTab === 'account' && (
            <div className="flex gap-2 mb-5 flex-wrap">
              {([
                { id: 'payments' as AccountSection,      label: 'المدفوعات',  icon: <CreditCard size={14} /> },
                { id: 'notifications' as AccountSection, label: 'الإشعارات', icon: <Bell size={14} />, count: (unreadNotifications.length + installmentAlerts.length) },
                { id: 'referral' as AccountSection,      label: 'الإحالة',   icon: <Share2 size={14} /> },
                { id: 'support' as AccountSection,       label: 'الدعم',     icon: <MessageSquare size={14} /> },
                { id: 'settings' as AccountSection,      label: 'الإعدادات', icon: <Settings size={14} /> },
              ] as { id: AccountSection; label: string; icon: React.ReactNode; count?: number }[]).map(s => (
                <button key={s.id} onClick={() => setAccountSection(s.id)}
                  className={[
                    'flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold transition',
                    accountSection === s.id ? 'bg-primary-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300',
                  ].join(' ')}>
                  {s.icon} {s.label}
                  {s.count !== undefined && s.count > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${accountSection === s.id ? 'bg-white/25 text-white' : 'bg-primary-100 text-primary-700'}`}>{s.count}</span>
                  )}
                </button>
              ))}
            </div>
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
            <LiveStreamsTab upcomingLives={upcomingLives} />
          )}

          {/* ════ NOTIFICATIONS ════ */}
          {activeTab === 'account' && accountSection === 'notifications' && (
            <NotificationsTab
              installmentAlerts={installmentAlerts}
              notifications={notifications}
              unreadNotifications={unreadNotifications}
              dismissedNotifIds={dismissedNotifIds}
              setDismissedNotifIds={setDismissedNotifIds}
              setActiveTab={setActiveTab}
              setAccountSection={setAccountSection}
            />
          )}

          {/* ════ COMMUNITY ════ */}
          {activeTab === 'community' && (
            <CommunityTab approvedPosts={approvedPosts} />
          )}


          {/* ════ REFERRAL ════ */}
          {activeTab === 'account' && accountSection === 'referral' && (
            <ReferralTab
              referralCode={referralCode}
              referralStats={referralStats}
              referralCopied={referralCopied}
              setReferralCopied={setReferralCopied}
            />
          )}

          {/* ════ SUPPORT TICKETS ════ */}
          {activeTab === 'account' && accountSection === 'support' && <SupportTab token={localStorage.getItem('mahad-token') || ''} />}

          {/* ════ SETTINGS ════ */}
          {activeTab === 'account' && accountSection === 'settings' && (
            <SettingsTab
              authUser={authUser}
              subscriber={subscriber}
              displayName={displayName}
              avatarDataUrl={avatarDataUrl}
              avatarBg={avatarBg}
              avatarInputRef={avatarInputRef}
              editingName={editingName}
              newName={newName}
              setEditingName={setEditingName}
              setNewName={setNewName}
              newNameEn={newNameEn}
              setNewNameEn={setNewNameEn}
              nameSaving={nameSaving}
              nameMsg={nameMsg}
              nameEnMsg={nameEnMsg}
              handleSaveName={handleSaveName}
              handleSaveNameEn={handleSaveNameEn}
              showPw={showPw}
              setShowPw={setShowPw}
              pwCurrent={pwCurrent}
              setPwCurrent={setPwCurrent}
              pwNew={pwNew}
              setPwNew={setPwNew}
              pwConfirm={pwConfirm}
              setPwConfirm={setPwConfirm}
              pwSaving={pwSaving}
              pwMsg={pwMsg}
              handleChangePassword={handleChangePassword}
              handleLogout={handleLogout}
            />
          )}

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
