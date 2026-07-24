import { useMemo, useState } from 'react';
import { Star, MessageSquare, Send, X, Zap } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { useSiteData } from '../../../context/SiteDataContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type LeadScoreSort = 'score' | 'date';

const STATUS_WEIGHTS: Record<string, number> = {
  converted: 100, interested_booking: 85, interested: 70, follow_up: 55,
  contacted: 40, new: 25, no_answer: 10, not_interested: 0,
};
const SOURCE_WEIGHTS: Record<string, number> = {
  facebook: 20, google: 22, referral: 25, whatsapp: 18, instagram: 17, organic: 12, tiktok: 15,
};

function calcLeadScore(lead: any): number {
  const statusScore = STATUS_WEIGHTS[lead.status] ?? 20;
  const sourceScore = SOURCE_WEIGHTS[lead.source?.toLowerCase() || ''] ?? 10;
  const followUpScore = lead.followUpDate ? 10 : 0;
  const noteScore = (lead.notes || lead.note) ? 5 : 0;
  // Recency bonus
  const createdAt = lead.createdAt || lead.created_at || '';
  const daysSince = createdAt ? Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000) : 999;
  const recencyScore = daysSince <= 3 ? 15 : daysSince <= 7 ? 10 : daysSince <= 14 ? 5 : 0;
  // Phone quality + interaction bonus
  const phoneScore = lead.phone && lead.phone.replace(/\D/g, '').length >= 10 ? 5 : 0;
  const interactScore = Math.min(10, (lead.communications_count || 0) * 2);
  return Math.min(100, statusScore + sourceScore + followUpScore + noteScore + recencyScore + phoneScore + interactScore);
}

function getScoreTier(score: number): { label: string; color: string; bg: string; barColor: string } {
  if (score >= 80) return { label: 'ساخن 🔥', color: 'text-red-600', bg: 'bg-red-50 border-red-200', barColor: '#ef4444' };
  if (score >= 60) return { label: 'دافئ 🟠', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200', barColor: '#f97316' };
  if (score >= 40) return { label: 'متوسط 🟡', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', barColor: '#f59e0b' };
  return { label: 'بارد 🔵', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', barColor: '#3b82f6' };
}

const STATUS_LABEL: Record<string, string> = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم', interested_booking: 'مهتم (حجز)',
  converted: 'تم التحويل', not_interested: 'غير مهتم', no_answer: 'لا يرد', follow_up: 'متابعة',
};

const WA_TEMPLATES = [
  { label: '🔥 ليدات ساخنة — عرض خاص', text: 'السلام عليكم {{name}}! 🌟\nلاحظنا اهتمامك بخدماتنا في مهاد نفسي.\nلدينا عرض خاص محدود المدة — تواصل معنا الآن لتعرف التفاصيل! 💬' },
  { label: '📞 تذكير متابعة', text: 'أهلاً {{name}}! نتمنى تواصلك معنا للاستفسار عن برامجنا في مهاد نفسي.\nنحن هنا لمساعدتك 🌱' },
  { label: '🎓 دعوة للتسجيل', text: 'مرحباً {{name}}! 🎉\nدوراتنا الجديدة متاحة الآن للتسجيل.\nاحجز مكانك قبل امتلاء المجموعة! 👇' },
  { label: '💡 محتوى مجاني', text: 'السلام عليكم {{name}}! 😊\nنشاركك اليوم محتوى مجاني مفيد من مهاد نفسي.\nتابعنا للمزيد من النصائح والبرامج النفسية! 🌿' },
];

function BulkWaModal({ leads, onClose, notify }: { leads: any[]; onClose: () => void; notify: NotifyFn }) {
  const [templateIdx, setTemplateIdx] = useState(0);
  const [customMsg, setCustomMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  const message = customMsg || WA_TEMPLATES[templateIdx]?.text || '';
  const preview = message.replace(/\{\{name\}\}/g, leads[0]?.name || 'اسم العميل');

  async function doSend() {
    if (!message.trim()) { notify('error', 'اكتب رسالة أولاً'); return; }
    setSending(true);
    try {
      const r = await fetch('/api/admin/leads/bulk-whatsapp', {
        method: 'POST', credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ lead_ids: leads.map(l => l.id), message }),
      });
      const data = await r.json();
      if (data.ok) { setResult({ sent: data.sent, failed: data.failed }); notify('success', `تم الإرسال: ${data.sent} رسالة`); }
      else notify('error', data.error || 'خطأ في الإرسال');
    } catch { notify('error', 'خطأ في الاتصال'); }
    finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" dir="rtl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><MessageSquare size={18} className="text-green-600" />إرسال واتساب جماعي</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800 font-medium">
            📋 سيتم الإرسال لـ <span className="font-bold">{leads.length} ليد</span>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">قالب الرسالة:</label>
            <div className="grid grid-cols-2 gap-2">
              {WA_TEMPLATES.map((t, i) => (
                <button key={i} onClick={() => { setTemplateIdx(i); setCustomMsg(''); }}
                  className={`text-xs text-right p-2 rounded-xl border transition ${templateIdx === i && !customMsg ? 'border-green-400 bg-green-50 font-bold' : 'border-gray-200 hover:border-gray-300'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-gray-600 mb-1 block">نص الرسالة (يمكن تعديله):</label>
            <textarea rows={5} value={customMsg || WA_TEMPLATES[templateIdx]?.text || ''} onChange={e => setCustomMsg(e.target.value)}
              className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300"
              placeholder="اكتب رسالتك... يمكنك استخدام {{name}} لإدراج اسم الليد" />
            <p className="text-xs text-gray-400 mt-1">متغيرات: <code className="bg-gray-100 px-1 rounded">{'{'}{'{'} name {'}'}{'}'}</code></p>
          </div>
          {preview && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-xs font-bold text-gray-500 mb-1">معاينة:</p>
              <p className="text-sm text-gray-700 whitespace-pre-line">{preview}</p>
            </div>
          )}
          {result && (
            <div className="bg-green-50 border border-green-300 rounded-xl p-3 text-sm">
              ✅ تم الإرسال: <b>{result.sent}</b> رسالة &nbsp;|&nbsp; فشل: <b>{result.failed}</b>
            </div>
          )}
        </div>
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm hover:bg-gray-50">إلغاء</button>
          {!result && (
            <button onClick={doSend} disabled={sending || !message.trim()}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-xl py-2 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {sending ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />جارٍ الإرسال...</> : <><Send size={15} />إرسال الآن</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LeadScoringTab({ notify }: { notify: NotifyFn }) {
  const { leads } = useSiteData();
  const [minScore, setMinScore] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'score' | 'date'>('score');
  const [searchQ, setSearchQ] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);

  const scoredLeads = useMemo(() =>
    leads.map(l => ({ ...l, score: calcLeadScore(l) }))
         .sort((a, b) => sortBy === 'score' ? b.score - a.score : (b.createdAt || '').localeCompare(a.createdAt || '')),
    [leads, sortBy]
  );

  const filtered = useMemo(() =>
    scoredLeads.filter(l =>
      l.score >= minScore &&
      (statusFilter === 'all' || l.status === statusFilter) &&
      (sourceFilter === 'all' || (l.source || '').toLowerCase() === sourceFilter) &&
      (!searchQ || l.name?.toLowerCase().includes(searchQ.toLowerCase()) || l.phone?.includes(searchQ))
    ),
    [scoredLeads, minScore, statusFilter, sourceFilter, searchQ]
  );

  const distribution = useMemo(() => [
    { label: 'ساخن (80+)', count: scoredLeads.filter(l => l.score >= 80).length, fill: '#ef4444' },
    { label: 'دافئ (60-79)', count: scoredLeads.filter(l => l.score >= 60 && l.score < 80).length, fill: '#f97316' },
    { label: 'متوسط (40-59)', count: scoredLeads.filter(l => l.score >= 40 && l.score < 60).length, fill: '#f59e0b' },
    { label: 'بارد (<40)', count: scoredLeads.filter(l => l.score < 40).length, fill: '#3b82f6' },
  ], [scoredLeads]);

  const avgScore = scoredLeads.length > 0
    ? Math.round(scoredLeads.reduce((a, l) => a + l.score, 0) / scoredLeads.length) : 0;

  const sources = [...new Set(leads.map(l => (l.source || '').toLowerCase()))].filter(Boolean);
  const statuses = [...new Set(leads.map(l => l.status))].filter(Boolean);

  const allSelected = filtered.length > 0 && filtered.every(l => selectedIds.has(l.id));
  const toggleAll = () => { if (allSelected) setSelectedIds(new Set()); else setSelectedIds(new Set(filtered.slice(0, 50).map(l => l.id))); };
  const toggleOne = (id: string) => { const n = new Set(selectedIds); n.has(id) ? n.delete(id) : n.add(id); setSelectedIds(n); };
  const selectedLeads = filtered.filter(l => selectedIds.has(l.id));

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-orange-500 to-red-500 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Star size={22} />تسجيل الليدات (Lead Scoring)</h2>
        <p className="text-orange-100 text-sm mt-1">تقييم ذكي لكل ليد بناءً على الحالة والمصدر والنشاط والتوقيت — مع إرسال واتساب جماعي للشرائح</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 text-center">
          <div className="text-2xl font-extrabold text-gray-900">{leads.length}</div>
          <div className="text-xs text-gray-500 mt-1">إجمالي الليدات</div>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-2xl p-4 text-center">
          <div className="text-2xl font-extrabold text-red-700">{distribution[0].count}</div>
          <div className="text-xs text-red-500 mt-1">ليدات ساخنة 🔥</div>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-center">
          <div className="text-2xl font-extrabold text-amber-700">{avgScore}</div>
          <div className="text-xs text-amber-500 mt-1">متوسط الدرجة</div>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4 text-center">
          <div className="text-2xl font-extrabold text-orange-700">{distribution[1].count}</div>
          <div className="text-xs text-orange-500 mt-1">ليدات دافئة 🟠</div>
        </div>
      </div>

      {/* Distribution chart */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 mb-4">📊 توزيع الليدات حسب الدرجة</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={distribution} layout="vertical">
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={90} />
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <Tooltip formatter={(v: number) => [v, 'عدد الليدات']} />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} name="عدد الليدات">
              {distribution.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Score Algorithm Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <Zap size={16} className="text-blue-600" />
          <span className="text-sm font-bold text-blue-800">كيف تُحسب الدرجة؟</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-blue-700">
          <div className="bg-white/70 rounded-xl p-2 text-center"><div className="font-bold text-blue-900">حالة الليد</div><div>حتى 100 نقطة</div></div>
          <div className="bg-white/70 rounded-xl p-2 text-center"><div className="font-bold text-blue-900">مصدر الليد</div><div>حتى 25 نقطة</div></div>
          <div className="bg-white/70 rounded-xl p-2 text-center"><div className="font-bold text-blue-900">حداثة السجل</div><div>حتى 15 نقطة</div></div>
          <div className="bg-white/70 rounded-xl p-2 text-center"><div className="font-bold text-blue-900">متابعة + ملاحظات</div><div>حتى 15 نقطة</div></div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="🔍 بحث بالاسم أو الهاتف..."
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm flex-1 min-w-[180px] focus:outline-none focus:ring-2 focus:ring-orange-300" />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="all">كل الحالات</option>
            {statuses.map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}</option>)}
          </select>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="all">كل المصادر</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as LeadScoreSort)}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
            <option value="score">ترتيب بالدرجة</option>
            <option value="date">ترتيب بالتاريخ</option>
          </select>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs text-gray-500 whitespace-nowrap">حد أدنى للدرجة:</span>
            <input type="range" min={0} max={100} step={10} value={minScore} onChange={e => setMinScore(Number(e.target.value))}
              className="flex-1 accent-orange-500" />
            <span className="text-sm font-bold text-orange-600 w-8">{minScore}+</span>
          </div>
          <span className="text-xs text-gray-400">{filtered.length} ليد</span>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="bg-green-50 border border-green-300 rounded-2xl p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-green-800">✅ {selectedIds.size} ليد محدد</span>
          <button onClick={() => setShowBulkModal(true)}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold px-4 py-2 rounded-xl">
            <MessageSquare size={15} />إرسال واتساب جماعي
          </button>
          <button onClick={() => setSelectedIds(new Set())}
            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-300 px-3 py-2 rounded-xl">
            إلغاء التحديد
          </button>
        </div>
      )}

      {/* Leads list */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">قائمة الليدات المقيّمة</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">{filtered.length} ليد</span>
            {filtered.length > 0 && (
              <button onClick={() => setSelectedIds(new Set(filtered.slice(0, 50).map(l => l.id)))}
                className="text-xs text-orange-600 hover:text-orange-700 border border-orange-200 px-2 py-1 rounded-lg">
                تحديد الأوائل 50
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-3 text-center">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-orange-500 w-4 h-4" />
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الاسم</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الهاتف</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الحالة</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">المصدر</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-500">الدرجة</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">التصنيف</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-500">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.slice(0, 50).map(l => {
                const tier = getScoreTier(l.score);
                const waUrl = `https://wa.me/${(l.phone || '').replace(/\D/g, '')}`;
                return (
                  <tr key={l.id}
                    className={`hover:bg-gray-50 transition border-r-4 ${l.score >= 80 ? 'border-r-red-400' : l.score >= 60 ? 'border-r-orange-400' : l.score >= 40 ? 'border-r-amber-300' : 'border-r-blue-300'}`}>
                    <td className="px-3 py-3 text-center">
                      <input type="checkbox" checked={selectedIds.has(l.id)} onChange={() => toggleOne(l.id)} className="accent-orange-500 w-4 h-4" />
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-800">{l.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{l.phone || '—'}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-lg text-xs">{STATUS_LABEL[l.status] || l.status}</span></td>
                    <td className="px-4 py-3 text-gray-500 text-xs capitalize">{l.source || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="inline-flex items-center gap-1.5">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-sm"
                          style={{ background: tier.barColor + '22', color: tier.barColor }}>
                          {l.score}
                        </div>
                        <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${l.score}%`, background: tier.barColor }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`px-2 py-1 rounded-lg text-xs font-bold border ${tier.bg} ${tier.color}`}>{tier.label}</span></td>
                    <td className="px-4 py-3 text-center">
                      {l.phone && (
                        <a href={waUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-green-700 hover:text-green-900 border border-green-200 bg-green-50 px-2 py-1 rounded-lg hover:bg-green-100 transition">
                          <MessageSquare size={12} />WA
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">لا توجد ليدات بهذه المعايير</td></tr>
              )}
            </tbody>
          </table>
          {filtered.length > 50 && (
            <div className="p-4 text-center text-xs text-gray-400">عرض أول 50 ليد من {filtered.length}</div>
          )}
        </div>
      </div>

      {/* Bulk WA Modal */}
      {showBulkModal && (
        <BulkWaModal leads={selectedLeads} onClose={() => setShowBulkModal(false)} notify={notify} />
      )}
    </div>
  );
}

