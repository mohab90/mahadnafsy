'use strict';

const express = require('express');
const router = express.Router();

const logger = require('../lib/logger').child({ module: 'admin-operations-route' });
const { looksLikeAddress } = require('../lib/staffNames');
const { pool } = require('../lib/db');
const { uuidv4 } = require('../lib/id');
const { parseLimit, parseOffset } = require('../lib/helpers');
const { branchForId, branchIdForBranch, defaultDigitalBranch } = require('../lib/branches');
const { DEFAULT_TENANT_ID, resolveTenantId } = require('../lib/tenantScope');
const { postExpenseJournal } = require('../lib/finance');
const { nextExpenseNo, expenseSeriesOf } = require('../lib/receiptNumbers');
const { insertNotification } = require('../lib/notification');
const { financialRecordMatches, resolveFinancialScope } = require('../lib/financialScope');
const { assertWritable } = require('../lib/periodLock');
const { writeAuditEvent } = require('../lib/auditTrail');
const { toNumbers, getNextClientCode, lockClientCodeCounter, raiseClientCodeCounter, setClientCodeCounter } = require('../lib/mappers');
const { addDaysToDateOnly, cairoDayStartUtc, safeDateOnly, cairoToday } = require('../lib/dates');
const { SYSTEM_ACTORS, departmentOf, describeLabel } = require('../lib/activityDescribe');
const { listEnv } = require('../lib/platformAccess');
const { loadExpenseCategories, expenseCategory, expenseCategoryLabel } = require('../lib/expenseCategories');
const { canonicalChannel } = require('../lib/paymentChannels');
const { applyAlias, loadBoxAliases } = require('../lib/boxAliases');
const { advanceToInterview, convertJoinUs } = require('./hr/talent');
const { requireAuth, requireAdmin, requireAdminOrStaff, requireAnyPermission, requirePermission } = require('../middleware/auth');
const { requireRecruiting, joinUsReachSql, joinUsInReach, outOfRecruitReach } = require('../lib/branchHr');
const { readPrograms } = require('../lib/joinApplication');
const { JOIN_US_INBOX_SQL, joinUsFilterSql, pageOf } = require('../lib/recruitmentFilters');

// expenses.amount and friends are DECIMAL, which mysql2 hands back as strings,
// and expenses.date is a DATETIME, which it hands back as a Date. The finance
// screen adds the amounts (so «المجموع» printed "025000.008000.00", and a second
// row in one category made the share NaN%) and renders the date as it arrives
// (so the التاريخ column showed a raw ISO timestamp).
const EXPENSE_MONEY = ['amount', 'amount_egp', 'fx_rate_to_egp', 'vat_rate', 'vat_amount', 'amount_before_vat'];

function routeError(res, error, message = 'admin operations route failed') {
  logger.error(message, error);
  return res.status(500).json({ error: 'Internal server error' });
}

function scopedTenantId(req) {
  return req.tenantId || resolveTenantId(req) || DEFAULT_TENANT_ID;
}

function appendTenantScope(sql, alias, tenantId, params) {
  const col = alias ? `${alias}.tenant_id` : 'tenant_id';
  const effectiveTenantId = tenantId || DEFAULT_TENANT_ID;
  params.push(effectiveTenantId);
  if (effectiveTenantId === DEFAULT_TENANT_ID) {
    return `${sql} AND (${col} = ? OR ${col} IS NULL OR ${col} = '')`;
  }
  return `${sql} AND ${col} = ?`;
}

const VALID_EXPENSE_CURRENCIES = new Set(['EGP', 'SAR', 'USD']);
function expenseDate(value) {
  const date = String(value || cairoToday()).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())
    ? date
    : null;
}

// The box an expense was paid out of, named the way the boxes screen names it (lib/boxBalances.js); '' when none was given.
async function expenseBox(db, tenantId, raw) {
  const name = String(raw || '').trim().slice(0, 191);
  return name ? applyAlias(canonicalChannel(name), await loadBoxAliases(db, tenantId)) : '';
}

router.get('/api/admin/expenses', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const scope = resolveFinancialScope(req, { requestedBranch: req.query.branch || null, allowAssigned: true });
    // Staff who see their own clients' money see no expenses — none is a
    // client's. The dashboard asked on every load and was refused: 127 times
    // on 5–7 Oct, for collection officers.
    if (scope.kind === 'assigned_cs' || scope.kind === 'assigned_sales') return res.json([]);
    const branchSql = scope.branchId ? ' AND branch_id=?' : '';
    const params = scope.branchId ? [scopedTenantId(req), scope.branchId] : [scopedTenantId(req)];
    // 500 was a fixed cut, and the screens total what they are handed: the
    // expense cards, the category split and the analytics all stopped counting at
    // the 500th row without a word. Five thousand is the ceiling now, and the
    // answer says when it was reached (X-Truncated) so a total is not mistaken
    // for the whole.
    const limit = parseLimit(req.query.limit, 5000, 5000);
    const [[rows], categories] = await Promise.all([pool.query(
      `SELECT e.id, e.description, e.amount, e.currency, e.fx_rate_to_egp, e.amount_egp, e.fx_source,
       e.category, e.date, e.receipt_url, e.note, e.staff_id, e.branch_id, e.box_method,
       e.vat_rate, e.vat_amount, e.amount_before_vat, e.created_at, e.expense_no,
       COALESCE(e.created_by_name, st.name) AS staff_name
       FROM expenses e LEFT JOIN staff st ON st.id=e.staff_id AND st.tenant_id=e.tenant_id
       WHERE e.tenant_id=? AND e.deleted_at IS NULL${branchSql.replace('branch_id', 'e.branch_id')}
       ORDER BY e.date DESC, e.created_at DESC LIMIT ?`,
      [...params, limit]), loadExpenseCategories(scopedTenantId(req))]);
    if (rows.length >= limit) res.setHeader('X-Truncated', 'true');
    res.json(rows.map(({ staff_name: staffName, ...row }) => ({
      ...toNumbers(row, EXPENSE_MONEY),
      category: expenseCategoryLabel(row.category, categories),
      categoryCode: row.category,
      date: safeDateOnly(row.date),
      receiptUrl: row.receipt_url || '',
      boxMethod: row.box_method || '',
      branchType: branchForId(row.branch_id),
      // «رقم العملية» of a branch's expense: 1, 2, 3 … per branch (null for an online one).
      expenseNo: row.expense_no != null ? Number(row.expense_no) : null,
      receiptBranch: expenseSeriesOf(row.branch_id),
      // «القائم بالعملية»: the name as it was when the expense was entered.
      staffName: staffName && !looksLikeAddress(staffName) ? staffName : null,
      createdAt: row.created_at,
    })));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    routeError(res, e);
  }
});

// الإعدادات › فئات المصاريف, for whoever records an expense — the settings
// route itself needs manage_settings, which the accountant does not hold.
router.get('/api/admin/expense-categories', requireAuth, requireAdminOrStaff, requirePermission('view_financial'), async (req, res) => {
  try {
    const categories = await loadExpenseCategories(scopedTenantId(req));
    res.json(categories.filter(item => item.active).map(({ code, label }) => ({ code, label })));
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/expenses', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const e2 = req.body;
    const id = uuidv4();
    const tenantId = scopedTenantId(req);
    const scope = resolveFinancialScope(req, { requestedBranch: e2.branchType || e2.branch || null });
    const branchCode = scope.branch || defaultDigitalBranch(e2.branchType || e2.branch);
    const branchId = scope.branchId || branchIdForBranch(branchCode);
    const expDate = expenseDate(e2.date);
    const amount = Number(e2.amount);
    const currency = String(e2.currency || 'EGP').toUpperCase();
    if (!expDate) return res.status(400).json({ error: 'Invalid expense date' });
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Expense amount must be positive' });
    if (!VALID_EXPENSE_CURRENCIES.has(currency)) return res.status(400).json({ error: 'Invalid expense currency' });
    const category = expenseCategory(e2.category, await loadExpenseCategories(tenantId));
    // «لازم يكون اختيار الخزنة اللى هصرف منها الفلوس»: an expense with no box would leave every balance as it was.
    const boxMethod = await expenseBox(pool, tenantId, e2.boxMethod ?? e2.box_method);
    if (!boxMethod) return res.status(400).json({ error: 'اختار الخزنة اللي هتصرف منها المصروف', code: 'EXPENSE_BOX_REQUIRED' });
    const actorName = req.staffRecord?.name || req.user?.name || 'المدير';
    await conn.beginTransaction();
    transactionStarted = true;
    await assertWritable(expDate, conn, tenantId);
    const expenseNo = await nextExpenseNo(conn, { tenantId, branchId });
    // Column is `note` (singular) in the real schema — inserting into `notes`
    // threw "Unknown column 'notes'" and silently broke ALL expense creation
    // (confirmed: expenses table was empty in prod). Accept either field name.
    await conn.query(
      `INSERT INTO expenses
         (id, tenant_id, branch_id, date, description, amount, currency, category, receipt_url, note, staff_id, created_by_name, expense_no, box_method, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [id, tenantId, branchId, expDate, String(e2.description || '').trim().slice(0, 2000),
       amount, currency, category, String(e2.receiptUrl || e2.receipt_url || '').slice(0, 2000) || null, e2.note ?? e2.notes ?? null,
       req.staffRecord?.id || null, looksLikeAddress(actorName) ? 'المدير' : String(actorName).slice(0, 150), expenseNo, boxMethod]
    );
    const journalId = await postExpenseJournal(
      { id, tenant_id: tenantId, branch_id: branchId, date: expDate, description: e2.description, amount, currency, category },
      +1, req.user?.email, conn, tenantId
    );
    if (!journalId) throw new Error('Expense journal posting failed');
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true, id, expenseNo, receiptBranch: expenseSeriesOf(branchId), category: expenseCategoryLabel(category, await loadExpenseCategories(tenantId)), branchType: branchForId(branchId), staffName: looksLikeAddress(actorName) ? 'المدير' : actorName });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    routeError(res, e);
  } finally { conn.release(); }
});

router.patch('/api/admin/expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    const e2 = req.body;
    const tenantId = scopedTenantId(req);
    const amount = Number(e2.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return res.status(400).json({ error: 'Expense amount must be positive' });
    const category = expenseCategory(e2.category, await loadExpenseCategories(tenantId));
    await conn.beginTransaction();
    transactionStarted = true;
    // Fetch the old row (in tenant scope) so its ledger entry can be reversed.
    const [[oldExp]] = await conn.query(
      `SELECT id, tenant_id, branch_id, date, description, amount, currency, fx_rate_to_egp, amount_egp, category, receipt_url, note, expense_no, box_method
       FROM expenses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [req.params.id, tenantId]
    );
    if (!oldExp) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Expense not found' });
    }
    const sourceScope = resolveFinancialScope(req);
    if (!financialRecordMatches(sourceScope, oldExp)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'Expense is outside your financial scope' });
    }
    const targetScope = resolveFinancialScope(req, { requestedBranch: e2.branchType || e2.branch || null });
    const targetBranchId = targetScope.branchId || oldExp.branch_id;
    const newDate = expenseDate(e2.date || oldExp.date);
    const currency = String(e2.currency || oldExp.currency || 'EGP').toUpperCase();
    if (!newDate || !VALID_EXPENSE_CURRENCIES.has(currency)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(400).json({ error: 'Invalid expense date or currency' });
    }
    await assertWritable(oldExp.date, conn, tenantId);
    if (newDate !== String(oldExp.date).slice(0, 10)) await assertWritable(newDate, conn, tenantId);
    // `note` (singular) is the real column — `notes` does not exist.
    // An expense moved to another branch takes that branch's next number (none for an online one);
    // the number it leaves behind is a gap the managers are shown.
    const expenseNo = targetBranchId === oldExp.branch_id ? oldExp.expense_no : await nextExpenseNo(conn, { tenantId, branchId: targetBranchId });
    await conn.query(
      `UPDATE expenses
          SET description=?, amount=?, currency=?, category=?, date=?, receipt_url=?, note=?, branch_id=?, expense_no=?, box_method=?
        WHERE id=? AND tenant_id=?`,
      [String(e2.description || '').trim().slice(0, 2000), amount, currency, category,
       newDate, String(e2.receiptUrl || e2.receipt_url || '').slice(0, 2000) || null,
       e2.note ?? e2.notes ?? oldExp.note ?? null, targetBranchId, expenseNo,
       (await expenseBox(conn, tenantId, e2.boxMethod ?? e2.box_method)) || oldExp.box_method || null, req.params.id, tenantId]
    );
    const reversalId = await postExpenseJournal(oldExp, -1, req.user?.email, conn, tenantId);
    const journalId = await postExpenseJournal(
      { ...oldExp, ...e2, amount, currency, date: newDate, category, branch_id: targetBranchId, id: req.params.id, tenant_id: tenantId },
      +1, req.user?.email, conn, tenantId
    );
    if (!reversalId || !journalId) throw new Error('Expense ledger update failed');
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    routeError(res, e);
  } finally { conn.release(); }
});

router.delete('/api/admin/expenses/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_financial'), async (req, res) => {
  const conn = await pool.getConnection();
  let transactionStarted = false;
  try {
    // Soft delete (recoverable + auditable), NOT a hard DELETE. Every financial
    // report already filters `WHERE deleted_at IS NULL` (finance.js, analytics/
    // financial.js, campaigns.js, misc/analytics.js), so a soft-deleted expense
    // disappears from all reports exactly like a hard delete did — same visible
    // behavior — but the row survives for recovery and audit instead of destroyed.
    // The `deleted_at` column is owned by migration 017.
    const tenantId = scopedTenantId(req);
    await conn.beginTransaction();
    transactionStarted = true;
    const [[oldExp]] = await conn.query(
      `SELECT id, tenant_id, branch_id, date, description, amount, currency, fx_rate_to_egp, amount_egp, category, expense_no
       FROM expenses WHERE id=? AND tenant_id=? AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [req.params.id, tenantId]
    );
    if (!oldExp) {
      await conn.rollback(); transactionStarted = false;
      return res.status(404).json({ error: 'Expense not found' });
    }
    const scope = resolveFinancialScope(req);
    if (!financialRecordMatches(scope, oldExp)) {
      await conn.rollback(); transactionStarted = false;
      return res.status(403).json({ error: 'Expense is outside your financial scope' });
    }
    await assertWritable(oldExp.date, conn, tenantId);
    const [del] = await conn.query(
      'UPDATE expenses SET deleted_at=NOW() WHERE id=? AND tenant_id=? AND deleted_at IS NULL',
      [req.params.id, tenantId]
    );
    // Reverse the ledger entry only on a real live->deleted transition, so a
    // double-delete can't post two reversals.
    if (!del.affectedRows) throw new Error('Expense deletion failed');
    const reversalId = await postExpenseJournal(oldExp, -1, req.user?.email, conn, tenantId);
    if (!reversalId) throw new Error('Expense reversal posting failed');
    // A numbered expense that is deleted leaves a hole in the branch's run: the managers are told which.
    if (oldExp.expense_no) {
      await insertNotification(conn, 'payment', '⚠️ مصروف اتمسح من التسلسل',
        `مصروف رقم ${oldExp.expense_no} (${oldExp.branch_id === 'branch-tagamoa' ? 'التجمع' : 'الدقي'}) — ${Number(oldExp.amount)} ${oldExp.currency || 'EGP'} اتمسح بواسطة ${req.staffRecord?.name || req.user?.email || 'المدير'}`,
        { expenseNo: oldExp.expense_no, branchId: oldExp.branch_id, expenseId: oldExp.id, tab: 'financial' }, tenantId, null).catch(() => {});
    }
    await conn.commit();
    transactionStarted = false;
    res.json({ ok: true });
  } catch (e) {
    if (transactionStarted) await conn.rollback().catch(() => {});
    if (e.status) return res.status(e.status).json({ error: e.message, code: e.code });
    routeError(res, e);
  } finally { conn.release(); }
});

// «سجل النظام … اسم المسئول مش ايميله ومحتاجين يضاف القسم». Each row with the
// employee's name and department, the part of the system, and what was done in
// words (lib/activityDescribe.js) — old rows resolved from their email and the
// path their label kept. Filtered here, not in the browser: the screen held the
// last 200 rows and searched those.
router.get('/api/admin/activity-logs', requireAuth, requireAdminOrStaff, requirePermission('view_activity'), async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 200, 500);
    const offset = parseOffset(req.query.offset);
    const where = ['a.tenant_id=?'];
    const params = [req.tenantId];
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('a.at >= ?'); params.push(cairoDayStartUtc(from)); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('a.at < ?'); params.push(cairoDayStartUtc(addDaysToDateOnly(to, 1))); }
    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      where.push('(a.label LIKE ? OR a.details LIKE ? OR a.actor_name LIKE ? OR st.name LIKE ? OR a.entity_id = ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q);
    }
    const department = String(req.query.department || '');
    const section = String(req.query.section || '');
    const actor = String(req.query.actor || '').trim();
    if (actor) { where.push('COALESCE(a.actor_name, st.name, a.actor) = ?'); params.push(actor); }
    // The page is cut from the log first and only then joined to the staff. The join's `email = actor OR id = actor`
    // cannot use an index, and with it in the same statement as the ORDER BY the optimizer read 127,000 of the log's
    // 250,000 rows into a temporary table to sort them (2.5 s on the lab; the page alone is 0.07 s). A search or an
    // actor filter does need the staff's name, so those keep the single statement.
    const joinedColumns = `COALESCE(a.actor_name, st.name) AS actor_name, COALESCE(a.department, d.name) AS department, st.role AS actor_role`;
    const joins = `LEFT JOIN staff st ON st.tenant_id=a.tenant_id AND (st.email=a.actor OR st.id=a.actor)
         LEFT JOIN hr_departments d ON d.id=st.department_id AND d.tenant_id=st.tenant_id`;
    const searchesStaff = Boolean(q || actor);
    const [rows] = await pool.query(
      searchesStaff
        ? `SELECT a.id, a.action, a.entity, a.entity_id, a.label, a.actor, a.at, a.details, ${joinedColumns}
             FROM activity_logs a
             ${joins}
            WHERE ${where.join(' AND ')}
            ORDER BY a.at DESC LIMIT ? OFFSET ?`
        : `SELECT a.id, a.action, a.entity, a.entity_id, a.label, a.actor, a.at, a.details, ${joinedColumns}
             FROM (SELECT * FROM activity_logs a WHERE ${where.join(' AND ')} ORDER BY a.at DESC LIMIT ? OFFSET ?) a
             ${joins}
            ORDER BY a.at DESC`,
      // A department or a part of the system is resolved per row (old rows
      // carry neither), so those filters read a wider page and keep `limit`.
      [...params, department || section ? Math.min(limit * 6, 3000) : limit, offset]);
    const owners = new Set(listEnv('ADMIN_EMAILS').map(email => email.toLowerCase()));
    res.json(rows.map(row => {
      const described = describeLabel(row.label, row.entity);
      const isOwner = owners.has(String(row.actor || '').toLowerCase());
      return {
        id: row.id,
        action: row.action,
        entity: row.entity,
        entityId: row.entity_id,
        label: described.text,
        // A row whose label was not a sentence keeps it as its details.
        details: row.details || (described.text !== row.label && !/^(create|update|delete) \//.test(row.label || '') ? row.label : null),
        actor: row.actor,
        actorName: row.actor_name || (isOwner ? 'المالك' : SYSTEM_ACTORS[row.actor] || (looksLikeAddress(row.actor) ? 'موظف سابق' : row.actor)),
        department: row.department || departmentOf({ role: row.actor_role, isOwner }) || '—',
        section: described.area,
        at: row.at,
      };
    }).filter(row => (!department || row.department === department) && (!section || row.section === section)).slice(0, limit));
  } catch (e) { routeError(res, e); }
});

// Reading the log is view_activity; writing one stays with the owner. Nothing
// calls this — the panel's logActivity() is declared and never used, and the
// rows that matter are written server-side beside the change they describe.
router.post('/api/admin/activity-logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    // An audit row records what happened, independently of who is acting — so
    // the caller describes the event and the server decides who did it, when,
    // and under which id.
    //
    // `actor`, `at` and `id` used to come from the request body. An admin could
    // therefore write a row under anybody's name at any timestamp, which makes
    // the log worthless as evidence about an admin; and a chosen `id` with
    // INSERT IGNORE could pre-empt a genuine row that arrived later.
    const a = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO activity_logs (id, tenant_id, action, entity, entity_id, label, actor, at) VALUES (?,?,?,?,?,?,?,?)',
      [id, req.tenantId, a.action || '', a.entity || '', a.entity_id || null,
       a.label || a.entity_name || a.entity || 'activity',
       req.user?.email || req.user?.uid || 'admin',
       new Date().toISOString()]
    );
    res.json({ ok: true, id });
  } catch (e) { routeError(res, e); }
});

// The applications' scope — tenant, ?type, ?form and the branch HR's reach — shared by the list and its counts,
// so a count is of exactly the rows the list would hold.
function joinUsWhere(req) {
  const params = [];
  let where = appendTenantScope('WHERE 1=1', 'j', scopedTenantId(req), params);
  if (req.query.type && req.query.type !== 'all') {
    where += ' AND j.type = ?';
    params.push(String(req.query.type).toUpperCase());
  }
  // ?form=teaching|staff — the two lists the owner asked to be kept apart.
  if (['teaching', 'staff'].includes(String(req.query.form || ''))) {
    where += " AND COALESCE(j.source_form, IF(j.type='EMPLOYEE','staff','teaching')) = ?";
    params.push(String(req.query.form));
  }
  // ?inbox=1 — the page HR works from: an application that has been moved to the
  // interviews (its applicant is at interview or offer) lives there, not here.
  // The other screens that count applications leave it off and still see them.
  if (req.query.inbox === '1') where += JOIN_US_INBOX_SQL;
  const reach = joinUsReachSql(req.recruitReach, 'j', 'a', 'jp');
  where += reach.sql;
  params.push(...reach.params);
  return { where, params };
}

const JOIN_US_FROM = `FROM join_us_applications j
         LEFT JOIN job_applicants a
           ON a.id=j.converted_applicant_id AND a.tenant_id=j.tenant_id
         LEFT JOIN job_postings jp ON jp.id=a.job_id AND jp.tenant_id=a.tenant_id`;

// «عدد طلبات انضمام الموظفين مكتوب 427 وفي مكان تاني 1285»: the list below stopped at 500 rows, newest first,
// and every screen counted what reached it — so a tab of 1,285 applications showed the staff ones among the
// newest 500. The figures are counted here, in the database, over the whole scope.
router.get('/api/admin/join-us/counts', requireAuth, requireAdminOrStaff, requireAnyPermission('view_join_us', 'branch_hr'), requireRecruiting('view_join_us'), async (req, res) => {
  try {
    const { where, params } = joinUsWhere(req);
    const [rows] = await pool.query(
      `SELECT COALESCE(j.source_form, IF(j.type='EMPLOYEE','staff','teaching')) AS form,
              UPPER(COALESCE(NULLIF(j.status,''),'NEW')) AS status, COUNT(*) AS n
         FROM join_us_applications j
         LEFT JOIN job_applicants a ON a.id=j.converted_applicant_id AND a.tenant_id=j.tenant_id
         LEFT JOIN job_postings jp ON jp.id=a.job_id AND jp.tenant_id=a.tenant_id
         ${where}
        GROUP BY form, status`, params);
    const out = { total: 0, byForm: { staff: 0, teaching: 0 }, byStatus: {}, byFormStatus: { staff: {}, teaching: {} } };
    for (const row of rows) {
      const n = Number(row.n) || 0;
      const form = row.form === 'staff' ? 'staff' : 'teaching';
      out.total += n;
      out.byForm[form] += n;
      out.byStatus[row.status] = (out.byStatus[row.status] || 0) + n;
      out.byFormStatus[form][row.status] = (out.byFormStatus[form][row.status] || 0) + n;
    }
    res.json(out);
  } catch (e) { routeError(res, e); }
});

// The Dokki manager reaches the applications for Dokki — «اتاكد ان طلبات الانضمام
// للدقي والانترفيو للدقي بيظهر لنشوي مدير الدقي» (12 Oct 2026); lib/branchHr.js.
// ?limit (≤ 1000, default 500) and ?offset page it: the screens read every page.
// «زحمة الطلبات»: GET /api/admin/join-us was 554,000 requests in two months — 13% of all the API's traffic — because every open admin tab
// downloaded the whole list again every two minutes. This answers in one cheap query whether anything in the caller's scope changed (how many,
// and a checksum of what a person can change on an application), so the tab downloads the list only when it did.
router.get('/api/admin/join-us/fingerprint', requireAuth, requireAdminOrStaff, requireAnyPermission('view_join_us', 'branch_hr'), requireRecruiting('view_join_us'), async (req, res) => {
  try {
    const { where, params } = joinUsWhere(req);
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(CRC32(CONCAT_WS('|', j.status, IFNULL(j.assigned_to, ''), IFNULL(j.reviewed_at, ''), IFNULL(j.contacted_at, ''),
                IFNULL(j.first_call_at, ''), IFNULL(j.interview_at, ''), IFNULL(j.converted_applicant_id, ''), IFNULL(a.stage, ''),
                IFNULL(a.hired_staff_id, ''), CHAR_LENGTH(IFNULL(j.admin_note, ''))))), 0) AS h
         ${JOIN_US_FROM} ${where}`, params);
    res.set('Cache-Control', 'no-store');
    res.json({ fingerprint: `${Number(row.n) || 0}:${row.h}` });
  } catch (error) {
    logger.error('[join-us/fingerprint]', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/api/admin/join-us', requireAuth, requireAdminOrStaff, requireAnyPermission('view_join_us', 'branch_hr'), requireRecruiting('view_join_us'), async (req, res) => {
  try {
    const { where, params } = joinUsWhere(req);
    // ?paged=1 is the page HR works from: the filters run here and it answers { rows, total } for
    // the 50 it was asked for, instead of the whole table for the browser to sift.
    const paged = req.query.paged === '1';
    const filter = paged ? joinUsFilterSql(req.query) : { sql: '', params: [] };
    const scope = { where: where + filter.sql, params: [...params, ...filter.params] };
    const limit = paged ? pageOf(req.query).limit : Math.min(1000, Math.max(1, Math.floor(Number(req.query.limit)) || 500));
    const offset = Math.max(0, Math.floor(Number(req.query.offset)) || 0);
    // contacted_at, contacted_by and interview_at are selected because the
    // screen needs them and this query never returned them. POST
    // /api/admin/join-us/:id/contact writes all three of the things being looked
    // for — the timestamp, the staff member, and a note row — and then the list
    // the user lands back on returned none of it. app.contactedAt was therefore
    // always undefined, which does more than hide a date: the whole
    // "التقييم بعد التواصل" block renders behind that field, so recording a call
    // left the page looking as though nothing had happened.
    //
    // The note comes back with it. Storing what was said on the call and showing
    // no trace of it is the same bug wearing a different hat, and it is the half
    // that was actually asked about — "مش بيظهر اللي كتبته".
    const [rows] = await pool.query(
      `SELECT j.id, j.name, j.email, j.phone, j.specialty, j.experience, j.type,
              j.linkedin, j.message, j.status, j.admin_note, j.created_at,
              j.converted_applicant_id, j.reviewed_at, j.assigned_to,
              j.contacted_at, j.contacted_by,
              DATE_FORMAT(j.interview_at,'%Y-%m-%d %H:%i:%s') interview_at,
              cn.body contact_note, cn.author_name contacted_by_name,
              cn.created_at contact_note_at,
              a.stage applicant_stage, a.hired_staff_id,
              DATE_FORMAT(a.interview_at,'%Y-%m-%d %H:%i:%s') applicant_interview_at,
              -- The branch the applicant chose, else their posting's — the same
              -- rule lib/branchHr.js narrows the Dokki manager's list by.
              LOWER(COALESCE(NULLIF(j.branch,''), NULLIF(a.branch,''), NULLIF(jp.branch,''))) applicant_branch,
              a.education, a.experience_years, a.experience_places, a.phone_interview_result,
              a.job_id, jp.title job_title,
              COALESCE(j.source_form, IF(j.type='EMPLOYEE','staff','teaching')) source_form,
              j.lectured_before, j.sessions_before, j.programs_json, j.programs_other,
              j.first_call_rating, j.first_call_tags, j.first_call_notes, j.first_call_at, j.first_call_by_name
         FROM join_us_applications j
         LEFT JOIN job_applicants a
           ON a.id=j.converted_applicant_id AND a.tenant_id=j.tenant_id
         LEFT JOIN job_postings jp ON jp.id=a.job_id AND jp.tenant_id=a.tenant_id
         -- The latest call from either screen: the interviews screen logs its
         -- calls against the applicant, this list against the application.
         LEFT JOIN recruitment_notes cn ON cn.id = (
           SELECT n.id FROM recruitment_notes n
            WHERE n.tenant_id=j.tenant_id AND n.kind='contact'
              AND ((n.ref_type='join_us' AND n.ref_id=j.id)
                OR (n.ref_type='applicant' AND n.ref_id=j.converted_applicant_id))
            ORDER BY n.created_at DESC LIMIT 1)
         ${scope.where}
        ORDER BY j.created_at DESC, j.id DESC LIMIT ${limit} OFFSET ${offset}`,
      scope.params);
    const mapped = rows.map(r => ({
      ...r,
      application_category: r.source_form === 'staff' ? 'HR' : 'ACADEMIC',
      programs: readPrograms(r.programs_json),
      first_call_tags: (() => { try { return JSON.parse(r.first_call_tags || '[]'); } catch { return []; } })(),
      programs_json: undefined,
    }));
    if (!paged) return res.json(mapped);
    // A short first page is its own total; only a full one needs the count query.
    let total = offset + mapped.length;
    if (mapped.length === limit) {
      const [[row]] = await pool.query(`SELECT COUNT(*) n ${JOIN_US_FROM} ${scope.where}`, scope.params);
      total = Number(row.n) || total;
    }
    res.json({ rows: mapped, total });
  } catch (e) { routeError(res, e); }
});

// What the filter pickers offer for one list — the postings, branches and programmes that exist in it, with
// how many applications each holds. Read once when the page opens, not worked out from every row in the browser.
router.get('/api/admin/join-us/facets', requireAuth, requireAdminOrStaff, requireAnyPermission('view_join_us', 'branch_hr'), requireRecruiting('view_join_us'), async (req, res) => {
  try {
    const { where, params } = joinUsWhere(req);
    const [jobs] = await pool.query(
      `SELECT a.job_id id, jp.title, COUNT(*) n ${JOIN_US_FROM} ${where} AND a.job_id IS NOT NULL
        GROUP BY a.job_id, jp.title ORDER BY n DESC LIMIT 100`, params);
    const [branches] = await pool.query(
      `SELECT LOWER(COALESCE(NULLIF(j.branch,''), NULLIF(a.branch,''), NULLIF(jp.branch,''))) branch, COUNT(*) n
         ${JOIN_US_FROM} ${where} GROUP BY branch HAVING branch IS NOT NULL ORDER BY n DESC`, params);
    const [programRows] = await pool.query(
      `SELECT j.programs_json ${JOIN_US_FROM} ${where} AND j.programs_json IS NOT NULL AND j.programs_json <> '[]' LIMIT 5000`, params);
    const programs = new Map();
    for (const row of programRows) {
      for (const program of readPrograms(row.programs_json)) programs.set(program.title, (programs.get(program.title) || 0) + 1);
    }
    res.json({
      jobs: jobs.map(row => ({ id: row.id, title: row.title || null, count: Number(row.n) || 0 })),
      branches: branches.filter(row => row.branch).map(row => ({ key: row.branch, count: Number(row.n) || 0 })),
      programs: [...programs.entries()].sort((x, y) => y[1] - x[1]).map(([title, count]) => ({ title, count })),
    });
  } catch (e) { routeError(res, e); }
});

router.patch('/api/admin/join-us/:id', requireAuth, requireAdminOrStaff, requireAnyPermission('manage_join_us', 'branch_hr'), requireRecruiting('manage_join_us'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { status, notes } = req.body;
    const nextStatus = String(status || '').toUpperCase();
    // CONTACTED is the status the contact button sets; refusing it here meant an
    // application already rung could not be put back to «تم التواصل» by hand.
    if (!['NEW', 'REVIEWED', 'CONTACTED', 'ACCEPTED', 'REJECTED'].includes(nextStatus)) {
      return res.status(400).json({ error: 'Invalid application status' });
    }
    await conn.beginTransaction();
    const [[application]] = await conn.query(
      'SELECT id,status,converted_applicant_id FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, scopedTenantId(req)]
    );
    if (!application) {
      await conn.rollback();
      return res.status(404).json({ error: 'Application not found' });
    }
    if (!await joinUsInReach(conn, req, req.params.id)) {
      await conn.rollback();
      return outOfRecruitReach(res);
    }
    // A status change that sends no note keeps the note: `notes` absent used to
    // be written as NULL, so changing the status from the card wiped what HR had
    // written on it.
    await conn.query(
      `UPDATE join_us_applications
          SET status=?,admin_note=${notes === undefined ? 'admin_note' : '?'},
              reviewed_at=${nextStatus === 'NEW' ? 'reviewed_at' : 'COALESCE(reviewed_at,NOW())'}
        WHERE id=? AND tenant_id=?`,
      [nextStatus, ...(notes === undefined ? [] : [notes || null]), req.params.id, scopedTenantId(req)]
    );

    // Accepting is what puts someone into the hiring pipeline. Until now it only
    // changed a status column: the person never appeared under interviews, and
    // whoever accepted them had to re-enter the same details by hand through the
    // separate to-applicant action to be able to hire them at all.
    //
    // convertJoinUs is the same helper that action uses — idempotent, and it
    // returns the existing id if this application was already converted.
    let convertedApplicantId = null;
    if (nextStatus === 'ACCEPTED' && !application.converted_applicant_id) {
      const [[full]] = await conn.query(
        'SELECT * FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1',
        [req.params.id, scopedTenantId(req)]
      );
      convertedApplicantId = await convertJoinUs(full, { actorId: req.staffRecord?.id, db: conn });
      // convertJoinUs marks the source REVIEWED; the reviewer said ACCEPTED.
      await conn.query(
        'UPDATE join_us_applications SET status=? WHERE id=? AND tenant_id=?',
        [nextStatus, req.params.id, scopedTenantId(req)]
      );
    }
    // The applicant lands at the interview stage, which is the screen the
    // reviewer expects to find them on next — through the legal hops, and for an
    // application already in the pipeline too (every website application is,
    // from the moment it arrives, so this used to move nobody).
    if (nextStatus === 'ACCEPTED' && application.status !== 'ACCEPTED') {
      const applicantId = convertedApplicantId || application.converted_applicant_id;
      if (applicantId) {
        await advanceToInterview(conn, {
          tenantId: scopedTenantId(req), applicantId, actorId: req.staffRecord?.id, interviewAt: null,
        });
      }
    }

    await writeAuditEvent({
      action: 'hr.join_application.updated',
      entityType: 'join_us_application',
      entityId: req.params.id,
      metadata: { from: application.status, to: nextStatus, applicant_id: convertedApplicantId },
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    routeError(res, e);
  } finally {
    conn.release();
  }
});

router.delete('/api/admin/join-us/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_join_us'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[application]] = await conn.query(
      'SELECT id,converted_applicant_id FROM join_us_applications WHERE id=? AND tenant_id=? LIMIT 1 FOR UPDATE',
      [req.params.id, scopedTenantId(req)]
    );
    if (!application) {
      await conn.rollback();
      return res.status(404).json({ error: 'Application not found' });
    }
    // A converted application used to be undeletable outright. In practice every
    // application on this tenant is converted the moment it is looked at, so the
    // delete button could never succeed for any row anyone could see — it always
    // came back 409 telling the desk to reject instead, which is not the same
    // thing as removing a duplicate or a test submission.
    //
    // Deleting is allowed now, but the recruitment record is NOT destroyed with
    // it: job_applicants carries the interview history, grades and audit trail,
    // and that must outlive the website submission it happened to arrive
    // through. The link is cleared instead, so the applicant survives as a
    // normally-sourced candidate and nothing is left pointing at a row that no
    // longer exists.
    if (application.converted_applicant_id) {
      await conn.query(
        "UPDATE job_applicants SET source='manual', source_id=NULL, updated_by=? WHERE id=? AND tenant_id=?",
        [req.staffRecord?.id || null, application.converted_applicant_id, scopedTenantId(req)]
      );
    }
    await conn.query(
      'DELETE FROM join_us_applications WHERE id=? AND tenant_id=?',
      [req.params.id, scopedTenantId(req)]
    );
    await writeAuditEvent({
      action: 'hr.join_application.deleted',
      entityType: 'join_us_application',
      entityId: req.params.id,
      severity: 'warning',
      req,
      db: conn,
    });
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback().catch(() => {});
    routeError(res, e);
  } finally {
    conn.release();
  }
});

router.get('/api/admin/contact-messages', requireAuth, requireAdminOrStaff, requirePermission('view_contacts'), async (req, res) => {
  try {
    const status = req.query.status && req.query.status !== 'all' ? String(req.query.status) : null;
    const [rows] = await pool.query(
      `SELECT id, name, email, phone, subject, message, status, admin_note, created_at
       FROM contact_messages
       WHERE tenant_id=? AND (? IS NULL OR status=?)
       ORDER BY (status = 'NEW') DESC, created_at DESC LIMIT 500`,
      [scopedTenantId(req), status, status]);
    // The screen reads createdAt and adminNote and compares the status in
    // lower case; the row carries created_at, admin_note and an upper-case
    // enum. So every date under a sender's name was blank, «ملاحظة الإدارة»
    // was always empty, and all three filter tabs counted zero.
    res.json(rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      subject: row.subject,
      message: row.message,
      status: String(row.status || 'NEW').toLowerCase(),
      adminNote: row.admin_note || undefined,
      createdAt: row.created_at,
    })));
  } catch (e) { routeError(res, e); }
});

router.patch('/api/admin/contact-messages/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_contacts'), async (req, res) => {
  try {
    // The note is saved as well as the status. The desk has always been able to
    // type one — the client sends adminNote — but this only ever wrote status,
    // so the note was accepted by the screen and dropped on the way past.
    const note = req.body.adminNote ?? req.body.admin_note;
    const sets = ['status=?'];
    const params = [String(req.body.status || 'new').toUpperCase()];
    if (note !== undefined) { sets.push('admin_note=?'); params.push(String(note).slice(0, 5000) || null); }
    await pool.query(
      `UPDATE contact_messages SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`,
      [...params, req.params.id, scopedTenantId(req)]
    );
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.delete('/api/admin/contact-messages/:id', requireAuth, requireAdminOrStaff, requirePermission('manage_contacts'), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM contact_messages WHERE id=? AND tenant_id=?',
      [req.params.id, scopedTenantId(req)]
    );
    res.json({ ok: true });
  } catch (e) { routeError(res, e); }
});

router.get('/api/admin/quiz-attempts', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit, 500, 2000);
    const [rows] = await pool.query(
      'SELECT id, subscriber_id, quiz_id, course_id, score, passed, answers_json, taken_at FROM quiz_attempts WHERE tenant_id=? ORDER BY taken_at DESC LIMIT ?',
      [scopedTenantId(req), limit]
    );
    res.json(rows);
  } catch (e) { routeError(res, e); }
});

router.post('/api/admin/next-client-code', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const code = await getNextClientCode(conn, scopedTenantId(req));
    await conn.commit();
    res.json({ ok: true, code });
  } catch (e) {
    await conn.rollback().catch(() => {});
    routeError(res, e);
  } finally { conn.release(); }
});

router.post('/api/admin/sync-client-code-counter', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[subMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM subscribers WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'`,
      [scopedTenantId(req)]
    );
    const [[leadMax]] = await conn.query(
      `SELECT MAX(CAST(SUBSTRING(client_code, 2) AS UNSIGNED)) AS mx
       FROM leads WHERE tenant_id=? AND client_code REGEXP '^C[0-9]+$'`,
      [scopedTenantId(req)]
    );
    const maxVal = Math.max(subMax.mx || 0, leadMax.mx || 0);
    const newNext = maxVal >= 10000 ? maxVal + 1 : 10001;
    await raiseClientCodeCounter(conn, scopedTenantId(req), newNext);
    const counterNow = await lockClientCodeCounter(conn, scopedTenantId(req));
    await conn.commit();
    res.json({ ok: true, maxExisting: maxVal, counterNow });
  } catch (e) {
    await conn.rollback();
    routeError(res, e);
  } finally { conn.release(); }
});

router.post('/api/admin/client-code', requireAuth, requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const next = await lockClientCodeCounter(conn, scopedTenantId(req));
    await setClientCodeCounter(conn, scopedTenantId(req), next + 1);
    await conn.commit();
    res.json({ ok: true, code: `C${next}` });
  } catch (e) {
    await conn.rollback();
    routeError(res, e);
  } finally { conn.release(); }
});

module.exports = router;
