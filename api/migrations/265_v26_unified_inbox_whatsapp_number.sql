-- «بالنسبه لرقم واتس اب الانبوكس الموحد هيكون الرقم دا 01006006466» (5 Oct 2026).
--
-- The company's WhatsApp — the one the unified inbox reads and the campaigns
-- send from — is 01006006466 (stored dialable, 201006006466, as
-- lib/messagingChannels.js stores every number). Where the institute already
-- has a company WhatsApp channel without a number, it gets this one; where it
-- has none, one is added, «pending» and with no credentials: sends only ever
-- resolve to a «connected» channel (resolveChannel), so nothing is sent through
-- it until the Meta number id and token are entered in الإعدادات › قنوات
-- الرسائل and verified. A channel that already shows a number is left alone.
--
-- Rollback:
--   DELETE FROM messaging_channels WHERE created_by='migration-265';
--   UPDATE messaging_channels SET display_number=NULL
--    WHERE display_number='201006006466' AND owner_staff_id IS NULL AND kind='whatsapp';

UPDATE messaging_channels
   SET display_number = '201006006466'
 WHERE kind = 'whatsapp' AND owner_staff_id IS NULL AND is_active = 1
   AND (display_number IS NULL OR display_number = '');

INSERT INTO messaging_channels (id, tenant_id, kind, provider, owner_staff_id, label, display_number, status, is_default, created_by)
SELECT UUID(), t.id, 'whatsapp', 'meta', NULL, 'واتساب الشركة — الانبوكس الموحد', '201006006466', 'pending', 1, 'migration-265'
  FROM tenants t
 WHERE NOT EXISTS (
   SELECT 1 FROM messaging_channels c
    WHERE c.tenant_id = t.id AND c.kind = 'whatsapp' AND c.owner_staff_id IS NULL
 );
