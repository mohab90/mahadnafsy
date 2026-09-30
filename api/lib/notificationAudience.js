'use strict';

const { hasPermission } = require('../constants/permissions');

// Who a broadcast of each type is for. A notification addressed to a person
// by name is always theirs; these govern the unaddressed ones, which is where
// "every notification in the system" would otherwise mean an accountant reading
// HR notices and a receptionist reading refund decisions. A type absent from
// this map is general and goes to everyone.
//
// «سيسيتم الاشعارات لازم يتصلح بشكل جيد جدا للادارة وللموظفين». On 30 Sep
// 2026 every employee's bell carried other people's work: each lead handed to a
// rep («X تم تعيينه لـ: Sama Shosha», 1,182 in a week) went to all of sales;
// every failed message (1,355) went to everyone, the type being in no list;
// payments went to whoever held manage_payments, which every role now holds.
// The audience is a permission, or a role where the role is the audience —
// customer service for tickets, which sales also answer inbox for.
const MANAGEMENT = ['manage_sales_team'];
const ADMINS = ['manage_settings', 'manage_security'];
const TYPE_AUDIENCE = Object.freeze({
  payment: { perms: ['view_financial', 'manage_financial'] },
  refund: { perms: ['view_financial', 'manage_financial'] },
  reminder: { perms: ['view_financial', 'manage_financial'] },
  warning: { perms: ['view_financial', 'manage_financial'] },
  hr: { perms: ['view_hr', 'manage_hr'] },
  ticket: { perms: MANAGEMENT, roles: ['support'] },
  lead: { perms: MANAGEMENT },
  info: { perms: MANAGEMENT },
  sales: { perms: MANAGEMENT },
  subscriber: { perms: MANAGEMENT },
  whatsapp: { perms: ['manage_leads'] },
  messenger: { perms: ['manage_leads'] },
  certificate: { perms: ['manage_certificates'] },
  consultation: { perms: ['view_consultations', 'manage_consultations'], roles: ['support'] },
  community: { perms: ['manage_community'] },
  system: { perms: ADMINS },
  alert: { perms: ADMINS },
  delivery_failed: { perms: ADMINS },
});

const inAudience = (staff, audience) =>
  (audience.roles || []).includes(String(staff?.role || '').toLowerCase())
  || audience.perms.some(perm => hasPermission(staff, perm));

/** The broadcast types this employee's bell shows. */
const visibleBroadcastTypes = staff => Object.entries(TYPE_AUDIENCE)
  .filter(([, audience]) => inAudience(staff, audience))
  .map(([type]) => type);

module.exports = { TYPE_AUDIENCE, inAudience, visibleBroadcastTypes };
