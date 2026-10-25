import type { ReactNode } from 'react';

export const field = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100';
export const primaryButton = 'inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-primary-700 disabled:opacity-50';
export const quietButton = 'inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50';

export function Card({ title, icon, actions, children }: { title?: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-gray-900">{icon}{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = 'gray' }: { label: string; value: ReactNode; hint?: string; tone?: 'gray' | 'amber' | 'emerald' | 'blue' | 'red' | 'violet' }) {
  const tones = {
    gray: 'border-gray-200 text-gray-900', amber: 'border-amber-200 bg-amber-50/60 text-amber-800', emerald: 'border-emerald-200 bg-emerald-50/60 text-emerald-800',
    blue: 'border-blue-200 bg-blue-50/60 text-blue-800', red: 'border-red-200 bg-red-50/60 text-red-800', violet: 'border-violet-200 bg-violet-50/60 text-violet-800',
  };
  return (
    <div className={`rounded-2xl border bg-white p-4 ${tones[tone]}`}>
      <p className="text-xs font-bold opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] opacity-70">{hint}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">{children}</div>;
}

export function Loading() {
  return <div className="grid place-items-center py-16"><div className="h-9 w-9 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" /></div>;
}
