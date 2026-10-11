'use strict';

// «سيرش واحد للسيستم كله» (11 Oct 2026): one box in the admin's header that
// finds a client, a lead, a payment by its transaction number, a certificate or
// a ticket — GET /api/search?scope=system.
//
// Each kind is searched only for an account that may open it, by the permission
// its own screen asks for, and inside the same scope that screen applies: a
// sales rep finds their own leads, a branch manager their branch's clients and
// payments, customer service the tickets of its departments. Read the way every
// list reads a search box (lib/searchText.js): from the second letter, «احمد»
// finds «أحمد», and a phone needs three digits, matched with or without its 0.

const { pool } = require('./db');
const { hasPermission } = require('../constants/permissions');
const { financialScopeClause, resolveFinancialScope } = require('./financialScope');
const { leadScope } = require('./leadAccess');
const { identitySpellings } = require('./phoneNumber');
const { getMfaPolicy, policyRequiresStaff } = require('./mfaPolicy');
const { SEARCH_MIN_CHARS, foldText, foldedSql, searchNumber } = require('./searchText');

const PER_KIND = 8;
// Any one of these opens the box; each kind then needs its own.
const SYSTEM_SEARCH_PERMISSIONS = Object.freeze(['view_subscribers', 'view_client_db', 'view_leads', 'view_financial', 'manage_certificates', 'manage_inbox']);
const escapeLike = value => String(value).replace(/[\\%_]/g, match => `\\${match}`);

/**
 * How a person row (a client, a lead, a sign-up) matches the box: a full number
 * by every spelling it can be stored as; anything else by name, email and code,
 * and — three digits or more — the digits of the phone.
 */
function personMatch(query, alias, { withCode = true } = {}) {
  const q = foldText(query);
  const number = searchNumber(q);
  const digits = number ? number.digits : '';
  if (digits.length >= 8) {
    return {
      sql: `(${alias}.phone IN (?) OR ${alias}.phone LIKE ?)`,
      params: [[...new Set([digits, ...identitySpellings(digits)])], `%${escapeLike(digits.slice(-9))}%`],
    };
  }
  const like = `%${escapeLike(q)}%`;
  const shortNumber = number ? `%${number.core}%` : null;
  return {
    sql: `(${foldedSql(`${alias}.name`)} LIKE ? OR LOWER(COALESCE(${alias}.email, '')) LIKE ?`
      + (withCode ? ` OR LOWER(COALESCE(${alias}.client_code, '')) LIKE ?` : '')
      + (shortNumber ? ` OR REGEXP_REPLACE(COALESCE(${alias}.phone, ''), '[^0-9]', '') LIKE ?` : '') + ')',
    params: [like, like, ...(withCode ? [like] : []), ...(shortNumber ? [shortNumber] : [])],
  };
}

/** The kinds this account may search, each by the permission its own screen asks for. */
async function searchableKinds(req) {
  const staff = req.staffRecord || null;
  const holds = permission => req.isSuperAdmin || hasPermission(staff, permission);
  // A permission the tenant's policy puts behind a second factor is searched
  // only in a verified session, as its own screen would ask for one.
  const policy = req.isSuperAdmin || req.user?.mfa_verified ? null : await getMfaPolicy(req.tenantId).catch(() => null);
  const unlocked = permission => !policy || !policyRequiresStaff(policy, staff, [permission]);
  const may = (...permissions) => permissions.some(permission => holds(permission) && unlocked(permission));
  return {
    clients: may('view_subscribers', 'view_client_db'),
    leads: may('view_leads'),
    payments: may('view_financial'),
    certificates: may('manage_certificates'),
    tickets: may('manage_inbox'),
  };
}

const EMPTY = Object.freeze({ clients: [], leads: [], payments: [], certificates: [], tickets: [] });

async function searchSystem(req, rawQuery, db = pool) {
  const q = foldText(String(rawQuery || '').slice(0, 80));
  if (q.length < SEARCH_MIN_CHARS) return { ...EMPTY, kinds: [] };
  const kinds = await searchableKinds(req);
  const tenantId = req.tenantId;
  const like = `%${escapeLike(q)}%`;
  const number = searchNumber(q);
  const subScope = financialScopeClause(resolveFinancialScope(req, { allowAssigned: true }), { branchColumn: 's.branch_id', subscriberAlias: 's' });
  const noClients = subScope.sql === ' AND 1=0';

  const clients = async () => {
    if (!kinds.clients || noClients) return [];
    const match = personMatch(q, 's');
    const [rows] = await db.query(
      `SELECT s.id, s.client_code, s.name, s.phone, s.email, s.branch
         FROM subscribers s
        WHERE s.tenant_id = ? AND s.deleted_at IS NULL AND ${match.sql}${subScope.sql}
        ORDER BY s.created_at DESC LIMIT ${PER_KIND}`,
      [tenantId, ...match.params, ...subScope.params]);
    return rows.map(row => ({
      id: row.id, title: row.name || row.email || row.phone || '—',
      subtitle: [row.client_code, row.phone, row.email].filter(Boolean).join(' · '),
      branch: row.branch || null, open: { client: row.client_code || row.id },
    }));
  };

  const leads = async () => {
    const range = leadScope(req, 'l');
    if (!kinds.leads || range.none) return [];
    const match = personMatch(q, 'l');
    const [rows] = await db.query(
      `SELECT l.id, l.client_code, l.name, l.phone, l.email, l.status, l.branch
         FROM leads l
        WHERE l.tenant_id = ? AND l.hidden = 0 AND l.deleted_at IS NULL AND l.merged_into_lead_id IS NULL
          AND ${match.sql}${range.sql}
        ORDER BY l.created_at DESC LIMIT ${PER_KIND}`,
      [tenantId, ...match.params, ...range.params]);
    return rows.map(row => ({
      id: row.id, title: row.name || row.phone || '—',
      subtitle: [row.client_code, row.phone, row.status].filter(Boolean).join(' · '),
      branch: row.branch || null, open: { client: row.client_code || row.id },
    }));
  };

  // «رقم العملية»: what the desk typed from the receipt or the wallet's SMS, or
  // the system's own payment number.
  const payments = async () => {
    if (!kinds.payments || noClients) return [];
    const scope = financialScopeClause(resolveFinancialScope(req, { allowAssigned: true }), { branchColumn: 'p.branch_id', subscriberAlias: 's' });
    const byNumber = number && /^\d+$/.test(number.digits) ? number.digits : null;
    const [rows] = await db.query(
      `SELECT p.id, p.payment_no, p.transaction_id, p.amount, p.currency, p.date, p.status, p.payment_method,
              s.id AS subscriber_id, s.client_code, s.name AS subscriber_name
         FROM payments p
         LEFT JOIN subscribers s ON s.id = p.subscriber_id AND s.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND p.deleted_at IS NULL
          AND (LOWER(COALESCE(p.transaction_id, '')) LIKE ?${byNumber ? ' OR p.payment_no = ?' : ''})${scope.sql}
        ORDER BY p.date DESC LIMIT ${PER_KIND}`,
      [tenantId, like, ...(byNumber ? [byNumber] : []), ...scope.params]);
    return rows.map(row => ({
      id: row.id,
      title: `${Math.round(Number(row.amount) || 0).toLocaleString('en-US')} ${row.currency || 'EGP'} — ${row.subscriber_name || 'بدون عميل'}`,
      subtitle: [row.transaction_id && `رقم العملية ${row.transaction_id}`, row.payment_no && `دفعة #${row.payment_no}`,
        row.payment_method, row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date || '').slice(0, 10)]
        .filter(Boolean).join(' · '),
      status: row.status || null,
      open: row.subscriber_id ? { client: row.client_code || row.subscriber_id } : { tab: 'financial' },
    }));
  };

  // The institute's certificate by its code (course_completions), and a request
  // by the name or national id written on it.
  const certificates = async () => {
    if (!kinds.certificates) return [];
    const [[issued], [requested]] = await Promise.all([
      db.query(
        `SELECT cc.id, cc.certificate_code, cc.completed_at, s.id AS subscriber_id, s.client_code, s.name,
                COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
           FROM course_completions cc
           JOIN subscribers s ON s.id = cc.subscriber_id AND s.tenant_id = cc.tenant_id AND s.deleted_at IS NULL
           LEFT JOIN courses c ON c.id = cc.course_id AND c.tenant_id = cc.tenant_id
          WHERE cc.tenant_id = ? AND cc.status = 'active' AND LOWER(COALESCE(cc.certificate_code, '')) LIKE ?
          ORDER BY cc.completed_at DESC LIMIT ${PER_KIND}`,
        [tenantId, like]),
      db.query(
        `SELECT cr.id, cr.status, cr.name_ar, cr.name_en, s.id AS subscriber_id, s.client_code, s.name,
                COALESCE(NULLIF(c.title_ar, ''), c.title) AS course_title
           FROM certificate_requests cr
           LEFT JOIN subscribers s ON s.id = cr.subscriber_id AND s.tenant_id = cr.tenant_id AND s.deleted_at IS NULL
           LEFT JOIN courses c ON c.id = cr.course_id AND c.tenant_id = cr.tenant_id
          WHERE cr.tenant_id = ?
            AND (${foldedSql('cr.name_ar')} LIKE ? OR LOWER(COALESCE(cr.name_en, '')) LIKE ? OR COALESCE(cr.id_number, '') LIKE ?)
          ORDER BY cr.requested_at DESC LIMIT ${PER_KIND}`,
        [tenantId, like, like, like]),
    ]);
    return [
      ...issued.map(row => ({
        id: row.id, title: `${row.certificate_code} — ${row.name || ''}`.trim(),
        subtitle: ['شهادة المعهد', row.course_title].filter(Boolean).join(' · '),
        open: { client: row.client_code || row.subscriber_id },
      })),
      ...requested.map(row => ({
        id: row.id, title: row.name_ar || row.name_en || row.name || '—',
        subtitle: ['طلب شهادة', row.course_title, row.status].filter(Boolean).join(' · '),
        open: row.subscriber_id ? { client: row.client_code || row.subscriber_id } : { tab: 'cert_requests' },
      })),
    ].slice(0, PER_KIND);
  };

  const tickets = async () => {
    if (!kinds.tickets) return [];
    const scope = require('../routes/support').ticketScope(req);
    if (scope.sql === '1=0') return [];
    const [rows] = await db.query(
      `SELECT t.id, t.ticket_code, t.subject, t.status, t.subscriber_name, t.created_at
         FROM support_tickets t
        WHERE t.tenant_id = ? AND t.deleted_at IS NULL AND ${scope.sql}
          AND (LOWER(COALESCE(t.ticket_code, '')) LIKE ? OR ${foldedSql('t.subject')} LIKE ? OR ${foldedSql('t.subscriber_name')} LIKE ?)
        ORDER BY t.created_at DESC LIMIT ${PER_KIND}`,
      [tenantId, ...scope.params, like, like, like]);
    return rows.map(row => ({
      id: row.id, title: row.subject || row.ticket_code || '—',
      subtitle: [row.ticket_code, row.subscriber_name, row.status].filter(Boolean).join(' · '),
      open: { tab: 'tickets', ticket: row.id },
    }));
  };

  const [clientRows, leadRows, paymentRows, certificateRows, ticketRows] = await Promise.all([
    clients(), leads(), payments(), certificates(), tickets(),
  ]);
  return {
    clients: clientRows, leads: leadRows, payments: paymentRows, certificates: certificateRows, tickets: ticketRows,
    kinds: Object.keys(kinds).filter(kind => kinds[kind]),
  };
}

module.exports = { PER_KIND, SYSTEM_SEARCH_PERMISSIONS, personMatch, searchSystem, searchableKinds };
