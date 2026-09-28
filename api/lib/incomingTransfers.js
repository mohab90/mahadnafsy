'use strict';

/**
 * Incoming transfers — the money the manager saw arrive — and the one payment
 * each of them confirms.
 *
 * «ربطه بتحويل»: a booking from a collection account is approved against a
 * transfer. Either one already on the ledger (picked by id) or the one the
 * manager is looking at in the wallet right now (its details), which is
 * recorded here in the same transaction. The unique keys in migration 224 do
 * the refusing: a transfer confirms one payment, and an operation number is
 * recorded once per box.
 */

const { uuidv4 } = require('./id');
const { sanitize } = require('./helpers');
const { cairoToday } = require('./dates');

const refused = (message, statusCode = 409, code) => Object.assign(new Error(message), { statusCode, code });

/** A transfer as the screens send it, checked; throws a 400 on what is missing. */
function cleanTransfer(input = {}) {
  const amount = Number(input.amount);
  const currency = String(input.currency || 'EGP').toUpperCase();
  const method = sanitize(input.method || '', 100);
  const reference = sanitize(input.reference || '', 191) || null;
  const receivedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(input.receivedOn || '')) ? String(input.receivedOn) : cairoToday();
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) throw refused('مبلغ التحويل غير صحيح', 400);
  if (!['EGP', 'SAR', 'USD'].includes(currency)) throw refused('عملة التحويل غير مدعومة', 400);
  if (!method) throw refused('حدد الحساب اللي التحويل وصل عليه', 400);
  if (!reference) throw refused('اكتب رقم العملية — هو اللي بيمنع إن نفس التحويل يتربط مرتين', 400);
  return {
    amount, currency, method, reference, receivedOn,
    senderName: sanitize(input.senderName || '', 255) || null,
    senderPhone: sanitize(input.senderPhone || '', 40) || null,
    note: sanitize(input.note || '', 2000) || null,
  };
}

async function recordTransfer(conn, { tenantId, transfer, actor = {} }) {
  const t = cleanTransfer(transfer);
  const id = uuidv4();
  try {
    await conn.query(
      `INSERT INTO incoming_transfers
         (id, tenant_id, amount, currency, method, reference, sender_name, sender_phone, received_on, note, recorded_by, recorded_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, tenantId, t.amount, t.currency, t.method, t.reference, t.senderName, t.senderPhone, t.receivedOn, t.note,
        actor.id || null, actor.name || null]
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') throw refused(`رقم العملية ${t.reference} على ${t.method} متسجل قبل كده`, 409, 'TRANSFER_DUPLICATE');
    throw error;
  }
  return id;
}

/**
 * Tie a transfer to a payment, inside the caller's transaction. `link` is
 * `{ transferId }` for one already recorded, or the transfer's own details.
 * Returns the transfer's id.
 */
async function linkTransfer(conn, { tenantId, paymentId, link, actor = {} }) {
  if (!link || typeof link !== 'object') throw refused('اربط الدفعة بالتحويل اللي وصل', 400, 'TRANSFER_REQUIRED');
  let transferId = link.transferId ? String(link.transferId) : null;
  if (!transferId) transferId = await recordTransfer(conn, { tenantId, transfer: link, actor });
  const [[row]] = await conn.query(
    'SELECT id, payment_id FROM incoming_transfers WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE', [tenantId, transferId]);
  if (!row) throw refused('التحويل مش موجود', 404);
  if (row.payment_id && String(row.payment_id) !== String(paymentId)) {
    throw refused('التحويل ده متربط بدفعة تانية بالفعل', 409, 'TRANSFER_ALREADY_LINKED');
  }
  await conn.query('UPDATE incoming_transfers SET payment_id=?, linked_at=NOW() WHERE tenant_id=? AND id=?', [paymentId, tenantId, transferId]);
  await conn.query('UPDATE payments SET linked_transfer_id=? WHERE tenant_id=? AND id=?', [transferId, tenantId, paymentId]);
  return transferId;
}

/**
 * Cash is counted, not transferred («نقدي», «خزنة الدقي»); every other box —
 * «فودافون كاش 2020» included, which is a wallet — has an operation number the
 * manager can check.
 */
const isCashMethod = method => /نقد|خزن/.test(String(method || '')) || /^s*cashs*$/i.test(String(method || ''));

module.exports = { cleanTransfer, recordTransfer, linkTransfer, isCashMethod };
