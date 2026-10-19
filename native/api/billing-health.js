'use strict';

const billing = require('../lib/billing');
const db = require('../lib/billing-db');

module.exports = async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET');
    return res.status(405).json({ok:false});
  }

  const config = billing.getConfigStatus();
  let schemaReady = false;
  let databaseReachable = false;
  if (process.env.DATABASE_URL) {
    try {
      const result = await db.query('SELECT version FROM ps_billing_schema_migrations WHERE version=1');
      databaseReachable = true;
      schemaReady = result.rowCount > 0;
    } catch (error) {
      console.error('[PandaStudy billing health]', error.code || 'UNAVAILABLE');
    }
  }

  return res.status(200).json({
    ok: true,
    billingEnabled: config.billingEnabled,
    financialConfigReady: config.missing.length === 0,
    missing: config.missing,
    warnings: config.warnings || [],
    databaseReachable,
    schemaReady,
    schemaVersion: schemaReady ? 1 : null
  });
};
