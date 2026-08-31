import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Settings } from 'lucide-react';

import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useSiteData } from '../../../context/SiteDataContext';
import { useBranches } from '../../../hooks/useBranches';
import type { LeadItem } from '../../../types';
import { DEFAULT_SOURCES } from './crmConstants';
import { ArchiveTab } from './leads/ArchiveTab';
import SectionTabsSettingsModal from './SectionTabsSettingsModal';
import {
  emptySectionTabs, normalizeSectionTabs,
  type SectionKey, type SectionTabsMap,
} from './sectionTabs';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

/**
 * The gear, the staff-built tab strip, and whichever tab is open.
 *
 * Dropped into العملاء المحتملين, الأونلاين and الدقي as one element each, and
 * self-contained on purpose: everything the panels need is already in
 * SiteDataContext, so a screen adopting this does not have to thread twenty
 * props through itself to get it. That is what keeps three very different
 * screens on one implementation instead of three that drift.
 *
 * Renders nothing at all when no tabs are configured and the viewer cannot
 * configure any — an empty strip and a gear that opens an empty dialog is worse
 * than no gear.
 */
export default function SectionCustomTabs({
  section, notify, onBook,
}: {
  section: SectionKey;
  notify: NotifyFn;
  /** What the row's book button does. Defaults to opening the client page. */
  onBook?: (lead: LeadItem) => void;
}) {
  const navigate = useNavigate();
  const branchOptions = useBranches();
  const {
    leads, staffMembers, subscribers, courses, bundles, isAdmin,
    addLead, updateLead, reloadLeads, deleteLead, addSubscriber, updateSubscriber,
  } = useSiteData();

  const [tabs, setTabs] = useState<SectionTabsMap>(emptySectionTabs);
  const [openTabId, setOpenTabId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.getSectionTabs()
      .then(data => { if (!cancelled) setTabs(normalizeSectionTabs(data)); })
      // Silent: custom tabs are an addition to the screen, and a section that
      // still works must not open with an error about furniture.
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const mine = tabs[section];
  const active = useMemo(() => mine.find(tab => tab.id === openTabId) || null, [mine, openTabId]);

  const salesReps = useMemo(
    () => staffMembers.filter(member => String(member.role || '').toLowerCase() === 'sales'),
    [staffMembers]);

  const book = useCallback((lead: LeadItem) => {
    if (onBook) return onBook(lead);
    navigate(`/dashboard/unified_client/${encodeURIComponent(lead.id)}`);
  }, [onBook, navigate]);

  if (!isAdmin && mine.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {mine.length > 0 && (
          <>
            <Layers size={15} className="text-primary-600" />
            {mine.map(tab => (
              <button
                key={tab.id}
                onClick={() => setOpenTabId(current => (current === tab.id ? null : tab.id))}
                aria-current={openTabId === tab.id ? 'page' : undefined}
                className={`rounded-xl px-3 py-1.5 text-sm font-bold transition ${
                  openTabId === tab.id
                    ? 'bg-primary-600 text-white shadow'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >
                {tab.label}
              </button>
            ))}
          </>
        )}
        {isAdmin && (
          <button
            onClick={() => setShowSettings(true)}
            title="إعدادات القسم — إضافة تاب واختيار اللي يظهر فيه"
            className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm font-bold text-gray-600 transition hover:bg-gray-50"
          >
            <Settings size={15} /> إعدادات
          </button>
        )}
      </div>

      {active && (
        <ArchiveTab
          leads={leads}
          staffMembers={staffMembers}
          subscribers={subscribers}
          courses={courses}
          bundles={bundles}
          salesReps={salesReps}
          addLead={addLead}
          updateLead={updateLead}
          reloadLeads={reloadLeads}
          deleteLead={deleteLead}
          addSubscriber={addSubscriber}
          updateSubscriber={updateSubscriber}
          navigate={navigate}
          notify={notify}
          onBook={book}
          branchOptions={branchOptions}
          sources={DEFAULT_SOURCES}
          isSalesOnly={!isAdmin}
          canManageLeads={isAdmin}
          title={active.label}
          panels={active.sections}
          // A tab pinned to a source only ever holds its own people; an unpinned
          // one works the section's whole list, which is what "إظهار داتا" with
          // no source means.
          defaultSource={active.source || undefined}
          customFilter={active.source
            ? (lead: LeadItem) => !lead.hidden && lead.source === active.source
            : (lead: LeadItem) => !lead.hidden}
        />
      )}

      {showSettings && (
        <SectionTabsSettingsModal
          section={section}
          notify={notify}
          onClose={() => setShowSettings(false)}
          onSaved={saved => {
            setTabs(saved);
            // A tab that was open and has just been deleted must not stay on
            // screen rendering against a definition that no longer exists.
            setOpenTabId(current => (saved[section].some(tab => tab.id === current) ? current : null));
          }}
        />
      )}
    </div>
  );
}
