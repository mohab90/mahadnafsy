import { X } from 'lucide-react';
import type { Course } from '../../../../types';

export type LessonAnalyticsRow = {
  id: string;
  title: string;
  sort_order: number;
  view_count: number;
};

interface Props {
  course?: Course;
  rows: LessonAnalyticsRow[];
  loading: boolean;
  onClose: () => void;
}

export function LessonAnalyticsModal({ course, rows, loading, onClose }: Props) {
  const maxViews = Math.max(...rows.map((row) => row.view_count), 1);
  const totalViews = rows.reduce((sum, row) => sum + row.view_count, 0);

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-gray-900">مشاهدات المحاضرات</h3>
            {course && <p className="text-xs text-gray-400">{course.title}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 grid place-items-center">
            <X size={14} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          {loading ? (
            <div className="text-center py-10 text-gray-400">جارٍ التحميل...</div>
          ) : rows.length === 0 ? (
            <div className="text-center py-10 text-gray-400">لا توجد بيانات مشاهدات بعد</div>
          ) : (
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-3">
                  <span className="text-xs text-gray-400 w-5 text-left flex-shrink-0">{row.sort_order}</span>
                  <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{row.title}</span>
                  <div className="w-32 bg-gray-100 rounded-full h-2 flex-shrink-0">
                    <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${(row.view_count / maxViews) * 100}%` }} />
                  </div>
                  <span className="text-xs font-bold text-purple-700 w-12 text-left flex-shrink-0">{row.view_count.toLocaleString('ar-EG-u-nu-latn')}</span>
                </div>
              ))}
              <div className="pt-3 border-t border-gray-100 text-xs text-gray-400 text-center">
                إجمالي المشاهدات: {totalViews.toLocaleString('ar-EG-u-nu-latn')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
