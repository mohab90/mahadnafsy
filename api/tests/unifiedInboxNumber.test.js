'use strict';
/**
 * «رقم واتس اب الانبوكس الموحد هيكون 01006006466»: the company WhatsApp channel
 * carries that number, and a channel with no credentials yet sends nothing —
 * resolution only ever picks a connected one.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');

test('the company WhatsApp is 01006006466, pending until its credentials are entered', () => {
  const sql = read('api/migrations/265_v26_unified_inbox_whatsapp_number.sql');
  assert.match(sql, /'whatsapp', 'meta', NULL, 'واتساب الشركة — الانبوكس الموحد', '201006006466', 'pending'/);
  assert.match(sql, /AND \(display_number IS NULL OR display_number = ''\)/, 'a number already shown is left alone');
  assert.equal(require('../lib/phoneNumber').toDialable('01006006466'), '201006006466');
  const channels = read('api/lib/messagingChannels.js');
  assert.match(channels, /'is_default = 1 AND kind = \? AND owner_staff_id IS NULL', \[kind\], "status='connected'"/);
});
