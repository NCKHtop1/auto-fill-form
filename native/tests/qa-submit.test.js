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
test('Google page confirmation is NOT Forms API verification',async()=>{
 const result=await qa.sendOne({
  form:testForm,answers:{1:'Có',2:['1','2']},
  fetchImpl:async(url,opts)=>{
   const data=new URLSearchParams(opts.body);
   assert.equal(data.get('entry.123'),'Có');
   assert.equal(data.get('entry.234'),'1');
   assert.equal(data.get('entry.345'),'2');
   assert.equal(url,'https://docs.google.com/forms/d/e/1FAIpQLSample/formResponse');
   return {ok:true,status:200,url, text:async()=>'<html>Your response has been recorded</html>'};
  }
 });
 assert.equal(result.status,'page-confirmed');
 assert.match(result.note,/đối chiếu/);
});
test('Ambiguous confirmation does not trigger retry',async()=>{
 let count=0;
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
 fetchImpl:async()=>{count++;return {ok:true,status:200,text:async()=>'<html>Sign in to continue</html>'};}});
 assert.equal(count,1);
 assert.equal(result.status,'unverified');
});
test('Network uncertainty never claims sent',async()=>{
 const result=await qa.sendOne({form:testForm,answers:{1:'Có',2:['1','2']},
 fetchImpl:async()=>{throw Error('timeout')}});
 assert.equal(result.status,'unverified');
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
