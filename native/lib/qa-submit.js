'use strict';
// QA submissions only: never mistake preview validation for a submitted response.
const forms = require('./forms');
const validate = require('./validation');

const CONFIRMATION = /Your response (?:has been|was) recorded|Câu trả lời của bạn đã được ghi lại|Phản hồi của bạn đã được ghi lại|Submit another response|Gửi câu trả lời khác/i;
const ALLOWED_TYPES = new Set(['multiple_choice','dropdown','checkbox','linear_scale','grid','checkbox_grid','short_text','paragraph','date','time']);

function parseAllowlist(value) {
  return new Set(String(value || '').split(',').map(x=>x.trim()).filter(x=>/^[A-Za-z0-9_-]{3,200}$/.test(x)));
}
function allowedAdmin(email,env=process.env) {
  return String(env.PANDASTUDY_ADMIN_EMAILS || '').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean).includes(String(email||'').toLowerCase());
}
function canTest(id,env=process.env) {
  return env.ENABLE_QA_SUBMISSIONS === 'true' && parseAllowlist(env.PANDASTUDY_TEST_FORM_IDS).has(id);
}
function sendingConfigured(env=process.env) {
  return env.ENABLE_QA_SUBMISSIONS === 'true' &&
    parseAllowlist(env.PANDASTUDY_TEST_FORM_IDS).size > 0 &&
    String(env.PANDASTUDY_ADMIN_EMAILS||'').trim().length > 0;
}
function responseUrl(responderUri) {
  const url = new URL(responderUri);
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com' ||
      !/^\/forms\/d\/(?:e\/)?[a-zA-Z0-9_-]+\/viewform\/?$/.test(url.pathname))
    throw new Error('Không tìm thấy trang gửi phản hồi hợp lệ.');
  url.pathname=url.pathname.replace(/\/viewform\/?$/, '/formResponse');
  url.search='';url.hash='';
  return url.toString();
}
function prepareFields(form,answers) {
  if (!form || !Array.isArray(form.questions) || !form.questions.length)
    throw new Error('Không đọc được câu hỏi Google Form.');
  if (!form.acceptingResponses) throw new Error('Google Form hiện không nhận phản hồi.');
  if (form.questions.some(q=>!q.supported||!ALLOWED_TYPES.has(q.type)))
    throw new Error('Google Form có câu hỏi chưa hỗ trợ gửi tự động.');
  const issues=validate.validate(form.questions,answers);
  if (issues.length) throw new Error('Dữ liệu không hợp lệ: '+issues.join(' | '));
  const params=validate.fields(form.questions,answers);
  if(!Array.from(params.keys()).some(k=>k.startsWith('entry.')))
    throw new Error('Không có trường trả lời nào được điền.');
  return params;
}
async function sendOne({form,answers,fetchImpl=fetch}) {
  const body=prepareFields(form,answers);
  const destination=responseUrl(form.responderUri);
  body.set('fvv','1');body.set('pageHistory','0');body.set('submit','Submit');
  let r;
  try {
    r=await fetchImpl(destination,{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',
        Referer:form.responderUri,'User-Agent':'Mozilla/5.0 (compatible; PandaStudy-QA/1.0)'},
      body:body.toString(),redirect:'follow',signal:AbortSignal.timeout(20000)
    });
  } catch {
    return {status:'unverified',note:'Mất kết nối trong lúc gửi. Không tự gửi lại vì có thể trùng.'};
  }
  if (!r.ok) return {status:'failed',note:'Google trả lỗi HTTP '+r.status};
  if (r.url) {
    try {
      const final=new URL(r.url);
      if(final.hostname!=='docs.google.com')
        return {status:'unverified',note:'Google chuyển sang trang khác; chưa thể xác nhận kết quả.'};
    } catch {return {status:'unverified',note:'Không kiểm tra được trang trả về.'};}
  }
  let text='';
  try {text=(await r.text()).slice(0,250000);}
  catch {return {status:'unverified',note:'Đã gửi nhưng không đọc được trang xác nhận.'};}
  if (!CONFIRMATION.test(text))
    return {status:'unverified',note:'Chưa nhận được xác nhận từ Google; không tự gửi lại.'};
  return {status:'page-confirmed',receivedAt:new Date().toISOString(),
    note:'Trang Google Form báo đã nhận. Cần đối chiếu số phản hồi trên Form/Sheet.'};
}
module.exports={parseAllowlist,allowedAdmin,canTest,sendingConfigured,responseUrl,prepareFields,sendOne};
