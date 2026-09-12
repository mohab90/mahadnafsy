import { Modal } from '../../../../../shared/ui/Modal';
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
    // layer="over": this opens from inside the course editor, which is itself
    // a dialog. It used z-[300] — a third stacking level invented for one
    // screen; two is what the shared dialog offers and what this needs.
    <Modal open onClose={onClose} title="مشاهدات المحاضرات" subtitle={course?.title} size="lg" layer="over">
        <div>
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
    </Modal>
  );
}
