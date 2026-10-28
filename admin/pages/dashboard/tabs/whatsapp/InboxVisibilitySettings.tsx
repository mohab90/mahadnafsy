import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Settings = { repVisibility: 'pool' | 'own'; autoAssign: boolean; signReplies: boolean };
type Platform = { channel: { label: string; provider: string; status: string; displayNumber: string | null } | null; receives: boolean; webhookSecrets?: boolean | null; hint: string | null };
type Readiness = { whatsapp: Platform; messenger: Platform; instagram: Platform };
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

/**
 * «كل واحدة هترد يظهرلها رسايلها فقط باسمها، واحنا بس اللي بنشوف كله»: who sees which conversation in the inbox, for the owner and the sales
 * manager. «محادثاتها بس» gives every new conversation (WhatsApp, Messenger, Instagram) to a rep automatically, by the lead round-robin; she
 * sees only hers, and the people who see everything still do. api/lib/teamInboxSettings.js.
 */
export function InboxVisibilitySettings({ notify, onSaved }: { notify: NotifyFn; onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);

  useEffect(() => {
    mysqlAdmin.adminGet<{ settings: Settings; canEdit: boolean }>('/admin/team-inbox/settings')
      .then(result => { setSettings(result.settings); setCanEdit(result.canEdit); }, () => notify('error', 'تعذر تحميل إعدادات الصندوق'));
    mysqlAdmin.adminGet<Readiness>('/admin/team-inbox/readiness').then(setReadiness, () => {});
  }, [notify]);

  const save = async (patch: Partial<Settings>) => {
    if (!settings) return;
    setBusy(true);
    try {
      const result = await mysqlAdmin.adminPut<{ settings: Settings; distributed: number }>('/admin/team-inbox/settings', { ...settings, ...patch });
      setSettings(result.settings);
      notify('success', result.distributed ? `اتحفظ — واتوزّع ${result.distributed} محادثة كانت مستنية` : 'اتحفظ');
      onSaved();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحفظ'); }
    finally { setBusy(false); }
  };

  if (!settings) return <div className="flex items-center gap-2 rounded-2xl border border-gray-100 bg-white p-4 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> بيحمّل الإعدادات…</div>;
  const own = settings.repVisibility === 'own';
  return (
    <div className="space-y-3 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm" dir="rtl">
      <h3 className="flex items-center gap-2 text-sm font-bold text-gray-800"><Users size={16} className="text-indigo-600" /> مين يشوف إيه في صندوق الرسائل</h3>
      {!canEdit && <p className="text-xs text-amber-700">الإعدادات دي للإدارة بس — ده الوضع الحالي.</p>}
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1" checked={own} disabled={!canEdit || busy}
          onChange={event => void save(event.target.checked ? { repVisibility: 'own', autoAssign: true } : { repVisibility: 'pool' })} />
        <span>
          <b>كل مندوبة تشوف محادثاتها بس</b> — واتساب وماسنجر وانستجرام. كل محادثة جديدة بتتوزع تلقائي على مندوبة، والإدارة بس هي اللي تشوف كله وتحوّل بين المندوبات.
          <span className="block text-xs text-gray-500">لو مقفولة: المندوبة بتشوف محادثاتها والمحادثات اللي محدش استلمها، وبتستلم بالرد.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1" checked={settings.autoAssign} disabled={!canEdit || busy || own}
          onChange={event => void save({ autoAssign: event.target.checked })} />
        <span>توزيع المحادثات الجديدة تلقائي على المندوبات{own ? ' (لازم في الوضع ده)' : ''}</span>
      </label>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input type="checkbox" className="mt-1" checked={settings.signReplies} disabled={!canEdit || busy}
          onChange={event => void save({ signReplies: event.target.checked })} />
        <span>اسم المندوبة تحت كل رد للعميل (مثال: «— منى»)</span>
      </label>
      {readiness && (
        <div className="space-y-1 border-t border-gray-100 pt-3">
          <p className="text-xs font-bold text-gray-600">القنوات اللي بتوصّل رسايل للصندوق</p>
          {([['whatsapp', 'واتساب'], ['messenger', 'ماسنجر'], ['instagram', 'انستجرام']] as const).map(([key, label]) => {
            const item = readiness[key];
            const ok = item.receives && item.webhookSecrets !== false && !item.hint?.startsWith('القناة');
            return (
              <div key={key} className="flex flex-wrap items-start gap-2 text-xs">
                <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                <span className="font-bold text-gray-700">{label}</span>
                <span className="text-gray-500">{item.channel ? `${item.channel.label} (${item.channel.provider})` : 'مفيش قناة'}</span>
                {item.webhookSecrets === false && <span className="text-amber-700">أسرار الـ Webhook مش متحطة على السيرفر</span>}
                {item.hint && <span className="text-amber-700">{item.hint}</span>}
              </div>
            );
          })}
        </div>
      )}
      {busy && <p className="flex items-center gap-1 text-xs text-gray-500"><Loader2 size={12} className="animate-spin" /> بيحفظ…</p>}
    </div>
  );
}
