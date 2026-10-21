'use strict';

const { pool } = require('./db');
const { getNextClientCode } = require('./mappers');
const { branchIdForBranch } = require('./branches');
const { fetchFbLeadDetails, getFbLeadConfig } = require('./facebookLeadAds');
const { getNextSalesRep } = require('./leadAssignment');
const { platformFallback } = require('./tenantScope');
const { logLeadEventStrict } = require('./crm');
const { findLeadByContact } = require('./leadMatching');
const { clientHoldingPhone } = require('./phoneDuplicates');
const { logClientEvent } = require('./clientHistory');
const { cairoToday } = require('./dates');
const { completeForBranch, toIdentity } = require('./phoneNumber');
const { transitionLead } = require('./leadState');
const { TERMINAL_LEAD_STATUSES, CONVERTED_LEAD_STATUSES } = require('./leadStatuses');

const LEAD_TYPES = new Set(['COURSE', 'CONSULTATION', 'GENERAL']);

function leadFields(detail = {}) {
  const result = { name: '', phone: '', email: null };
  for (const field of detail.field_data || []) {
    const value = (field.values || [])[0] || '';
    const key = String(field.name || '').toLowerCase();
    if (key === 'full_name' || key === 'name') result.name = value;
    else if (key === 'phone_number' || key === 'phone') result.phone = value;
    else if (key === 'email') result.email = value;
  }
  return result;
}

async function activeStaff(conn, tenantId, staffId) {
  const [[row]] = await conn.query(
    'SELECT id,name FROM staff WHERE tenant_id=? AND id=? AND is_active=1 AND deleted_at IS NULL LIMIT 1',
    [tenantId, staffId]
  );
  return row || null;
}

/** The page's configured rep, else the next in the rotation. */
async function pickRepresentative(conn, { tenantId, config, dependencies, branch = String(config.defaultBranch || '').toUpperCase() || null }) {
  if (config.defaultAssignedSalesId) {
    const configured = await activeStaff(conn, tenantId, config.defaultAssignedSalesId);
    if (configured) return configured;
  }
  return (dependencies.assignSales || getNextSalesRep)(tenantId, conn, {
    branch,
    lead: {
      source: 'facebook',
      courseIds: config.defaultInterestedCourseId ? [config.defaultInterestedCourseId] : [],
    },
  });
}

/** The client this number or address belongs to, with whoever looks after them. */
async function findClient(conn, { tenantId, phone, email }) {
  let client = phone ? await clientHoldingPhone(conn, { tenantId, phones: [phone] }) : null;
  const address = String(email || '').toLowerCase().trim();
  if (!client && address) {
    [[client]] = await conn.query(
      `SELECT id, client_code, name FROM subscribers
        WHERE tenant_id=? AND deleted_at IS NULL AND LOWER(TRIM(email))=? LIMIT 1`,
      [tenantId, address]
    );
  }
  if (!client) return null;
  const [[owner]] = await conn.query(
    `SELECT COALESCE(NULLIF(assigned_cs_id,''), NULLIF(assigned_sales_id,'')) AS owner_id
       FROM subscribers WHERE id=? AND tenant_id=? LIMIT 1`,
    [client.id, tenantId]
  );
  return { ...client, owner_id: owner?.owner_id || null };
}

async function processFacebookLeadEvent({ event, payload }, dependencies = {}) {
  const db = dependencies.pool || pool;
  const tenantId = event.tenant_id;
  const config = await (dependencies.getConfig || getFbLeadConfig)(tenantId);
  const pageAccessToken = config.pageAccessToken || platformFallback(tenantId, process.env.FB_PAGE_TOKEN);
  let imported = 0;
  // Told after each commit: a notice must not hold the transaction open.
  const notices = [];
  try {
    for (const entry of payload?.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'leadgen') continue;
        const leadgenId = String(change.value?.leadgen_id || '');
        const pageId = String(change.value?.page_id || '');
        if (!leadgenId || !pageId) continue;
        let fields = { name: `Facebook Lead #${leadgenId}`, phone: '', email: null };
        if (pageAccessToken) {
          const detail = await (dependencies.fetchDetails || fetchFbLeadDetails)(leadgenId, pageAccessToken);
          fields = { ...fields, ...leadFields(detail) };
        }
        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          const leadId = `lead-fb-${leadgenId}`;
          const [[existing]] = await conn.query(
            'SELECT id FROM leads WHERE tenant_id=? AND (id=? OR fb_lead_id=?) LIMIT 1 FOR UPDATE',
            [tenantId, leadId, leadgenId]
          );
          if (existing) {
            await conn.commit();
            continue;
          }
          // A client already: nothing for sales. «عميل قديم» filling an ad is a
          // conversation for whoever looks after them (collection, or the rep who
          // closed them) — a new lead put them in a stranger's pipeline.
          const client = await findClient(conn, { tenantId, phone: fields.phone, email: fields.email });
          if (client) {
            await logClientEvent(conn, {
              tenantId, subscriberId: client.id, action: 'facebook_lead', actor: 'facebook',
              label: `ملأ فورم إعلان فيسبوك تاني (${leadgenId}) — اتبعت لمسئوله بدل ليد جديد`,
            });
            await conn.commit();
            notices.push({
              type: 'subscriber', title: '📣 عميلك ملأ إعلان فيسبوك',
              message: `${client.name || fields.name} — عميل عندنا، كلمه النهارده`,
              data: { subscriberId: client.id, clientCode: client.client_code || null },
              to: client.owner_id || null,
            });
            continue;
          }
          // The same person, arriving again.
          //
          // This deduplicated on the Facebook lead id alone, which is unique per
          // form submission — so somebody who filled a second form, or who was
          // already in the CRM from a campaign or their own signup, became a
          // second lead and the two copies went to two different reps. The shared
          // matcher decides who this is, the way every other intake does; the
          // Facebook id is recorded on the record that already exists.
          //
          // Archived and closed ones too: a lead marked «مش مهتم» who fills a new
          // ad is interested again. It got a note nobody read — not reopened, its
          // rep not told — and an archived one became a new lead for another rep.
          // Now it is back in its rep's list, due today, and the rep is told.
          const known = await findLeadByContact(conn, {
            tenantId, phone: fields.phone, email: fields.email, includeHidden: true,
          });
          if (known) {
            await conn.query(
              'UPDATE leads SET fb_lead_id=COALESCE(fb_lead_id,?), fb_form_id=COALESCE(fb_form_id,?) WHERE id=? AND tenant_id=?',
              [leadgenId, String(change.value?.form_id || '') || null, known.id, tenantId],
            );
            let owner = known.assigned_sales_id ? await activeStaff(conn, tenantId, known.assigned_sales_id) : null;
            if (!owner) owner = await pickRepresentative(conn, { tenantId, config, dependencies });
            const status = String(known.status || '').toLowerCase();
            const reopen = Number(known.hidden) === 1 || (TERMINAL_LEAD_STATUSES.has(status) && !CONVERTED_LEAD_STATUSES.has(status));
            await conn.query(
              `UPDATE leads SET hidden=0, next_follow_up_date=?,
                      assigned_sales_id=COALESCE(?,assigned_sales_id), assigned_sales_name=COALESCE(?,assigned_sales_name),
                      updated_at=NOW()
                WHERE id=? AND tenant_id=?`,
              [cairoToday(), owner?.id || null, owner?.name || null, known.id, tenantId],
            );
            if (reopen && TERMINAL_LEAD_STATUSES.has(status)) {
              await transitionLead({
                tenantId, leadId: known.id, toStatus: 'new', db: conn, force: true, actor: 'facebook',
                reason: 'Filled a Facebook lead form again', metadata: { externalLeadId: leadgenId },
              });
            }
            await logLeadEventStrict(
              known.id, reopen ? 'reopened' : 'note',
              reopen ? 'رجع من إعلان فيسبوك — اتفتح تاني ومتابعته النهارده' : 'وصل نفس الشخص من إعلان فيسبوك — اتسجل على نفس الكارت',
              { provider: 'facebook', externalLeadId: leadgenId, pageId, connectorEventId: event.id, previousStatus: status || null },
              tenantId, conn,
            );
            await conn.commit();
            notices.push({
              type: 'lead', title: reopen ? '🔁 ليد رجع من فيسبوك' : '📣 ليد ملأ إعلان فيسبوك تاني',
              message: `${fields.name || 'ليد'} — متابعته النهارده`,
              data: { leadId: known.id }, to: owner?.id || null,
            });
            continue;
          }
          const branch = String(config.defaultBranch || '').toUpperCase() || null;
          const representative = await pickRepresentative(conn, { tenantId, config, dependencies, branch });
          const leadType = String(config.defaultLeadType || 'GENERAL').toUpperCase();
          const clientCode = await getNextClientCode(conn);
          const courseIds = config.defaultInterestedCourseId
            ? JSON.stringify([config.defaultInterestedCourseId])
            : null;
          await conn.query(
            `INSERT INTO leads
               (id,tenant_id,client_code,name,email,phone,source,status,interest_level,lead_type,
                branch,branch_id,interested_course_ids_json,notes,assigned_sales_id,
                assigned_sales_name,fb_lead_id,fb_form_id,hidden,created_at)
             VALUES (?,?,?,?,?,?,'facebook',?,'HIGH',?,?,?,?, '',?,?,?,?,0,NOW())`,
            [
              leadId, tenantId, clientCode, fields.name, fields.email,
              // The one form clients are kept in, so the next intake finds it; NULL, not '', with none.
              toIdentity(completeForBranch(fields.phone, branch)) || null,
              String(config.defaultStatus || 'new').toLowerCase(),
              LEAD_TYPES.has(leadType) ? leadType : 'GENERAL',
              branch, branchIdForBranch(branch), courseIds,
              representative?.id || null, representative?.name || null,
              leadgenId, String(change.value?.form_id || '') || null,
            ]
          );
          await logLeadEventStrict(
            leadId, 'created', 'Lead imported from Facebook Lead Ads',
            { provider: 'facebook', externalLeadId: leadgenId, pageId, connectorEventId: event.id },
            tenantId, conn
          );
          await conn.commit();
          imported += 1;
        } catch (error) {
          await conn.rollback().catch(() => {});
          throw error;
        } finally {
          conn.release();
        }
      }
    }
  } finally {
    // Each notice to the rep or client owner it names; with nobody, to whoever
    // the type's audience is (lib/notificationAudience.js).
    const { createNotification } = require('./notification');
    for (const notice of notices) {
      await createNotification(notice.type, notice.title, notice.message, notice.data, tenantId, notice.to).catch(() => {});
    }
  }
  return { imported };
}

module.exports = { LEAD_TYPES, leadFields, processFacebookLeadEvent };
