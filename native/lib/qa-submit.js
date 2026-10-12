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
function formReady(form) {
  if(!form || !form.acceptingResponses || !Array.isArray(form.questions) || !form.questions.length)
    return false;
  return form.questions.every(q=>{
    if(!q.supported || !ALLOWED_TYPES.has(q.type) || !Array.isArray(q.entryIds))return false;
    const needed=['grid','checkbox_grid'].includes(q.type)?(q.rows||[]).length:1;
    return needed>0 && q.entryIds.length>=needed;
  });
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

const HIDDEN_FORM_KEYS = new Set(['fbzx','fvv','partialResponse','pageHistory','submissionTimestamp']);
function decodeAttribute(value){
 return String(value||'').replace(/&(?:amp|quot|apos|lt|gt|#x[0-9a-f]+|#[0-9]+);/gi, entity => {
   const low=entity.toLowerCase();
   const basic={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'};
   if(Object.prototype.hasOwnProperty.call(basic,low))return basic[low];
   if(low.startsWith('&#x'))return String.fromCodePoint(parseInt(low.slice(3,-1),16));
   if(low.startsWith('&#'))return String.fromCodePoint(parseInt(low.slice(2,-1),10));
   return entity;
 });
}
function hiddenFormValues(html){
 if(typeof html!=='string'||html.length>3000000)throw new Error('Trang Google Form quá lớn hoặc không hợp lệ.');
 const fields=new Map();
 const input=/<input\b[^>]{0,12000}>/gi;
 const attr=/([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
 for(const match of html.matchAll(input)){
   const attributes=new Map();
   attr.lastIndex=0;
   for(const a of match[0].matchAll(attr)){
     attributes.set(a[1].toLowerCase(),decodeAttribute(a[2]??a[3]??a[4]??''));
   }
   if(attributes.get('type')!=='hidden')continue;
   const name=attributes.get('name');
   if(HIDDEN_FORM_KEYS.has(name))fields.set(name,attributes.get('value')||'');
 }
 if(!fields.has('fbzx')||!fields.get('fbzx'))
   throw new Error('Google Form không cung cấp mã phiên fbzx. Chưa gửi dữ liệu để tránh lỗi.');
 if(!fields.has('partialResponse'))
   throw new Error('Google Form không cung cấp trạng thái phiên điền biểu mẫu. Chưa gửi dữ liệu.');
 return fields;
}
function googleRespondentPage(url){
 const u=new URL(url);
 return u.protocol==='https:'&&u.hostname==='docs.google.com'&&
   /^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform\/?$/.test(u.pathname);
}
async function sendOne({form,answers,fetchImpl=fetch}) {
 const body=prepareFields(form,answers);
 const destination=responseUrl(form.responderUri);
 let context;
 try{
   context=await fetchImpl(form.responderUri,{method:'GET',redirect:'follow',
     headers:{'User-Agent':'Mozilla/5.0 (compatible; PandaStudy-QA/1.0)','Accept':'text/html'},
     signal:AbortSignal.timeout(18000)});
 }catch{
   return {status:'failed',note:'Không đọc được phiên Google Form trước khi gửi; chưa gửi câu trả lời.'};
 }
 if(!context.ok||!googleRespondentPage(context.url||form.responderUri))
   return {status:'failed',note:'Biểu mẫu yêu cầu quyền truy cập hoặc không mở cho người trả lời công khai. Chưa gửi câu trả lời.'};
 let hidden;
 try{hidden=hiddenFormValues(await context.text());}
 catch(e){return {status:'failed',note:e.message};}
 for(const [key,value] of hidden.entries())body.set(key,value);
 if(!body.has('fvv'))body.set('fvv','1');
 if(!body.has('pageHistory'))body.set('pageHistory','0');
 body.set('submit','Submit');
 let response;
 try{
   response=await fetchImpl(destination,{
     method:'POST',redirect:'follow',
     headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8',
       'Referer':form.responderUri,
       'User-Agent':'Mozilla/5.0 (compatible; PandaStudy-QA/1.0)'},
     body:body.toString(),signal:AbortSignal.timeout(20000)
   });
 }catch{
   return {status:'unverified',note:'Mất kết nối khi gửi. Có thể đã ghi, không tự gửi lại để tránh trùng.'};
 }
 if(!response.ok)return {status:'failed',note:'Google trả về lỗi HTTP '+response.status+'. Cần kiểm tra trước khi gửi tiếp.'};
 let final;
 try{final=new URL(response.url||destination);}
 catch{return {status:'unverified',note:'Không xác định được nơi Google chuyển hướng sau khi gửi.'};}
 if(final.hostname!=='docs.google.com'||!final.pathname.endsWith('/formResponse'))
   return {status:'unverified',note:'Google không chuyển đến trang xác nhận phản hồi. Cần kiểm tra Form/Sheet.'};
 let resultHtml='';
 try{resultHtml=(await response.text()).slice(0,250000);}
 catch{return {status:'unverified',note:'Không đọc được trang xác nhận. Không tự gửi lại.'};}
 if(!CONFIRMATION.test(resultHtml))
   return {status:'unverified',note:'Không thấy thông báo Google đã nhận. Kiểm tra số phản hồi trước khi thử lại.'};
 return {status:'page-confirmed',receivedAt:new Date().toISOString(),
   note:'Google Form hiện trang xác nhận đã nhận. Hãy đối chiếu tổng phản hồi trước và sau.'};
}

module.exports={parseAllowlist,allowedAdmin,canTest,sendingConfigured,responseUrl,formReady,prepareFields,hiddenFormValues,sendOne};
