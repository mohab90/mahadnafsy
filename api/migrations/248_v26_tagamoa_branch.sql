-- «خلي في قسم لفرع التجمع زي بتاع الدقي بالظبط في كل التفاصيل لكن خليه مخفي
-- واقدر اظهره من الاعدادات».
--
-- The Dokki section is made to work for any physical branch rather than copied:
--
-- daqqi_rounds.branch     which branch a round runs at (DAQQI or TAGAMOA). Every
--                         existing round is Dokki's. The tables keep their
--                         names; attendees, attendance and housing follow their
--                         round.
-- staff.role              TAGAMOA_MANAGER and RECEPTION_TAGAMOA: the Tagamoa
--                         counterparts of DAQQI_MANAGER and RECEPTION_DAQQI,
--                         confined to their own branch (lib/physicalBranches.js).
-- branches (TAGAMOA)      hidden until it is turned on in الإعدادات ← الفروع:
--                         switched off here unless something already uses it.
--
-- Rollback:
--   ALTER TABLE daqqi_rounds DROP INDEX idx_daqqi_rounds_branch, DROP COLUMN branch;
--   (the role values stay: removing an enum member relabels rows that hold it)

ALTER TABLE daqqi_rounds
  ADD COLUMN IF NOT EXISTS branch VARCHAR(16) NOT NULL DEFAULT 'DAQQI',
  ADD INDEX IF NOT EXISTS idx_daqqi_rounds_branch (tenant_id, branch, status);

ALTER TABLE staff
  MODIFY COLUMN role ENUM('INSTRUCTOR','TRAINER','EXPERT','SALES','MANAGER','ADMIN','SUPPORT','RECEPTION_DAQQI',
    'COLLECTION','ACCOUNTANT','CONSULTANT','OTHER','ONLINE_MANAGER','DAQQI_MANAGER','SALES_COLLECTION_MANAGER','HR',
    'TAGAMOA_MANAGER','RECEPTION_TAGAMOA') NOT NULL;

UPDATE branches b
   SET b.is_active = 0
 WHERE b.branch_key = 'TAGAMOA'
   AND NOT EXISTS (SELECT 1 FROM subscribers s WHERE s.tenant_id = b.tenant_id AND s.branch = 'TAGAMOA' AND s.deleted_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.tenant_id = b.tenant_id AND p.branch = 'TAGAMOA' AND p.deleted_at IS NULL);
