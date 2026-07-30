-- Keep website applications, recruiting and onboarding tenant-native and linked.
INSERT IGNORE INTO branches
  (id, tenant_id, branch_key, slug, label, branch_type, timezone, currency, is_active)
SELECT 'branch-other', id, 'other', 'other', 'فرع عام', 'other', 'Africa/Cairo', 'EGP', 1
  FROM tenants
 WHERE id='tenant-default';

ALTER TABLE job_postings
  MODIFY tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD UNIQUE KEY IF NOT EXISTS uq_job_postings_tenant_id (tenant_id, id);

ALTER TABLE job_applicants
  MODIFY tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD UNIQUE KEY IF NOT EXISTS uq_job_applicants_tenant_id (tenant_id, id),
  ADD CONSTRAINT IF NOT EXISTS fk_job_applicants_job_tenant
    FOREIGN KEY (tenant_id, job_id) REFERENCES job_postings (tenant_id, id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE join_us_applications
  MODIFY tenant_id VARCHAR(64) NOT NULL DEFAULT 'tenant-default',
  ADD CONSTRAINT IF NOT EXISTS fk_join_us_applicant_tenant
    FOREIGN KEY (tenant_id, converted_applicant_id) REFERENCES job_applicants (tenant_id, id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE onboarding_templates
  ADD UNIQUE KEY IF NOT EXISTS uq_onboarding_templates_tenant_id (tenant_id, id);

ALTER TABLE onboarding_tasks
  ADD CONSTRAINT IF NOT EXISTS fk_onboarding_tasks_template_tenant
    FOREIGN KEY (tenant_id, template_id) REFERENCES onboarding_templates (tenant_id, id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE staff
  ADD UNIQUE KEY IF NOT EXISTS uq_staff_tenant_id (tenant_id, id);

ALTER TABLE employee_onboarding
  ADD UNIQUE KEY IF NOT EXISTS uq_employee_onboarding_tenant_id (tenant_id, id),
  ADD CONSTRAINT IF NOT EXISTS fk_employee_onboarding_staff_tenant
    FOREIGN KEY (tenant_id, staff_id) REFERENCES staff (tenant_id, id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  ADD CONSTRAINT IF NOT EXISTS fk_employee_onboarding_template_tenant
    FOREIGN KEY (tenant_id, template_id) REFERENCES onboarding_templates (tenant_id, id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE employee_onboarding_items
  ADD CONSTRAINT IF NOT EXISTS fk_onboarding_items_parent_tenant
    FOREIGN KEY (tenant_id, onboarding_id) REFERENCES employee_onboarding (tenant_id, id)
    ON UPDATE CASCADE ON DELETE CASCADE;
