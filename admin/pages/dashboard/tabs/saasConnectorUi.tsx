import React from 'react';
import { CheckCircle, RefreshCw, Save } from 'lucide-react';

export type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export const SECRET_MASK = '••••••••';

export const SectionHeader = ({
  title,
  subtitle,
  icon,
  tone = 'indigo',
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tone?: 'indigo' | 'emerald' | 'blue' | 'amber' | 'rose';
}) => {
  const toneClass = {
    indigo: 'from-indigo-600 to-violet-600',
    emerald: 'from-emerald-600 to-teal-600',
    blue: 'from-blue-600 to-cyan-600',
    amber: 'from-amber-500 to-orange-600',
    rose: 'from-rose-600 to-pink-600',
  }[tone];
  return (
    <div className={`rounded-2xl bg-gradient-to-l ${toneClass} p-5 text-white`}>
      <h2 className="flex items-center gap-2 text-xl font-bold">{icon}{title}</h2>
      <p className="mt-1 text-sm text-white/80">{subtitle}</p>
    </div>
  );
};

export const Card = ({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) => (
  <section className="rounded-2xl border border-gray-200 bg-white p-5">
    <div className="mb-4 border-b border-gray-100 pb-3">
      <h3 className="text-sm font-bold text-gray-800">{title}</h3>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
    {children}
  </section>
);

export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
    {children}
  </label>
);

export const Input = ({
  value,
  onChange,
  type = 'text',
  placeholder = '',
}: {
  value: string | number | boolean | undefined;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) => (
  <input
    type={type}
    value={String(value ?? '')}
    onChange={event => onChange(event.target.value)}
    placeholder={placeholder}
    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
  />
);

export const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-gray-300'}`}
  >
    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'right-5' : 'right-0.5'}`} />
  </button>
);

export const SaveBar = ({
  dirty,
  saving,
  onSave,
  onTest,
  testing,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onTest?: () => void;
  testing?: boolean;
}) => (
  <div className="flex flex-wrap items-center justify-end gap-2">
    {onTest && (
      <button
        type="button"
        onClick={onTest}
        disabled={testing}
        className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
      >
        {testing ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle size={15} />}
        اختبار الربط
      </button>
    )}
    <button
      type="button"
      onClick={onSave}
      disabled={!dirty || saving}
      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
      حفظ الإعدادات
    </button>
  </div>
);

export function setNested<T extends Record<string, any>>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const next: any = { ...obj };
  let cursor = next;
  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      cursor[key] = value;
    } else {
      cursor[key] = { ...(cursor[key] || {}) };
      cursor = cursor[key];
    }
  });
  return next;
}

