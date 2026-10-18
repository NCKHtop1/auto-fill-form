'use strict';
const auth=require('../lib/auth');
const forms=require('../lib/forms');
const qa=require('../lib/qa-submit');
const billing=require('../lib/billing');
const {submitWithCredits}=require('../lib/billed-submit');
function fail(res,status,msg,code){return res.status(status).json({ok:false,error:msg,delivery:'not_sent',...(code?{code}:{} )});}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return fail(res,405,'Chỉ hỗ trợ POST.');
 let billingPhase=false;
 try{
  if(req.headers.origin&&req.headers.origin!==auth.origin(req))
   return fail(res,403,'Yêu cầu không cùng tên miền.');
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!b||typeof b.formUrl!=='string'||!b.answers||b.confirmedTestOnly!==true)
   return fail(res,400,'Thiếu Form, dữ liệu hoặc xác nhận chỉ gửi vào Form kiểm thử.');
  forms.formIdFromUrl(b.formUrl);
  if(!auth.configured())return fail(res,503,'Chưa cấu hình Google OAuth trên Vercel.');
  const session=await auth.session(req,res);
  const identity=billing.enabled()?await auth.billingIdentity(req,res,session):null;
  // Read and submit the same published form as a respondent; Forms API
  // forms.get may return 403, and it has no create-response method.
  const f=await forms.loadPublicForm(b.formUrl);
  if(!f.acceptingResponses)return fail(res,409,'Google Form chưa mở nhận phản hồi.');
  if(!f.questions.length||f.questions.some(q=>!q.supported))
   return fail(res,400,'Form có câu hỏi chưa hỗ trợ gửi hoặc chưa được xuất bản.');
  billingPhase=!!identity;
  const outcome=identity?await submitWithCredits({identity,form:f,answers:b.answers,operationId:b.operationId}):
   await qa.sendOne({form:f,answers:b.answers});
  return res.status(200).json({ok:true,...outcome});
 }catch(e){
  if(billingPhase&&!(e instanceof billing.BillingError)){
   console.error('[PandaStudy billing submit] BILLING_UNAVAILABLE');
   return fail(res,503,'Dịch vụ số lượt đang tạm gián đoạn. Chưa gửi dòng này; hãy kiểm tra số dư rồi thử lại.','BILLING_UNAVAILABLE');
  }
  console.error('[PandaStudy QA]',e.status||400,e.message);
  return fail(res,e.status>=400&&e.status<=599?e.status:400,e.message||'Gửi thất bại.',e.code);
 }
};
