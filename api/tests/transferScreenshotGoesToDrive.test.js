'use strict';

// 25 Oct 2026 — «العميل لما بيقول دفعت انستاباي وبيرفع صورة التحويل، المحاسب مش شايف الصورة»: the screenshot
// goes to Google Drive and the payment carries its link to every screen that confirms or links a transfer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { storeTransferScreenshot } = require('../lib/transferScreenshot');

const read = relative => fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('the screenshot is uploaded to Drive and the link comes back', async () => {
  let sent = null;
  const url = await storeTransferScreenshot(PNG, { who: 'منى علي', orderId: 'o-1' }, {
    isConfigured: () => true,
    uploadImage: async file => { sent = file; return { id: 'abc', url: 'https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=drivesdk' }; },
  });
  assert.equal(url, 'https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=drivesdk');
  assert.equal(sent.mimeType, 'image/png');
  assert.match(sent.name, /^صورة-التحويل-منى علي|^صورة-التحويل-منىعلي/);
  assert.ok(sent.buffer.length > 10);
});

test('no Drive, a Drive that fails, or a non-image gives no link — the receipt is then kept in the system', async () => {
  assert.equal(await storeTransferScreenshot(PNG, {}, { isConfigured: () => false }), null);
  assert.equal(await storeTransferScreenshot(PNG, {}, { isConfigured: () => true, uploadImage: async () => { throw new Error('boom'); } }), null);
  assert.equal(await storeTransferScreenshot('data:text/html;base64,PGI+', {}, { isConfigured: () => true, uploadImage: async () => ({ url: 'https://drive.google.com/file/d/1AbCdEfGhIjK/view' }) }), null);
  // A link that is not a Drive file is never stored.
  assert.equal(await storeTransferScreenshot(PNG, {}, { isConfigured: () => true, uploadImage: async () => ({ url: 'https://evil.example/x.png' }) }), null);
});

test('the proof keeps the link, the approved payment copies it, and the screens show it', () => {
  const proofs = read('api/routes/payment-proofs.js');
  assert.match(proofs, /storeTransferScreenshot\(proof_image/);
  assert.match(proofs, /proofUrl \? null : \(proof_image \|\| null\), proofUrl/, 'the picture stays in the row only when Drive gave no link');
  assert.match(proofs, /tenant_id, proof_url, created_at\)/, 'the approved payment carries the link');
  assert.match(read('api/migrations/300_v26_transfer_screenshot_link.sql'), /ALTER TABLE payments ADD COLUMN IF NOT EXISTS proof_url/);
  assert.match(read('api/migrations/300_v26_transfer_screenshot_link.sql'), /ALTER TABLE payment_proofs ADD COLUMN IF NOT EXISTS proof_url/);
  assert.match(read('api/routes/finance-payments-register.js'), /proofUrl: r\.proof_url/);
  assert.match(read('api/routes/orders.js'), /AS proof_url/);
  assert.match(read('api/lib/mappers.js'), /proofUrl: p\.proof_url/);
  for (const screen of [
    'admin/pages/dashboard/tabs/financial/PaymentsRegister.tsx',
    'admin/pages/dashboard/tabs/financial/PaymentReviewPanel.tsx',
    'admin/pages/dashboard/tabs/financial/PaymentProofsPanel.tsx',
    'admin/pages/dashboard/tabs/orders/OrdersAdminView.tsx',
  ]) assert.match(read(screen), /<TransferProofLink url=/, screen);
});
