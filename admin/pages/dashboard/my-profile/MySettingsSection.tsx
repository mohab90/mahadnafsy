import { useEffect, useState } from 'react';
import { MessageCircle, Pencil, Save, Settings2, Tags, Trash2 } from 'lucide-react';
import type { StaffMember } from '../../../types';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { toDialable } from '../../../lib/whatsappLink';
import { ChangePasswordCard } from './ChangePasswordCard';

type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;
type Template = { id: string; title: string; body: string };

const SUGGESTED_TAGS = ['مهتم جداً', 'يحتاج متابعة', 'لم يرد', 'عميل VIP', 'طالب راضي', 'سعر مرتفع', 'تأجيل'];
const input = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';

/**
 * الإعدادات — the employee's own details and the tools they write with.
 *
 * Its state is its own. The draft, the templates, the tags and the tag being
 * typed were eight values and eight setters held in Dashboard.tsx and handed
 * down through two components, for a form nothing else reads.
 */
export function MySettingsSection({ staff, notify }: { staff: StaffMember; notify: Notify }) {
  const [draft, setDraft] = useState({ name: staff.name || '', phone: staff.phone || '', image: staff.image || '', waNumber: '' });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [editing, setEditing] = useState<Template | null>(null);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.getMyPreferences().then(preferences => {
      if (cancelled) return;
      setDraft(current => ({ ...current, waNumber: preferences.waNumber || '' }));
      setTemplates(preferences.waTemplates || []);
      setTags(preferences.customTags || []);
    }).catch((error: unknown) => {
      // mysqlapi takes a 401 to the login screen; this stays quiet for it.
      if (/401|Unauthorized/i.test(error instanceof Error ? error.message : String(error))) return;
      notify('error', 'تعذر تحميل تفضيلاتك');
    });
    return () => { cancelled = true; };
  }, [notify]);

  const savePreferences = async (nextTemplates: Template[], nextTags: string[]) => {
    try {
      await mysqlAdmin.saveMyPreferences({ waNumber: draft.waNumber, waTemplates: nextTemplates, customTags: nextTags });
      setTemplates(nextTemplates);
      setTags(nextTags);
      return true;
    } catch {
      notify('error', 'تعذر حفظ التفضيلات');
      return false;
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      await Promise.all([
        mysqlAdmin.updateMyProfile({ name: draft.name, phone: draft.phone, image: draft.image || null }),
        mysqlAdmin.saveMyPreferences({ waNumber: draft.waNumber, waTemplates: templates, customTags: tags }),
      ]);
      notify('success', 'اتحفظت بياناتك');
    } catch { notify('error', 'فشل الحفظ، حاول تاني'); } finally { setSaving(false); }
  };

  const addTag = async (tag: string) => {
    const value = tag.trim();
    if (value && !tags.includes(value)) await savePreferences(templates, [...tags, value]);
    setNewTag('');
  };

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 font-extrabold text-gray-900"><Settings2 size={16} className="text-indigo-500" /> بياناتي</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">الاسم</span>
            <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} className={input} /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">رقم الموبايل</span>
            <input value={draft.phone} dir="ltr" onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} className={input} /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">البريد الإلكتروني</span>
            <input value={staff.email} readOnly dir="ltr" className={`${input} cursor-not-allowed bg-gray-50 text-gray-400`} /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">رابط صورتك</span>
            <input value={draft.image} dir="ltr" placeholder="https://…" onChange={e => setDraft(d => ({ ...d, image: e.target.value }))} className={input} /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">رقم الواتساب اللي بتبعت منه</span>
            <input value={draft.waNumber} dir="ltr" placeholder="201XXXXXXXXX" onChange={e => setDraft(d => ({ ...d, waNumber: e.target.value }))} className={input} /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-gray-600">هدفك الشهري (من الإدارة)</span>
            <input value={String(staff.monthlyLeadsTarget || 10)} readOnly dir="ltr" className={`${input} cursor-not-allowed bg-gray-50 text-gray-500`} /></label>
        </div>
        <button type="button" onClick={() => void saveProfile()} disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60">
          <Save size={15} /> {saving ? 'جارٍ الحفظ…' : 'حفظ التغييرات'}
        </button>
      </section>

      <ChangePasswordCard notify={notify} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-extrabold text-gray-900"><MessageCircle size={16} className="text-green-600" /> قوالب رسائل واتساب</h3>
            <button type="button" onClick={() => setEditing({ id: `tpl-${Date.now()}`, title: '', body: '' })}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700">+ قالب</button>
          </div>
          {editing && (
            <div className="mb-4 space-y-2 rounded-xl border border-green-200 bg-green-50 p-3">
              <input value={editing.title} onChange={e => setEditing(t => t && { ...t, title: e.target.value })} placeholder="اسم القالب…" className={input} />
              <textarea rows={4} value={editing.body} onChange={e => setEditing(t => t && { ...t, body: e.target.value })}
                placeholder="نص الرسالة… تقدر تستخدم {الاسم} و {الكورس}" className={`${input} resize-none`} />
              <div className="flex gap-2">
                <button type="button" disabled={!editing.title.trim() || !editing.body.trim()}
                  onClick={async () => {
                    const exists = templates.some(t => t.id === editing.id);
                    const next = exists ? templates.map(t => (t.id === editing.id ? editing : t)) : [...templates, editing];
                    if (await savePreferences(next, tags)) setEditing(null);
                  }}
                  className="flex-1 rounded-lg bg-green-600 py-1.5 text-sm font-bold text-white disabled:opacity-50">حفظ</button>
                <button type="button" onClick={() => setEditing(null)} className="rounded-lg bg-white px-4 py-1.5 text-sm text-gray-600">إلغاء</button>
              </div>
            </div>
          )}
          {templates.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">مفيش قوالب لسه — ضيف أول واحد.</p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {templates.map(template => (
                <div key={template.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-bold text-gray-800">{template.title}</span>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => setEditing(template)} className="rounded p-1 text-blue-600 hover:bg-blue-100" aria-label="تعديل"><Pencil size={13} /></button>
                      <button type="button" onClick={() => void savePreferences(templates.filter(t => t.id !== template.id), tags)}
                        className="rounded p-1 text-red-500 hover:bg-red-100" aria-label="حذف"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-line text-xs text-gray-500">{template.body}</p>
                  {draft.waNumber && (
                    <a href={`https://wa.me/${toDialable(draft.waNumber)}?text=${encodeURIComponent(template.body)}`} target="_blank" rel="noopener noreferrer"
                      className="mt-1.5 inline-block text-[11px] font-bold text-green-700 hover:text-green-900">إرسال تجريبي لنفسك</a>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="mb-2 flex items-center gap-2 font-extrabold text-gray-900"><Tags size={16} className="text-purple-600" /> تاجات التواصل</h3>
          <p className="mb-3 text-xs text-gray-500">بتظهر في سجل التواصل عشان تصنّف المكالمات بسرعة.</p>
          <div className="mb-4 flex gap-2">
            <input value={newTag} onChange={e => setNewTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addTag(newTag); }}
              placeholder="اسم التاج… ثم Enter" className={input} />
            <button type="button" disabled={!newTag.trim()} onClick={() => void addTag(newTag)}
              className="rounded-xl bg-purple-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">إضافة</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <span key={tag} className="flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-800">
                {tag}
                <button type="button" onClick={() => void savePreferences(templates, tags.filter(t => t !== tag))}
                  className="font-bold text-purple-400 hover:text-red-500" aria-label={`حذف ${tag}`}>×</button>
              </span>
            ))}
          </div>
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="mb-2 text-xs text-gray-400">تاجات شائعة:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_TAGS.filter(tag => !tags.includes(tag)).map(tag => (
                <button key={tag} type="button" onClick={() => void addTag(tag)}
                  className="rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-[11px] text-gray-600 hover:bg-purple-100 hover:text-purple-700">+ {tag}</button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
