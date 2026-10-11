'use strict';

// The signing secrets refuse the boot once they are 370 days old
// (lib/productionConfig.js). Both dates in deploy/systemd/mahad-api.service are
// 2026-08-03, so on about 2027-08-08 any restart would have taken the site
// down — and nothing said so beforehand. From day 330 this tells the owner on
// WhatsApp, at the numbers saved for the daily report («تقارير الإدارة ←
// التقرير اليومي على واتساب»), once a week until the dates are bumped.
//
// The secrets are the server's, not a tenant's, so only the institute's own
// tenant is told: a pilot tenant's owner has nothing to rotate.

const { pool } = require('./db');
const { cairoToday, addDaysToDateOnly } = require('./dates');
const { toDialable } = require('./phoneNumber');
const { secretRotationStatus } = require('./productionConfig');

/** The Monday (Cairo) of the week `today` falls in — the weekly dedupe key. */
function weekOf(today = cairoToday()) {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDaysToDateOnly(today, -((weekday + 6) % 7));
}

/** One WhatsApp message, in the owner's words, naming the date the site stops. */
function composeSecretRotationAlert(status) {
  const pressing = status.secrets.filter(item => item.state === 'due' || item.state === 'expired');
  const lines = pressing.map(item => (item.state === 'expired'
    ? `• ${item.label}: عدّى عليه ${item.ageDays} يوم — أي ريستارت للسيرفر دلوقتي الموقع مش هيقوم`
    : `• ${item.label}: عدّى عليه ${item.ageDays} يوم — فاضل ${item.daysLeft} يوم (آخر يوم ${item.refusesBootAfter})`));
  const expired = pressing.some(item => item.state === 'expired');
  return [
    expired ? '🚨 *مفاتيح التشفير بتاعة السيرفر انتهت*' : '⚠️ *مفاتيح التشفير بتاعة السيرفر محتاجة تتغير*',
    '',
    ...lines,
    '',
    `السيرفر بيرفض يشتغل لو المفاتيح عدّى عليها أكتر من ${status.refuseAfterDays} يوم.`,
    'المطلوب: المسؤول التقني يغيّر المفاتيح ويحدّث التواريخ في ملف mahad-api.service (الخطوات مكتوبة في الملف نفسه).',
  ].join('\n');
}

/**
 * Queue this week's warning to each owner-report number, once a week per
 * number (the outbox dedupe key). Returns how many were queued; 0 when the
 * secrets are not yet due, or no number is saved.
 */
async function queueSecretRotationAlerts({ tenantId, env = process.env, now = Date.now(), logger } = {}, db = pool) {
  const status = secretRotationStatus(env, now);
  if (!status.warning) return 0;
  const tenant = tenantId || env.DEFAULT_TENANT_ID || 'tenant-default';
  // The phones regardless of whether the daily report is switched on: a site
  // about to stop is not the report, and the numbers are where the owner said
  // to reach them.
  const { phones } = await require('./ownerDailyReport').ownerReportSettings(tenant, db);
  if (!phones.length) {
    logger?.warn?.('[secret-rotation] due, but no owner-report number is saved to warn', { state: status.state });
    return 0;
  }
  const week = weekOf(cairoToday(new Date(now)));
  const message = composeSecretRotationAlert(status);
  const outbox = require('./outbox');
  let queued = 0;
  for (const phone of phones) {
    const dialable = toDialable(phone);
    if (!dialable) continue;
    await outbox.enqueue({
      channel: 'whatsapp', recipient: dialable, tenantId: tenant,
      dedupeKey: `secret-rotation:${week}:${dialable}`, refType: 'secret_rotation', refId: status.state,
      payload: { message, category: 'staff_alert' },
    }, db);
    queued += 1;
  }
  return queued;
}

module.exports = { composeSecretRotationAlert, queueSecretRotationAlerts, weekOf };
