ALTER TABLE course_quizzes
  ADD COLUMN IF NOT EXISTS required_for_completion TINYINT(1) NOT NULL DEFAULT 1
    AFTER passing_score;

ALTER TABLE quiz_attempts
  ADD INDEX IF NOT EXISTS idx_quiz_attempts_daily_limit
    (tenant_id, subscriber_id, quiz_id, taken_at);
