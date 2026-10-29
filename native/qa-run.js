/* PandaStudy: consented published-Form submissions, no automatic retries. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const wait=ms=>new Promise(done=>setTimeout(done,ms));
let state={working:false,attempted:new Set(),operations:{},history:[],before:null,after:null,source:'',runKey:'',stopped:false,contextChanged:false};
let permissionVersion=0,permissionTimer=null;

function node(tag,klass,label){
 const el=document.createElement(tag);
 if(klass)el.className=klass;
 if(label!==undefined)el.textContent=label;
 return el;
}
function status(message,error=false){
 const el=$('qaRunMessage');if(!el)return;
 el.textContent=message;el.className='workflow-result'+(error?' is-error':'');
 el.hidden=!message;
}
function billingNote(profile=window.PandaBilling?.getProfile()){
 const el=$('qaBillingNotice');if(!el)return;
 el.hidden=!profile?.billingEnabled;
 if(!el.hidden)el.textContent='Mỗi dòng Google báo nhận dùng 1 phiếu ('+Number(profile.unitPriceVnd||500).toLocaleString('vi-VN')+' đ/phiếu). Kết quả chưa rõ được giữ phiếu để đối chiếu.';
}
function actionUrl(){
 return '/api/qa-verify';
}
async function post(url,data){
 const response=await fetch(url,{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const out=await response.json().catch(()=>({}));
 if(!response.ok){const error=Error(out.error||'Máy chủ trả lỗi '+response.status);error.status=response.status;error.delivery=out.delivery;error.code=out.code;throw error;}
 return out;
}
function providerLabel(){
 return state.source==='google-forms-api'?'Google Forms API':
  state.source==='google-sheet-public-csv'?'Google Sheet công khai':'Chưa kết nối';
}
function updateCounts(){
 // Keep idle counters hidden; show after send or verification.
 $('qaRunCounters').hidden=state.history.length===0&&state.before===null&&state.after===null;
 const accepted=state.history.filter(h=>h.status==='page-confirmed').length;
 const failed=state.history.filter(h=>h.status==='failed').length;
 const uncertain=state.history.filter(h=>h.status==='unverified').length;
 const delta=state.before===null||state.after===null?'—':state.after-state.before;
 $('qaRunCounters').textContent=
  'Đã nhận: '+accepted+' · Lỗi: '+failed+
  ' · Chưa rõ: '+uncertain+' · Trước: '+
  (state.before??'—')+' · Sau: '+(state.after??'—')+
  ' · Tăng: '+delta+' · '+providerLabel();
 $('qaRunExport').disabled=state.history.length===0;
 $('qaRunStartOne').disabled=state.working||state.stopped||$('qaRunStartOne').dataset.allowed!=='true';
 $('qaRunStartAll').disabled=state.working||state.stopped||$('qaRunStartAll').dataset.allowed!=='true';
 $('qaRunVerify').disabled=state.working;
}
function makeKey(){
 const bridge=window.PandaStudyQA;
 if(!bridge)return '';
 const raw=JSON.stringify({url:bridge.getUrl(),rows:bridge.getRows().map(r=>r.answers)});
 // Fingerprint is only used for duplicate-warning UX; it is not security/auth.
 let hash=2166136261;
 for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619);}
 return 'pandastudy-qa-attempt:'+((hash>>>0).toString(16));
}
function recoverAttempts(){
 state.runKey=makeKey();
 try{
  const record=JSON.parse(sessionStorage.getItem(state.runKey)||'{}');
  state.operations=record.operations&&typeof record.operations==='object'?record.operations:{};
  const old=Array.isArray(record.attempted)?record.attempted:[];
  old.forEach(n=>state.attempted.add(Number(n)));
  if(old.length)status('Đã thực hiện '+old.length+' lượt gửi trong phiên này. Kiểm tra kết quả trước khi gửi tiếp.',true);
 }catch{}
}
function rememberAttempt(index){
 state.attempted.add(index);
 if(!state.operations[index]){
  if(crypto.randomUUID)state.operations[index]=crypto.randomUUID();
  else{
   const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
   const hex=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
   state.operations[index]=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  }
 }
 saveAttempts();
 return state.operations[index];
}
function saveAttempts(){
 try{sessionStorage.setItem(state.runKey,
  JSON.stringify({attempted:Array.from(state.attempted),operations:state.operations,at:new Date().toISOString()}));}catch{}
}
async function permission(){
 const version=++permissionVersion;
 const bridge=window.PandaStudyQA;
 const q=bridge?'?formUrl='+encodeURIComponent(bridge.getUrl()):'';
 let data;
 try{
  const resp=await fetch('/api/qa-status'+q,{credentials:'same-origin',cache:'no-store'});
  data=await resp.json();
 }catch{data={canSend:false,reasons:['Không tải được trạng thái kết nối Google.']};}
 if(version!==permissionVersion)return false;
 const warning=(data.reasons||[])[0]||'Không đọc được Form.';
 const note=!data.configured?'Chưa cấu hình Google.':
  !data.signedIn?'Kết nối Google để gửi.':
  !bridge?.getUrl()?'Nhập Google Form ở bước 2.':
  /không có quyền đọc biểu mẫu|quyền chỉnh sửa/i.test(warning)
   ?'Không đọc được Form. Kiểm tra liên kết hoặc quyền truy cập.':warning;
 $('qaConfigStatus').textContent=data.canSend?'':note;
 $('qaConfigStatus').hidden=!!data.canSend||!bridge?.getUrl();
 $('qaRunStartOne').dataset.allowed=String(!!data.canSend);
 $('qaRunStartAll').dataset.allowed=String(!!data.canSend);
 // Buttons show state but sending also checks permission at click time.
 $('qaRunStartOne').disabled=!data.canSend;
 $('qaRunStartAll').disabled=!data.canSend;
 if(!data.configured)$('qaConnectBtn').hidden=true;
 else $('qaConnectBtn').hidden=!!data.signedIn;
 updateCounts();
 return !!data.canSend;
}
async function verify(isInitial=false,formUrl){
 const bridge=window.PandaStudyQA;
 if(!bridge?.getUrl())throw Error('Dán Google Form ở Bước 2 trước.');
 const result=await post(actionUrl(),{
  formUrl:formUrl||bridge.getUrl(),sheetUrl:$('qaSheetUrl').value.trim()||undefined});
 if(isInitial){state.before=result.count;state.source=result.source;}
 else{state.after=result.count;state.source=result.source;}
 updateCounts();
 return result;
}
function updateReport(){
 updateCounts();
 const confirmed=state.history.filter(x=>x.status==='page-confirmed').length;
 if(state.before!=null&&state.after!=null){
  const delta=state.after-state.before;
  if(delta===confirmed && confirmed>0)status(
   'Đối chiếu số lượng khớp: '+confirmed+' lượt có trang Google xác nhận, '+providerLabel()+' tăng '+delta+
   '. Đây chỉ là số phiếu, KHÔNG xác minh từng câu trả lời. Kiểm tra các cột trên Google Sheet trước khi gửi hàng loạt; lượt tăng có thể đến từ người khác.');
  else status('Cần đối chiếu lại: Google xác nhận '+confirmed+
   ', nhưng tổng phản hồi tăng '+delta+'.',true);
 }
}
async function run(maxRows){
 if(state.working)return;
 if(!$('qaConsent').checked)return status('Hãy xác nhận trước khi gửi.',true);
 const bridge=window.PandaStudyQA;
 if(!bridge)return status('Chưa có bảng dữ liệu. Hãy nhập Form và bấm 4a, 4b.',true);
 const rows=bridge.getRows();
 const formUrl=bridge.getUrl(),planToken=bridge.getPlanToken?.();
 const sameContext=()=>bridge.getUrl()===formUrl&&bridge.getPlanToken?.()===planToken&&!state.contextChanged;
 if(!rows.length)return status('Chưa có dữ liệu để gửi. Hãy bấm 4a và 4b.',true);
 if(rows.some(r=>!['valid','sent','error'].includes(r.status)))
  return status('Còn dòng chưa kiểm tra. Bấm 4b trước khi gửi.',true);
 if(state.stopped)return status('Đã dừng vì có lỗi hoặc kết quả chưa rõ. Kiểm tra số phản hồi trước.',true);
 const allowed=await permission();
 if(!allowed)return status('Chưa thể gửi. Xem thông báo về trang trả lời Form ở Bước 6.',true);
 if(bridge.getUrl()!==formUrl||bridge.getPlanToken?.()!==planToken)
  return status('Form hoặc bảng dữ liệu vừa thay đổi. Kiểm tra lại rồi chủ động bấm gửi.',true);
 if(state.history.length===0){state.attempted=new Set();recoverAttempts();}
 const unsent=rows.filter(r=>r.status==='valid'&&!state.attempted.has(r.index));
 if(!unsent.length)return status('Không có dòng hợp lệ chưa gửi; tránh gửi trùng.',true);
 if(state.attempted.size && unsent.length<rows.filter(r=>r.status==='valid').length)
  return status('Một số dòng đã gửi trong phiên này. Kiểm tra kết quả trước khi gửi tiếp.',true);
 state.working=true;state.contextChanged=false;
 // Keep the active Form and plan stable while requests are in flight. Tokens
 // also detect an import/build that was already pending when this run began.
 const editing=['fileStep','formSetupStep','mappingStep','planStep','previewSection'].map($).filter(Boolean).map(el=>({el,inert:el.inert}));
 editing.forEach(({el})=>{el.inert=true;});
 $('qaRunStartOne').disabled=true;$('qaRunStartAll').disabled=true;
 try{
  const batch=unsent.slice(0,maxRows).map(row=>({...row,answers:JSON.parse(JSON.stringify(row.answers))}));
  const lastProfile=window.PandaBilling?.getProfile();
  const profile=await window.PandaBilling?.refresh();
  if(!profile&&lastProfile?.billingEnabled)return status('Chưa kiểm tra được số lượt. Dữ liệu vẫn được giữ; hãy thử lại khi kết nối ổn định.',true);
  if(profile?.billingEnabled){
   if(!profile.configured)return status('Tạm dừng gửi có tính lượt vì hệ thống thanh toán chưa sẵn sàng. Dữ liệu của bạn vẫn được giữ.',true);
   if(profile.availableCredits<batch.length){
    status('Cần '+batch.length+' lượt để gửi nhóm này; hiện có '+profile.availableCredits+' lượt. Mua thêm rồi chủ động bấm gửi lại.',true);
    window.PandaBilling?.openPurchase();return;
   }
  }
  let blockedBeforeDispatch=false;
  if(state.before===null){
   try{
    const p=await verify(true,formUrl);
    status('Tổng phản hồi trước khi gửi: '+p.count+' ('+providerLabel()+').');
   }catch(e){
    // Form API response-count permission is optional; do not mislabel this
    // as a Google login or submission permission error.
    state.before=null;
    status('Không đọc được tổng ban đầu: '+e.message+'. Kiểm tra phản hồi Google và đối chiếu trên Sheet.',true);
   }
  }
  for(const r of batch){
   if(!sameContext()){
    state.stopped=true;status('Đã dừng vì Form hoặc bảng dữ liệu thay đổi. Không gửi các dòng còn lại; hãy đối chiếu kết quả đã có.',true);break;
   }
   const operationId=rememberAttempt(r.index); // stable ID is stored BEFORE dispatch
   status('Đang gửi dòng '+r.index+'/'+rows.length+'...');
   let answer;
   try{
    answer=await post('/api/qa-submit',{
     formUrl,answers:r.answers,confirmedTestOnly:true,operationId
    });
   }catch(e){
    if(e.delivery==='not_sent'){
     // The server confirms that Google was never called. Preserve the row for
     // a later explicit click; approval and balance refresh never resume it.
     state.attempted.delete(r.index);saveAttempts();blockedBeforeDispatch=true;
     status('Chưa gửi dòng '+r.index+': '+e.message+'. Dữ liệu vẫn được giữ để bạn chủ động gửi lại.',true);
     if(e.status===402)window.PandaBilling?.openPurchase();
     break;
    }
    answer={status:'unverified',note:'Lỗi khi gửi: '+e.message+'. Có thể Google đã nhận, không tự gửi lại.'};
   }
   const result={index:r.index,status:answer.status,note:(answer.note||'')+(answer.operationId?' Mã lượt gửi: '+answer.operationId+'.':''),
     receivedAt:answer.receivedAt||'',operationId:answer.operationId||operationId,answers:r.answers};
   state.history.push(result);
   const idx=rows.findIndex(item=>item.index===r.index);
   if(sameContext())bridge.updateRow(idx,answer.status==='page-confirmed'?'sent':'error',answer.receivedAt||'',result.note);
   else{
    state.stopped=true;updateCounts();
    status('Đã dừng vì Form hoặc bảng dữ liệu thay đổi. Kết quả dòng vừa xử lý thuộc dữ liệu trước: '+result.note+' Tải kết quả để đối chiếu.',true);break;
   }
   updateCounts();
   if(answer.status!=='page-confirmed'){
    state.stopped=true;
    status('Dừng tại dòng '+r.index+': '+result.note+
      ' Hãy kiểm tra phản hồi trước khi gửi tiếp.',true);
    break;
   }
   status('Trang Google báo nhận '+state.history.length+' dòng. Đang kiểm tra số thực tế...');
   if(r!==batch[batch.length-1])await wait(2500);
  }
  if(!state.stopped&&!blockedBeforeDispatch&&sameContext()){
   await wait(1200);
   try{
    await verify(false,formUrl);
    updateReport();
   }catch(e){
    status('Chưa đối chiếu được tổng phản hồi: '+e.message,true);
   }
  }
 }catch(e){status('Chưa bắt đầu gửi: '+e.message,true);}
 finally{
  editing.forEach(({el,inert})=>{el.inert=inert;});
  state.working=false;updateCounts();
  window.dispatchEvent(new Event('pandastudy:billing-refresh'));
  if(!state.stopped){const allowedButton=$('qaRunStartOne').dataset.allowed==='true';$('qaRunStartOne').disabled=!allowedButton;$('qaRunStartAll').disabled=!allowedButton;}
 }
}
function safeCell(v){
 const value=String(v??'');
 return '"'+(/^\s*[=+@-]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';
}
function download(){
 if(!state.history.length)return;
 const bridge=window.PandaStudyQA;
 const formId=bridge?.getUrl()||'';
 const headers=['STT','Kết quả Google','Thời điểm trang xác nhận','Ghi chú','Câu trả lời (JSON)'];
 const rows=state.history.map(x=>[x.index,x.status,x.receivedAt,x.note,JSON.stringify(x.answers)]);
 const content='\ufeff'+[headers,...rows].map(row=>row.map(safeCell).join(',')).join('\r\n');
 const uri=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=uri;a.download='pandastudy-ket-qua-gui-form.csv';a.click();
 setTimeout(()=>URL.revokeObjectURL(uri),1000);
 status('Đã tải kết quả '+state.history.length+' dòng.');
}
function init(){
 const previous=$('previewSection');if(!previous)return;
 const panel=node('section','step qa-run-panel');panel.id='qaRunStep';
 const title=node('div','step-title');
 title.appendChild(node('span','step-number','6'));
 const summary=node('div');
 summary.appendChild(node('h3','','Gửi Form và đối chiếu kết quả'));
 title.appendChild(summary);panel.appendChild(title);
 const connect=node('div','qa-settings');
 const statusConfig=node('p','workflow-result','Đang kiểm tra...');
 statusConfig.id='qaConfigStatus';connect.appendChild(statusConfig);
 const google=node('a','btn btn-outline','Kết nối lại Google');
 google.id='qaConnectBtn';google.href='/api/auth/start';google.hidden=true;connect.appendChild(google);
 panel.appendChild(connect);
 const paymentNote=node('p','small muted','');paymentNote.id='qaBillingNotice';paymentNote.hidden=true;
 panel.appendChild(paymentNote);
 const sheetLabel=node('label','qa-sheet-label','Google Sheet đối chiếu (tùy chọn)');
 const sheet=node('input','qa-sheet-input');
 sheet.id='qaSheetUrl';sheet.type='url';sheet.placeholder='https://docs.google.com/spreadsheets/d/.../edit?gid=...';
 sheet.autocomplete='off';sheetLabel.appendChild(sheet);panel.appendChild(sheetLabel);
 const consent=node('label','check-line');const check=node('input');
 check.type='checkbox';check.id='qaConsent';
 consent.append(check,document.createTextNode(' Tôi xác nhận'));
 panel.appendChild(consent);
 const actions=node('div','action-row');
 const names=[
  ['qaRunStartOne','6a. Gửi 1 dòng','btn btn-primary'],
  ['qaRunStartAll','6b. Gửi các dòng còn lại','btn btn-secondary'],
  ['qaRunVerify','6c. Đối chiếu Form/Sheet','btn btn-outline'],
  ['qaRunExport','6d. Tải kết quả','btn btn-soft']
 ];
 names.forEach(([id,label,klass])=>{const btn=node('button',klass,label);btn.type='button';btn.id=id;btn.disabled=id!=='qaRunVerify';actions.appendChild(btn);});
 panel.appendChild(actions);
 const message=node('p','workflow-result','');
 message.id='qaRunMessage';message.hidden=true;message.setAttribute('role','status');panel.appendChild(message);
 const counter=node('p','small muted','');counter.id='qaRunCounters';counter.hidden=true;panel.appendChild(counter);
 previous.after(panel);
 $('qaRunStartOne').addEventListener('click',()=>run(1));
 $('qaRunStartAll').addEventListener('click',()=>run(Number.MAX_SAFE_INTEGER));
 $('qaRunVerify').addEventListener('click',async()=>{
  try{const result=await verify(false);status('Tổng hiện tại: '+result.count+' phản hồi/dòng ('+providerLabel()+'). '+result.note);}
  catch(e){status('Không đọc được tổng: '+e.message,true);}
 });
 $('qaRunExport').addEventListener('click',download);
 const refreshForm=()=>{
  if(state.working){state.contextChanged=true;status('Form vừa thay đổi. Đang giữ kết quả dòng hiện tại và dừng các dòng tiếp theo.',true);return;}
  state.before=null;state.after=null;state.history=[];state.attempted.clear();state.operations={};state.stopped=false;state.contextChanged=false;
  clearTimeout(permissionTimer);permissionTimer=setTimeout(permission,350);updateCounts();
 };
 $('formUrl').addEventListener('input',refreshForm);
 $('formUrl').addEventListener('change',()=>{clearTimeout(permissionTimer);permission();});
 $('importFormBtn')?.addEventListener('click',()=>{clearTimeout(permissionTimer);permissionTimer=setTimeout(permission,500);});
 document.addEventListener('pandastudy:billing-profile',event=>billingNote(event.detail));
 permission();updateCounts();billingNote();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
