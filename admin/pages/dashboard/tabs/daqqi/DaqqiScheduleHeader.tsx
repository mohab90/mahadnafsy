import { CalendarDays, List, Plus } from 'lucide-react';

export type DaqqiScheduleView = 'table' | 'calendar';

interface DaqqiScheduleHeaderProps {
  view: DaqqiScheduleView;
  setView: (view: DaqqiScheduleView) => void;
  hideCreateRound?: boolean;
  onCreateRound: () => void;
}

export function DaqqiScheduleHeader({
  view,
  setView,
  hideCreateRound,
  onCreateRound,
}: DaqqiScheduleHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-bold text-gray-900 text-lg flex items-center gap-2">
        <CalendarDays size={18} className="text-primary-500" />
        جدول كورسات الدقي
      </h3>
      <div className="flex items-center gap-2">
        <div className="flex rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setView('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition ${view === 'table' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <List size={13} />جدول
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition ${view === 'calendar' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <CalendarDays size={13} />تقويم
          </button>
        </div>
        {!hideCreateRound && (
          <button
            onClick={onCreateRound}
            className="flex items-center gap-1.5 bg-primary-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary-700 transition"
          >
            <Plus size={15} />إنشاء روند جديدة
          </button>
        )}
      </div>
    </div>
  );
}
