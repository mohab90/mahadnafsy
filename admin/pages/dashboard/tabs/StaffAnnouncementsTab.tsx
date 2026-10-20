import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, ImagePlus, Megaphone, Send, Square, Trash2, X } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { uploadImage } from '../../../lib/uploadImage';
import { ROLE_LABELS, type RoleKey } from '../../../constants/permissions';
import { popupImage, popupVideo } from '../../../../shared/siteOffers';
import { cairoDateTime } from '../../../../shared/cairoDate';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import { AnnouncementCard, ANNOUNCEMENT_LOOKS, type StaffAnnouncement } from '../../../components/StaffAnnouncementPopup';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Sent = StaffAnnouncement & { roles: string[]; expiresAt: string | null; active: boolean; stopped: boolean; seenCount: number };

const MAX_IMAGES = 4;
const BLANK = { title: '', body: '', videoUrl: '', style: 'info' as StaffAnnouncement['style'], images: [] as string[], roles: [] as string[], expiresAt: '' };

/**
 * «في قسم الإدارة أقدر أبعت رسالة فيديو أو صور أو كلام بشكل مميز يظهر بوب أب للموظفين» (20 Oct 2026). Write it, see it exactly as
 * the employee will, send it to everyone or to some jobs; below, what was sent and how many have closed it.
 */
export default function StaffAnnouncementsTab({ notify }: { notify: NotifyFn }) {
  const [draft, setDraft] = useState(BLANK);
  const [sent, setSent] = useState<Sent[]>([]);
  const [activeStaff, setActiveStaff] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(() => {
    mysqlAdmin.adminGet<{ items: Sent[]; activeStaff: number }>('/admin/staff-announcements')
      .then(result => { setSent(Array.isArray(result?.items) ? result.items : []); setActiveStaff(Number(result?.activeStaff) || 0); })
      .catch(() => setSent([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = <K extends keyof typeof BLANK>(key: K, value: (typeof BLANK)[K]) => setDraft(current => ({ ...current, [key]: value }));
  const roleKeys = useMemo(() => (Object.keys(ROLE_LABELS) as RoleKey[]).filter(role => role !== 'admin'), []);
  const videoProblem = draft.videoUrl.trim() !== '' && !popupVideo(draft.videoUrl);

  const addImage = async (file?: File) => {
    if (!file) return;
    if (draft.images.length >= MAX_IMAGES) { notify('error', `لحد ${MAX_IMAGES} صور`); return; }
    setUploading(true);
    try { const url = await uploadImage(file, 'gallery'); setDraft(current => ({ ...current, images: [...current.images, url].slice(0, MAX_IMAGES) })); }
    catch { notify('error', 'تعذر رفع الصورة — جرّب صورة أصغر.'); } finally { setUploading(false); }
  };

  const send = async () => {
    if (!draft.title.trim()) return notify('error', 'اكتب عنوان للرسالة.');
    if (!draft.body.trim() && !draft.videoUrl.trim() && draft.images.length === 0) return notify('error', 'اكتب نص أو ضيف صورة أو فيديو.');
    if (videoProblem) return notify('error', 'رابط الفيديو لازم يكون يوتيوب أو فيميو أو ملف mp4 / webm على https.');
    const who = draft.roles.length ? `لـ ${draft.roles.map(role => ROLE_LABELS[role as RoleKey] || role).join('، ')}` : `لكل الموظفين (${activeStaff})`;
    if (!await confirmDialog(`إرسال «${draft.title.trim()}» ${who}؟ هتظهر لكل واحد كبوب أب لحد ما يقفلها.`)) return;
    setBusy(true);
    try {
      await mysqlAdmin.adminPost('/admin/staff-announcements', {
        title: draft.title.trim(), body: draft.body.trim(), videoUrl: draft.videoUrl.trim(), style: draft.style, images: draft.images,
        roles: draft.roles, expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
      });
      notify('success', 'اتبعتت — هتظهر للموظفين كبوب أب.');
      setDraft(BLANK);
      load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الإرسال'); } finally { setBusy(false); }
  };

  const stop = async (item: Sent) => {
    if (!await confirmDialog(`إيقاف «${item.title}»؟ مش هتظهر لأي موظف تاني.`)) return;
    try { await mysqlAdmin.adminDelete(`/admin/staff-announcements/${encodeURIComponent(item.id)}`); notify('success', 'اتوقفت.'); load(); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الإيقاف'); }
  };

  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-200';
  const card = 'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm';
  return (
    <div className="space-y-4" dir="rtl">
      <h2 className="flex items-center gap-2 text-lg font-extrabold text-gray-900"><Megaphone size={20} className="text-violet-600" /> رسالة للموظفين (بوب أب)</h2>

      <section className={`${card} space-y-3`}>
        <input value={draft.title} onChange={event => set('title', event.target.value)} placeholder="العنوان" maxLength={200} className={field} />
        <textarea value={draft.body} onChange={event => set('body', event.target.value)} rows={4} maxLength={4000} placeholder="نص الرسالة" className={field} />

        <div>
          <span className="mb-1 block text-xs font-bold text-gray-600">شكل البوب أب</span>
          <div className="flex gap-2">
            {(Object.keys(ANNOUNCEMENT_LOOKS) as StaffAnnouncement['style'][]).map(style => (
              <button key={style} type="button" onClick={() => set('style', style)} aria-pressed={draft.style === style}
                className={`flex-1 rounded-xl border-2 px-3 py-2 text-xs font-bold text-white transition ${draft.style === style ? 'border-violet-600 shadow' : 'border-transparent opacity-75'}`}
                style={{ background: ANNOUNCEMENT_LOOKS[style].bg }}>{ANNOUNCEMENT_LOOKS[style].name}</button>
            ))}
          </div>
        </div>

        <div>
          <span className="mb-1 block text-xs font-bold text-gray-600">فيديو (اختياري) — رابط يوتيوب أو فيميو أو ملف mp4</span>
          <input value={draft.videoUrl} onChange={event => set('videoUrl', event.target.value)} dir="ltr" placeholder="https://www.youtube.com/watch?v=…" className={field} />
          {videoProblem && <span className="mt-1 block text-[11px] text-red-600">الرابط ده مش مدعوم — يوتيوب أو فيميو أو ملف mp4/webm على https.</span>}
        </div>

        <div>
          <span className="mb-1 block text-xs font-bold text-gray-600">صور (لحد {MAX_IMAGES}) — بتظهر لو مفيش فيديو</span>
          <div className="flex flex-wrap items-center gap-2">
            {draft.images.map(src => (
              <div key={src} className="relative h-16 w-16 overflow-hidden rounded-lg border border-gray-200">
                <img src={popupImage(src)} alt="" className="h-full w-full object-cover" />
                <button type="button" aria-label="شيل الصورة" onClick={() => set('images', draft.images.filter(item => item !== src))}
                  className="absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"><X size={11} /></button>
              </div>
            ))}
            {draft.images.length < MAX_IMAGES && (
              <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-dashed border-gray-300 text-[10px] font-bold text-gray-500 hover:bg-gray-50">
                <ImagePlus size={16} /> {uploading ? '⏳' : 'صورة'}
                <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={event => { void addImage(event.target.files?.[0]); event.target.value = ''; }} />
              </label>
            )}
          </div>
        </div>

        <div>
          <span className="mb-1 block text-xs font-bold text-gray-600">لمين؟ {draft.roles.length === 0 ? '(كل الموظفين)' : ''}</span>
          <div className="flex flex-wrap gap-1.5">
            {roleKeys.map(role => {
              const on = draft.roles.includes(role);
              return (
                <button key={role} type="button" aria-pressed={on} onClick={() => set('roles', on ? draft.roles.filter(item => item !== role) : [...draft.roles, role])}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${on ? 'border-violet-600 bg-violet-600 text-white' : 'border-gray-200 bg-white text-gray-600'}`}>{ROLE_LABELS[role]}</button>
              );
            })}
          </div>
        </div>

        <label className="block max-w-xs text-xs font-bold text-gray-600">
          تنتهي في (اختياري) — فاضي = لحد ما يقفلها كل واحد أو توقفها
          <input type="datetime-local" value={draft.expiresAt} onChange={event => set('expiresAt', event.target.value)} className={`${field} mt-1`} />
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !draft.title.trim()} onClick={() => void send()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"><Send size={14} /> {busy ? '⏳…' : 'إرسال للموظفين'}</button>
          <button type="button" disabled={!draft.title.trim()} onClick={() => setPreviewing(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-300 px-4 py-2 text-xs font-bold text-violet-800 hover:bg-violet-50 disabled:opacity-50"><Eye size={13} /> معاينة</button>
        </div>
      </section>

      <section className={card}>
        <h3 className="mb-2 text-sm font-bold text-gray-800">اللي اتبعت ({sent.length})</h3>
        {sent.length === 0 ? <p className="text-xs text-gray-400">لسه مبعتّش حاجة.</p> : (
          <div className="space-y-2">
            {sent.map(item => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-bold text-gray-800">{item.title}</div>
                  <div className="text-gray-500">
                    {cairoDateTime(item.createdAt)} — {item.roles.length ? item.roles.map(role => ROLE_LABELS[role.toLowerCase() as RoleKey] || role).join('، ') : 'كل الموظفين'}
                    {item.expiresAt ? ` — لحد ${cairoDateTime(item.expiresAt)}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">قفلها {item.seenCount}{item.roles.length ? '' : ` من ${activeStaff}`}</span>
                  <span className={`rounded-full px-2 py-0.5 font-bold ${item.active ? 'bg-violet-100 text-violet-800' : 'bg-gray-200 text-gray-600'}`}>{item.stopped ? 'موقوفة' : item.active ? 'شغالة' : 'انتهت'}</span>
                  {item.active && <button type="button" onClick={() => void stop(item)} title="إيقاف" aria-label="إيقاف" className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100"><Square size={12} /></button>}
                  {!item.active && <Trash2 size={12} className="text-gray-300" aria-hidden />}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {previewing && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button type="button" aria-label="إغلاق المعاينة" onClick={() => setPreviewing(false)} className="absolute inset-0 cursor-default bg-black/65" tabIndex={-1} />
          <div className="relative flex max-h-full w-full justify-center overflow-y-auto">
            <AnnouncementCard item={{ ...draft, createdByName: 'الإدارة' }} onClose={() => setPreviewing(false)} closeLabel="قفل المعاينة" />
          </div>
        </div>
      )}
    </div>
  );
}
