-- Refund requests carried a status and one free-text admin note, which is all a
-- yes/no decision needs. What the institute actually runs is wider than that:
-- an approved refund is approved *for an amount* (often less than the customer
-- asked for), a rejection has to state why, some requests are neither and get
-- handled some other way, a disputed one goes up to senior management, and
-- where a refund was caused by a staff mistake somebody owns that. None of it
-- could be recorded, so it lived in people's heads and in WhatsApp.
--
-- Every column is nullable and every existing row keeps its current status, so
-- the 27 requests already in the table read exactly as they did before.

-- What was actually returned, once approved. Distinct from `amount`, which is
-- what the customer asked for — the two disagreeing is the normal case.
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS refunded_amount DECIMAL(12,2) DEFAULT NULL;

-- Why a request was refused, or what was done for a request that was neither
-- approved nor refused. Kept apart from admin_note so a decision's reason is
-- not mixed in with running commentary.
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS decision_note TEXT DEFAULT NULL;

-- Raised to senior management. Two columns rather than a status, because a
-- request stays in whatever state it was in while it is being escalated.
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS escalated_at DATETIME DEFAULT NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS escalated_by VARCHAR(36) DEFAULT NULL;

-- The employee whose mistake led to the refund, when there was one. Nullable
-- and never inferred: it is only ever set by somebody choosing a name.
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS blamed_staff_id VARCHAR(36) DEFAULT NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS blame_note TEXT DEFAULT NULL;

-- Deleting a refund request archives it, like every other delete in this
-- system: a money decision should not be erasable without trace.
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS deleted_at DATETIME DEFAULT NULL;

-- Marks the point the money actually left the account, which is later than —
-- and sometimes never follows — the approval.
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS refunded_at DATETIME DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_refund_requests_status ON refund_requests (tenant_id, status, created_at);
