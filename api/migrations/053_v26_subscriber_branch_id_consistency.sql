UPDATE subscribers
SET branch_id = CASE branch
  WHEN 'ONLINE_EGYPT' THEN 'branch-online-egypt'
  WHEN 'ONLINE_SAUDI' THEN 'branch-online-saudi'
  WHEN 'ONLINE_ABROAD' THEN 'branch-online-abroad'
  WHEN 'DAQQI' THEN 'branch-daqqi'
  WHEN 'TAGAMOA' THEN 'branch-tagamoa'
  ELSE 'branch-other'
END
WHERE branch_id IS NULL
   OR branch_id = ''
   OR (branch = 'ONLINE_EGYPT' AND branch_id <> 'branch-online-egypt')
   OR (branch = 'ONLINE_SAUDI' AND branch_id <> 'branch-online-saudi')
   OR (branch = 'ONLINE_ABROAD' AND branch_id <> 'branch-online-abroad')
   OR (branch = 'DAQQI' AND branch_id <> 'branch-daqqi')
   OR (branch = 'TAGAMOA' AND branch_id <> 'branch-tagamoa')
   OR (branch = 'OTHER' AND branch_id <> 'branch-other');
