'use strict';

// «Nobody sets their own pay» (the HR_SELF_MUTATION refusals): the signed-in person's staff record is the record being changed. The one exception is the owner
// (11 Nov 2026: the guard had locked the owner out of his own attendance and salary file) — the single super admin named by ADMIN_EMAILS / ADMIN_UIDS, which is
// what isOwnerRequest tells. A manager or an HR employee who is also a super admin by role is NOT exempt. Every HR_SELF_MUTATION check goes through here.
const { isOwnerRequest } = require('../middleware/auth');

/** Is this request changing the pay/attendance of the very person making it (the owner excepted)? */
function isSelfMutation(req, staffId) {
  const mine = req?.staffRecord?.id;
  if (!mine || staffId === undefined || staffId === null || staffId === '') return false;
  return String(mine) === String(staffId) && !isOwnerRequest(req);
}

module.exports = { isSelfMutation };
