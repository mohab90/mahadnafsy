-- One video-meeting account for the whole institute (26 Oct 2026).
--
-- «محتاجين السيستم يربط API بزوم أو جوجل ميت … ميبقاش كل محاضر يختار هو»: the system makes the meeting of every live and every
-- consultation through the provider the owner set up (lib/meetingProvider.js). The join link is what the client gets; the host link
-- is the lecturer's «ابدأ». meeting_id lets the system move or remove the meeting when the live or the session is changed.
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS host_url TEXT NULL;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS meeting_id VARCHAR(191) NULL;
ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS meeting_provider VARCHAR(20) NULL;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS host_link TEXT NULL;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS meeting_id VARCHAR(191) NULL;
ALTER TABLE consultations ADD COLUMN IF NOT EXISTS meeting_provider VARCHAR(20) NULL;
