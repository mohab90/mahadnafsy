-- Where each uploaded file lives while videos and pictures move off the server's disk (21 Oct 2026, disk at 88%).
--
-- One row per file that has been in the bucket or is on its way there (lib/storageLedger.js): `local` is on
-- this server only, `both` is copied and verified (size and SHA-256) with the local copy still kept, `remote`
-- is in the bucket only. A read looks on the disk first and then here, so a half-finished move or a rollback
-- to the local driver keeps every file reachable. pending_offload marks a new upload that the API itself is
-- to move (lib/storageOffload.js); files that were here before are moved only by
-- tools/move-uploads-to-storage.cjs. claimed_until stops two processes moving the same file at once.
CREATE TABLE IF NOT EXISTS storage_objects (
  object_key varchar(255) NOT NULL,
  tenant_id varchar(64) NOT NULL,
  kind enum('video','image','proof') NOT NULL,
  location enum('local','both','remote') NOT NULL DEFAULT 'local',
  size_bytes bigint unsigned DEFAULT NULL,
  sha256 char(64) DEFAULT NULL,
  content_type varchar(100) DEFAULT NULL,
  pending_offload tinyint(1) NOT NULL DEFAULT 0,
  claimed_until datetime DEFAULT NULL,
  copied_at datetime DEFAULT NULL,
  local_deleted_at datetime DEFAULT NULL,
  last_error varchar(500) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  updated_at datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (object_key),
  KEY idx_storage_objects_pending (pending_offload, location),
  KEY idx_storage_objects_tenant (tenant_id, kind, location)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
