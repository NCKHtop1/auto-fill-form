'use strict';
const billing = require('../lib/billing');
const http = require('../lib/billing-http');

module.exports = async function handler(req,res) {
  http.headers(res);
  if (!['GET','POST'].includes(req.method)) return http.method(res,'GET, POST');
  try {
    const current = await http.identity(req,res);
    billing.requireAdmin(current);
    if (req.method === 'GET') {
      if (req.query?.resource === 'users')
        return res.json({ok:true,users:await billing.listAdminUsers(current,{search:req.query?.search || ''})});
      if (req.query?.resource === 'metrics')
        return res.json({ok:true,metrics:await billing.listAdminMetrics(current)});
      if (req.query?.resource === 'commerce')
        return res.json({ok:true,commerce:await billing.listAdminCommerce(current)});
      return res.json({ok:true,...await billing.listAdminTopups(current,
        {status:req.query?.status || 'pending_review',orderId:req.query?.orderId})});
    }
    const input = http.body(req);
    if (input.action === 'approve') return res.json({ok:true,order:await billing.approveOrder(current,input)});
    if (input.action === 'reject') return res.json({ok:true,order:await billing.rejectOrder(current,input)});
    if (input.action === 'resolveOperation') return res.json({ok:true,operation:await billing.resolveOperation(current,input)});
    if (input.action === 'savePackage') return res.json({ok:true,package:await billing.saveAdminPackage(current,input)});
    if (input.action === 'savePromotion') return res.json({ok:true,promotion:await billing.saveAdminPromotion(current,input)});
    throw new billing.BillingError(400,'UNKNOWN_ACTION','Chức năng không tồn tại.');
  } catch (error) { return http.error(res,error); }
};
