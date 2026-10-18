/**
 * «هل في حل ان عميله بعملها لازم اعمل بعدها ريرفريش عشان تظهر؟» (7 Oct 2026).
 *
 * Every write reloads the dashboard's lists (reloadLeads / reloadSubscribers),
 * but a sales rep's, a collection officer's or a branch's screens read their own
 * scoped lists (useStaffOwnData), which were refetched every two minutes or when
 * the tab came back into view. So a booking, a payment or an edit showed for an
 * admin at once and for the staff who made it only after a refresh. A reload
 * says so, and the staff lists follow — the pattern of ROUNDS_CHANGED_EVENT.
 */
export const CRM_CHANGED_EVENT = 'crm-data-changed';

/**
 * Whether the open screen reads the person's whole lists of leads and clients. A sales rep's or a collection
 * officer's landing page, payments and «عملائي» read the server a page at a time (dashboard/staffListTabs.ts), so
 * a write there has no list to reload: reloadSubscribers only announces the change and those screens ask again,
 * instead of every payment downloading all of the person's clients through /api/admin/subscribers.
 */
let listsWanted = true;
export const setStaffListsWanted = (wanted: boolean) => { listsWanted = wanted; };
export const staffListsWanted = () => listsWanted;

export const announceCrmChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CRM_CHANGED_EVENT));
};
