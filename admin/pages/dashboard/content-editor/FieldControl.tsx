import { useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, ImageOff, PlayCircle, RotateCcw, VideoOff } from 'lucide-react';

import { copyText } from '../../../../shared/copyText';
import { fieldType, type EditorField } from './types';
import { youtubeId, youtubeThumb } from './youtube';

type Props = {
  field: EditorField;
  /** What is on screen: the unsaved edit, else what is saved. */
  value: string;
  /** What the site shows while the field is empty. */
  defaultText: string;
  dirty: boolean;
  onChange: (value: string) => void;
};

const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100';

/** Long enough that its length is worth showing. */
const LONG_TEXT = 60;

function KeyChip({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      dir="ltr"
      title="انسخ اسم المفتاح"
      onClick={async () => {
        if (await copyText(name)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }
      }}
      className="inline-flex max-w-full items-center gap-1 truncate rounded-md px-1 font-mono text-[10px] text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
    >
      {copied ? <Check size={10} className="flex-none text-emerald-500" /> : <Copy size={10} className="flex-none" />}
      <span className="truncate">{name}</span>
    </button>
  );
}

function Toggle({ on, onChange, onLabel, offLabel }: { on: boolean; onChange: (next: boolean) => void; onLabel: string; offLabel: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`inline-flex items-center gap-3 rounded-xl border px-3 py-2 text-sm font-bold transition ${
        on ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-500'
      }`}
    >
      <span className={`relative h-5 w-9 flex-none rounded-full transition ${on ? 'bg-emerald-500' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? 'right-[18px]' : 'right-0.5'}`} />
      </span>
      {on ? onLabel : offLabel}
    </button>
  );
}

function YoutubePreview({ value }: { value: string }) {
  if (!value.trim()) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-bold leading-5 text-amber-800">
        <VideoOff size={16} className="mt-0.5 flex-none" />
        الفيديو مش ظاهر في الموقع لحد ما تحط رابط يوتيوب هنا
      </div>
    );
  }
  const id = youtubeId(value);
  if (!id) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-bold leading-5 text-red-700">
        <AlertTriangle size={16} className="mt-0.5 flex-none" />
        الرابط ده مش رابط فيديو يوتيوب. انسخ الرابط من زرار «مشاركة» في يوتيوب (youtube.com/watch أو youtu.be أو shorts).
      </div>
    );
  }
  return (
    <a
      href={`https://www.youtube.com/watch?v=${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block w-full max-w-xs overflow-hidden rounded-xl border border-gray-200 bg-gray-900"
    >
      <img src={youtubeThumb(id)} alt="صورة الفيديو من يوتيوب" loading="lazy" className="aspect-video w-full object-cover opacity-90 transition group-hover:opacity-100" />
      <span className="absolute inset-0 grid place-items-center">
        <PlayCircle size={44} className="text-white drop-shadow-lg" />
      </span>
      <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
        <ExternalLink size={10} /> افتح في يوتيوب
      </span>
    </a>
  );
}

function ImagePreview({ value }: { value: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!value.trim()) return null;
  if (broken === value) {
    return (
      <div className="flex items-center gap-2 text-xs font-bold text-red-600">
        <ImageOff size={14} /> الصورة مش بتفتح من الرابط ده
      </div>
    );
  }
  return (
    <img
      src={value}
      alt="معاينة الصورة"
      onError={() => setBroken(value)}
      className="h-20 w-auto max-w-[220px] rounded-xl border border-gray-200 bg-gray-50 object-contain p-1"
    />
  );
}

/**
 * One content key: a friendly label, the input for its kind, what the site
 * shows while it is empty, and — small, out of the way — the key itself.
 */
export function FieldControl({ field, value, defaultText, dirty, onChange }: Props) {
  const type = fieldType(field);
  const placeholder = field.placeholder ?? defaultText;
  const resettable = value !== '' && value !== defaultText;
  const longText = type === 'textarea' || ((type === 'text') && (value.length > LONG_TEXT || placeholder.length > LONG_TEXT));
  const id = `field-${field.key.replace(/[^\w-]/g, '_')}`;

  let control;
  switch (type) {
    case 'textarea':
      control = (
        <textarea id={id} className={`${inputClass} min-h-[96px] leading-6`} rows={3} value={value} placeholder={placeholder}
          onChange={event => onChange(event.target.value)} />
      );
      break;
    case 'number':
      control = (
        <input id={id} type="number" dir="ltr" inputMode="decimal" min={field.min} max={field.max} className={`${inputClass} max-w-[200px] text-left`}
          value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
      );
      break;
    case 'toggle': {
      const on = value === '' ? field.defaultOn !== false : value === 'true';
      control = <Toggle on={on} onChange={next => onChange(next ? 'true' : 'false')} onLabel={field.onLabel || 'ظاهر في الموقع'} offLabel={field.offLabel || 'مخفي'} />;
      break;
    }
    case 'select':
      control = (
        <select id={id} className={inputClass} value={value} onChange={event => onChange(event.target.value)}>
          <option value="">{field.placeholder ?? (defaultText ? `الافتراضي — ${defaultText}` : '— اختار —')}</option>
          {(field.options || []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          {value && !(field.options || []).some(option => option.value === value) && <option value={value}>{value}</option>}
        </select>
      );
      break;
    case 'youtube':
      control = (
        <div className="space-y-2">
          <input id={id} type="url" dir="ltr" className={`${inputClass} text-left`} value={value}
            placeholder={placeholder || 'https://www.youtube.com/watch?v=…'} onChange={event => onChange(event.target.value)} />
          <YoutubePreview value={value} />
        </div>
      );
      break;
    case 'image':
      control = (
        <div className="space-y-2">
          <input id={id} type="url" dir="ltr" className={`${inputClass} text-left`} value={value}
            placeholder={placeholder || 'https://…'} onChange={event => onChange(event.target.value)} />
          <ImagePreview value={value} />
        </div>
      );
      break;
    case 'url':
      control = (
        <input id={id} type="url" dir="ltr" className={`${inputClass} text-left`} value={value}
          placeholder={placeholder || 'https://…'} onChange={event => onChange(event.target.value)} />
      );
      break;
    default:
      control = (
        <input id={id} className={inputClass} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
      );
  }

  const wide = field.wide ?? ['textarea', 'youtube', 'image'].includes(type);

  return (
    <div className={`min-w-0 space-y-1.5 ${wide ? 'md:col-span-2' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-bold text-gray-800">
          {dirty && <span className="h-2 w-2 flex-none rounded-full bg-amber-400" title="تعديل مش محفوظ" />}
          {field.label}
        </label>
        {resettable && (
          <button type="button" onClick={() => onChange('')}
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-bold text-gray-400 transition hover:bg-gray-100 hover:text-primary-700">
            <RotateCcw size={11} /> {type === 'text' || type === 'textarea' ? 'رجّع للنص الأصلي' : 'رجّع للأصلي'}
          </button>
        )}
      </div>
      {control}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          {field.hint && <p className="text-xs leading-5 text-gray-500">{field.hint}</p>}
          <KeyChip name={field.key} />
        </div>
        {longText && <span className="flex-none pt-0.5 text-[11px] tabular-nums text-gray-400">{value.length} حرف</span>}
      </div>
    </div>
  );
}
