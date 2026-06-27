-- 025_staff_preferences.sql
-- Per-staff personal preferences (WhatsApp number, message templates, custom tags).
--
-- These were stored in localStorage in StaffSettingsTab (sales.waNumber,
-- sales.waTemplates, sales.customTags) — per-browser, lost on device change.
-- GET/PUT /api/staff/me/preferences now persist them server-side per staff.
--
-- Idempotent: core.js also adds this at startup (ADD COLUMN IF NOT EXISTS).

ALTER TABLE staff ADD COLUMN IF NOT EXISTS preferences_json TEXT DEFAULT NULL;
