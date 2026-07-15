import React from 'react';

export const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="mb-1 block text-xs font-semibold text-gray-500">{label}</label>
    {children}
  </div>
);

export const TextInput = ({
  value,
  onChange,
  placeholder = '',
  type = 'text',
  suffix = '',
}: {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  suffix?: string;
}) => (
  <div className="flex items-center gap-1">
    <input
      type={type}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
    />
    {suffix && <span className="whitespace-nowrap text-xs text-gray-400">{suffix}</span>}
  </div>
);

export const Card = ({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) => (
  <div className="rounded-2xl border border-gray-200 bg-white p-5">
    <div className="mb-4 border-b border-gray-100 pb-3">
      <h4 className="text-sm font-bold text-gray-700">{title}</h4>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
    {children}
  </div>
);
