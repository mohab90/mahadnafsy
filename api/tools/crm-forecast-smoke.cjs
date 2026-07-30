#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { pool } = require('../lib/db');
const { loadCrmForecast } = require('../lib/crmForecast');

(async () => {
  try {
    const [tenants] = await pool.query('SELECT id FROM tenants ORDER BY id LIMIT 2');
    if (tenants.length < 2) throw new Error('Tenant A/B test data is required');
    for (const tenant of tenants) {
      const forecast = await loadCrmForecast({ tenantId: tenant.id, months: 3 });
      const [[count]] = await pool.query(
        `SELECT COUNT(*) AS count FROM leads
          WHERE tenant_id=? AND hidden=0 AND deleted_at IS NULL
            AND status NOT IN ('lost','junk','converted','won')`,
        [tenant.id]
      );
      if (forecast.dataQuality.totalOpen !== Number(count.count)) {
        throw new Error(`CRM forecast scope mismatch for tenant ${tenant.id}`);
      }
      if (forecast.currency !== 'EGP' || forecast.periods.length !== 3) {
        throw new Error(`CRM forecast contract mismatch for tenant ${tenant.id}`);
      }
      const ids = forecast.opportunities.map(item => item.id);
      if (ids.length) {
        const [[owned]] = await pool.query(
          `SELECT COUNT(*) AS count FROM leads
            WHERE tenant_id=? AND id IN (${ids.map(() => '?').join(',')})`,
          [tenant.id, ...ids]
        );
        if (Number(owned.count) !== ids.length) {
          throw new Error(`Cross-tenant opportunity detected for tenant ${tenant.id}`);
        }
      }
      console.log(JSON.stringify({
        ok: true,
        tenantId: tenant.id,
        openOpportunities: forecast.dataQuality.totalOpen,
        returnedOpportunities: forecast.opportunities.length,
        periods: forecast.periods.length,
        ownerRollups: forecast.ownerRollups.length,
        currency: forecast.currency,
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
