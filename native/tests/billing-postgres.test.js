'use strict';

// Opt-in integration gate against a REAL, disposable PostgreSQL database.
// BILLING_TEST_DATABASE_URL must designate a database approved for UAT.
// Each run owns a fresh random schema; cleanup drops only that schema.
// These tests never call Google Forms or an email provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);

const testUrl = process.env.BILLING_TEST_DATABASE_URL;
const schema = 'ps_billing_uat_' + crypto.randomBytes(10).toString('hex');
const migration = path.join(__dirname, '../scripts/migrate-billing.js');
const newKey = () => crypto.randomUUID();
const identity = prefix => ({
  sub: prefix + ':' + newKey(),
  email: prefix + '+' + newKey() + '@pandastudy-uat.invalid',
  email_verified: true
});

test('Real PostgreSQL billing: concurrency, ownership and atomic recovery', {
  skip: !testUrl && 'Set BILLING_TEST_DATABASE_URL to run the real PostgreSQL gate.',
  timeout: 120000
}, async t => {
  const {Pool} = require('pg');
  const db = require('../lib/billing-db');
  const billing = require('../lib/billing');
  const beforeEnv = {...process.env};
  const scopedUrl = new URL(testUrl);
  scopedUrl.searchParams.set('options', '-c search_path=' + schema);
  const adminA = {...identity('admin-a'), email: 'admin@example.test'};
  const adminB = {...identity('admin-b'), email: 'admin2@example.test'};
  Object.assign(process.env, {
    NODE_ENV: 'test', BILLING_ENABLED: 'true', DATABASE_URL: scopedUrl.toString(),
    BILLING_ADMIN_EMAILS: adminA.email + ',' + adminB.email,
    BILLING_BANK_ID: '999999',
    BILLING_BANK_NAME: 'UAT Demo Bank',
    BILLING_BANK_ACCOUNT_NUMBER: '00000000000000',
    BILLING_BANK_ACCOUNT_NAME: 'Merchant Demo',
    BILLING_QR_IMAGE_URL: '/assets/uat-payment-qr.svg',
    PUBLIC_SITE_URL: 'https://pandastudy-uat.invalid',
    BILLING_NOTIFICATION_EMAILS: 'admin@example.test,admin2@example.test',
    RESEND_API_KEY: 'uat-unused-no-email-delivery',
    BILLING_EMAIL_FROM: 'Merchant Demo <notifications@example.test>',
    BILLING_CRON_SECRET: 'uat-unused-not-production-0123456789abcdef'
  });
  const owner = new Pool({connectionString: testUrl, max: 2});
  const pool = new Pool({connectionString: scopedUrl.toString(), max: 24,
    connectionTimeoutMillis: 8000, statement_timeout: 12000});
  let createdSchema = false;

  async function runMigration() {
    const {stdout} = await execFileAsync(process.execPath, [migration], {
      env: {...process.env, DATABASE_URL: scopedUrl.toString()}, timeout: 30000,
      maxBuffer: 256000
    });
    assert.match(stdout, /migrations 001-002 applied/);
  }
  async function pendingOrder(customer, quantity = 3, extras = {}) {
    const order = await billing.createOrder(customer, {quantity, idempotencyKey: newKey(), ...extras});
    await billing.submitPaid(customer, {orderId: order.id});
    return order;
  }
  function approval(order, extra = {}) {
    return {orderId: order.id, bankReference: 'UAT-' + newKey(),
      receivedAmountVnd: order.amountVnd, confirmedBankTransfer: true,
      idempotencyKey: newKey(), ...extra};
  }
  async function fund(customer, quantity) {
    const order = await pendingOrder(customer, quantity);
    await billing.approveOrder(adminA, approval(order));
    return order;
  }
  function submission(extra = {}) {
    return {operationId: newKey(), formId: 'uat-form-only', answers: {q1: 'UAT'}, ...extra};
  }
  async function account(customer) {
    const result = await pool.query(`SELECT c.id,c.available_credits,c.reserved_credits,
      COALESCE((SELECT sum(available_delta) FROM ps_billing_ledger WHERE customer_id=c.id),0) AS ledger_available,
      COALESCE((SELECT sum(reserved_delta) FROM ps_billing_ledger WHERE customer_id=c.id),0) AS ledger_reserved,
      (SELECT count(*) FROM ps_billing_operations WHERE customer_id=c.id AND status IN ('dispatching','unknown')) AS holds
      FROM ps_billing_customers c WHERE c.google_sub=$1`, [customer.sub]);
    assert.equal(result.rowCount, 1);
    const row = result.rows[0];
    for (const key of ['available_credits','reserved_credits','ledger_available','ledger_reserved','holds']) row[key] = Number(row[key]);
    assert.equal(row.available_credits, row.ledger_available, 'Spendable balance must equal the committed ledger.');
    assert.equal(row.reserved_credits, row.ledger_reserved, 'Held balance must equal the committed ledger.');
    assert.equal(row.reserved_credits, row.holds, 'Every held credit must have a durable unresolved operation.');
    assert.ok(row.available_credits >= 0 && row.reserved_credits >= 0);
    return row;
  }
  async function count(table, where, args) {
    assert.ok(['ps_billing_orders','ps_billing_bank_payments','ps_billing_operations',
      'ps_billing_ledger','ps_billing_admin_actions','ps_billing_outbox'].includes(table));
    const result = await pool.query(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, args);
    return Number(result.rows[0].n);
  }

  try {
    await owner.query(`CREATE SCHEMA "${schema}"`);
    createdSchema = true;
    // Two genuine migration processes contend on the advisory lock.
    await Promise.all([runMigration(), runMigration()]);
    await pool.query("UPDATE ps_billing_promotions SET enabled=false");
    db.setTestAdapter(pool);
    await pool.query(`CREATE TABLE uat_reject_ledger (customer_id uuid NOT NULL, kind text NOT NULL,
      PRIMARY KEY(customer_id,kind));
      CREATE FUNCTION uat_fail_selected_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM uat_reject_ledger f WHERE f.customer_id=NEW.customer_id AND f.kind=NEW.kind) THEN
          RAISE EXCEPTION 'Intentional UAT ledger failure' USING ERRCODE='P0001';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER uat_fail_ledger BEFORE INSERT ON ps_billing_ledger
      FOR EACH ROW EXECUTE FUNCTION uat_fail_selected_ledger();`);

    await t.test('Migration can be repeated without resetting orders or balances', async () => {
      const customer = identity('migration');
      const order = await fund(customer, 4);
      await runMigration();
      const versions = await pool.query('SELECT version,count(*) AS n FROM ps_billing_schema_migrations GROUP BY version ORDER BY version');
      assert.deepEqual(versions.rows, [{version: 1, n: '1'},{version: 2, n: '1'}]);
      assert.equal((await billing.getOrder(customer, order.id)).status, 'approved');
      assert.equal((await account(customer)).available_credits, 4);
    });

    await t.test('Two admins approving the same receipt and order grant credits once', async () => {
      const customer = identity('same-order');
      const order = await pendingOrder(customer, 11);
      const first = approval(order);
      const results = await Promise.all([
        billing.approveOrder(adminA, first),
        billing.approveOrder(adminB, {...first, idempotencyKey: newKey()})
      ]);
      assert.ok(results.every(row => row.status === 'approved'));
      assert.equal((await account(customer)).available_credits, 11);
      assert.equal(await count('ps_billing_bank_payments', 'order_id=$1', [order.id]), 1);
      assert.equal(await count('ps_billing_ledger', "source_id=$1 AND kind='topup'", [order.id]), 1);
    });

    await t.test('The same bank receipt cannot fund two different customers concurrently', async () => {
      const left = identity('receipt-left'), right = identity('receipt-right');
      const [a,b] = await Promise.all([pendingOrder(left, 6), pendingOrder(right, 6)]);
      const reference = 'UAT-' + newKey();
      const results = await Promise.allSettled([
        billing.approveOrder(adminA, approval(a, {bankReference: reference})),
        billing.approveOrder(adminB, approval(b, {bankReference: reference.toLowerCase().replace(/-/g, '- ')}))
      ]);
      assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
      const failed = results.find(x => x.status === 'rejected');
      assert.equal(failed.reason.code, 'BANK_REFERENCE_ALREADY_USED');
      assert.equal((await account(left)).available_credits + (await account(right)).available_credits, 6);
      const pending = [await billing.getOrder(left,a.id), await billing.getOrder(right,b.id)];
      assert.deepEqual(pending.map(x => x.status).sort(), ['approved','pending_review']);
    });

    await t.test('Verified subject owns each order; input cannot select another customer or administrator', async () => {
      const customer = identity('owner'), other = identity('other');
      const otherRow = await billing.ensureCustomer(other);
      const order = await pendingOrder(customer, 2, {customerId: otherRow.id, sub: other.sub, email: adminA.email});
      const row = await pool.query('SELECT customer_id FROM ps_billing_orders WHERE id=$1', [order.id]);
      assert.equal(row.rows[0].customer_id, (await billing.ensureCustomer(customer)).id);
      await assert.rejects(billing.getOrder(other, order.id), error => error.code === 'ORDER_NOT_FOUND');
      await assert.rejects(billing.submitPaid(other, {orderId: order.id}), error => error.code === 'ORDER_NOT_FOUND');
      await assert.rejects(billing.approveOrder(customer, approval(order, {email:adminA.email})), error => error.code === 'BILLING_ADMIN_REQUIRED');
      await assert.rejects(billing.createOrder({...customer,email_verified:false}, {quantity:1,idempotencyKey:newKey()}),
        error => error.code === 'BILLING_IDENTITY_REQUIRED');
      assert.equal((await account(customer)).available_credits, 0);
      assert.equal((await account(other)).available_credits, 0);
    });

    await t.test('Repeated paid notification creates one pending event per recipient', async () => {
      const customer = identity('outbox');
      const order = await billing.createOrder(customer, {quantity:2,idempotencyKey:newKey()});
      await Promise.all(Array.from({length:12}, () => billing.submitPaid(customer,{orderId:order.id})));
      const events = await pool.query('SELECT recipient,status FROM ps_billing_outbox WHERE order_id=$1 ORDER BY recipient', [order.id]);
      assert.deepEqual(events.rows.map(x => x.recipient), [...billing.NOTIFICATION_RECIPIENTS].sort());
      assert.ok(events.rows.every(x => x.status === 'pending'));
      assert.equal((await account(customer)).available_credits, 0);
    });

    await t.test('Twenty competing reservations cannot overdraw seven credits', async () => {
      const customer = identity('overdraw');
      await fund(customer, 7);
      const results = await Promise.allSettled(Array.from({length:20}, (_,i) =>
        billing.reserveSubmission(customer, submission({answers:{q1:'Row '+i}}))));
      const accepted = results.filter(x => x.status === 'fulfilled');
      const rejected = results.filter(x => x.status === 'rejected');
      assert.equal(accepted.length, 7);
      assert.ok(accepted.every(x => x.value.dispatch === true));
      assert.equal(rejected.length, 13);
      assert.ok(rejected.every(x => x.reason.code === 'INSUFFICIENT_CREDITS'));
      const balance = await account(customer);
      assert.equal(balance.available_credits, 0);
      assert.equal(balance.reserved_credits, 7);
      assert.equal(await count('ps_billing_operations', 'customer_id=$1', [balance.id]), 7);
    });

    await t.test('Concurrent replay produces a single dispatch claim and binds the payload', async () => {
      const customer = identity('same-operation');
      await fund(customer, 3);
      const input = submission();
      const claims = await Promise.all(Array.from({length:20}, () => billing.reserveSubmission(customer,input)));
      assert.equal(claims.filter(x => x.dispatch).length, 1);
      assert.equal(claims.filter(x => !x.dispatch).length, 19);
      await assert.rejects(billing.reserveSubmission(customer, {...input,answers:{q1:'Changed'}}),
        error => error.code === 'OPERATION_PAYLOAD_CONFLICT');
      await assert.rejects(billing.reserveSubmission(customer, {...input,formId:'different-form'}),
        error => error.code === 'OPERATION_PAYLOAD_CONFLICT');
      const balance = await account(customer);
      assert.equal(balance.available_credits, 2);
      assert.equal(balance.reserved_credits, 1);
    });

    await t.test('An unknown result stays reserved and a retry never receives another dispatch claim', async () => {
      const customer = identity('unknown');
      await fund(customer, 2);
      const input = submission(), claim = await billing.reserveSubmission(customer,input);
      await billing.settleSubmission(customer, {operationId:input.operationId,claimToken:claim.claimToken,
        outcome:'unknown',result:{status:'unverified',note:'POST timed out after dispatch'}});
      const replay = await billing.reserveSubmission(customer,input);
      assert.equal(replay.dispatch, false);
      assert.equal(replay.status, 'unknown');
      const balance = await account(customer);
      assert.equal(balance.available_credits, 1);
      assert.equal(balance.reserved_credits, 1);
      const operation = await pool.query('SELECT id FROM ps_billing_operations WHERE customer_id=$1 AND operation_key=$2', [balance.id,input.operationId]);
      await assert.rejects(billing.resolveOperation(adminA, {operationId:operation.rows[0].id,idempotencyKey:newKey(),
        resolution:'release',confirmedReview:true,evidence:'UAT cannot establish absence while request may still run.'}),
      error => error.code === 'OPERATION_STILL_IN_FLIGHT');
      assert.equal((await account(customer)).reserved_credits, 1);
    });

    await t.test('Wrong owner or claim token cannot settle a held operation', async () => {
      const customer = identity('settle-owner'), other = identity('settle-other');
      await fund(customer,1);
      const input=submission(),claim=await billing.reserveSubmission(customer,input);
      const settlement={operationId:input.operationId,claimToken:claim.claimToken,
        outcome:'confirmed',result:{status:'page-confirmed',note:'UAT'}};
      await assert.rejects(billing.settleSubmission(other,settlement), error => error.code === 'OPERATION_NOT_FOUND');
      await assert.rejects(billing.settleSubmission(customer,{...settlement,claimToken:newKey()}), error => error.code === 'INVALID_CLAIM');
      assert.equal((await account(customer)).reserved_credits,1);
      assert.equal((await account(other)).reserved_credits,0);
    });

    await t.test('Concurrent confirmed settlements debit once and cannot later refund the same operation', async () => {
      const customer=identity('settle-once');
      await fund(customer,2);
      const input=submission(),claim=await billing.reserveSubmission(customer,input);
      const settlement={operationId:input.operationId,claimToken:claim.claimToken,
        outcome:'confirmed',result:{status:'page-confirmed',note:'UAT confirmed'}};
      await Promise.all(Array.from({length:16},()=>billing.settleSubmission(customer,settlement)));
      const replay=await billing.settleSubmission(customer,{...settlement,outcome:'not_sent',result:{status:'failed'}});
      assert.equal(replay.status,'consumed');
      const balance=await account(customer);
      assert.equal(balance.available_credits,1);assert.equal(balance.reserved_credits,0);
      assert.equal(await count('ps_billing_ledger',"customer_id=$1 AND kind='consume'",[balance.id]),1);
      assert.equal(await count('ps_billing_ledger',"customer_id=$1 AND kind='release'",[balance.id]),0);
      assert.equal((await billing.reserveSubmission(customer,input)).dispatch,false);
    });

    await t.test('Confirmed no-dispatch failure returns a held credit only once', async () => {
      const customer=identity('release-once');await fund(customer,1);
      const input=submission(),claim=await billing.reserveSubmission(customer,input);
      await Promise.all(Array.from({length:12},()=>billing.settleSubmission(customer,{
        operationId:input.operationId,claimToken:claim.claimToken,outcome:'not_sent',
        result:{status:'failed',note:'UAT pre-POST failure'}})));
      const balance=await account(customer);
      assert.equal(balance.available_credits,1);assert.equal(balance.reserved_credits,0);
      assert.equal(await count('ps_billing_ledger',"customer_id=$1 AND kind='release'",[balance.id]),1);
      assert.equal((await billing.reserveSubmission(customer,input)).dispatch,false);
    });

    await t.test('A database failure rolls approval, payment, credit and audit back together', async () => {
      const customer=identity('approval-rollback'),order=await pendingOrder(customer,5);
      const customerRow=await billing.ensureCustomer(customer),input=approval(order);
      await pool.query('INSERT INTO uat_reject_ledger VALUES($1,$2)',[customerRow.id,'topup']);
      await assert.rejects(billing.approveOrder(adminA,input), error=>error.code==='P0001');
      assert.equal((await billing.getOrder(customer,order.id)).status,'pending_review');
      assert.equal((await account(customer)).available_credits,0);
      assert.equal(await count('ps_billing_bank_payments','order_id=$1',[order.id]),0);
      assert.equal(await count('ps_billing_admin_actions','target_id=$1',[order.id]),0);
      await pool.query('DELETE FROM uat_reject_ledger WHERE customer_id=$1',[customerRow.id]);
      await billing.approveOrder(adminA,input);
      assert.equal((await account(customer)).available_credits,5);
    });

    await t.test('A database failure after dispatch keeps the durable hold and never reclaims dispatch', async () => {
      const customer=identity('settle-rollback');await fund(customer,1);
      const input=submission(),claim=await billing.reserveSubmission(customer,input);
      const customerRow=await billing.ensureCustomer(customer);
      await pool.query('INSERT INTO uat_reject_ledger VALUES($1,$2)',[customerRow.id,'consume']);
      const settlement={operationId:input.operationId,claimToken:claim.claimToken,
        outcome:'confirmed',result:{status:'page-confirmed',note:'UAT accepted externally'}};
      await assert.rejects(billing.settleSubmission(customer,settlement),error=>error.code==='P0001');
      const balance=await account(customer);
      assert.equal(balance.available_credits,0);assert.equal(balance.reserved_credits,1);
      assert.equal(await count('ps_billing_ledger',"customer_id=$1 AND kind='consume'",[balance.id]),0);
      const replay=await billing.reserveSubmission(customer,input);
      assert.equal(replay.dispatch,false);assert.equal(replay.status,'dispatching');
      await pool.query('DELETE FROM uat_reject_ledger WHERE customer_id=$1',[customerRow.id]);
      await billing.settleSubmission(customer,settlement);
      assert.equal((await account(customer)).reserved_credits,0);
    });

    await t.test('A failed reservation is fully rolled back before any dispatch permission is returned', async () => {
      const customer=identity('reserve-rollback');await fund(customer,1);
      const customerRow=await billing.ensureCustomer(customer),input=submission();
      await pool.query('INSERT INTO uat_reject_ledger VALUES($1,$2)',[customerRow.id,'reserve']);
      await assert.rejects(billing.reserveSubmission(customer,input),error=>error.code==='P0001');
      const balance=await account(customer);
      assert.equal(balance.available_credits,1);assert.equal(balance.reserved_credits,0);
      assert.equal(await count('ps_billing_operations','customer_id=$1',[balance.id]),0);
      await pool.query('DELETE FROM uat_reject_ledger WHERE customer_id=$1',[customerRow.id]);
      assert.equal((await billing.reserveSubmission(customer,input)).dispatch,true);
    });
  } finally {
    db.setTestAdapter(undefined);
    await db.close();
    await pool.end();
    if(createdSchema) await owner.query(`DROP SCHEMA "${schema}" CASCADE`);
    await owner.end();
    for(const key of Object.keys(process.env)) if(!(key in beforeEnv)) delete process.env[key];
    Object.assign(process.env,beforeEnv);
  }
});
