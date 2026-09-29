import { useState } from 'react';
import { Copy, ImagePlus, MapPin, MonitorPlay, Users } from 'lucide-react';

import { CAIRO_TIME_ZONE, cairoDateTime } from '../../../shared/cairoDate';
import { Modal } from '../../../shared/ui/Modal';
import { confirmDialog } from '../../../shared/ui/confirmDialog';
import { uploadImage } from '../../lib/uploadImage';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { waLink } from '../../lib/whatsappLink';
import type { CommunityEventItem, Therapist } from '../../types';

const SITE = 'https://mahadnafsy.com';
const EVENT_TYPES = ['ندوة', 'ورشة عمل', 'محاضرة', 'لقاء مفتوح', 'مؤتمر', 'دورة قصيرة'];
const PLATFORMS = ['Zoom', 'Google Meet', 'بث مباشر فيسبوك', 'يوتيوب لايف'];

type Draft = {
  title: string; eventType: string; imageUrl: string; description: string; content: string;
  speakerIds: string[]; speaker: string; isOnline: boolean; platform: string; locationName: string;
  eventDate: string; eventTime: string; slug: string;
};
type Registration = { id: string; name: string; phone: string; createdAt: string; studiedBefore: boolean | null; isClient: boolean };

const emptyDraft: Draft = {
  title: '', eventType: 'ندوة', imageUrl: '', description: '', content: '', speakerIds: [], speaker: '',
  isOnline: true, platform: 'Zoom', locationName: '', eventDate: '', eventTime: '', slug: '',
};
// What the address may hold, as it is typed: «anxiety seminar» → anxiety-seminar.
const asSlug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 80);
const ASCII_SLUG = /^[a-z0-9-]+$/;

const eventUrl = (event: CommunityEventItem) => `${SITE}/community/events/${encodeURIComponent(event.slug || event.id)}`;
const dateLabelOf = (date: string) => (date
  ? new Date(`${date}T12:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric', timeZone: CAIRO_TIME_ZONE })
  : '');

/**
 * «الفعاليات» on the community screen: each event with its own page on the
 * site, a picture and full text, one or more of the instructors, online or in
 * person, and the people who registered interest (name and number).
 */
export function CommunityEventsAdmin({ events, therapists, addEvent, updateEvent, deleteEvent }: {
  events: CommunityEventItem[];
  therapists: Therapist[];
  addEvent: (event: CommunityEventItem) => Promise<boolean>;
  updateEvent: (event: CommunityEventItem) => Promise<boolean>;
  deleteEvent: (id: string) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [imageError, setImageError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState('');
  const [registrationsOf, setRegistrationsOf] = useState<CommunityEventItem | null>(null);
  const [registrations, setRegistrations] = useState<Registration[] | null>(null);

  const set = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm';
  const label = 'mb-1 block text-xs font-bold text-gray-600';

  const openForm = (event?: CommunityEventItem) => {
    setImageError('');
    setEditingId(event ? event.id : '');
    setDraft(event ? {
      title: event.title, eventType: event.eventType || 'ندوة', imageUrl: event.imageUrl || '',
      description: event.description || '', content: event.content || '', speakerIds: event.speakerIds || [],
      speaker: event.speaker || '', isOnline: event.isOnline !== false, platform: event.platform || 'Zoom',
      locationName: event.locationName || '', eventDate: event.eventDate || '', eventTime: event.eventTime || '',
      slug: event.slug && ASCII_SLUG.test(event.slug) ? event.slug : '',
    } : emptyDraft);
  };

  const onImage = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      set({ imageUrl: await uploadImage(file, 'cover') });
      setImageError('');
    } catch {
      setImageError('الصورة كبيرة جدًا أو تعذّر ضغطها.');
    }
  };

  const save = async () => {
    if (!draft.title.trim() || editingId === null) return;
    setSaving(true);
    const item: CommunityEventItem = {
      ...(events.find(event => event.id === editingId) || {}),
      ...draft,
      id: editingId || `ev-${Date.now()}`,
      slug: draft.slug.replace(/-+$/, ''),
      title: draft.title.trim(),
      platform: draft.isOnline ? draft.platform : '',
      locationName: draft.isOnline ? '' : draft.locationName,
      dateLabel: dateLabelOf(draft.eventDate),
      speakers: therapists.filter(person => draft.speakerIds.includes(person.id))
        .map(person => ({ id: person.id, name: person.name, title: person.title || person.specialty || '', image: person.image || '' })),
      speaker: draft.speaker.trim(),
    };
    const saved = editingId ? await updateEvent(item) : await addEvent(item);
    setSaving(false);
    if (saved) setEditingId(null);
  };

  // Where the clipboard is refused, the link is shown under the card to copy by hand.
  const [shownLinkId, setShownLinkId] = useState('');
  const copyLink = async (event: CommunityEventItem) => {
    try {
      await navigator.clipboard.writeText(eventUrl(event));
      setCopiedId(event.id);
      setTimeout(() => setCopiedId(''), 2000);
    } catch { setShownLinkId(event.id); }
  };

  const showRegistrations = async (event: CommunityEventItem) => {
    setRegistrationsOf(event);
    setRegistrations(null);
    try {
      setRegistrations(await mysqlAdmin.adminGet<Registration[]>(`/admin/community/events/${encodeURIComponent(event.id)}/registrations`));
    } catch { setRegistrations([]); }
  };

  const sorted = [...events].sort((a, b) => (b.eventDate || '').localeCompare(a.eventDate || ''));

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => openForm()} className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700">+ فعالية جديدة</button>
      </div>
      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-400"><p className="mb-2 text-4xl">📅</p><p>لا توجد فعاليات</p></div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {sorted.map(event => (
            <div key={event.id} className="flex gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
              {event.imageUrl
                ? <img src={event.imageUrl} alt="" className="h-24 w-32 shrink-0 rounded-xl object-cover" />
                : <div className="flex h-24 w-32 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-3xl">📅</div>}
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="rounded-lg bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">{event.eventType}</span>
                  <span className={`flex items-center gap-1 rounded-lg px-2 py-0.5 font-bold ${event.isOnline !== false ? 'bg-sky-50 text-sky-700' : 'bg-amber-50 text-amber-700'}`}>
                    {event.isOnline !== false ? <><MonitorPlay size={12} /> أونلاين</> : <><MapPin size={12} /> حضور</>}
                  </span>
                  <span className="text-gray-500">{event.dateLabel}{event.eventTime ? ` · ${event.eventTime}` : ''}</span>
                </div>
                <p className="truncate font-bold text-gray-800">{event.title}</p>
                <p className="truncate text-xs text-gray-500">
                  {[...(event.speakers || []).map(person => person.name), event.speaker].filter(Boolean).join('، ') || 'لم يُحدد محاضر'}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button type="button" onClick={() => { void showRegistrations(event); }} className="flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">
                    <Users size={12} /> المسجلين ({event.registrations || 0})
                  </button>
                  <button type="button" onClick={() => { void copyLink(event); }} className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">
                    <Copy size={12} /> {copiedId === event.id ? 'اتنسخ ✓' : 'نسخ اللينك'}
                  </button>
                  <a href={eventUrl(event)} target="_blank" rel="noreferrer" className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-700">عرض</a>
                  <button type="button" onClick={() => openForm(event)} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">تعديل</button>
                  <button type="button" onClick={async () => { if (await confirmDialog('حذف هذه الفعالية والمسجلين فيها؟')) void deleteEvent(event.id); }}
                    className="rounded-lg bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600">حذف</button>
                </div>
                {shownLinkId === event.id && (
                  <input readOnly value={eventUrl(event)} onFocus={e => e.target.select()} dir="ltr" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1 text-xs" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editingId !== null && (
        <Modal open onClose={() => setEditingId(null)} title={editingId ? 'تعديل الفعالية' : 'إضافة فعالية'} size="lg">
          <div className="space-y-3 p-1" dir="rtl">
            <div><label className={label}>عنوان الفعالية *</label><input value={draft.title} onChange={e => set({ title: e.target.value })} className={field} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className={label}>نوع الفعالية</label>
                <input list="event-types" value={draft.eventType} onChange={e => set({ eventType: e.target.value })} className={field} />
                <datalist id="event-types">{EVENT_TYPES.map(type => <option key={type} value={type} />)}</datalist>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className={label}>التاريخ</label><input type="date" value={draft.eventDate} onChange={e => set({ eventDate: e.target.value })} className={field} /></div>
                <div><label className={label}>الساعة (القاهرة)</label><input type="time" value={draft.eventTime} onChange={e => set({ eventTime: e.target.value })} className={field} /></div>
              </div>
            </div>

            <div>
              <label className={label}>رابط الفعالية (بالإنجليزي)</label>
              <div className="flex items-center overflow-hidden rounded-xl border border-gray-200" dir="ltr">
                <span className="shrink-0 bg-gray-50 px-2 py-2 text-xs text-gray-500">mahadnafsy.com/community/events/</span>
                <input value={draft.slug} onChange={e => set({ slug: asSlug(e.target.value) })} placeholder="anxiety-seminar"
                  className="min-w-0 flex-1 px-2 py-2 text-sm outline-none" />
              </div>
              <p className="mt-1 text-[11px] text-gray-500">
                حروف إنجليزي وأرقام وشرطة بس.
                {editingId && events.find(event => event.id === editingId)?.slug !== draft.slug && draft.slug ? ' اللينك القديم هيفضل يفتح الفعالية.' : ''}
                {!draft.slug ? ' لو سيبته فاضي بيتعمل من التاريخ.' : ''}
              </p>
            </div>

            <div>
              <label className={label}>صورة الفعالية</label>
              <div className="flex items-center gap-3">
                {draft.imageUrl
                  ? <img src={draft.imageUrl} alt="" className="h-20 w-32 rounded-xl object-cover" />
                  : <div className="flex h-20 w-32 items-center justify-center rounded-xl border border-dashed border-gray-300 text-gray-400"><ImagePlus size={22} /></div>}
                <div className="space-y-1">
                  <input type="file" accept="image/*" onChange={e => { void onImage(e.target.files); e.target.value = ''; }} className="text-xs" />
                  {draft.imageUrl && <button type="button" onClick={() => set({ imageUrl: '' })} className="text-xs text-red-600">شيل الصورة</button>}
                  {imageError && <p className="text-xs text-red-600">{imageError}</p>}
                </div>
              </div>
            </div>

            <div><label className={label}>سطر مختصر (بيظهر في قايمة الفعاليات)</label>
              <input value={draft.description} onChange={e => set({ description: e.target.value })} maxLength={300} className={field} /></div>
            <div><label className={label}>محتوى صفحة الفعالية</label>
              <textarea value={draft.content} onChange={e => set({ content: e.target.value })} rows={9}
                placeholder="عن الفعالية، هتتكلم عن إيه، مين يحضر، هيستفاد إيه…" className={`${field} resize-y leading-7`} /></div>

            <div>
              <label className={label}>المحاضرين (واحد أو أكتر)</label>
              <div className="flex flex-wrap gap-2">
                {therapists.map(person => {
                  const on = draft.speakerIds.includes(person.id);
                  return (
                    <button key={person.id} type="button"
                      onClick={() => set({ speakerIds: on ? draft.speakerIds.filter(id => id !== person.id) : [...draft.speakerIds, person.id] })}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold transition ${on ? 'border-teal-600 bg-teal-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                      {person.image && <img src={person.image} alt="" className="h-5 w-5 rounded-full object-cover" />}
                      {person.name}
                    </button>
                  );
                })}
              </div>
              <input value={draft.speaker} onChange={e => set({ speaker: e.target.value })} placeholder="ضيف من خارج المحاضرين (اختياري)" className={`${field} mt-2`} />
            </div>

            <div>
              <label className={label}>طريقة الحضور</label>
              <div className="mb-2 flex gap-2">
                {([[true, 'أونلاين'], [false, 'حضور في المعهد / مكان']] as const).map(([online, text]) => (
                  <button key={String(online)} type="button" onClick={() => set({ isOnline: online })}
                    className={`rounded-xl border px-4 py-2 text-sm font-bold ${draft.isOnline === online ? 'border-teal-600 bg-teal-600 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>{text}</button>
                ))}
              </div>
              {draft.isOnline ? (
                <>
                  <input list="event-platforms" value={draft.platform} onChange={e => set({ platform: e.target.value })} placeholder="المنصة" className={field} />
                  <datalist id="event-platforms">{PLATFORMS.map(platform => <option key={platform} value={platform} />)}</datalist>
                </>
              ) : (
                <input value={draft.locationName} onChange={e => set({ locationName: e.target.value })} placeholder="العنوان أو اسم المكان" className={field} />
              )}
            </div>
          </div>
          <div className="mt-4 flex gap-3">
            <button type="button" disabled={saving || !draft.title.trim()} onClick={() => { void save(); }}
              className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50">{saving ? 'جاري الحفظ…' : 'حفظ'}</button>
            <button type="button" onClick={() => setEditingId(null)} className="rounded-xl bg-gray-200 px-5 text-gray-700">إلغاء</button>
          </div>
        </Modal>
      )}

      {registrationsOf && (
        <Modal open onClose={() => setRegistrationsOf(null)} title={`المسجلين في «${registrationsOf.title}»`} size="md">
          <div dir="rtl">
            {registrations === null ? <p className="p-4 text-sm text-gray-500">جاري التحميل…</p>
              : registrations.length === 0 ? <p className="p-4 text-sm text-gray-500">لسه محدش سجّل.</p> : (
                <>
                <p className="mb-2 text-xs text-gray-500">
                  {registrations.length} مسجّل · منهم {registrations.filter(row => row.isClient || row.studiedBefore).length} درسوا في المعهد — وهما الأول في القايمة.
                </p>
                <table className="w-full text-sm">
                  <thead><tr className="text-right text-xs text-gray-500"><th className="p-2">الاسم</th><th className="p-2">الرقم</th><th className="p-2">درس في المعهد؟</th><th className="p-2">وقت التسجيل</th></tr></thead>
                  <tbody>
                    {registrations.map(row => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="p-2 font-bold text-gray-800">{row.name}</td>
                        <td className="p-2" dir="ltr">
                          {waLink(row.phone)
                            ? <a href={waLink(row.phone) || undefined} target="_blank" rel="noreferrer" className="text-emerald-700 underline">{row.phone}</a>
                            : row.phone}
                        </td>
                        <td className="p-2 text-xs">
                          {row.isClient
                            ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">طالب عندنا ✓</span>
                            : row.studiedBefore === true ? <span className="rounded-full bg-teal-50 px-2 py-0.5 font-bold text-teal-700">نعم</span>
                            : row.studiedBefore === false ? <span className="text-gray-500">لا</span> : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="p-2 text-xs text-gray-500" dir="ltr">{cairoDateTime(row.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </>
              )}
          </div>
        </Modal>
      )}
    </div>
  );
}
