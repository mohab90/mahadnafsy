-- Old-system institute certificates become course completions (25 Oct 2026).
--
-- «العملاء القدام بتظهر عليهم شهادة المعهد صدرت … بس لما نفتحها بتفشل ومش موجودة في سجل الشهادات»: a certificate the
-- old system issued was imported as a certificate_request (type INSTITUTE, issued) with its code, but the things that
-- OPEN a certificate — the printable design (/api/completions/:code/certificate), the verification page's design
-- and the institute-certificates history — read course_completions, where it had no row. Each issued institute
-- request that names a course now has one, under the SAME code (so the QR already printed on the paper resolves),
-- dated by when it was issued. A client who already holds a completion for that course keeps theirs (uq_course_comp),
-- and a code that a completion already carries is left alone.
INSERT IGNORE INTO course_completions
  (id, subscriber_id, course_id, certificate_code, completed_at, delivery_status, cert_name_en, status, version, tenant_id)
SELECT UUID(), cr.subscriber_id, cr.course_id, cr.certificate_code,
       COALESCE(cr.issued_at, cr.requested_at, NOW()),
       CASE cr.status WHEN 'SHIPPED' THEN 'SHIPPED' WHEN 'AT_BRANCH' THEN 'AT_BRANCH' WHEN 'DELIVERED' THEN 'DELIVERED' ELSE 'READY' END,
       NULLIF(TRIM(cr.name_en), ''), 'active', 1, cr.tenant_id
  FROM certificate_requests cr
 WHERE cr.type = 'INSTITUTE'
   AND cr.status IN ('ISSUED', 'SHIPPED', 'AT_BRANCH', 'DELIVERED')
   AND cr.subscriber_id IS NOT NULL AND cr.course_id IS NOT NULL
   AND cr.certificate_code IS NOT NULL AND cr.certificate_code <> ''
   AND NOT EXISTS (SELECT 1 FROM course_completions cc
                    WHERE cc.subscriber_id = cr.subscriber_id AND cc.course_id = cr.course_id)
   AND NOT EXISTS (SELECT 1 FROM course_completions c2 WHERE c2.certificate_code = cr.certificate_code);
