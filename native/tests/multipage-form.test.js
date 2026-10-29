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
 items[1][4][0][1][0]=['Nam 1-2',null,120]; // radio choice routes to another section
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


function linearDestinationItems(){
 const items=surveyItems();
 const headers=[0,4,7,12,15];
 for(let i=0;i<headers.length-1;i++)items[headers[i]][5]=items[headers[i+1]][0];
 // Google's last section may encode its normal Submit action as its own id.
 items[15][5]=items[15][0];
 // Explicit 'next section' on a choice is not a conditional skip.
 items[1][4][0][1][0]=['Nam 1-2',null,items[4][0]];
 return items;
}
test('A normal 5-part survey with explicit NEXT destinations is accepted (regression for blocked paid forms)',async()=>{
 const items=linearDestinationItems();
 const form=parsed(respondentHtml(items));
 assert.equal(form.pageCount,5);
 assert.equal(form.pageHistory,'0,1,2,3,4');
 assert.equal(form.questions.length,12);
 assert.equal(form.supportedCount,12);
 assert.equal(form.unsupportedCount,0);
 assert.equal(form.unsupportedNavigation,false);
 assert.equal(form.navigationReason,'');
 assert.deepEqual(validation.validate(form.questions,answers),[]);
 const fields=qa.prepareFields(form,answers);
 for(let id=1001;id<=1011;id++)
  assert.equal(fields.has('entry.'+id),true,'missing answer for field '+id);
 assert.equal(fields.has('entry.1012'),false);
 let posts=0;
 const result=await qa.sendOne({form,answers,fetchImpl:async(url,opt)=>{
  if(opt.method==='GET')
   return {ok:true,status:200,url:URL,text:async()=>respondentHtml(items)};
  posts++;
  const data=new URLSearchParams(opt.body);
  assert.equal(data.get('pageHistory'),'0,1,2,3,4');
  assert.equal(data.get('entry.1011'),'Tiet kiem thoi gian');
  assert.equal(data.has('entry.1012'),false);
  return {ok:true,status:200,url:ENDPOINT,
   text:async()=>'<html>Your response has been recorded</html>'};
 }});
 assert.equal(result.status,'page-confirmed');
 assert.equal(result.filledQuestions,11);
 assert.equal(posts,1);
});
test('A sequential Form does not display the unsupported navigation warning or disable paid QA buttons',async()=>{
 const auth=require('../lib/auth');
 const statusHandler=require('../api/qa-status');
 const originals={configured:auth.configured,session:auth.session,load:forms.loadPublicForm};
 const form=parsed(respondentHtml(linearDestinationItems()));
 auth.configured=()=>true;
 auth.session=async()=>({sub:'test-user'});
 forms.loadPublicForm=async()=>form;
 const req={method:'GET',query:{formUrl:EDIT},headers:{}};
 const res={code:200,status(n){this.code=n;return this},
  setHeader(){},json(x){this.body=x;return this}};
 try{
  await statusHandler(req,res);
  assert.equal(res.code,200);
  assert.equal(res.body.canSend,true);
  assert.equal(res.body.formAllowed,true);
  assert.deepEqual(res.body.reasons,[]);
 }finally{
  auth.configured=originals.configured;
  auth.session=originals.session;
  forms.loadPublicForm=originals.load;
 }
});
test('A section that skips over another section is blocked before Google or billing',()=>{
 const items=linearDestinationItems();
 items[0][5]=items[7][0]; // jump from first section to the third
 const form=parsed(respondentHtml(items));
 assert.equal(form.unsupportedNavigation,true);
 assert.equal(form.navigationReason,'section_jump');
 assert.throws(()=>qa.prepareFields(form,answers),/chỉnh điều hướng/);
});
test('A choice sending respondents straight to part 3 is still a real branch',()=>{
 const items=linearDestinationItems();
 items[1][4][0][1][0]=['Nam 1-2',null,items[7][0]];
 const form=parsed(respondentHtml(items));
 assert.equal(form.unsupportedNavigation,true);
 assert.equal(form.navigationReason,'choice_jump');
 assert.throws(()=>qa.prepareFields(form,answers),/bỏ qua phần khác/);
});
test('Consecutive section headings do not lose later questions or create a false branching error',()=>{
 const items=linearDestinationItems();
 items.splice(15,0,[777,'Phần hướng dẫn bổ sung',null,8,null]);
 const form=parsed(respondentHtml(items));
 assert.equal(form.pageCount,6);
 assert.equal(form.questions.length,12);
 assert.equal(form.unsupportedNavigation,true);
 // The original section 4 still points past the newly inserted page: a real skip,
 // so the preflight must reject rather than silently submit an incomplete path.
 assert.equal(form.navigationReason,'section_jump');
});

test('Google public navigation sentinel -2 means CONTINUE, not unsupported branching',async()=>{
 const items=linearDestinationItems();
 for(const index of [0,4,7,12])items[index][5]=-2;
 items[1][4][0][1][0]=['Nam 1-2',null,-2];
 const form=parsed(respondentHtml(items));
 assert.equal(form.pageCount,5);
 assert.equal(form.pageHistory,'0,1,2,3,4');
 assert.equal(form.questions.length,12);
 assert.equal(form.unsupportedNavigation,false);
 assert.equal(form.navigationReason,'');
 let posts=0;
 const result=await qa.sendOne({form,answers,fetchImpl:async(url,opt)=>{
  if(opt.method==='GET')return {ok:true,status:200,url:URL,text:async()=>respondentHtml(items)};
  posts++;
  const body=new URLSearchParams(opt.body);
  assert.equal(body.get('pageHistory'),'0,1,2,3,4');
  for(let n=1001;n<=1011;n++)assert(body.has('entry.'+n));
  assert.equal(body.has('entry.1012'),false);
  return {ok:true,status:200,url:ENDPOINT,
   text:async()=>'<html>Your response has been recorded</html>'};
 }});
 assert.equal(result.status,'page-confirmed');
 assert.equal(result.filledQuestions,11);
 assert.equal(posts,1);
});
