/**
 * Which learning paths the home page shows: three, and not the long programme
 * («دبلومة العلاج النفسي المتكامل — دراسة سنة ونص»), which has its own page and
 * would crowd out the shorter paths that are easier to start with. The full
 * list is one click away on /bundles.
 */
export const HOME_PATHS_MAX = 3;
export const HOME_PATHS_HIDDEN_TITLES = ['العلاج النفسي المتكامل'];

export function bundlesForHome<T extends { title?: string }>(bundles: T[]): T[] {
  return bundles
    .filter(bundle => !HOME_PATHS_HIDDEN_TITLES.some(part => String(bundle.title || '').includes(part)))
    .slice(0, HOME_PATHS_MAX);
}
