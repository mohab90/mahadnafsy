/**
 * CrmSettingsModal — extracted to its own file so CRMTab can be fully lazy-loaded.
 * Imported directly (non-lazy) from Dashboard.tsx because it is shown from outside CRMTab.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, Settings, Wifi, X } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

export type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
export type GSheet = { id: string; name: string; sheetId: string; gid: string; autoSync: boolean; defaultCourse?: string };
export type CrmSettings = {
  leadSources: string[];
  autoAssign: 'none' | 'rr' | 'least';
  sheets: GSheet[];
};

const DEFAULT_SOURCES = [
  'واتساب', 'فيسبوك', 'إنستغرام', 'توصية', 'الموقع', 'شات الـAI', 'جوجل', 'تسجيل دخول', 'Google Sheet', 'أخرى',
];

export const DEFAULT_CRM_SETTINGS: CrmSettings = {
  leadSources: DEFAULT_SOURCES,
  autoAssign: 'rr',
  sheets: [
    { id: 'gs-default', name: 'الشيت الرئيسي', sheetId: '1llDstW3cyvlSTgaHLaKQYiIHZ0dui9QwuszMWLvqNgA', gid: '1545487801', autoSync: true },
    { id: 'gs-mentalhealth', name: 'الصحة النفسية', sheetId: '1llDstW3cyvlSTgaHLaKQYiIHZ0dui9QwuszMWLvqNgA', gid: '1083686129', autoSync: true, defaultCourse: 'الصحة النفسية' },
  ],
};

export function CrmSettingsModal({ onClose, notify, salesReps, onSynced }: {
  onClose: () => void;
  notify: NotifyFn;
  salesReps: { id: string; name: string }[];
  onSynced: () => void;
}) {
  const [tab, setTab] = useState<'sources' | 'assign' | 'gsheet'>('sources');
  const [settings, setSettings] = useState<CrmSettings>(DEFAULT_CRM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [newSource, setNewSource] = useState('');
  const [newSheet, setNewSheet] = useState<Omit<GSheet, 'id'>>({ name: '', sheetId: '', gid: '', autoSync: true, defaultCourse: '' });
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; hint: string; headers?: string[] }>>({});

  useEffect(() => {
    mysqlAdmin.getCrmSettings().then(data => {
      if (data && Object.keys(data).length > 0) {
        const d = data as Partial<CrmSettings & { gsheetId?: string; gsheetGid?: string }>;
        const sheets: GSheet[] = Array.isArray(d.sheets) && d.sheets.length > 0
          ? d.sheets
          : d.gsheetId
            ? [{ id: 'gs-default', name: 'الشيت الرئيسي', sheetId: d.gsheetId, gid: d.gsheetGid || '', autoSync: true }]
            : DEFAULT_CRM_SETTINGS.sheets;
        setSettings({
          leadSources: d.leadSources?.length ? d.leadSources : DEFAULT_SOURCES,
          autoAssign: d.autoAssign || 'rr',
          sheets,
        });
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.saveCrmSettings(settings as unknown as Record<string, unknown>);
      notify('success', 'تم حفظ الإعدادات');
      onClose();
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'فشل الحفظ');
    } finally { setSaving(false); }
  };

  const addSource = () => {
    const s = newSource.trim();
    if (!s || settings.leadSources.includes(s)) return;
    setSettings(x => ({ ...x, leadSources: [...x.leadSources, s] }));
    setNewSource('');
  };

  const removeSource = (src: string) =>
    setSettings(x => ({ ...x, leadSources: x.leadSources.filter(s => s !== src) }));

  const extractSheetId = (v: string) => {
    const m = v.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : v.trim();
  };

  const addSheet = () => {
    if (!newSheet.sheetId) return notify('error', 'أدخل رابط الشيت');
    const gs: GSheet = { ...newSheet, sheetId: extractSheetId(newSheet.sheetId), id: `gs-${Date.now()}`, name: newSheet.name || 'شيت جديد' };
    setSettings(x => ({ ...x, sheets: [...x.sheets, gs] }));
    setNewSheet({ name: '', sheetId: '', gid: '', autoSync: true });
  };

  const removeSheet = (id: string) => setSettings(x => ({ ...x, sheets: x.sheets.filter(s => s.id !== id) }));
  const toggleAutoSync = (id: string) => setSettings(x => ({ ...x, sheets: x.sheets.map(s => s.id === id ? { ...s, autoSync: !s.autoSync } : s) }));

  const testSheet = async (sheet: GSheet) => {
    setTestingId(sheet.id);
    try {
      const r = await mysqlAdmin.testGoogleSheet(sheet.sheetId, sheet.gid);
      setTestResults(prev => ({ ...prev, [sheet.id]: { ok: r.ok && r.accessible === true, hint: r.hint || r.reason || '', headers: r.headers } }));
      if (!r.accessible) notify('error', r.hint || 'الشيت غير متاح');
    } catch (e) {
      setTestResults(prev => ({ ...prev, [sheet.id]: { ok: false, hint: e instanceof Error ? e.message : 'خطأ' } }));
    } finally { setTestingId(null); }
  };

  const syncAll = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const r = await mysqlAdmin.syncAllSheets();
      setSyncResult({ imported: r.imported, skipped: r.skipped });
      notify('success', `تم استيراد ${r.imported} عميل جديد (${r.skipped} مكرر)`);
      onSynced();
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'فشل المزامنة');
    } finally { setSyncing(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden" dir="rtl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-l from-indigo-50 to-white">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-indigo-600" />
            <h3 className="font-bold text-gray-900">إعدادات العملاء المحتملين</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1"><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {([['sources','مصادر الليدز'],['assign','التوزيع التلقائي'],['gsheet','Google Sheets']] as const).map(([t,l]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-bold transition ${
                tab === t ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}>{l}</button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 min-h-[320px] max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <span className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
            </div>
          ) : tab === 'sources' ? (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">المصادر المتاحة عند إضافة ليد جديد. يمكن إضافة أو حذف أي مصدر.</p>
              <div className="flex flex-wrap gap-2">
                {settings.leadSources.map(src => (
                  <span key={src} className="flex items-center gap-1 bg-indigo-50 text-indigo-800 text-xs font-bold px-2.5 py-1 rounded-full border border-indigo-200">
                    {src}
                    <button onClick={() => removeSource(src)} className="text-indigo-400 hover:text-red-500 ml-1">
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newSource} onChange={e => setNewSource(e.target.value)} onKeyDown={e => e.key === 'Enter' && addSource()} placeholder="اسم المصدر الجديد..." className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
                <button onClick={addSource} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition"><Plus size={15} /></button>
              </div>
            </div>
          ) : tab === 'assign' ? (
            <div className="space-y-5">
              <p className="text-xs text-gray-500">اختر طريقة توزيع الليدز الجدد على السيلز تلقائياً.</p>
              <div className="space-y-3">
                {([
                  ['none',  'بدون توزيع تلقائي',     'يتم التعيين يدوياً فقط'],
                  ['rr',   'Round-Robin (بالتسلسل)', 'كل ليد جديد يروح للسيلز التالي في الترتيب'],
                  ['least','الأقل تحميلاً',           'الليد يروح للسيلز اللي عنده أقل عدد ليدز نشطة'],
                ] as const).map(([v, lbl, desc]) => (
                  <button key={v} onClick={() => setSettings(x => ({ ...x, autoAssign: v }))}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-right transition ${settings.autoAssign === v ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-200'}`}>
                    <span className={`w-4 h-4 mt-0.5 rounded-full border-2 flex-shrink-0 ${settings.autoAssign === v ? 'border-indigo-600 bg-indigo-600' : 'border-gray-300'}`} />
                    <div><p className="font-bold text-sm text-gray-900">{lbl}</p><p className="text-xs text-gray-500 mt-0.5">{desc}</p></div>
                  </button>
                ))}
              </div>
              {salesReps.length === 0 && <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl p-3">⚠️ لا يوجد مندوبو مبيعات نشطون — أضف موظفين بدور Sales أولاً</p>}
            </div>
          ) : (
            <div className="space-y-4">
              {/* CRITICAL: public sharing requirement */}
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-800 space-y-1">
                <p className="font-bold flex items-center gap-1.5"><AlertTriangle size={13} /> شرط أساسي لعمل المزامنة</p>
                <p>يجب أن يكون الشيت <strong>مشترك للعموم</strong> بصلاحية القراءة فقط:</p>
                <ol className="list-decimal list-inside space-y-0.5 mr-2">
                  <li>Google Sheets → اضغط <strong>"مشاركة"</strong></li>
                  <li>غيّر إلى <strong>"أي شخص لديه الرابط"</strong> → قارئ فقط</li>
                  <li>تأكد من أن الصلاحية <strong>ليست محظورة</strong></li>
                </ol>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
                <p className="font-bold mb-1">📋 أسماء الكولمنز المقبولة:</p>
                <p className="font-mono text-[10px] leading-relaxed">
                  الاسم: name / full_name / الاسم<br />
                  الهاتف: phone / phone_number / رقم_الهاتف<br />
                  البريد: email<br />
                  ملاحظات: notes / message / رسالة
                </p>
                <p className="mt-1 opacity-70">المزامنة تلقائية كل 15 دقيقة</p>
              </div>

              {/* Existing sheets */}
              <div className="space-y-2">
                {settings.sheets.map(sheet => {
                  const tr = testResults[sheet.id];
                  return (
                  <div key={sheet.id} className="border border-gray-200 rounded-xl p-3 bg-gray-50 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-gray-800">{sheet.name}</span>
                        {tr && (
                          tr.ok
                            ? <span className="flex items-center gap-1 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><CheckCircle2 size={11} /> متاح ({tr.hint})</span>
                            : <span className="flex items-center gap-1 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5"><AlertTriangle size={11} /> {tr.hint.includes('private') ? 'غير منشور' : 'خطأ في الاتصال'}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => testSheet(sheet)} disabled={testingId === sheet.id}
                          className="flex items-center gap-1 text-[11px] px-2 py-1 border border-indigo-300 text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition disabled:opacity-50">
                          {testingId === sheet.id ? <span className="w-3 h-3 border border-indigo-400 border-t-indigo-700 rounded-full animate-spin" /> : <Wifi size={11} />}
                          اختبار
                        </button>
                        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                          <input type="checkbox" checked={sheet.autoSync} onChange={() => toggleAutoSync(sheet.id)} className="rounded" />
                          تلقائي
                        </label>
                        <button onClick={() => removeSheet(sheet.id)} className="text-red-400 hover:text-red-600 p-1"><X size={14} /></button>
                      </div>
                    </div>
                    <div className="flex gap-2 text-[11px] text-gray-500 font-mono">
                      <span className="bg-white border border-gray-200 rounded px-2 py-0.5 truncate max-w-[200px]" title={sheet.sheetId}>{sheet.sheetId.slice(0, 20)}…</span>
                      {sheet.gid && <span className="bg-white border border-gray-200 rounded px-2 py-0.5">gid={sheet.gid}</span>}
                      {sheet.defaultCourse && <span className="bg-amber-50 border border-amber-200 rounded px-2 py-0.5 text-amber-700 font-sans">كورس افتراضي: {sheet.defaultCourse}</span>}
                    </div>
                    {tr?.ok && tr.headers && <div className="text-[10px] text-gray-500">كولمنز: {tr.headers.slice(0,6).join(' | ')}</div>}
                    {tr && !tr.ok && tr.hint.includes('private') && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                        ❌ الشيت غير منشور — افتح Google Sheets واضغط <strong>مشاركة</strong> ثم <strong>"أي شخص لديه الرابط"</strong> → قارئ
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>

              {/* Add new sheet */}
              <div className="border border-dashed border-indigo-300 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-indigo-700">+ إضافة شيت جديد</p>
                <input value={newSheet.name} onChange={e => setNewSheet(x => ({ ...x, name: e.target.value }))} placeholder="اسم الشيت (مثل: فيسبوك ليدز)" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
                <input value={newSheet.sheetId} onChange={e => setNewSheet(x => ({ ...x, sheetId: e.target.value }))} placeholder="رابط الشيت أو Sheet ID" dir="ltr" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-mono" />
                <div className="flex gap-2">
                  <input value={newSheet.gid} onChange={e => setNewSheet(x => ({ ...x, gid: e.target.value }))} placeholder="GID (اختياري)" dir="ltr" className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-mono" />
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer shrink-0">
                    <input type="checkbox" checked={newSheet.autoSync} onChange={e => setNewSheet(x => ({ ...x, autoSync: e.target.checked }))} className="rounded" />
                    تلقائي
                  </label>
                  <button onClick={addSheet} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition shrink-0">إضافة</button>
                </div>
                <input value={newSheet.defaultCourse || ''} onChange={e => setNewSheet(x => ({ ...x, defaultCourse: e.target.value }))} placeholder="كورس افتراضي إذا لم يوجد في الشيت (اختياري)" className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>

              {/* Sync all button */}
              <button onClick={syncAll} disabled={syncing || settings.sheets.length === 0}
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white py-2.5 rounded-xl font-bold hover:bg-emerald-700 transition disabled:opacity-60">
                {syncing ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <RefreshCw size={15} />}
                {syncing ? 'جاري المزامنة...' : `مزامنة الكل الآن (${settings.sheets.length} شيت)`}
              </button>
              {syncResult && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800 text-center">
                  ✅ تم استيراد <strong>{syncResult.imported}</strong> عميل · تجاهل <strong>{syncResult.skipped}</strong> مكرر
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3">
          <button onClick={save} disabled={saving}
            className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-60 flex items-center justify-center gap-2">
            {saving ? <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : null}
            {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
          <button onClick={onClose} className="px-4 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition">إلغاء</button>
        </div>
      </div>
    </div>
  );
}
