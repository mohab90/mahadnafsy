ALTER TABLE payment_links
  ADD COLUMN used_by_order_id VARCHAR(36) NULL AFTER used_at,
  ADD INDEX idx_payment_link_redemption (tenant_id,used_by_order_id),
  ADD CONSTRAINT fk_payment_link_order
    FOREIGN KEY (used_by_order_id) REFERENCES orders(id) ON DELETE RESTRICT;
