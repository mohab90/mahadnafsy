-- The Instapay / bank-transfer screenshot a client uploads goes to Google Drive and the system keeps its LINK (25 Oct 2026).
--
-- «العميل لما بيقول دفعت انستاباي وبيرفع صورة التحويل، المحاسب مش شايف الصورة»: the picture sat as a base64 string
-- in payment_proofs and was only reachable through a lazy per-row fetch, and the payment it became carried nothing.
-- The link now rides on the proof and is copied onto the payment when the proof is approved, so the payments table
-- and every screen that confirms or links a transfer can open it.
ALTER TABLE payment_proofs ADD COLUMN IF NOT EXISTS proof_url VARCHAR(500) NULL AFTER proof_image;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS proof_url VARCHAR(500) NULL AFTER sender_name;
