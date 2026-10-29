'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const form=require('../lib/forms');
const validation=require('../lib/validation');
const bridge=require('../api/bridge');

function exampleHtml(){
 const info=[];
 info[0]='Hướng dẫn điền khảo sát';
 info[1]=[
  [100,'Giới tính',null,2,[[900,[['Nam'],['Nữ']],1]]],
  [101,'Tiêu đề nhóm',null,8,null],
  [103,'PHẦN 1: CHÂN DUNG NGƯỜI THAM GIA', 'Giúp nhóm phân khúc đối tượng',6,null],
  [102,'Bảng mức độ hài lòng',null,7,[
   [901,[['Không đồng ý'],['Đồng ý']],1,['Câu 1']],
   [902,[['Không đồng ý'],['Đồng ý']],1,['Câu 2']]
  ]]
 ];
 info[8]='Khảo sát mẫu';
 const payload=[null,info];
 return '<html><form action="https://docs.google.com/forms/d/e/abc/formResponse"></form>'+
  '<script>var FB_PUBLIC_LOAD_DATA_ = '+JSON.stringify(payload)+';</script></html>';
}
const URL='https://docs.google.com/forms/d/Unit_test_form_123/edit';
const PUBLISHED='https://docs.google.com/forms/d/e/1FAIpQLTestForm123/viewform';
test('Parse published questions and skip headings',()=>{
 const f=form.parsePublicFormHtml(exampleHtml(),'Unit_test_form_123',PUBLISHED);
 assert.equal(f.accessMode,'public');
 assert.equal(f.title,'Khảo sát mẫu');
 assert.equal(f.supportedCount,2);
 assert.equal(f.unsupportedCount,0);
 assert.equal(f.questions.length,2);
 assert.deepEqual(f.questions[0].options,['Nam','Nữ']);
 assert.equal(f.questions[0].required,true);
 assert.deepEqual(f.questions[0].entryIds,['900']);
 assert.equal(f.questions[1].type,'grid');
 assert.deepEqual(f.questions[1].rows,['Câu 1','Câu 2']);
 assert.deepEqual(f.questions[1].columns,['Không đồng ý','Đồng ý']);
 assert.deepEqual(f.questions[1].entryIds,['901','902']);
 assert.equal(f.responseCount,null);
});
test('Google Forms type 6 section heading is not an answerable checkbox grid',()=>{
 const title='PHẦN 1: CHÂN DUNG NGƯỜI THAM GIA';
 const heading=[999,title,'Giúp nhóm phân khúc đối tượng',6,null];
 assert.equal(form.fromPublicItem(heading,0),null);
 const f=form.parsePublicFormHtml(exampleHtml(),'Unit_test_form_123',PUBLISHED);
 assert.equal(f.questions.some(q=>q.title===title),false);
 assert.equal(f.unsupportedCount,0);
 assert.equal(f.supportedCount,2);
 assert.equal(f.questions[1].type,'grid');
});

test('Published public form is accessible without OAuth, and validations batch to 50/100', async ()=>{
 const original=global.fetch;
 const before=process.env.GOOGLE_CLIENT_ID;
 delete process.env.GOOGLE_CLIENT_ID;
 let hits=0;
 global.fetch=async url=>{
  hits++;
  assert.equal(String(url), 'https://docs.google.com/forms/d/Unit_test_form_123/viewform');
  return {ok:true,status:200,url:PUBLISHED,text:async()=>exampleHtml()};
 };
 try{
  const f=await form.loadPublicForm(URL);
  assert.equal(f.questions.length,2);
  assert.equal(f.responderUri,PUBLISHED);
  const a={'100':'1','102':['Đồng ý','Không đồng ý']};
  for(const size of [50,100]){
   const rows=Array.from({length:size},()=>a);
   assert.equal(rows.filter(row=>validation.validate(f.questions,row).length).length,0);
  }
  assert.equal(validation.fields(f.questions,a).get('entry.900'),'Nam');
  assert.equal(validation.fields(f.questions,a).get('entry.901'),'Đồng ý');
  assert.equal(validation.fields(f.questions,a).get('entry.902'),'Không đồng ý');
  const fakeReq=name=>({method:'POST',headers:{host:'localhost:3000',origin:'http://localhost:3000'},body:{name,args:name==='importOwnedForm'?[URL]:[URL,Array.from({length:50},()=>({answers:a}))]}});
  function fakeRes(){return {statusCode:200,headers:{},status(n){this.statusCode=n;return this},setHeader(n,v){this.headers[n]=v},getHeader(n){return this.headers[n]},json(x){this.body=x;return this}}}
  let res=fakeRes();await bridge(fakeReq('importOwnedForm'),res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.supportedCount,2);
  assert.equal(res.body.responderUri,undefined);
  res=fakeRes();await bridge(fakeReq('validatePlan'),res);
  assert.equal(res.statusCode,200);
  assert.equal(res.body.total,50);
  assert.equal(res.body.invalid,0);
  assert.equal(res.body.results.length,50);
  assert.equal(hits,1,'The parsed form is reused for consecutive validation batches');
 }finally{
  global.fetch=original;
  if(before!==undefined)process.env.GOOGLE_CLIENT_ID=before;
 }
});
test('Private or redirected forms are never silently treated as public',async ()=>{
 const original=global.fetch;
 global.fetch=async()=>({ok:true,status:200,url:'https://accounts.google.com/ServiceLogin',text:async()=>'<html>Login</html>'});
 try{await assert.rejects(()=>form.loadPublicForm('https://docs.google.com/forms/d/private_example/edit'), /chưa được công khai/)}
 finally{global.fetch=original}
});
test('Malformed public answers are rejected',()=>{
 const f=form.parsePublicFormHtml(exampleHtml(),'unit',PUBLISHED);
 const messages=validation.validate(f.questions,{'100':'Nam','102':['Không đồng ý']});
 assert(messages.some(x=>x.includes('Số hàng')));
});
