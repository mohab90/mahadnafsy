-- Indexes for financial P&L date-range reports.

ALTER TABLE payments ADD INDEX IF NOT EXISTS idx_payments_status_date_currency (status, date, currency);
ALTER TABLE expenses ADD INDEX IF NOT EXISTS idx_expenses_date_category (date, category);
