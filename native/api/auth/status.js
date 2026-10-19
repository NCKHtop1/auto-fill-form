'use strict';
const auth=require('../../lib/auth');
function isAdminEmail(email){
  const allowed=String(process.env.BILLING_ADMIN_EMAILS||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
  return !!email && allowed.includes(String(email).toLowerCase());
}
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  let signedIn=false,email='';
  if(auth.configured()){
    try{
      const s=await auth.session(req,res);
      signedIn=true;
      email=s.email||'';
    }catch{}
  }
  res.status(200).json({
    configured:auth.configured(),signedIn,email,isAdmin:isAdminEmail(email),
    submissionEnabled:process.env.ENABLE_QA_SUBMISSIONS==='true',
    schedulingEnabled:false,billingEnabled:process.env.BILLING_ENABLED==='true'
  });
};
