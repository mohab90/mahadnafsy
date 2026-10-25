-- The device a sign-in came from, kept with the sign-in (25 Oct 2026).
--
-- «لو عميل فتح الموقع مرتين من نفس الجهاز على شبكتين مختلفتين بيتقفل عليه»: the account-sharing guard counted
-- distinct IP addresses, and a phone changes address whenever it moves between WiFi and mobile data, so one
-- person on one device was locked out as a "shared" account. The guard now counts distinct DEVICES — the keyed
-- hash of the long-lived device cookie (lib/customerDevices.js) — and the network is no longer part of the rule.
ALTER TABLE login_history ADD COLUMN IF NOT EXISTS device_hash CHAR(64) NULL AFTER ip;
ALTER TABLE login_history ADD INDEX IF NOT EXISTS idx_login_history_device (tenant_id, email, created_at, device_hash);
