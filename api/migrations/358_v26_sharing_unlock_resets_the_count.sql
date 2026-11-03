-- «فتحت حسابها وبرضه ما اتفتحش» (3 Nov 2026): lifting a sharing lock cleared the lock but not what caused it. The guard counts the devices an account signed in from
-- over the last 24 hours, so the very next sign-in found the same devices still in the log, counted more than the allowance and locked the account again.
-- sharing_reset_at is the moment a person on the staff lifted the lock: devices before it no longer count.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sharing_reset_at DATETIME NULL COMMENT 'When the sharing lock was last lifted by hand; sign-ins before it are not counted by the device guard.';
