'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../lib/auth');
const billing = require('../lib/billing');
const paymentQr = require('../api/payment-qr');

const ORDER_ID = '00000000-0000-4000-8000-000000000001';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; }
  };
}

function request() {
  return {method:'GET', query:{orderId:ORDER_ID}, headers:{}};
}

function configure() {
  process.env.BILLING_ENABLED = 'true';
  delete process.env.BILLING_TOPUPS_PAUSED;
  process.env.BILLING_BANK_ID = '970407';
  process.env.BILLING_BANK_ACCOUNT_NUMBER = '12345678901234';
  process.env.BILLING_BANK_ACCOUNT_NAME = 'PANDA STUDY TEST';
}

test('payment QR stays hidden while billing is disabled or top-ups are paused', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('must not fetch'); };
  try {
    configure();
    process.env.BILLING_ENABLED = 'false';
    let res = response();
    await paymentQr(request(), res);
    assert.equal(res.statusCode, 404);

    configure();
    process.env.BILLING_TOPUPS_PAUSED = 'true';
    res = response();
    await paymentQr(request(), res);
    assert.equal(res.statusCode, 404);
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('live payment QR is authenticated and binds exact order amount and memo', async () => {
  const originalFetch = global.fetch;
  const originalSession = auth.session;
  const originalIdentity = auth.billingIdentity;
  const originalGetOrder = billing.getOrder;
  let requested;
  global.fetch = async url => {
    requested = String(url);
    return {
      ok: true,
      headers: {get(name) { return name.toLowerCase() === 'content-type' ? 'image/png' : null; }},
      async arrayBuffer() { return Uint8Array.from([1,2,3,4]).buffer; }
    };
  };
  auth.session = async () => ({sub:'google-user',email:'buyer@example.test',email_verified:true});
  auth.billingIdentity = async () => ({sub:'google-user',email:'buyer@example.test',email_verified:true});
  billing.getOrder = async (identity, orderId) => {
    assert.equal(identity.email,'buyer@example.test');
    assert.equal(orderId,ORDER_ID);
    return {
      id:ORDER_ID,status:'pending_payment',amountVnd:10000,paymentMemo:'PSABC123',
      bank:{bankId:'970407',bankName:'Techcombank',accountNumber:'12345678901234',accountName:'PANDA STUDY TEST'}
    };
  };
  try {
    configure();
    const res = response();
    await paymentQr(request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'image/png');
    assert.match(res.headers['Cache-Control'], /private/);
    assert.deepEqual([...res.body], [1,2,3,4]);
    assert.match(requested, /^https://img.vietqr.io/image/970407-12345678901234-compact2.png?/);
    const parsed = new URL(requested);
    assert.equal(parsed.searchParams.get('amount'),'10000');
    assert.equal(parsed.searchParams.get('addInfo'),'PSABC123');
    assert.equal(parsed.searchParams.get('accountName'),'PANDA STUDY TEST');
  } finally {
    global.fetch = originalFetch;
    auth.session = originalSession;
    auth.billingIdentity = originalIdentity;
    billing.getOrder = originalGetOrder;
  }
});

test('payment QR never renders another users missing order', async () => {
  const originalSession = auth.session;
  const originalIdentity = auth.billingIdentity;
  const originalGetOrder = billing.getOrder;
  auth.session = async () => ({sub:'google-user'});
  auth.billingIdentity = async () => ({sub:'google-user',email:'buyer@example.test',email_verified:true});
  billing.getOrder = async () => { const error = new billing.BillingError(404,'ORDER_NOT_FOUND','not found'); throw error; };
  try {
    configure();
    const res = response();
    await paymentQr(request(), res);
    assert.equal(res.statusCode, 404);
  } finally {
    auth.session = originalSession;
    auth.billingIdentity = originalIdentity;
    billing.getOrder = originalGetOrder;
  }
});
