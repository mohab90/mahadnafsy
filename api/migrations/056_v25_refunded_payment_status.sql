-- Refunds must be distinguishable from failed/cancelled payments so finance
-- reports can net revenue correctly.

ALTER TABLE payments MODIFY COLUMN status ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'paid';
