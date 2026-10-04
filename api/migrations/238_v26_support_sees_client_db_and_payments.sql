-- «حساب مسئول خدمة العملاء الأونلاين: خلي يظهرله قاعدة البيانات كاملة … واظهرلها
-- صفحة المدفوعات».
--
-- The support role now carries view_client_db by default (constants/
-- permissions.js), and already carried view_orders. An account whose
-- permissions were saved from the staff screen holds its own list instead of
-- the role's, so it gains neither from a default: each support account with a
-- stored list is given the two it lacks. Nothing is removed; an account with
-- no stored list (NULL) follows the role and needs nothing here.
--
-- Rollback: JSON_REMOVE the two entries from the same rows.

UPDATE staff
   SET permissions_json = JSON_ARRAY_APPEND(permissions_json, '$', 'view_client_db')
 WHERE LOWER(role) = 'support'
   AND permissions_json IS NOT NULL AND JSON_VALID(permissions_json)
   AND JSON_TYPE(permissions_json) = 'ARRAY'
   AND NOT JSON_CONTAINS(permissions_json, '"view_client_db"');

UPDATE staff
   SET permissions_json = JSON_ARRAY_APPEND(permissions_json, '$', 'view_orders')
 WHERE LOWER(role) = 'support'
   AND permissions_json IS NOT NULL AND JSON_VALID(permissions_json)
   AND JSON_TYPE(permissions_json) = 'ARRAY'
   AND NOT JSON_CONTAINS(permissions_json, '"view_orders"');
