-- Expense categories are the settings' list, and every expense names who entered it.
--
-- «بنود المصروفات في الاعدادات مش مسمعه» (5 Oct 2026): الإعدادات › فئات المصاريف
-- saved a list nobody read. The expenses screen offered six fixed names, and
-- expenses.category was an ENUM of nine codes, so a category added in settings
-- («مستلزمات», «فواتير الكهرباء») could not be stored and became «أخرى».
-- The column is text now, holding the settings key in capitals (RENT, SUPPLIES, …);
-- the existing codes are already that.
--
-- «خلي في المصروف يظهر الفرع والقائم بالعملية»: staff_id was never written, and
-- the owner has no staff row, so the name is kept as it was at the time.
--
-- Rollback:
--   ALTER TABLE expenses DROP COLUMN created_by_name;
--   ALTER TABLE expenses MODIFY COLUMN category ENUM('SALARIES','RENT','UTILITIES','SOFTWARE','MARKETING','EQUIPMENT','MAINTENANCE','TRAVEL','OTHER') NOT NULL DEFAULT 'OTHER';
--     (only once every row holds one of those nine)

ALTER TABLE expenses MODIFY COLUMN category VARCHAR(40) NOT NULL DEFAULT 'OTHER';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(150) NULL;
