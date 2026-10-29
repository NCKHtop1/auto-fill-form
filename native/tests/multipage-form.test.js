'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const forms=require('../lib/forms');
const qa=require('../lib/qa-submit');
const validation=require('../lib/validation');

const ID='MULTIPAGE_UNIT_TEST';
const EDIT='https://docs.google.com/forms/d/'+ID+'/edit';
const URL='https://docs.google.com/forms/d/e/1FAIpQLMultipageFixture/viewform';
const ENDPOINT='https://docs.google.com/forms/d/e/1FAIpQLMultipageFixture/formResponse';

function surveyItems(){
 const option=(id,values,required=1)=>[[id,values.map(x=>[x]),required]];
 const text=(id,required=0)=>[[id,null,required]];
 const section=(id,title)=>[id,title,null,8,null];
 return [
  section(100,'PHAN 1 - CHAN DUNG'),
  [101,'1. Nam hoc',null,2,option(1001,['Nam 1-2','Nam 3-4'])],
  [102,'2. Linh vuc',null,3,option(1002,['Kinh te','Y duoc'])],
  [103,'3. Muc tieu (toi da 2)',null,4,option(1003,['Hoc bong','Chung chi'])],
  section(110,'PHAN 2 - HANH VI'),
  [104,'4. Kenh tim kiem',null,4,option(1004,['Group','Web'])],
  [105,'5. Quan ly ho so',null,2,option(1005,['Excel','Notion'])],
  section(120,'PHAN 3 - RAO CAN'),
  [106,'6. Rao can',null,4,option(1006,['Deadline','Thieu thong tin'])],
  [107,'7. Be tac',null,2,option(1007,['GPA','Ngoai ngu'])],
  [108,'8. Cam xuc',null,2,option(1008,['Lo lang','Ap luc'])],
  [109,'9. Trai nghiem',null,1,text(1009,0)],
  section(130,'PHAN 4 - KY VONG'),
  [110,'10. Tinh nang',null,4,option(1010,['Nhac deadline','Kho ho so'])],
  [111,'11. Dong luc',null,2,option(1011,['Tiet kiem thoi gian','Tu tin'])],
  section(140,'PHAN 5 - LIEN HE'),
  [112,'12. Thong tin lien he (tuy chon)',null,0,text(1012,0)]
 ];
}
function respondentHtml(items=surveyItems()){
 const meta=[];
 meta[0]='Khảo sát sinh viên';
 meta[1]=items;
 meta[8]='KHẢO SÁT THẤU CẢM';
 return '<html><form method="POST" action="'+ENDPOINT+'">'+
  '<input type="hidden" name="fvv" value="1">'+
  '<input type="hidden" name="partialResponse" value="[null,null,&quot;12345&quot;]">'+
  '<input type="hidden" name="pageHistory" value="0">'+
  '<input type="hidden" name="fbzx" value="12345">'+
  '</form><script>var FB_PUBLIC_LOAD_DATA_ = '+JSON.stringify([null,meta])+';</script></html>';
}
function parsed(html=respondentHtml()){
 return forms.parsePublicFormHtml(html,ID,URL);
}
const answers={
 '101':'Nam 3-4','102':'Y duoc','103':['Hoc bong'],
 '104':['Group','Web'],'105':'Excel',
 '106':['Deadline'],'107':'Ngoai ngu','108':'Lo lang',
 '109':'Toi tung bo lo thoi han vi chua co du ho so.',
 '110':['Nhac deadline'],'111':'Tiet kiem thoi gian'
};

test('Five Google Form sections have 12 questions, not 5 extra unsupported items',()=>{
 const form=parsed();
 assert.equal(form.pageCount,5);
 assert.equal(form.pageHistory,'0,1,2,3,4');
 assert.equal(form.questions.length,12);
 assert.equal(form.supportedCount,12);
 assert.equal(form.unsupportedCount,0);
 assert.equal(form.unsupportedNavigation,false);
 assert.equal(form.questions[0].pageIndex,0);
 assert.equal(form.questions[3].pageIndex,1);
 assert.equal(form.questions[5].pageIndex,2);
 assert.equal(form.questions[9].pageIndex,3);
 assert.equal(form.questions[11].pageIndex,4);
 assert.deepEqual(validation.validate(form.questions,answers),[]);
 assert.equal(validation.fields(form.questions,answers).has('entry.1012'),false);
});
test('Full multi-page Google Form sends one POST with all visited pages and answers',async()=>{
 const form=parsed();
 const calls=[];
 const output=await qa.sendOne({form,answers,fetchImpl:async(url,opt)=>{
  calls.push({method:opt.method,url});
  if(opt.method==='GET')return {ok:true,status:200,url:URL,text:async()=>respondentHtml()};
  assert.equal(url,ENDPOINT);
  const params=new URLSearchParams(opt.body);
  assert.equal(params.get('pageHistory'),'0,1,2,3,4');
  assert.equal(params.get('fbzx'),'12345');
  assert.equal(params.get('entry.1001'),'Nam 3-4');
  assert.equal(params.get('entry.1009'),'Toi tung bo lo thoi han vi chua co du ho so.');
  assert.equal(params.get('entry.1011'),'Tiet kiem thoi gian');
  assert.equal(params.has('entry.1012'),false,'Optional personal contact is not manufactured');
  for(let n=1001;n<=1011;n++)assert(params.has('entry.'+n),'Missing mapped field '+n);
  return {ok:true,status:200,url:ENDPOINT,text:async()=>'<html>Your response has been recorded</html>'};
 }});
 assert.equal(output.status,'page-confirmed');
 assert.equal(output.delivery,'confirmed');
 assert.equal(output.pageCount,5);
 assert.equal(output.filledQuestions,11);
 assert.equal(output.totalQuestions,12);
 assert.deepEqual(calls.map(c=>c.method),['GET','POST']);
});
test('A form change between import and POST is blocked before any charged dispatch',async()=>{
 const form=parsed();
 const changed=surveyItems();
 changed[8][4][0][0]=5999; // Q6 entryId changed after import
 let posts=0;
 const result=await qa.sendOne({form,answers,fetchImpl:async(url,opt)=>{
  if(opt.method==='POST'){posts++;throw Error('POST should never happen');}
  return {ok:true,status:200,url:URL,text:async()=>respondentHtml(changed)};
 }});
 assert.equal(result.status,'failed');
 assert.equal(result.delivery,'not_sent');
 assert.equal(posts,0);
 assert.match(result.note,/đổi câu hỏi|cấu trúc/);
});
test('Conditional section branching is blocked before reserving or sending',async()=>{
 const items=surveyItems();
 items[3][4][0][1][0]=['Hoc bong',null,120]; // choice routes to another section
 const form=parsed(respondentHtml(items));
 assert.equal(form.unsupportedNavigation,true);
 let hits=0;
 await assert.rejects(()=>qa.sendOne({form,answers,fetchImpl:()=>{hits++;}}),/điều hướng/);
 assert.equal(hits,0);
});
test('A single-page form still submits with pageHistory zero',()=>{
 const meta=[];
 meta[0]='One page';
 meta[1]=[[77,'Name',null,0,[[666,null,1]]]];
 meta[8]='One page';
 const html=respondentHtml(meta[1]);
 const form=parsed(html);
 assert.equal(form.pageCount,1);
 assert.equal(form.pageHistory,'0');
 assert.equal(form.questions.length,1);
});
test('A section header with no entry ID does not increase pageHistory',()=>{
 const items=surveyItems();
 items.splice(2,0,[321,'Note in page one',null,6,null]);
 const form=parsed(respondentHtml(items));
 assert.equal(form.pageCount,5);
 assert.equal(form.questions.length,12);
});
