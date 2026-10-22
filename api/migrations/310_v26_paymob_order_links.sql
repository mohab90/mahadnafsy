-- Which Paymob order was opened for which of our orders (21 Oct 2026).
--
-- Paymob signs its own order id in a callback, not the merchant_order_id that names our order, so a signed «paid» for
-- one order could be replayed with another order's id in the unsigned field. Each checkout attempt records the Paymob
-- order it opened here, and finalising credits the order this table names for the signed id (lib/paymobFinalise.js).
CREATE TABLE IF NOT EXISTS paymob_order_links (
  tenant_id varchar(64) NOT NULL,
  paymob_order_id varchar(64) NOT NULL,
  order_id varchar(36) NOT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (tenant_id, paymob_order_id),
  KEY idx_paymob_order_links_order (tenant_id, order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
