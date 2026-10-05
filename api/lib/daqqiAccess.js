'use strict';

// SUPPORT: customer service works «جدول الدقي» from its own bar, and every
// schedule route answered it «Access denied».
//
// The Tagamoa branch's manager and reception work the same screens for their
// own branch (lib/physicalBranches.js confines them to it).
const { BRANCH_ROLES, MANAGER_ROLES } = require('./physicalBranches');

const OPERATIONAL_ROLES = new Set([
  'MANAGER', 'ADMIN', 'DAQQI_MANAGER', 'RECEPTION_DAQQI', 'SUPPORT', 'INSTRUCTOR', 'TRAINER', ...BRANCH_ROLES,
]);
const MANAGEMENT_ROLES = new Set(['MANAGER', 'ADMIN', ...MANAGER_ROLES]);

function allowRoles(roles) {
  return (req, res, next) => {
    if (!req.staffRecord || req.isSuperAdmin) return next();
    const role = String(req.staffRecord.role || '').toUpperCase();
    if (!roles.has(role)) return res.status(403).json({ error: 'Access denied' });
    next();
  };
}

const requireDaqqiAccess = allowRoles(OPERATIONAL_ROLES);
const requireDaqqiManager = allowRoles(MANAGEMENT_ROLES);

module.exports = { requireDaqqiAccess, requireDaqqiManager };
