import type { ReactElement } from 'react';

/** Height of the bar track; both series are scaled into it. */
export const BAR_TRACK_PX = 72;

export interface ActivityDay {
  day: string;
  label: string;
  calls: number;
  converted: number;
}

/**
 * The seven-day calls-and-conversions bars on «ملفي الشخصي».
 *
 * One scale for both series and a fixed track the bars cannot leave. The
 * conversion bar used to be scaled by the busiest day's CALLS and had no ceiling,
 * so a day with more conversions than calls — conversions are counted by the
 * converted lead's last-edited date, and one bulk edit moves hundreds of them to
 * the same day — grew to thousands of pixels and ran off the page.
 */
export function StaffActivityChart({ days, today }: { days: ActivityDay[]; today: string }): ReactElement {
  const maxBar = Math.max(...days.map(d => Math.max(d.calls, d.converted)), 1);
  return (
    <div className="flex items-end gap-1.5 h-28 overflow-hidden">
      {days.map(d => {
        const isToday = d.day === today;
        const callsPx = d.calls > 0 ? Math.max(6, Math.round((d.calls / maxBar) * BAR_TRACK_PX)) : 6;
        const convPx = d.converted > 0 ? Math.max(6, Math.round((d.converted / maxBar) * BAR_TRACK_PX)) : 0;
        return (
          <div key={d.day} className="flex-1 min-w-0 flex flex-col items-center gap-1">
            <span className="text-[9px] text-gray-400 font-medium h-3 leading-3">
              {d.calls > 0 || d.converted > 0 ? `${d.calls}${d.converted > 0 ? `/${d.converted}` : ''}` : ''}
            </span>
            <div className="w-full flex items-end gap-0.5" style={{ height: `${BAR_TRACK_PX}px` }}>
              <div
                className="flex-1 rounded-t-md transition-all duration-500"
                style={{
                  height: `${callsPx}px`,
                  background: isToday
                    ? 'linear-gradient(180deg,#6366f1,#4f46e5)'
                    : 'linear-gradient(180deg,#a5b4fc,#818cf8)',
                  opacity: d.calls === 0 ? 0.25 : 1,
                }}
              />
              {convPx > 0 && (
                <div className="flex-1 rounded-t-md bg-emerald-500" style={{ height: `${convPx}px` }} />
              )}
            </div>
            <span className={`text-[9px] ${isToday ? 'text-indigo-600 font-bold' : 'text-gray-400'}`}>{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}
