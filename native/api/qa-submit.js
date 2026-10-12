'use strict';
const auth=require('../lib/auth');
const forms=require('../lib/forms');
const qa=require('../lib/qa-submit');
function fail(res,status,msg){return res.status(status).json({ok:false,error:msg})}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return fail(res,405,'Chỉ hỗ trợ POST.');
 try{
  if(req.headers.origin&&req.headers.origin!==auth.origin(req))
   return fail(res,403,'Yêu cầu không cùng tên miền.');
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body;
  if(!b||typeof b.formUrl!=='string'||!b.answers||b.confirmedTestOnly!==true)
   return fail(res,400,'Thiếu Form, dữ liệu hoặc xác nhận biểu mẫu kiểm thử.');
  if(!auth.configured())return fail(res,503,'Chưa cấu hình Google OAuth.');
  const session=await auth.session(req,res);
  const form=await forms.loadOwnedForm(b.formUrl,session.access_token);
  await forms.verifyResponseAccess(form.id,session.access_token);
  if(!qa.formReady(form))return fail(res,400,'Form không nhận phản hồi hoặc có câu hỏi chưa hỗ trợ.');
  const outcome=await qa.sendOne({form,answers:b.answers});
  return res.status(200).json({ok:true,...outcome});
 }catch(e){
  console.error('[PandaStudy QA]',e.status||400,e.message);
  return fail(res,e.status>=400&&e.status<=500?e.status:400,e.message||'Gửi thất bại.');
 }
};