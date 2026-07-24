import { useMemo, useState } from 'react';
import { Target, Send } from 'lucide-react';
import type { LeadItem } from '../../../../types';
import type { NotifyFn } from './shared';

interface Props { leads: LeadItem[]; notify: NotifyFn }

export function AbTestSection({ leads, notify }: Props) {
  const [variantA, setVariantA] = useState('');
  const [variantB, setVariantB] = useState('');
  const [splitPct, setSplitPct] = useState(50);
  const [minScore, setMinScore] = useState(50);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sentA: number; sentB: number; total: number } | null>(null);

  const STATUS_W: Record<string, number> = { converted: 100, interested_booking: 85, interested: 70, follow_up: 55, contacted: 40, new: 25, no_answer: 10, not_interested: 0 };
  const SOURCE_W: Record<string, number> = { facebook: 20, google: 22, referral: 25, whatsapp: 18, instagram: 17, organic: 12, tiktok: 15 };
  // NOTE: followUpDate isn't a real LeadItem field (legacy/typo in original code) — preserved as always-falsy to keep behavior identical
  const scoreOf = (l: LeadItem) => Math.min(100, (STATUS_W[l.status] ?? 20) + (SOURCE_W[(l.source || '').toLowerCase()] ?? 10) + ((l as unknown as { followUpDate?: string }).followUpDate ? 10 : 0) + (l.notes ? 5 : 0));

  const eligible = useMemo(() =>
    leads.filter(l => l.phone && scoreOf(l) >= minScore),
    [leads, minScore]
  );

  const groupA = eligible.slice(0, Math.floor(eligible.length * splitPct / 100));
  const groupB = eligible.slice(groupA.length);

  async function runTest() {
    if (!variantA.trim() || !variantB.trim()) { notify('error', 'أدخل النصين أولاً'); return; }
    if (eligible.length < 2) { notify('error', 'لا يوجد ليدات كافية لهذا الاختبار'); return; }
    setSending(true);
    setResult(null);
    try {
      const [rA, rB] = await Promise.all([
        fetch('/api/admin/leads/bulk-whatsapp', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead_ids: groupA.map((l) => l.id), message: variantA }),
        }).then(r => r.json()),
        fetch('/api/admin/leads/bulk-whatsapp', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead_ids: groupB.map((l) => l.id), message: variantB }),
        }).then(r => r.json()),
      ]);
      if (rA.ok && rB.ok) {
        setResult({ sentA: rA.sent, sentB: rB.sent, total: rA.sent + rB.sent });
        notify('success', `تم إرسال الاختبار: A=${rA.sent} | B=${rB.sent}`);
      } else {
        notify('error', 'خطأ في الإرسال');
      }
    } catch { notify('error', 'خطأ في الاتصال'); }
    finally { setSending(false); }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
          <Target size={20} className="text-purple-600" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800">اختبار A/B للحملات (WhatsApp)</h3>
          <p className="text-xs text-gray-500 mt-0.5">أرسل نسختين مختلفتين وقارن التفاعل</p>
        </div>
      </div>

      {/* Settings row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-gray-500 mb-1 block">حد أدنى للدرجة:</label>
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={100} step={10} value={minScore} onChange={e => setMinScore(Number(e.target.value))} className="flex-1 accent-purple-500" />
            <span className="text-sm font-bold text-purple-600 w-8">{minScore}+</span>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 mb-1 block">نسبة المجموعة A:</label>
          <div className="flex items-center gap-2">
            <input type="range" min={10} max={90} step={10} value={splitPct} onChange={e => setSplitPct(Number(e.target.value))} className="flex-1 accent-purple-500" />
            <span className="text-sm font-bold text-purple-600 w-10">{splitPct}%</span>
          </div>
        </div>
      </div>

      {/* Audience preview */}
      <div className="bg-purple-50 rounded-xl p-3 text-sm text-purple-800 flex flex-wrap gap-3">
        <span>📊 مؤهل: <b>{eligible.length}</b> ليد</span>
        <span>🅰️ المجموعة A: <b>{groupA.length}</b></span>
        <span>🅱️ المجموعة B: <b>{groupB.length}</b></span>
      </div>

      {/* Message variants */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-blue-600 mb-1 block">🅰️ النسخة A ({splitPct}% من الليدات)</label>
          <textarea rows={4} value={variantA} onChange={e => setVariantA(e.target.value)}
            placeholder="اكتب نص الرسالة A... (يمكن استخدام {{name}})"
            className="w-full border border-blue-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300" />
          <p className="text-xs text-gray-400 mt-1">{variantA.length} حرف</p>
        </div>
        <div>
          <label className="text-xs font-bold text-green-600 mb-1 block">🅱️ النسخة B ({100 - splitPct}% من الليدات)</label>
          <textarea rows={4} value={variantB} onChange={e => setVariantB(e.target.value)}
            placeholder="اكتب نص الرسالة B... (يمكن استخدام {{name}})"
            className="w-full border border-green-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-green-300" />
          <p className="text-xs text-gray-400 mt-1">{variantB.length} حرف</p>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-4">
          <p className="font-bold text-green-800 mb-1">✅ تم إرسال الاختبار بنجاح!</p>
          <div className="grid grid-cols-3 gap-3 text-center text-sm mt-2">
            <div className="bg-blue-50 rounded-xl p-2"><div className="font-bold text-blue-700">{result.sentA}</div><div className="text-xs text-gray-500">النسخة A</div></div>
            <div className="bg-green-50 rounded-xl p-2"><div className="font-bold text-green-700">{result.sentB}</div><div className="text-xs text-gray-500">النسخة B</div></div>
            <div className="bg-gray-50 rounded-xl p-2"><div className="font-bold text-gray-700">{result.total}</div><div className="text-xs text-gray-500">إجمالي</div></div>
          </div>
          <p className="text-xs text-gray-500 mt-2">💡 تابع الردود والتحويلات خلال 24-48 ساعة لمعرفة الأفضل أداءً</p>
        </div>
      )}

      <button onClick={runTest} disabled={sending || !variantA.trim() || !variantB.trim() || eligible.length < 2}
        className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
        {sending ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />جارٍ الإرسال...</> : <><Send size={16} />تشغيل اختبار A/B الآن</>}
      </button>
    </div>
  );
}
