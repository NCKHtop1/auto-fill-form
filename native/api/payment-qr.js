'use strict';

const auth = require('../lib/auth');
const billing = require('../lib/billing');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  // Never expose merchant payment instructions before top-ups are live.
  if (process.env.BILLING_ENABLED !== 'true' || process.env.BILLING_TOPUPS_PAUSED === 'true') {
    return res.status(404).end();
  }

  const bankId = String(process.env.BILLING_BANK_ID || '').trim();
  const accountNumber = String(process.env.BILLING_BANK_ACCOUNT_NUMBER || '').trim();
  const accountName = String(process.env.BILLING_BANK_ACCOUNT_NAME || '').trim();
  const orderId = String(req.query?.orderId || '').trim();

  if (!/^\d{6}$/.test(bankId) || !/^\d{6,34}$/.test(accountNumber) ||
      !accountName || accountName.length > 120 || /[\r\n<>]/.test(accountName) ||
      !/^[0-9a-f-]{36}$/i.test(orderId)) {
    return res.status(404).end();
  }

  try {
    // The QR is derived from the authenticated user's server-side order, so
    // amount and transfer memo cannot be changed by editing image parameters.
    const session = await auth.session(req, res);
    const identity = await auth.billingIdentity(req, res, session);
    const order = await billing.getOrder(identity, orderId);
    if (!order || !['pending_payment', 'pending_review'].includes(order.status) ||
        order.bank?.bankId !== bankId || order.bank?.accountNumber !== accountNumber ||
        order.bank?.accountName !== accountName || !Number.isSafeInteger(order.amountVnd) ||
        order.amountVnd <= 0 || typeof order.paymentMemo !== 'string' ||
        !order.paymentMemo || order.paymentMemo.length > 120) {
      return res.status(404).end();
    }

    const url = new URL(`https://img.vietqr.io/image/${bankId}-${accountNumber}-compact2.png`);
    url.searchParams.set('amount', String(order.amountVnd));
    url.searchParams.set('addInfo', order.paymentMemo);
    url.searchParams.set('accountName', accountName);

    const response = await fetch(url, {
      headers: {'User-Agent': 'PandaStudy/1.0 payment-qr-proxy'},
      redirect: 'follow'
    });
    if (!response.ok) return res.status(502).end();

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) return res.status(502).end();

    res.setHeader('Content-Type', contentType);
    // QR is order-specific and authenticated; browser caching is enough.
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (req.method === 'HEAD') return res.status(200).end();

    const bytes = Buffer.from(await response.arrayBuffer());
    return res.status(200).send(bytes);
  } catch (error) {
    if (error?.status === 401 || error?.status === 403 || error?.status === 404) return res.status(404).end();
    console.error('[PandaStudy payment QR]', error?.code || error?.name || 'FETCH_FAILED');
    return res.status(502).end();
  }
};
