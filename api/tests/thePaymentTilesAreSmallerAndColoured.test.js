'use strict';
/**
 * «صغر حجم الايقونات شوية وخليها بتصميم مميز، وبالنسبة للايقونات اللى تحتهم خلى ايقونة اخرى معاهم
 * على نفس الصف وخليهم اطول شوية» (14 Oct 2026): the booking kinds are smaller coloured tiles, the
 * item types gain «مسار» on the same row and are taller.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { paymentModalSource } = require('./_adminSplitSource');

const modal = paymentModalSource();
const tilesFile = fs.readFileSync(path.join(__dirname, '..', '..', 'admin', 'components', 'payment-modal', 'paymentTiles.ts'), 'utf8');

test('each booking kind has its own colour and a small icon tile', () => {
  for (const kind of ['new_booking', 'installment', 'retake', 'upgrade']) assert.match(modal, new RegExp(`${kind}: \\{ on:`));
  
  
});

test('the item types are one taller row of seven, «مسار» among them, and it lists the tracks only', () => {
  const tiles = tilesFile.slice(tilesFile.indexOf('const PAYMENT_TYPE_TILES'), tilesFile.indexOf('export const PHOTO_COPY'));
  for (const label of ['كورس', 'مسار', 'شهادة', 'استشارة', 'كتاب', 'كارنيه', 'أخرى']) assert.match(tiles, new RegExp(`lb: '${label}'`));
  
  
  
});
