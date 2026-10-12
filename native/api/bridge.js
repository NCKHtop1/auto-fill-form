'use strict';
const crypto=require('node:crypto');
const auth=require('../lib/auth');const form=require('../lib/forms');const validate=require('../lib/validation');
const MAX_PER_CALL=50;
function fail(res,status,message){return res.status(status).json({ok:false,error:message})}
async function qaSubmit(uri,questions,answers){
 const dest=new URL(uri);if(dest.hostname!=='docs.google.com'||!dest.pathname.endsWith('/viewform'))throw new Error('Google Form chưa công khai để nhận phản hồi.');
 dest.pathname=dest.pathname.replace(/\/viewform$/,'/formResponse');
 const p=validate.fields(questions,answers);p.set('fvv','1');p.set('pageHistory','0');p.set('submit','Submit');
 const response=await fetch(dest.href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','User-Agent':'Mozilla/5.0','Referer':uri},body:p.toString(),redirect:'follow',signal:AbortSignal.timeout(20000)});
 const text=(await response.text()).slice(0,300000);if(!response.ok)throw new Error('Google Forms báo lỗi HTTP '+response.status);
 if(!/Your response has been recorded|Your response was recorded|Câu trả lời của bạn đã được ghi lại|Phản hồi của bạn đã được ghi lại|Submit another response|Gửi câu trả lời khác/i.test(text)){
  throw new Error('Google chưa xác nhận đã nhận phản hồi. Hãy xem trực tiếp Google Form trước khi thử lại; không tự động gửi lặp để tránh trùng dữ liệu.');
 }
 return {status:'sent',responseId:'',timestamp:new Date().toISOString(),editResponseUrl:'',note:'Được trang xác nhận của Google Forms ghi nhận; chưa có response ID qua API chính thức.'}
}
// Public questionnaire import and read-only validation are available without OAuth.
// Owner-only operations remain authenticated and disabled unless explicitly enabled.
async function accessibleForm(url,req,res,{withCount=false}={}){
 const id=form.formIdFromUrl(url); // Reject invalid URLs before any external request.
 if(auth.configured()){
  try{
   const current=await auth.session(req,res);
   return await form.loadOwnedForm(url,current.access_token,{withCount});
  }catch(e){
   // If not signed in or not the editor of this form, published questions can still be read.
   // Never use this fallback to send responses or obtain private response counts.
   console.info('[PandaStudy] Official Form API unavailable; trying public respondent page:',id);
  }
 }
 return form.loadPublicForm(url);
}
module.exports=async function handler(req,res){
 if(req.method!=='POST')return fail(res,405,'Chỉ hỗ trợ POST.');
 res.setHeader('Cache-Control','no-store');
 const origin=req.headers.origin;
 if(origin&&origin!==auth.origin(req))return fail(res,403,'Yêu cầu không cùng tên miền.');
 let body=req.body;
 if(typeof body==='string'){try{body=JSON.parse(body)}catch{}}
 const name=String(body?.name||'');
 const args=Array.isArray(body?.args)?body.args:[];
 const known=['getBillingProfile','createTopupOrder','getTopupOrderStatus','beginPaidRun','finalizePaidRun',
  'importOwnedForm','validatePlan','getLiveResponseCount','submitOneResponse',
  'createScheduledQaRun','getScheduledQaRuns','cancelScheduledQaRun','deleteScheduledQaRun'];
 if(!known.includes(name))return fail(res,400,'Chức năng không tồn tại.');
 try{
  if(name==='getBillingProfile')return res.json({billingEnabled:false,configured:true,
   email:'',availableCredits:1000000,reservedCredits:0,unitPriceVnd:0,
   minTopupCredits:0,availableValueVnd:0,mode:'no_billing'});
  if(name==='getScheduledQaRuns')return res.json([]);
  if(name==='finalizePaidRun')return res.json({releasedCredits:0,freeMode:true});
  if(name==='createTopupOrder'||name==='getTopupOrderStatus')
   return fail(res,400,'Chức năng thanh toán chưa được chuyển sang Vercel.');
  if(name==='createScheduledQaRun'||name==='cancelScheduledQaRun'||name==='deleteScheduledQaRun')
   return fail(res,400,'Lịch chạy nền chưa hỗ trợ. Hãy dùng chế độ Gửi ngay nếu được phép và giữ trang mở.');
  if(name==='beginPaidRun'){
   if(process.env.ENABLE_QA_SUBMISSIONS!=='true')
    return fail(res,403,'Chức năng gửi trực tiếp chưa được bật.');
   if(!auth.configured())
    return fail(res,403,'Gửi phản hồi thật yêu cầu xác minh quyền chỉnh sửa biểu mẫu.');
   await auth.session(req,res);
   const count=Number(args[0]);
   if(!Number.isInteger(count)||count<1||count>MAX_PER_CALL)
    return fail(res,400,'Mỗi lô phải có từ 1 đến 50 phản hồi.');
   return res.json({reservationId:'QA-'+crypto.randomUUID(),reservedCredits:count,freeMode:true});
  }
  const url=args[0];
  if(name==='importOwnedForm'||name==='validatePlan'||name==='getLiveResponseCount'){
   const f=await accessibleForm(url,req,res,{withCount:name!=='validatePlan'});
   if(name==='importOwnedForm'){
    const {responderUri,...safe}=f;
    return res.json(safe);
   }
   if(name==='getLiveResponseCount')
    return res.json({title:f.title,count:f.responseCount,
      acceptingResponses:f.acceptingResponses,available:f.responseCount!==null});
   if(name==='validatePlan'){
    const rows=args[1];
    if(!Array.isArray(rows)||rows.length<1||rows.length>MAX_PER_CALL)
     return fail(res,400,'Mỗi lần kiểm tra nhận tối đa 50 dòng.');
    const results=rows.map((row,i)=>{
     const issues=validate.validate(f.questions,row?.answers||row);
     return {index:i+1,valid:!issues.length,issues};
    });
    return res.json({valid:results.every(x=>x.valid),total:results.length,
     invalid:results.filter(x=>!x.valid).length,results});
   }
  }
  if(name==='submitOneResponse'){
   if(process.env.ENABLE_QA_SUBMISSIONS!=='true')
    return fail(res,403,'Chức năng gửi trực tiếp đang tắt.');
   if(!auth.configured())
    return fail(res,403,'Không thể gửi phản hồi nếu chưa xác minh quyền chỉnh sửa biểu mẫu.');
   if(args[2]!==true)
    return fail(res,403,'Cần xác nhận quyền sở hữu hoặc được phép kiểm thử biểu mẫu.');
   const current=await auth.session(req,res);
   // Editing permission is enforced by the official API, never by the public page.
   const f=await form.loadOwnedForm(url,current.access_token);
   if(!f.acceptingResponses)return fail(res,400,'Biểu mẫu không nhận phản hồi.');
   const answers=args[1];
   const issues=validate.validate(f.questions,answers);
   if(issues.length)return fail(res,400,issues.join(' | '));
   if(!f.questions.length||f.questions.some(q=>q.required&&!q.supported))
    return fail(res,400,'Biểu mẫu có câu hỏi bắt buộc chưa hỗ trợ.');
   return res.json(await qaSubmit(f.responderUri,f.questions,answers));
  }
  return fail(res,400,'Chưa hỗ trợ.');
 }catch(e){
  console.error('[PandaStudy]',name,e.message);
  return fail(res,e.status||500,e.message||'Có lỗi khi xử lý Google Form.');
 }
};
