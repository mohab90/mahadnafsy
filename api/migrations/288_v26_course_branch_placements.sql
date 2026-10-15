-- A client in two branches: a course placed in a branch other than the client's own.
--
-- «لو العميل بيحضر كورس اونلاين وكورس حضور محتاجين نقدر نقسم العميل بين الفروع وفي زر تحويل اونلاين ممكن
-- يبقى في تحويل جزئي لكورس معين مش لكل كورسات العميل او العكس» (15 Oct 2026). The client keeps one file and one
-- own branch (subscribers.branch); a course (or track) can be placed in another branch. Each branch then sees
-- the client in its own list, with only the courses placed there; the money already carries its own branch
-- (payments.branch), so the branches' books follow.
CREATE TABLE IF NOT EXISTS subscriber_course_branches (
  tenant_id     VARCHAR(64)  NOT NULL,
  subscriber_id VARCHAR(36)  NOT NULL,
  item_key      VARCHAR(80)  NOT NULL COMMENT 'a course id, or bundle:<id> for a track',
  branch        VARCHAR(32)  NOT NULL,
  placed_by     VARCHAR(120) NULL,
  placed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, subscriber_id, item_key),
  KEY idx_scb_branch (tenant_id, branch, subscriber_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
