'use strict';
// Financial integrity report.
//
// Written after the desk said most of the financial records were wrong and
// needed a real review. This is that review, as a repeatable check rather than
// a one-off answer: run it, get the current state.
//
// Read-only by design. Every line it reports is a business judgement — whether
// two payments on the same day at the same amount are a duplicate or a genuine
// second instalment is not something a script can decide, and a script that
// decided it anyway would destroy the evidence.
//
//   node -r dotenv/config tools/financial-integrity-audit.cjs
const { pool } = require('../lib/db');
const T = process.env.DEFAULT_TENANT_ID || 'tenant-default';

const money = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const findings = [];
const report = (severity, label, count, detail) => {
  findings.push({ severity, label, count });
  const tag = severity === 'high' ? '!!' : severity === 'med' ? ' !' : '  ';
  console.log(`${tag} ${String(count).padStart(6)}  ${label}${detail ? '\n            ' + detail : ''}`);
};

(async () => {
  const [tbls] = await pool.query('SHOW TABLES');
  const has = new Set(tbls.map(r => Object.values(r)[0]));

  const [[tot]] = await pool.query(
    `SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM payments WHERE tenant_id=? AND deleted_at IS NULL`, [T]);
  console.log(`المدفوعات: ${tot.n} صف، إجمالي ${money(tot.t)} جنيه\n`);
  console.log('الشدة  العدد  المشكلة');
  console.log('─'.repeat(70));

  // ── Orphans: money attached to nobody ─────────────────────────────────────
  const [[orphan]] = await pool.query(
    `SELECT COUNT(*) n, COALESCE(SUM(p.amount),0) t FROM payments p
      LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
     WHERE p.tenant_id=? AND p.deleted_at IS NULL AND (p.subscriber_id IS NULL OR s.id IS NULL)`, [T]);
  report(orphan.n > 0 ? 'high' : 'ok', 'مدفوعات مش مربوطة بعميل موجود', orphan.n,
    orphan.n > 0 ? `بقيمة ${money(orphan.t)} جنيه` : '');

  // ── Amounts that cannot be right ──────────────────────────────────────────
  const [[bad]] = await pool.query(
    `SELECT COUNT(*) n FROM payments WHERE tenant_id=? AND deleted_at IS NULL AND (amount IS NULL OR amount <= 0)`, [T]);
  report(bad.n > 0 ? 'med' : 'ok', 'مدفوعات بقيمة صفر أو سالبة', bad.n);

  // ── Exact duplicates: same person, same amount, same day ──────────────────
  const [dupes] = await pool.query(
    `SELECT subscriber_id, amount, DATE(date) d, COUNT(*) n
       FROM payments WHERE tenant_id=? AND deleted_at IS NULL AND subscriber_id IS NOT NULL
      GROUP BY subscriber_id, amount, DATE(date) HAVING n > 1`, [T]);
  const dupExtra = dupes.reduce((a, r) => a + (Number(r.n) - 1), 0);
  const dupValue = dupes.reduce((a, r) => a + (Number(r.n) - 1) * Number(r.amount), 0);
  report(dupExtra > 0 ? 'high' : 'ok', 'مدفوعات مكررة (نفس العميل ونفس المبلغ ونفس اليوم)', dupExtra,
    dupExtra > 0 ? `بقيمة ${money(dupValue)} جنيه — محتاجة تأكيد إن مش دفعتين حقيقيتين` : '');

  // ── No date ───────────────────────────────────────────────────────────────
  const [[nodate]] = await pool.query(
    `SELECT COUNT(*) n FROM payments WHERE tenant_id=? AND deleted_at IS NULL AND (date IS NULL OR date = '0000-00-00')`, [T]);
  report(nodate.n > 0 ? 'med' : 'ok', 'مدفوعات بدون تاريخ', nodate.n);

  // ── Nothing bought ────────────────────────────────────────────────────────
  const [[noitem]] = await pool.query(
    `SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM payments
      WHERE tenant_id=? AND deleted_at IS NULL
        AND (course_id IS NULL OR course_id='') AND (bundle_id IS NULL OR bundle_id='')`, [T]);
  report(noitem.n > 0 ? 'med' : 'ok', 'مدفوعات مش مربوطة بكورس ولا باقة', noitem.n,
    noitem.n > 0 ? `بقيمة ${money(noitem.t)} جنيه — مش معروف اتدفعت مقابل إيه` : '');

  // ── No one recorded as taking it ──────────────────────────────────────────
  const [[nostaff]] = await pool.query(
    `SELECT COUNT(*) n FROM payments WHERE tenant_id=? AND deleted_at IS NULL AND (staff_id IS NULL OR staff_id='')`, [T]);
  report(nostaff.n > 0 ? 'med' : 'ok', 'مدفوعات بدون الموظف اللي استلمها', nostaff.n);

  // ── Double entry ──────────────────────────────────────────────────────────
  if (has.has('journal_entries')) {
    const [[unposted]] = await pool.query(
      `SELECT COUNT(*) n, COALESCE(SUM(p.amount),0) t FROM payments p
        WHERE p.tenant_id=? AND p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM journal_entries j
                           WHERE j.tenant_id=p.tenant_id AND j.ref_id = p.id)`, [T]);
    report(unposted.n > 0 ? 'high' : 'ok', 'مدفوعات مالهاش قيد محاسبي', unposted.n,
      unposted.n > 0 ? `بقيمة ${money(unposted.t)} جنيه` : '');

    // journal_entries carries its own totals; there is no separate lines table.
    const [[bal]] = await pool.query(
      `SELECT COALESCE(SUM(total_debit),0) d, COALESCE(SUM(total_credit),0) c
         FROM journal_entries WHERE tenant_id=?`, [T]).catch(() => [[{ d: 0, c: 0 }]]);
    const diff = Math.abs(Number(bal.d) - Number(bal.c));
    report(diff > 0.01 ? 'high' : 'ok', 'دفتر اليومية غير متوازن', diff > 0.01 ? 1 : 0,
      diff > 0.01 ? `مدين ${money(bal.d)} مقابل دائن ${money(bal.c)} — فرق ${money(diff)}` : '');
  } else {
    console.log('   (مفيش جدول قيود محاسبية)');
  }

  // ── The subscriber's own total vs what was actually paid ──────────────────
  // Each entry must balance on its own, not just in aggregate — two entries
  // wrong in opposite directions would hide each other in a total.
  const [unbalanced] = await pool.query(
    `SELECT id, ref_type, ref_id, total_debit, total_credit
       FROM journal_entries WHERE tenant_id=? AND ABS(total_debit - total_credit) > 0.01`, [T]).catch(() => [[]]);
  report(unbalanced.length > 0 ? 'high' : 'ok', 'قيود غير متوازنة كل واحد لوحده', unbalanced.length);
  for (const u of unbalanced.slice(0, 6)) {
    console.log(`            ${u.ref_type || '-'} ${String(u.ref_id || '').slice(0, 14)}  مدين=${money(u.total_debit)} دائن=${money(u.total_credit)}`);
  }

  // ── Refunds ───────────────────────────────────────────────────────────────
  if (has.has('refund_requests')) {
    const [[refund]] = await pool.query(
      `SELECT COUNT(*) n FROM refund_requests r
        LEFT JOIN subscribers s ON s.id = r.subscriber_id AND s.tenant_id = r.tenant_id
       WHERE r.tenant_id=? AND (r.subscriber_id IS NULL OR s.id IS NULL)`, [T]).catch(() => [[{ n: 0 }]]);
    report(refund.n > 0 ? 'med' : 'ok', 'طلبات استرداد لعميل مش موجود', refund.n);
  }

  const high = findings.filter(f => f.severity === 'high' && f.count > 0).length;
  const med = findings.filter(f => f.severity === 'med' && f.count > 0).length;
  console.log('─'.repeat(70));
  console.log(`${high} مشكلة خطيرة، ${med} تحتاج مراجعة، من ${findings.length} فحص`);
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
