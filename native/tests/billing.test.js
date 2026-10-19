'use strict';

// PostgreSQL-engine integration tests in PGlite. These do not replace the
// independent multi-connection PostgreSQL tests or deployed production UAT.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('@electric-sql/pglite');
const billing = require('../lib/billing');
const db = require('../lib/billing-db');
const notifications = require('../lib/billing-notifications');
const auth = require('../lib/auth');
const billingApi = require('../api/billing');
const adminApi = require('../api/admin-topups');

const buyer = {sub:'google-buyer-001',email:'buyer@example.test',email_verified:true};
const other = {sub:'google-buyer-002',email:'other@example.test',email_verified:true};
const admin = {sub:'google-admin-001',email:'admin@example.test',email_verified:true};
const admin2 = {sub:'google-admin-002',email:'admin2@example.test',email_verified:true};
let engine, adapter, fault, afterFault;
let keySequence = 0;
const key = label => `${label}-${String(++keySequence).padStart(8,'0')}`;
const schema = fs.readFileSync(path.join(__dirname,'../migrations/001_billing.sql'),'utf8');

function configure() {
  process.env.BILLING_ENABLED = 'true';
  delete process.env.BILLING_TOPUPS_PAUSED;
  process.env.DATABASE_URL = 'postgresql://unused:test@localhost/pglite_test_adapter';
  process.env.RESEND_API_KEY = 'test-resend-key-not-real';
  process.env.BILLING_EMAIL_FROM = 'PandaStudy <billing@example.test>';
  process.env.BILLING_CRON_SECRET = 'test-cron-secret-with-at-least-32-characters';
  process.env.BILLING_ADMIN_EMAILS = `${admin.email},${admin2.email}`;
  process.env.BILLING_NOTIFICATION_EMAILS = `${admin.email},${admin2.email}`;
  process.env.BILLING_BANK_ID = '999999';
  process.env.BILLING_BANK_NAME = 'Demo Bank';
  process.env.BILLING_BANK_ACCOUNT_NUMBER = '00000000000000';
  process.env.BILLING_BANK_ACCOUNT_NAME = 'Merchant Demo';
  process.env.BILLING_QR_IMAGE_URL = '/assets/uat-payment-qr.svg';
  process.env.PUBLIC_SITE_URL = 'https://pandastudy-preview.example.com';
  delete process.env.BILLING_PUBLIC_SITE_URL;
}
function resultOf(result) {
  return {...result,rowCount:result.rows.length || result.affectedRows || 0};
}
test.before(async () => {
  configure();
  engine = new PGlite();
  await engine.exec(schema);
  await engine.exec(schema); // The initial migration is intentionally repeatable.
  let tail = Promise.resolve();
  async function lock() {
    let release;
    const before = tail;
    tail = new Promise(resolve => { release = resolve; });
    await before;
    return release;
  }
  async function raw(sql,values) {
    if (fault) fault(sql,values);
    const result=resultOf(await engine.query(sql,values));
    if (afterFault) afterFault(sql,values);
    return result;
  }
  adapter = {
    async query(sql,values) { const release=await lock();try{return await raw(sql,values);}finally{release();} },
    async connect() { const release=await lock();return {query:raw,release}; }
  };
  db.setTestAdapter(adapter);
});
test.beforeEach(async () => {
  configure(); fault = null; afterFault = null; db.setTestAdapter(adapter);
  await db.query('TRUNCATE ps_billing_customers CASCADE');
});
test.after(async () => { db.setTestAdapter(null); await engine.close(); });

async function pending(quantity = 3, identity = buyer) {
  const order = await billing.createOrder(identity,{quantity,idempotencyKey:key('create')});
  return billing.submitPaid(identity,{orderId:order.id});
}
async function approve(order, identity=admin, reference=key('bank')) {
  return billing.approveOrder(identity,{orderId:order.id,bankReference:reference,
    receivedAmountVnd:order.amountVnd,confirmedBankTransfer:true,idempotencyKey:key('approve')});
}
async function fund(quantity=3,identity=buyer) { const order=await pending(quantity,identity);await approve(order);return order; }
function rowInput(operationId=key('row')) { return {operationId,formId:'form_123456789',answers:{question_1:'a',question_2:['b','c']}}; }
async function request(handler,{method='GET',query={},body,identity=buyer,headers={}}={}) {
  const previous = auth.billingIdentity;
  auth.billingIdentity = async () => {
    if (!identity) throw new billing.BillingError(401,'LOGIN_REQUIRED','Login required');
    return identity;
  };
  const req={method,query,body,headers:{'content-type':'application/json',origin:process.env.PUBLIC_SITE_URL,...headers}};
  const res={statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},
    status(code){this.statusCode=code;return this;},json(value){this.data=value;return this;}};
  try { await handler(req,res); return res; } finally { auth.billingIdentity=previous; }
}

test('financial infrastructure fails closed while optional email can degrade safely',async () => {
  delete process.env.RESEND_API_KEY;
  const profile=await billing.getProfile(buyer);
  assert.equal(profile.configured,true);
  assert.equal(profile.purchasesEnabled,true);
  assert.ok(profile.warnings.includes('email_notifications'));
  assert.deepEqual(billing.NOTIFICATION_RECIPIENTS,[admin.email,admin2.email]);
  const noEmailOrder=await billing.createOrder(buyer,{quantity:1,idempotencyKey:key('request')});
  assert.equal(noEmailOrder.amountVnd,500);
  assert.equal((await notifications.drainOutbox({limit:2})).paused,true);

  configure();
  for (const setting of ['BILLING_BANK_ID','BILLING_BANK_NAME','BILLING_BANK_ACCOUNT_NUMBER',
    'BILLING_BANK_ACCOUNT_NAME','BILLING_QR_IMAGE_URL']) {
    const saved = process.env[setting];
    delete process.env[setting];
    assert.equal(billing.getConfigStatus().configured,false,setting);
    assert.equal((await billing.getProfile(buyer)).bank,null,setting);
    process.env[setting] = saved;
  }
  const notificationSetting = process.env.BILLING_NOTIFICATION_EMAILS;
  delete process.env.BILLING_NOTIFICATION_EMAILS;
  assert.equal(billing.getConfigStatus().configured,true);
  assert.ok(billing.getConfigStatus().warnings.includes('notification_recipients'));
  process.env.BILLING_NOTIFICATION_EMAILS = `${admin.email},invalid-address`;
  assert.equal(billing.getConfigStatus().configured,true);
  assert.ok(billing.getConfigStatus().warnings.includes('notification_recipients'));
  process.env.BILLING_NOTIFICATION_EMAILS = notificationSetting;
  assert.deepEqual(billing.NOTIFICATION_RECIPIENTS,[admin.email,admin2.email]);

  for (const value of ['//elsewhere.example.test/qr.svg','https://elsewhere.example.test/qr.svg',
    'javascript:alert(1)','data:image/png;base64,AA','/\\elsewhere.example.test/qr.svg']) {
    process.env.BILLING_QR_IMAGE_URL = value;
    assert.equal(billing.getConfigStatus().configured,false,value);
  }
  process.env.BILLING_QR_IMAGE_URL = process.env.PUBLIC_SITE_URL + '/assets/uat-payment-qr.svg';
  assert.equal(billing.getConfigStatus().configured,true);
  configure();
  process.env.BILLING_ENABLED='false';
  const disabled=await billing.getProfile(buyer);
  assert.equal(disabled.billingEnabled,false);
  assert.equal(disabled.signedIn,true);
  assert.equal(disabled.user.email,buyer.email);
  assert.equal(Number((await db.query('SELECT count(*) AS count FROM ps_billing_customers WHERE google_sub=$1',[buyer.sub])).rows[0].count),1);
});
test('verified Google subject owns credits; public profile is usable without login',async () => {
  await assert.rejects(billing.ensureCustomer({...buyer,email_verified:false}),{status:401});
  await assert.rejects(billing.ensureCustomer({...buyer,sub:''}),{status:401});
  const a=await billing.ensureCustomer(buyer);
  const b=await billing.ensureCustomer({...buyer,sub:'different-sub'});
  assert.notEqual(a.id,b.id);
  const response=await request(billingApi,{identity:null});
  assert.equal(response.statusCode,200);
  assert.equal(response.data.configured,true);
  assert.equal(response.data.signedIn,false);
  assert.equal(response.data.bank,null);
});

test('order uses server pricing, configured same-origin QR, bounded quantity and durable creation idempotency',async () => {
  const requestId=key('create');
  const first=await billing.createOrder(buyer,{quantity:20,unitPriceVnd:1,amountVnd:1,idempotencyKey:requestId});
  const repeated=await billing.createOrder(buyer,{quantity:20,idempotencyKey:requestId});
  assert.equal(first.id,repeated.id);
  assert.equal(first.amountVnd,10000);
  assert.equal(first.unitPriceVnd,500);
  assert.equal(first.bank.accountNumber,'00000000000000');
  assert.equal(first.bank.accountName,'Merchant Demo');
  assert.equal(first.qrImageUrl,'/assets/uat-payment-qr.svg');
  assert.equal(first.qrHasAmountAndMemo,false);
  assert.equal(first.paymentMemo,first.orderCode);
  process.env.BILLING_QR_IMAGE_URL = '/api/payment-qr';
  const exactQr = await billing.getOrder(buyer,first.id);
  assert.equal(exactQr.qrImageUrl,'/api/payment-qr?orderId='+encodeURIComponent(first.id));
  assert.equal(exactQr.qrHasAmountAndMemo,true);
  process.env.BILLING_QR_IMAGE_URL = '/assets/uat-payment-qr.svg';
  process.env.BILLING_BANK_ACCOUNT_NUMBER = '11111111111111';
  const oldOrder = await billing.getOrder(buyer,first.id);
  assert.equal(oldOrder.bank.accountNumber,'00000000000000');
  assert.equal(oldOrder.qrImageUrl,null);
  process.env.BILLING_BANK_ACCOUNT_NUMBER = '00000000000000';
  await assert.rejects(billing.createOrder(buyer,{quantity:21,idempotencyKey:requestId}),{code:'IDEMPOTENCY_CONFLICT'});
  await assert.rejects(billing.createOrder(buyer,{quantity:0,idempotencyKey:key('zero')}),{code:'INVALID_QUANTITY'});
  await assert.rejects(billing.getOrder(other,first.id),{status:404});
  for(let index=0;index<4;index++)await billing.createOrder(buyer,{quantity:1,idempotencyKey:key('more')});
  await assert.rejects(billing.createOrder(buyer,{quantity:1,idempotencyKey:key('limit')}),{code:'TOO_MANY_OPEN_ORDERS'});
});

test('payment claim creates exactly two durable notifications, never credits on a user claim',async () => {
  const order=await pending(5);
  await billing.submitPaid(buyer,{orderId:order.id});
  const messages=await db.query('SELECT recipient,status FROM ps_billing_outbox ORDER BY recipient');
  assert.equal(messages.rowCount,2);
  assert.deepEqual(messages.rows.map(x=>x.recipient).sort(),[...billing.NOTIFICATION_RECIPIENTS].sort());
  assert.equal((await billing.getProfile(buyer)).availableCredits,0);
  assert.equal((await billing.getOrder(buyer,order.id)).status,'pending_review');
});

test('two administrators can approve one order only once, with amount matching and bank reference reuse blocked',async () => {
  const order=await pending(7);
  await assert.rejects(billing.approveOrder(admin,{orderId:order.id,bankReference:'TX-ONE',receivedAmountVnd:1,
    confirmedBankTransfer:true,idempotencyKey:key('wrong')}),{code:'AMOUNT_MISMATCH'});
  const results=await Promise.all([approve(order,admin,'TX-ONE'),approve(order,admin2,'TX-ONE')]);
  assert.ok(results.every(x=>x.status==='approved'));
  assert.equal((await billing.getProfile(buyer)).availableCredits,7);
  const ledger=await db.query("SELECT * FROM ps_billing_ledger WHERE kind='topup'");
  assert.equal(ledger.rowCount,1);
  const another=await pending(7);
  await assert.rejects(approve(another,admin,'tx-one'),{code:'BANK_REFERENCE_ALREADY_USED'});
  assert.equal((await billing.getOrder(buyer,another.id)).status,'pending_review');
  assert.equal((await billing.getProfile(buyer)).availableCredits,7);
});

test('discount packages charge exact bundle price and credit the advertised quantity',async () => {
  await assert.rejects(
    billing.createOrder(buyer,{packageId:'popular',quantity:99,idempotencyKey:key('spoof-package')}),
    {code:'PACKAGE_QUANTITY_MISMATCH'}
  );
  await assert.rejects(
    billing.createOrder(buyer,{packageId:'unknown',quantity:100,idempotencyKey:key('unknown-package')}),
    {code:'INVALID_PACKAGE'}
  );
  const popular=await billing.createOrder(buyer,{packageId:'popular',quantity:100,idempotencyKey:key('popular')});
  assert.equal(popular.package.id,'popular');
  assert.equal(popular.quantity,100);
  assert.equal(popular.amountVnd,45000);
  assert.equal(popular.listPriceVnd,50000);
  assert.equal(popular.discountPercent,10);
  const stored=(await db.query('SELECT quantity,unit_price_vnd,amount_vnd,order_code FROM ps_billing_orders WHERE id=$1',[popular.id])).rows[0];
  assert.equal(Number(stored.quantity),90);
  assert.equal(Number(stored.unit_price_vnd),500);
  assert.equal(Number(stored.amount_vnd),45000);
  assert.match(stored.order_code,/^PSPOPULAR-/);

  await billing.submitPaid(buyer,{orderId:popular.id});
  await approve(popular);
  assert.equal((await billing.getProfile(buyer)).availableCredits,100);
  const ledger=(await db.query("SELECT available_delta FROM ps_billing_ledger WHERE kind='topup' AND source_id=$1",[popular.id])).rows[0];
  assert.equal(Number(ledger.available_delta),100);

  const custom=await billing.createOrder(buyer,{quantity:100,idempotencyKey:key('custom-100')});
  assert.equal(custom.package,null);
  assert.equal(custom.quantity,100);
  assert.equal(custom.amountVnd,50000);
});

test('admin revenue metrics count approved package revenue, credits, buyers and pending value by month',async () => {
  const starter=await billing.createOrder(other,{packageId:'starter',quantity:20,idempotencyKey:key('starter')});
  await billing.submitPaid(other,{orderId:starter.id});
  await approve(starter,admin,'METRIC-STARTER');

  const popular=await billing.createOrder(buyer,{packageId:'popular',quantity:100,idempotencyKey:key('metric-popular')});
  await billing.submitPaid(buyer,{orderId:popular.id});
  await approve(popular,admin,'METRIC-POPULAR');

  const research=await billing.createOrder(buyer,{packageId:'research',quantity:250,idempotencyKey:key('metric-research')});
  await billing.submitPaid(buyer,{orderId:research.id});

  const metrics=await billing.listAdminMetrics(admin);
  assert.equal(metrics.currentMonth.revenueVnd,55000);
  assert.equal(metrics.currentMonth.approvedOrders,2);
  assert.equal(metrics.currentMonth.creditsSold,120);
  assert.equal(metrics.currentMonth.buyers,2);
  assert.equal(metrics.pending.reviewAmountVnd,110000);
  assert.equal(metrics.pending.reviewOrders,1);
  assert.equal(metrics.allTime.revenueVnd,55000);
  assert.equal(metrics.allTime.creditsSold,120);
  assert.equal(metrics.monthly.length,12);
  assert.equal(metrics.monthly.at(-1).revenueVnd,55000);
  const popularMetric=metrics.packages.find(item=>item.id==='popular');
  assert.equal(popularMetric.approvedOrders,1);
  assert.equal(popularMetric.revenueVnd,45000);

  const response=await request(adminApi,{identity:admin,query:{resource:'metrics'}});
  assert.equal(response.statusCode,200);
  assert.equal(response.data.metrics.currentMonth.revenueVnd,55000);
  assert.equal((await request(adminApi,{identity:buyer,query:{resource:'metrics'}})).statusCode,403);
});

test('admin may approve with checkbox only; amount and bank reference are optional audit details',async () => {
  const order=await pending(5);
  await assert.rejects(billing.approveOrder(admin,{orderId:order.id,bankReference:'',receivedAmountVnd:null,
    confirmedBankTransfer:false,idempotencyKey:key('unchecked')}),{code:'BANK_CONFIRMATION_REQUIRED'});

  const approved=await billing.approveOrder(admin,{orderId:order.id,bankReference:'',receivedAmountVnd:null,
    confirmedBankTransfer:true,idempotencyKey:key('manual-approve')});
  assert.equal(approved.status,'approved');
  assert.equal((await billing.getProfile(buyer)).availableCredits,5);

  const payment=(await db.query('SELECT reference_original,amount_vnd FROM ps_billing_bank_payments WHERE order_id=$1',[order.id])).rows[0];
  assert.match(payment.reference_original,/^MANUAL_CONFIRMATION:/);
  assert.equal(Number(payment.amount_vnd),order.amountVnd);

  const listed=(await billing.listAdminTopups(admin,{status:'approved'})).orders.find(item=>item.id===order.id);
  assert.equal(listed.manualBankConfirmation,true);
  assert.equal(Object.hasOwn(listed,'bankReference'),false);
  assert.equal(Object.hasOwn(listed,'receivedAmountVnd'),false);
});

test('admin user directory exposes persistent Google accounts without raw Google subject',async () => {
  await billing.getProfile(buyer);
  await billing.getProfile(admin);
  await fund(2,buyer);
  const users=await billing.listAdminUsers(admin,{search:'buyer@'});
  assert.equal(users.length,1);
  assert.equal(users[0].email,buyer.email);
  assert.equal(users[0].role,'user');
  assert.equal(users[0].purchasedCredits,2);
  assert.equal(users[0].paidAmountVnd,1000);
  assert.equal(users[0].availableCredits,2);
  assert.ok(users[0].createdAt);
  assert.ok(users[0].lastActivityAt);
  assert.equal(Object.hasOwn(users[0],'google_sub'),false);
  assert.equal(Object.hasOwn(users[0],'googleSub'),false);

  const admins=await billing.listAdminUsers(admin,{search:'admin@example.test'});
  assert.equal(admins.length,1);
  assert.equal(admins[0].role,'admin');

  await assert.rejects(billing.listAdminUsers(buyer),{code:'BILLING_ADMIN_REQUIRED'});
  const response=await request(adminApi,{identity:admin,query:{resource:'users',search:'buyer@'}});
  assert.equal(response.statusCode,200);
  assert.equal(response.data.users[0].email,buyer.email);
});

test('a fault after updating balance rolls back approval, bank allocation and audit together',async () => {
  const order=await pending(4);
  fault=sql=>{if(sql.includes('INSERT INTO ps_billing_ledger'))throw Error('Injected mid-transaction failure');};
  await assert.rejects(approve(order));
  fault=null;
  assert.equal((await billing.getProfile(buyer)).availableCredits,0);
  assert.equal((await billing.getOrder(buyer,order.id)).status,'pending_review');
  assert.equal((await db.query('SELECT * FROM ps_billing_bank_payments')).rowCount,0);
  assert.equal((await db.query('SELECT * FROM ps_billing_admin_actions')).rowCount,0);
});

test('server claims cannot overdraw credits; repeated or altered row keys never dispatch twice',async () => {
  await fund(3);
  const results=await Promise.allSettled(Array.from({length:20},()=>billing.reserveSubmission(buyer,rowInput())));
  assert.equal(results.filter(x=>x.status==='fulfilled'&&x.value.dispatch).length,3);
  assert.ok(results.filter(x=>x.status==='rejected').every(x=>x.reason.code==='INSUFFICIENT_CREDITS'));
  const profile=await billing.getProfile(buyer);
  assert.equal(profile.availableCredits,0);assert.equal(profile.reservedCredits,3);
  const existing=(await db.query('SELECT operation_key FROM ps_billing_operations LIMIT 1')).rows[0].operation_key;
  const replay=await billing.reserveSubmission(buyer,rowInput(existing));
  assert.equal(replay.dispatch,false);assert.equal(replay.result.delivery,'unknown');
  await assert.rejects(billing.reserveSubmission(buyer,{...rowInput(existing),answers:{question_1:'changed'}}),{code:'OPERATION_PAYLOAD_CONFLICT'});
});

test('confirmed, definitely not sent and unknown outcomes maintain exact ledger balances',async () => {
  await fund(3);
  const confirmed=await billing.reserveSubmission(buyer,rowInput());
  const success={operationId:confirmed.operationId,claimToken:confirmed.claimToken,outcome:'confirmed',
    result:{status:'page-confirmed',delivery:'confirmed',receivedAt:'2026-10-18T00:00:00Z',note:'Google confirmation'}};
  await billing.settleSubmission(buyer,success);
  await billing.settleSubmission(buyer,success);
  const notSent=await billing.reserveSubmission(buyer,rowInput());
  await billing.settleSubmission(buyer,{...notSent,outcome:'not_sent',result:{status:'failed',note:'Failed before POST'}});
  const unknown=await billing.reserveSubmission(buyer,rowInput());
  await billing.settleSubmission(buyer,{...unknown,outcome:'unknown',result:{status:'unverified',note:'Response lost'}});
  const profile=await billing.getProfile(buyer);
  assert.equal(profile.availableCredits,1);assert.equal(profile.reservedCredits,1);
  const totals=await db.query('SELECT sum(available_delta) AS available,sum(reserved_delta) AS reserved FROM ps_billing_ledger');
  assert.equal(Number(totals.rows[0].available),profile.availableCredits);
  assert.equal(Number(totals.rows[0].reserved),profile.reservedCredits);
  const operation=(await db.query('SELECT * FROM ps_billing_operations WHERE operation_key=$1',[unknown.operationId])).rows[0];
  const resolution={operationId:operation.id,resolution:'release',evidence:'Đã đối chiếu bản ghi và xác nhận chưa có phản hồi.',confirmedReview:true,idempotencyKey:key('resolve')};
  await assert.rejects(billing.resolveOperation(admin,resolution),{code:'OPERATION_STILL_IN_FLIGHT'});
  await db.query("UPDATE ps_billing_operations SET dispatch_started_at=now()-interval '6 minutes' WHERE id=$1",[operation.id]);
  await billing.resolveOperation(admin,resolution);
  await billing.resolveOperation(admin,resolution);
  const resolved=await billing.getProfile(buyer);
  assert.equal(resolved.availableCredits,2);assert.equal(resolved.reservedCredits,0);
  const replay=await billing.reserveSubmission(buyer,rowInput(unknown.operationId));
  assert.equal(replay.dispatch,false);assert.equal(replay.result.billingResolution,'release');
});

test('pausing purchases preserves approval, already-transferred claims and paid enforcement',async () => {
  const existing=await billing.createOrder(buyer,{quantity:2,idempotencyKey:key('create')});
  process.env.BILLING_TOPUPS_PAUSED='true';
  assert.equal((await billing.getProfile(buyer)).purchasesEnabled,false);
  assert.equal((await billing.getOrder(buyer,existing.id)).qrImageUrl,null);
  await assert.rejects(billing.createOrder(buyer,{quantity:1,idempotencyKey:key('paused')}),{code:'TOPUPS_PAUSED'});
  await billing.submitPaid(buyer,{orderId:existing.id});
  await approve(existing);
  const claim=await billing.reserveSubmission(buyer,rowInput());
  assert.equal(claim.dispatch,true);
  assert.equal((await billing.getProfile(buyer)).availableCredits,1);
});

test('HTTP endpoints enforce role, owner identity, JSON origin and sanitized database errors',async () => {
  assert.equal((await request(adminApi,{identity:buyer})).statusCode,403);
  const create=await request(billingApi,{method:'POST',body:{action:'create',quantity:2,idempotencyKey:key('http'),sub:other.sub,email:other.email}});
  assert.equal(create.statusCode,201);
  assert.equal((await billing.listMyOrders(other)).length,0);
  assert.equal((await billing.listMyOrders(buyer)).length,1);
  const crossSite=await request(billingApi,{method:'POST',body:{action:'create',quantity:2,idempotencyKey:key('cross')},headers:{origin:'https://attacker.example'}});
  assert.equal(crossSite.statusCode,403);
  fault=()=>{throw Error('database-url-secret-never-return-this');};
  const failed=await request(billingApi,{query:{action:'orders'}});
  fault=null;
  assert.equal(failed.statusCode,503);
  assert.ok(!JSON.stringify(failed.data).includes('database-url-secret'));
  assert.equal(failed.headers['Cache-Control'],'no-store');
});

test('lost response after COMMIT does not claim the order was unchanged and a retry recovers the same order',async () => {
  const requestId=key('ambiguous-commit');
  let disconnect=true;
  afterFault=sql=>{
    if (disconnect && /^COMMIT$/i.test(sql.trim())) {
      disconnect=false;
      const error=new Error('Simulated connection loss after committed write');error.code='ECONNRESET';throw error;
    }
  };
  const body={action:'create',quantity:2,idempotencyKey:requestId};
  const response=await request(billingApi,{method:'POST',body});
  afterFault=null;
  assert.equal(response.statusCode,503);
  assert.ok(!response.data.error.includes('Chưa thay đổi'));
  assert.match(response.data.error,/kiểm tra trạng thái yêu cầu hiện có/);
  const persisted=await billing.listMyOrders(buyer);
  assert.equal(persisted.length,1);
  const retry=await request(billingApi,{method:'POST',body});
  assert.equal(retry.statusCode,201);
  assert.equal(retry.data.order.id,persisted[0].id);
  assert.equal((await billing.listMyOrders(buyer)).length,1);
});

test('outbox workers claim messages exclusively and successful messages are not sent again',async () => {
  await pending(2);
  const sent=[];
  const send=async row=>{sent.push(row.id);await new Promise(resolve=>setTimeout(resolve,5));return {ok:true,messageId:'provider-'+row.id};};
  await Promise.all([notifications.drainOutbox({limit:2,send}),notifications.drainOutbox({limit:2,send})]);
  assert.equal(sent.length,2);assert.equal(new Set(sent).size,2);
  assert.equal((await notifications.drainOutbox({limit:2,send})).claimed,0);
  const adminList=await billing.listAdminTopups(admin);
  assert.equal(adminList.orders[0].notifications.sent,2);
  assert.ok(!JSON.stringify(adminList).includes(process.env.RESEND_API_KEY));
});

test('email retry keeps immutable payload and idempotency identity; expired ambiguous delivery stays held',async () => {
  await pending(2);
  let first;
  await notifications.drainOutbox({limit:1,send:async row=>{first=row;return {ok:false,retryable:true,uncertain:true,code:'TEST_TIMEOUT'};}});
  await db.query("UPDATE ps_billing_outbox SET next_attempt_at=now()-interval '1 minute' WHERE id=$1",[first.id]);
  process.env.BILLING_EMAIL_FROM='Changed <changed@example.com>';
  process.env.PUBLIC_SITE_URL='https://changed.example.com';
  const resent=[];
  await notifications.drainOutbox({limit:2,send:async row=>{resent.push(row);return {ok:true,messageId:'provider-'+row.id};}});
  const same=resent.find(row=>row.id===first.id);
  assert.ok(same);assert.deepEqual(same.message_json,first.message_json);
  assert.match(same.message_json.text,/pandastudy-preview\.example\.com/);
  await db.query(`UPDATE ps_billing_outbox SET status='sending',lease_expires_at=now()-interval '1 minute',
    first_attempt_at=now()-interval '25 hours',delivery_uncertain=true WHERE id=$1`,[first.id]);
  let calls=0;
  await notifications.drainOutbox({limit:2,send:async()=>{calls++;return {ok:true,messageId:'must-not-send'};}});
  assert.equal(calls,0);
  assert.equal((await notifications.retryNotifications(admin)).requeued,0);
  const held=(await db.query('SELECT status,failure_code FROM ps_billing_outbox WHERE id=$1',[first.id])).rows[0];
  assert.equal(held.status,'failed');assert.equal(held.failure_code,'DELIVERY_UNCERTAIN_EXPIRED');
});

test('Resend requests carry durable idempotency keys and delivery errors are classified without leaking provider text',async () => {
  const row={id:'c14166b4-2868-4d66-967d-1366a4e32db0',message_json:{from:'billing@example.com',to:[admin.email],subject:'Test',text:'Test'}};
  let options;
  const success=await notifications.sendViaResend(row,async(url,input)=>{assert.equal(url,'https://api.resend.com/emails');options=input;return {ok:true,json:async()=>({id:'provider-test'})};});
  assert.equal(success.messageId,'provider-test');
  assert.equal(options.headers['Idempotency-Key'],'pandastudy-topup-'+row.id);
  const failure=await notifications.sendViaResend(row,async()=>({ok:false,status:503}));
  assert.equal(failure.uncertain,true);assert.equal(failure.retryable,true);
  assert.equal(notifications.cronAuthorized({headers:{authorization:'Bearer '+process.env.BILLING_CRON_SECRET}}),true);
  assert.equal(notifications.cronAuthorized({headers:{authorization:'Bearer wrong'}}),false);
  const unicodeHeader='Bearer '+process.env.BILLING_CRON_SECRET.slice(0,-1)+'é';
  assert.doesNotThrow(()=>notifications.cronAuthorized({headers:{authorization:unicodeHeader}}));
  assert.equal(notifications.cronAuthorized({headers:{authorization:unicodeHeader}}),false);
});
