'use strict';

const { isCashMethod } = require('./incomingTransfers');

/**
 * Who may accept a payment outright, and who has to tie it to a transfer first.
 *
 * The manager accepts. Everybody else who holds the financial permission — the
 * accountant, the Dokki manager, the online manager — confirms a payment against
 * the transfer that brought the money («🔗 ربط»), because their sign-off is what
 * says the money arrived and a bank or wallet transfer is the proof of it. Cash is
 * counted, not transferred (lib/incomingTransfers.js isCashMethod), so it has
 * nothing to link.
 *
 * Held here so the orders route and the payments route cannot drift apart: this
 * was enforced for one recorder's role, in one of the two.
 */
const DIRECT_APPROVER_ROLES = new Set(['admin', 'manager']);

function approverRoleOf(req) {
  return String(req?.staffRecord?.role || '').toLowerCase();
}

/** True when this caller must supply a transfer to approve a payment made by `method`. */
function mustLinkTransfer(req, method) {
  if (req?.isSuperAdmin) return false;
  if (DIRECT_APPROVER_ROLES.has(approverRoleOf(req))) return false;
  return !isCashMethod(method);
}

const TRANSFER_REQUIRED = Object.freeze({
  status: 400,
  body: { error: 'اربط الدفعة بالتحويل اللي وصل قبل الاعتماد', code: 'TRANSFER_REQUIRED' },
});

module.exports = { mustLinkTransfer, approverRoleOf, DIRECT_APPROVER_ROLES, TRANSFER_REQUIRED };
