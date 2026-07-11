import React from 'react';

// Shared payment-method / order-type badge renderers used across the orders views.
export const payMethodBadge = (m: string | undefined) => {
  const map: Record<string, { label: string; cls: string }> = {
    cash:          { label: 'نقدي',          cls: 'bg-gray-100 text-gray-700' },
    transfer:      { label: 'تحويل بنكي',    cls: 'bg-blue-100 text-blue-700' },
    vodafone_cash: { label: 'فودافون كاش',   cls: 'bg-red-100 text-red-700' },
    instapay:      { label: 'انستا باي',     cls: 'bg-purple-100 text-purple-700' },
    online_paymob: { label: 'أونلاين/بطاقة', cls: 'bg-indigo-100 text-indigo-700' },
    card:          { label: 'بطاقة بنكية',   cls: 'bg-cyan-100 text-cyan-700' },
    wallet:        { label: 'محفظة',          cls: 'bg-teal-100 text-teal-700' },
    manual:        { label: 'يدوي',           cls: 'bg-orange-100 text-orange-700' },
  };
  const key = (m || '').toLowerCase();
  const info = map[key] || { label: m || '—', cls: 'bg-gray-100 text-gray-500' };
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${info.cls}`}>{info.label}</span>;
};

export const typeBadge = (t: string | undefined) => {
  const map: Record<string, { label: string; cls: string }> = {
    course:       { label: 'كورس',       cls: 'bg-emerald-100 text-emerald-700' },
    bundle:       { label: 'مسار',        cls: 'bg-violet-100 text-violet-700' },
    consultation: { label: 'استشارة',    cls: 'bg-amber-100 text-amber-700' },
    certificate:  { label: 'شهادة',      cls: 'bg-sky-100 text-sky-700' },
  };
  const info = map[t || ''] || { label: t || '—', cls: 'bg-gray-100 text-gray-500' };
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${info.cls}`}>{info.label}</span>;
};
