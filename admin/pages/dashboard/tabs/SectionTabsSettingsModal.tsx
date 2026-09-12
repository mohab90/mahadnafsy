import { useEffect, useState } from 'react';
import { Loader2, Plus, Settings, Trash2 } from 'lucide-react';
import { Modal } from '../../../../shared/ui/Modal';

import { mysqlAdmin } from '../../../lib/mysqlapi';
import {
  PANELS, PANEL_LABELS, SECTION_LABELS,
  type PanelKey, type SectionKey, type SectionTab, type SectionTabsMap,
  emptySectionTabs, newSectionTab, normalizeSectionTabs,
} from './sectionTabs';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

/**
 * The settings dialog behind the gear, shared by all three sections.
 *
 * Only العملاء المحتملين had a gear, and what sat behind it was CRM-wide
 * (sources, auto-assign, Sheets). This is the per-section half: the tabs this
 * screen shows. One component rather than three, because "add a tab" means the
 * same thing on each and three copies would drift the moment one gained a
 * panel.
 *
 * It edits a draft and saves once. Saving each keystroke would write a
 * half-typed label into a shared, admin-only setting that every other viewer of
 * the section then renders.
 */
export default function SectionTabsSettingsModal({
  section, notify, onClose, onSaved,
}: {
  section: SectionKey;
  notify: NotifyFn;
  onClose: () => void;
  /** Handed the saved map so the caller can render without a refetch. */
  onSaved: (tabs: SectionTabsMap) => void;
}) {
  const [all, setAll] = useState<SectionTabsMap>(emptySectionTabs);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.getSectionTabs()
      .then(data => { if (!cancelled) setAll(normalizeSectionTabs(data)); })
      .catch(() => { if (!cancelled) notify('error', 'تعذّر تحميل تبويبات القسم'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [notify]);

  const tabs = all[section];
  const setTabs = (next: SectionTab[]) => setAll(current => ({ ...current, [section]: next }));
  const patch = (id: string, change: Partial<SectionTab>) =>
    setTabs(tabs.map(tab => (tab.id === id ? { ...tab, ...change } : tab)));
  const togglePanel = (tab: SectionTab, panel: PanelKey) =>
    patch(tab.id, { sections: { ...tab.sections, [panel]: !tab.sections[panel] } });

  const save = async () => {
    // The label is the tab. An unnamed one would save, come back as
    // "تاب بدون اسم" from the route's own fallback, and look like a bug.
    const unnamed = tabs.find(tab => !tab.label.trim());
    if (unnamed) { notify('error', 'اكتب اسم لكل تاب قبل الحفظ'); return; }
    setSaving(true);
    try {
      const saved = normalizeSectionTabs(await mysqlAdmin.saveSectionTabs(all));
      onSaved(saved);
      notify('success', 'تم حفظ تبويبات القسم');
      onClose();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر الحفظ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`إعدادات ${SECTION_LABELS[section]}`}
      icon={<Settings size={18} className="text-primary-600" />}
      size="lg"
      footer={(
        <>
          <button onClick={onClose} className="rounded-xl bg-gray-100 px-5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-200">
            إلغاء
          </button>
          <button
            onClick={save}
            disabled={saving || loading}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={15} className="animate-spin" />}
            حفظ
          </button>
        </>
      )}
    >
        <div className="space-y-4">
          <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-relaxed text-gray-600">
            التابات دي بتظهر جوه القسم نفسه. كل تاب بيشتغل على نفس عملاء القسم — اللي بيتغيّر
            هو اللي بيظهر فيه، ولو حدّدت مصدر هيشتغل على عملاء المصدر ده بس.
          </p>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" /> جاري التحميل...
            </div>
          ) : (
            <>
              {tabs.length === 0 && (
                <p className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
                  مفيش تابات مضافة — اضغط «إضافة تاب».
                </p>
              )}

              {tabs.map(tab => (
                <div key={tab.id} className="space-y-3 rounded-2xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[190px] flex-1">
                      <label className="mb-1 block text-xs font-bold text-gray-600">اسم التاب</label>
                      <input
                        value={tab.label}
                        maxLength={40}
                        onChange={event => patch(tab.id, { label: event.target.value })}
                        placeholder="مثال: داتا حملة سبتمبر"
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="min-w-[170px]">
                      <label className="mb-1 block text-xs font-bold text-gray-600">المصدر (اختياري)</label>
                      <input
                        value={tab.source || ''}
                        maxLength={60}
                        onChange={event => patch(tab.id, { source: event.target.value.trim() || null })}
                        placeholder="كل المصادر"
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      onClick={() => setTabs(tabs.filter(entry => entry.id !== tab.id))}
                      title="حذف التاب"
                      className="rounded-xl bg-red-50 px-3 py-2 text-red-600 hover:bg-red-100"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div>
                    <span className="mb-1.5 block text-xs font-bold text-gray-600">يظهر فيه</span>
                    <div className="flex flex-wrap gap-2">
                      {PANELS.map(panel => (
                        <label
                          key={panel}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                            tab.sections[panel]
                              ? 'border-primary-300 bg-primary-50 text-primary-700'
                              : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'}`}
                        >
                          <input
                            type="checkbox"
                            checked={tab.sections[panel]}
                            onChange={() => togglePanel(tab, panel)}
                            className="h-3.5 w-3.5 accent-primary-600"
                          />
                          {PANEL_LABELS[panel]}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={() => setTabs([...tabs, newSectionTab()])}
                disabled={tabs.length >= 12}
                className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary-200 py-3 text-sm font-bold text-primary-700 transition hover:bg-primary-50 disabled:opacity-40"
              >
                <Plus size={16} /> إضافة تاب
              </button>
            </>
          )}
        </div>

    </Modal>
  );
}
