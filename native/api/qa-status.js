'use strict';
const auth=require('../lib/auth');
const forms=require('../lib/forms');
// OAuth proves Google identity; formResponse uses the published respondent page,
// not the editor-only Google Forms API.
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({ok:false,error:'Chỉ hỗ trợ GET.'});
 const reasons=[];
 const configured=auth.configured();
 let session=null,formId='',publicForm=null;
 if(!configured)reasons.push('Chưa cấu hình Google OAuth trên Vercel.');
 if(configured){
  try{session=await auth.session(req,res);}
  catch(e){reasons.push(e.status===401?'Cần kết nối lại Google.':'Không xác minh được phiên Google.');}
 }
 const formUrl=typeof req.query?.formUrl==='string'?req.query.formUrl.trim():'';
 if(!formUrl)reasons.push('Hãy nhập Google Form ở Bước 2.');
 else{
  try{formId=forms.formIdFromUrl(formUrl);}
  catch(e){reasons.push(e.message);}
 }
 let formAllowed=false;
 if(session&&formId){
  try{
   publicForm=await forms.loadPublicForm(formUrl);
   if(!publicForm.acceptingResponses)reasons.push('Form chưa mở nhận phản hồi công khai.');
   else if(!publicForm.questions.length)reasons.push('Form chưa có câu hỏi để gửi.');
   else if(publicForm.questions.some(q=>!q.supported))
    reasons.push('Form có câu hỏi chưa hỗ trợ: '+publicForm.questions.filter(q=>!q.supported).slice(0,2).map(q=>q.title).join(', ')+'.');
   else formAllowed=true;
  }catch(e){reasons.push(e.message||'Không mở được trang trả lời Google Form.');}
 }
 return res.status(200).json({ok:true,canSend:!!session&&formAllowed,configured,
  signedIn:!!session,formAllowed,accessMode:publicForm?.accessMode||null,
  editorVerified:false,canReadPublicSheet:true,reasons});
};
