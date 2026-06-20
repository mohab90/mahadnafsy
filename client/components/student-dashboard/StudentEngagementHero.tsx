import React from 'react';
import { PlayCircle, Award, Sparkles, BookOpen } from 'lucide-react';
import type { Course } from '../../types';

interface Props {
  enrolledCourses: Course[];
  lectureProgress: Record<string, number>;
  getCourseLectures: (courseId: string) => { id: string | number }[];
  onResume: (courseId: string) => void;
  onBrowse: () => void;
}

// Student engagement hero — "continue learning", overall progress, and how close
// the learner is to a certificate. Pure presentational; computes from props.
const StudentEngagementHero: React.FC<Props> = ({ enrolledCourses, lectureProgress, getCourseLectures, onResume, onBrowse }) => {
  const rows = enrolledCourses.map((c) => {
    const lecs = getCourseLectures(String(c.id));
    const total = lecs.length;
    const watched = total === 0 ? 0 : Object.entries(lectureProgress || {})
      .filter(([lid, pct]) => lecs.some(l => String(l.id) === lid) && (pct as number) >= 90).length;
    const pct = total > 0 ? Math.round((watched / total) * 100) : 0;
    return { course: c, total, watched, pct };
  });

  const totalLec = rows.reduce((s, r) => s + r.total, 0);
  const totalWatched = rows.reduce((s, r) => s + r.watched, 0);
  const overall = totalLec > 0 ? Math.round((totalWatched / totalLec) * 100) : 0;
  const next = rows.find(r => r.total > 0 && r.pct < 100) || rows[0];
  const almostCert = rows.filter(r => r.total > 0 && r.pct >= 80 && r.pct < 100).length;

  if (enrolledCourses.length === 0) {
    return (
      <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-6 text-white shadow flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-extrabold mb-1">ابدأ رحلتك التعليمية 🚀</h3>
          <p className="text-white/80 text-sm">لسه ما عندكش كورسات — استكشف البرامج وابدأ التعلّم.</p>
        </div>
        <button onClick={onBrowse} className="bg-white text-indigo-700 font-bold px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 hover:bg-indigo-50">
          <BookOpen size={16} /> تصفّح الكورسات
        </button>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-6 text-white shadow space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          {/* progress ring */}
          <div className="relative w-16 h-16 shrink-0">
            <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${overall} 100`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold">{overall}%</span>
          </div>
          <div>
            <p className="text-white/70 text-xs">تقدّمك الإجمالي</p>
            <p className="font-extrabold text-lg">{totalWatched} / {totalLec} محاضرة</p>
          </div>
        </div>
        {next && (
          <button onClick={() => onResume(String(next.course.id))}
            className="bg-white text-indigo-700 font-bold px-5 py-2.5 rounded-xl text-sm flex items-center gap-2 hover:bg-indigo-50">
            <PlayCircle size={18} /> {next.pct === 0 ? 'ابدأ' : 'أكمل'}: {next.course.title}
          </button>
        )}
      </div>

      {/* per-course mini bars (top 3) */}
      <div className="space-y-2">
        {rows.slice(0, 3).map(r => (
          <button key={String(r.course.id)} onClick={() => onResume(String(r.course.id))}
            className="w-full text-right group">
            <div className="flex items-center justify-between text-xs mb-0.5">
              <span className="font-semibold truncate group-hover:underline">{r.course.title}</span>
              <span className="text-white/70">{r.pct}%</span>
            </div>
            <div className="w-full bg-white/20 rounded-full h-1.5">
              <div className="h-1.5 bg-white rounded-full" style={{ width: `${Math.max(r.pct, 2)}%` }} />
            </div>
          </button>
        ))}
      </div>

      {almostCert > 0 && (
        <div className="bg-white/15 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm">
          <Award size={16} className="text-amber-300" />
          <span>قربت على الشهادة في <b>{almostCert}</b> كورس — كمّل المتبقي عشان تستحقها! 🏆</span>
        </div>
      )}
      {overall === 100 && totalLec > 0 && (
        <div className="bg-white/15 rounded-xl px-4 py-2.5 flex items-center gap-2 text-sm">
          <Sparkles size={16} className="text-amber-300" /> مبروك! أكملت كل كورساتك 🎉
        </div>
      )}
    </div>
  );
};

export default StudentEngagementHero;
