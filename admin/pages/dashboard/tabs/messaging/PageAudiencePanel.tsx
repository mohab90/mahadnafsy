// «عملاء الصفحة» — everyone who wrote to the Facebook page or Instagram, and the
// ways Meta allows reaching them again. Server: api/lib/pageAudience.js.

import { useCallback, useEffect, useState } from 'react';
import { Download, History, Loader2, Megaphone, MessageCircle, Phone, Send } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { downloadCsv } from '../../../../../shared/csv';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Platform = 'messenger' | 'instagram';
type Summary = Record<Platform, { contacts: number; windowOpen: number; withPhone: number; firstAt: string | null }>;
type Contact = { name: string; phone: string; source: string; status: string; created_at: string };

const API = '/admin/page-audience';
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'حصل خطأ');
const LABEL: Record<Platform, string> = { messenger: 'ماسنجر', instagram: 'انستجرام' };
const n = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');

export default function PageAudiencePanel({ notify, onOpenCampaigns }: { notify: NotifyFn; onOpenCampaigns?: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>('messenger');
  const [text, setText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [max, setMax] = useState(300);

  const load = useCallback(async () => {
    try { setSummary(await mysqlAdmin.adminGet<Summary>(API)); } catch (error) { notify('error', errorText(error)); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const run = async <T,>(key: string, work: () => Promise<T>, done: (result: T) => string) => {
    setBusy(key);
    try { notify('success', done(await work())); await load(); } catch (error) { notify('error', errorText(error)); } finally { setBusy(null); }
  };

  const importHistory = () => run('import',
    () => mysqlAdmin.adminPost<{ conversations: number; newLeads: number; messages: number; phones: number }>(`${API}/import`, { platform, max }),
    r => `اتقرت ${n(r.conversations)} محادثة: ${n(r.newLeads)} ليد جديد، ${n(r.messages)} رسالة، ${n(r.phones)} رقم تليفون`);
  const backfill = () => run('backfill',
    () => mysqlAdmin.adminPost<{ scanned: number; found: number }>(`${API}/backfill-phones`, {}),
    r => `اتقرت ${n(r.scanned)} رسالة — اتلقى ${n(r.found)} رقم واتحط على الليد`);
  const sendOpen = () => run('send',
    () => mysqlAdmin.adminPost<{ audience: number; sent: number; failed: number }>(`${API}/message-open`, { platform, text }),
    r => { setConfirming(false); setText(''); return `اتبعتت لـ${n(r.sent)} من ${n(r.audience)}${r.failed ? ` — ${n(r.failed)} ما وصلتش` : ''}`; });

  const exportCsv = () => run('export', async () => {
    const rows = await mysqlAdmin.adminGet<Contact[]>(`${API}/contacts`);
    // Facebook's custom-audience upload reads «phone» and «fn» columns.
    downloadCsv('page-audience-phones.csv', [['phone', 'fn', 'source'], ...rows.map(r => [`+${r.phone}`, r.name || '', r.source])]);
    return rows.length;
  }, count => `اتنزل ${n(count)} رقم`);

  const s = summary?.[platform];

  return (
    <div className="space-y-4" dir="rtl">
      <section className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-6 text-blue-950">
        <p className="font-extrabold">ليه مش «ابعت لكل اللي كلمونا»؟</p>
        <p className="text-xs text-blue-900">
          ميتا مش بتسمح للصفحة تبعت رسالة لحد غير في خلال 24 ساعة من آخر رسالة بعتها، والرسايل التسويقية على الماسنجر مش متاحة لمصر.
          الصفحة اللي بتبعت لكل الناس بتتقفل. عشان كده هنا الطرق المسموحة — وأقواها إن رقم العميل اللي كتبه في الشات يدخل حملات الواتساب.
        </p>
      </section>

      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 w-fit">
        {(['messenger', 'instagram'] as Platform[]).map(key => (
          <button key={key} type="button" onClick={() => setPlatform(key)}
            className={`rounded-lg px-4 py-1.5 text-sm font-bold ${platform === key ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>{LABEL[key]}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ['كلمونا', s?.contacts, 'شخص في صندوق الرسائل', MessageCircle],
          ['سايبين رقمهم', s?.withPhone, 'تقدر توصلهم بحملة واتساب', Phone],
          ['الشباك مفتوح دلوقتي', s?.windowOpen, 'كلمونا آخر 23 ساعة — تقدر تبعتلهم', Send],
        ].map(([label, value, hint, Icon]) => {
          const I = Icon as typeof Phone;
          return (
            <div key={label as string} className="rounded-2xl border border-gray-200 bg-white p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold text-gray-500"><I size={14} /> {label as string}</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-gray-900">{value === undefined ? '…' : n(value as number)}</p>
              <p className="text-[11px] text-gray-500">{hint as string}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-gray-900"><History size={16} /> ١. هات محادثات الصفحة القديمة</h3>
          <p className="text-xs leading-5 text-gray-500">
            كل حد كلّم الصفحة قبل ما السيستم يتربط يبقى ليد بمحادثته في صندوق الرسائل، وأي رقم كتبه يتحط عليه.
            الليدز الجديدة بتتوزع على السيلز زي أي ليد. محتاج توكن الصفحة يكون فيه صلاحية قراءة الرسايل.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={max} onChange={e => setMax(Number(e.target.value))} className="rounded-lg border border-gray-200 px-2 py-2 text-sm">
              {[100, 300, 1000, 2000].map(v => <option key={v} value={v}>آخر {n(v)} محادثة</option>)}
            </select>
            <button type="button" onClick={importHistory} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              {busy === 'import' ? <Loader2 size={15} className="animate-spin" /> : <History size={15} />} استيراد من {LABEL[platform]}
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-gray-900"><Phone size={16} /> ٢. حوّلهم لعملاء واتساب</h3>
          <p className="text-xs leading-5 text-gray-500">
            أي رقم بيتكتب في الشات بيتحط على الليد لوحده من دلوقتي. الزرار ده بيدوّر في المحادثات القديمة كمان.
            بعدها اعمل حملة واتساب بقالب متوافق عليه لجمهور «ليدز» ومصدر <b dir="ltr">messenger_inbound</b> — وفيها إلغاء اشتراك.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={backfill} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">
              {busy === 'backfill' ? <Loader2 size={15} className="animate-spin" /> : <Phone size={15} />} استخراج الأرقام من المحادثات
            </button>
            {onOpenCampaigns && (
              <button type="button" onClick={onOpenCampaigns} className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white"><Megaphone size={15} /> حملة واتساب</button>
            )}
            <button type="button" onClick={exportCsv} disabled={!!busy} className="flex items-center gap-1.5 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">
              {busy === 'export' ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} الأرقام لجمهور إعلانات فيسبوك (CSV)
            </button>
          </div>
          <p className="text-[11px] text-gray-400">وفي «مدير الإعلانات» اعمل جمهور مخصص من «الناس اللي راسلوا صفحتك» — ميتا بتعمله لوحدها لكل اللي كلّموا الصفحة.</p>
        </section>
      </div>

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-gray-900"><Send size={16} /> ٣. رسالة للي كلمونا آخر 24 ساعة على {LABEL[platform]}</h3>
        <p className="text-xs text-gray-500">مسموح من ميتا، ودول أسخن جمهور عندك. <b>{n(s?.windowOpen || 0)}</b> شخص. استخدم <b dir="ltr">{'{name}'}</b> لاسم العميل.</p>
        <textarea value={text} onChange={e => { setText(e.target.value); setConfirming(false); }} rows={3} maxLength={1800}
          placeholder="أهلاً {name}! الدفعة الجديدة من دبلومة العلاج المعرفي بتبدأ السبت الجاي، ولسه فيه أماكن…"
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} disabled={!text.trim() || !s?.windowOpen || !!busy}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">ابعت…</button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            هتتبعت لـ{n(s?.windowOpen || 0)} شخص دلوقتي. متأكد؟
            <button type="button" onClick={sendOpen} disabled={!!busy} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">
              {busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} أيوه ابعت
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="text-xs text-amber-800 underline">لأ</button>
          </div>
        )}
      </section>
    </div>
  );
}
