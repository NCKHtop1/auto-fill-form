'use strict';
const FORM_RE=/^https:\/\/docs\.google\.com\/forms\/d\/([a-zA-Z0-9_-]+)\/edit(?:[?#].*)?$/i;
function formIdFromUrl(url){const m=FORM_RE.exec(String(url||'').trim());if(!m)throw new Error('Hãy dán liên kết chỉnh sửa Google Form, kết thúc bằng /edit.');return m[1]}
function normalize(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()}
async function googleApi(path,token){const r=await fetch('https://forms.googleapis.com/v1/'+path,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(15000)});if(!r.ok){const raw=(await r.text()).slice(0,150);const error=new Error(r.status===403?'Bạn không có quyền đọc biểu mẫu này. Hãy dùng tài khoản có quyền chỉnh sửa.':r.status===404?'Không tìm thấy Google Form.':'Không đọc được Google Form ('+r.status+').');error.status=r.status===401?401:400;throw error}return r.json()}
function readArrayLiteral(raw,assignment){const startAt=raw.indexOf(assignment);if(startAt<0)throw new Error('Google Form không cung cấp dữ liệu câu hỏi công khai.');const first=raw.indexOf('[',startAt+assignment.length);if(first<0)throw new Error('Không tìm thấy danh sách câu hỏi.');let depth=0,quoted=false,escaped=false;
 for(let i=first;i<raw.length;i++){let c=raw[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}if(c==='"'){quoted=true;continue}if(c==='[')depth++;if(c===']'){depth--;if(depth===0)return JSON.parse(raw.slice(first,i+1))}}
 throw new Error('Google Form trả về dữ liệu không đầy đủ.')}
async function publicFormEntries(uri){let u;try{u=new URL(uri)}catch{return []}if(u.hostname!=='docs.google.com'||!u.pathname.includes('/forms/'))return [];
 const r=await fetch(u.href,{headers:{'User-Agent':'Mozilla/5.0 (compatible; PandaStudy/1.0)'},signal:AbortSignal.timeout(15000)});if(!r.ok)return [];
 const raw=await r.text();let data;try{data=readArrayLiteral(raw,'FB_PUBLIC_LOAD_DATA_')}catch{return []}
 const entries=data?.[1]?.[1];if(!Array.isArray(entries))return [];
 return entries.filter(x=>Array.isArray(x)).map((p,index)=>({itemId:String(p[0]??''),title:String(p[1]||''),order:index,publicType:p[3],entryIds:Array.isArray(p[4])?p[4].map(e=>String(e?.[0]??'')).filter(x=>/^\d+$/.test(x)):[]}));
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
module.exports={formIdFromUrl,readArrayLiteral,publicFormEntries,fromOfficialItem,mergeEntries,loadOwnedForm,responseCount};
