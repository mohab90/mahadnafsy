-- Convert monetary/rate columns away from binary floating point.
-- Safe/idempotent for MariaDB/MySQL environments that already ran older money fixes.

ALTER TABLE courses
  MODIFY price_egp DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_sar DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_egp DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_sar DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_usd DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE bundles
  MODIFY price_egp DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_sar DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_egp DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_sar DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY orig_price_usd DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE therapists
  MODIFY price_egp DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_sar DECIMAL(12,2) NOT NULL DEFAULT 0,
  MODIFY price_usd DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE subscribers
  MODIFY discount DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE payments
  MODIFY amount DECIMAL(12,2) NOT NULL,
  MODIFY course_expected DECIMAL(12,2) DEFAULT NULL,
  MODIFY discount DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE certificate_requests
  MODIFY price DECIMAL(12,2) DEFAULT NULL,
  MODIFY paid_amount DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE consultations
  MODIFY amount DECIMAL(12,2) DEFAULT NULL;

ALTER TABLE expenses
  MODIFY amount DECIMAL(12,2) NOT NULL;

ALTER TABLE payment_proofs
  MODIFY amount DECIMAL(12,2) NOT NULL;

ALTER TABLE daqqi_attendees
  MODIFY amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
  MODIFY amount DECIMAL(12,2) NOT NULL;

ALTER TABLE staff
  MODIFY commission_rate DECIMAL(5,2) DEFAULT NULL;

ALTER TABLE discount_rules
  MODIFY discount_percent DECIMAL(5,2) NOT NULL;

ALTER TABLE instructor_rates
  ADD COLUMN IF NOT EXISTS revenue_share_pct DECIMAL(5,2) DEFAULT 0;

ALTER TABLE instructor_rates
  MODIFY consultation_rate_value DECIMAL(12,2) DEFAULT 0,
  MODIFY lecture_rate_per_hour DECIMAL(12,2) DEFAULT 0,
  MODIFY training_rate_per_hour DECIMAL(12,2) DEFAULT 0,
  MODIFY revenue_share_pct DECIMAL(5,2) DEFAULT 0;

ALTER TABLE employee_bonuses
  MODIFY amount DECIMAL(12,2) NOT NULL;

ALTER TABLE crm_commissions
  MODIFY payment_amount DECIMAL(12,2) NOT NULL,
  MODIFY commission_amount DECIMAL(12,2) NOT NULL;
