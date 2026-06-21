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

type Tab = 'overview' | 'learning' | 'consultations' | 'community' | 'account';
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
    if (t && ['overview', 'learning', 'consultations', 'community', 'account'].includes(t)) setActiveTab(t as Tab);
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

  /* extra cert request */
  const [extraCertType, setExtraCertType] = useState<import('../types').ExtraCertificateType | ''>('');
  const [extraCertCourseId, setExtraCertCourseId] = useState('');
  const [extraCertNote, setExtraCertNote] = useState('');
  const [extraCertCustomName, setExtraCertCustomName] = useState('');
  const [extraCertConfirm, setExtraConfirm] = useState(false);
  const [extraCertNameAr, setExtraCertNameAr] = useState('');
  const [extraCertNameEn, setExtraCertNameEn] = useState('');
  const [extraCertNationality, setExtraCertNationality] = useState<'egyptian' | 'non_egyptian_egypt' | 'saudi_resident' | 'international'>('egyptian');
  const [extraCertIdNumber, setExtraCertIdNumber] = useState('');

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
    // Pre-fill extra cert name fields from subscriber profile
    if (sub?.name && !extraCertNameAr) setExtraCertNameAr(sub.name);
    if (sub?.nameEn && !extraCertNameEn) setExtraCertNameEn(sub.nameEn);
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
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
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
                  getCourseLectures={getCourseLectures}
                  onResume={(cid) => { setActiveTab('learning'); setLearningSection('courses'); setPlayerCourseId(cid); }}
                  onBrowse={() => navigate('/courses')}
                />

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
                            className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 flex gap-3 p-3 items-center hover:shadow-md hover:border-primary-200 transition text-right w-full group"
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
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
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
            userConsultations.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm max-w-lg mx-auto">
                <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MessageSquare size={28} className="text-blue-400" />
                </div>
                <p className="text-gray-600 font-bold mb-2">لا توجد استشارات مسجلة</p>
                <p className="text-gray-400 text-sm mb-6">احجز جلسة مع أحد معالجينا المعتمدين</p>
                <Link to="/consultations" className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-xl font-bold transition">
                  احجز استشارة <ChevronRight size={16} className="rtl:rotate-180" />
                </Link>
              </div>
            ) : (
              <div className="space-y-4 max-w-3xl">
                {userConsultations.map(c => (
                  <div key={c.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex flex-col sm:flex-row gap-4">
                    <div className="w-12 h-12 bg-primary-50 rounded-xl flex items-center justify-center flex-shrink-0">
                      <Video size={22} className="text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <p className="font-bold text-gray-900">{c.therapistName}</p>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusColors[c.status] || 'bg-gray-100 text-gray-600'}`}>
                          {statusLabels[c.status] || c.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1"><Calendar size={11} /> {c.sessionDate}</span>
                        {c.slotLabel && <span className="flex items-center gap-1"><Clock size={11} /> {c.slotLabel}</span>}
                        {c.sessionType && (
                          <span className="flex items-center gap-1">
                            <User size={11} />
                            {c.sessionType === 'individual' ? 'فردية' : c.sessionType === 'couple' ? 'ثنائية' : 'عائلية'}
                          </span>
                        )}
                        {c.amount !== undefined && (
                          <span className="flex items-center gap-1 font-bold text-primary-600">{c.amount} {c.currency || ''}</span>
                        )}
                      </div>
                      {c.meetingLink && c.status === 'confirmed' && (
                        <a
                          href={c.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg font-bold transition"
                        >
                          <Video size={14} /> انضم للجلسة
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                <div className="pt-2">
                  <Link to="/consultations" className="inline-flex items-center gap-2 text-primary-600 hover:text-primary-700 font-bold text-sm">
                    <Phone size={15} /> احجز استشارة جديدة <ChevronRight size={14} className="rtl:rotate-180" />
                  </Link>
                </div>
              </div>
            )
          )}

          {/* ════ CERTIFICATES ════ */}
          {activeTab === 'learning' && learningSection === 'certificates' && (() => {
            // Extra certificate type labels
            const EXTRA_TYPES: { key: import('../types').ExtraCertificateType; label: string; icon: string; desc: string }[] = [
              { key: 'social_solidarity', label: 'شهادة التضامن الاجتماعي', icon: '🦅', desc: 'بختم النسر الرسمي — وزارة التضامن الاجتماعي' },
              { key: 'ain_shams', label: 'شهادة جامعة عين شمس', icon: '🎓', desc: 'معتمدة من جامعة عين شمس' },
              { key: 'experience_external', label: 'شهادة الخبرة', icon: '📜', desc: 'بتوثيق الخارجية المصرية' },
              { key: 'practice_external', label: 'شهادة التطبيقين', icon: '🏛', desc: 'بتوثيق الخارجية المصرية' },
              { key: 'national_council', label: 'شهادة المجلس الوطني', icon: '🏅', desc: 'للتدريب والتعليم' },
              { key: 'american_board', label: 'شهادة البورد الأمريكي', icon: '🇺🇸', desc: 'American Board of Psychology' },
              { key: 'institute', label: 'شهادة المعهد', icon: '🏆', desc: 'معهد الدراسات النفسية — معتمدة' },
              { key: 'other', label: 'شهادة أخرى', icon: '📋', desc: 'حدد نوع الشهادة في الملاحظات' },
            ];

            const extraRequests = subscriber?.extraCertificateRequests || [];

            // Cert pricing from content
            type CertPricing = { egyptianEGP: number; residentEGP: number; residentSAR: number; foreignUSD: number };
            const certPricingMap: Record<string, CertPricing> = (() => {
              try { return JSON.parse(content['extra_cert_pricing'] || '{}'); } catch { return {}; }
            })();

            const getPriceAndCurrency = (): { price: number; currency: 'EGP' | 'SAR' | 'USD' } | null => {
              if (!extraCertType) return null;
              const row = certPricingMap[extraCertType];
              if (!row) return null;
              if (extraCertNationality === 'egyptian') {
                const p = row.egyptianEGP || 0;
                return p > 0 ? { price: p, currency: 'EGP' } : null;
              }
              if (extraCertNationality === 'non_egyptian_egypt') {
                const p = row.residentEGP || 0;
                return p > 0 ? { price: p, currency: 'EGP' } : null;
              }
              if (extraCertNationality === 'saudi_resident') {
                const p = row.residentSAR || 0;
                return p > 0 ? { price: p, currency: 'SAR' } : null;
              }
              if (extraCertNationality === 'international') {
                const p = row.foreignUSD || 0;
                return p > 0 ? { price: p, currency: 'USD' } : null;
              }
              return null;
            };
            const autoPrice = getPriceAndCurrency();

            const handleRequestExtraCert = () => {
              if (!extraCertType || !subscriber) return;
              const priceData = getPriceAndCurrency();
              const req: import('../types').ExtraCertificateRequest = {
                id: `ecr-${Date.now()}`,
                type: extraCertType as import('../types').ExtraCertificateType,
                courseId: extraCertCourseId || undefined,
                customName: extraCertType === 'other' ? extraCertCustomName : undefined,
                nameAr: extraCertNameAr || undefined,
                nameEn: extraCertNameEn || undefined,
                nationality: extraCertNationality,
                idNumber: extraCertIdNumber.trim() || undefined,
                status: priceData ? 'priced' : 'pending',
                price: priceData?.price,
                currency: priceData?.currency,
                requestedAt: new Date().toISOString().slice(0, 10),
                note: extraCertNote || undefined,
              };
              updateSubscriber({
                ...subscriber,
                extraCertificateRequests: [...extraRequests, req],
              });
              setExtraCertType('');
              setExtraCertCourseId('');
              setExtraCertNote('');
              setExtraCertCustomName('');
              setExtraCertNameAr('');
              setExtraCertNameEn('');
              setExtraCertNationality('egyptian');
              setExtraCertIdNumber('');
              setExtraConfirm(false);
              if (priceData && priceData.price > 0) {
                const certLabel = EXTRA_TYPES.find(t => t.key === extraCertType)?.label || 'شهادة إضافية';
                sessionStorage.setItem('mahad-pending-order', JSON.stringify({
                  orderId: req.id,
                  type: 'certificate',
                  itemId: req.id,
                  itemTitle: certLabel,
                  amount: priceData.price,
                  currency: priceData.currency,
                  paymentMethod: 'card',
                  customerName: extraCertNameAr || subscriber.name,
                  customerEmail: subscriber.email || '',
                  customerPhone: subscriber.phone || '',
                  extraCertRequestId: req.id,
                  subscriberPhone: subscriber.phone,
                }));
                navigate(`/checkout?type=certificate&id=${req.id}&amount=${priceData.price}&currency=${priceData.currency}&title=${encodeURIComponent(certLabel)}`);
              }
            };

            const statusBadge = (s: string) => {
              if (s === 'issued') return <span className="text-[10px] bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full">✅ صدرت</span>;
              if (s === 'paid') return <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">💳 مدفوعة</span>;
              if (s === 'priced') return <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full">💰 تم التسعير</span>;
              return <span className="text-[10px] bg-gray-100 text-gray-600 font-bold px-2 py-0.5 rounded-full">⏳ قيد المراجعة</span>;
            };

            return (
              <div className="space-y-8 max-w-3xl">

                {/* ── Course completion certificates ── */}
                <div>
                  <h3 className="font-extrabold text-gray-800 text-base mb-4 flex items-center gap-2">
                    <Award size={18} className="text-red-700" /> شهادات إتمام الكورسات
                  </h3>
                  {enrolledCourses.length === 0 ? (
                    <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
                      <Award size={36} className="text-gray-200 mx-auto mb-3" />
                      <p className="text-gray-400">اشترك في كورس للحصول على شهاداتك</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {enrolledCourses.map(course => {
                        const courseLectures = getCourseLectures(course.id);
                        const total = courseLectures.length;
                        const watched = total > 0
                          ? Object.entries(subscriber?.lectureProgress || {})
                              .filter(([lid, pct]) => courseLectures.some(l => String(l.id) === lid) && (pct as number) >= 90).length
                          : 0;
                        const pct = total > 0 ? Math.round((watched / total) * 100) : 100;
                        // If no lectures are configured, always allow certificate access
                        const isCompleted = total === 0 || pct === 100;
                        const certNum = `PSY-${new Date().getFullYear()}-${(subscriber?.id || 'X').slice(-4).toUpperCase()}-${course.id.slice(-4).toUpperCase()}`;
                        const issuedDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

                        return (
                          <div key={course.id} className={`rounded-2xl p-5 border shadow-sm ${isCompleted ? 'bg-gradient-to-br from-red-900 to-red-800 border-red-700 text-white' : 'bg-white border-gray-100'}`}>
                            <div className="flex items-start gap-3">
                              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${isCompleted ? 'bg-white/15' : 'bg-red-50'}`}>
                                <Award size={24} className={isCompleted ? 'text-yellow-300' : 'text-red-700'} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-[10px] uppercase tracking-wider mb-0.5 ${isCompleted ? 'text-red-200' : 'text-gray-400'}`}>
                                  شهادة إتمام
                                </p>
                                <h4 className={`font-bold text-sm leading-snug line-clamp-2 ${isCompleted ? 'text-white' : 'text-gray-800'}`}>
                                  {course.title}
                                </h4>
                                {!isCompleted && (
                                  <div className="mt-2">
                                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                                      <span>{watched}/{total} محاضرة مكتملة</span>
                                      <span className="font-bold">{pct}%</span>
                                    </div>
                                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                      <div className="h-full bg-red-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                                    </div>
                                    <button
                                      onClick={() => setPlayerCourseId(course.id)}
                                      className="mt-2 text-xs text-red-600 font-bold flex items-center gap-1 hover:text-red-800 transition"
                                    >
                                      <Play size={11} /> تابع التعلم لتحميل الشهادة
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                            {isCompleted && (
                              <button
                                onClick={() => setCertModal({ courseId: course.id })}
                                className="w-full mt-4 bg-white/15 hover:bg-white/25 text-white font-bold py-2.5 rounded-xl transition text-sm flex items-center justify-center gap-2 border border-white/20"
                              >
                                🏆 عرض وطباعة الشهادة
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* ── Additional certificates ── */}
                <div>
                  <h3 className="font-extrabold text-gray-800 text-base mb-1 flex items-center gap-2">
                    <Star size={18} className="text-amber-500" /> الشهادات الإضافية المعتمدة
                  </h3>
                  <p className="text-xs text-gray-500 mb-4">اختر الشهادة الإضافية التي تحتاجها وسيتواصل معك فريق المعهد بالتفاصيل والتكلفة</p>

                  {/* Existing requests */}
                  {extraRequests.length > 0 && (
                    <div className="space-y-3 mb-5">
                      {extraRequests.map(req => {
                        const typeInfo = EXTRA_TYPES.find(t => t.key === req.type);
                        return (
                          <div key={req.id} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-3">
                              <span className="text-2xl">{typeInfo?.icon || '📋'}</span>
                              <div>
                                <p className="font-bold text-sm text-gray-800">{req.customName || typeInfo?.label}</p>
                                <p className="text-xs text-gray-400 mt-0.5">طُلبت في {req.requestedAt}</p>
                                {req.price && <p className="text-xs text-amber-600 font-bold mt-0.5">التكلفة: {req.price} {req.currency || 'EGP'}</p>}
                                {req.status === 'priced' && (
                                  <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                    <p className="text-xs font-bold text-amber-800 mb-1">💳 لإتمام الدفع:</p>
                                    <p className="text-xs text-amber-700">تواصل مع فريق المعهد عبر واتس أب أو الهاتف لسداد المبلغ وإرسال إيصال الدفع</p>
                                  </div>
                                )}
                                {req.adminNote && <p className="text-xs text-blue-600 mt-0.5">ملاحظة: {req.adminNote}</p>}
                              </div>
                            </div>
                            {statusBadge(req.status)}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Request form */}
                  {!extraCertConfirm ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-4">
                      <p className="font-bold text-amber-800 text-sm">طلب شهادة إضافية جديدة</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs font-bold text-gray-600 mb-1 block">نوع الشهادة *</label>
                          <select value={extraCertType} onChange={e => setExtraCertType(e.target.value as import('../types').ExtraCertificateType)}
                            className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400">
                            <option value="">— اختر نوع الشهادة —</option>
                            {EXTRA_TYPES.map(t => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-gray-600 mb-1 block">الجنسية / مكان الإقامة *</label>
                          <select value={extraCertNationality} onChange={e => setExtraCertNationality(e.target.value as 'egyptian' | 'non_egyptian_egypt' | 'saudi_resident' | 'international')}
                            className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400">
                            <option value="egyptian">🇪🇬 مصري</option>
                            <option value="non_egyptian_egypt">👤 غير مصري مقيم في مصر</option>
                            <option value="saudi_resident">🇸🇦 مقيم في السعودية</option>
                            <option value="international">✈️ دولي — خارج مصر والسعودية</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-gray-600 mb-1 block">رقم الهوية / الإقامة *</label>
                          <input value={extraCertIdNumber} onChange={e => setExtraCertIdNumber(e.target.value)}
                            placeholder={extraCertNationality === 'egyptian' ? 'رقم البطاقة الوطنية (14 رقم)' : 'رقم الإقامة أو الهوية'}
                            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400" dir="ltr" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="text-xs font-bold text-gray-600 mb-1 block">الكورس المرتبط (اختياري)</label>
                          <select value={extraCertCourseId} onChange={e => setExtraCertCourseId(e.target.value)}
                            className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400">
                            <option value="">— اختر الكورس —</option>
                            {enrolledCourses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-xs font-bold text-gray-600 mb-1 block">الاسم بالعربية *</label>
                          <input value={extraCertNameAr} onChange={e => setExtraCertNameAr(e.target.value)}
                            placeholder="الاسم الرباعي بالعربية"
                            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400" />
                        </div>
                        <div>
                          <label className="text-xs font-bold text-gray-600 mb-1 block">الاسم بالإنجليزية *</label>
                          <input value={extraCertNameEn} onChange={e => setExtraCertNameEn(e.target.value)}
                            placeholder="Full name in English"
                            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400" dir="ltr" />
                        </div>
                        {extraCertType === 'other' && (
                          <div className="sm:col-span-2">
                            <label className="text-xs font-bold text-gray-600 mb-1 block">اسم الشهادة المطلوبة *</label>
                            <input value={extraCertCustomName} onChange={e => setExtraCertCustomName(e.target.value)}
                              placeholder="اكتب اسم الشهادة المطلوبة"
                              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400" />
                          </div>
                        )}
                        <div className="sm:col-span-2">
                          <label className="text-xs font-bold text-gray-600 mb-1 block">ملاحظات إضافية (اختياري)</label>
                          <textarea value={extraCertNote} onChange={e => setExtraCertNote(e.target.value)} rows={2}
                            placeholder="أي تفاصيل إضافية..."
                            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-400 resize-none" />
                        </div>
                      </div>
                      {autoPrice && (
                        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center gap-3">
                          <span className="text-green-600 text-xl">💰</span>
                          <div>
                            <p className="text-xs text-green-700 font-bold">التكلفة المحسوبة تلقائياً</p>
                            <p className="text-lg font-extrabold text-green-800">{autoPrice.price} {autoPrice.currency === 'EGP' ? 'ج.م' : autoPrice.currency === 'SAR' ? 'ر.س' : '$'}</p>
                          </div>
                        </div>
                      )}
                      <button
                        disabled={!extraCertType || !extraCertNameAr.trim() || !extraCertNameEn.trim() || !extraCertIdNumber.trim() || (extraCertType === 'other' && !extraCertCustomName)}
                        onClick={() => setExtraConfirm(true)}
                        className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-bold rounded-xl transition text-sm"
                      >
                        إرسال الطلب
                      </button>
                    </div>
                  ) : (
                    <div className="bg-white border border-amber-300 rounded-2xl p-5 space-y-3">
                      <p className="font-bold text-gray-800">تأكيد الطلب</p>
                      {autoPrice ? (
                        <p className="text-sm text-gray-600">
                          سيتم توجيهك لصفحة الدفع لسداد مبلغ <strong>{autoPrice.price} {autoPrice.currency === 'EGP' ? 'ج.م' : autoPrice.currency === 'SAR' ? 'ر.س' : '$'}</strong> لإصدار الشهادة.
                        </p>
                      ) : (
                        <p className="text-sm text-gray-600">
                          سيتواصل معك فريق المعهد لإخبارك بتكلفة الشهادة وطريقة الدفع والمدة الزمنية اللازمة.
                        </p>
                      )}
                      <div className="flex gap-3">
                        <button
                          onClick={() => { handleRequestExtraCert(); }}
                          className="flex-1 py-2.5 bg-amber-600 text-white font-bold rounded-xl hover:bg-amber-700 active:scale-95 transition text-sm"
                        >
                          {autoPrice ? '💳 تأكيد والانتقال للدفع' : '✅ تأكيد الطلب'}
                        </button>
                        <button onClick={() => setExtraConfirm(false)} className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition text-sm">
                          إلغاء
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

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
          {activeTab === 'learning' && learningSection === 'live' && (() => {
            const nextLive = upcomingLives.find(ls => ls.status === 'live') || upcomingLives.filter(ls => ls.status === 'upcoming').sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
            return (
              <div className="max-w-2xl space-y-4">
                <h3 className="font-extrabold text-gray-800 text-base flex items-center gap-2">
                  <Radio size={18} className="text-primary-600" /> البث المباشر
                </h3>
                {upcomingLives.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
                    <Radio size={40} className="text-gray-200 mx-auto mb-4" />
                    <p className="text-gray-500 font-bold">لا توجد بثوث مباشرة قادمة حالياً</p>
                  </div>
                ) : (
                  <>
                    {nextLive && (
                      <div className={`rounded-2xl p-5 text-white ${nextLive.status === 'live' ? 'bg-gradient-to-l from-red-700 to-red-900' : 'bg-gradient-to-l from-primary-700 to-primary-900'}`}>
                        <div className="flex items-center gap-2 mb-3">
                          {nextLive.status === 'live' ? <span className="flex items-center gap-1.5 text-xs font-bold bg-white/20 px-3 py-1 rounded-full"><span className="w-2 h-2 rounded-full bg-white animate-pulse" />🔴 مباشر الآن</span> : <span className="text-xs font-bold bg-white/20 px-3 py-1 rounded-full">📅 البث القادم</span>}
                        </div>
                        <h4 className="font-extrabold text-lg mb-1">{nextLive.title}</h4>
                        <div className="flex flex-wrap gap-3 text-white/80 text-sm mb-4">
                          <span className="flex items-center gap-1"><User size={14} />{nextLive.instructorName}</span>
                          <span className="flex items-center gap-1"><Calendar size={14} />{nextLive.scheduledAt.replace('T', ' ').slice(0, 16)}</span>
                          {nextLive.durationMinutes && <span>{nextLive.durationMinutes} دقيقة</span>}
                        </div>
                        {nextLive.description && <p className="text-white/70 text-sm mb-4">{nextLive.description}</p>}
                        <a href={nextLive.streamUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 bg-white text-primary-800 font-extrabold px-6 py-3 rounded-xl hover:bg-white/90 transition text-sm">
                          <Video size={16} /> {nextLive.status === 'live' ? 'انضم الآن للبث المباشر' : 'رابط البث'}
                        </a>
                      </div>
                    )}
                    <div className="space-y-3">
                      {upcomingLives.filter(ls => ls.id !== nextLive?.id).map(ls => (
                        <div key={ls.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${ls.status === 'live' ? 'bg-red-100' : 'bg-blue-100'}`}>
                            <Radio size={18} className={ls.status === 'live' ? 'text-red-600' : 'text-blue-600'} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-800 text-sm">{ls.title}</p>
                            <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                              <span><User size={11} className="inline ml-0.5" />{ls.instructorName}</span>
                              <span><Calendar size={11} className="inline ml-0.5" />{ls.scheduledAt.replace('T', ' ').slice(0, 16)}</span>
                            </div>
                          </div>
                          <a href={ls.streamUrl} target="_blank" rel="noopener noreferrer"
                            className="flex-shrink-0 text-xs bg-primary-50 text-primary-700 font-bold px-3 py-1.5 rounded-lg hover:bg-primary-100 transition">
                            🔗 رابط
                          </a>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {/* ════ NOTIFICATIONS ════ */}
          {activeTab === 'account' && accountSection === 'notifications' && (
            <div className="max-w-2xl space-y-4">

              {/* ── Installment due alerts ── */}
              {installmentAlerts.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">تذكيرات الأقساط</p>
                  {installmentAlerts.map(alert => (
                    <div key={`${alert.planId}-${alert.entryId}`}
                      className={`rounded-2xl border p-4 flex gap-4 ${alert.isOverdue ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${alert.isOverdue ? 'bg-red-100' : 'bg-amber-100'}`}>
                        <AlertCircle size={20} className={alert.isOverdue ? 'text-red-600' : 'text-amber-600'} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-bold text-gray-900 text-sm">{alert.courseTitle}</p>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${alert.isOverdue ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                            {alert.isOverdue ? `متأخر ${alert.daysOverdue} يوم` : `خلال ${alert.daysLeft} يوم`}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700">قسط بمبلغ <span className="font-bold">{alert.amount.toLocaleString()} {alert.currency === 'EGP' ? 'ج.م' : alert.currency}</span> — موعد الاستحقاق: {alert.dueDate}</p>
                        <button
                          onClick={() => { setActiveTab('account'); setAccountSection('payments'); }}
                          className="mt-2 text-xs font-bold text-primary-600 hover:text-primary-700 underline"
                        >
                          عرض تفاصيل المدفوعات ←
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {notifications.length === 0 && installmentAlerts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Bell size={28} className="text-gray-300" />
                  </div>
                  <p className="text-gray-500 font-bold">لا توجد إشعارات حالياً</p>
                </div>
              ) : (
                <>
                  {unreadNotifications.length > 0 && (
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-bold text-gray-600">{unreadNotifications.length} إشعار غير مقروء</p>
                      <button
                        onClick={() => {
                          const allIds = notifications.map(n => n.id);
                          setDismissedNotifIds(allIds);
                          localStorage.setItem('dismissed-notifs', JSON.stringify(allIds));
                        }}
                        className="text-xs text-primary-600 hover:text-primary-700 font-bold"
                      >
                        تعليم الكل كمقروء
                      </button>
                    </div>
                  )}
                  {notifications.map(n => {
                    const isRead = dismissedNotifIds.includes(n.id);
                    const typeConfig = {
                      offer:  { bg: 'bg-orange-50', border: 'border-orange-200', icon: <Sparkles size={18} className="text-orange-500" />, badge: 'bg-orange-100 text-orange-700', badgeLabel: 'عرض خاص' },
                      update: { bg: 'bg-blue-50',   border: 'border-blue-200',   icon: <Bell size={18} className="text-blue-500" />,    badge: 'bg-blue-100 text-blue-700',   badgeLabel: 'تحديث' },
                      info:   { bg: 'bg-primary-50', border: 'border-primary-200', icon: <Bell size={18} className="text-primary-600" />, badge: 'bg-primary-100 text-primary-700', badgeLabel: 'إشعار' },
                    };
                    const cfg = typeConfig[n.type as keyof typeof typeConfig] || typeConfig.info;
                    return (
                      <div key={n.id} className={`rounded-2xl border p-4 flex gap-4 transition ${isRead ? 'opacity-60 bg-gray-50 border-gray-100' : `${cfg.bg} ${cfg.border}`}`}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isRead ? 'bg-gray-100' : 'bg-white shadow-sm'}`}>
                          {cfg.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <p className="font-bold text-gray-900 text-sm">{n.title}</p>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.badgeLabel}</span>
                            {!isRead && <span className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0"></span>}
                          </div>
                          {n.body && <p className="text-sm text-gray-600 leading-relaxed">{n.body}</p>}
                        </div>
                        {!isRead && (
                          <button
                            onClick={() => {
                              const next = [...dismissedNotifIds, n.id];
                              setDismissedNotifIds(next);
                              localStorage.setItem('dismissed-notifs', JSON.stringify(next));
                            }}
                            className="flex-shrink-0 text-gray-300 hover:text-gray-500 transition"
                            title="تعليم كمقروء"
                          >
                            <X size={18} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ════ COMMUNITY ════ */}
          {activeTab === 'community' && (
            <div className="max-w-3xl space-y-5">
              {/* Header */}
              <div className="bg-gradient-to-l from-primary-700 to-primary-900 rounded-2xl p-5 text-white flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-lg mb-1">مجتمع معهد الدراسات النفسية</h3>
                  <p className="text-primary-200 text-sm">شارك أفكارك وتجاربك مع زملائك في المعهد</p>
                </div>
                <Link to="/community" className="flex items-center gap-2 bg-white/15 hover:bg-white/25 border border-white/20 text-white font-bold px-4 py-2.5 rounded-xl transition text-sm">
                  <Users size={15} /> انضم للمجتمع
                </Link>
              </div>

              {approvedPosts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
                  <Users size={36} className="text-gray-200 mx-auto mb-3" />
                  <p className="text-gray-500 font-bold mb-1">لا توجد منشورات بعد</p>
                  <p className="text-xs text-gray-400">كن أول من يشارك في مجتمع المعهد</p>
                </div>
              ) : (
                <>
                  {approvedPosts.slice(0, 8).map(post => (
                    <div key={post.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md transition">
                      {post.pinned && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 font-bold mb-3 bg-amber-50 px-3 py-1.5 rounded-lg w-fit">
                          <Star size={12} /> منشور مثبت
                        </div>
                      )}
                      <div className="flex items-center gap-3 mb-3">
                        {post.authorImage ? (
                          <img src={post.authorImage} alt={post.authorName} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                            {post.authorName.charAt(0)}
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{post.authorName}</p>
                          <p className="text-xs text-gray-400">{post.authorRole} · {post.createdAt}</p>
                        </div>
                        {post.tag && (
                          <span className="mr-auto text-[11px] bg-primary-50 text-primary-700 font-bold px-2.5 py-1 rounded-full">{post.tag}</span>
                        )}
                      </div>
                      <h4 className="font-bold text-gray-900 mb-2">{post.title}</h4>
                      <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">{post.body}</p>
                      <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-50 text-xs text-gray-400">
                        <span className="flex items-center gap-1.5"><ThumbsUp size={13} /> {post.likes} إعجاب</span>
                        <span className="flex items-center gap-1.5"><MessageSquare size={13} /> {post.comments} تعليق</span>
                        <Link to="/community" className="mr-auto flex items-center gap-1 text-primary-600 hover:text-primary-700 font-bold">
                          <ExternalLink size={12} /> قراءة المزيد
                        </Link>
                      </div>
                    </div>
                  ))}
                  {approvedPosts.length > 8 && (
                    <div className="text-center">
                      <Link to="/community" className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-bold px-6 py-3 rounded-xl transition">
                        عرض كل المنشورات ({approvedPosts.length}) <ChevronRight size={16} className="rtl:rotate-180" />
                      </Link>
                    </div>
                  )}
                </>
              )}
            </div>
          )}


          {/* ════ REFERRAL ════ */}
          {activeTab === 'account' && accountSection === 'referral' && (
            <div className="max-w-xl space-y-5">
              <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl border border-purple-100 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-full bg-purple-600 grid place-items-center text-white"><Gift size={18} /></div>
                  <div>
                    <h3 className="font-extrabold text-gray-900 text-base">نظام الإحالة</h3>
                    <p className="text-xs text-gray-500">ادعُ أصدقاءك وكسب مكافآت</p>
                  </div>
                </div>
                {referralCode ? (
                  <div className="space-y-4">
                    {/* Code box */}
                    <div className="bg-white rounded-xl border-2 border-purple-200 p-4 text-center relative">
                      <p className="text-xs text-gray-400 mb-1">كود الإحالة الخاص بك</p>
                      <p className="font-mono font-extrabold text-2xl text-purple-700 tracking-widest">{referralCode}</p>
                      <button
                        onClick={() => { navigator.clipboard.writeText(referralCode).catch(() => {}); setReferralCopied(true); setTimeout(() => setReferralCopied(false), 2000); }}
                        className="absolute top-3 left-3 w-8 h-8 rounded-lg bg-purple-100 hover:bg-purple-200 grid place-items-center text-purple-700 transition"
                      >
                        {referralCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
                      </button>
                    </div>
                    {/* Stats */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-white rounded-xl border border-gray-100 p-4 text-center shadow-sm">
                        <p className="text-2xl font-extrabold text-gray-900">{referralStats?.uses ?? 0}</p>
                        <p className="text-xs text-gray-500 mt-1">عدد الإحالات</p>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-100 p-4 text-center shadow-sm">
                        <p className="text-2xl font-extrabold text-emerald-600">{referralStats?.earnings ?? 0} <span className="text-sm">EGP</span></p>
                        <p className="text-xs text-gray-500 mt-1">الأرباح المحتملة</p>
                      </div>
                    </div>
                    {/* Share link */}
                    <div className="bg-white rounded-xl border border-gray-100 p-4">
                      <p className="text-xs text-gray-500 mb-2">رابط الإحالة — شاركه مع أصدقائك:</p>
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={`${window.location.origin}/auth?ref=${referralCode}`}
                          className="flex-1 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono text-gray-600"
                        />
                        <button
                          onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/auth?ref=${referralCode}`).catch(() => {}); setReferralCopied(true); setTimeout(() => setReferralCopied(false), 2000); }}
                          className="bg-purple-600 text-white text-xs rounded-lg px-3 py-2 hover:bg-purple-700 flex items-center gap-1"
                        >
                          <Share2 size={12} /> نسخ
                        </button>
                      </div>
                      {/* One-tap share — the viral loop */}
                      {(() => {
                        const link = `${window.location.origin}/auth?ref=${referralCode}`;
                        const msg = `اتعلّمت في معهد الدراسات النفسية وأنصحك بيه! 🌿\nسجّل من اللينك ده واحصل على مكافأة:\n${link}`;
                        return (
                          <div className="flex gap-2 mt-3">
                            <a
                              href={`https://wa.me/?text=${encodeURIComponent(msg)}`}
                              target="_blank" rel="noreferrer"
                              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg py-2.5"
                            >
                              <Share2 size={13} /> شارك على واتساب
                            </a>
                            <button
                              onClick={() => {
                                if (navigator.share) navigator.share({ title: 'معهد الدراسات النفسية', text: msg, url: link }).catch(() => {});
                                else { navigator.clipboard.writeText(msg).catch(() => {}); setReferralCopied(true); setTimeout(() => setReferralCopied(false), 2000); }
                              }}
                              className="px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg py-2.5"
                            >
                              مشاركة أخرى
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    <Share2 size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">نظام الإحالة متاح للمشتركين المسجلين فقط</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ════ SUPPORT TICKETS ════ */}
          {activeTab === 'account' && accountSection === 'support' && <SupportTab token={localStorage.getItem('mahad-token') || ''} />}

          {/* ════ SETTINGS ════ */}
          {activeTab === 'account' && accountSection === 'settings' && (
            <div className="max-w-xl space-y-6">

              {/* Profile card */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-5">
                <h3 className="font-extrabold text-gray-900 flex items-center gap-2 text-base">
                  <User size={16} /> معلوماتي الشخصية
                </h3>

                {/* Avatar big */}
                <div className="flex items-center gap-4">
                  <div className={`w-20 h-20 rounded-full overflow-hidden flex items-center justify-center text-2xl font-extrabold text-white flex-shrink-0 ${!avatarDataUrl ? avatarBg : ''}`}>
                    {avatarDataUrl
                      ? <img src={avatarDataUrl} alt="avatar" className="w-full h-full object-cover" />
                      : displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <button
                      onClick={() => avatarInputRef.current?.click()}
                      className="flex items-center gap-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg font-bold transition"
                    >
                      <Camera size={15} /> تغيير الصورة
                    </button>
                    <p className="text-xs text-gray-400 mt-1">JPG, PNG — يُحفظ على هذا الجهاز</p>
                  </div>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">الاسم الرباعي بالعربية <span className="text-gray-400 font-normal">(يظهر على الشهادة)</span></label>
                  <div className="flex gap-2">
                    <input
                      value={editingName ? newName : displayName}
                      onChange={e => { setEditingName(true); setNewName(e.target.value); }}
                      placeholder="مثال: أحمد محمد علي حسن"
                      className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
                    />
                    <button
                      onClick={handleSaveName}
                      disabled={nameSaving}
                      className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1 transition disabled:opacity-60"
                    >
                      <Save size={14} /> حفظ
                    </button>
                  </div>
                  {nameMsg && <p className="text-green-600 text-xs mt-1">{nameMsg}</p>}
                </div>

                {/* English name for certificate */}
                <div>
                  <label className="block text-xs font-bold text-amber-700 mb-1">
                    الاسم الرباعي بالإنجليزية — <span className="font-normal text-amber-600">يظهر على الشهادة</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      dir="ltr"
                      value={newNameEn}
                      onChange={e => setNewNameEn(e.target.value)}
                      placeholder="Full Name as on Certificate"
                      className="flex-1 border border-amber-300 bg-amber-50 rounded-xl px-4 py-2.5 text-sm focus:border-amber-500 focus:outline-none ltr"
                    />
                    <button
                      onClick={handleSaveNameEn}
                      className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-1 transition"
                    >
                      <Save size={14} /> Save
                    </button>
                  </div>
                  {nameEnMsg && <p className="text-amber-700 text-xs mt-1">{nameEnMsg}</p>}
                </div>

                {/* Email readonly */}
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">البريد الإلكتروني</label>
                  <input
                    value={authUser.email || ''}
                    readOnly
                    className="w-full border border-gray-200 bg-gray-50 rounded-xl px-4 py-2.5 text-sm text-gray-500 cursor-not-allowed"
                  />
                </div>

                {/* Client code / stable URL */}
                {subscriber?.clientCode && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
                    <p className="text-xs font-bold text-indigo-700 mb-1">🔗 رابطك الشخصي الدائم</p>
                    <p className="text-[11px] text-indigo-600 font-mono break-all">{window.location.origin}/#/client/{subscriber.clientCode}</p>
                    <p className="text-[10px] text-indigo-400 mt-1">هذا الرابط ثابت ويمكنك مشاركته مع فريق الدعم</p>
                  </div>
                )}
              </div>

              {/* Password card */}
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm space-y-4">
                <h3 className="font-extrabold text-gray-900 flex items-center gap-2 text-base">
                  <Lock size={16} /> تغيير كلمة المرور
                </h3>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">كلمة المرور الحالية</label>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={pwCurrent}
                      onChange={e => setPwCurrent(e.target.value)}
                      placeholder="أدخل كلمة المرور الحالية"
                      className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm pr-10 focus:border-primary-400 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(p => !p)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">كلمة المرور الجديدة</label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pwNew}
                    onChange={e => setPwNew(e.target.value)}
                    placeholder="6 أحرف على الأقل"
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1">تأكيد كلمة المرور</label>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pwConfirm}
                    onChange={e => setPwConfirm(e.target.value)}
                    placeholder="أعد كتابة كلمة المرور الجديدة"
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:border-primary-400 focus:outline-none"
                  />
                </div>

                {pwMsg && (
                  <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${pwMsg.includes('نجاح') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                    <AlertCircle size={14} /> {pwMsg}
                  </div>
                )}

                <button
                  onClick={handleChangePassword}
                  disabled={pwSaving || !pwCurrent || !pwNew || !pwConfirm}
                  className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {pwSaving
                    ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    : <Save size={16} />}
                  حفظ كلمة المرور
                </button>
              </div>

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 border-2 border-red-200 text-red-600 hover:bg-red-50 font-bold py-3 rounded-2xl transition"
              >
                <LogOut size={16} /> تسجيل الخروج
              </button>

            </div>
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

// ─── Support Tickets component (inline) ────────────────────────────────────
const API_SUPPORT = import.meta.env.VITE_API_URL || 'https://mahadnafsy.com/api';

function SupportTab({ token }: { token: string }) {
  const [tickets, setTickets] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState({ subject: '', body: '' });
  const [submitting, setSubmitting] = React.useState(false);
  const [toast, setToast] = React.useState('');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_SUPPORT}/me/tickets`, { headers });
      if (r.ok) setTickets(await r.json());
    } finally { setLoading(false); }
  };

  React.useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.subject.trim() || !form.body.trim()) { showToast('يرجى ملء العنوان والرسالة'); return; }
    setSubmitting(true);
    const r = await fetch(`${API_SUPPORT}/me/tickets`, { method: 'POST', headers, body: JSON.stringify(form) });
    setSubmitting(false);
    if (r.ok) { showToast('تم إرسال تذكرتك بنجاح ✅'); setForm({ subject: '', body: '' }); load(); }
    else showToast('حدث خطأ، يرجى المحاولة مرة أخرى');
  };

  const STATUS_LABELS: Record<string, string> = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'محلولة', closed: 'مغلقة' };
  const STATUS_COLORS: Record<string, string> = { open: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700', resolved: 'bg-green-100 text-green-700', closed: 'bg-gray-100 text-gray-600' };

  return (
    <div className="max-w-2xl space-y-5">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-200 shadow-lg rounded-xl px-6 py-3 text-sm font-medium">{toast}</div>}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
        <h3 className="font-bold text-gray-900 text-base flex items-center gap-2">
          <MessageSquare size={18} className="text-purple-600" />
          فتح تذكرة دعم جديدة
        </h3>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">موضوع المشكلة</label>
          <input className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-300 outline-none"
            value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            placeholder="مثال: مشكلة في تشغيل الفيديو" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">تفاصيل المشكلة</label>
          <textarea className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-300 outline-none" rows={4}
            value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            placeholder="اشرح المشكلة بالتفصيل..." />
        </div>
        <button onClick={submit} disabled={submitting}
          className="w-full bg-purple-600 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-purple-700 disabled:opacity-50 transition">
          {submitting ? 'جاري الإرسال...' : 'إرسال التذكرة'}
        </button>
      </div>

      <div>
        <h3 className="font-bold text-gray-700 text-sm mb-3">تذاكرك السابقة</h3>
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">جاري التحميل...</div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-2xl border border-dashed border-gray-200">
            لا توجد تذاكر سابقة
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t: any) => (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{t.subject}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(t.created_at).toLocaleDateString('ar-EG')}</p>
                    {t.reply_count > 0 && <p className="text-xs text-purple-600 mt-0.5">💬 {t.reply_count} رد من الإدارة</p>}
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${STATUS_COLORS[t.status] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABELS[t.status] || t.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default UserDashboard;
