ALTER TABLE lecture_completions
  ADD COLUMN IF NOT EXISTS note_text TEXT NULL AFTER watch_seconds;
