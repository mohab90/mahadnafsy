'use strict';

const CLOSED = new Set(['converted', 'lost', 'archived', 'disqualified', 'not_interested', 'wrong_number', 'junk']);
const DAY_MS = 86400000;

function dateMs(value) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

function priorityBand(score) {
  if (score >= 120) return 'critical';
  if (score >= 80) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function prioritizeLead(lead, now = new Date()) {
  const nowMs = now.getTime();
  const status = String(lead.status || '').toLowerCase();
  if (CLOSED.has(status)) return null;
  const reasons = [];
  let priority = Math.min(Math.max(Number(lead.score) || 0, 0), 100) * 0.35;
  const nextFollowUpMs = dateMs(lead.next_follow_up_date);
  const createdMs = dateMs(lead.created_at) || nowMs;
  const lastCommMs = dateMs(lead.last_communication_at);
  const ageHours = Math.max((nowMs - createdMs) / 3600000, 0);
  const silentDays = Math.max((nowMs - (lastCommMs || createdMs)) / DAY_MS, 0);
  let nextAction = 'schedule_follow_up';

  if (nextFollowUpMs !== null) {
    const overdueDays = Math.floor((nowMs - nextFollowUpMs) / DAY_MS);
    if (overdueDays >= 1) {
      priority += 55 + Math.min(overdueDays, 30) * 2;
      reasons.push(`follow_up_overdue:${overdueDays}`);
      nextAction = 'contact_now';
    } else if (overdueDays === 0) {
      priority += 48;
      reasons.push('follow_up_due_today');
      nextAction = 'contact_today';
    } else if (nextFollowUpMs - nowMs <= DAY_MS) {
      priority += 25;
      reasons.push('follow_up_due_24h');
      nextAction = 'prepare_follow_up';
    }
  } else {
    priority += 22;
    reasons.push('missing_follow_up');
  }

  if (!Number(lead.communication_count)) {
    const slaBreached = ageHours >= 1;
    priority += slaBreached ? 45 + Math.min(ageHours / 4, 20) : 20;
    reasons.push(slaBreached ? 'first_response_sla_breached' : 'new_uncontacted');
    nextAction = 'first_contact';
  } else if (silentDays >= 7) {
    priority += Math.min(silentDays, 30);
    reasons.push(`silent_days:${Math.floor(silentDays)}`);
  }

  const interest = String(lead.interest_level || '').toUpperCase();
  if (interest === 'HIGH') {
    priority += 25;
    reasons.push('high_interest');
  } else if (interest === 'MEDIUM') {
    priority += 10;
  }
  if (lead.forecast_category === 'commit') {
    priority += 20;
    reasons.push('forecast_commit');
  } else if (lead.forecast_category === 'best_case') {
    priority += 10;
  }
  const dealValue = Math.max(Number(lead.deal_value) || 0, 0);
  if (dealValue > 0) {
    priority += Math.min(Math.log10(dealValue + 1) * 5, 25);
    reasons.push('deal_value');
  }
  if (lead.active_sequence_id) reasons.push('sequence_active');

  const rounded = Math.round(priority * 10) / 10;
  return {
    ...lead,
    priorityScore: rounded,
    priorityBand: priorityBand(rounded),
    nextAction,
    reasons,
    metrics: {
      ageHours: Math.round(ageHours * 10) / 10,
      silentDays: Math.round(silentDays * 10) / 10,
    },
  };
}

function buildWorkQueue(leads, { now = new Date(), limit = 100 } = {}) {
  const items = leads
    .map(lead => prioritizeLead(lead, now))
    .filter(Boolean)
    .sort((left, right) =>
      right.priorityScore - left.priorityScore
      || String(left.next_follow_up_date || '9999').localeCompare(String(right.next_follow_up_date || '9999'))
      || String(left.id).localeCompare(String(right.id)))
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 250));
  const summary = { total: items.length, critical: 0, high: 0, medium: 0, low: 0, slaBreached: 0 };
  for (const item of items) {
    summary[item.priorityBand] += 1;
    if (item.reasons.includes('first_response_sla_breached')) summary.slaBreached += 1;
  }
  return {
    generatedAt: now.toISOString(),
    methodology: 'Explainable priority: follow-up SLA, first response, silence, lead score, interest, forecast category and deal value.',
    summary,
    items,
  };
}

module.exports = { CLOSED, prioritizeLead, buildWorkQueue, priorityBand };
