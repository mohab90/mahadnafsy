ALTER TABLE leads
ADD COLUMN interest_score INT DEFAULT 0,
ADD COLUMN lead_category VARCHAR(20) DEFAULT 'cold';
