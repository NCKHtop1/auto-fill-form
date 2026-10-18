'use strict';
const billing = require('../lib/billing');
const notifications = require('../lib/billing-notifications');
const http = require('../lib/billing-http');

module.exports = async function handler(req,res) {
  http.headers(res);
  if (!['GET','POST'].includes(req.method)) return http.method(res,'GET, POST');
  try {
    if (req.method === 'GET') {
      const action = req.query?.action || 'profile';
      if (action === 'profile') {
        const config = billing.getConfigStatus();
        const current = config.billingEnabled && config.configured ? await http.identity(req,res,true) : null;
        return res.json({ok:true,...await billing.getProfile(current)});
      }
      const current = await http.identity(req,res);
      if (action === 'orders') return res.json({ok:true,orders:await billing.listMyOrders(current)});
      if (action === 'status') return res.json({ok:true,order:await billing.getOrder(current,req.query?.orderId)});
      throw new billing.BillingError(400,'UNKNOWN_ACTION','Chức năng không tồn tại.');
    }
    const input = http.body(req),current = await http.identity(req,res);
    if (input.action === 'create') return res.status(201).json({ok:true,order:await billing.createOrder(current,input)});
    if (input.action === 'submitPaid') {
      const order = await billing.submitPaid(current,input);
      // Persisted outbox first, awaited bounded delivery second. A provider
      // failure does not lose/revert the order; cron or admin retries it later.
      let notification = {queued:true};
      try { notification = {...notification,...await notifications.drainOutbox({limit:2})}; }
      catch (error) { console.error('[PandaStudy notification queue]',error.code || 'DELIVERY_PENDING'); }
      return res.json({ok:true,order,notification});
    }
    if (input.action === 'status') return res.json({ok:true,order:await billing.getOrder(current,input.orderId)});
    throw new billing.BillingError(400,'UNKNOWN_ACTION','Chức năng không tồn tại.');
  } catch (error) { return http.error(res,error); }
};
