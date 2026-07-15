import type { ChangeEvent, ComponentType, Dispatch, RefObject, SetStateAction } from 'react';
import { Upload, X } from 'lucide-react';

type BranchEntry = { id: string; label: string; rooms?: { name: string; capacity: number }[] };
type ContentMap = Record<string, string>;

type Props = {
  content: ContentMap;
  policyDrafts: ContentMap;
  setPolicyDrafts: Dispatch<SetStateAction<ContentMap>>;
  setContentValue: (key: string, value: string) => void;
  instituteGalleryUploadRef: RefObject<HTMLInputElement | null>;
  handleInstituteGalleryUpload: (files: FileList | null) => void | Promise<void>;
  instituteGalleryUrlInput: string;
  setInstituteGalleryUrlInput: Dispatch<SetStateAction<string>>;
  instituteGalleryImages: string[];
  saveInstituteGalleryImages: (images: string[]) => void;
  instituteBranches: BranchEntry[];
  BranchAddForm: ComponentType<{ instituteBranches: BranchEntry[]; setContentValue: (key: string, value: string) => void }>;
};

export function DashboardInstituteGalleryPanel({
  content,
  policyDrafts,
  setPolicyDrafts,
  setContentValue,
  instituteGalleryUploadRef,
  handleInstituteGalleryUpload,
  instituteGalleryUrlInput,
  setInstituteGalleryUrlInput,
  instituteGalleryImages,
  saveInstituteGalleryImages,
  instituteBranches,
  BranchAddForm,
}: Props) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void handleInstituteGalleryUpload(event.target.files);
    event.target.value = '';
  };

  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-gray-900">معرض صور المعهد</h3>
        <button type="button" onClick={() => instituteGalleryUploadRef.current?.click()} className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold">
          <Upload size={14} className="inline ml-1" />رفع صور
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border-b pb-4">
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">عنوان صفحة المعرض</label>
          <input
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
            placeholder="معرض صور المعهد"
            value={policyDrafts['institute.gallery.title'] ?? content['institute.gallery.title'] ?? ''}
            onChange={(e) => setPolicyDrafts(prev => ({ ...prev, 'institute.gallery.title': e.target.value }))}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">وصف صفحة المعرض</label>
          <input
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
            placeholder="صور من القاعات، الفعاليات، والأنشطة التدريبية..."
            value={policyDrafts['institute.gallery.subtitle'] ?? content['institute.gallery.subtitle'] ?? ''}
            onChange={(e) => setPolicyDrafts(prev => ({ ...prev, 'institute.gallery.subtitle': e.target.value }))}
          />
        </div>
        {(policyDrafts['institute.gallery.title'] !== undefined || policyDrafts['institute.gallery.subtitle'] !== undefined) && (
          <div className="md:col-span-2 flex gap-2">
            <button
              onClick={() => {
                if (policyDrafts['institute.gallery.title'] !== undefined) setContentValue('institute.gallery.title', policyDrafts['institute.gallery.title']);
                if (policyDrafts['institute.gallery.subtitle'] !== undefined) setContentValue('institute.gallery.subtitle', policyDrafts['institute.gallery.subtitle']);
                setPolicyDrafts(prev => { const next = { ...prev }; delete next['institute.gallery.title']; delete next['institute.gallery.subtitle']; return next; });
              }}
              className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-4 py-2 rounded-xl text-sm"
            >
              حفظ العنوان والوصف
            </button>
            <button
              onClick={() => setPolicyDrafts(prev => { const next = { ...prev }; delete next['institute.gallery.title']; delete next['institute.gallery.subtitle']; return next; })}
              className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm"
            >
              إلغاء
            </button>
          </div>
        )}
      </div>
      <input ref={instituteGalleryUploadRef} type="file" multiple accept="image/*" className="hidden" onChange={handleFileChange} />

      <div className="flex flex-wrap gap-2">
        <input
          value={instituteGalleryUrlInput}
          onChange={(e) => setInstituteGalleryUrlInput(e.target.value)}
          placeholder="رابط صورة جديدة"
          className="flex-1 min-w-[220px] border border-gray-300 rounded-xl px-3 py-2"
        />
        <button
          type="button"
          onClick={() => {
            if (!instituteGalleryUrlInput.trim()) return;
            saveInstituteGalleryImages(Array.from(new Set([...instituteGalleryImages, instituteGalleryUrlInput.trim()])));
            setInstituteGalleryUrlInput('');
          }}
          className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-bold"
        >
          إضافة رابط
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {instituteGalleryImages.map((imageUrl, index) => (
          <div key={`${imageUrl}-${index}`} className="relative border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
            <img src={imageUrl} alt={`gallery-${index}`} className="w-full h-28 object-cover" />
            <button
              type="button"
              onClick={() => saveInstituteGalleryImages(instituteGalleryImages.filter((_, i) => i !== index))}
              className="absolute top-1 left-1 bg-white/90 text-red-600 rounded-full p-1"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      {instituteGalleryImages.length === 0 && <p className="text-sm text-gray-500">لا توجد صور بعد. ارفع صور أو أضف روابط.</p>}

      <div className="border-t pt-4 mt-4">
        <h4 className="font-bold text-gray-800 mb-3">إدارة الفروع</h4>
        <p className="text-xs text-gray-500 mb-3">الفروع التي تضيفها هنا ستظهر تلقائياً في نماذج التسجيل بجميع صفحات الموقع.</p>
        <BranchAddForm instituteBranches={instituteBranches} setContentValue={setContentValue} />
      </div>
    </article>
  );
}
