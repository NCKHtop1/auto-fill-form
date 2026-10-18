'use strict';

// Run explicitly after selecting the intended database. Never invoked by an API.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../lib/billing-db');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; no migration was applied.');
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/001_billing.sql'), 'utf8');
  await db.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(730612901)');
    await client.query(sql);
  });
  console.log('PandaStudy billing migration 001 applied.');
}

main().catch(error => {
  // Do not print connection strings or query values on migration failure.
  console.error('PandaStudy billing migration failed:', error.code || 'MIGRATION_ERROR');
  process.exitCode = 1;
}).finally(() => db.close());
