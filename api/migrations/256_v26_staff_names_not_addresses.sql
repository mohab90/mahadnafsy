-- «ليه اصلا اسم هنا مش بيظهر وبيظهر الايميل؟ … اسم الموظف اللى يظهر مش الايميل
-- ابدا» (8 Oct 2026). Columns that hold the name shown on screen — who recorded a
-- payment, who wrote a ticket reply or a staff message, who recorded a transfer —
-- held the signed-in address where the writer had no name to hand: 48 payments,
-- 26 ticket rows, 3 messages, 6 recruitment notes, 19 transfers. The code signs
-- with the name now (lib/staffNames.js signerName); this does the same for the
-- rows already written: an employee's address becomes their name, any other
-- address (the owner's, the institute's) «الإدارة». Who did it stays on each
-- row's id column and in activity_logs.
--
-- Rollback: none needed — the address is still on activity_logs for every write.

UPDATE payments p JOIN staff s ON s.tenant_id = p.tenant_id AND LOWER(s.email) = LOWER(p.staff_name)
   SET p.staff_name = s.name WHERE p.staff_name LIKE '%@%' AND s.name <> '';
UPDATE payments SET staff_name = 'الإدارة' WHERE staff_name LIKE '%@%';

UPDATE ticket_replies r JOIN staff s ON s.tenant_id = r.tenant_id AND LOWER(s.email) = LOWER(r.author_name)
   SET r.author_name = s.name WHERE r.author_name LIKE '%@%' AND s.name <> '';
UPDATE ticket_replies SET author_name = 'الإدارة' WHERE author_name LIKE '%@%';

UPDATE ticket_events e JOIN staff s ON s.tenant_id = e.tenant_id AND LOWER(s.email) = LOWER(e.actor_name)
   SET e.actor_name = s.name WHERE e.actor_name LIKE '%@%' AND s.name <> '';
UPDATE ticket_events SET actor_name = 'الإدارة' WHERE actor_name LIKE '%@%';

UPDATE staff_messages m JOIN staff s ON s.tenant_id = m.tenant_id AND LOWER(s.email) = LOWER(m.author_name)
   SET m.author_name = s.name WHERE m.author_name LIKE '%@%' AND s.name <> '';
UPDATE staff_messages SET author_name = 'الإدارة' WHERE author_name LIKE '%@%';

UPDATE recruitment_notes n JOIN staff s ON s.tenant_id = n.tenant_id AND LOWER(s.email) = LOWER(n.author_name)
   SET n.author_name = s.name WHERE n.author_name LIKE '%@%' AND s.name <> '';
UPDATE recruitment_notes SET author_name = 'الإدارة' WHERE author_name LIKE '%@%';

UPDATE incoming_transfers t JOIN staff s ON s.tenant_id = t.tenant_id AND LOWER(s.email) = LOWER(t.recorded_by_name)
   SET t.recorded_by_name = s.name WHERE t.recorded_by_name LIKE '%@%' AND s.name <> '';
UPDATE incoming_transfers SET recorded_by_name = 'الإدارة' WHERE recorded_by_name LIKE '%@%';
