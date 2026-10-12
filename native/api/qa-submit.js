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
    if(!b||typeof b.formUrl!=='string'||!b.answers||
       b.confirmedTestOnly!==true)
      return fail(res,400,'Thiếu Form, dữ liệu hoặc xác nhận biểu mẫu kiểm thử.');
    const id=forms.formIdFromUrl(b.formUrl);
    if(!qa.canTest(id))
      return fail(res,403,'Chức năng gửi chưa bật hoặc Form chưa thuộc danh sách kiểm thử được cho phép.');
    if(!auth.configured())
      return fail(res,503,'Chưa cấu hình Google OAuth trên Vercel.');
    const session=await auth.session(req,res);
    if(!qa.allowedAdmin(session.email))
      return fail(res,403,'Tài khoản Google này không có quyền gửi kiểm thử.');
    // Only the owner/editor may use the respondent submission bridge.
    const f=await forms.loadOwnedForm(b.formUrl,session.access_token);
    if(!f.questions.length||f.questions.some(q=>!q.supported))
      return fail(res,400,'Form có câu hỏi chưa hỗ trợ gửi.');
    const outcome=await qa.sendOne({form:f,answers:b.answers});
    return res.status(200).json({ok:true,...outcome});
  }catch(e){
    console.error('[PandaStudy QA]',e.status||400,e.message);
    return fail(res,e.status>=400&&e.status<=500?e.status:400,e.message||'Gửi thất bại.');
  }
};
