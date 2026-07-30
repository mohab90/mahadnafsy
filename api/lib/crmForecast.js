'use strict';

const { pool } = require('./db');

const CATEGORY_PROBABILITY = Object.freeze({
  pipeline: 25,
  best_case: 60,
  commit: 90,
});
const CATEGORIES = new Set(Object.keys(CATEGORY_PROBABILITY));

function monthKey(value) {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  const match = text.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function addUtcMonths(value, offset) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1));
  return date.toISOString().slice(0, 7);
}

function forecastCategory(lead) {
  const explicit = String(lead.forecast_category || '').toLowerCase();
  if (CATEGORIES.has(explicit)) return { value: explicit, derived: false };
  const status = String(lead.status || '').toLowerCase();
  if (status === 'interested') return { value: 'best_case', derived: true };
  if (['interested_booking', 'qualified', 'negotiation'].includes(status)) {
    return { value: 'commit', derived: true };
  }
  return { value: 'pipeline', derived: true };
}

function forecastProbability(lead, category) {
  const explicit = Number(lead.forecast_probability);
  return Number.isFinite(explicit) && explicit >= 0 && explicit <= 100
    ? explicit
    : CATEGORY_PROBABILITY[category];
}

function safeMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function parseMeta(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function buildPipelineMovements(rows = []) {
  const summary = new Map();
  const movements = rows.map(row => {
    const meta = parseMeta(row.meta_json);
    const before = meta.before || {};
    const after = meta.after || {};
    const from = meta.from ?? before.category ?? null;
    const to = meta.to ?? after.category ?? null;
    const key = `${row.event_type}:${from || 'unknown'}:${to || 'unknown'}`;
    const aggregate = summary.get(key) || {
      eventType: row.event_type, from, to, count: 0, valueDeltaEgp: 0,
    };
    aggregate.count += 1;
    aggregate.valueDeltaEgp += Number(after.dealValueEgp || 0) - Number(before.dealValueEgp || 0);
    summary.set(key, aggregate);
    return {
      id: row.id,
      leadId: row.lead_id,
      leadName: row.lead_name,
      ownerId: row.assigned_sales_id || null,
      ownerName: row.assigned_sales_name || null,
      eventType: row.event_type,
      from,
      to,
      before,
      after,
      at: row.at,
    };
  });
  return {
    summary: [...summary.values()].map(item => ({
      ...item,
      valueDeltaEgp: Number(item.valueDeltaEgp.toFixed(2)),
    })).sort((a, b) => b.count - a.count),
    movements,
  };
}

function buildCrmForecast({
  leads = [], history = [], targets = [], submissions = [], sourceBreakdown = [],
  accuracyActuals = [], months = 3, now = new Date(),
}) {
  const horizon = Math.min(Math.max(Number(months) || 3, 1), 12);
  const periods = Array.from({ length: horizon }, (_, index) => addUtcMonths(now, index));
  const periodSet = new Set(periods);
  const rows = periods.map(period => ({
    period,
    pipelineEgp: 0,
    bestCaseEgp: 0,
    commitEgp: 0,
    weightedEgp: 0,
    opportunityCount: 0,
  }));
  const byPeriod = new Map(rows.map(row => [row.period, row]));
  const owners = new Map();
  const opportunities = [];
  const dataQuality = {
    totalOpen: leads.length,
    missingDealValue: 0,
    missingExpectedClose: 0,
    derivedCategory: 0,
    derivedProbability: 0,
    outsideHorizon: 0,
  };

  for (const lead of leads) {
    const amount = safeMoney(lead.deal_value);
    if (!amount) dataQuality.missingDealValue += 1;
    const closePeriod = monthKey(lead.expected_close_date || lead.next_follow_up_date);
    if (!closePeriod) dataQuality.missingExpectedClose += 1;
    const category = forecastCategory(lead);
    const probability = forecastProbability(lead, category.value);
    opportunities.push({
      id: lead.id,
      name: lead.name,
      ownerId: lead.assigned_sales_id || null,
      ownerName: lead.assigned_sales_name || null,
      dealValueEgp: amount,
      category: category.value,
      categoryDerived: category.derived,
      probability,
      probabilityDerived: !Number.isFinite(Number(lead.forecast_probability)),
      expectedCloseDate: lead.expected_close_date || null,
      fallbackFollowUpDate: lead.next_follow_up_date || null,
      missingDealValue: !amount,
      missingExpectedClose: !closePeriod,
    });
    if (!amount || !closePeriod) continue;
    if (!periodSet.has(closePeriod)) {
      dataQuality.outsideHorizon += 1;
      continue;
    }
    if (category.derived) dataQuality.derivedCategory += 1;
    const explicitProbability = Number(lead.forecast_probability);
    if (!Number.isFinite(explicitProbability)) dataQuality.derivedProbability += 1;
    const row = byPeriod.get(closePeriod);
    row.pipelineEgp += amount;
    if (category.value === 'best_case' || category.value === 'commit') row.bestCaseEgp += amount;
    if (category.value === 'commit') row.commitEgp += amount;
    row.weightedEgp += amount * probability / 100;
    row.opportunityCount += 1;

    const ownerId = String(lead.assigned_sales_id || 'unassigned');
    const owner = owners.get(ownerId) || {
      staffId: ownerId,
      staffName: lead.assigned_sales_name || (ownerId === 'unassigned' ? 'غير مسند' : ownerId),
      pipelineEgp: 0,
      bestCaseEgp: 0,
      commitEgp: 0,
      weightedEgp: 0,
      opportunityCount: 0,
    };
    owner.pipelineEgp += amount;
    if (category.value === 'best_case' || category.value === 'commit') owner.bestCaseEgp += amount;
    if (category.value === 'commit') owner.commitEgp += amount;
    owner.weightedEgp += amount * probability / 100;
    owner.opportunityCount += 1;
    owners.set(ownerId, owner);
  }

  const targetByPeriod = new Map();
  for (const target of targets) {
    const period = String(target.period || '');
    targetByPeriod.set(period, (targetByPeriod.get(period) || 0) + safeMoney(target.revenue_target));
  }
  for (const row of rows) {
    row.targetEgp = targetByPeriod.get(row.period) || 0;
    row.coverage = row.targetEgp > 0 ? Number((row.pipelineEgp / row.targetEgp).toFixed(2)) : null;
    for (const key of ['pipelineEgp', 'bestCaseEgp', 'commitEgp', 'weightedEgp']) {
      row[key] = Number(row[key].toFixed(2));
    }
  }
  const normalizedHistory = history.map(item => ({
    period: String(item.period || item.month || ''),
    actualEgp: safeMoney(item.actual_egp ?? item.revenue),
  }));
  const usePerStaffAccuracy = accuracyActuals.length > 0;
  const submissionByPeriod = new Map();
  for (const item of submissions) {
    const period = String(item.period || '');
    const staffId = String(item.staff_id || 'unassigned');
    const key = usePerStaffAccuracy ? `${period}:${staffId}` : period;
    const aggregate = submissionByPeriod.get(key) || {
      period, staffId, staffName: item.staff_name || staffId,
      pipelineEgp: 0, bestCaseEgp: 0, commitEgp: 0, submissionCount: 0,
    };
    aggregate.pipelineEgp += safeMoney(item.pipeline_egp);
    aggregate.bestCaseEgp += safeMoney(item.best_case_egp);
    aggregate.commitEgp += safeMoney(item.commit_egp);
    aggregate.submissionCount += 1;
    submissionByPeriod.set(key, aggregate);
  }
  const actualByPeriod = new Map(
    (usePerStaffAccuracy ? accuracyActuals : normalizedHistory)
      .map(item => [
        usePerStaffAccuracy
          ? `${String(item.period || '')}:${String(item.staff_id || 'unassigned')}`
          : String(item.period || ''),
        safeMoney(item.actual_egp ?? item.actualEgp),
      ])
  );
  const forecastAccuracy = [...submissionByPeriod.values()]
    .filter(item => actualByPeriod.has(usePerStaffAccuracy ? `${item.period}:${item.staffId}` : item.period))
    .map(item => {
      const actualKey = usePerStaffAccuracy ? `${item.period}:${item.staffId}` : item.period;
      const actualEgp = actualByPeriod.get(actualKey);
      const absoluteErrorEgp = Math.abs(item.commitEgp - actualEgp);
      const accuracyPercent = actualEgp > 0
        ? Math.max(0, 100 - absoluteErrorEgp / actualEgp * 100)
        : (item.commitEgp === 0 ? 100 : 0);
      return {
        ...item,
        actualEgp,
        absoluteErrorEgp: Number(absoluteErrorEgp.toFixed(2)),
        accuracyPercent: Number(accuracyPercent.toFixed(2)),
      };
    })
    .sort((a, b) => b.period.localeCompare(a.period));
  return {
    generatedAt: now.toISOString(),
    currency: 'EGP',
    periods: rows,
    history: normalizedHistory,
    forecastAccuracy,
    ownerRollups: [...owners.values()]
      .map(owner => ({
        ...owner,
        pipelineEgp: Number(owner.pipelineEgp.toFixed(2)),
        bestCaseEgp: Number(owner.bestCaseEgp.toFixed(2)),
        commitEgp: Number(owner.commitEgp.toFixed(2)),
        weightedEgp: Number(owner.weightedEgp.toFixed(2)),
      }))
      .sort((a, b) => b.weightedEgp - a.weightedEgp),
    opportunities: opportunities
      .sort((a, b) => b.dealValueEgp - a.dealValueEgp)
      .slice(0, 500),
    submissions: submissions.map(item => ({
      id: item.id,
      period: item.period,
      staffId: item.staff_id,
      staffName: item.staff_name || item.staff_id,
      pipelineEgp: safeMoney(item.pipeline_egp),
      bestCaseEgp: safeMoney(item.best_case_egp),
      commitEgp: safeMoney(item.commit_egp),
      note: item.note || null,
      submittedAt: item.submitted_at,
    })),
    sourceBreakdown: sourceBreakdown.map(item => ({
      source: item.source || 'direct',
      actualEgp: safeMoney(item.actual_egp),
      paymentCount: Number(item.payment_count) || 0,
    })),
    dataQuality,
    methodology: {
      categoryProbability: CATEGORY_PROBABILITY,
      actualSource: 'payments.amount_egp where status=paid',
      pipelineSource: 'leads.deal_value canonical EGP',
      missingClosePolicy: 'excluded-and-reported',
    },
  };
}

async function loadCrmForecast({
  tenantId, scope = { sql: '', params: [] }, months = 3, staffId = null, db = pool,
}) {
  const scopedParams = scope.params || [];
  const [historyResult, leadsResult, targetsResult, submissionsResult, sourceResult, accuracyActualResult] = await Promise.all([
    db.query(
      `SELECT DATE_FORMAT(p.date,'%Y-%m') AS period,COALESCE(SUM(p.amount_egp),0) AS actual_egp
         FROM payments p
         LEFT JOIN subscribers s ON s.tenant_id=p.tenant_id AND s.id=p.subscriber_id
         LEFT JOIN leads l ON l.tenant_id=s.tenant_id AND l.id=s.lead_id
        WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
          AND p.date>=DATE_SUB(DATE_FORMAT(CURRENT_DATE,'%Y-%m-01'),INTERVAL 5 MONTH)
          ${scope.sql || ''}
        GROUP BY DATE_FORMAT(p.date,'%Y-%m') ORDER BY period`,
      [tenantId, ...scopedParams]
    ),
    db.query(
      `SELECT l.id,l.name,l.status,l.deal_value,l.forecast_category,
              l.forecast_probability,l.expected_close_date,l.next_follow_up_date,
              l.assigned_sales_id,l.assigned_sales_name
         FROM leads l
        WHERE l.tenant_id=? AND l.hidden=0 AND l.deleted_at IS NULL
          AND l.status NOT IN ('lost','junk','converted','won')${scope.sql || ''}
        ORDER BY l.expected_close_date,l.id LIMIT 10000`,
      [tenantId, ...scopedParams]
    ),
    db.query(
      `SELECT period,revenue_target FROM sales_targets
        WHERE tenant_id=? AND period>=DATE_FORMAT(CURRENT_DATE,'%Y-%m')
          AND staff_id<>'__collection__'
          ${staffId ? 'AND staff_id=?' : ''}
        ORDER BY period LIMIT 5000`,
      staffId ? [tenantId, staffId] : [tenantId]
    ),
    db.query(
      `SELECT ranked.*,st.name AS staff_name
         FROM (
           SELECT fs.*,ROW_NUMBER() OVER (
             PARTITION BY fs.tenant_id,fs.period,fs.staff_id
             ORDER BY fs.submitted_at DESC,fs.id DESC
           ) AS rn
             FROM crm_forecast_submissions fs
            WHERE fs.tenant_id=? ${staffId ? 'AND fs.staff_id=?' : ''}
         ) ranked
         LEFT JOIN staff st ON st.tenant_id=ranked.tenant_id AND st.id=ranked.staff_id
        WHERE ranked.rn=1 ORDER BY ranked.period,ranked.staff_id`,
      staffId ? [tenantId, staffId] : [tenantId]
    ),
    db.query(
      `SELECT COALESCE(l.source,'direct') AS source,
              COALESCE(SUM(p.amount_egp),0) AS actual_egp,COUNT(*) AS payment_count
         FROM payments p
         LEFT JOIN subscribers s ON s.tenant_id=p.tenant_id AND s.id=p.subscriber_id
         LEFT JOIN leads l ON l.tenant_id=s.tenant_id AND l.id=s.lead_id
        WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
          AND p.date>=DATE_SUB(CURRENT_DATE,INTERVAL 12 MONTH)${scope.sql || ''}
        GROUP BY COALESCE(l.source,'direct') ORDER BY actual_egp DESC LIMIT 20`,
      [tenantId, ...scopedParams]
    ),
    db.query(
      `SELECT DATE_FORMAT(p.date,'%Y-%m') AS period,
              COALESCE(p.staff_id,'unassigned') AS staff_id,
              COALESCE(SUM(p.amount_egp),0) AS actual_egp
         FROM payments p
         LEFT JOIN subscribers s ON s.tenant_id=p.tenant_id AND s.id=p.subscriber_id
         LEFT JOIN leads l ON l.tenant_id=s.tenant_id AND l.id=s.lead_id
        WHERE p.tenant_id=? AND p.status='paid' AND p.deleted_at IS NULL
          AND p.date>=DATE_SUB(DATE_FORMAT(CURRENT_DATE,'%Y-%m-01'),INTERVAL 12 MONTH)
          ${scope.sql || ''}
        GROUP BY DATE_FORMAT(p.date,'%Y-%m'),COALESCE(p.staff_id,'unassigned')
        ORDER BY period,staff_id`,
      [tenantId, ...scopedParams]
    ),
  ]);
  return buildCrmForecast({
    history: historyResult[0],
    leads: leadsResult[0],
    targets: targetsResult[0],
    submissions: submissionsResult[0],
    sourceBreakdown: sourceResult[0],
    accuracyActuals: accuracyActualResult[0],
    months,
  });
}

module.exports = {
  CATEGORY_PROBABILITY,
  buildCrmForecast,
  forecastCategory,
  forecastProbability,
  buildPipelineMovements,
  loadCrmForecast,
  monthKey,
};
