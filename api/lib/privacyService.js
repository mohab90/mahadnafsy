'use strict';

const crypto = require('node:crypto');
const { resolveSecret } = require('./secretResolver');
const { pool } = require('./db');

const DEFAULT_POLICY = Object.freeze({
  residency_region: 'not_configured',
  export_sla_days: 7,
  erasure_sla_days: 30,
  financial_retention_days: 2555,
  allow_self_service: true,
});

const q = (sql, params) => ({ sql, params });

async function getPrivacyPolicy(tenantId, db = pool) {
  const [[row]] = await db.query(
    `SELECT residency_region,export_sla_days,erasure_sla_days,
            financial_retention_days,allow_self_service
     FROM tenant_privacy_policies WHERE tenant_id=?`,
    [tenantId]
  );
  return {
    ...DEFAULT_POLICY,
    ...row,
    allow_self_service: row ? Boolean(row.allow_self_service) : DEFAULT_POLICY.allow_self_service,
  };
}

async function findSubscriberForIdentity(tenantId, user, db = pool, lock = false) {
  const uid = String(user?.uid || '').trim();
  const email = String(user?.email || '').trim().toLowerCase();
  if (!uid && !email) return null;
  const [[subscriber]] = await db.query(
    `SELECT * FROM subscribers
     WHERE tenant_id=? AND deleted_at IS NULL
       AND ((?<>'' AND firebase_uid=?) OR (?<>'' AND LOWER(TRIM(email))=?))
     LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [tenantId, uid, uid, email, email]
  );
  return subscriber || null;
}

async function buildSubscriberExport({ tenantId, subscriberId, db = pool }) {
  const [[subscriber]] = await db.query(
    'SELECT * FROM subscribers WHERE tenant_id=? AND id=? LIMIT 1',
    [tenantId, subscriberId]
  );
  if (!subscriber) return null;
  const email = String(subscriber.email || '').trim().toLowerCase();
  const phone = String(subscriber.phone || '').trim();
  const queries = {
    userAccount: q(
      `SELECT id,firebase_uid,email,name,role,is_active,created_at,last_login
       FROM users WHERE tenant_id=? AND (firebase_uid=? OR LOWER(TRIM(email))=?)`,
      [tenantId, subscriber.firebase_uid || '', email]
    ),
    leads: q(
      `SELECT * FROM leads WHERE tenant_id=? AND
       (id=? OR (?<>'' AND LOWER(TRIM(email))=?) OR (?<>'' AND phone=?))`,
      [tenantId, subscriber.lead_id || '', email, email, phone, phone]
    ),
    payments: q('SELECT * FROM payments WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    orders: q('SELECT * FROM orders WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    paymentProofs: q('SELECT * FROM payment_proofs WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    enrollments: q('SELECT * FROM enrollments WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    // `lecture_progress` (migrations 001/007) has no writer anywhere in the
    // codebase and 0 rows in production — every progress path goes through
    // lecture_completions, which carries progress_pct and watch_seconds as well
    // as the completion flag. Querying the dead table made the export look like
    // it covered viewing history twice while one half was always empty.
    lectureCompletions: q('SELECT * FROM lecture_completions WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    courseCompletions: q('SELECT * FROM course_completions WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    quizAttempts: q('SELECT * FROM quiz_attempts WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    certificateRequests: q('SELECT * FROM certificate_requests WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    issuedCertificates: q(
      `SELECT ic.* FROM issued_certificates ic JOIN subscribers s ON s.id=ic.subscriber_id
       WHERE s.tenant_id=? AND ic.subscriber_id=?`,
      [tenantId, subscriberId]
    ),
    cohorts: q('SELECT * FROM cohort_members WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    consultations: q('SELECT * FROM consultations WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    communications: q('SELECT * FROM communications WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    supportTickets: q('SELECT * FROM support_tickets WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    supportMessages: q(
      `SELECT sm.* FROM support_messages sm JOIN support_tickets st ON st.id=sm.ticket_id
       WHERE st.tenant_id=? AND st.subscriber_id=?`,
      [tenantId, subscriberId]
    ),
    ticketReplies: q(
      `SELECT tr.* FROM ticket_replies tr JOIN support_tickets st ON st.id=tr.ticket_id
       WHERE tr.tenant_id=? AND st.tenant_id=? AND st.subscriber_id=?`,
      [tenantId, tenantId, subscriberId]
    ),
    loyalty: q('SELECT * FROM loyalty_ledger WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    referrals: q('SELECT * FROM referral_codes WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    checkins: q('SELECT * FROM physical_checkins WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    ratings: q('SELECT * FROM course_ratings WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    notifications: q('SELECT * FROM notifications WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    nps: q('SELECT * FROM nps_responses WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    communityPosts: q('SELECT * FROM community_posts WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    communityComments: q('SELECT * FROM community_post_comments WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
    communityLikes: q('SELECT * FROM community_post_likes WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]),
  };
  const entries = await Promise.all(Object.entries(queries).map(async ([key, query]) => {
    const [rows] = await db.query(query.sql, query.params);
    return [key, rows];
  }));
  const policy = await getPrivacyPolicy(tenantId, db);
  const deploymentRegion = process.env.DATA_RESIDENCY_REGION || 'not_configured';
  return {
    manifest: {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      tenantId,
      subscriberId,
      residency: {
        declared: policy.residency_region,
        deployment: deploymentRegion,
        verified: policy.residency_region !== 'not_configured' && policy.residency_region === deploymentRegion,
      },
      excludedSecrets: ['password_hash', 'totp_secret', 'session tokens'],
    },
    subscriber,
    ...Object.fromEntries(entries),
  };
}

function evidenceHash(evidence) {
  const secret = resolveSecret('AUDIT_HMAC_SECRET') || resolveSecret('JWT_SECRET');
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('AUDIT_HMAC_SECRET is required in production');
  return crypto.createHmac('sha256', secret || 'development-privacy-key')
    .update(JSON.stringify(evidence))
    .digest('hex');
}

async function activeObligations(tenantId, subscriberId, db) {
  const [[row]] = await db.query(
    `SELECT
      (SELECT COUNT(*) FROM orders WHERE tenant_id=? AND subscriber_id=? AND status IN ('pending','processing')) AS orders,
      (SELECT COUNT(*) FROM payment_proofs WHERE tenant_id=? AND subscriber_id=? AND status='pending') AS proofs,
      (SELECT COUNT(*) FROM consultations WHERE tenant_id=? AND subscriber_id=?
         AND status NOT IN ('completed','cancelled','no_show') AND session_date>=CURDATE()) AS consultations`,
    [tenantId, subscriberId, tenantId, subscriberId, tenantId, subscriberId]
  );
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
}

async function anonymizeSubscriber({ tenantId, subscriberId, actorId, db }) {
  const [[subscriber]] = await db.query(
    'SELECT * FROM subscribers WHERE tenant_id=? AND id=? LIMIT 1 FOR UPDATE',
    [tenantId, subscriberId]
  );
  if (!subscriber) {
    const error = new Error('Subscriber not found');
    error.code = 'SUBSCRIBER_NOT_FOUND';
    throw error;
  }
  const obligations = await activeObligations(tenantId, subscriberId, db);
  if (Object.values(obligations).some(Boolean)) {
    const error = new Error('Active orders, payment proofs or consultations must be resolved first');
    error.code = 'ERASURE_BLOCKED_ACTIVE_OBLIGATIONS';
    error.obligations = obligations;
    throw error;
  }

  const anonEmail = `deleted-${subscriberId}@privacy.invalid`;
  const email = String(subscriber.email || '').trim().toLowerCase();
  const phone = String(subscriber.phone || '').trim();
  const deletedLabel = '[deleted]';
  const counts = {};
  const run = async (key, sql, params) => {
    const [result] = await db.query(sql, params);
    counts[key] = Number(result.affectedRows || 0);
  };

  await run('users',
    `UPDATE users SET firebase_uid=NULL,email=?,name=?,password_hash='!privacy-erased!',is_active=0,
       session_version=session_version+1,totp_secret=NULL,totp_enabled=0
     WHERE tenant_id=? AND (firebase_uid=? OR LOWER(TRIM(email))=?)`,
    [anonEmail, deletedLabel, tenantId, subscriber.firebase_uid || '', email]);
  await run('leads',
    `UPDATE leads SET name=?,email=?,phone=NULL,notes=NULL,crm_json='{}',login_email=NULL,
       assigned_sales_name=NULL,assigned_cs_name=NULL,is_unsubscribed=1,unsubscribed_at=NOW(),
       hidden=1,deleted_at=COALESCE(deleted_at,NOW())
     WHERE tenant_id=? AND (id=? OR (?<>'' AND LOWER(TRIM(email))=?) OR (?<>'' AND phone=?))`,
    [deletedLabel, anonEmail, tenantId, subscriber.lead_id || '', email, email, phone, phone]);
  await run('consultations',
    `UPDATE consultations SET client_name=?,client_email=?,client_phone=NULL,notes=NULL,meeting_link=NULL
     WHERE tenant_id=? AND subscriber_id=?`,
    [deletedLabel, anonEmail, tenantId, subscriberId]);
  await run('supportTickets',
    `UPDATE support_tickets SET subscriber_email=?,subscriber_name=?,subject='Privacy-redacted ticket',body=NULL,description=NULL,
       resolution_note=NULL,csat_comment=NULL,csat_token_hash=NULL,csat_token_expires_at=NULL
     WHERE tenant_id=? AND subscriber_id=?`,
    [anonEmail, deletedLabel, tenantId, subscriberId]);
  await run('supportMessages',
    `UPDATE support_messages sm JOIN support_tickets st ON st.id=sm.ticket_id
     SET sm.author_name=?,sm.body='[removed by privacy request]'
     WHERE st.tenant_id=? AND st.subscriber_id=?`,
    [deletedLabel, tenantId, subscriberId]);
  await run('ticketReplies',
    `UPDATE ticket_replies tr JOIN support_tickets st ON st.id=tr.ticket_id
     SET tr.author_name=?,tr.body='[removed by privacy request]'
     WHERE tr.tenant_id=? AND st.tenant_id=? AND st.subscriber_id=?`,
    [deletedLabel, tenantId, tenantId, subscriberId]);
  await run('ticketEvents',
    `UPDATE ticket_events te JOIN support_tickets st ON st.id=te.ticket_id AND st.tenant_id=te.tenant_id
     SET te.actor_name=?,te.detail=NULL
     WHERE te.tenant_id=? AND st.subscriber_id=?`,
    [deletedLabel, tenantId, subscriberId]);
  await run('communications',
    'UPDATE communications SET notes=NULL,outcome=NULL WHERE tenant_id=? AND subscriber_id=?',
    [tenantId, subscriberId]);
  await run('certificateRequests',
    `UPDATE certificate_requests SET custom_name=NULL,name_ar=NULL,name_en=NULL,nationality=NULL,
       id_number=NULL,note=NULL,admin_note=NULL WHERE tenant_id=? AND subscriber_id=?`,
    [tenantId, subscriberId]);
  await run('attendance',
    'UPDATE daqqi_attendees SET name=?,phone=NULL WHERE tenant_id=? AND subscriber_id=?',
    [deletedLabel, tenantId, subscriberId]);
  await run('orders',
    `UPDATE orders SET customer_name=?,customer_email=?,customer_phone=NULL,notes=NULL
     WHERE tenant_id=? AND subscriber_id=?`,
    [deletedLabel, anonEmail, tenantId, subscriberId]);
  await run('payments', 'UPDATE payments SET note=NULL WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]);
  await run('paymentProofs', 'UPDATE payment_proofs SET note=NULL WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]);
  await run('quizAttempts', "UPDATE quiz_attempts SET answers_json='[]' WHERE tenant_id=? AND subscriber_id=?", [tenantId, subscriberId]);
  await run('ratings', 'UPDATE course_ratings SET comment=NULL WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]);
  await run('checkins', 'UPDATE physical_checkins SET notes=NULL WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]);
  await run('nps', 'UPDATE nps_responses SET comment=NULL WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]);
  await run('community',
    `UPDATE community_posts SET title='[removed]',author=?,body='[removed by privacy request]',
       image_url=NULL,tags=NULL,status='hidden'
     WHERE tenant_id=? AND subscriber_id=?`,
    [deletedLabel, tenantId, subscriberId]);
  await run('communityComments',
    `UPDATE community_post_comments SET author=?,body='[removed by privacy request]'
     WHERE tenant_id=? AND subscriber_id=?`,
    [deletedLabel, tenantId, subscriberId]);
  await run('communityLikeCounters',
    `UPDATE community_posts p
     JOIN (
       SELECT post_id,COUNT(*) removed_count FROM community_post_likes
       WHERE tenant_id=? AND subscriber_id=? GROUP BY post_id
     ) removed ON removed.post_id=p.id
     SET p.likes=GREATEST(p.likes-removed.removed_count,0)
     WHERE p.tenant_id=?`,
    [tenantId, subscriberId, tenantId]);
  await run('communityLikes',
    'DELETE FROM community_post_likes WHERE tenant_id=? AND subscriber_id=?',
    [tenantId, subscriberId]);
  await run('notifications', 'DELETE FROM notifications WHERE tenant_id=? AND subscriber_id=?', [tenantId, subscriberId]);
  await run('outbox',
    `UPDATE message_outbox SET recipient=?,subject=NULL,payload_json='{}',last_error=NULL
     WHERE tenant_id=? AND ((ref_type='subscriber' AND ref_id=?) OR recipient IN (?,?))`,
    ['privacy-redacted', tenantId, subscriberId, email, phone]);
  await run('contactMessages',
    `UPDATE contact_messages SET name=?,email=?,phone=NULL,message='[removed by privacy request]',admin_note=NULL
     WHERE tenant_id=? AND ((?<>'' AND LOWER(TRIM(email))=?) OR (?<>'' AND phone=?))`,
    [deletedLabel, anonEmail, tenantId, email, email, phone, phone]);
  await run('subscriber',
    `UPDATE subscribers SET firebase_uid=NULL,name=?,name_en=NULL,name_ar=NULL,email=?,phone=NULL,
       national_id=NULL,whatsapp=NULL,nationality=NULL,assigned_sales_name=NULL,assigned_cs_name=NULL,
       notes=NULL,crm_json='{}',is_unsubscribed=1,unsubscribed_at=NOW(),is_active=0,
       deleted_at=COALESCE(deleted_at,NOW())
     WHERE tenant_id=? AND id=?`,
    [deletedLabel, anonEmail, tenantId, subscriberId]);

  const [[verification]] = await db.query(
    `SELECT
      (SELECT COUNT(*) FROM subscribers WHERE tenant_id=? AND id=? AND
        (firebase_uid IS NOT NULL OR phone IS NOT NULL OR national_id IS NOT NULL OR whatsapp IS NOT NULL
         OR email<>? OR name<>? OR crm_json<>'{}')) AS subscriber_pii,
      (SELECT COUNT(*) FROM users WHERE tenant_id=? AND (firebase_uid=? OR LOWER(TRIM(email))=?)
         AND (is_active=1 OR totp_secret IS NOT NULL)) AS active_identity`,
    [tenantId, subscriberId, anonEmail, deletedLabel, tenantId, subscriber.firebase_uid || '', email]
  );
  const verified = Number(verification.subscriber_pii || 0) === 0
    && Number(verification.active_identity || 0) === 0;
  if (!verified) throw new Error('Privacy erasure verification failed');

  const policy = await getPrivacyPolicy(tenantId, db);
  const evidence = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    tenantId,
    subscriberId,
    actorId,
    verified,
    counts,
    retainedCategories: [
      `financial records (${policy.financial_retention_days} days)`,
      'enrollment and certificate integrity records',
      'hashed marketing suppression and immutable audit evidence',
    ],
  };
  return { evidence, hash: evidenceHash(evidence) };
}

module.exports = {
  DEFAULT_POLICY,
  activeObligations,
  anonymizeSubscriber,
  buildSubscriberExport,
  evidenceHash,
  findSubscriberForIdentity,
  getPrivacyPolicy,
};
