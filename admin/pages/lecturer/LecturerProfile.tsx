import { useEffect, useState } from 'react';
import { Save, UserRound } from 'lucide-react';
import { errorText, lecturerApi, type LecturerProfile as Profile, type Notify } from './lecturerApi';
import { Card, Empty, field, Loading, primaryButton } from './ui';

const ROLE_LABEL: Record<string, string> = { instructor: 'محاضر', trainer: 'مدرّب', consultant: 'مستشار', expert: 'خبير' };

/** The lecturer's page on the site: the title, specialty, photo and bio clients read before they book. */
export function LecturerProfile({ notify }: { notify: Notify }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ title: '', specialty: '', bio: '', image: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    lecturerApi.profile().then(result => {
      setProfile(result);
      if (result.consultation) setForm({ title: result.consultation.title, specialty: result.consultation.specialty, bio: result.consultation.bio, image: result.consultation.image });
    }).catch(error => notify('error', errorText(error, 'تعذر تحميل الملف')));
  }, [notify]);

  if (!profile) return <Loading />;
  const save = async () => {
    setSaving(true);
    try { await lecturerApi.saveProfile(form); notify('success', 'اتحفظ الملف — بيظهر للعملاء في صفحتك'); }
    catch (error) { notify('error', errorText(error)); } finally { setSaving(false); }
  };
  return (
    <Card title="ملفي" icon={<UserRound size={18} className="text-primary-600" />}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 text-sm"><p className="text-xs text-gray-500">الاسم</p><p className="font-bold text-gray-900">{profile.name}</p></div>
        <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3 text-sm"><p className="text-xs text-gray-500">الوظيفة · رقم الواتساب للإشعارات</p>
          <p className="font-bold text-gray-900">{ROLE_LABEL[profile.role] || profile.role} · <span dir="ltr">{profile.phone || 'مفيش رقم — اطلب من الإدارة تضيفه عشان تيجيلك الإشعارات'}</span></p></div>
      </div>
      {!profile.consultation ? <Empty>مفيش صفحة استشارات مربوطة بحسابك. اطلب من الإدارة تربطها لو بتقدّم استشارات.</Empty> : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs font-bold text-gray-600">اللقب<input className={field} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="مثلاً: استشاري العلاج المعرفي السلوكي" /></label>
            <label className="text-xs font-bold text-gray-600">التخصص<input className={field} value={form.specialty} onChange={e => setForm({ ...form, specialty: e.target.value })} /></label>
            <label className="text-xs font-bold text-gray-600 md:col-span-2">رابط الصورة<input dir="ltr" className={field} value={form.image} onChange={e => setForm({ ...form, image: e.target.value })} placeholder="https://…" /></label>
            <label className="text-xs font-bold text-gray-600 md:col-span-2">نبذة عنك<textarea rows={5} className={field} value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} /></label>
          </div>
          <p className="text-xs text-gray-500">الاستشارات {profile.consultation.enabled ? 'مفعّلة' : 'مش مفعّلة'} على حسابك · مدة الجلسة {profile.consultation.sessionDurationMinutes} دقيقة (الإدارة هي اللي تغيّرها).</p>
          <button type="button" className={primaryButton} disabled={saving} onClick={() => void save()}><Save size={15} /> حفظ</button>
        </>
      )}
    </Card>
  );
}
