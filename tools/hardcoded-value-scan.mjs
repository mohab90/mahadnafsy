// REV-5 — business values baked into the code that the owner would expect to be
// editable: phone/WhatsApp numbers, contact emails, prices and currency amounts,
// and outbound links. A hardcoded one cannot be changed from the panel at all,
// which is the strongest form of "مش دينامك".
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};
const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');

const PATTERNS = [
  ['رقم واتساب / موبايل', /['"`](?:\+?2?01[0-9]{9}|9665[0-9]{8}|\+9665[0-9]{8})['"`]/g],
  ['رابط wa.me مباشر',   /wa\.me\/(\d{8,})/g],
  ['إيميل تواصل',         /['"`][a-z0-9._%-]+@(?:mahadnafsy|gmail|hotmail|outlook)\.[a-z.]{2,}['"`]/gi],
  ['سعر بالجنيه',         /['"`]\s*\d{3,6}\s*(?:ج\.م|جنيه|EGP)\s*['"`]/g],
  ['رقم حساب / محفظة',    /['"`]\s*(?:\d{4}[ -]?){3,}\d{2,}\s*['"`]/g],
];

const ALLOW = [
  /\.test\.|__tests__|\.stories\./,
  /placeholder/i,       // sample text in an input is not a business value
];

const findings = new Map(); // label -> [{file,line,text}]
for (const app of ['client', 'admin']) {
  for (const f of walk(path.join(ROOT, app))) {
    if (ALLOW.some(re => re.test(f))) continue;
    const src = fs.readFileSync(f, 'utf8');
    const lines = src.split('\n');
    for (const [label, re] of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const lineNo = src.slice(0, m.index).split('\n').length;
        const line = lines[lineNo - 1] || '';
        // A value that sits next to a content[...] lookup is already the fallback
        // for an editable key — that is the correct pattern, not a finding.
        if (/content\s*\[|content\?\.\[/.test(line)) continue;
        if (/placeholder|example|e\.g\.|TODO|sample/i.test(line)) continue;
        if (!findings.has(label)) findings.set(label, []);
        findings.get(label).push({ file: rel(f), line: lineNo, text: line.trim().slice(0, 130) });
      }
    }
  }
}

console.log('═'.repeat(78));
console.log('REV-5  قيم تجارية متحجّرة في الكود (مش قابلة للتعديل من اللوحة)');
console.log('═'.repeat(78));
let total = 0;
for (const [label, hits] of findings) {
  console.log(`\n── ${label}: ${hits.length}`);
  for (const h of hits) { console.log(`  ${h.file}:${h.line}\n      ${h.text}`); total++; }
}
if (!total) console.log('\n  لا يوجد.');
console.log(`\nالإجمالي: ${total}`);
