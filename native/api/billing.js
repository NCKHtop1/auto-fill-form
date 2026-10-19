'use strict';
const billing = require('../lib/billing');
const notifications = require('../lib/billing-notifications');
const http = require('../lib/billing-http');
const db = require('../lib/billing-db');

module.exports = async function handler(req,res) {
  http.headers(res);
  if (!['GET','POST'].includes(req.method)) return http.method(res,'GET, POST');
  try {
    if (req.method === 'GET') {
      const action = req.query?.action || 'profile';
      if (action === 'health') {
        const config = billing.getConfigStatus();
        let databaseReachable = false, schemaReady = false;
        if (process.env.DATABASE_URL) {
          try {
            const result = await db.query('SELECT version FROM ps_billing_schema_migrations WHERE version=1');
            databaseReachable = true;
            schemaReady = result.rowCount > 0;
          } catch (error) {
            console.error('[PandaStudy billing health]', error.code || 'UNAVAILABLE');
          }
        }
        return res.json({ok:true,billingEnabled:config.billingEnabled,
          financialConfigReady:config.missing.length===0,missing:config.missing,warnings:config.warnings||[],
          databaseReachable,schemaReady,schemaVersion:schemaReady?1:null});
      }
      if (action === 'profile') {
        // Account identity is useful even while purchasing is disabled or
        // temporarily unconfigured. Financial actions still call assertReady.
        const current = await http.identity(req,res,true);
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
