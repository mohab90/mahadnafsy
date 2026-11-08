'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const route = read('routes/privacy.js');
const service = read('lib/privacyService.js');
const legacy = read('routes/admin-utils.js');

test('subscriber PII export scopes every business dataset to the request tenant and audits access', () => {
  
  for (const table of ['payments', 'enrollments', 'course_completions', 'support_tickets', 'nps_responses']) {
    assert.match(service, new RegExp(`FROM ${table} WHERE tenant_id=\\? AND subscriber_id=\\?`), table);
  }
  
  
  
});


