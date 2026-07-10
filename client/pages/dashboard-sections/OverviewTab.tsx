import React from 'react';
import { BookOpen, MessageSquare, Award, CreditCard, Share2, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import StudentEngagementHero from '../../components/student-dashboard/StudentEngagementHero';
import type { CourseLectureItem } from '../../types';

interface OverviewTabProps {
  displayName: string;
  enrolledCourses: any[];
  userConsultations: any[];
  subscriber: any;
  getCourseLectures: (id: string) => CourseLectureItem[];
  setActiveTab: (tab: any) => void;
  setLearningSection: (section: any) => void;
  setAccountSection: (section: any) => void;
  setPlayerCourseId: (id: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  displayName,
  enrolledCourses,
  userConsultations,
  subscriber,
  getCourseLectures,
  setActiveTab,
  setLearningSection,
  setAccountSection,
  setPlayerCourseId,
}) => {
  const navigate = useNavigate();
  const totalPaidEGP = (subscriber?.paymentHistory ?? []).filter((p: any) => p.currency === 'EGP').reduce((s: number, p: any) => s + p.amount, 0);
  const totalPaidSAR = (subscriber?.paymentHistory ?? []).filter((p: any) => p.currency === 'SAR').reduce((s: number, p: any) => s + p.amount, 0);
  const totalPaidUSD = (subscriber?.paymentHistory ?? []).filter((p: any) => p.currency === 'USD').reduce((s: number, p: any) => s + p.amount, 0);
  
  const earnedCertsCount = (subscriber?.extraCertificateRequests?.filter((r: any) => r.status === 'issued').length || 0)
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

      {/* Referral CTA */}
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
              const pct = total > 0 ? Math.round((watched / total) * 100) : 100;
              const hasLectures = total > 0;
              return (
                <button
                  key={course.id}
                  onClick={() => setPlayerCourseId(String(course.id))}
                  className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 flex gap-3 p-3 items-center hover:shadow-md hover:border-primary-200 transition text-right w-full group"
                >
                  <div className="relative flex-shrink-0">
                    <img loading="lazy" decoding="async" src={course.thumbnail} alt={course.title} className="w-14 h-14 rounded-xl object-cover" />
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
                {(subscriber?.paymentHistory ?? []).slice(-5).reverse().map((p: any) => (
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
};
