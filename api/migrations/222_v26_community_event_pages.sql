-- Community events with a page of their own and a place to register interest.
--
-- «تبقي كل فاعليه بلينك خاص بيها ولما اضيف فاعليه اضيف ليها صورة ومحتوي قوي
-- واختيار محاضر او اكتر واختيار هتكون اونلاين ولا حضور وكمان يبقي في مساحه
-- للناس المهتمه تسجل في الفعاليه ... زر اهتمام وتسجيل اسم ورقم فقط».
--
--   slug         the event's own address, /community/events/<slug>
--   content      the full text of the event page (description stays the short
--                line the lists show)
--   speaker_ids  the lecturers, as a JSON list of therapists.id — the site's
--                instructors, so the page shows their names and photos
--   event_time   HH:MM, Cairo time
-- Online or in person is the existing is_online, with platform for the one and
-- location_name for the other.
--
-- There were no events when this was written (the add button answered 404), so
-- nothing needs a slug backfilled.

-- image_url holds the picture itself, compressed in the browser like the
-- instructors' (admin/lib/imageBudget.ts, up to 320 KB); text stops at 64 KB.
ALTER TABLE community_events
  MODIFY COLUMN image_url mediumtext DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS slug varchar(160) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS content mediumtext DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS speaker_ids text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS event_time varchar(5) DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_community_events_slug ON community_events (tenant_id, slug);

-- One row per person per event: the same number registering twice is one
-- registration (phone_identity is lib/phoneNumber.js toIdentity).
CREATE TABLE IF NOT EXISTS community_event_registrations (
  id varchar(36) NOT NULL DEFAULT (uuid()),
  tenant_id varchar(64) NOT NULL,
  event_id varchar(100) NOT NULL,
  name varchar(200) NOT NULL,
  phone varchar(40) NOT NULL,
  phone_identity varchar(40) NOT NULL,
  created_at datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (id),
  UNIQUE KEY uq_event_registration (tenant_id, event_id, phone_identity),
  KEY idx_event_registrations_event (tenant_id, event_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
