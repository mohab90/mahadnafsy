UPDATE subscribers
SET branch = CASE branch_id
  WHEN 'branch-online-egypt' THEN 'ONLINE_EGYPT'
  WHEN 'branch-online-saudi' THEN 'ONLINE_SAUDI'
  WHEN 'branch-online-abroad' THEN 'ONLINE_ABROAD'
  WHEN 'branch-daqqi' THEN 'DAQQI'
  WHEN 'branch-tagamoa' THEN 'TAGAMOA'
  ELSE 'OTHER'
END
WHERE branch IS NULL OR branch = '';

UPDATE leads
SET branch = CASE branch_id
  WHEN 'branch-online-egypt' THEN 'ONLINE_EGYPT'
  WHEN 'branch-online-saudi' THEN 'ONLINE_SAUDI'
  WHEN 'branch-online-abroad' THEN 'ONLINE_ABROAD'
  WHEN 'branch-daqqi' THEN 'DAQQI'
  WHEN 'branch-tagamoa' THEN 'TAGAMOA'
  ELSE 'OTHER'
END
WHERE branch IS NULL OR branch = '';

UPDATE payments
SET branch = CASE branch_id
  WHEN 'branch-online-egypt' THEN 'ONLINE_EGYPT'
  WHEN 'branch-online-saudi' THEN 'ONLINE_SAUDI'
  WHEN 'branch-online-abroad' THEN 'ONLINE_ABROAD'
  WHEN 'branch-daqqi' THEN 'DAQQI'
  WHEN 'branch-tagamoa' THEN 'TAGAMOA'
  ELSE 'OTHER'
END
WHERE branch IS NULL OR branch = '';
