'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const qa=require('../lib/qa-submit');
const check=require('../lib/public-sheet');
const testForm={
 id:'SAMPLEFORM',responderUri:'https://docs.google.com/forms/d/e/1FAIpQLSample/viewform',
 acceptingResponses:true,
 questions:[
  {id:'1',title:'Giới tính',type:'multiple_choice',options:['Có','Không'],
   required:true,supported:true,entryIds:['123']},
  {id:'2',title:'Bảng ý kiến',type:'grid',columns:['1','2','3'],
   rows:['A','B'],required:true,supported:true,entryIds:['234','345']}
 ]
};
test('Only official Google respondent page URL may receive answers',()=>{
 assert.equal(qa.responseUrl(testForm.responderUri),
  'https://docs.google.com/forms/d/e/1FAIpQLSample/formResponse');
 for(const bad of ['https://evil.example/forms/d/e/a/viewform','http://docs.google.com/forms/d/e/a/viewform',
  'https://docs.google.com/redirect?url=https://evil.example/forms/d/a/viewform'])
  assert.throws(()=>qa.responseUrl(bad));
});
test('Admin and test-form allowlist must both pass',()=>{
 const e={ENABLE_QA_SUBMISSIONS:'true',PANDASTUDY_TEST_FORM_IDS:'SAMPLEFORM,ALLOWED',
 PANDASTUDY_ADMIN_EMAILS:'admin@example.com'};
 assert.equal(qa.canTest('SAMPLEFORM',e),true);
 assert.equal(qa.canTest('PRODUCTIONFORM',e),false);
 assert.equal(qa.canTest('SAMPLEFORM',{...e,ENABLE_QA_SUBMISSIONS:'false'}),false);
 assert.equal(qa.allowedAdmin('ADMIN@example.com',e),true);
 assert.equal(qa.allowedAdmin('visitor@example.com',e),false);
 assert.equal(qa.sendingConfigured(e),true);
});
test('Never send incomplete row',async()=>{
 let hits=0;
 await assert.rejects(()=>qa.sendOne({form:testForm,answers:{1:'Có'},fetchImpl:()=>{hits++}}),
  /Thiếu câu trả lời/);
 assert.equal(hits,0);
});

const SAMPLE_FORM_HTML = '<html><form method="POST" action="https://docs.google.com/forms/d/e/1FAIpQLSample/formResponse">'+
 '<input type="hidden" name="fvv" value="1">'+
 '<input type="hidden" name="partialResponse" value="[null,null,&quot;12345&quot;]">'+
 '<input type="hidden" name="pageHistory" value="0">'+
 '<input type="hidden" name="fbzx" value="12345">'+
 '<input type="hidden" name="submissionTimestamp" value="1760000000">'+
 '</form></html>';
function getPage(html=SAMPLE_FORM_HTML,url=testForm.responderUri){
 return {ok:true,status:200,url,text:async()=>html};
}
test('Extracts Google hidden session fields and decodes HTML entities',()=>{
 const fields=qa.hiddenFormValues(SAMPLE_FORM_HTML);
 assert.equal(fields.get('fbzx'),'12345');
 assert.equal(fields.get('partialResponse'),'[null,null,"12345"]');
 assert.equal(fields.get('pageHistory'),'0');
 assert.equal(fields.get('submissionTimestamp'),'1760000000');
});
test('Fetches fresh Google respondent page before submitting mapped answers',async()=>{
 const calls=[];
 const result=await qa.sendOne({
  form:testForm,answers:{1:'Có',2:['1','2']},
  fetchImpl:async(url,opts)=>{
   calls.push(opts.method);
   if(opts.method==='GET')return getPage();
   const fields=new URLSearchParams(opts.body);
   assert.equal(fields.get('entry.123'),'Có');
   assert.equal(fields.get('entry.234'),'1');
   assert.equal(fields.get('entry.345'),'2');
   assert.equal(fields.get('fbzx'),'12345');
   assert.equal(fields.get('partialResponse'),'[null,null,"12345"]');
   assert.equal(fields.get('submissionTimestamp'),'1760000000');
   assert.equal(url,'https://docs.google.com/forms/d/e/1FAIpQLSample/formResponse');
   return {ok:true,status:200,url,text:async()=>'<html>Your response has been recorded</html>'};
  }});
 assert.equal(result.status,'page-confirmed');
 assert.deepEqual(calls,['GET','POST']);
});
test('Missing Google fbzx prevents sending an incomplete request',async()=>{
 let posted=false;
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
 fetchImpl:async(url,opts)=>{
  if(opts.method==='POST')posted=true;
  return getPage('<html><input type="hidden" name="partialResponse" value="[]"></html>');
 }});
 assert.equal(posted,false);
 assert.equal(result.status,'failed');
 assert.match(result.note,/fbzx/);
});
test('Google login redirect prevents sending',async()=>{
 let posted=false;
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
 fetchImpl:async(url,opts)=>{
  if(opts.method==='POST')posted=true;
  return getPage(SAMPLE_FORM_HTML,'https://accounts.google.com/ServiceLogin');
 }});
 assert.equal(posted,false);
 assert.equal(result.status,'failed');
});
test('Ambiguous confirmation stops after one attempt, never retries',async()=>{
 let posts=0;
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
 fetchImpl:async(url,opts)=>{
  if(opts.method==='GET')return getPage();
  posts++;return {ok:true,status:200,url,text:async()=>'<html>Sign in to continue</html>'};
 }});
 assert.equal(posts,1);
 assert.equal(result.status,'unverified');
});
test('Post-request network uncertainty never claims Google received the row',async()=>{
 let posts=0;
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
 fetchImpl:async(url,opts)=>{
  if(opts.method==='GET')return getPage();
  posts++;throw Error('timeout');
 }});
 assert.equal(posts,1);
 assert.equal(result.status,'unverified');
 assert.equal(result.delivery,'unknown');
});
test('An HTTP error after POST is unknown, not proof that no response was recorded',async()=>{
 let posts=0;
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
 fetchImpl:async(url,opts)=>{
  if(opts.method==='GET')return getPage();
  posts++;return {ok:false,status:502,url};
 }});
 assert.equal(posts,1);assert.equal(result.status,'unverified');assert.equal(result.delivery,'unknown');
});
test('A failure fetching the respondent session is definitely not sent',async()=>{
 let posts=0;
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
 fetchImpl:async(url,opts)=>{if(opts.method==='POST')posts++;throw Error('GET timeout');}});
 assert.equal(posts,0);assert.equal(result.status,'failed');assert.equal(result.delivery,'not_sent');
});
test('Refuses Sheet URLs outside docs.google.com',()=>{
 const id='1T_gGTt8xFY_-Jylbm_Di-90J69BdNsElyv2lLNaiks8';
 const url='https://docs.google.com/spreadsheets/d/'+id+'/edit?gid=1197897507#gid=1197897507';
 assert.equal(check.exportUrl(url),
   'https://docs.google.com/spreadsheets/d/'+id+'/export?format=csv&gid=1197897507');
 for(const url of ['https://attacker.example/spreadsheets/d/'+id+'/edit',
  'https://docs.google.com.evil.com/spreadsheets/d/'+id+'/edit',
  'https://docs.google.com/forms/d/'+id+'/edit'])
  assert.throws(()=>check.exportUrl(url));
});
test('Counts CSV records with multiline quoted values, not just newline chars',()=>{
 const sample='timestamp,comment,group\r\n2026-09-28,"first\nsecond",A\r\n2026-09-29,ok,B\r\n';
 assert.equal(check.countCsvRows(sample),2);
 assert.equal(check.countCsvRows('timestamp,comment\n'),0);
});
test('Read-only Sheet public count returns no respondent data',async()=>{
 const url='https://docs.google.com/spreadsheets/d/1T_gGTt8xFY_-Jylbm_Di-90J69BdNsElyv2lLNaiks8/edit?gid=1197897507';
 const result=await check.publicSheetCount(url,async(uri)=>{
  assert(uri.includes('format=csv'));
  return {ok:true,status:200,url:'https://doc-01.sheets.googleusercontent.com/file',
   headers:{get:k=>k==='content-type'?'text/csv; charset=utf-8':null},
   text:async()=> 'time,answer\none,one\ntwo,two\n'};
 });
 assert.equal(result.count,2);
 assert.equal(result.source,'google-sheet-public-csv');
 assert.equal(JSON.stringify(result).includes('one,one'),false);
});

test('Legacy unaudited submission API is blocked even if QA feature flag is enabled',async()=>{
 const bridge=require('../api/bridge');
 const before=process.env.ENABLE_QA_SUBMISSIONS;
 process.env.ENABLE_QA_SUBMISSIONS='true';
 function fakeRes(){return {code:200,status(n){this.code=n;return this},setHeader(){},json(v){this.body=v;return this}}}
 try{
  for(const name of ['beginPaidRun','submitOneResponse']){
   const req={method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000'},body:{name,args:[]}};
   const res=fakeRes();
   await bridge(req,res);
   assert.equal(res.code,403);
   assert.match(res.body.error,/Đường gửi cũ đã khóa/);
  }
 }finally{
  if(before===undefined)delete process.env.ENABLE_QA_SUBMISSIONS;
  else process.env.ENABLE_QA_SUBMISSIONS=before;
 }
});

test('confirmation text inside a returned respondent form is never accepted',async()=>{
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
  fetchImpl:async(url,opts)=>{
   if(opts.method==='GET')return getPage();
   return {ok:true,status:200,url,text:async()=>'<html><form action="https://docs.google.com/forms/d/e/1FAIpQLSample/formResponse"><label>Your response has been recorded</label></form></html>'};
  }});
 assert.equal(result.status,'unverified');
 assert.equal(result.delivery,'unknown');
});
test('confirmation phrase present only in script is never accepted',async()=>{
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
  fetchImpl:async(url,opts)=>{
   if(opts.method==='GET')return getPage();
   return {ok:true,status:200,url,text:async()=>'<html><body><script>const fake="Your response has been recorded"</script><div>Try again</div></body></html>'};
  }});
 assert.equal(result.status,'unverified');
 assert.equal(result.delivery,'unknown');
});
assert.equal(qa.confirmationPage('<html><div>Your response has been recorded</div></html>'),true);
assert.equal(qa.confirmationPage('<html><form action="/forms/d/e/x/formResponse"><div>Your response has been recorded</div></form></html>'),false);
