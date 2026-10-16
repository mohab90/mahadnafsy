-- What kind of escalation a ticket is: «مهم جدا» or «متكرر».
--
-- «لما عملت تصعيد للادارة ايه اللي حصل؟ وصل بيها اشعار فقط … محتاجين يكون عند الادارة 2 اشعار
-- واحد للحاجات المهمة جدا وواحد للحاجات المكررة ويبقى في فرق بينهم» (14 Oct 2026).
-- The kind is kept on the ticket so the inbox can mark it the way the notification does.
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS escalation_kind VARCHAR(20) NULL AFTER escalated_at;
