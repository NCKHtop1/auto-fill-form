'use strict';
const auth=require('../lib/auth');
const forms=require('../lib/forms');
const qa=require('../lib/qa-submit');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Chỉ hỗ trợ GET.'});
 let loggedIn=false,email='';
 if(auth.configured()){
   try{const s=await auth.session(req,res);loggedIn=true;email=s.email||''}catch{}
 }
 let formId='';
 try{if(typeof req.query?.formUrl==='string'&&req.query.formUrl)
   formId=forms.formIdFromUrl(req.query.formUrl);}catch{}
 const on=qa.sendingConfigured();
 const allowed=!!formId&&qa.canTest(formId);
 const admin=loggedIn&&qa.allowedAdmin(email);
 const canSend=auth.configured()&&on&&allowed&&admin;
 const reasons=[];
 if(!auth.configured())reasons.push('Chưa cấu hình Google OAuth (Client ID, Client Secret, Session Secret) trên Vercel.');
 if(!on)reasons.push('Chưa bật chế độ gửi kiểm thử và danh sách Form/quản trị viên được phép.');
 if(auth.configured()&&!loggedIn)reasons.push('Cần đăng nhập tài khoản Google quản trị.');
 if(loggedIn&&!admin)reasons.push('Tài khoản Google này chưa nằm trong danh sách quản trị.');
 if(formId&&!allowed)reasons.push('Form này chưa được cho phép gửi kiểm thử.');
 return res.status(200).json({ok:true,canSend,configured:auth.configured(),
   signedIn:loggedIn,formAllowed:allowed,admin,
   canReadPublicSheet:true,reasons});
};
