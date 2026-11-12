'use strict';

/**
 * Incoming transfers — the money the manager saw arrive — and the one payment
 * each of them confirms.
 *
 * «ربطه بتحويل»: a booking from a collection account is approved against a
 * transfer. Either one already on the ledger (picked by id) or the one the
 * manager is looking at in the wallet right now (its details), which is
 * recorded here in the same transaction. A transfer confirms one payment and an
 * operation number is recorded once per box (migration 224); a payment may be
 * confirmed by several transfers (migration 387).
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

const cents = value => Math.round(Number(value) * 100);
const money = value => Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
const nameOf = row => `رقم ${row.reference || row.id}${row.method ? ` على ${row.method}` : ''}`;

/**
 * «التحويل ب 11600» (12 Nov 2026, the owner): one wallet transfer can pay for
 * several things and one payment can be paid by several transfers. Given what a
 * payment costs, the transfers already tied to it and the free ones picked (in
 * the order picked), decide what each does: tied whole while it fits in what is
 * still uncovered, the one that passes it keeps only the uncovered part (its
 * rest is split off as a free transfer), and any picked after the payment is
 * covered are left alone. Pure — it writes nothing. `short` is the piastres
 * still uncovered after all of them; more than one means the payment is not paid.
 */
function planTransferCover({ paymentAmount, tied = [], free = [] }) {
  const price = cents(paymentAmount);
  let need = price - tied.reduce((sum, row) => sum + cents(row.amount), 0);
  const steps = [];
  for (const row of free) {
    const whole = cents(row.amount);
    if (need <= 0) { steps.push({ row, action: 'skip', keep: 0, rest: 0 }); continue; }
    if (whole <= need) { steps.push({ row, action: 'tie', keep: whole, rest: 0 }); need -= whole; continue; }
    steps.push({ row, action: 'tie', keep: need, rest: whole - need });
    need = 0;
  }
  const chosen = [...tied, ...free].reduce((sum, row) => sum + cents(row.amount), 0);
  return { steps, short: Math.max(0, need), chosen: chosen / 100, price: price / 100 };
}

const shortMessage = plan =>
  `التحويلات المختارة ${money(plan.chosen)} والدفعة ${money(plan.price)} — ناقص ${money(plan.short / 100)}، اختار تحويل كمان أو عدّل مبلغ الدفعة`;

/** Every transfer tied to a payment, in the order they were tied. */
async function tiedTransfers(conn, { tenantId, paymentId, lock = false }) {
  const [rows] = await conn.query(
    `SELECT * FROM incoming_transfers WHERE tenant_id=? AND payment_id=? ORDER BY linked_at, created_at, id${lock ? ' FOR UPDATE' : ''}`,
    [tenantId, paymentId]);
  return rows;
}

/**
 * Tie transfers to a payment, inside the caller's transaction. `link` is
 * `{ transferId }` for one already recorded, `{ transferIds: [...] }` for
 * several (with the details of one new transfer beside them if it is also
 * wanted), or just the details of the new transfer. Every transfer row is
 * locked in id order, so two reviewers reaching for the same transfer meet at
 * the lock and the second finds it taken. Returns the first transfer's id.
 *
 * The payment must end up covered (a piastre of slack): otherwise nothing is
 * tied and the whole thing is refused with TRANSFERS_SHORT — a 2,000 transfer
 * cannot confirm a 4,100 payment.
 */
async function linkTransfer(conn, { tenantId, paymentId, link, actor = {} }) {
  if (!link || typeof link !== 'object') throw refused('اربط الدفعة بالتحويل اللي وصل', 400, 'TRANSFER_REQUIRED');
  const ids = [...new Set([...(Array.isArray(link.transferIds) ? link.transferIds : []), ...(link.transferId ? [link.transferId] : [])]
    .map(id => String(id || '').trim()).filter(Boolean))];
  const hasDetails = ['amount', 'reference', 'method'].some(key => link[key] !== undefined && link[key] !== null && link[key] !== '');
  if (!ids.length || hasDetails) ids.push(await recordTransfer(conn, { tenantId, transfer: link, actor }));

  const [[payment]] = await conn.query(
    'SELECT amount, currency FROM payments WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE', [tenantId, paymentId]);
  if (!payment) throw refused('الدفعة مش موجودة', 404);
  if (!(Number(payment.amount) > 0)) throw refused('مبلغ الدفعة غير صحيح', 400);
  const currency = String(payment.currency || 'EGP').toUpperCase();

  const [named] = await conn.query(
    'SELECT * FROM incoming_transfers WHERE tenant_id=? AND id IN (?) ORDER BY id FOR UPDATE', [tenantId, ids]);
  const byId = new Map(named.map(row => [String(row.id), row]));
  const tied = await tiedTransfers(conn, { tenantId, paymentId, lock: true });
  const tiedIds = new Set(tied.map(row => String(row.id)));
  const free = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) throw refused(`التحويل ${id} مش موجود`, 404, 'TRANSFER_NOT_FOUND');
    if (String(row.currency || 'EGP').toUpperCase() !== currency) {
      throw refused(`التحويل ${nameOf(row)} بعملة ${row.currency} والدفعة بعملة ${currency}`, 409, 'TRANSFER_CURRENCY');
    }
    if (tiedIds.has(String(row.id))) continue;
    if (row.payment_id) throw refused(`التحويل ${nameOf(row)} متربط بدفعة تانية بالفعل`, 409, 'TRANSFER_ALREADY_LINKED');
    free.push(row);
  }
  // Those already tied here are in the payment's currency too: they were checked when they were tied.
  const plan = planTransferCover({ paymentAmount: payment.amount, tied, free });
  if (plan.short > 1) throw refused(shortMessage(plan), 409, 'TRANSFERS_SHORT');

  const newlyTied = [];
  for (const step of plan.steps) {
    if (step.action !== 'tie') continue;
    if (step.rest > 0) await splitTransfer(conn, { tenantId, transfer: step.row, keep: step.keep / 100, actor });
    await conn.query('UPDATE incoming_transfers SET payment_id=?, linked_at=NOW() WHERE tenant_id=? AND id=?', [paymentId, tenantId, step.row.id]);
    newlyTied.push(String(step.row.id));
  }
  const first = tied[0]?.id || newlyTied[0] || null;
  if (first) await conn.query('UPDATE payments SET linked_transfer_id=? WHERE tenant_id=? AND id=?', [first, tenantId, paymentId]);
  return first;
}

/**
 * «يتبقي اتوماتك … ويبقي فيها علامة ان دا باقي مبلغ كبير» (10 Oct 2026). A
 * transfer bigger than what it confirms keeps only that part (`keep`); the rest
 * becomes a free transfer of its own, marked with the transfer it came from
 * (parent_transfer_id, always the first one) and that one's full amount. Its
 * operation number is the first one's with «/باقي n», so the box's numbers stay
 * unique.
 */
async function splitTransfer(conn, { tenantId, transfer, keep, actor = {} }) {
  const whole = Number(transfer.amount);
  const rest = Math.round((whole - keep) * 100) / 100;
  if (rest < 0.01) return null;
  const rootId = transfer.parent_transfer_id || transfer.id;
  const original = Number(transfer.original_amount) || whole;
  const [[root]] = rootId === transfer.id ? [[transfer]] : await conn.query(
    'SELECT reference FROM incoming_transfers WHERE tenant_id=? AND id=? LIMIT 1', [tenantId, rootId]);
  // The highest «/باقي n» so far, not the count: a deleted remainder would
  // otherwise hand its number to one that still exists.
  const [siblings] = await conn.query(
    'SELECT reference FROM incoming_transfers WHERE tenant_id=? AND parent_transfer_id=?', [tenantId, rootId]);
  const n = siblings.reduce((max, sibling) => Math.max(max, Number(/\/باقي (\d+)$/.exec(String(sibling.reference || ''))?.[1]) || 0), 0);
  const baseRef = String(root?.reference || transfer.reference || '').replace(/\/باقي \d+$/, '');
  const id = uuidv4();
  await conn.query(
    `INSERT INTO incoming_transfers
       (id, tenant_id, amount, currency, method, reference, sender_name, sender_phone, received_on, note,
        recorded_by, recorded_by_name, parent_transfer_id, original_amount)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, tenantId, rest, transfer.currency, transfer.method, `${baseRef}/باقي ${n + 1}`.slice(0, 191),
      transfer.sender_name, transfer.sender_phone, transfer.received_on,
      `باقي ربط من تحويل ${original.toLocaleString('en-US')} ${transfer.currency}${baseRef ? ` — رقم العملية ${baseRef}` : ''}`,
      actor.id || transfer.recorded_by || null, actor.name || transfer.recorded_by_name || null, rootId, original]);
  await conn.query(
    'UPDATE incoming_transfers SET amount=?, original_amount=COALESCE(original_amount, ?) WHERE tenant_id=? AND id=?',
    [keep, original, tenantId, transfer.id]);
  return { id, amount: rest };
}

/**
 * A payment's amount (or currency) is about to change after it was confirmed — a
 * correction. The transfers tied to it must still cover the new figure: short,
 * or in another currency, it is refused before anything is recorded. Over-
 * covered is fine here: the replacement is tied by linkTransfer, which splits
 * the last transfer's rest off. Reads only.
 */
async function assertTransfersCover(db, { tenantId, paymentId, newAmount, newCurrency }) {
  const tied = await tiedTransfers(db, { tenantId, paymentId });
  if (!tied.length) return tied;
  const currency = String(newCurrency || 'EGP').toUpperCase();
  const wrong = tied.find(row => String(row.currency || 'EGP').toUpperCase() !== currency);
  if (wrong) throw refused(`التحويل ${nameOf(wrong)} بعملة ${wrong.currency} والدفعة بعملة ${currency}`, 409, 'TRANSFER_CURRENCY');
  const plan = planTransferCover({ paymentAmount: newAmount, tied: [], free: tied });
  if (plan.short > 1) throw refused(shortMessage(plan), 409, 'TRANSFERS_SHORT');
  return tied;
}

/** A voided payment's transfers — all of them — are free again, for the payment that replaces it. */
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

module.exports = { cleanTransfer, recordTransfer, linkTransfer, planTransferCover, assertTransfersCover, tiedTransfers, releaseTransfer, importTransfers, updateTransfer, deleteTransfer, isCashMethod, IMPORT_LIMIT };
