const fs = require('fs');
const BASE = 'http://127.0.0.1:3401';
const cookie = u => fs.readFileSync(`D:/audit_tmp/perf-db/cj_${u}.txt`, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('# ')).map(l => l.replace(/^#HttpOnly_/, '').split('\t')).filter(p => p.length >= 7).map(p => `${p[5]}=${p[6].trim()}`).join('; ');
async function api(user, method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, json, text };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
(async () => {
  const code = process.argv[2] || 'CLT-1300';
  const cur = (await api('admin', 'GET', `/api/staff/client/${code}`)).json?.data;
  if (!cur) { console.log('no client'); return; }
  const changes = {
    nameEn: 'Round Trip Client', nameAr: 'عميل الاختبار الثلاثي', phone2: '01099887766', nationalId: '29001011234567', notes: 'ملاحظة العميل',
    discount: 150, nextFollowUpDate: '2026-10-30', lastFollowUp: '2026-10-12', clientStatus: 'paused', market: 'saudi',
    customPrices: { 'c-3': 2500 }, priorPaid: { 'c-3': 300 }, internalQuickNote: 'ملاحظة داخلية للعميل', assignedCsId: 'st-collection2',
    coursePlacements: { 'c-3': 'DAQQI' },
  };
  const r = await api('admin', 'POST', '/api/admin/subscribers', { ...cur, ...changes });
  console.log('save:', r.status, r.text.slice(0, 160));
  const back = (await api('admin', 'GET', `/api/staff/client/${code}`)).json?.data || {};
  for (const [k, v] of Object.entries(changes)) {
    const got = back[k]; const ok = same(got, v) || (String(got || '').startsWith(String(v)) && typeof v === 'string');
    console.log(`${ok ? 'ok  ' : 'LOST'} ${k}: sent ${JSON.stringify(v)} -> ${JSON.stringify(got)}`);
  }
  // what the save must NOT touch: the payments and enrolments
  console.log('payments kept:', (back.paymentHistory || []).length, 'of', (cur.paymentHistory || []).length, '| courses kept:', (back.enrolledCourseIds || []).length, 'of', (cur.enrolledCourseIds || []).length);
})();
