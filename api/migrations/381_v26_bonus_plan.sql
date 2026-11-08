-- «نظام المكافآت» (8 Nov 2026): the month's bonus of each employee, worked out by the system from rules kept as data (lib/bonusPlan.js) and written as a
-- bonus awaiting HR's approval — nothing is paid before a person approves it (4 Nov 2026: «هنحطها مانيول»).

-- What each employee is paid a bonus on, and where a rep's booking ladder starts for them («أول تارجيت»: 10, 15 or 20 bookings).
ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS bonus_scheme ENUM('NONE','SALES_BOOKINGS','COLLECTION','COLLECTION_BOOKINGS') NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS booking_first_target DECIMAL(5,1) NULL DEFAULT NULL,
  -- The levels of a collector's bonus: [{ "from": EGP collected, "kind": "percent"|"fixed", "value": n }], the level reached applying to the month's whole.
  ADD COLUMN IF NOT EXISTS collection_levels_json LONGTEXT NULL DEFAULT NULL;

-- A bonus the system worked out is marked source='BONUS_PLAN' (the column exists since 356) and keeps how it was worked out. One per employee and month:
-- lib/monthlyBonuses.js replaces it while it waits for approval (no unique index: rows of the old month sheet may repeat a key).
ALTER TABLE employee_bonuses
  ADD COLUMN IF NOT EXISTS calc_json LONGTEXT NULL DEFAULT NULL;

-- The owner's rules (8 Nov 2026), as each institute's starting plan; the HR screen edits them.
--   a course counts as bookings by its price in EGP: under 4,400 one; from 4,400 one and a half; from 6,800 two; from 8,900 two and a half;
--   over 11,000 three; over 13,000 three and a half; over 15,000 four; over 20,000 five.
--   the ladder: 10 bookings 1,000; 15 1,500; 20 2,500; 25 3,300; 30 4,200; each booking past 20 up to 30 140 more, past 30 200 more.
--   the course page's own sales bonus stays, switched off.
INSERT IGNORE INTO tenant_settings (id, tenant_id, section, config_json, is_secret)
SELECT UUID(), t.id, 'bonus_plan', '{"bookingWeights":[{"min":0,"minIncluded":true,"weight":1},{"min":4400,"minIncluded":true,"weight":1.5},{"min":6800,"minIncluded":true,"weight":2},{"min":8900,"minIncluded":true,"weight":2.5},{"min":11000,"minIncluded":false,"weight":3},{"min":13000,"minIncluded":false,"weight":3.5},{"min":15000,"minIncluded":false,"weight":4},{"min":20000,"minIncluded":false,"weight":5}],"bookingLadder":[{"bookings":10,"amount":1000},{"bookings":15,"amount":1500},{"bookings":20,"amount":2500},{"bookings":25,"amount":3300},{"bookings":30,"amount":4200}],"extraPerBooking":[{"from":20,"to":30,"amount":140},{"from":30,"to":null,"amount":200}],"courseSalesBonusEnabled":false}', 0
  FROM tenants t;
