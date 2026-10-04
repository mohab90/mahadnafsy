-- «خلي صلاحيه حساب هنا متاح تعديل ملف العميل ايضا».
--
-- Editing a client's file is manage_subscribers. The support role carries it
-- by default; a support account whose permissions were saved from the staff
-- screen holds its own list instead, and those without it got «Permission
-- denied: manage_subscribers» on every save. Each support account with a
-- stored list is given it. Nothing is removed.
--
-- Rollback: JSON_REMOVE the entry from the same rows.

UPDATE staff
   SET permissions_json = JSON_ARRAY_APPEND(permissions_json, '$', 'manage_subscribers')
 WHERE LOWER(role) = 'support'
   AND permissions_json IS NOT NULL AND JSON_VALID(permissions_json)
   AND JSON_TYPE(permissions_json) = 'ARRAY'
   AND NOT JSON_CONTAINS(permissions_json, '"manage_subscribers"');
