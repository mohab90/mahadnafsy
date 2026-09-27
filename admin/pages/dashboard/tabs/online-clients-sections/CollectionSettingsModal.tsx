import { useEffect, useMemo, useState } from 'react';
import { Plus, Settings, Trash2 } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { Course, StaffMember, SubscriberItem } from '../../../../types';
import OldDataImportPanel from '../online/OldDataImportPanel';
import { oldOnlineSubscriber } from './OldDataImportSection';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Market = 'local' | 'saudi' | 'intl';
type Member = { staffId: string; isAvailable: boolean; markets: Market[]; maxClients: number | null };
type Sheet = { id: string; staffId: string; name: string; sheetId: string; gid: string; clientStatus: 'old_local' | 'old_intl' };
type Config = { members: Member[]; sheets: Sheet[] };

const MARKETS: [Market, string][] = [['local', '🇪🇬 محلي'], ['saudi', '🇸🇦 سعودي'], ['intl', '🌍 دولي']];

/** A sheet's id and tab from whatever link was pasted. */
function parseSheetLink(link: string): { sheetId: string; gid: string } {
  const id = link.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || link.trim();
  const gid = link.match(/[#?&]gid=(\d+)/)?.[1] || '';
  return { sheetId: id, gid };
}
const sheetUrl = (sheet: Pick<Sheet, 'sheetId' | 'gid'>) =>
  `https://docs.google.com/spreadsheets/d/${sheet.sheetId}/edit${sheet.gid ? `#gid=${sheet.gid}` : ''}`;

/**
 * «التحصيل: التوزيع والشيتات». Who in collection receives clients, from which
 * market and how many — the controls sales has on «التوزيع» — and each
 * officer's sheets: an upload or a Google Sheet, whose rows come in under that
 * officer's name.
 */
export function CollectionSettingsModal({ staffMembers, subscribers, courses, notify, onClose, onChanged }: {
  staffMembers: StaffMember[];
  subscribers: SubscriberItem[];
  courses: Course[];
  notify: Notify;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const officers = useMemo(() => staffMembers.filter(member => (member.role || '').toLowerCase() === 'collection'), [staffMembers]);
  const [tab, setTab] = useState<'distribution' | 'sheets'>('distribution');
  const [config, setConfig] = useState<Config>({ members: [], sheets: [] });
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [officerId, setOfficerId] = useState('');
  const [kind, setKind] = useState<'old_local' | 'old_intl'>('old_local');
  const [openSheetId, setOpenSheetId] = useState('');
  const [newSheet, setNewSheet] = useState({ name: '', link: '' });

  useEffect(() => {
    mysqlAdmin.adminGet<Config>('/admin/collection-distribution')
      .then(stored => {
        const saved = new Map((stored?.members || []).map(member => [member.staffId, member]));
        setConfigured(saved.size > 0);
        // Everyone in collection is listed; until the screen is saved they
        // all take part, as the rotation always did.
        setConfig({
          members: officers.map(officer => saved.get(officer.id)
            || { staffId: officer.id, isAvailable: saved.size === 0, markets: [], maxClients: null }),
          sheets: stored?.sheets || [],
        });
      })
      .catch(error => notify('error', error instanceof Error ? error.message : 'تعذّر تحميل إعدادات التحصيل'))
      .finally(() => setLoading(false));
  }, [officers, notify]);

  const holding = (staffId: string) => subscribers.filter(subscriber => subscriber.assignedCsId === staffId).length;
  const setMember = (staffId: string, patch: Partial<Member>) =>
    setConfig(current => ({ ...current, members: current.members.map(member => member.staffId === staffId ? { ...member, ...patch } : member) }));

  const save = async (next: Config = config, message = 'تم حفظ إعدادات التحصيل') => {
    setSaving(true);
    try {
      const stored = await mysqlAdmin.adminPut<Config>('/admin/collection-distribution', next);
      setConfig(current => ({ ...current, sheets: stored.sheets }));
      setConfigured(true);
      notify('success', message);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر الحفظ');
    } finally { setSaving(false); }
  };

  const addSheet = async () => {
    const { sheetId, gid } = parseSheetLink(newSheet.link);
    if (!officerId || !sheetId) return;
    const sheet: Sheet = { id: `cs-${Date.now()}`, staffId: officerId, name: newSheet.name.trim() || 'شيت', sheetId, gid, clientStatus: kind };
    const next = { ...config, sheets: [...config.sheets, sheet] };
    setConfig(next);
    setNewSheet({ name: '', link: '' });
    setOpenSheetId(sheet.id);
    await save(next, 'تم ربط الشيت');
  };
  const removeSheet = async (id: string) => {
    const next = { ...config, sheets: config.sheets.filter(sheet => sheet.id !== id) };
    setConfig(next);
    if (openSheetId === id) setOpenSheetId('');
    await save(next, 'تم فك ربط الشيت');
  };

  const officer = officers.find(member => member.id === officerId);
  const officerSheets = config.sheets.filter(sheet => sheet.staffId === officerId);
  const openSheet = officerSheets.find(sheet => sheet.id === openSheetId);
  const chip = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm font-bold transition ${
    on ? 'border-teal-600 bg-teal-600 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-teal-300'}`;
  const field = 'rounded-xl border border-gray-200 px-3 py-2 text-sm';

  return (
    <Modal open onClose={onClose} title="التحصيل: التوزيع والشيتات" size="full"
      icon={<Settings size={18} className="text-teal-600" />}>
      <div className="flex border-b border-gray-100">
        {([['distribution', 'توزيع الداتا على التحصيل'], ['sheets', 'شيتات مسئولي التحصيل']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`flex-1 py-3 text-sm font-bold transition ${tab === key ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{label}</button>
        ))}
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-5" dir="rtl">
        {loading ? <p className="text-sm text-gray-500">جاري التحميل…</p> : tab === 'distribution' ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              زرار «توزيع غير المُسندين» بيوزّع على المتاحين هنا بس، كل واحد في الأسواق اللي تختارها له ولحد أقصى عدد عملاء.
              العميل اللي مفيش حد ياخده بيفضل من غير مسئول.
              {!configured && <strong className="text-amber-700"> لسه متحفظش — دلوقتي التوزيع على كل موظفي التحصيل بالتساوي.</strong>}
            </p>
            {officers.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">مفيش موظفين بدور «تحصيل».</p>}
            <div className="grid gap-3 lg:grid-cols-2">
              {config.members.map(member => {
                const person = officers.find(item => item.id === member.staffId);
                if (!person) return null;
                return (
                  <div key={member.staffId} className="space-y-3 rounded-2xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-base">{person.name} <span className="text-xs font-normal text-gray-500">— ماسك {holding(member.staffId)} عميل</span></strong>
                      <label className="flex items-center gap-2 text-sm font-bold">
                        <input type="checkbox" className="h-5 w-5 accent-teal-600" checked={member.isAvailable}
                          onChange={e => setMember(member.staffId, { isAvailable: e.target.checked })} />
                        متاح للتوزيع
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-gray-600">الأسواق:</span>
                      <button type="button" className={chip(member.markets.length === 0)} onClick={() => setMember(member.staffId, { markets: [] })}>الكل</button>
                      {MARKETS.map(([key, label]) => {
                        const on = member.markets.includes(key);
                        return (
                          <button key={key} type="button" className={chip(on)}
                            onClick={() => setMember(member.staffId, { markets: on ? member.markets.filter(item => item !== key) : [...member.markets, key] })}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-600">
                      أقصى عدد عملاء يمسكهم
                      <input type="number" min="0" value={member.maxClients ?? ''} placeholder="بلا حد"
                        onChange={e => setMember(member.staffId, { maxClients: e.target.value === '' ? null : Number(e.target.value) })}
                        className={`${field} w-32`} />
                    </label>
                  </div>
                );
              })}
            </div>
            <button type="button" disabled={saving} onClick={() => { void save(); }}
              className="rounded-xl bg-teal-600 px-6 py-3 text-base font-bold text-white hover:bg-teal-700 disabled:opacity-50">
              {saving ? 'جاري الحفظ…' : 'حفظ إعدادات التوزيع'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">اختار مسئول التحصيل، وارفع ملف أو اربط جوجل شيت — كل عميل في الشيت بينزل باسمه.</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-bold text-gray-700">مسئول التحصيل
                <select value={officerId} onChange={e => { setOfficerId(e.target.value); setOpenSheetId(''); }} className={`${field} mt-1 block min-w-[220px]`}>
                  <option value="">— اختار —</option>
                  {officers.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-gray-700">الداتا تنزل في
                <select value={kind} onChange={e => setKind(e.target.value as 'old_local' | 'old_intl')} className={`${field} mt-1 block`}>
                  <option value="old_local">🏠 محلي قديم</option>
                  <option value="old_intl">🌐 دولي قديم</option>
                </select>
              </label>
            </div>

            {officer && (
              <>
                <div className="space-y-2 rounded-2xl border border-gray-200 p-4">
                  <p className="text-sm font-bold">شيتات {officer.name}</p>
                  {officerSheets.length === 0 && <p className="text-xs text-gray-500">مفيش شيت مربوط.</p>}
                  {officerSheets.map(sheet => (
                    <div key={sheet.id} className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => { setOpenSheetId(sheet.id); setKind(sheet.clientStatus); }}
                        className={chip(openSheetId === sheet.id)}>{sheet.name}</button>
                      <a href={sheetUrl(sheet)} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline" dir="ltr">فتح</a>
                      <button type="button" onClick={() => { void removeSheet(sheet.id); }} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" aria-label="فك الربط"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input value={newSheet.name} onChange={e => setNewSheet(current => ({ ...current, name: e.target.value }))} placeholder="اسم الشيت" className={`${field} w-40`} />
                    <input value={newSheet.link} onChange={e => setNewSheet(current => ({ ...current, link: e.target.value }))} placeholder="رابط جوجل شيت" dir="ltr" className={`${field} min-w-[260px] flex-1`} />
                    <button type="button" disabled={saving || !newSheet.link.trim()} onClick={() => { void addSheet(); }}
                      className="flex items-center gap-1 rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Plus size={14} /> ربط الشيت</button>
                  </div>
                </div>
                <OldDataImportPanel
                  key={`${officerId}-${openSheetId}`}
                  defaultSource={openSheet ? `شيت ${openSheet.name}` : `شيت ${officer.name}`}
                  accent="violet"
                  initialSheetLink={openSheet ? sheetUrl(openSheet) : ''}
                  loadSheetCsv={async link => {
                    const { sheetId, gid } = parseSheetLink(link);
                    const result = await mysqlAdmin.adminGet<{ csv: string }>(
                      `/admin/collection-sheets/csv?sheetId=${encodeURIComponent(sheetId)}&gid=${encodeURIComponent(gid)}`);
                    return result.csv;
                  }}
                  importRow={async (row, source) => {
                    await mysqlAdmin.saveSubscriber({
                      ...oldOnlineSubscriber(row, source, kind, courses),
                      assignedCsId: officer.id, assignedCsName: officer.name,
                    });
                  }}
                  onImported={async created => {
                    notify('success', `تم استيراد ${created} عميل باسم ${officer.name}`);
                    await onChanged();
                  }}
                />
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
