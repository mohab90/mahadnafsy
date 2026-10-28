'use strict';

// Two boxes that are one box. «فودافون كاش 1010 هو هو فودافون كاش 1079»: what was typed on the payments is evidence and is never rewritten, so the
// name is read through box_aliases wherever boxes are counted — one name per box, one balance.


/** alias → target for the tenant, as a Map of the names exactly as the boxes carry them. */
async function loadBoxAliases(db, tenantId) {
  const [rows] = await db.query('SELECT alias, target FROM box_aliases WHERE tenant_id = ?', [tenantId]);
  return new Map(rows.map(row => [row.alias, row.target]));
}

/** The name a box is counted under: followed through the table, with a guard against a loop. */
function applyAlias(name, aliases) {
  if (!aliases?.size) return name;
  let current = name;
  for (let hops = 0; hops < 8; hops += 1) {
    const next = aliases.get(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Register `from` as another name of `into`. Refused when they are the same box already, or when `into` is itself named for `from`
 * (a loop). Returns the aliases that now point at `into`, for the caller's balance work.
 */
async function registerAlias(db, { tenantId, from, into, actor = null }) {
  const source = String(from || '').trim();
  const target = String(into || '').trim();
  const fail = (message, code) => Object.assign(new Error(message), { statusCode: 400, code });
  if (!source || !target) throw fail('اختار الخزنتين', 'BOX_REQUIRED');
  const aliases = await loadBoxAliases(db, tenantId);
  const resolvedTarget = applyAlias(target, aliases);
  if (applyAlias(source, aliases) === resolvedTarget) throw fail('الخزنتين دول نفس الخزنة بالفعل', 'BOX_SAME');
  if (resolvedTarget === source) throw fail('مينفعش تدمج خزنة في خزنة بتتسمى باسمها', 'BOX_LOOP');
  await db.query(
    `INSERT INTO box_aliases (tenant_id, alias, target, created_by) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE target = VALUES(target), created_by = VALUES(created_by)`,
    [tenantId, source, resolvedTarget, actor ? String(actor).slice(0, 255) : null]);
  // Anything that pointed at the source now points at the target.
  await db.query('UPDATE box_aliases SET target = ? WHERE tenant_id = ? AND target = ?', [resolvedTarget, tenantId, source]);
  return resolvedTarget;
}

module.exports = { applyAlias, loadBoxAliases, registerAlias };
