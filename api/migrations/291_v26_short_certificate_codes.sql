-- Certificate codes are short now: MAHAD and six letters or digits («كود الشهادة يكون صغير … MAHAD + 6 رموز»,
-- 16 Oct 2026). The application allocates the code (api/lib/certificateCodes.js, which retries on a collision);
-- this only changes the fallback for a row written without one. Certificates issued before keep their codes.
ALTER TABLE certificate_requests MODIFY certificate_code VARCHAR(40) NOT NULL DEFAULT (CONCAT('MAHAD', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 6))));
