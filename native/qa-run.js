/* PandaStudy: consented published-Form submissions, no automatic retries. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const wait=ms=>new Promise(done=>setTimeout(done,ms));
let state={working:false,attempted:new Set(),history:[],before:null,after:null,source:'',runKey:'',stopped:false};
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
}
function actionUrl(){
 return '/api/qa-verify';
}
async function post(url,data){
 const response=await fetch(url,{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
 const out=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(out.error||'Máy chủ trả lỗi '+response.status);
 return out;
}
function providerLabel(){
 return state.source==='google-forms-api'?'Google Forms API':
  state.source==='google-sheet-public-csv'?'Google Sheet công khai':'Chưa kết nối';
}
function updateCounts(){
 const accepted=state.history.filter(h=>h.status==='page-confirmed').length;
 const failed=state.history.filter(h=>h.status==='failed').length;
 const uncertain=state.history.filter(h=>h.status==='unverified').length;
 const delta=state.before===null||state.after===null?'—':state.after-state.before;
 $('qaRunCounters').textContent=
  'Trang Google báo nhận: '+accepted+' · Lỗi: '+failed+
  ' · Chưa xác minh: '+uncertain+' · Tổng trước: '+
  (state.before??'—')+' · Tổng sau: '+(state.after??'—')+
  ' · Tăng: '+delta+' · Nguồn: '+providerLabel();
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
  const old=Array.isArray(record.attempted)?record.attempted:[];
  old.forEach(n=>state.attempted.add(Number(n)));
  if(old.length)status('Trang này đã thử gửi '+old.length+' dòng trong phiên hiện tại. Không tự gửi lại để tránh trùng. Hãy kiểm tra tổng phản hồi trước.',true);
 }catch{}
}
function rememberAttempt(index){
 state.attempted.add(index);
 try{sessionStorage.setItem(state.runKey,
  JSON.stringify({attempted:Array.from(state.attempted),at:new Date().toISOString()}));}catch{}
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
 $('qaConfigStatus').textContent=data.canSend
  ?'Đã đăng nhập Google. Form công khai có thể nhận câu trả lời; hoàn tất 4a, 4b và chỉ gửi vào Form kiểm thử.'
  :'Chưa sẵn sàng gửi: '+(data.reasons||[]).join(' ');
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
async function verify(isInitial=false){
 const bridge=window.PandaStudyQA;
 if(!bridge?.getUrl())throw Error('Dán Google Form ở Bước 2 trước.');
 const result=await post(actionUrl(),{
  formUrl:bridge.getUrl(),sheetUrl:$('qaSheetUrl').value.trim()||undefined});
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
   'Đối chiếu tổng khớp: '+confirmed+' lượt có trang Google xác nhận, '+providerLabel()+' tăng '+delta+
   '. Nếu biểu mẫu đang có người trả lời khác, số tăng có thể bao gồm phản hồi của họ.');
  else status('Cần kiểm tra lại: trang Google báo nhận '+confirmed+
   ', nhưng tổng phản hồi tăng '+delta+'; không tự gửi thêm hoặc thử lại.',true);
 }
}
async function run(maxRows){
 if(state.working)return;
 if(!$('qaConsent').checked)return status('Tích xác nhận quyền sở hữu bản Form kiểm thử ở Bước 6.',true);
 const bridge=window.PandaStudyQA;
 if(!bridge)return status('Chưa có bảng dữ liệu. Hãy nhập Form và bấm 4a, 4b.',true);
 const rows=bridge.getRows();
 if(!rows.length)return status('Chưa có dữ liệu để gửi. Hãy bấm 4a và 4b.',true);
 if(rows.some(r=>!['valid','sent','error'].includes(r.status)))
  return status('Còn dòng chưa kiểm tra. Bấm 4b trước khi gửi.',true);
 if(state.stopped)return status('Đã dừng vì có lỗi hoặc kết quả chưa rõ. Kiểm tra số phản hồi trước.',true);
 const allowed=await permission();
 if(!allowed)return status('Chưa thể gửi. Xem thông báo về trang trả lời Form ở Bước 6.',true);
 if(state.history.length===0){state.attempted=new Set();recoverAttempts();}
 const unsent=rows.filter(r=>r.status==='valid'&&!state.attempted.has(r.index));
 if(!unsent.length)return status('Không có dòng hợp lệ chưa gửi; tránh gửi trùng.',true);
 if(state.attempted.size && unsent.length<rows.filter(r=>r.status==='valid').length)
  return status('Một số dòng đã được thử trong phiên này. Hãy kiểm tra lại trước khi gửi tiếp.',true);
 state.working=true;
 $('qaRunStartOne').disabled=true;$('qaRunStartAll').disabled=true;
 try{
  if(state.before===null){
   try{
    const p=await verify(true);
    status('Tổng phản hồi trước khi gửi: '+p.count+' ('+providerLabel()+').');
   }catch(e){
    // Form API response-count permission is optional; do not mislabel this
    // as a Google login or submission permission error.
    state.before=null;
    status('Chưa đọc được tổng trước khi gửi: '+e.message+'. Vẫn có thể gửi thử và xem xác nhận Google; cần Sheet để đối chiếu.',true);
   }
  }
  const batch=unsent.slice(0,maxRows);
  for(const r of batch){
   rememberAttempt(r.index); // store BEFORE request; never blindly retry after timeout
   status('Đang gửi dòng '+r.index+'/'+rows.length+'...');
   let answer;
   try{
    answer=await post('/api/qa-submit',{
     formUrl:bridge.getUrl(),answers:r.answers,confirmedTestOnly:true
    });
   }catch(e){
    answer={status:'unverified',note:'Lỗi khi gửi: '+e.message+'. Có thể Google đã nhận, không tự gửi lại.'};
   }
   const result={index:r.index,status:answer.status,note:answer.note||'',
     receivedAt:answer.receivedAt||'',answers:r.answers};
   state.history.push(result);
   const idx=rows.findIndex(item=>item.index===r.index);
   bridge.updateRow(idx,answer.status==='page-confirmed'?'sent':'error',answer.receivedAt||'',result.note);
   updateCounts();
   if(answer.status!=='page-confirmed'){
    state.stopped=true;
    status('Dừng tại dòng '+r.index+': '+result.note+
      ' Hãy kiểm tra phản hồi đã ghi trước khi thử lại.',true);
    break;
   }
   status('Trang Google báo nhận '+state.history.length+' dòng. Đang kiểm tra số thực tế...');
   if(r!==batch[batch.length-1])await wait(2500);
  }
  await wait(1200);
  try{
   await verify(false);
   updateReport();
  }catch(e){
   status('Đã thử gửi nhưng chưa đối chiếu được tổng phản hồi: '+e.message,true);
  }
 }catch(e){status('Chưa bắt đầu gửi: '+e.message,true);}
 finally{
  state.working=false;updateCounts();
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
 status('Đã tải kết quả '+state.history.length+' dòng được thử gửi. Xem cột trạng thái và đối chiếu tổng Form/Sheet.');
}
function init(){
 const previous=$('previewSection');if(!previous)return;
 const panel=node('section','step qa-run-panel');panel.id='qaRunStep';
 const title=node('div','step-title');
 title.appendChild(node('span','step-number','6'));
 const summary=node('div');
 summary.appendChild(node('h3','','Gửi Form thử và đối chiếu kết quả'));
 summary.appendChild(node('p','','Chỉ gửi vào bản sao Form kiểm thử do bạn quản lý. Không đưa dữ liệu mẫu vào khảo sát thật.'));
 title.appendChild(summary);panel.appendChild(title);
 const connect=node('div','qa-settings');
 const statusConfig=node('p','workflow-result','Đang kiểm tra cấu hình gửi Form...');
 statusConfig.id='qaConfigStatus';connect.appendChild(statusConfig);
 const google=node('a','btn btn-outline','Kết nối lại Google');
 google.id='qaConnectBtn';google.href='/api/auth/start';google.hidden=true;connect.appendChild(google);
 panel.appendChild(connect);
 const sheetLabel=node('label','qa-sheet-label','Google Sheet đối chiếu (tùy chọn, phải được chia sẻ quyền xem)');
 const sheet=node('input','qa-sheet-input');
 sheet.id='qaSheetUrl';sheet.type='url';sheet.placeholder='https://docs.google.com/spreadsheets/d/.../edit?gid=...';
 sheet.autocomplete='off';sheetLabel.appendChild(sheet);panel.appendChild(sheetLabel);
 const consent=node('label','check-line');const check=node('input');
 check.type='checkbox';check.id='qaConsent';
 consent.append(check,document.createTextNode(' Tôi xác nhận đây là bản sao Form kiểm thử do mình quản lý; sẽ không trộn dữ liệu mẫu với khảo sát thật.'));
 panel.appendChild(consent);
 const actions=node('div','action-row');
 const names=[
  ['qaRunStartOne','6a. Gửi thử 1 dòng','btn btn-primary'],
  ['qaRunStartAll','6b. Gửi các dòng còn lại','btn btn-secondary'],
  ['qaRunVerify','6c. Kiểm tra tổng Form/Sheet','btn btn-outline'],
  ['qaRunExport','6d. Tải kết quả đã gửi','btn btn-soft']
 ];
 names.forEach(([id,label,klass])=>{const btn=node('button',klass,label);btn.type='button';btn.id=id;btn.disabled=id!=='qaRunVerify';actions.appendChild(btn);});
 panel.appendChild(actions);
 const message=node('p','workflow-result','Chưa gửi dòng nào. Có thể kiểm tra số phản hồi của Sheet mà không gửi dữ liệu.');
 message.id='qaRunMessage';message.setAttribute('role','status');panel.appendChild(message);
 const counter=node('p','small muted','Chưa có lượt gửi.');counter.id='qaRunCounters';panel.appendChild(counter);
 const help=node('p','small muted','Dừng ngay khi Google không xác nhận. Số dòng tăng trên Sheet có thể bao gồm phản hồi của người khác; không coi đó là mã xác nhận cho từng dòng.');
 panel.appendChild(help);
 previous.after(panel);
 $('qaRunStartOne').addEventListener('click',()=>run(1));
 $('qaRunStartAll').addEventListener('click',()=>run(Number.MAX_SAFE_INTEGER));
 $('qaRunVerify').addEventListener('click',async()=>{
  try{const result=await verify(false);status('Tổng hiện tại: '+result.count+' phản hồi/dòng ('+providerLabel()+'). '+result.note);}
  catch(e){status('Không đọc được tổng: '+e.message,true);}
 });
 $('qaRunExport').addEventListener('click',download);
 const refreshForm=()=>{state.before=null;state.after=null;state.history=[];state.attempted.clear();state.stopped=false;clearTimeout(permissionTimer);permissionTimer=setTimeout(permission,350);updateCounts();};
 $('formUrl').addEventListener('input',refreshForm);
 $('formUrl').addEventListener('change',()=>{clearTimeout(permissionTimer);permission();});
 $('importFormBtn')?.addEventListener('click',()=>{clearTimeout(permissionTimer);permissionTimer=setTimeout(permission,500);});
 permission();updateCounts();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
