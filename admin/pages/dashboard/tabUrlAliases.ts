import type { TabKey } from './navigation';

/**
 * What a tab is called in the address bar, when that differs from its key.
 *
 * عملائي is every client an employee is responsible for — online, Daqqi, Saudi,
 * international — so `online_clients` describes a filter the screen no longer
 * applies. The URL says what the screen is; the key stays as it is because it
 * is referenced in twelve places (loading sets, permission gates, notification
 * targets, three role bars) and renaming it everywhere would be a much larger
 * change than the one being asked for.
 *
 * `subscribers` is an older spelling that has been redirecting here for a while.
 */
const TAB_TO_URL: Partial<Record<TabKey, string>> = {
  online_clients: 'my_clients',
};

const URL_TO_TAB: Record<string, TabKey> = {
  my_clients: 'online_clients',
  subscribers: 'online_clients',
  online_clients: 'online_clients',
};

/** The address-bar spelling for a tab key. */
export const urlForTab = (tab: TabKey): string => TAB_TO_URL[tab] || tab;

/** The tab key a URL segment names, or the segment itself when it is already one. */
export const tabForUrl = (segment: string | undefined): TabKey =>
  (segment && URL_TO_TAB[segment]) || (segment as TabKey);

/**
 * The canonical URL segment for whatever the address bar currently says.
 * When it differs from what was typed, the caller rewrites the URL — so
 * /dashboard/online_clients lands on /dashboard/my_clients and old links keep
 * working.
 */
export const urlToTabAlias = (segment: string | undefined): string | undefined =>
  segment ? urlForTab(tabForUrl(segment)) : segment;
