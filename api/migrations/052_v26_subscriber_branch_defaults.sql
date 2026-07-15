UPDATE subscribers
SET branch = 'ONLINE_EGYPT'
WHERE branch IS NULL OR branch = '';

UPDATE subscribers
SET branch_id = 'branch-online-egypt'
WHERE branch_id IS NULL OR branch_id = '';

ALTER TABLE subscribers
  MODIFY COLUMN branch ENUM('DAQQI','TAGAMOA','ONLINE_EGYPT','ONLINE_SAUDI','ONLINE_ABROAD','OTHER') DEFAULT 'ONLINE_EGYPT',
  MODIFY COLUMN branch_id VARCHAR(36) DEFAULT 'branch-online-egypt';
