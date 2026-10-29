'use strict';
const FORM_RE=/^https:\/\/docs\.google\.com\/forms\/d\/([a-zA-Z0-9_-]+)\/edit(?:[?#].*)?$/i;
function formIdFromUrl(url){const m=FORM_RE.exec(String(url||'').trim());if(!m)throw new Error('Hãy dán liên kết chỉnh sửa Google Form, kết thúc bằng /edit.');return m[1]}
function normalize(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()}
async function googleApi(path,token){const r=await fetch('https://forms.googleapis.com/v1/'+path,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)});if(!r.ok){const raw=(await r.text()).slice(0,150);const error=new Error(r.status===403?'Bạn không có quyền đọc biểu mẫu này. Hãy dùng tài khoản có quyền chỉnh sửa.':r.status===404?'Không tìm thấy Google Form.':'Không đọc được Google Form ('+r.status+').');error.status=r.status===401?401:400;throw error}return r.json()}
function readArrayLiteral(raw,assignment){const startAt=raw.indexOf(assignment);if(startAt<0)throw new Error('Google Form không cung cấp dữ liệu câu hỏi công khai.');const first=raw.indexOf('[',startAt+assignment.length);if(first<0)throw new Error('Không tìm thấy danh sách câu hỏi.');let depth=0,quoted=false,escaped=false;
 for(let i=first;i<raw.length;i++){let c=raw[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}if(c==='"'){quoted=true;continue}if(c==='[')depth++;if(c===']'){depth--;if(depth===0)return JSON.parse(raw.slice(first,i+1))}}
 throw new Error('Google Form trả về dữ liệu không đầy đủ.')}
// Public type 6 can describe an informational header (no answer fields) or a real
// checkbox grid (with answer rows). Distinguish them by structure, not code alone.
function isNonAnswerablePublicItem(item){
 const code=item?.[3];
 return [8,11,12].includes(code) || (code===6 && (!Array.isArray(item?.[4]) || item[4].length===0));
}
async function publicFormEntries(uri){let u;try{u=new URL(uri)}catch{return []}if(u.hostname!=='docs.google.com'||!u.pathname.includes('/forms/'))return [];
 const r=await fetch(u.href,{headers:{'User-Agent':'Mozilla/5.0 (compatible; PandaStudy/1.0)'},signal:AbortSignal.timeout(15000)});if(!r.ok)return [];
 const raw=await r.text();let data;try{data=readArrayLiteral(raw,'FB_PUBLIC_LOAD_DATA_')}catch{return []}
 const entries=data?.[1]?.[1];if(!Array.isArray(entries))return [];
 return entries.filter(x=>Array.isArray(x)&&!isNonAnswerablePublicItem(x)).map((p,index)=>({itemId:String(p[0]??''),title:String(p[1]||''),order:index,publicType:p[3],entryIds:Array.isArray(p[4])?p[4].map(e=>String(e?.[0]??'')).filter(x=>/^\d+$/.test(x)):[]}));
}
function fromOfficialItem(item,index){if(!item)return null;const q=item.questionItem?.question;const group=item.questionGroupItem;const base={id:String(item.itemId||index),index,title:item.title||'',helpText:item.description||'',required:!!q?.required,supported:true,options:[]};
 if(group){const questions=group.questions||[];const grid=group.grid||{};const kind=grid.columns?.type||'RADIO';return {...base,type:kind==='CHECKBOX'?'checkbox_grid':'grid',rows:questions.map(x=>x.rowQuestion?.title||''),columns:(grid.columns?.options||[]).map(o=>o.value),options:(grid.columns?.options||[]).map(o=>o.value),required:questions.some(x=>x.required)};}
 if(!q)return null;
 if(q.choiceQuestion){const c=q.choiceQuestion;return {...base,type:c.type==='CHECKBOX'?'checkbox':c.type==='DROP_DOWN'?'dropdown':'multiple_choice',options:(c.options||[]).filter(o=>!o.isOther).map(o=>o.value),allowOther:(c.options||[]).some(o=>o.isOther)}}
 if(q.textQuestion)return {...base,type:q.textQuestion.paragraph?'paragraph':'short_text'};
 if(q.scaleQuestion){let opts=[];for(let n=q.scaleQuestion.low||1;n<=Math.min(100,q.scaleQuestion.high||5);n++)opts.push(String(n));return {...base,type:'linear_scale',options:opts,lowerLabel:q.scaleQuestion.lowLabel||'',upperLabel:q.scaleQuestion.highLabel||''}}
 if(q.ratingQuestion){let opts=[];for(let n=1;n<=Math.min(100,q.ratingQuestion.ratingScaleLevel||5);n++)opts.push(String(n));return {...base,type:'rating',options:opts}}
 if(q.dateQuestion)return {...base,type:q.dateQuestion.includeTime?'datetime':'date',includesYear:q.dateQuestion.includeYear!==false};
 if(q.timeQuestion)return {...base,type:q.timeQuestion.duration?'duration':'time'};
 return {...base,type:'unsupported',supported:false,reason:'Loại câu hỏi này chưa được hỗ trợ.'};
}
function mergeEntries(qs,publicQs){const used=new Set();return qs.map(q=>{let p=publicQs.find((x,i)=>!used.has(i)&&x.itemId===q.id);if(!p){p=publicQs.find((x,i)=>!used.has(i)&&normalize(x.title)===normalize(q.title))}if(p)used.add(publicQs.indexOf(p));const needed=q.type==='grid'||q.type==='checkbox_grid'?(q.rows||[]).length:1;return {...q,entryIds:p?.entryIds||[],supported:q.supported&&!!p&&p.entryIds.length>=needed,reason:p?.entryIds?.length>=needed?q.reason||'':'Không tìm thấy trường nhập liệu trên Google Form công khai.'}})}
async function loadOwnedForm(url,token,{withCount=false}={}){const id=formIdFromUrl(url);const form=await googleApi('forms/'+encodeURIComponent(id),token);const uri=form.responderUri||`https://docs.google.com/forms/d/${encodeURIComponent(id)}/viewform`;
 let questions=(form.items||[]).map(fromOfficialItem).filter(Boolean);const published=await publicFormEntries(uri);questions=mergeEntries(questions,published);
 const info={id,title:form.info?.title||form.info?.documentTitle||'Google Form',description:form.info?.description||'',acceptingResponses:form.publishSettings?.isAcceptingResponses!==false,collectsEmail:null,limitOneResponsePerUser:null,responseCount:0,questions,responderUri:uri,unsupportedCount:questions.filter(q=>!q.supported).length,supportedCount:questions.filter(q=>q.supported).length};
 if(withCount){try{info.responseCount=await responseCount(id,token)}catch{info.responseCount=null}}return info}
async function responseCount(id,token){let count=0,tokenPage='';do{const data=await googleApi(`forms/${encodeURIComponent(id)}/responses?pageSize=500${tokenPage?'&pageToken='+encodeURIComponent(tokenPage):''}`,token);count+=(data.responses||[]).length;tokenPage=data.nextPageToken||'';if(count>200000)throw new Error('Đã vượt giới hạn đếm.')}while(tokenPage);return count}

/**
 * Read questions from a published Google Form without Google OAuth.
 * This is read-only: it does not grant edit access or visibility into responses.
 * Only public respondent pages at docs.google.com are fetched.
 */
const PUBLIC_FORM_CACHE=new Map();
const PUBLIC_FORM_TTL=45*1000;

function textValue(value){return value==null?'':String(value)}
function publicChoices(field){
 if(!Array.isArray(field?.[1]))return [];
 return field[1].map(option=>textValue(Array.isArray(option)?option[0]:option)).filter(Boolean);
}
function fromPublicItem(item,index){
 if(!Array.isArray(item)||item.length<4)return null;
 const code=item[3],fields=Array.isArray(item[4])?item[4]:[];
 // Informational sections, images and videos do not expect an answer.
 if(isNonAnswerablePublicItem(item))return null;
 const title=textValue(item[1])||'Câu hỏi '+(index+1);
 const helpText=textValue(item[2]);
 const entryIds=fields.map(f=>textValue(f?.[0])).filter(id=>/^\d+$/.test(id));
 const required=fields.some(f=>f?.[2]===1||f?.[2]===true);
 const base={id:textValue(item[0]??index),index,title,helpText,required,
   supported:true,options:[],entryIds,type:'unsupported'};
 if(code===0||code===1)base.type=code===0?'short_text':'paragraph';
 else if(code===2||code===3||code===4){
  base.type=code===2?'multiple_choice':code===3?'dropdown':'checkbox';
  base.options=publicChoices(fields[0]);
  // Detect Google's dedicated "Other" choice, if present.
  base.allowOther=Array.isArray(fields?.[0]?.[1])&&fields[0][1].some(c=>Array.isArray(c)&&c[4]===1);
 }else if(code===5){
  base.type='linear_scale';base.options=publicChoices(fields[0]);
 }else if(code===7||code===6){
  // Type 6 with entry rows is a checkbox grid; type 7 is a radio grid.
  base.type=code===7?'grid':'checkbox_grid';
  base.rows=fields.map((f,i)=>textValue(f?.[3]?.[0])||'Hàng '+(i+1));
  base.columns=publicChoices(fields[0]);
  base.options=base.columns;
  base.requiredRows=fields.map(f=>f?.[2]===1||f?.[2]===true);
  if(fields.some(f=>JSON.stringify(publicChoices(f))!==JSON.stringify(base.columns))){
   base.supported=false;
   base.reason='Các hàng có lựa chọn khác nhau; chưa thể ghép cột tự động.';
  }
 }else if(code===9){
  base.type='date';
 }else if(code===10){
  base.type='time';
 }else {
  base.supported=false;
  base.reason='Loại câu hỏi này chưa hỗ trợ.';
 }
 if(!entryIds.length){
  base.supported=false;base.reason='Không tìm thấy mã trường trả lời công khai.';
 }else if(['grid','checkbox_grid'].includes(base.type)&&entryIds.length!==base.rows.length){
  base.supported=false;base.reason='Không tìm thấy đủ trường cho các hàng trong bảng.';
 }else if(['multiple_choice','dropdown','checkbox','linear_scale','grid','checkbox_grid'].includes(base.type)&&
    !(base.type==='grid'||base.type==='checkbox_grid'?base.columns:base.options)?.length){
  base.supported=false;base.reason='Câu hỏi chưa có lựa chọn hợp lệ.';
 }
 return base;
}
// Google Forms only persists answers from pages named in pageHistory. Type 8
// denotes a page break; unlike type 6 informational headers, it changes the
// respondent page. Collect pages from the form's actual item structure, never
// guess a number of pages or blindly send pageHistory=0.
function publicPageLayout(items){
 let pageCount=1,seenSection=false,seenQuestionBeforeSection=false;
 const pageById={},sections=[],choiceItems=[];
 const published=Array.isArray(items)?items:[];
 for(const item of published){
  if(!Array.isArray(item)||item.length<4)continue;
  const code=item[3];
  if(code===8){
   // The first section header names page 0. Every later section starts a
   // new page, including informational/empty pages.
   if(seenSection||seenQuestionBeforeSection)pageCount++;
   seenSection=true;
   sections.push({id:String(item[0]??''),index:pageCount-1,next:item[5]});
   continue;
  }
  if(isNonAnswerablePublicItem(item))continue;
  const fields=Array.isArray(item[4])?item[4]:[];
  if(fields.some(f=>/^[0-9]+$/.test(String(f?.[0]??'')))){
   pageById[String(item[0]??'')]=pageCount-1;
   if(!seenSection)seenQuestionBeforeSection=true;
  }
  if(code===2||code===3){
   const options=Array.isArray(fields?.[0]?.[1])?fields[0][1]:[];
   choiceItems.push({page:pageCount-1,options});
  }
 }
 const pageForSection=new Map(sections.map(x=>[x.id,x.index]));
 // A navigation ID does not by itself mean a branch: a Form may explicitly
 // say "continue to next section". Only a confirmed jump to a nonadjacent
 // published section (or an early section submit) is a nonlinear path.
 let nonLinear=false;
 for(const section of sections){
  if(section.next==null)continue;
  const target=String(section.next);
  if(target===section.id){
   if(section.index<pageCount-1)nonLinear=true;
  }else if(pageForSection.has(target)&&pageForSection.get(target)!==section.index+1){
   nonLinear=true;
  }
 }
 for(const item of choiceItems){
  for(const option of item.options){
   const destination=Array.isArray(option)?option[2]:null;
   if(destination==null)continue;
   const target=String(destination);
   if(pageForSection.has(target) && pageForSection.get(target)!==item.page+1){
    nonLinear=true;
   }
  }
 }
 return {pageCount,pageHistory:Array.from({length:pageCount},(_,i)=>i).join(','),
  unsupportedNavigation:nonLinear||pageCount>75,pageById};
}
function parsePublicFormHtml(html,id,responderUri){
 if(typeof html!=='string'||html.length>4_000_000)throw new Error('Dữ liệu Google Form không hợp lệ.');
 let data;
 try{data=readArrayLiteral(html,'FB_PUBLIC_LOAD_DATA_')}
 catch{
  const error=new Error('Không đọc được câu hỏi công khai. Hãy bật quyền truy cập bằng liên kết trong Google Form hoặc dùng biểu mẫu được công khai.');
  error.status=403;throw error;
 }
 const meta=data?.[1];
 if(!Array.isArray(meta)||!Array.isArray(meta[1]))throw new Error('Google thay đổi cấu trúc biểu mẫu. Không đọc được danh sách câu hỏi.');
 const layout=publicPageLayout(meta[1]);
 const questions=meta[1].map(fromPublicItem).filter(Boolean).map(q=>({...q,pageIndex:layout.pageById[q.id]??0}));
 const accepts=/<form\b[^>]*\baction=["'][^"']*\/formResponse(?:["'?])/i.test(html);
 return {id,title:textValue(meta[8])||'Google Form',description:textValue(meta[0]),
   acceptingResponses:accepts,collectsEmail:null,limitOneResponsePerUser:null,responseCount:null,
   questions,responderUri,pageCount:layout.pageCount,pageHistory:layout.pageHistory,
   unsupportedNavigation:layout.unsupportedNavigation,
   unsupportedCount:questions.filter(q=>!q.supported).length,
   supportedCount:questions.filter(q=>q.supported).length,accessMode:'public'};
}
async function loadPublicForm(url){
 const id=formIdFromUrl(url);
 const cached=PUBLIC_FORM_CACHE.get(id);
 if(cached&&Date.now()-cached.at<PUBLIC_FORM_TTL)return cached.data;
 // The edit-form ID redirects to its respondent-facing published ID when public.
 const target='https://docs.google.com/forms/d/'+encodeURIComponent(id)+'/viewform';
 let response;
 try{response=await fetch(target,{
  headers:{'User-Agent':'Mozilla/5.0 (compatible; PandaStudy/1.0)','Accept':'text/html'},
  redirect:'follow',signal:AbortSignal.timeout(20000)
 })}catch{
  const error=new Error('Không kết nối được Google Forms. Hãy thử lại sau.');error.status=502;throw error;
 }
 if(!response.ok){
  const error=new Error(response.status===404?'Không tìm thấy biểu mẫu Google Form.':
    'Không đọc được biểu mẫu công khai (HTTP '+response.status+').');
  error.status=response.status===404?404:502;throw error;
 }
 const responderUri=response.url||target;
 const dest=new URL(responderUri);
 if(dest.hostname!=='docs.google.com'||!/^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]+\/viewform\/?$/.test(dest.pathname)){
  const error=new Error('Biểu mẫu yêu cầu đăng nhập hoặc chưa được công khai.');error.status=403;throw error;
 }
 const html=await response.text();
 const info=parsePublicFormHtml(html,id,responderUri);
 PUBLIC_FORM_CACHE.set(id,{at:Date.now(),data:info});
 if(PUBLIC_FORM_CACHE.size>20)PUBLIC_FORM_CACHE.delete(PUBLIC_FORM_CACHE.keys().next().value);
 return info;
}

module.exports={formIdFromUrl,readArrayLiteral,publicFormEntries,fromOfficialItem,mergeEntries,loadOwnedForm,responseCount,fromPublicItem,publicPageLayout,parsePublicFormHtml,loadPublicForm};
