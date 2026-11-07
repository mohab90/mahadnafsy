import { useEffect, useRef, useState } from 'react';
import { Layers, MessageSquare, Send, X } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { mysqlAdmin, type LeadSegment } from '../../../../lib/mysqlapi';
import { cairoDay } from '../../../../../shared/cairoDate';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const STATUS_LABEL_SEG: Record<string, string> = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم', interested_booking: 'مهتم (حجز)',
  converted: 'تم التحويل', not_interested: 'غير مهتم', no_answer: 'لا يرد', follow_up: 'متابعة',
};

const PRESET_SEGMENTS = [
  { id: 'hot', label: '🔥 ليدات ساخنة', desc: 'درجة >70 + مهتمون', filters: { minScore: 70, status: 'interested' } },
  { id: 'noAnswer', label: '📵 لا يردون', desc: 'تم التواصل بدون رد', filters: { status: 'no_answer' } },
  { id: 'new7d', label: '🆕 جدد (7 أيام)', desc: 'أضيفوا خلال أسبوع', filters: { daysNew: 7 } },
  { id: 'converted', label: '✅ تحويلات', desc: 'تم تحويلهم لعملاء', filters: { status: 'converted' } },
  { id: 'referral', label: '👥 إحالات', desc: 'مصدرهم إحالة شخصية', filters: { source: 'referral' } },
  { id: 'facebook', label: '📘 فيسبوك', desc: 'جميع ليدات فيسبوك', filters: { source: 'facebook' } },
];

/**
 * «الشرائح»: the audience is the database's (GET /api/admin/leads/segments): the filters run over the same leads the leads screen lists, on the system's own score
 * (leads.score), and the screen holds only the first rows of the answer — it used to download the whole leads table and score each lead with a formula of its own.
 */
export function SegmentationTab({ notify }: { notify: NotifyFn }) {
  const [srcFilter, setSrcFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [minScore, setMinScore] = useState(0);
  const [maxDaysOld, setMaxDaysOld] = useState(0); // 0 = all
  const [searchQ, setSearchQ] = useState('');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [showBlast, setShowBlast] = useState(false);
  const [blastMsg, setBlastMsg] = useState('');
  const [blasting, setBlasting] = useState(false);
  const [blastResult, setBlastResult] = useState<{ sent: number; failed: number } | null>(null);

  const [segment, setSegment] = useState<LeadSegment | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const tell = useRef(notify);
  tell.current = notify;
  useEffect(() => { const timer = setTimeout(() => setQuery(searchQ.trim()), 350); return () => clearTimeout(timer); }, [searchQ]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    mysqlAdmin.getLeadSegment({ status: statusFilter, source: srcFilter, minScore, daysNew: maxDaysOld, q: query, pageSize: 100 })
      .then(answer => { if (alive) setSegment(answer); })
      .catch(() => { if (alive) tell.current('error', 'تعذر تحميل الشريحة'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [statusFilter, srcFilter, minScore, maxDaysOld, query]);
  const leads = { length: segment?.base ?? 0 };
  const sources = (segment?.facets.sources ?? []).map(item => item.value);
  const statuses = (segment?.facets.statuses ?? []).map(item => item.value);
  const rows = segment?.rows ?? [];
  const total = segment?.total ?? 0;

  const applyPreset = (preset: typeof PRESET_SEGMENTS[0]) => {
    setActivePreset(preset.id);
    setSrcFilter(preset.filters.source || 'all');
    setStatusFilter(preset.filters.status || 'all');
    setMinScore(preset.filters.minScore || 0);
    setMaxDaysOld(preset.filters.daysNew || 0);
    setSearchQ('');
  };

  async function sendBlast() {
    if (!blastMsg.trim()) { notify('error', 'اكتب رسالة أولاً'); return; }
    setBlasting(true);
    setBlastResult(null);
    try {
      // the first 200 of the audience, asked for now (the screen holds only the first 100 rows)
      const audience = await mysqlAdmin.getLeadSegment({ status: statusFilter, source: srcFilter, minScore, daysNew: maxDaysOld, q: query, pageSize: 200 });
      const r = await fetch('/api/admin/leads/bulk-whatsapp', {
        method: 'POST', credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ lead_ids: audience.rows.map(l => l.id), message: blastMsg }),
      });
      const data = await r.json();
      if (data.ok) { setBlastResult({ sent: data.sent, failed: data.failed }); notify('success', `تم الإرسال: ${data.sent}`); }
      else notify('error', data.error || 'خطأ');
    } catch { notify('error', 'خطأ في الاتصال'); }
    finally { setBlasting(false); }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-l from-teal-700 to-cyan-600 rounded-2xl p-5 text-white">
        <h3 className="font-bold text-lg flex items-center gap-2"><Layers size={20} />تقسيم الجمهور (Segmentation)</h3>
        <p className="text-teal-100 text-sm mt-1">قسّم ليداتك بمعايير متعددة وأرسل حملات مخصصة</p>
        <div className="flex gap-4 mt-3 text-sm">
          <span className="bg-white/20 rounded-xl px-3 py-1">📋 {leads.length} ليد إجمالي</span>
          <span className="bg-white/20 rounded-xl px-3 py-1">🎯 {total} في الشريحة الحالية</span>
        </div>
      </div>

      {/* Preset segments */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <h4 className="text-sm font-bold text-gray-700 mb-3">⚡ شرائح جاهزة:</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {PRESET_SEGMENTS.map(ps => (
            <button key={ps.id} onClick={() => applyPreset(ps)}
              className={`text-right p-3 rounded-xl border text-sm transition hover:shadow-sm ${activePreset === ps.id ? 'border-teal-400 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="font-bold text-gray-800">{ps.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{ps.desc}</div>
            </button>
          ))}
          <button onClick={() => { setActivePreset(null); setSrcFilter('all'); setStatusFilter('all'); setMinScore(0); setMaxDaysOld(0); setSearchQ(''); }}
            className="text-right p-3 rounded-xl border border-dashed border-gray-300 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-600">
            <div className="font-bold">🔄 إعادة تعيين</div>
            <div className="text-xs mt-0.5">عرض الكل</div>
          </button>
        </div>
      </div>

      {/* Custom filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
        <h4 className="text-sm font-bold text-gray-700">🔧 فلاتر مخصصة:</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setActivePreset(null); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="all">كل الحالات</option>
            {statuses.map(s => <option key={s} value={s}>{STATUS_LABEL_SEG[s] || s}</option>)}
          </select>
          <select value={srcFilter} onChange={e => { setSrcFilter(e.target.value); setActivePreset(null); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="all">كل المصادر</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="flex items-center gap-2 col-span-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">أضيفوا خلال:</span>
            <select value={maxDaysOld} onChange={e => { setMaxDaysOld(Number(e.target.value)); setActivePreset(null); }}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white flex-1">
              <option value={0}>أي وقت</option>
              <option value={7}>7 أيام</option>
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="🔍 بحث بالاسم أو الهاتف..."
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-teal-300" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">حد أدنى للدرجة:</span>
            <input type="range" min={0} max={100} step={10} value={minScore}
              onChange={e => { setMinScore(Number(e.target.value)); setActivePreset(null); }}
              className="w-20 accent-teal-500" />
            <span className="text-sm font-bold text-teal-600 w-8">{minScore}+</span>
          </div>
        </div>
      </div>

      {/* Segment result + action */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="font-bold text-gray-800">نتيجة الشريحة</h4>
            <p className="text-xs text-gray-500">{loading ? 'جاري الحساب…' : `${total.toLocaleString('ar-EG-u-nu-latn')}${segment?.capped ? '+' : ''} ليد يطابق المعايير`}</p>
          </div>
          <div className="flex gap-2">
            {total > 0 && (
              <button onClick={() => { setShowBlast(true); setBlastResult(null); }}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-4 py-2 rounded-xl">
                <MessageSquare size={15} />إرسال واتساب للشريحة
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الاسم</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الهاتف</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الحالة</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">المصدر</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-500">الدرجة</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">تاريخ الإضافة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(l => (
                <tr key={l.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-semibold text-gray-800">{l.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{l.phone || '—'}</td>
                  <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-lg text-xs">{STATUS_LABEL_SEG[l.status] || l.status}</span></td>
                  <td className="px-4 py-3 text-gray-500 text-xs capitalize">{l.source || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-bold text-sm ${l.score >= 70 ? 'text-red-600' : l.score >= 50 ? 'text-orange-600' : 'text-blue-600'}`}>{l.score}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{cairoDay(l.createdAt) || '—'}</td>
                </tr>
              ))}
              {total === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">لا توجد ليدات بهذه المعايير</td></tr>
              )}
            </tbody>
          </table>
          {total > 100 && (
            <div className="p-3 text-center text-xs text-gray-400">عرض أحدث 100 ليد من {total.toLocaleString('ar-EG-u-nu-latn')}</div>
          )}
        </div>
      </div>

      {/* WA Blast panel */}
      {showBlast && (
        <div className="bg-white border border-green-300 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-gray-800 flex items-center gap-2"><MessageSquare size={16} className="text-green-600" />إرسال واتساب للشريحة ({Math.min(total, 200)} ليد)</h4>
            <button onClick={() => setShowBlast(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
          <textarea rows={4} value={blastMsg} onChange={e => setBlastMsg(e.target.value)}
            placeholder="اكتب رسالتك... يمكنك استخدام {{name}} لإدراج اسم الليد"
            className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300" />
          <p className="text-xs text-gray-400">متغيرات: <code className="bg-gray-100 px-1 rounded">{'{'}{'{'} name {'}'}{'}'}</code></p>
          {blastResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm">
              ✅ تم الإرسال: <b>{blastResult.sent}</b> | فشل: <b>{blastResult.failed}</b>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => setShowBlast(false)} className="flex-1 border border-gray-200 rounded-xl py-2 text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
            <button onClick={sendBlast} disabled={blasting || !blastMsg.trim()}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-xl py-2 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {blasting ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />جارٍ الإرسال...</> : <><Send size={14} />إرسال الآن</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


