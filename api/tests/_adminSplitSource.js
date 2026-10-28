'use strict';
// Screens that were one file and are a folder of modules now, read back as one text in the order the code used to
// stand, for the tests that check them as text: the payment dialog (admin/components/PaymentModal.tsx and
// admin/components/payment-modal/) and the dashboard shell (admin/pages/Dashboard.tsx and admin/pages/dashboard/shell/).
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PAYMENT_MODAL = [
  'admin/components/payment-modal/paymentDraft.ts',
  'admin/components/payment-modal/PrintReceiptModal.tsx',
  'admin/components/payment-modal/paymentTiles.ts',
  'admin/components/payment-modal/paymentModalTypes.ts',
  'admin/components/payment-modal/PhotoPicker.tsx',
  'admin/components/payment-modal/SubjectSearchPicker.tsx',
  'admin/components/payment-modal/usePaymentModalModel.tsx',
  'admin/components/payment-modal/clientHoldings.ts',
  'admin/components/PaymentModal.tsx',
  'admin/components/payment-modal/PaymentItemSection.tsx',
  'admin/components/payment-modal/PaymentExtrasSection.tsx',
  'admin/components/payment-modal/PaymentPersonSection.tsx',
];

/** The payment dialog's source, every module of it. */
const paymentModalSource = () => PAYMENT_MODAL.map(read).join('\n');

/** The dashboard shell's source: Dashboard.tsx and the modules it was split into. */
function dashboardSource() {
  const dir = path.join(ROOT, 'admin', 'pages', 'dashboard', 'shell');
  const parts = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(name => /\.tsx?$/.test(name)).sort().map(name => `admin/pages/dashboard/shell/${name}`)
    : [];
  return ['admin/pages/Dashboard.tsx', ...parts].map(read).join('\n');
}

module.exports = { PAYMENT_MODAL, paymentModalSource, dashboardSource };
