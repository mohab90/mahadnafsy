/**
 * The tab keys that open «ملفي». `staff_home` is where every employee lands;
 * `staff_settings` and `my_hr` are the two pages it replaced, kept so
 * bookmarks, notifications and the login redirect still arrive — `my_hr` on
 * the job file it used to be.
 *
 * Its own module so the dashboard can ask without loading the page.
 */
export const PROFILE_TABS = ['staff_home', 'staff_settings', 'my_hr'] as const;
export const isProfileTab = (tab: string): boolean => (PROFILE_TABS as readonly string[]).includes(tab);
