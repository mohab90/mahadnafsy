-- Unified soft delete 2026-06-20 (Top20 #16).
-- Standard deleted_at TIMESTAMP NULL across core tables. NULL = live row.
-- Read paths should add `AND deleted_at IS NULL`; see api/lib/softDelete.js.

ALTER TABLE leads         ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ADD INDEX idx_leads_deleted (deleted_at);
ALTER TABLE subscribers   ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ADD INDEX idx_subscribers_deleted (deleted_at);
ALTER TABLE payments      ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ADD INDEX idx_payments_deleted (deleted_at);
ALTER TABLE orders        ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ADD INDEX idx_orders_deleted (deleted_at);
ALTER TABLE expenses      ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ADD INDEX idx_expenses_deleted (deleted_at);
ALTER TABLE courses       ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ADD INDEX idx_courses_deleted (deleted_at);
ALTER TABLE bundles       ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ADD INDEX idx_bundles_deleted (deleted_at);
ALTER TABLE consultations ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ADD INDEX idx_consultations_deleted (deleted_at);
ALTER TABLE staff         ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL, ADD INDEX idx_staff_deleted (deleted_at);
