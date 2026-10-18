'use strict';
const billing = require('../lib/billing');
const notifications = require('../lib/billing-notifications');
const http = require('../lib/billing-http');

module.exports = async function handler(req,res) {
  http.headers(res);
  if (!['GET','POST'].includes(req.method)) return http.method(res,'GET, POST');
  try {
    if (req.method === 'GET') {
      if (!notifications.cronAuthorized(req)) throw new billing.BillingError(401,'CRON_AUTH_REQUIRED','Không có quyền chạy tác vụ thông báo.');
      return res.json({ok:true,...await notifications.drainOutbox({limit:5})});
    }
    const input = http.body(req),current = await http.identity(req,res);
    billing.requireAdmin(current);
    if (input.action !== 'retry') throw new billing.BillingError(400,'UNKNOWN_ACTION','Chức năng không tồn tại.');
    const requeued = await notifications.retryNotifications(current);
    return res.json({ok:true,...requeued,...await notifications.drainOutbox({limit:5})});
  } catch (error) { return http.error(res,error); }
};
