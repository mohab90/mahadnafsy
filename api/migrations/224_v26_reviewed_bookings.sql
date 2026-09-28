-- Bookings from a collection account wait for the manager, and every approval
-- is tied to a transfer that arrived.
--
-- «خلي في امكانيه انه يضيف مشترك جديد ولكن لا يضاف حتي يراجع تحويله
-- ومدفوعاته من حساب المسئول واي حجز لازم ميسمعش لحد ما المسئول يتاكد من
-- المدفوعات ويربطه بتحويل».
--
-- incoming_transfers — the money the manager saw arrive: amount, box, the
--   operation number, who sent it. A transfer confirms one payment and one
--   only (uq_incoming_transfer_payment), and an operation number is recorded
--   once per box (uq_incoming_transfer_ref). The «التحويلات» tab this replaces
--   wrote type='transfer' into orders, whose type ENUM has no such member, with
--   status 'paid', which that route refuses — so there has never been a
--   transfer on production and «🔗 ربط» could not succeed.
--
-- subscriber_requests — a new customer from a collection account, held as the
--   request it is: the draft and the first payment exactly as sent. Nothing is
--   created until the manager approves; approving runs the ordinary booking
--   (routes/subscriber-payments.js) inside one transaction with the request's
--   own status change.
--
-- payments.linked_transfer_id — the transfer that confirmed a payment.

CREATE TABLE IF NOT EXISTS incoming_transfers (
  id varchar(36) NOT NULL,
  tenant_id varchar(64) NOT NULL,
  amount decimal(12,2) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'EGP',
  method varchar(100) NOT NULL,
  reference varchar(191) DEFAULT NULL,
  sender_name varchar(255) DEFAULT NULL,
  sender_phone varchar(40) DEFAULT NULL,
  received_on date NOT NULL,
  note text DEFAULT NULL,
  recorded_by varchar(36) DEFAULT NULL,
  recorded_by_name varchar(255) DEFAULT NULL,
  payment_id varchar(100) DEFAULT NULL,
  linked_at datetime DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_incoming_transfer_payment (tenant_id, payment_id),
  UNIQUE KEY uq_incoming_transfer_ref (tenant_id, method, reference),
  KEY idx_incoming_transfers_tenant (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriber_requests (
  id varchar(36) NOT NULL,
  tenant_id varchar(64) NOT NULL,
  requested_by varchar(36) NOT NULL,
  requested_by_name varchar(255) DEFAULT NULL,
  lead_id varchar(64) DEFAULT NULL,
  name varchar(300) NOT NULL,
  phone varchar(40) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  amount decimal(12,2) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'EGP',
  body_json longtext NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending',
  review_note text DEFAULT NULL,
  reviewed_by varchar(36) DEFAULT NULL,
  reviewed_by_name varchar(255) DEFAULT NULL,
  reviewed_at datetime DEFAULT NULL,
  subscriber_id varchar(36) DEFAULT NULL,
  payment_id varchar(100) DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  KEY idx_subscriber_requests_status (tenant_id, status, created_at),
  KEY idx_subscriber_requests_by (tenant_id, requested_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS linked_transfer_id varchar(36) DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_linked_transfer ON payments (tenant_id, linked_transfer_id);
