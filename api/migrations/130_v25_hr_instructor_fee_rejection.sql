ALTER TABLE instructor_fees
  MODIFY COLUMN status ENUM('pending','approved','rejected','included_in_payroll','paid') NOT NULL DEFAULT 'pending';
