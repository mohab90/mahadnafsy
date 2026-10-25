import { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Plus, Repeat, Save, Trash2 } from 'lucide-react';
import { cairoDateOnly, cairoDay } from '../../../shared/cairoDate';
import { DAYS, dayLabel, errorText, lecturerApi, type Availability, type Notify, type Slot } from './lecturerApi';
import { Card, Empty, field, Loading, primaryButton, quietButton } from './ui';

// «الأوقات اللي المحاضر بيحددها تتكرر كل أسبوع … ويقدر يقفل يوم معين»: the weekly hours repeat by themselves — there is no
// date to re-enter every week — and a day away is closed once. Only for a lecturer whose consultations are switched on.

export function LecturerHours({ notify }: { notify: Notify }) {
  const [data, setData] = useState<Availability | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blockDate, setBlockDate] = useState(cairoDateOnly());
  const [blockReason, setBlockReason] = useState('');

  const load = useCallback(() => {
    lecturerApi.availability().then(result => { setData(result); setSlots(result.slots); setDirty(false); })
      .catch(error => { notify('error', errorText(error, 'تعذر تحميل المواعيد')); });
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Loading />;
  if (!data.hasProfile || !data.enabled) {
    return <Empty>{!data.hasProfile ? 'مفيش ملف استشارات مربوط بحسابك — اطلب من الإدارة تربطه.' : 'الاستشارات مش مفعّلة على حسابك — اطلب من الإدارة تفعيلها وبعدها تحدد مواعيدك من هنا.'}</Empty>;
  }

  const change = (index: number, patch: Partial<Slot>) => { setSlots(current => current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot))); setDirty(true); };
  const add = (day: string) => { setSlots(current => [...current, { day, startTime: '18:00', endTime: '19:00' }]); setDirty(true); };
  const remove = (index: number) => { setSlots(current => current.filter((_, i) => i !== index)); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try { await lecturerApi.saveSlots(slots); notify('success', 'اتحفظت مواعيدك — بتتكرر كل أسبوع'); load(); }
    catch (error) { notify('error', errorText(error)); } finally { setSaving(false); }
  };

  const block = async () => {
    try {
      const result = await lecturerApi.blockDay(blockDate, blockReason);
      notify(result.alreadyBooked ? 'info' : 'success', result.alreadyBooked ? `اتقفل اليوم — بس فيه ${result.alreadyBooked} حجز على اليوم ده محتاج تنقله` : 'اتقفل اليوم');
      setBlockReason(''); load();
    } catch (error) { notify('error', errorText(error)); }
  };

  const unblock = async (id: string) => {
    try { await lecturerApi.unblockDay(id); notify('success', 'اتفتح اليوم'); load(); } catch (error) { notify('error', errorText(error)); }
  };

  return (
    <div className="space-y-5">
      <Card title="مواعيدي الأسبوعية" icon={<Repeat size={18} className="text-primary-600" />}
        actions={<button type="button" disabled={!dirty || saving} onClick={() => void save()} className={primaryButton}><Save size={15} /> حفظ المواعيد</button>}>
        <p className="text-xs text-gray-500">كل موعد بتحطه بيتكرر كل أسبوع في نفس اليوم والساعة — مش محتاج تحدد التاريخ. العميل بيختار يوم من الأيام دي وبعدها الساعة. لو هتغيب يوم معين اقفله من تحت.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {DAYS.map(([key, label]) => {
            const rows = slots.map((slot, index) => ({ slot, index })).filter(row => row.slot.day === key);
            return (
              <div key={key} className="rounded-2xl border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-bold text-gray-800">{label}</p>
                  <button type="button" onClick={() => add(key)} className="inline-flex items-center gap-1 text-xs font-bold text-primary-700"><Plus size={13} /> موعد</button>
                </div>
                {rows.length === 0 ? <p className="text-xs text-gray-400">مفيش مواعيد</p> : rows.map(({ slot, index }) => (
                  <div key={index} className="mb-2 flex items-center gap-2">
                    <input type="time" className={`${field} !w-28`} value={slot.startTime} onChange={e => change(index, { startTime: e.target.value })} />
                    <span className="text-xs text-gray-400">إلى</span>
                    <input type="time" className={`${field} !w-28`} value={slot.endTime} onChange={e => change(index, { endTime: e.target.value })} />
                    <button type="button" aria-label="مسح الموعد" onClick={() => remove(index)} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {slots.length > 0 && <p className="text-xs text-gray-500">المجموع: {slots.length} موعد في الأسبوع — {[...new Set(slots.map(slot => dayLabel(slot.day)))].join('، ')}</p>}
      </Card>

      <Card title="أيام مقفولة" icon={<CalendarOff size={18} className="text-red-500" />}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold text-gray-600">اليوم<input type="date" min={cairoDateOnly()} className={field} value={blockDate} onChange={e => setBlockDate(e.target.value)} /></label>
          <label className="min-w-[180px] flex-1 text-xs font-bold text-gray-600">السبب (اختياري)<input className={field} value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="سفر، إجازة…" /></label>
          <button type="button" className={quietButton} onClick={() => void block()}><CalendarOff size={15} /> اقفل اليوم</button>
        </div>
        {data.blocked.length === 0 ? <p className="text-xs text-gray-400">مفيش أيام مقفولة.</p> : (
          <ul className="space-y-1.5">
            {data.blocked.map(day => (
              <li key={day.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2 text-sm">
                <span><b>{cairoDay(day.date)}</b>{day.reason ? <span className="mr-2 text-xs text-gray-500">— {day.reason}</span> : null}</span>
                <button type="button" className="text-xs font-bold text-primary-700 hover:underline" onClick={() => void unblock(day.id)}>افتح اليوم</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
