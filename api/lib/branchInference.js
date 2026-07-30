'use strict';

const { BRANCH_ALIASES, normalizeBranch } = require('./branches');

function searchable(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^ال/, '')
    .replace(/[\s_\-،,|]+/g, '');
}

function buildBranchCandidates(branches = []) {
  const aliases = new Map(Object.entries(BRANCH_ALIASES));
  for (const branch of branches) {
    const key = normalizeBranch(branch.branch_key || branch.id, null);
    if (!key) continue;
    aliases.set(branch.branch_key || branch.id, key);
    if (branch.label) aliases.set(branch.label, key);
  }
  return [...aliases]
    .map(([alias, branch]) => ({ alias: searchable(alias), branch }))
    .filter(({ alias }) => alias.length >= 3)
    .sort((a, b) => b.alias.length - a.alias.length);
}

function inferBranchFromLead(lead, candidates) {
  const crm = typeof lead.crm_json === 'string'
    ? (() => { try { return JSON.parse(lead.crm_json); } catch { return {}; } })()
    : (lead.crm_json || {});
  const explicit = crm.rawBranch || crm.branch;
  const normalizedExplicit = normalizeBranch(explicit, null);
  if (normalizedExplicit) return normalizedExplicit;

  const notes = String(lead.notes || '');
  const labelled = /(?:الفرع|فرع|branch)\s*[:\-]\s*([^|\n،,]+)/i.exec(notes)?.[1];
  const sources = [labelled, explicit, notes, lead.source].filter(Boolean);
  for (const source of sources) {
    const text = searchable(source);
    const found = candidates.find(({ alias }) => text === alias || text.includes(alias));
    if (found) return found.branch;
  }
  return null;
}

module.exports = { buildBranchCandidates, inferBranchFromLead, searchable };
