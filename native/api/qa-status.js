'use strict';
const auth=require('../lib/auth');
const forms=require('../lib/forms');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Chỉ hỗ trợ GET.'});
 const reasons=[];
 const configured=auth.configured();
 let signedIn=false,formAllowed=false,formId='',email='';
 if(!configured)reasons.push('Chưa cấu hình Google OAuth trên Vercel.');
 let session=null;
 if(configured){try{session=await auth.session(req,res);signedIn=true;email=session.email||'';}catch(e){reasons.push(e.status===401?'Cần kết nối lại tài khoản Google.':'Không xác minh được phiên Google.');}}
 try{
  if(typeof req.query?.formUrl==='string'&&req.query.formUrl)
   formId=forms.formIdFromUrl(req.query.formUrl);
  else reasons.push('Cần nhập liên kết chỉnh sửa Google Form ở bước 2.');
 }catch(e){reasons.push(e.message);}
 if(session&&formId){
  try{
   const f=await forms.loadOwnedForm(req.query.formUrl,session.access_token);
   if(!f.acceptingResponses)reasons.push('Google Form chưa bật nhận phản hồi.');
   else if(!f.questions.length)reasons.push('Biểu mẫu chưa có câu hỏi để gửi.');
   else if(f.questions.some(q=>!q.supported))reasons.push('Biểu mẫu có câu hỏi chưa hỗ trợ hoặc chưa xuất bản.');
   else formAllowed=true;
  }catch(e){reasons.push(e.message||'Tài khoản Google không đọc được Form này. Hãy dùng tài khoản có quyền chỉnh sửa.');}
 }
 const canSend=configured&&signedIn&&formAllowed;
 return res.status(200).json({ok:true,canSend,configured,signedIn,formAllowed,admin:signedIn,
  canReadPublicSheet:true,reasons});
};
