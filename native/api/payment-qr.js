'use strict';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end();
  }

  const bankId = String(process.env.BILLING_BANK_ID || '').trim();
  const accountNumber = String(process.env.BILLING_BANK_ACCOUNT_NUMBER || '').trim();
  const accountName = String(process.env.BILLING_BANK_ACCOUNT_NAME || '').trim();

  if (!/^\d{6}$/.test(bankId) || !/^\d{6,34}$/.test(accountNumber) ||
      !accountName || accountName.length > 120 || /[\r\n<>]/.test(accountName)) {
    return res.status(503).end();
  }

  const url = new URL(`https://img.vietqr.io/image/${bankId}-${accountNumber}-compact2.png`);
  url.searchParams.set('accountName', accountName);

  try {
    const response = await fetch(url, {
      headers: {'User-Agent': 'PandaStudy/1.0 payment-qr-proxy'},
      redirect: 'follow'
    });
    if (!response.ok) return res.status(502).end();

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) return res.status(502).end();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    if (req.method === 'HEAD') return res.status(200).end();

    const bytes = Buffer.from(await response.arrayBuffer());
    return res.status(200).send(bytes);
  } catch (error) {
    console.error('[PandaStudy payment QR]', error?.name || 'FETCH_FAILED');
    return res.status(502).end();
  }
};
