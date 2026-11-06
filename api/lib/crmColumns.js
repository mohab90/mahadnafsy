'use strict';

/**
 * Keys that have left subscribers.crm_json for a column of their own, and the one place that knows how they go in and out.
 *
 * «تفريغ crm_json في جداول» is done one key at a time. A key owned here is
 *   - WRITTEN to its column and taken out of the blob (takeOwned), by every writer that saves a client's blob;
 *   - READ from the blob while an old row still has it there, else from the column (withOwned) — so a row an older server wrote during a release, or one not yet cleaned
 *     by the migration that removes the old copies, shows its newest value, and the screens see the key exactly where they always did (`clientStatus` on the client).
 *
 * Adding a key is one line in OWNED, a migration that adds the column and copies the value, and a later one that removes the old copies.
 */

const OWNED = [
  { key: 'clientStatus', column: 'client_status', max: 40 },
  // 6 Nov 2026: the online client's market (local / saudi / intl), which decides their tab, their currency and the collection officer who takes them.
  { key: 'market', column: 'market', max: 10 },
];

const textOf = (value, max) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().slice(0, max);
  return text || null;
};

/** Splits a blob about to be saved: { crm: the blob without the owned keys, set: { column: value|null } for each owned key the blob carried }. Never mutates `crm`. */
function takeOwned(crm) {
  const rest = { ...(crm || {}) };
  const set = {};
  for (const { key, column, max } of OWNED) {
    if (!Object.prototype.hasOwnProperty.call(rest, key)) continue;
    set[column] = textOf(rest[key], max);
    delete rest[key];
  }
  return { crm: rest, set };
}

/** The blob as a screen should see it: the owned keys put back from the row's columns where the blob does not have them. */
function withOwned(crm, row) {
  const out = { ...(crm || {}) };
  for (const { key, column } of OWNED) {
    if (Object.prototype.hasOwnProperty.call(out, key)) continue;
    const value = row?.[column];
    if (value !== null && value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

/** SQL for "this owned key of subscribers row `alias`, the blob's while it is there, else the column's" — '' when neither has it. */
function ownedSql(key, alias = 's') {
  const owned = OWNED.find(entry => entry.key === key);
  if (!owned) throw new Error(`${key} is not an owned crm key`);
  return `CASE WHEN JSON_VALID(${alias}.crm_json) AND JSON_CONTAINS_PATH(${alias}.crm_json,'one','$.${key}')
               THEN COALESCE(JSON_UNQUOTE(JSON_EXTRACT(${alias}.crm_json,'$.${key}')),'')
               ELSE COALESCE(${alias}.${owned.column},'') END`;
}

module.exports = { OWNED, takeOwned, withOwned, ownedSql };
