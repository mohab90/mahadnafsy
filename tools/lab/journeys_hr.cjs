// Recruitment journey: application -> interview -> hire, for both forms, checking every list a person would look in.
const fs = require('fs');
const BASE = 'http://127.0.0.1:3401';
const cookie = u => fs.readFileSync(`D:/audit_tmp/perf-db/cj_${u}.txt`, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('# ')).map(l => l.replace(/^#HttpOnly_/, '').split('\t')).filter(p => p.length >= 7).map(p => `${p[5]}=${p[6].trim()}`).join('; ');
async function api(user, method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(user ? { cookie: cookie(user) } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, json, text };
}
const rows = r => Array.isArray(r.json) ? r.json : (r.json?.rows || r.json?.items || r.json?.data || []);
let pass = 0, fail = 0;
const check = (what, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  [hr] ${what}${ok ? '' : '  — ' + detail}`); };
const stamp = Date.now().toString().slice(-6);

(async () => {
  for (const form of ['staff', 'teaching']) {
    const phone = `0106${stamp}${form === 'staff' ? '11' : '12'}`;
    const name = `HR ${form} ${stamp}`;
    const email = `hr${form}${stamp}@x.com`;
    let r = await api(null, 'POST', '/api/join-us', { name, phone, email, specialty: 'تخصص', type: form === 'staff' ? 'EMPLOYEE' : 'INSTRUCTOR', form, lecturedBefore: 'yes', sessionsBefore: 'yes', message: 'm' });
    check(`${form}: the application is accepted`, r.status === 200, r.text.slice(0, 120));
    const inbox = async () => rows(await api('hr1', 'GET', `/api/admin/join-us?paged=1&inbox=1&form=${form}&search=${phone}`));
    const app = (await inbox()).find(a => String(a.name).includes(name));
    check(`${form}: it is in the HR inbox of its own form`, Boolean(app));
    if (!app) continue;
    const at = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10) + ' 15:00:00';
    r = await api('hr1', 'POST', `/api/admin/hr/join-us/${app.id}/to-interview`, { interviewAt: at });
    check(`${form}: hr moves it to interview`, r.status === 200, `${r.status} ${r.text.slice(0, 160)}`);
    check(`${form}: it leaves the applications inbox`, !(await inbox()).some(a => a.id === app.id));
    const applicantId = r.json?.applicantId || r.json?.id || r.json?.applicant?.id;
    const ivUrl = (f, tab = 'scheduled') => `/api/admin/hr/interviews?tab=${tab}&form=${f}&limit=50&search=${phone}`;
    const iv = await api('hr1', 'GET', ivUrl(form));
    check(`${form}: it appears in the interviews list (not yet held)`, JSON.stringify(rows(iv)).includes(name), `${iv.status} ${rows(iv).length} ${iv.text.slice(0, 80)}`);
    const other = form === 'staff' ? 'teaching' : 'staff';
    const iv2 = await api('hr1', 'GET', ivUrl(other));
    check(`${form}: and not in the other form's interviews`, !JSON.stringify(rows(iv2)).includes(name));
    const sum = await api('hr1', 'GET', `/api/admin/hr/interviews/summary?tab=scheduled&form=${form}`);
    check(`${form}: the interviews summary answers`, sum.status === 200, `${sum.status}`);
    if (!applicantId) { check(`${form}: the move returned an applicant id`, false, JSON.stringify(r.json)); continue; }
    r = await api('hr1', 'POST', `/api/admin/hr/applicants/${applicantId}/hire`, { name, email, phone, role: 'SUPPORT', jobTitle: 'موظف' });
    check(`${form}: hr hires the candidate`, r.status === 200 || r.status === 201, `${r.status} ${r.text.slice(0, 220)}`);
    const staff = await api('hr1', 'GET', '/api/admin/staff');
    const sj = JSON.stringify(rows(staff));
    check(`${form}: the new hire is in the staff list`, sj.includes(name) || sj.includes(email), `${rows(staff).length} staff`);
    const iv3 = await api('hr1', 'GET', ivUrl(form));
    check(`${form}: a hired candidate leaves the interviews list`, !JSON.stringify(rows(iv3)).includes(name), 'still listed');
  }
  console.log(`\n${pass}/${pass + fail} passed`);
})().catch(e => { console.error('crashed', e); process.exit(1); });
