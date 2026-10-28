import { useCallback, useEffect, useState } from 'react';
import { Globe2, Plus, Radio, Square, Trash2, Users, Video } from 'lucide-react';
import { cairoDateTime, cairoDateTimeInput, cairoInputToUtc } from '../../../shared/cairoDate';
import { confirmDialog } from '../../../shared/ui/confirmDialog';
import { promptDialog } from '../../../shared/ui/promptDialog';
import { errorText, lecturerApi, type Course, type Live, type Notify } from './lecturerApi';
import { Card, Empty, field, Loading, primaryButton, quietButton } from './ui';

// «يحدد محاضرات لايف بالتاريخ والوقت … ويبدأ لايف مجاني في المجتمع»: the lecturer's own lives. A scheduled live goes to
// the clients of the chosen courses (who paid 90% and did not come before) and to the lecturer; a free community live
// starts now, open to every member, with a post that tells the community.

const PLATFORMS: Array<[string, string]> = [['ZOOM', 'Zoom'], ['MEET', 'Google Meet'], ['YOUTUBE', 'يوتيوب'], ['OTHER', 'منصة تانية']];
const blank = () => ({ title: '', scheduledAt: cairoDateTimeInput(), durationMinutes: 60, streamUrl: '', platform: 'ZOOM', description: '', courseIds: [] as string[] });

export function LecturerLives({ notify }: { notify: Notify }) {
  const [lives, setLives] = useState<Live[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  // «السيستم كله مربوط بنظام»: with the institute's Zoom / Meet account set up the room is made by the system; no link, no platform.
  const [systemMade, setSystemMade] = useState(false);
  const [draft, setDraft] = useState(blank());
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [community, setCommunity] = useState({ title: '', streamUrl: '', platform: 'ZOOM', description: '' });

  const load = useCallback(() => {
    lecturerApi.lives().then(result => { setLives(result.lives); setCourses(result.courses); setSystemMade(Boolean(result.meeting?.systemMade)); })
      .catch(error => { notify('error', errorText(error, 'تعذر تحميل اللايفات')); setLives([]); });
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy('save');
    try {
      const body = {
        title: draft.title, scheduledAt: cairoInputToUtc(draft.scheduledAt), durationMinutes: draft.durationMinutes, streamUrl: draft.streamUrl,
        platform: draft.platform, description: draft.description, courseIds: draft.courseIds,
        visibility: draft.courseIds.length ? 'COURSE_SUBSCRIBERS' : 'ALL_SUBSCRIBERS',
      };
      if (editing) await lecturerApi.updateLive(editing, body); else await lecturerApi.createLive(body);
      notify('success', editing ? 'اتحدّث اللايف' : 'اتحدد اللايف واتبعت إشعار للطلاب');
      setDraft(blank()); setEditing(null); load();
    } catch (error) { notify('error', errorText(error)); } finally { setBusy(''); }
  };

  const edit = (live: Live) => {
    setEditing(live.id);
    setDraft({
      title: live.title, scheduledAt: cairoDateTimeInput(live.scheduledAt), durationMinutes: live.durationMinutes || 60, streamUrl: live.streamUrl,
      platform: String(live.platform || 'zoom').toUpperCase(), description: live.description || '', courseIds: live.targetCourseIds || [],
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const remove = async (live: Live) => {
    if (!await confirmDialog(`إلغاء لايف «${live.title}»؟`)) return;
    setBusy(live.id);
    try { await lecturerApi.deleteLive(live.id); notify('success', 'اتلغى اللايف'); load(); }
    catch (error) { notify('error', errorText(error)); } finally { setBusy(''); }
  };

  const setStatus = async (live: Live, status: 'LIVE' | 'ENDED') => {
    let recordingUrl = '';
    if (status === 'ENDED') {
      const answer = await promptDialog({ title: 'إنهاء اللايف', message: 'لو في رابط تسجيل حطه هنا (اختياري) — الطلاب يقدروا يتفرجوا عليه بعد كده.', placeholder: 'https://…', confirmLabel: 'إنهاء' });
      if (answer === null) return;
      recordingUrl = answer.trim();
    }
    setBusy(live.id);
    try {
      await lecturerApi.setLiveStatus(live.id, status, recordingUrl);
      if (status === 'LIVE') window.open(live.hostUrl || live.streamUrl, '_blank', 'noopener');
      load();
    } catch (error) { notify('error', errorText(error)); } finally { setBusy(''); }
  };

  const startCommunityLive = async () => {
    setBusy('community');
    try {
      const started = await lecturerApi.communityLive(community);
      const target = started.hostUrl || community.streamUrl;
      if (target) window.open(target, '_blank', 'noopener');
      notify('success', 'اللايف المجاني بدأ واتنشر في المجتمع');
      setCommunity({ title: '', streamUrl: '', platform: 'ZOOM', description: '' }); load();
    } catch (error) { notify('error', errorText(error)); } finally { setBusy(''); }
  };

  const toggleCourse = (id: string) => setDraft(current => ({ ...current, courseIds: current.courseIds.includes(id) ? current.courseIds.filter(x => x !== id) : [...current.courseIds, id] }));

  return (
    <div className="space-y-5">
      <Card title={editing ? 'تعديل اللايف' : 'حدّد لايف جديد'} icon={<Video size={18} className="text-red-600" />}
        actions={editing ? <button type="button" className={quietButton} onClick={() => { setEditing(null); setDraft(blank()); }}>إلغاء التعديل</button> : undefined}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-bold text-gray-600 md:col-span-2">اسم اللايف
            <input className={field} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="مثلاً: مراجعة الأسبوع الثالث — العلاج المعرفي" /></label>
          <label className="text-xs font-bold text-gray-600">التاريخ والساعة (بتوقيت القاهرة)
            <input type="datetime-local" className={field} value={draft.scheduledAt} onChange={e => setDraft({ ...draft, scheduledAt: e.target.value })} /></label>
          <label className="text-xs font-bold text-gray-600">المدة بالدقايق
            <input type="number" min={10} max={480} className={field} value={draft.durationMinutes} onChange={e => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} /></label>
          {systemMade ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800 md:col-span-2">غرفة اللايف بيعملها السيستم لوحده (Zoom / Google Meet) — مش محتاج رابط ولا منصة. اضغط «ابدأ» وقت اللايف وهتفتحلك.</p>
          ) : (<>
            <label className="text-xs font-bold text-gray-600">المنصة
              <select className={field} value={draft.platform} onChange={e => setDraft({ ...draft, platform: e.target.value })}>
                {PLATFORMS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
            <label className="text-xs font-bold text-gray-600">رابط البث
              <input dir="ltr" className={field} value={draft.streamUrl} onChange={e => setDraft({ ...draft, streamUrl: e.target.value })} placeholder="https://zoom.us/j/…" /></label>
          </>)}
          <label className="text-xs font-bold text-gray-600 md:col-span-2">وصف (اختياري)
            <textarea rows={2} className={field} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        </div>
        <div>
          <p className="mb-1 text-xs font-bold text-gray-600">اللايف لطلاب أنهي كورس؟ <span className="font-normal text-gray-400">(الإشعار بيوصل لمن دفع 90% أو أكتر ومحضرش لايف قبل كده — من غير اختيار هو لكل المشتركين)</span></p>
          {courses.length === 0 ? <p className="text-xs text-gray-400">مفيش كورسات مسجلة باسمك لسه.</p> : (
            <div className="flex flex-wrap gap-2">
              {courses.map(course => (
                <button key={course.id} type="button" onClick={() => toggleCourse(course.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-bold ${draft.courseIds.includes(course.id) ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'}`}>
                  {course.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className={primaryButton} disabled={busy === 'save' || !draft.title.trim() || (!systemMade && !draft.streamUrl.trim())} onClick={() => void save()}>
          <Plus size={15} /> {editing ? 'حفظ التعديل' : 'حدّد اللايف وابعت الإشعار'}
        </button>
      </Card>

      <Card title="ابدأ لايف مجاني في المجتمع" icon={<Globe2 size={18} className="text-emerald-600" />}>
        <p className="text-xs text-gray-500">بيبدأ فوراً ومفتوح لكل أعضاء المجتمع من غير دفع، وبينزل منشور مثبّت في المجتمع بالرابط.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <input className={field} placeholder="اسم اللايف" value={community.title} onChange={e => setCommunity({ ...community, title: e.target.value })} />
          {!systemMade && <input dir="ltr" className={field} placeholder="رابط البث https://…" value={community.streamUrl} onChange={e => setCommunity({ ...community, streamUrl: e.target.value })} />}
          {!systemMade && <select className={field} value={community.platform} onChange={e => setCommunity({ ...community, platform: e.target.value })}>
            {PLATFORMS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>}
          <input className={field} placeholder="وصف قصير (اختياري)" value={community.description} onChange={e => setCommunity({ ...community, description: e.target.value })} />
        </div>
        <button type="button" disabled={busy === 'community' || !community.title.trim() || (!systemMade && !community.streamUrl.trim())} onClick={() => void startCommunityLive()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">
          <Radio size={15} /> ابدأ الآن
        </button>
      </Card>

      <Card title="لايفاتي">
        {lives === null ? <Loading /> : lives.length === 0 ? <Empty>مفيش لايفات لسه.</Empty> : (
          <div className="space-y-2">
            {lives.map(live => (
              <div key={live.id} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 ${live.status === 'live' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50/60'}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-gray-900">{live.title} {live.visibility === 'community_all' && <span className="mr-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">مجاني للمجتمع</span>}</p>
                  <p className="text-xs text-gray-500">
                    {cairoDateTime(live.scheduledAt)}{live.durationMinutes ? ` · ${live.durationMinutes} دقيقة` : ''} · <Users size={11} className="inline" /> {live.attendees} حضروا
                    {live.status === 'upcoming' && live.announcedAt ? ' · الطلاب اتبلّغوا' : ''}
                  </p>
                </div>
                {live.status === 'upcoming' && (<>
                  <button type="button" disabled={busy === live.id} className="inline-flex items-center gap-1 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={() => void setStatus(live, 'LIVE')}><Radio size={13} /> ابدأ</button>
                  <button type="button" className={quietButton} onClick={() => edit(live)}>تعديل</button>
                  <button type="button" disabled={busy === live.id} className="rounded-xl border border-red-200 p-2 text-red-600 hover:bg-red-50" aria-label="إلغاء اللايف" onClick={() => void remove(live)}><Trash2 size={14} /></button>
                </>)}
                {live.status === 'live' && (<>
                  <a href={live.hostUrl || live.streamUrl} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700">ادخل البث</a>
                  <button type="button" disabled={busy === live.id} className="inline-flex items-center gap-1 rounded-xl bg-gray-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50" onClick={() => void setStatus(live, 'ENDED')}><Square size={12} /> إنهاء</button>
                </>)}
                {live.status === 'ended' && <span className="rounded-full bg-gray-200 px-3 py-1 text-xs font-bold text-gray-600">انتهى</span>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
