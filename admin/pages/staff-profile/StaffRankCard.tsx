import React from 'react';
import { Trophy, Medal } from 'lucide-react';
import { fmtMoney, fmtNum, type StaffProfileData } from './types';

const MEDAL = ['🥇', '🥈', '🥉'];

/**
 * "ترتيب نجاحه" — the employee's standing across the whole active team for the
 * current month, plus the top-10 board with them highlighted (and appended if
 * they rank outside the top 10, so the card always answers "where am I?").
 */
export default function StaffRankCard({ data }: { data: StaffProfileData }) {
  const { rank, staff } = data;
  const inBoard = rank.board.some(row => String(row.id) === String(staff.id));
  const self = rank.position && !inBoard
    ? { position: rank.position, id: staff.id, name: staff.name, revenue: 0, bookings: 0, calls: 0 }
    : null;
  const pct = rank.position && rank.outOf > 1
    ? Math.round(((rank.outOf - rank.position) / (rank.outOf - 1)) * 100)
    : null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 flex items-center gap-2 text-base font-bold text-gray-800">
        <Trophy size={17} className="text-amber-500" /> ترتيب الأداء بين الفريق
      </h3>

      {rank.position == null ? (
        <p className="py-6 text-center text-sm text-gray-400">هذا الموظف غير مدرج في ترتيب هذا الشهر.</p>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-4 rounded-2xl bg-gradient-to-l from-amber-50 to-white border border-amber-100 p-4">
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-white shadow-sm">
              <span className="text-3xl leading-none">{MEDAL[rank.position - 1] || '🎯'}</span>
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-black text-gray-900">
                المركز {fmtNum(rank.position)}
                <span className="text-sm font-bold text-gray-400"> من {fmtNum(rank.outOf)}</span>
              </p>
              {pct != null && (
                <p className="mt-0.5 text-xs font-bold text-amber-700">
                  أفضل من {pct}% من الفريق هذا الشهر
                </p>
              )}
              <p className="text-[11px] text-gray-400 mt-0.5">الترتيب حسب إيراد الشهر الحالي، ثم الحجوزات، ثم المكالمات.</p>
            </div>
          </div>

          <div className="space-y-1">
            {[...rank.board, ...(self ? [self] : [])].map(row => {
              const isSelf = String(row.id) === String(staff.id);
              return (
                <div
                  key={row.id}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
                    isSelf ? 'bg-indigo-50 border border-indigo-200 font-bold text-indigo-900' : 'text-gray-600'
                  }`}
                >
                  <span className={`w-6 shrink-0 text-center text-xs font-black ${isSelf ? 'text-indigo-600' : 'text-gray-400'}`}>
                    {MEDAL[row.position - 1] || row.position}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.name}{isSelf ? ' (هذا الموظف)' : ''}</span>
                  <span className="shrink-0 text-xs">{fmtMoney(row.revenue)}</span>
                  <span className="hidden shrink-0 text-[11px] text-gray-400 sm:inline">
                    {fmtNum(row.bookings)} حجز · {fmtNum(row.calls)} مكالمة
                  </span>
                </div>
              );
            })}
            {self && (
              <p className="pt-1 text-center text-[11px] text-gray-400">
                <Medal size={11} className="inline" /> ترتيبه خارج أفضل 10، معروض بالأسفل للمقارنة.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
