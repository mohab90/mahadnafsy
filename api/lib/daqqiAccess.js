'use strict';

const OPERATIONAL_ROLES = new Set([
  'MANAGER', 'ADMIN', 'DAQQI_MANAGER', 'RECEPTION_DAQQI', 'INSTRUCTOR', 'TRAINER',
]);
const MANAGEMENT_ROLES = new Set(['MANAGER', 'ADMIN', 'DAQQI_MANAGER']);

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
