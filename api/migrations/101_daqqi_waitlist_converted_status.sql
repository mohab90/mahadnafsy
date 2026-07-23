-- SUB-03: converting a waitlist entry to a CRM lead (WaitlistTab.tsx's "تحويل إلى
-- Lead" action) marked the waitlist entry status='enrolled', which is false — no
-- actual course enrollment happens there, only a new lead record is created. Adds
-- a distinct 'converted' status so the waitlist reflects what really happened.
ALTER TABLE daqqi_waitlist MODIFY COLUMN status ENUM('waiting','contacted','enrolled','converted','cancelled') DEFAULT 'waiting';
