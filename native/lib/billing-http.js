'use strict';
const auth = require('./auth');
const billing = require('./billing');

function headers(res) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
}
function body(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json'))
    throw new billing.BillingError(415,'JSON_REQUIRED','Chỉ nhận yêu cầu JSON.');
  const origin = req.headers.origin;
  if (origin && origin !== auth.origin(req)) throw new billing.BillingError(403,'ORIGIN_REJECTED','Yêu cầu không cùng tên miền.');
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new billing.BillingError(403,'ORIGIN_REJECTED','Yêu cầu không cùng tên miền.');
  let value = req.body;
  if (typeof value === 'string') {
    if (value.length > 20000) throw new billing.BillingError(413,'PAYLOAD_TOO_LARGE','Nội dung yêu cầu quá lớn.');
    try { value = JSON.parse(value); } catch (_) { throw new billing.BillingError(400,'INVALID_JSON','Nội dung yêu cầu không hợp lệ.'); }
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new billing.BillingError(400,'INVALID_JSON','Nội dung yêu cầu không hợp lệ.');
  return value;
}
async function identity(req,res,optional = false) {
  try {
    if (typeof auth.billingIdentity !== 'function') throw new billing.BillingError(503,'BILLING_AUTH_UNAVAILABLE','Xác thực số lượt chưa sẵn sàng.');
    const current = await auth.billingIdentity(req,res);
    return billing.verifiedIdentity(current);
  } catch (error) {
    if (optional && error.status === 401) return null;
    throw error;
  }
}
function error(res,cause) {
  const known = cause instanceof billing.BillingError;
  const authFailure = !known && cause.status===401;
  if (!known && !authFailure) console.error('[PandaStudy billing API]',cause.code || 'UNAVAILABLE');
  const status = known?cause.status:authFailure?401:503;
  return res.status(status).json({ok:false,code:known?cause.code:authFailure?'BILLING_IDENTITY_REQUIRED':'BILLING_UNAVAILABLE',
    error:known?cause.message:authFailure?'Hãy kết nối lại Google để tiếp tục.':'Dịch vụ số lượt đang tạm gián đoạn. Hãy kiểm tra trạng thái yêu cầu hiện có trước khi thử lại.'});
}
function method(res,allow) { res.setHeader('Allow',allow); return res.status(405).json({ok:false,code:'METHOD_NOT_ALLOWED',error:'Phương thức không được hỗ trợ.'}); }
module.exports = {headers,body,identity,error,method};
