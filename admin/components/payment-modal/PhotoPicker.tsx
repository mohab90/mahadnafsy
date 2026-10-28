import { PHOTO_ACCEPT, type PhotoKind, type PhotoNeed } from '../../lib/drivePhotos';
import { PHOTO_COPY } from './paymentTiles';

/** One picture: shows what is on the client's file, takes a new one, says what happened. */
export function PhotoPicker({ kind, need, uploaded, onFile, busy, disabled, onPick }: {
  kind: PhotoKind; need: PhotoNeed; uploaded?: string; onFile: string | null;
  busy: boolean; disabled: boolean; onPick: (file: File | undefined) => void;
}) {
  const copy = PHOTO_COPY[kind];
  const link = uploaded || onFile;
  return (
    <div className="flex flex-wrap items-center gap-2 bg-white border border-sky-200 rounded-lg px-3 py-2">
      <span className="text-sm font-bold text-gray-800">{copy.icon} {copy.title}</span>
      <span className="text-[11px] text-gray-500">{copy.why}</span>
      <span className={`text-[10px] font-extrabold rounded-full px-2 py-0.5 ${need === 'required' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
        {need === 'required' ? 'مطلوبة' : 'اختيارية'}
      </span>
      <span className="mr-auto flex items-center gap-2">
        {busy && <span className="text-[11px] font-bold text-sky-700">جاري الرفع…</span>}
        {!busy && link && (
          <a href={link} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-emerald-700 underline">
            {uploaded ? '✓ اترفعت — فتح' : '✓ على ملف العميل — فتح'}
          </a>
        )}
        <label className={`text-[11px] font-bold border rounded-lg px-2.5 py-1 ${disabled ? 'opacity-50 cursor-not-allowed border-gray-200 text-gray-400' : 'cursor-pointer border-sky-400 text-sky-800 hover:bg-sky-50'}`}>
          {link ? 'استبدال' : 'رفع صورة'}
          <input
            type="file" accept={PHOTO_ACCEPT} className="hidden" disabled={disabled}
            onChange={event => { onPick(event.target.files?.[0]); event.target.value = ''; }}
          />
        </label>
      </span>
    </div>
  );
}
