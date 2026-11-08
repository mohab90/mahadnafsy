'use strict';
// The recruitment workflow decides who gets hired and, through the hire path,
// who gets a staff login. These pin the properties that make it auditable and
// tenant-safe — the parts that cannot be checked by reading the screen.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const workflow = read('routes/hr/recruitment-workflow.js');
const talent = read('routes/hr/talent.js');
const migration = read('migrations/199_v25_recruitment_and_hr_controls.sql');

test('hiring is reachable from the interview stage but not from nothing', () => {
  // The interviews screen hires off the back of a good interview; requiring a
  // separate hop to 'offer' first meant its hire button could only answer 409.
  assert.match(talent, /a\.stage !== 'offer' && a\.stage !== 'interview'/);
  assert.match(talent, /OFFER_STAGE_REQUIRED/);
});

