-- «طلبات الاستشارات مش بتظهر ابدا». A booking from the site made an order and
-- nothing else; the consultation row was written only once a transfer receipt
-- was approved, so the desk never saw a request until it was paid — and a card
-- payment never wrote one at all. A booking now opens its consultation at
-- checkout, tied to the order that pays for it.
--
--   order_id  the order the customer is paying through (NULL for bookings
--             entered by staff)
--   paid_at   when that order was paid; NULL while the request waits for money
--   source    where the booking came from: site_express, site_regular,
--             payment_link, admin
ALTER TABLE consultations
  ADD COLUMN IF NOT EXISTS order_id varchar(64) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS paid_at datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source varchar(30) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_consultations_order ON consultations (tenant_id, order_id);
