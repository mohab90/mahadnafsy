-- Every certificate the system issues has a code.
--
-- «يكتب كود الشهادة تفتح توثيقها للعميل … ويكون التوثيق دا بيشمل اي شهادة بتطلع من السيستم وكله ليه
-- كود» (15 Oct 2026). The institute's own certificates already carry course_completions.certificate_code;
-- the ones the institute arranges with others (Ain Shams, social solidarity, the National Council, the
-- American Board …) are certificate_requests and had none. Each gets one — PSY-C- and ten letters or
-- digits — now, and automatically on every new request, so the public check finds all of them.
ALTER TABLE certificate_requests ADD COLUMN IF NOT EXISTS certificate_code VARCHAR(40) NULL AFTER id;
UPDATE certificate_requests SET certificate_code = CONCAT('PSY-C-', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 10))) WHERE certificate_code IS NULL;
ALTER TABLE certificate_requests MODIFY certificate_code VARCHAR(40) NOT NULL DEFAULT (CONCAT('PSY-C-', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 10))));
CREATE UNIQUE INDEX IF NOT EXISTS uq_certificate_requests_code ON certificate_requests (certificate_code);
