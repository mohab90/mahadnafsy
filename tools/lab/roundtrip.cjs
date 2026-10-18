// Save an entity with every editable field set, read it back through the list the screens use, report what vanished.
const fs = require('fs');
const BASE = 'http://127.0.0.1:3401';
const cookie = u => fs.readFileSync(`D:/audit_tmp/perf-db/cj_${u}.txt`, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('# ')).map(l => l.replace(/^#HttpOnly_/, '').split('\t')).filter(p => p.length >= 7).map(p => `${p[5]}=${p[6].trim()}`).join('; ');
async function api(user, method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', cookie: cookie(user) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, json, text };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stamp = Date.now().toString().slice(-6);

async function lead() {
  const phone = `0102${stamp}77`;
  const sent = {
    name: `Round Trip ${stamp}`, email: `rt${stamp}@perf.test`, phone, source: 'whatsapp', status: 'interested_followup', leadType: 'online',
    interestedCourseIds: ['c-1', 'c-2'], branch: 'ONLINE_EGYPT', interestLevel: 'HIGH', assignedSalesId: 'st-sales2',
    notes: 'ملاحظة عامة', lastFollowUp: '2026-10-10', lastContactNote: 'آخر ملاحظة تواصل', nextFollowUpDate: '2026-10-25',
    promoCode: 'PROMO10', tags: ['VIP', 'مرجأ'], dealValue: 4321, waOptOut: true, internalQuickNote: 'ملاحظة داخلية',
  };
  let r = await api('admin', 'POST', '/api/admin/leads', sent);
  if (!r.json?.ok) { console.log('lead save failed', r.status, r.text.slice(0, 200)); return; }
  const id = r.json.id;
  const list = await api('admin', 'GET', `/api/admin/leads?search=${phone}`);
  const back = (Array.isArray(list.json) ? list.json : []).find(l => l.id === id);
  if (!back) { console.log('lead not in the list'); return; }
  console.log('== lead: fields saved vs read back');
  for (const [k, v] of Object.entries(sent)) {
    const got = back[k];
    const ok = same(got, v) || (k === 'nextFollowUpDate' && String(got || '').startsWith(v)) || (k === 'lastFollowUp' && String(got || '').startsWith(v)) || (k === 'interestLevel' && String(got).toLowerCase() === String(v).toLowerCase());
    console.log(`${ok ? 'ok  ' : 'LOST'} ${k}: sent ${JSON.stringify(v)} -> ${JSON.stringify(got)}`);
  }
  // an edit: change status and note, other fields must stay
  const edit = { ...back, status: 'contacted', notes: 'ملاحظة بعد التعديل' };
  r = await api('admin', 'POST', '/api/admin/leads', edit);
  const list2 = await api('admin', 'GET', `/api/admin/leads?search=${phone}`);
  const after = (Array.isArray(list2.json) ? list2.json : []).find(l => l.id === id);
  console.log('== lead: after an edit, which untouched fields changed');
  for (const k of Object.keys(sent)) if (!['status', 'notes'].includes(k) && !same(after?.[k], back[k])) console.log(`CHANGED ${k}: ${JSON.stringify(back[k])} -> ${JSON.stringify(after?.[k])}`);
  console.log('edit applied:', after?.status === 'contacted' && after?.notes === 'ملاحظة بعد التعديل');
}

(async () => { await lead(); })().catch(e => console.error('crashed', e));
