'use strict';

// Only the connection pool is process-local. All money, credits, claims and
// notification state live in PostgreSQL, shared by every Vercel invocation.
let pool;
let testAdapter;

function database() {
  if (testAdapter) return testAdapter;
  if (!process.env.DATABASE_URL) {
    const error = new Error('Dịch vụ số lượt chưa sẵn sàng.');
    error.code = 'BILLING_DATABASE_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  if (!pool) {
    const {Pool} = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
      statement_timeout: 10000,
      query_timeout: 12000,
      maxLifetimeSeconds: 120,
      allowExitOnIdle: true,
      application_name: 'pandastudy-billing'
    });
    pool.on('error', error => console.error('[PandaStudy billing database]', error.code || 'POOL_ERROR'));
  }
  return pool;
}

async function query(text, values) {
  return database().query(text, values);
}

async function transaction(work) {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5000ms'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) { const current = pool; pool = undefined; await current.end(); }
}

function setTestAdapter(adapter) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test database adapters are disabled outside tests.');
  testAdapter = adapter;
}

module.exports = {query, transaction, close, setTestAdapter};
