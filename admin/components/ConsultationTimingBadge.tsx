import { Clock, Zap } from 'lucide-react';
import { consultationTiming } from '../lib/consultations';
import type { ConsultationItem } from '../types';

/** «عاجلة خلال 60 دقيقة» or «استشارة بموعد» with its day and hour — on every consultation, admin and doctor side. */
export function ConsultationTimingBadge({ item }: { item: Parameters<typeof consultationTiming>[0] & Partial<ConsultationItem> }) {
  const timing = consultationTiming(item);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${timing.urgent ? 'border-red-200 bg-red-50 text-red-700' : 'border-indigo-200 bg-indigo-50 text-indigo-700'}`}>
        {timing.urgent ? <Zap size={11} /> : <Clock size={11} />}{timing.label}
      </span>
      <span className="text-[11px] font-bold text-gray-600">{timing.when}</span>
    </div>
  );
}
