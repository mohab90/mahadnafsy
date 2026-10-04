'use strict';
// What the WhatsApp tab keeps from a message the linked phone reports
// (lib/whatsappWebStore.js parseWaMessage): one-to-one chats only, the
// number-based address whenever WhatsApp gives it, and a readable line for
// what is not text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWaMessage, jidForPhone } = require('../lib/whatsappWebStore');

const msg = (key, message, extra = {}) => ({ key: { id: 'ID1', ...key }, message, messageTimestamp: 1790000000, ...extra });

test('a text from a person is kept with their number and time', () => {
  const row = parseWaMessage(msg({ remoteJid: '201012345678@s.whatsapp.net' }, { conversation: 'السلام عليكم' }, { pushName: 'منى' }));
  assert.deepEqual(row, {
    jid: '201012345678@s.whatsapp.net', phone: '201012345678', waId: 'ID1', fromMe: false,
    body: 'السلام عليكم', kind: 'text', sentAt: new Date(1790000000 * 1000), pushName: 'منى',
  });
});

test('a private-id (@lid) chat is filed under the number when WhatsApp shares it', () => {
  const withNumber = parseWaMessage(msg({ remoteJid: '1234567@lid', remoteJidAlt: '201099999999@s.whatsapp.net' }, { conversation: 'x' }));
  assert.equal(withNumber.jid, '201099999999@s.whatsapp.net');
  assert.equal(withNumber.phone, '201099999999');
  const without = parseWaMessage(msg({ remoteJid: '1234567@lid' }, { conversation: 'x' }));
  assert.equal(without.jid, '1234567@lid');
  assert.equal(without.phone, null);
});

test('groups, status updates and reactions are not conversations with a client', () => {
  assert.equal(parseWaMessage(msg({ remoteJid: '120363@g.us' }, { conversation: 'x' })), null);
  assert.equal(parseWaMessage(msg({ remoteJid: 'status@broadcast' }, { conversation: 'x' })), null);
  assert.equal(parseWaMessage(msg({ remoteJid: '201012345678@s.whatsapp.net' }, { reactionMessage: { text: '👍' } })), null);
});

test('media gets its caption or a readable label; wrapped messages are unwrapped', () => {
  const kindBody = m => { const r = parseWaMessage(msg({ remoteJid: '201012345678@s.whatsapp.net', fromMe: true }, m)); return [r.kind, r.body, r.fromMe]; };
  assert.deepEqual(kindBody({ imageMessage: { caption: 'الإيصال' } }), ['image', 'الإيصال', true]);
  assert.deepEqual(kindBody({ audioMessage: {} }), ['audio', '[رسالة صوتية]', true]);
  assert.deepEqual(kindBody({ ephemeralMessage: { message: { extendedTextMessage: { text: 'مختفية' } } } }), ['text', 'مختفية', true]);
});

test('a typed number becomes a WhatsApp address only when it can be dialled', () => {
  assert.equal(jidForPhone('01012345678'), '201012345678@s.whatsapp.net');
  assert.equal(jidForPhone('+966 50 123 4567'), '966501234567@s.whatsapp.net');
  assert.equal(jidForPhone('12345'), null);
});
