'use strict';
const auth=require('../lib/auth');
const forms=require('../lib/forms');
const qa=require('../lib/qa-submit');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Chỉ hỗ trợ GET.'});
 const reasons=[];
 let signedIn=false,email='',formAllowed=false,admin=false,formReady=false;
 const configured=auth.configured();
 if(!configured)reasons.push('Chưa cấu hình đăng nhập Google.');
 let session=null;
 if(configured){try{session=await auth.session(req,res);signedIn=true;email=session.email||'';}catch{reasons.push('Hãy kết nối tài khoản Google.');}}
 let formUrl=typeof req.query?.formUrl==='string'?req.query.formUrl:'';
 if(!formUrl)reasons.push('Hãy nhập đường dẫn chỉnh sửa Google Form.');
 if(formUrl&&session){
  try{
   const form=await forms.loadOwnedForm(formUrl,session.access_token);
   // Also require access to the response dataset, not merely a readable questionnaire.
   await forms.verifyResponseAccess(form.id,session.access_token);
   admin=true;formAllowed=true;formReady=qa.formReady(form);
   if(!formReady)reasons.push('Form không nhận phản hồi hoặc có dạng câu hỏi chưa hỗ trợ.');
  }catch(e){reasons.push(e.message||'Tài khoản chưa được Google cấp quyền chỉnh sửa Form và xem phản hồi.');}
 }
 const canSend=configured&&signedIn&&formAllowed&&formReady;
 return res.status(200).json({ok:true,canSend,configured,signedIn,formAllowed,admin,
   formReady,canReadPublicSheet:true,reasons});
};