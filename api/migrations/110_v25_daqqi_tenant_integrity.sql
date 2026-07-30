-- Daqqi rounds and attendees are tenant-native operational records.
ALTER TABLE daqqi_attendees
  ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default' AFTER subscriber_id;

UPDATE daqqi_attendees da
JOIN daqqi_rounds dr ON dr.id=da.round_id
SET da.tenant_id=dr.tenant_id
WHERE da.tenant_id IS NULL OR da.tenant_id<>dr.tenant_id;

ALTER TABLE daqqi_attendees
  ADD INDEX IF NOT EXISTS idx_daqqi_attendees_tenant_round (tenant_id, round_id);

DROP INDEX IF EXISTS idx_daqqi_code ON daqqi_rounds;
ALTER TABLE daqqi_rounds
  ADD UNIQUE INDEX IF NOT EXISTS uq_daqqi_rounds_tenant_code (tenant_id, code);
