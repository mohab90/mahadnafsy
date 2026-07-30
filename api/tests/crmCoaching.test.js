'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('CRM coaching requires evidence, reviewer separation, tenant scope and bounded rubric', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'crm-coaching.js'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '166_v25_crm_coaching_evidence.sql'), 'utf8');
  assert.match(route, /requirePermission\('view_reports'\)/);
  assert.match(route, /requirePermission\('manage_leads'\)/);
  assert.match(route, /leadScope\(req, 'l'\)/);
  assert.match(route, /COACHING_REVIEW_SOD/);
  assert.match(route, /Review requires evidence linked to this communication/);
  assert.match(route, /score >= 0 && score <= 5/);
  assert.match(route, /createHash\('sha256'\)/);
  assert.match(migration, /FOREIGN KEY \(evidence_id\)/);
  assert.match(migration, /UNIQUE KEY uq_crm_coaching_review/);
  assert.match(migration, /total_score BETWEEN 0 AND 100/);
});

test('CRM coaching review score is calculated server-side from the four rubric fields', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'crm-coaching.js'), 'utf8');
  assert.match(route, /scores\.reduce\(\(sum, score\) => sum \+ score, 0\) \/ 20 \* 100/);
  assert.doesNotMatch(route, /req\.body\?\.total_score/);
});
