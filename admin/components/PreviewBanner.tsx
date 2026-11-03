import { Eye, LogOut } from 'lucide-react';
import { getPreview, leavePreview } from '../lib/previewMode';

/** «معاينة حساب الموظف»: while this tab reads the panel as an employee, a bar says so on every screen, with the way out. */
export function PreviewBanner() {
  const preview = getPreview();
  if (!preview) return null;
  return (
    <div className="sticky top-0 z-[100] flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow" dir="rtl" role="status">
      <Eye size={16} />
      <span>معاينة حساب «{preview.name || 'موظف'}» — بتشوف زي ما هو بيشوف، للقراءة بس (أي تعديل هيترفض)</span>
      <button type="button" onClick={leavePreview} className="flex items-center gap-1 rounded-lg bg-white/20 px-3 py-1 hover:bg-white/30"><LogOut size={14} /> اخرج من المعاينة</button>
    </div>
  );
}
