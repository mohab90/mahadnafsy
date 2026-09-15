/**
 * Every prerendered page has to be in the archive that ships.
 *
 * Release mahad-1ca54e6900a2 shipped `c/dbt/` and `course/c-1774350781908/` as
 * empty directories. generate-seo.mjs wrote both files; Windows Defender on the
 * build machine deleted them seconds later (it holds a detection pinned to
 * those two paths — the same bytes written anywhere else are left alone); and
 * tar, reaching the tree after that, packed the empty folders without a word.
 *
 * nginx serves this site with `try_files $uri $uri/ /index.html`. A missing
 * page falls through to the app shell and still works. An *empty directory*
 * does not: `$uri/` matches it, there is no index to serve, and the answer is
 * 403 Forbidden. The DBT course — «العلاج الجدلي السلوكي DBT» — answered 403 to
 * every visitor from the moment that release went out. Nothing checked.
 *
 * So the check runs on the finished archive, not on disk: disk was fine when
 * the generator looked, and wrong by the time tar did.
 */

const PAGE_ROOTS = ['c', 'course', 'bundle'];

function normalise(entry) {
  return String(entry || '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

/**
 * @param {string[]} entries   names as `tar -tzf` lists them
 * @param {string}   sitemapXml the sitemap.xml carried in the same archive
 * @param {string}   site       the canonical origin the sitemap uses
 * @returns {{ emptyDirectories: string[], missingFromSitemap: string[] }}
 */
export function findMissingPages(entries, sitemapXml = '', site = 'https://mahadnafsy.com') {
  const names = new Set(entries.map(normalise).filter(Boolean));

  // 1. A page directory with no index.html — the 403 case.
  const dirs = new Set();
  for (const name of names) {
    const parts = name.split('/').filter(Boolean);
    if (parts.length >= 2 && PAGE_ROOTS.includes(parts[0])) dirs.add(`${parts[0]}/${parts[1]}`);
  }
  const emptyDirectories = [...dirs].filter(dir => !names.has(`${dir}/index.html`)).sort();

  // 2. A page the sitemap promises that the archive does not carry at all. That
  //    one degrades to the app shell rather than 403, but the sitemap is telling
  //    Google the page exists, so it is still a broken release.
  const origin = String(site).replace(/\/$/, '');
  const missingFromSitemap = [];
  for (const match of String(sitemapXml).matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const loc = match[1].trim();
    if (!loc.startsWith(origin)) continue;
    const pathPart = loc.slice(origin.length).replace(/^\//, '').replace(/\/$/, '');
    const parts = pathPart.split('/');
    if (parts.length !== 2 || !PAGE_ROOTS.includes(parts[0])) continue;
    if (!names.has(`${pathPart}/index.html`)) missingFromSitemap.push(pathPart);
  }

  return { emptyDirectories, missingFromSitemap: missingFromSitemap.sort() };
}

export function describeMissing({ emptyDirectories, missingFromSitemap }) {
  const lines = [];
  if (emptyDirectories.length) {
    lines.push(`${emptyDirectories.length} prerendered page(s) shipped as an EMPTY directory — nginx answers 403 for these:`);
    for (const dir of emptyDirectories) lines.push(`  /${dir}`);
  }
  if (missingFromSitemap.length) {
    lines.push(`${missingFromSitemap.length} page(s) in sitemap.xml are not in the archive:`);
    for (const page of missingFromSitemap) lines.push(`  /${page}`);
  }
  if (lines.length) {
    lines.push('');
    lines.push('The generator wrote these, so something removed them before tar ran. On Windows,');
    lines.push('check Windows Security → Protection history for client\\dist paths.');
  }
  return lines.join('\n');
}
