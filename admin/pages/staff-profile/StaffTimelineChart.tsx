import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { fmtMoney, fmtNum, monthLabel, monthShort, type TimelinePoint } from './types';

type MetricKey = 'revenue' | 'bookings' | 'calls' | 'leads' | 'converted';

const METRICS: { key: MetricKey; label: string; color: string; kind: 'money' | 'count' }[] = [
  { key: 'revenue', label: 'الإيراد', color: '#059669', kind: 'money' },
  { key: 'bookings', label: 'الحجوزات', color: '#4f46e5', kind: 'count' },
  { key: 'calls', label: 'المكالمات', color: '#0891b2', kind: 'count' },
  { key: 'leads', label: 'الليدات', color: '#d97706', kind: 'count' },
  { key: 'converted', label: 'التحويلات', color: '#db2777', kind: 'count' },
];

// Chart geometry in viewBox units — rendered LTR (numeric axes read better
// that way even on an RTL page, same as the existing charts in this app) and
// scaled responsively by CSS, so it stays sharp at any width.
const H = 210;
const PAD_L = 46;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 26;

/** A "nice" axis ceiling so gridlines land on round numbers. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * The employee's whole employment period, month by month. `bars` is the primary
 * metric (revenue by default); `line` overlays a second metric on its own scale
 * so e.g. "revenue up while calls flat" is visible at a glance — the thing a
 * single-series chart can't show.
 */
export default function StaffTimelineChart({ timeline }: { timeline: TimelinePoint[] }) {
  const [barMetric, setBarMetric] = useState<MetricKey>('revenue');
  const [lineMetric, setLineMetric] = useState<MetricKey | 'none'>('calls');
  const [hover, setHover] = useState<number | null>(null);

  const bar = METRICS.find(m => m.key === barMetric)!;
  const line = lineMetric === 'none' ? null : METRICS.find(m => m.key === lineMetric)!;

  const W = Math.max(320, timeline.length * 34 + PAD_L + PAD_R);
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const { barMax, lineMax } = useMemo(() => ({
    barMax: niceMax(Math.max(...timeline.map(p => p[barMetric]), 0)),
    lineMax: line ? niceMax(Math.max(...timeline.map(p => p[line.key]), 0)) : 1,
  }), [timeline, barMetric, line]);

  const slot = timeline.length > 0 ? plotW / timeline.length : plotW;
  const barW = Math.min(22, Math.max(4, slot * 0.55));
  const xOf = (i: number) => PAD_L + slot * i + slot / 2;
  const yBar = (v: number) => PAD_T + plotH - (v / barMax) * plotH;
  const yLine = (v: number) => PAD_T + plotH - (v / lineMax) * plotH;

  const linePath = line
    ? timeline.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yLine(p[line.key]).toFixed(1)}`).join(' ')
    : '';

  const fmtByKind = (kind: 'money' | 'count', v: number) => (kind === 'money' ? fmtMoney(v) : fmtNum(v));
  // Year boundaries get a divider so a multi-year tenure is readable.
  const yearMarks = timeline
    .map((p, i) => ({ i, year: p.ym.slice(0, 4) }))
    .filter((p, idx, arr) => idx > 0 && p.year !== arr[idx - 1].year);

  const active = hover != null ? timeline[hover] : null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-800">
            <BarChart3 size={17} className="text-indigo-600" /> مسار الأداء خلال فترة العمل
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {timeline.length} شهر — من {timeline.length ? monthLabel(timeline[0].ym) : '—'} حتى الآن
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setBarMetric(m.key)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-bold border transition ${
                barMetric === m.key ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
              style={barMetric === m.key ? { backgroundColor: m.color } : undefined}
            >
              {m.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-gray-200" />
          <select
            value={lineMetric}
            onChange={e => setLineMetric(e.target.value as MetricKey | 'none')}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600"
            title="مقياس ثانوي كخط"
          >
            <option value="none">بدون خط مقارنة</option>
            {METRICS.filter(m => m.key !== barMetric).map(m => (
              <option key={m.key} value={m.key}>خط: {m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {timeline.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">لا توجد بيانات بعد لعرض المسار.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr', width: '100%', minWidth: Math.min(W, 900) }} role="img">
              {/* gridlines + primary axis labels */}
              {[0, 0.25, 0.5, 0.75, 1].map(t => {
                const y = PAD_T + plotH * (1 - t);
                return (
                  <g key={t}>
                    <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke="#f1f5f9" strokeWidth={1} />
                    <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize="8.5" fill="#94a3b8">
                      {barMax * t >= 1000 ? `${Math.round((barMax * t) / 1000)}k` : Math.round(barMax * t)}
                    </text>
                  </g>
                );
              })}

              {yearMarks.map(({ i, year }) => (
                <g key={year}>
                  <line x1={PAD_L + slot * i} y1={PAD_T} x2={PAD_L + slot * i} y2={PAD_T + plotH} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="3 3" />
                  <text x={PAD_L + slot * i + 3} y={PAD_T + 9} fontSize="8.5" fill="#cbd5e1" fontWeight="bold">{year}</text>
                </g>
              ))}

              {/* bars */}
              {timeline.map((p, i) => {
                const v = p[barMetric];
                const y = yBar(v);
                const h = Math.max(v > 0 ? 2 : 0, PAD_T + plotH - y);
                return (
                  <g key={p.ym} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                    <rect x={xOf(i) - slot / 2} y={PAD_T} width={slot} height={plotH} fill={hover === i ? '#f8fafc' : 'transparent'} />
                    <rect x={xOf(i) - barW / 2} y={y} width={barW} height={h} rx={2.5} fill={bar.color} opacity={hover == null || hover === i ? 0.92 : 0.42} />
                  </g>
                );
              })}

              {/* comparison line */}
              {line && (
                <>
                  <path d={linePath} fill="none" stroke={line.color} strokeWidth={1.8} strokeLinejoin="round" />
                  {timeline.map((p, i) => (
                    <circle key={p.ym} cx={xOf(i)} cy={yLine(p[line.key])} r={hover === i ? 3.4 : 2} fill="#fff" stroke={line.color} strokeWidth={1.6} />
                  ))}
                </>
              )}

              {/* x labels — thinned out so they never collide */}
              {timeline.map((p, i) => {
                const every = Math.ceil(timeline.length / 14);
                if (i % every !== 0 && i !== timeline.length - 1) return null;
                return (
                  <text key={p.ym} x={xOf(i)} y={H - 8} textAnchor="middle" fontSize="8.5" fill="#94a3b8">
                    {monthShort(p.ym)}
                  </text>
                );
              })}
            </svg>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1.5 text-gray-500">
                <span className="inline-block h-2.5 w-2.5 rounded" style={{ backgroundColor: bar.color }} /> {bar.label}
              </span>
              {line && (
                <span className="flex items-center gap-1.5 text-gray-500">
                  <span className="inline-block h-0.5 w-4" style={{ backgroundColor: line.color }} /> {line.label}
                </span>
              )}
            </div>
            {active && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-bold text-gray-700">
                {monthLabel(active.ym)} · {bar.label}: {fmtByKind(bar.kind, active[barMetric])}
                {line ? ` · ${line.label}: ${fmtByKind(line.kind, active[line.key])}` : ''}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
