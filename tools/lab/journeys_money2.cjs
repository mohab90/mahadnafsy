// Corrections: edit and void a payment, and check that every place that shows money follows.
const fs = require('fs');
const mysql = require(require('path').join(__dirname, '..', '..', 'api', 'node_modules', 'mysql2', 'promise'));
const BASE = 'http://127.0.0.1:3401';
const cookie = u => fs.readFileSync(`D:/audit_tmp/perf-db/cj_${u}.txt`, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('# ')).map(l => l.replace(/^#HttpOnly_/, '').split('\t')).filter(p => p.length >= 7).map(p => `${p[5]}=${p[6].trim()}`).join('; ');
async function api(user, method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(user ? { cookie: cookie(user) } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, json, text };
}
const rows = r => Array.isArray(r.json) ? r.json : (r.json?.rows || r.json?.items || r.json?.data || []);
let pass = 0, fail = 0;
const check = (what, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  [money2] ${what}${ok ? '' : '  — ' + detail}`); };
const stamp = Date.now().toString().slice(-6);
const today = new Date().toISOString().slice(0, 10);

(async () => {
  const db = await mysql.createConnection({ host: '127.0.0.1', port: 3397, user: 'root', password: 'perf_root_local', database: 'mahad_perf' });
  const q = async (sql, p) => (await db.query(sql, p))[0];
  const [sub] = await q("select id, client_code from subscribers where assigned_sales_id='st-sales1' and id like 's-2__' order by rand() limit 1");
  const page = async () => (await api('admin', 'GET', `/api/staff/client/${sub.client_code}`)).json?.data || {};
  const register = async () => rows(await api('admin', 'GET', '/api/admin/finance/payments-register'));
  const tx = `COR-${stamp}`;
  let r = await api('admin', 'POST', '/api/admin/subscriber-payments', { subscriber_id: sub.id, payment: { amount: 2000, currency: 'EGP', status: 'paid', paymentMethod: 'TRANSFER', transactionId: tx, courseId: 'c-11', paymentType: 'course', isInstallment: false, courseExpected: 4000, date: today } });
  check('admin records a payment', r.status === 200 && r.json?.ok, r.text.slice(0, 140));
  const payId = r.json?.id;
  const rev0 = (await api('admin', 'GET', '/api/admin/overview/revenue')).json?.todayEgp;
  let h = (await page()).paymentHistory || [];
  check('it is on the client page', h.some(p => p.id === payId && p.amount === 2000));

  // edit: 2000 -> 1800
  r = await api('admin', 'PATCH', `/api/admin/payments/${payId}`, { amount: 1800, reason: 'خطأ في الكتابة', transactionId: tx, courseId: 'c-11' });
  check('admin corrects the amount with a reason', r.status === 200 && r.json?.ok, `${r.status} ${r.text.slice(0, 200)}`);
  h = (await page()).paymentHistory || [];
  const live = h.filter(p => p.transactionId === tx);
  check('the client page shows one payment for it, at the new amount', live.length === 1 && live[0].amount === 1800, JSON.stringify(live.map(p => [p.id.slice(0, 6), p.amount, p.status])));
  const reg = (await register()).filter(p => (p.transaction_id || p.transactionId) === tx);
  check('the accounting register shows one row at the new amount', reg.length === 1 && Number(reg[0].amount) === 1800, JSON.stringify(reg.map(p => [p.amount, p.status])));
  const rev1 = (await api('admin', 'GET', '/api/admin/overview/revenue')).json?.todayEgp;
  check('today\'s revenue went down by the 200 difference', Math.round(rev0 - rev1) === 200, `${rev0} -> ${rev1}`);
  const newId = live[0]?.id;
  const unbalanced = (await q("select count(*) n from journal_entries je join journal_entry_lines l on l.entry_id=je.id where je.ref_id in (?,?) group by je.id having abs(sum(l.debit)-sum(l.credit))>0.01", [payId, newId || 'x'])).length;
  check('the journal entries of both payments balance', unbalanced === 0, `${unbalanced} unbalanced`);

  // void
  r = await api('admin', 'DELETE', `/api/admin/payments/${newId}`, { reason: 'تسجيل بالغلط' });
  check('admin voids the payment', r.status === 200 && r.json?.ok, `${r.status} ${r.text.slice(0, 200)}`);
  h = (await page()).paymentHistory || [];
  check('the client page no longer lists it', !h.some(p => p.transactionId === tx), JSON.stringify(h.filter(p => p.transactionId === tx)));
  const reg2 = (await register()).filter(p => (p.transaction_id || p.transactionId) === tx);
  check('the register no longer lists it', reg2.length === 0, `${reg2.length} rows`);
  const rev2 = (await api('admin', 'GET', '/api/admin/overview/revenue')).json?.todayEgp;
  check('today\'s revenue is back to what it was before the payment', Math.round(rev2 - (rev0 - 2000)) === 0, `${rev0} -> ${rev2}`);
  const access = (await q("select count(*) n from enrollments where subscriber_id=? and course_id='c-11' and status='active'", [sub.id]))[0].n;
  check('the course access follows (not active for a voided payment)', access === 0, `active enrollments ${access}`);
  const recon = await api('admin', 'GET', '/api/admin/reconciliation-dashboard');
  check('reconciliation does not flag the voided payment', !JSON.stringify(recon.json?.checks || []).includes(newId || 'x'), 'flagged');
  const audit = (await q("select count(*) n from payment_audit_log where payment_id in (?,?)", [payId, newId || 'x']))[0].n;
  check('the audit log recorded the correction and the void', audit >= 2, `audit rows ${audit}`);
  console.log(`\n${pass}/${pass + fail} passed`);
  await db.end();
})().catch(e => { console.error('crashed', e); process.exit(1); });
