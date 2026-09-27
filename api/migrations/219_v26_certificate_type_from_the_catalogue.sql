-- A certificate request's type is a code from «تسعير الشهادات» (content
-- extra_cert_pricing), not one of eight fixed ones.
--
-- Customer service added eight certificates there — the Azhar one, the National
-- Council 60/100/180-hour ones, the membership card — and they could be priced
-- but not requested: this column was an ENUM of the eight the system started
-- with, so the request was refused before it was stored. The table is empty on
-- production, and every value it could hold is kept.

ALTER TABLE certificate_requests
  MODIFY COLUMN type VARCHAR(64) NOT NULL;
