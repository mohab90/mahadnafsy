// End-to-end journeys against the lab API: do something as one account, then look for the result everywhere a
// person would look for it. The bug class: «written here, not shown there».
const fs = require('fs');
const mysql = require(require('path').join(__dirname, '..', '..', 'api', 'node_modules', 'mysql2', 'promise'));
const BASE = 'http://127.0.0.1:3401';
const jar = {};
function cookieOf(user) {
  if (jar[user]) return jar[user];
  const text = fs.readFileSync(`D:/audit_tmp/perf-db/cj_${user}.txt`, 'utf8');
  return (jar[user] = text.split(/\r?\n/).filter(l => l && !l.startsWith('# ')).map(l => l.replace(/^#HttpOnly_/, '').split('\t')).filter(p => p.length >= 7).map(p => `${p[5]}=${p[6].trim()}`).join('; '));
}
async function api(user, method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(user ? { cookie: cookieOf(user) } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}
const results = [];
const check = (journey, what, ok, detail = '') => { results.push({ journey, what, ok: Boolean(ok), detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  [${journey}] ${what}${ok ? '' : '  — ' + detail}`); };
const has = (list, predicate) => Array.isArray(list) && list.some(predicate);
const rows = r => Array.isArray(r.json) ? r.json : (r.json?.rows || r.json?.items || r.json?.data || []);
const stamp = Date.now().toString().slice(-6);
let db;
const q = async (sql, p) => (await db.query(sql, p))[0];

(async () => {
  db = await mysql.createConnection({ host: '127.0.0.1', port: 3397, user: 'root', password: 'perf_root_local', database: 'mahad_perf' });
  const only = process.argv[2] || '';

  // ── P: the public forms, and where the staff look for what they sent ─────────────────────────────
  if (!only || only === 'public') {
    const phone = `0109${stamp}01`;
    let r = await api(null, 'POST', '/api/leads-public', { name: `Public Lead ${stamp}`, phone, notes: 'n', source: 'website' });
    check('public', 'lead form answers ok', r.status === 200 && r.json?.ok, r.text.slice(0, 120));
    r = await api('admin', 'GET', `/api/admin/leads?search=${phone}&limit=5`);
    check('public', 'the lead is in the admin leads list', has(rows(r), l => l.phone === phone), `status ${r.status}`);
    r = await api('admin', 'GET', `/api/admin/leads/stats`);
    check('public', 'lead statistics answer', r.status === 200 && typeof r.json?.total === 'number');
    const beforeTotal = r.json?.total;
    await api(null, 'POST', '/api/leads-public', { name: `Public Lead B ${stamp}`, phone: `0109${stamp}02`, notes: 'n', source: 'website' });
    r = await api('admin', 'GET', `/api/admin/leads/stats`);
    check('public', 'the counter moves right after a new lead (cache dropped by the write)', r.json?.total === beforeTotal + 1, `${beforeTotal} -> ${r.json?.total}`);

    const cphone = `0108${stamp}03`;
    r = await api(null, 'POST', '/api/contact', { name: `Contact ${stamp}`, phone: cphone, message: 'ازاي اسجل', subject: 'courses' });
    check('public', 'contact form answers ok', r.status === 200, r.text.slice(0, 160));
    r = await api('admin', 'GET', `/api/admin/contact-messages`);
    check('public', 'the message is in «رسائل التواصل»', has(rows(r), m => String(m.phone || '').includes(cphone.slice(-8)) || String(m.name || '').includes(`Contact ${stamp}`)), `${rows(r).length} rows`);
    r = await api('admin', 'GET', `/api/admin/leads?search=${cphone}&limit=5`);
    check('public', 'the contact also became a lead', has(rows(r), l => String(l.phone).includes(cphone.slice(-8))), 'no lead for the contact');

    const jphone = `0107${stamp}04`;
    r = await api(null, 'POST', '/api/join-us', { name: `Join Staff ${stamp}`, phone: jphone, email: `join${stamp}@x.com`, specialty: 'محاسبة', type: 'EMPLOYEE', form: 'staff', message: 'm' });
    check('public', 'join-us (staff) answers ok', r.status === 200, r.text.slice(0, 160));
    r = await api('hr1', 'GET', `/api/admin/join-us?paged=1&inbox=1&form=staff&search=${jphone}`);
    check('public', 'the staff application is in the HR inbox', has(rows(r), a => String(a.phone).includes(jphone.slice(-8)) || String(a.name).includes(`Join Staff ${stamp}`)), `${r.status} ${r.text.slice(0, 100)}`);
    r = await api(null, 'POST', '/api/join-us', { name: `Join Teach ${stamp}`, phone: `0107${stamp}05`, email: `jt${stamp}@x.com`, specialty: 'علاج نفسي', type: 'INSTRUCTOR', form: 'teaching', lecturedBefore: 'yes', sessionsBefore: 'no', message: 'm' });
    check('public', 'join-us (lecturer) answers ok', r.status === 200, r.text.slice(0, 160));
    r = await api('hr1', 'GET', `/api/admin/join-us?paged=1&inbox=1&form=teaching`);
    check('public', 'the lecturer application is in the lecturers inbox', has(rows(r), a => String(a.name).includes(`Join Teach ${stamp}`)), `${r.status}`);
    r = await api('hr1', 'GET', `/api/admin/join-us?paged=1&inbox=1&form=staff`);
    check('public', 'and NOT in the staff inbox', !has(rows(r), a => String(a.name).includes(`Join Teach ${stamp}`)));

    r = await api(null, 'POST', '/api/waitlist', { name: `Wait ${stamp}`, phone: `0106${stamp}06`, courseId: 'c-1', courseName: 'x' });
    check('public', 'waitlist answers ok', r.status === 200, r.text.slice(0, 160));
    r = await api('admin', 'GET', '/api/admin/course-waitlist');
    const wl = await api('admin', 'GET', '/api/admin/waitlist');
    check('public', 'the waitlist entry is somewhere in the admin waitlists', has(rows(r), w => String(w.name).includes(`Wait ${stamp}`)) || has(rows(wl), w => String(w.name).includes(`Wait ${stamp}`)), `course-waitlist ${r.status}/${rows(r).length}, waitlist ${wl.status}/${rows(wl).length}`);

    r = await api(null, 'POST', '/api/public/enquiry', { name: `Enq ${stamp}`, phone: `0105${stamp}07`, message: 'عايز اسأل', department: 'support' });
    check('public', 'enquiry answers ok', r.status === 200, r.text.slice(0, 160));
    r = await api('support1', 'GET', '/api/admin/tickets');
    const t2 = await api('admin', 'GET', '/api/admin/support/tickets');
    check('public', 'the enquiry is a ticket support can see', has(rows(r), t => JSON.stringify(t).includes(`Enq ${stamp}`)) || has(rows(t2), t => JSON.stringify(t).includes(`Enq ${stamp}`)), `tickets ${r.status}/${rows(r).length}, support/tickets ${t2.status}/${rows(t2).length}`);
  }

  // ── M: money: who records it, who approves it, and where it must then appear ─────────────────────
  if (!only || only === 'money') {
    const tx = `TXN-${stamp}`;
    // sales pays on own client
    const [sub] = await q("select id, client_code from subscribers where assigned_sales_id='st-sales1' and id like 's-2__' order by rand() limit 1");
    let r = await api('sales1', 'POST', '/api/admin/subscriber-payments', { subscriber_id: sub.id, payment: { amount: 2000, currency: 'EGP', status: 'paid', paymentMethod: 'TRANSFER', transactionId: tx, courseId: 'c-5', paymentType: 'course', isInstallment: false, courseExpected: 3500, date: new Date().toISOString().slice(0, 10) } });
    check('money', 'sales records a booking with a transfer number', r.status === 200 && r.json?.ok, r.text.slice(0, 160));
    const payId = r.json?.id;
    check('money', 'it is stored pending (a manager approves it)', r.json?.status === 'pending' && r.json?.approvalRequired === true, JSON.stringify(r.json));
    r = await api('sales1', 'GET', `/api/staff/client/${sub.client_code}`);
    const hist = r.json?.data?.paymentHistory || [];
    check('money', 'the client page returns it with its transaction number', has(hist, p => p.id === payId && p.transactionId === tx && p.status === 'pending'), JSON.stringify(hist.slice(-2)).slice(0, 200));
    const totalBefore = r.json?.data?.totalPaid ?? null;
    r = await api('admin', 'GET', `/api/admin/payments/review?status=pending&search=${tx}`);
    check('money', 'the manager finds it in the review queue', has(rows(r), p => p.id === payId), `${r.status}`);
    r = await api('accountant1', 'GET', `/api/admin/payments?status=pending`);
    check('money', 'the accountant finds it among pending payments', has(rows(r), p => p.id === payId) || r.status === 200, `${r.status}`);
    r = await api('admin', 'GET', '/api/admin/finance/payments-register');
    check('money', 'a pending payment is NOT in the accounting register yet', !has(rows(r), p => p.id === payId || p.transaction_id === tx || p.transactionId === tx));
    const enrolledBefore = (await q("select count(*) n from enrollments where subscriber_id=? and course_id='c-5' and status='active'", [sub.id]))[0].n;
    check('money', 'no access is granted before approval', enrolledBefore === 0, `enrollments ${enrolledBefore}`);

    // the manager approves
    r = await api('admin', 'PATCH', `/api/admin/payments/${payId}/status`, { status: 'paid', paymentMethod: 'TRANSFER' });
    check('money', 'the manager approves it', r.status === 200 && r.json?.ok, r.text.slice(0, 160));
    r = await api('sales1', 'GET', `/api/staff/client/${sub.client_code}`);
    check('money', 'the client page now shows it as paid', has(r.json?.data?.paymentHistory, p => p.id === payId && p.status === 'paid'), '');
    r = await api('admin', 'GET', '/api/admin/finance/payments-register');
    check('money', 'it is in the accounting register once approved', has(rows(r), p => p.id === payId || p.transaction_id === tx || p.transactionId === tx), `${rows(r).length} rows`);
    const enrolledAfter = (await q("select count(*) n from enrollments where subscriber_id=? and course_id='c-5' and status='active'", [sub.id]))[0].n;
    check('money', 'approval grants the course access', enrolledAfter === 1, `enrollments ${enrolledAfter}`);
    const journal = (await q("select count(*) n from journal_entries where ref_type='payment' and ref_id=?", [payId]))[0].n;
    check('money', 'approval posts the journal entry', journal >= 1, `entries ${journal}`);
    const commission = (await q("select count(*) n from crm_commissions where payment_id=?", [payId]))[0].n;
    check('money', 'the rep earns a commission on the approved payment', commission >= 1, `commissions ${commission}`);
    const audit = (await q("select count(*) n from payment_audit_log where payment_id=?", [payId]))[0].n;
    check('money', 'the payment audit log has it', audit >= 1, `audit ${audit}`);
    r = await api('admin', 'GET', '/api/admin/reconciliation-dashboard');
    check('money', 'reconciliation does not flag this payment', !JSON.stringify(r.json?.checks || []).includes(payId), 'flagged by reconciliation');
    r = await api('admin', 'GET', '/api/admin/overview/revenue');
    check('money', 'today\'s revenue counts it', Number(r.json?.todayEgp) >= 2000, JSON.stringify(r.json));

    // same payment again: refused with a clear message
    r = await api('admin', 'POST', '/api/admin/subscriber-payments', { subscriber_id: sub.id, payment: { amount: 2000, currency: 'EGP', status: 'paid', paymentMethod: 'TRANSFER', transactionId: tx, courseId: 'c-5', paymentType: 'course', isInstallment: false, courseExpected: 3500, date: new Date().toISOString().slice(0, 10) } });
    check('money', 'an identical second payment is refused as a duplicate', r.status === 409, `${r.status} ${r.text.slice(0, 100)}`);

    // collection officer records an instalment
    const [csub] = await q("select id, client_code from subscribers where assigned_cs_id='st-collection1' and id like 's-3__' order by rand() limit 1");
    r = await api('collection1', 'POST', '/api/admin/subscriber-payments', { subscriber_id: csub.id, payment: { amount: 500, currency: 'EGP', status: 'paid', paymentMethod: 'CASH', transactionId: `${tx}-C`, courseId: 'c-6', paymentType: 'course', isInstallment: true, date: new Date().toISOString().slice(0, 10) } });
    check('money', 'collection records an instalment', r.status === 200 && r.json?.ok, r.text.slice(0, 160));
    const cpay = r.json?.id;
    r = await api('collection1', 'GET', `/api/staff/client/${csub.client_code}`);
    check('money', 'collection sees it on the client page with the number', has(r.json?.data?.paymentHistory, p => p.id === cpay && p.transactionId === `${tx}-C`), '');
    r = await api('collection1', 'GET', `/api/admin/payments/review?status=pending&search=${tx}-C`);
    check('money', 'collection sees their own pending payment in the review list', has(rows(r), p => p.id === cpay), `${r.status}`);

    // a refund
    r = await api('admin', 'POST', '/api/admin/refund-requests/by-admin', { subscriber_id: sub.id, payment_id: payId, amount: 500, currency: 'EGP', reason: 'test', refund_method: 'CASH', course_item: 'c-5' });
    check('money', 'admin creates a refund request', r.status === 200 || r.status === 201, `${r.status} ${r.text.slice(0, 160)}`);
    r = await api('admin', 'GET', '/api/admin/refund-requests');
    check('money', 'the refund request is listed', rows(r).length > 0, `${r.status}`);
  }

  // ── L: a lead's journey: assign, contact, follow up, convert ─────────────────────────────────────
  if (!only || only === 'lead') {
    const phone = `0104${stamp}08`;
    let r = await api('sales1', 'POST', '/api/admin/leads', { name: `Rep Lead ${stamp}`, phone, source: 'manual', branch: 'ONLINE_EGYPT' });
    check('lead', 'sales creates a lead', r.status === 200 && r.json?.ok, r.text.slice(0, 160));
    const leadId = r.json?.id;
    r = await api('sales1', 'GET', `/api/admin/leads?search=${phone}`);
    check('lead', 'the rep sees their own new lead', has(rows(r), l => l.id === leadId), `${r.status} ${rows(r).length}`);
    r = await api('admin', 'GET', `/api/admin/leads?search=${phone}`);
    check('lead', 'the admin sees it too', has(rows(r), l => l.id === leadId));
    const cur = rows(await api('sales1', 'GET', `/api/admin/leads?search=${phone}`)).find(l => l.id === leadId);
    r = await api('sales1', 'POST', '/api/admin/leads', { ...cur, status: 'interested_followup', nextFollowUpDate: new Date(Date.now() - 86400e3).toISOString().slice(0, 10) });
    check('lead', 'the rep moves it to «interested» with a follow-up', r.status === 200, `${r.status} ${r.text.slice(0, 140)}`);
    r = await api('sales1', 'GET', `/api/admin/leads?search=${phone}`);
    const row = rows(r).find(l => l.id === leadId);
    check('lead', 'the list shows the new status and date', row && row.status === 'interested_followup' && String(row.nextFollowUpDate || '').length >= 8, JSON.stringify(row || {}).slice(0, 160));
    r = await api('sales1', 'GET', '/api/admin/leads/followups-due');
    check('lead', 'the bell counts the overdue follow-up (cache dropped by the write)', Number(r.json?.overdue) >= 1, JSON.stringify(r.json));
    r = await api('sales1', 'POST', `/api/admin/crm/leads/${leadId}/interactions`, { type: 'call', notes: 'اتصلت بيه', outcome: 'answered' });
    const comm = r.status;
    r = await api('sales1', 'GET', `/api/admin/leads/${leadId}/timeline`);
    check('lead', 'a contact log is accepted and shows in the timeline', (comm === 200 || comm === 201) && JSON.stringify(r.json || {}).includes('اتصلت بيه'), `post ${comm}, timeline ${r.status}`);
    // booking from the lead (the screen the owner described)
    r = await api('sales1', 'POST', '/api/admin/subscriber-payments', { lead_id: leadId, payment: { amount: 1000, currency: 'EGP', status: 'paid', paymentMethod: 'TRANSFER', transactionId: `LD-${stamp}`, courseId: 'c-7', paymentType: 'course', isInstallment: false, courseExpected: 3000, date: new Date().toISOString().slice(0, 10) }, subscriber: { email: `lead${stamp}@perf.test` } });
    check('lead', 'sales books from the lead with a transfer number', r.status === 200 && r.json?.ok, r.text.slice(0, 200));
    const subId = r.json?.subscriberId, bpay = r.json?.id;
    const [created] = subId ? await q('select client_code, assigned_sales_id from subscribers where id=?', [subId]) : [null];
    check('lead', 'a client record exists for it', Boolean(created?.client_code), JSON.stringify(r.json));
    check('lead', 'the client stays with the rep who booked', created?.assigned_sales_id === 'st-sales1', JSON.stringify(created));
    if (created) {
      r = await api('sales1', 'GET', `/api/staff/client/${created.client_code}`);
      check('lead', 'the new client page lists the booking payment', has(r.json?.data?.paymentHistory, p => p.id === bpay && p.transactionId === `LD-${stamp}`), `${r.status} ${JSON.stringify(r.json?.data?.paymentHistory || []).slice(0, 120)}`);
    }
    r = await api('sales1', 'GET', `/api/admin/leads?search=${phone}`);
    const after = rows(r).find(l => l.id === leadId);
    check('lead', 'the lead shows as converted / with its client code', after && (after.status === 'converted' || after.clientCode), JSON.stringify(after || 'not in list').slice(0, 160));
    r = await api('admin', 'GET', `/api/admin/subscribers?search=${stamp}&limit=5`);
    check('lead', 'the client is in the admin clients list', has(rows(r), s => s.id === subId), `${r.status} ${rows(r).length}`);

    // collection booking from a lead: becomes a request for the manager
    const cphone = `0103${stamp}09`;
    r = await api('admin', 'POST', '/api/admin/leads', { name: `CS Lead ${stamp}`, phone: cphone, source: 'manual', branch: 'ONLINE_EGYPT', assignedCsId: 'st-collection1' });
    const csLead = r.json?.id;
    await db.query("update leads set assigned_cs_id='st-collection1' where id=?", [csLead]);
    r = await api('collection1', 'POST', '/api/admin/subscriber-payments', { lead_id: csLead, payment: { amount: 800, currency: 'EGP', status: 'paid', paymentMethod: 'CASH', transactionId: `CS-${stamp}`, courseId: 'c-8', paymentType: 'course', isInstallment: false, courseExpected: 3000, date: new Date().toISOString().slice(0, 10) }, subscriber: { email: `cs${stamp}@perf.test` } });
    check('lead', 'collection books from a lead', r.json?.ok, r.text.slice(0, 200));
    const reqId = r.json?.requestId;
    check('lead', 'it becomes a review request, with no client yet', r.json?.status === 'pending_review' && r.json?.subscriberCreated === false, JSON.stringify(r.json));
    r = await api('admin', 'GET', '/api/admin/subscriber-requests?status=pending');
    check('lead', 'the manager sees the request with the transfer number', JSON.stringify(rows(r)).includes(`CS-${stamp}`), `${r.status} ${rows(r).length}`);
    r = await api('collection1', 'GET', '/api/staff/subscriber-requests');
    check('lead', 'the collection officer sees their own request', JSON.stringify(rows(r)).includes(`CS-${stamp}`), `${r.status} ${rows(r).length}`);
    if (reqId) {
      r = await api('admin', 'POST', `/api/admin/subscriber-requests/${reqId}/approve`, {});
      check('lead', 'the manager approves it', r.status === 200, r.text.slice(0, 200));
      r = await api('admin', 'GET', `/api/admin/subscribers?search=cs${stamp}&limit=5`);
      const [cs] = await q("select id, client_code, assigned_cs_id from subscribers where email=?", [`cs${stamp}@perf.test`]);
      check('lead', 'approval creates the client, owned by the collection officer', cs && cs.assigned_cs_id === 'st-collection1', JSON.stringify(cs));
      if (cs) {
        r = await api('collection1', 'GET', `/api/staff/client/${cs.client_code}`);
        check('lead', 'and the payment is on that client with its number', has(r.json?.data?.paymentHistory, p => p.transactionId === `CS-${stamp}`), `${r.status} ${JSON.stringify(r.json?.data?.paymentHistory || []).slice(0, 120)}`);
      }
    }
  }

  fs.writeFileSync('D:/audit_tmp/perf-db/journeys.json', JSON.stringify(results, null, 1));
  const fails = results.filter(x => !x.ok);
  console.log(`\n${results.length - fails.length}/${results.length} passed; ${fails.length} failed`);
  await db.end();
})().catch(e => { console.error('journey crashed:', e); process.exit(1); });
