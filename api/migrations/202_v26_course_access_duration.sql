-- How long a customer keeps a course, and when their copy of it runs out.
--
-- enrollments.expiry_date already existed and nothing ever read or wrote it, so
-- every enrolment was effectively permanent with a column that looked like it
-- said otherwise. This gives the course a default length in months, stamps each
-- enrolment with its own end date, and leaves that date editable per customer —
-- extending one person costs a date change, not a policy change.
--
-- NULL access_months means unlimited, which is what every existing course is
-- today: the backfill below deliberately touches nothing, so no customer loses
-- access to something they already have.
ALTER TABLE courses
  ADD COLUMN access_months INT NULL DEFAULT NULL
  COMMENT 'How many months of access a new enrolment gets. NULL = unlimited.';

-- Existing enrolments keep expiry_date NULL, i.e. unlimited. Only enrolments
-- created after a course is given a duration get an end date.
ALTER TABLE enrollments
  MODIFY COLUMN expiry_date DATETIME NULL DEFAULT NULL
  COMMENT 'When this customer loses access. NULL = never.';

CREATE INDEX idx_enrollments_expiry ON enrollments (tenant_id, expiry_date);
