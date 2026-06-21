-- Add EMPLOYEE to join-us applicant types 2026-06-20.
-- join_us now covers teaching staff (INSTRUCTOR/CONSULTANT) AND regular employee
-- (administrative) applications, distinguished by `type` + filtered in the admin tab.
ALTER TABLE join_us_applications
  MODIFY COLUMN type ENUM('INSTRUCTOR','CONSULTANT','EMPLOYEE') NOT NULL;
