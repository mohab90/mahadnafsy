// Lead score presentation and the journey timeline built from communications.
//
// Moved out of LeadSubcomponents.tsx, which had grown to 1,277 lines across
// seventeen unrelated exports. It still re-exports this, so the ten files that
// import from it are untouched.

import { useEffect, useMemo, useState } from 'react';
import { MapPin } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { LeadItem, LeadStatus, CommunicationRecord, Course, Bundle } from '../../../../types';
import { courseBadgeLabel, isRawCourse } from './leadCourseLabel';
import {
  BRANCH_ENUM_LABELS,
  COMM_ICON,
  COMM_LABEL,
  IL_LABEL,
  PRESET_TAGS,
  ROTTEN_CFG,
  STATUS_CFG,
  calcLeadScore,
  getLeadBranchRaw,
  getRottenLevel,
  // getScoreBreakdown is deliberately not taken from leadUtils — the version
  // defined below is richer.
} from '../leadUtils';


export function getScoreBreakdown(lead: LeadItem) {
  const statusScore: Partial<Record<LeadStatus, number>> = {
    new: 5, contacted: 15, interested: 35, no_answer: 8, not_interested: 0, closed: 50, converted: 100, lost: 0,
  };
  const ilScore = lead.interestLevel === 'high' ? 30 : lead.interestLevel === 'medium' ? 15 : 5;
  const commScore = Math.min((lead.communicationCount ?? lead.communications?.length ?? 0) * 5, 25);
  return [
    { label: 'حالة الليد',       pts: statusScore[lead.status] ?? 0, max: 50 },
    { label: 'مستوى الاهتمام',  pts: ilScore, max: 30, tip: lead.interestLevel !== 'high' ? `ارفع لـ عالي +${30 - ilScore}` : '' },
    { label: 'تواصلات',          pts: commScore, max: 25, tip: commScore < 25 ? `سجّل تواصل إضافي +${25 - commScore}` : '' },
    { label: 'موعد متابعة',     pts: lead.nextFollowUpDate ? 5 : 0, max: 5, tip: !lead.nextFollowUpDate ? 'أضف موعد +5' : '' },
    { label: 'كورسات مهتم بها', pts: (lead.interestedCourseIds?.length || 0) > 0 ? 10 : 0, max: 10, tip: !(lead.interestedCourseIds?.length) ? 'أضف كورس +10' : '' },
  ];
}


export function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-500' : 'bg-gray-400';
  return (
    <span className={`${color} text-white text-[11px] font-bold px-1.5 py-0.5 rounded-full`}>{score}</span>
  );
}

// ── Lead Journey Timeline Component ──────────────────────────────────────────
export interface TimelineEvent {
  id: string;
  leadId: string;
  eventType: string;
  description: string;
  meta: Record<string, string>;
  at: string;
}


export const EVENT_CFG: Record<string, { icon: string; color: string; label: string }> = {
  created:        { icon: '🌱', color: 'border-emerald-400 bg-emerald-50',  label: 'إنشاء' },
  status_changed: { icon: '🔄', color: 'border-blue-400 bg-blue-50',        label: 'تغيير حالة' },
  communication:  { icon: '💬', color: 'border-primary-400 bg-primary-50',  label: 'تواصل' },
  assigned:       { icon: '👤', color: 'border-purple-400 bg-purple-50',    label: 'تعيين' },
  followup_set:   { icon: '📅', color: 'border-amber-400 bg-amber-50',      label: 'موعد متابعة' },
  converted:      { icon: '🎉', color: 'border-green-500 bg-green-50',      label: 'تحويل' },
};


export function LeadJourneyTimeline({ leadId, communications }: {
  leadId: string;
  communications?: CommunicationRecord[];
}) {
  const [dbEvents, setDbEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    mysqlAdmin.getLeadTimeline(leadId)
      .then((rows) => setDbEvents((rows as unknown as TimelineEvent[]) || []))
      .catch(() => setDbEvents([]))
      .finally(() => setLoading(false));
  }, [leadId]);

  // Merge DB events + local communications (fallback for older leads with no DB events)
  const allEvents = useMemo(() => {
    const events: Array<{ id: string; eventType: string; description: string; at: string; fromDb: boolean }> = [
      ...dbEvents.map(e => ({ id: e.id, eventType: e.eventType, description: e.description, at: String(e.at), fromDb: true })),
    ];
    // Only add comm records that aren't already in DB events
    if (dbEvents.length === 0 && (communications || []).length > 0) {
      (communications || []).forEach(c => {
        const TYPE_AR: Record<string, string> = { call: '📞 مكالمة', whatsapp: '💬 واتساب', email: '✉️ إيميل', meeting: '🤝 اجتماع', note: '📝 ملاحظة', payment_followup: '💰 متابعة دفع', new_course_sale: '🎓 بيع كورس', certificate: '📜 شهادة' };
        events.push({ id: c.id, eventType: 'communication', description: `${TYPE_AR[c.type] || c.type}${c.notes ? ': ' + c.notes : ''}`, at: c.date, fromDb: false });
      });
    }
    return events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }, [dbEvents, communications]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-gray-400">
        <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin" />
        جاري تحميل رحلة الليد...
      </div>
    );
  }

  if (allEvents.length === 0) return null;

  return (
    <div>
      <label className="text-xs font-bold text-gray-600 mb-3 block flex items-center gap-1.5">
        <MapPin size={11} /> رحلة الليد <span className="text-gray-400 font-normal">({allEvents.length} حدث)</span>
      </label>
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute right-[7px] top-3 bottom-3 w-0.5 bg-gray-200" />
        <div className="space-y-3 pr-6">
          {allEvents.map(ev => {
            const cfg = EVENT_CFG[ev.eventType] || { icon: '●', color: 'border-gray-300 bg-gray-50', label: ev.eventType };
            const dateStr = ev.at ? String(ev.at).slice(0, 16).replace('T', ' ') : '';
            return (
              <div key={ev.id} className="relative">
                {/* Dot */}
                <div className={`absolute -right-6 top-2.5 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center text-[8px] bg-white ${cfg.color.split(' ')[0]}`}>
                  <span>{cfg.icon.codePointAt(0)! > 127 ? '' : cfg.icon}</span>
                </div>
                <div className={`rounded-xl px-3 py-2 border ${cfg.color}`}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-wide opacity-60">{cfg.icon} {cfg.label}</span>
                    <span className="text-[9px] text-gray-400 shrink-0">{dateStr}</span>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{ev.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Quick Edit Panel ──────────────────────────────────────────────────────────
