'use strict';
/**
 * Strips the residue Microsoft Word leaves behind when a description is pasted
 * from a .doc into the course editor.
 *
 * What it removes, and why each one matters:
 *   <o:p>            Word's own namespace tag. No browser renders it; it just
 *                    sits in the markup.
 *   font-family      Word writes these already broken — `Times New Roman&quot;;`
 *   font-size        with no opening quote, and `MS Gothic&quot;;` repeated
 *                    three times — so the declaration is invalid anyway. Pinning
 *                    a Latin serif on Arabic text also overrides the site's own
 *                    Arabic face.
 *   color:black      A hardcoded colour that is unreadable in dark mode.
 *   mso-*            Word-only properties no browser reads.
 *   <style>/<xml>    Word's block-level dumps, when present.
 *
 * What it keeps: the text, the paragraph and span structure, <b>/<strong>, and
 * every direction attribute — dir="RTL", direction:rtl, unicode-bidi — because
 * dropping those would reflow Arabic text into the wrong order.
 *
 * Dry run:  node api/tools/clean-word-markup.cjs <courseId>
 * Apply:    node api/tools/clean-word-markup.cjs <courseId> --apply
 */

require('dotenv').config();

const DROPPED_PROPERTIES = /^(?:mso-[a-z-]+|font-family|font-size|color)$/i;

function cleanStyleAttribute(style) {
  const kept = String(style || '')
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(declaration => {
      const colon = declaration.indexOf(':');
      // Word leaves bare fragments with no property at all — the tail of a
      // font-family whose opening quote it dropped, e.g. Times New Roman&quot;.
      // A declaration with no name is not a declaration; nothing renders it.
      if (colon < 1) return false;
      const property = declaration.slice(0, colon).trim();
      if (DROPPED_PROPERTIES.test(property)) return false;
      return declaration.slice(colon + 1).trim() !== '';
    });
  return kept.join('; ');
}

function cleanWordMarkup(html) {
  return String(html || '')
    // Word's block dumps, if this paste carried them.
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<xml[\s\S]*?<\/xml>/gi, '')
    // <o:p></o:p>, <o:p/>, and any other o:-namespaced tag.
    .replace(/<\/?o:[^>]*>/gi, '')
    // Word's class hooks carry no styling here once the <style> block is gone.
    .replace(/\s*class="Mso[^"]*"/gi, '')
    // Rewrite each style attribute, dropping only the declarations above.
    .replace(/\sstyle="([^"]*)"/gi, (match, style) => {
      const cleaned = cleanStyleAttribute(style);
      return cleaned ? ` style="${cleaned}"` : '';
    })
    // A span that carried nothing but the styling we just removed.
    .replace(/<span(?:\s+lang="[^"]*")?(?:\s+dir="[^"]*")?>([\s\S]*?)<\/span>/gi, '$1')
    // Word wraps every line; collapse the runs of whitespace it leaves behind.
    .replace(/[ \t]*\r?\n[ \t]*/g, ' ')
    .replace(/ {2,}/g, ' ')
    // Deliberately NOT collapsing whitespace between tags. It reads like tidying,
    // but Word puts the ✔ marks in their own <span dir="LTR"> elements and the
    // space before each one is a real space in the sentence: removing it turned
    // "بدقة ✔ قيادة" into "بدقة✔قيادة". The safety check below caught it.
    .trim();
}

async function main() {
  const [courseId, ...flags] = process.argv.slice(2);
  if (!courseId) {
    console.error('usage: node api/tools/clean-word-markup.cjs <courseId> [--apply]');
    process.exit(1);
  }
  const apply = flags.includes('--apply');
  const { pool } = require('../lib/db');

  const [[course]] = await pool.query(
    'SELECT id, title, slug, description FROM courses WHERE id=? AND deleted_at IS NULL LIMIT 1',
    [courseId]
  );
  if (!course) {
    console.error(`course ${courseId} not found`);
    process.exit(1);
  }

  const before = course.description || '';
  const after = cleanWordMarkup(before);

  console.log(`course : ${course.title}`);
  console.log(`slug   : ${course.slug}`);
  console.log(`length : ${before.length} -> ${after.length}`);
  console.log(`<o:p>  : ${(before.match(/<o:p/gi) || []).length} -> ${(after.match(/<o:p/gi) || []).length}`);
  console.log(`mso-   : ${(before.match(/mso-/gi) || []).length} -> ${(after.match(/mso-/gi) || []).length}`);
  console.log(`&quot; : ${(before.match(/&quot;/g) || []).length} -> ${(after.match(/&quot;/g) || []).length}`);
  console.log('--- after (first 600) ---');
  console.log(after.slice(0, 600));

  // The visible text must survive untouched — that is the whole safety property.
  const textOf = html => String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const sameText = textOf(before) === textOf(after);
  console.log(`--- visible text unchanged: ${sameText} ---`);
  if (!sameText) {
    console.error('REFUSING: the cleaner altered the visible text, not just the markup.');
    process.exit(1);
  }

  if (!apply) {
    console.log('\ndry run — pass --apply to write it');
    process.exit(0);
  }
  await pool.query('UPDATE courses SET description=? WHERE id=?', [after, courseId]);
  console.log('\napplied');
  process.exit(0);
}

// Only when run as a script — the cleaner itself is imported by the tests,
// which must not open a database connection to check a regex.
if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}

module.exports = { cleanWordMarkup, cleanStyleAttribute };
