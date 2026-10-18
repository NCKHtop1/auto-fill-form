'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const paymentQr = require('../api/payment-qr');

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; }
  };
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
    await paymentQr({method:'GET'}, res);
    assert.equal(res.statusCode, 404);

    configure();
    process.env.BILLING_TOPUPS_PAUSED = 'true';
    res = response();
    await paymentQr({method:'GET'}, res);
    assert.equal(res.statusCode, 404);
    assert.equal(calls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('live payment QR proxies an image without embedding merchant details in source', async () => {
  const originalFetch = global.fetch;
  let requested;
  global.fetch = async url => {
    requested = String(url);
    return {
      ok: true,
      headers: {get(name) { return name.toLowerCase() === 'content-type' ? 'image/png' : null; }},
      async arrayBuffer() { return Uint8Array.from([1,2,3,4]).buffer; }
    };
  };
  try {
    configure();
    const res = response();
    await paymentQr({method:'GET'}, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'image/png');
    assert.match(res.headers['Cache-Control'], /s-maxage=3600/);
    assert.deepEqual([...res.body], [1,2,3,4]);
    assert.match(requested, /^https:\/\/img\.vietqr\.io\/image\/970407-12345678901234-compact2\.png\?/);
    assert.match(requested, /accountName=PANDA(\+|%20)STUDY(\+|%20)TEST/);
  } finally {
    global.fetch = originalFetch;
  }
});
