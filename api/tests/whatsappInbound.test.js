'use strict';
// Inbound WhatsApp is how a customer answers. The parsing half is what decides
// whether that answer reaches a human at all, so it is pinned here; the write
// half needs a database and is exercised by the route tests.
const { test } = require('node:test');
const assert = require('node:assert');
const { extractMetaMessages, extractGreenApiMessage } = require('../lib/whatsappInbound');

test('a Meta text reply is extracted with its id, sender and body', () => {
  const [message] = extractMetaMessages({
    entry: [{ changes: [{ value: { messages: [{
      id: 'wamid.ABC', from: '201012345678', timestamp: '1754000000',
      type: 'text', text: { body: 'عايز أعرف المواعيد' },
    }] } }] }],
  });
  assert.equal(message.providerMessageId, 'wamid.ABC');
  assert.equal(message.from, '201012345678');
  assert.equal(message.body, 'عايز أعرف المواعيد');
  assert.equal(message.timestamp, '1754000000');
});

test('a Meta payload carrying only delivery statuses yields no messages', () => {
  // Statuses and messages arrive in the same envelope; reading a status as a
  // message would post an empty note to the customer's timeline.
  const messages = extractMetaMessages({
    entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }],
  });
  assert.deepEqual(messages, []);
});

test('several Meta replies in one envelope are all extracted', () => {
  const messages = extractMetaMessages({
    entry: [
      { changes: [{ value: { messages: [
        { id: 'a', from: '201000000001', text: { body: 'one' } },
        { id: 'b', from: '201000000002', text: { body: 'two' } },
      ] } }] },
      { changes: [{ value: { messages: [{ id: 'c', from: '201000000003', text: { body: 'three' } }] } }] },
    ],
  });
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map(m => m.providerMessageId), ['a', 'b', 'c']);
});

test('a Meta button reply is read as its label, not dropped', () => {
  const [message] = extractMetaMessages({
    entry: [{ changes: [{ value: { messages: [{
      id: 'wamid.B', from: '201012345678', type: 'button', button: { text: 'نعم' },
    }] } }] }],
  });
  assert.equal(message.body, 'نعم');
});

test('malformed or empty Meta payloads yield nothing rather than throwing', () => {
  for (const payload of [{}, null, undefined, { entry: [] }, { entry: [{}] }, { entry: [{ changes: [{}] }] }]) {
    assert.deepEqual(extractMetaMessages(payload), [], JSON.stringify(payload));
  }
});

test('a Green-API reply is extracted and the chatId suffix stripped', () => {
  const message = extractGreenApiMessage({
    typeWebhook: 'incomingMessageReceived',
    idMessage: 'GA123',
    timestamp: 1754000000,
    senderData: { chatId: '201012345678@c.us' },
    messageData: { textMessageData: { textMessage: 'السلام عليكم' } },
  });
  assert.equal(message.providerMessageId, 'GA123');
  assert.equal(message.from, '201012345678', 'the @c.us suffix must not reach the number matcher');
  assert.equal(message.body, 'السلام عليكم');
});

test('a Green-API extended text reply is read from its own field', () => {
  const message = extractGreenApiMessage({
    typeWebhook: 'incomingMessageReceived',
    idMessage: 'GA124',
    senderData: { chatId: '201012345678@c.us' },
    messageData: { extendedTextMessageData: { text: 'رد على رسالة' } },
  });
  assert.equal(message.body, 'رد على رسالة');
});

test('a Green-API status callback is not treated as an inbound message', () => {
  assert.equal(extractGreenApiMessage({ typeWebhook: 'outgoingMessageStatus', idMessage: 'X' }), null);
  assert.equal(extractGreenApiMessage({}), null);
  assert.equal(extractGreenApiMessage(null), null);
});

test('a Green-API media message with no caption still carries an id and sender', () => {
  // The body is empty, but the message must still be recorded — otherwise a
  // customer sending a payment screenshot registers as silence.
  const message = extractGreenApiMessage({
    typeWebhook: 'incomingMessageReceived',
    idMessage: 'GA125',
    senderData: { chatId: '201012345678@c.us' },
    messageData: { fileMessageData: { downloadUrl: 'https://example.test/x.jpg' } },
  });
  assert.equal(message.providerMessageId, 'GA125');
  assert.equal(message.from, '201012345678');
  assert.equal(message.body, '');
});
