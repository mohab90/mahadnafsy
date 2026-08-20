/** Shape of GET /api/admin/hr/staff/:id/profile — see api/routes/hr/staffprofile.js */

export interface TimelinePoint {
  ym: string;
  revenue: number;
  bookings: number;
  leads: number;
  converted: number;
  calls: number;
  touches: number;
}

export interface LeaderboardRow {
  position: number;
  id: string;
  name: string;
  revenue: number;
  bookings: number;
  calls: number;
}

export interface StaffProfileData {
  staff: {
    id: string;
    name: string;
    role: string;
    joinedAt: string | null;
    commissionRate: number;
    monthlyTarget: number;
    monthlyTargetType: 'egp' | 'clients';
    monthlyBonus: number;
  };
  today: { date: string; calls: number; touches: number; bookings: number; revenue: number; leads: number };
  timeline: TimelinePoint[];
  lifetime: {
    firstSaleAt: string | null;
    biggestSale: number;
    bookings: number;
    revenue: number;
    calls: number;
    leads: number;
    converted: number;
    bestMonth: { ym: string; revenue: number } | null;
  };
  rank: { position: number | null; outOf: number; board: LeaderboardRow[] };
  tasks: { todo: number; inProgress: number; done: number; overdue: number };
}

export interface StaffMessage {
  id: string;
  author_name: string;
  /** peer_broadcast = a colleague's team message that landed in this thread. */
  direction: 'to_staff' | 'from_staff' | 'peer_broadcast';
  broadcast_label?: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
}

export const fmtNum = (n: number) => Number(n || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 });
export const fmtMoney = (n: number) => `${fmtNum(n)} ج.م`;

/** "2026-08" → "أغسطس 2026" */
export const monthLabel = (ym: string) => {
  const [year, month] = String(ym || '').split('-');
  const date = new Date(Number(year), Number(month) - 1, 1);
  if (Number.isNaN(date.getTime())) return ym;
  return date.toLocaleDateString('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' });
};

/** Compact axis label — "8/26" */
export const monthShort = (ym: string) => {
  const [year, month] = String(ym || '').split('-');
  return `${Number(month)}/${String(year).slice(2)}`;
};
