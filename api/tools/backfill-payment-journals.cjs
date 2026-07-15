'use strict';

require('dotenv').config();

const { pool } = require('../lib/db');
const { postPaymentJournal } = require('../lib/finance');

async function main() {
  const [rows] = await pool.query(`
    SELECT p.id, p.amount, p.currency, p.payment_type, p.date, p.created_at
    FROM payments p
    LEFT JOIN journal_entries j ON j.ref_type='payment' AND j.ref_id=p.id
    WHERE p.status='paid'
      AND COALESCE(p.amount, 0) > 0
      AND j.id IS NULL
    ORDER BY COALESCE(p.date, p.created_at) ASC, p.id ASC
  `);

  let posted = 0;
  let failed = 0;
  for (const payment of rows) {
    const entryDate = payment.date
      ? new Date(payment.date).toISOString().slice(0, 10)
      : new Date(payment.created_at || Date.now()).toISOString().slice(0, 10);
    const journalId = await postPaymentJournal({
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency || 'EGP',
      payType: payment.payment_type || 'OTHER',
      date: entryDate,
      actor: 'payment-journal-backfill',
    });
    if (journalId) posted += 1;
    else failed += 1;
  }

  console.log(JSON.stringify({ scanned: rows.length, posted, failed }, null, 2));
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
