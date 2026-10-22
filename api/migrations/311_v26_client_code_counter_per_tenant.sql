-- A client-code counter per institute (21 Oct 2026).
--
-- Every institute drew its «C10385» codes from the one row id=1, so one institute's codes jumped by every client another
-- one added, and the numbers told each how busy the others were. A row per tenant now holds each institute's counter
-- (lib/mappers.js getNextClientCode). Nothing is renumbered: a tenant's row is created on its first new code, starting
-- from the shared row's value — above every code already given — or at 10001 for an institute with no clients yet.
-- Row id=1 (tenant_id NULL) stays as that starting point.
ALTER TABLE client_code_counter MODIFY COLUMN id int(11) NOT NULL AUTO_INCREMENT;
ALTER TABLE client_code_counter ADD COLUMN IF NOT EXISTS tenant_id varchar(64) NULL AFTER id;
ALTER TABLE client_code_counter ADD UNIQUE INDEX IF NOT EXISTS uq_client_code_counter_tenant (tenant_id);
