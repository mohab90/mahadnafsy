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
    'SELECT * FROM incoming_transfers WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE', [tenantId, transferId]);
  if (!row) throw refused('التحويل مش موجود', 404);
  if (row.payment_id && String(row.payment_id) !== String(paymentId)) {
    throw refused('التحويل ده متربط بدفعة تانية بالفعل', 409, 'TRANSFER_ALREADY_LINKED');
  }
  if (!row.payment_id) await splitOffRemainder(conn, { tenantId, transfer: row, paymentId, actor });
  await conn.query('UPDATE incoming_transfers SET payment_id=?, linked_at=NOW() WHERE tenant_id=? AND id=?', [paymentId, tenantId, transferId]);
  await conn.query('UPDATE payments SET linked_transfer_id=? WHERE tenant_id=? AND id=?', [transferId, tenantId, paymentId]);
  return transferId;
}

/**
 * «يتبقي اتوماتك … ويبقي فيها علامة ان دا باقي مبلغ كبير» (10 Oct 2026). A
 * transfer bigger than the payment it confirms keeps only the payment's amount;
 * the rest becomes a free transfer of its own, marked with the transfer it came
 * from (parent_transfer_id, always the first one) and that one's full amount.
 * Its operation number is the first one's with «/باقي n», so the box's numbers
 * stay unique. Different currencies are not split: the amounts do not compare.
 */
async function splitOffRemainder(conn, { tenantId, transfer, paymentId, actor = {} }) {
  const [[payment]] = await conn.query(
    'SELECT amount, currency FROM payments WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, paymentId]);
  const paid = Number(payment?.amount);
  const whole = Number(transfer.amount);
  if (!payment || !(paid > 0) || String(payment.currency || 'EGP').toUpperCase() !== String(transfer.currency || 'EGP').toUpperCase()) return null;
  const rest = Math.round((whole - paid) * 100) / 100;
  if (rest < 0.01) return null;
  const rootId = transfer.parent_transfer_id || transfer.id;
  const original = Number(transfer.original_amount) || whole;
  const [[root]] = rootId === transfer.id ? [[transfer]] : await conn.query(
    'SELECT reference FROM incoming_transfers WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, rootId]);
  const [[{ n }]] = await conn.query(
    'SELECT COUNT(*) AS n FROM incoming_transfers WHERE tenant_id=? AND parent_transfer_id=?', [tenantId, rootId]);
  const baseRef = String(root?.reference || transfer.reference || '').replace(/\/باقي \d+$/, '');
  const id = uuidv4();
  await conn.query(
    `INSERT INTO incoming_transfers
       (id, tenant_id, amount, currency, method, reference, sender_name, sender_phone, received_on, note,
        recorded_by, recorded_by_name, parent_transfer_id, original_amount)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, tenantId, rest, transfer.currency, transfer.method, `${baseRef}/باقي ${Number(n) + 1}`.slice(0, 191),
      transfer.sender_name, transfer.sender_phone, transfer.received_on,
      `باقي ربط من تحويل ${original.toLocaleString('en-US')} ${transfer.currency}${baseRef ? ` — رقم العملية ${baseRef}` : ''}`,
      actor.id || transfer.recorded_by || null, actor.name || transfer.recorded_by_name || null, rootId, original]);
  await conn.query(
    'UPDATE incoming_transfers SET amount=?, original_amount=COALESCE(original_amount, ?) WHERE tenant_id=? AND id=?',
    [paid, original, tenantId, transfer.id]);
  return { id, amount: rest };
}

/** A voided payment's transfer is free again, for the payment that replaces it. */
async function releaseTransfer(conn, { tenantId, paymentId }) {
  await conn.query('UPDATE incoming_transfers SET payment_id=NULL, linked_at=NULL WHERE tenant_id=? AND payment_id=?', [tenantId, paymentId]);
}

/**
 * Cash is counted, not transferred («نقدي», «خزنة الدقي»); every other box —
 * «فودافون كاش 2020» included, which is a wallet — has an operation number the
 * manager can check.
 */
// «كاش» alone is cash; «فودافون كاش» is a wallet. Same rule as shared/paymentMethods.ts isCashBox.
const isCashMethod = method => /نقد|خزن/.test(String(method || '')) || /^\s*(cash|كاش)\s*$/i.test(String(method || ''));

/**
 * «رفع ملف التحويلات» — a sheet of what arrived, one row per transfer. Each row
 * stands alone: an operation number already on the box (an earlier upload of
 * the same sheet, or a transfer typed in by hand) is counted, not refused, so
 * uploading the sheet again as it grows adds only its new rows.
 */
const IMPORT_LIMIT = 3000;

async function importTransfers(db, { tenantId, transfers, actor = {} }) {
  if (!Array.isArray(transfers) || !transfers.length) throw refused('الملف مافيهوش تحويلات', 400);
  if (transfers.length > IMPORT_LIMIT) throw refused(`الحد ${IMPORT_LIMIT} تحويل في المرة — قسّم الملف`, 400);
  const result = { created: 0, existing: 0, failed: [] };
  for (let index = 0; index < transfers.length; index++) {
    try {
      await recordTransfer(db, { tenantId, transfer: transfers[index], actor });
      result.created += 1;
    } catch (error) {
      if (error?.code === 'TRANSFER_DUPLICATE') { result.existing += 1; continue; }
      if (!error?.statusCode || error.statusCode >= 500) throw error;
      result.failed.push({ index, error: error.message });
    }
  }
  return result;
}

/**
 * «يكون عند المديرين صلاحيه تعديل او حذف لتحويل معين موظف رفعه غلط» (8 Oct 2026).
 * A free transfer is corrected whole; one that already confirmed a payment keeps
 * its amount, box and number — the payment was approved on them — and only its
 * sender and note change. Only a free transfer is deleted. Returns the row before.
 */
async function updateTransfer(conn, { tenantId, transferId, transfer }) {
  const [[before]] = await conn.query('SELECT * FROM incoming_transfers WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE', [tenantId, transferId]);
  if (!before) throw refused('التحويل مش موجود', 404);
  const t = before.payment_id
    ? { ...cleanTransfer({ ...transfer, amount: before.amount, currency: before.currency, method: before.method, reference: before.reference }), receivedOn: before.received_on }
    : cleanTransfer(transfer);
  try {
    await conn.query(
      `UPDATE incoming_transfers
          SET amount=?, currency=?, method=?, reference=?, sender_name=?, sender_phone=?, received_on=?, note=?
        WHERE tenant_id=? AND id=?`,
      [t.amount, t.currency, t.method, t.reference, t.senderName, t.senderPhone, t.receivedOn, t.note, tenantId, transferId]);
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') throw refused(`رقم العملية ${t.reference} على ${t.method} متسجل قبل كده`, 409, 'TRANSFER_DUPLICATE');
    throw error;
  }
  return before;
}

async function deleteTransfer(conn, { tenantId, transferId }) {
  const [[before]] = await conn.query('SELECT * FROM incoming_transfers WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE', [tenantId, transferId]);
  if (!before) throw refused('التحويل مش موجود', 404);
  if (before.payment_id) throw refused('التحويل ده أكّد دفعة — صحّح الدفعة الأول (إلغاء أو تعديل) وبعدين امسحه', 409, 'TRANSFER_LINKED');
  await conn.query('DELETE FROM incoming_transfers WHERE tenant_id=? AND id=? AND payment_id IS NULL', [tenantId, transferId]);
  return before;
}

module.exports = { cleanTransfer, recordTransfer, linkTransfer, splitOffRemainder, releaseTransfer, importTransfers, updateTransfer, deleteTransfer, isCashMethod, IMPORT_LIMIT };
