// The SEO score of the course or track being edited, live as the form changes:
// the score out of 10, what Google would show, and what to fix first.
// The scoring itself is admin/lib/seoScore.ts.

import { useMemo, useState } from 'react';
import { scoreSeo, type SeoInput } from '../../../../lib/seoScore';

const STATE_STYLE = {
  good: { dot: 'bg-emerald-500', text: 'text-emerald-700', mark: '✓' },
  partial: { dot: 'bg-amber-400', text: 'text-amber-700', mark: '½' },
  bad: { dot: 'bg-red-500', text: 'text-red-700', mark: '✗' },
} as const;

export default function SeoScorePanel({ input }: { input: SeoInput }) {
  const report = useMemo(() => scoreSeo(input), [input]);
  const [showAll, setShowAll] = useState(false);
  const toFix = report.checks
    .filter(c => c.state !== 'good')
    .sort((a, b) => (b.weight - b.earned) - (a.weight - a.earned));
  const done = report.checks.filter(c => c.state === 'good');
  const tone = report.score >= 8.5 ? 'emerald' : report.score >= 7 ? 'sky' : report.score >= 5 ? 'amber' : 'red';
  const ring = { emerald: '#10b981', sky: '#0ea5e9', amber: '#f59e0b', red: '#ef4444' }[tone];
  const pct = report.score * 10;

  return (
    <div className="border border-violet-200 rounded-xl bg-white p-3 space-y-3" data-testid="seo-score">
      <div className="flex flex-wrap items-center gap-4">
        <div
          className="relative w-20 h-20 rounded-full grid place-items-center shrink-0"
          style={{ background: `conic-gradient(${ring} ${pct}%, #ede9fe 0)` }}
          aria-label={`تقييم SEO ${report.score} من 10`}
        >
          <div className="w-16 h-16 rounded-full bg-white grid place-items-center">
            <span className="text-xl font-black text-gray-900 tabular-nums" dir="ltr">{report.score}<span className="text-xs text-gray-400">/10</span></span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900">تقييم SEO: <span style={{ color: ring }}>{report.grade}</span></p>
          <p className="text-xs text-gray-500">{done.length} من {report.checks.length} نقطة مكتملة — {toFix.length ? 'ابدأ بأول مقترح تحت، هو اللي هيرفع التقييم أكتر.' : 'الصفحة مجهزة كويس للبحث.'}</p>
        </div>
      </div>

      {/* What the result looks like in Google */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-right" dir="rtl">
        <p className="text-[11px] text-gray-500 mb-0.5">كده هتظهر في جوجل:</p>
        <p className="text-[11px] text-emerald-800 truncate" dir="ltr">mahadnafsy.com{report.snippet.path}</p>
        <p className="text-[15px] text-[#1a0dab] leading-snug line-clamp-1">{report.snippet.title || '— بدون عنوان —'}</p>
        <p className="text-xs text-gray-600 line-clamp-2">{report.snippet.description || 'جوجل هيختار جملة من الصفحة لأن مفيش وصف.'}</p>
      </div>

      {toFix.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-gray-700">مقترحات لتقوية الصفحة</p>
          {toFix.map(c => (
            <div key={c.id} className="flex items-start gap-2 text-xs">
              <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${STATE_STYLE[c.state].dot}`} />
              <div className="min-w-0 flex-1">
                <span className={`font-bold ${STATE_STYLE[c.state].text}`}>{c.label}</span>
                <span className="text-gray-400"> · +{(c.weight - c.earned) / 10} </span>
                <p className="text-gray-600">{c.tip}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowAll(v => !v)} className="text-xs font-bold text-violet-700">
            {showAll ? 'إخفاء النقاط المكتملة' : `عرض النقاط المكتملة (${done.length})`}
          </button>
          {showAll && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {done.map(c => (
                <span key={c.id} className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[11px]">✓ {c.label}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
