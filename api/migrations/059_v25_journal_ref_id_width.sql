-- Payment ids can be longer than legacy UUID-sized refs (for example imported
-- gateway/staff ids). The ledger ref must fit the source payment id exactly.

ALTER TABLE journal_entries MODIFY COLUMN ref_id VARCHAR(191) DEFAULT NULL;
ALTER TABLE journal_entries ADD INDEX IF NOT EXISTS idx_journal_ref (ref_type, ref_id);
