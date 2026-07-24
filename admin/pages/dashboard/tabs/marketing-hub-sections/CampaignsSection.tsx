import { Mail, Smartphone, MessageCircle, UserPlus } from 'lucide-react';
import type { JoinUsApplication, LeadItem } from '../../../../types';
import type { NotifyFn } from './shared';
import { AbTestSection } from './AbTestSection';

interface Props {
  joinUsApplications: JoinUsApplication[];
  leads: LeadItem[];
  notify: NotifyFn;
}

const CAMPAIGN_CARDS = [
  {
    icon: Mail, title: 'حملات البريد الإلكتروني', color: 'from-blue-600 to-indigo-600',
    stats: [
      { label: 'حملات منشأة', value: '0' },
      { label: 'إيميلات مرسلة', value: '—' },
      { label: 'معدل الفتح', value: '—' },
    ],
    badge: 'قريباً',
  },
  {
    icon: Smartphone, title: 'حملات SMS والدريب', color: 'from-green-600 to-teal-600',
    stats: [
      { label: 'تسلسلات نشطة', value: '0' },
      { label: 'رسائل مرسلة', value: '—' },
      { label: 'معدل الرد', value: '—' },
    ],
    badge: 'قريباً',
  },
  {
    icon: MessageCircle, title: 'حملات WhatsApp', color: 'from-emerald-600 to-green-600',
    stats: [
      { label: 'قوائم نشطة', value: '0' },
      { label: 'رسائل مرسلة', value: '—' },
      { label: 'معدل الوصول', value: '—' },
    ],
    badge: 'قريباً',
  },
];

export function CampaignsSection({ joinUsApplications, leads, notify }: Props) {
  return (
    <div className="space-y-5">

      {/* Campaign type cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {CAMPAIGN_CARDS.map(c => (
          <div key={c.title} className={`bg-gradient-to-br ${c.color} rounded-2xl p-5 text-white relative overflow-hidden`}>
            <div className="absolute top-2 left-2 text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">{c.badge}</div>
            <c.icon size={28} className="mb-3 opacity-90" />
            <h3 className="font-bold text-base mb-3">{c.title}</h3>
            <div className="grid grid-cols-3 gap-2">
              {c.stats.map(s => (
                <div key={s.label} className="bg-white/15 rounded-xl p-2 text-center">
                  <div className="font-bold text-sm">{s.value}</div>
                  <div className="text-xs opacity-80 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Join us as marketing signal */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <UserPlus size={16} className="text-rose-500" /> طلبات الانضمام — مؤشر تسويقي
          </h3>
          <span className="text-xs text-gray-400">{joinUsApplications.length} طلب</span>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            {[
              { label: 'إجمالي الطلبات', value: joinUsApplications.length, color: 'text-gray-700', bg: 'bg-gray-50' },
              { label: 'قيد المراجعة', value: joinUsApplications.filter(a => a.status === 'pending').length, color: 'text-yellow-600', bg: 'bg-yellow-50' },
              { label: 'مقبول', value: joinUsApplications.filter(a => a.status === 'accepted').length, color: 'text-green-600', bg: 'bg-green-50' },
              { label: 'مرفوض', value: joinUsApplications.filter(a => a.status === 'rejected').length, color: 'text-red-500', bg: 'bg-red-50' },
            ].map(s => (
              <div key={s.label} className={`${s.bg} rounded-xl p-3`}>
                <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* A/B Test WhatsApp Campaign */}
      <AbTestSection leads={leads} notify={notify} />
    </div>
  );
}
