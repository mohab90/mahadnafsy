'use strict';

// Who may book, and open the file of, a client who is not theirs.
//
// «لو حد من السيلز بعت عميل لفرع الدقي هيشوفه ازاي ويحجزه ازاي؟» — and the owner's decision (19 Oct 2026): «هنخلي مسئولين
// خدمة العملاء والدقي فقط يشوفوا كل العملاء، الباقي لا خليه مقفول». So this is exactly two desks, named here and nowhere
// else: customer service, and the Dokki desk (its reception and its manager). Everyone else stays on their own clients —
// the sales rep, the collection officer, the online desk — as before.
//
// A booking by any of these is still only a request to accounts unless the caller can approve it
// (routes/subscriber-payments.js storedStatus), and the money is filed under the caller's own branch.

const OPEN_ROLES = Object.freeze(['support', 'reception_daqqi', 'daqqi_manager']);

/** True for the super admin and for the customer-service and Dokki roles. */
function canBookAnyClient(req) {
  if (req?.isSuperAdmin) return true;
  return OPEN_ROLES.includes(String(req?.staffRecord?.role || '').toLowerCase());
}

module.exports = { canBookAnyClient, OPEN_ROLES };
