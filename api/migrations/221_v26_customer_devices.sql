-- customer_devices: the devices a customer account is used from, two at most.
--
-- «العميل لما بيشترك في كورس لازم تحفظ ip الجهاز ... ومسموح له 2 ip فقط يعني
-- لو حب يدخل من جهاز تالت تقف وتظهرله رساله انت فتحت اكتر من جهاز».
--
-- A device is the browser, known by a long-lived cookie (lib/customerDevices.js)
-- and stored here only as its keyed hash. The IP it last signed in from is kept
-- with it, as asked, but is not what identifies it: the same phone gets a new IP
-- several times a day on mobile data, and counting IPs would lock out the
-- people paying for the course. Clearing a customer's rows (the desk's «مسح
-- الأجهزة») lets them sign in from a new device.
--
-- Starts empty: every customer's next sign-in registers the device they use.

CREATE TABLE IF NOT EXISTS customer_devices (
  id varchar(36) NOT NULL DEFAULT (uuid()),
  tenant_id varchar(64) NOT NULL,
  user_id varchar(100) NOT NULL,
  device_hash char(64) NOT NULL,
  last_ip varchar(45) DEFAULT NULL,
  user_agent varchar(255) DEFAULT NULL,
  first_seen_at datetime NOT NULL DEFAULT current_timestamp(),
  last_seen_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_customer_device (tenant_id, user_id, device_hash),
  KEY idx_customer_devices_user (tenant_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
