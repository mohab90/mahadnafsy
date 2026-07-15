ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128) DEFAULT NULL AFTER id;
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_users_firebase (firebase_uid);
ALTER TABLE subscribers ADD INDEX IF NOT EXISTS idx_subs_active (is_active);
