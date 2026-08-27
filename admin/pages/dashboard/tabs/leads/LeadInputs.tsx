// Small shared inputs: the tag editor and the multi-select dropdown.
//
// Moved out of LeadSubcomponents.tsx, which had grown to 1,277 lines across
// seventeen unrelated exports. It still re-exports this, so the ten files that
// import from it are untouched.

import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { LeadItem, LeadStatus, CommunicationRecord, Course, Bundle } from '../../../../types';
import { courseBadgeLabel, isRawCourse } from './leadCourseLabel';
import {
  PRESET_TAGS,
} from '../leadUtils';


export function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [inp, setInp] = useState('');
  const add = (tag: string) => { const t = tag.trim(); if (t && !tags.includes(t)) onChange([...tags, t]); setInp(''); };
  const remove = (tag: string) => onChange(tags.filter(t => t !== tag));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1 min-h-[22px]">
        {tags.map(tag => (
          <span key={tag} className="flex items-center gap-0.5 px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full text-[10px] font-bold">
            {tag}
            <button type="button" onClick={() => remove(tag)} className="hover:text-red-600 leading-none"><X size={10} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input value={inp} onChange={e => setInp(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(inp); } }}
          placeholder="اكتب تاج ثم Enter..."
          className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
        {inp.trim() && <button type="button" onClick={() => add(inp)} className="bg-indigo-600 text-white px-2 py-1.5 rounded-lg text-xs"><Plus size={12} /></button>}
      </div>
      <div className="flex flex-wrap gap-1">
        {PRESET_TAGS.filter(t => !tags.includes(t)).map(t => (
          <button type="button" key={t} onClick={() => add(t)}
            className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-700 rounded-full border border-gray-200 transition">+ {t}</button>
        ))}
      </div>
    </div>
  );
}


export function MultiSelectDropdown({ label, options, selected, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const toggle = (v: string) => {
    const next = new Set(selected);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange(next);
  };
  const displayLabel = selected.size === 0
    ? label
    : selected.size === 1
      ? (options.find(o => selected.has(o.value))?.label ?? label)
      : `${label} (${selected.size})`;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition ${
          selected.size > 0
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300'
        }`}>
        {displayLabel}
        <span className="text-[10px] opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute top-full mt-1 end-0 z-50 bg-white border border-gray-200 rounded-xl shadow-xl min-w-[190px] py-1 max-h-64 overflow-y-auto">
          <button
            onClick={() => { onChange(new Set()); setOpen(false); }}
            className="w-full text-right px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition">
            ✓ الكل (إلغاء التصفية)
          </button>
          <div className="border-t border-gray-100 my-1" />
          {options.map(opt => (
            <button key={opt.value} onClick={() => toggle(opt.value)}
              className={`w-full text-right flex items-center gap-2 px-3 py-1.5 text-xs transition ${
                selected.has(opt.value) ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-700 hover:bg-gray-50'
              }`}>
              <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center ${
                selected.has(opt.value) ? 'bg-indigo-600 border-indigo-600' : 'border-gray-300'
              }`}>
                {selected.has(opt.value) && <span className="text-white text-[8px] font-bold leading-none">✓</span>}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── LeadTable component (from LeadsTab) ─────────────────────────────────────
export type CertPricingMap = Record<string, { egyptianEGP: number; residentEGP: number; residentSAR: number; foreignUSD: number }>;

// ── Compatibility aliases & helpers ──────────────────────────────────────────
