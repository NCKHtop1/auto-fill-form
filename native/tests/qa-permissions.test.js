'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const auth=require('../lib/auth');
const forms=require('../lib/forms');
const qa=require('../lib/qa-submit');
const sheet=require('../lib/public-sheet');
const qaStatus=require('../api/qa-status');
const qaSubmit=require('../api/qa-submit');
const qaVerify=require('../api/qa-verify');
const FORM_URL='https://docs.google.com/forms/d/Unit_test_form_123/edit';
const SHEET_URL='https://docs.google.com/spreadsheets/d/1T_gGTt8xFY_-Jylbm_Di-90J69BdNsElyv2lLNaiks8/edit?gid=1197897507';
const testForm=()=>({
 id:'Unit_test_form_123',accessMode:'public',acceptingResponses:true,
 responderUri:'https://docs.google.com/forms/d/e/1FAIpQLTestForm123/viewform',
 questions:[{id:'100',title:'Giới tính',type:'multiple_choice',required:true,
  supported:true,entryIds:['900'],options:['Nam','Nữ']}]
});
function res(){
 return {code:200,body:null,headers:{},
  setHeader(k,v){this.headers[k]=v;return this;},
  status(n){this.code=n;return this;},
  json(d){this.body=d;return this;}};
}
async function mocked(run){
 const orig={configured:auth.configured,session:auth.session,
  publicForm:forms.loadPublicForm,ownedForm:forms.loadOwnedForm,
  sendOne:qa.sendOne,sheetCount:sheet.publicSheetCount};
 let owned=0,publicRequests=0,submissions=0;
 auth.configured=()=>true;
 auth.session=async()=>({email:'user@example.com',access_token:'fake'});
 forms.loadPublicForm=async()=>{publicRequests++;return testForm();};
 forms.loadOwnedForm=async()=>{owned++;const e=new Error('Forms API returned 403');e.status=403;throw e;};
 qa.sendOne=async()=>{submissions++;return {status:'page-confirmed',note:'TEST ONLY'};};
 sheet.publicSheetCount=async()=>({count:624,source:'google-sheet-public-csv',note:'TEST ONLY'});
 try{await run(()=>({owned,publicRequests,submissions}));}finally{
  auth.configured=orig.configured;auth.session=orig.session;
  forms.loadPublicForm=orig.publicForm;forms.loadOwnedForm=orig.ownedForm;
  qa.sendOne=orig.sendOne;sheet.publicSheetCount=orig.sheetCount;
 }
}
function postBody(confirmedTestOnly=true){return {
 formUrl:FORM_URL,answers:{100:'Nam'},confirmedTestOnly};}
test('6a/6b unlock when signed in and respondent page is public even if forms.get would be 403',async()=>{
 await mocked(async hits=>{
  const r=res();
  await qaStatus({method:'GET',query:{formUrl:FORM_URL},headers:{}},r);
  assert.equal(r.code,200);
  assert.equal(r.body.canSend,true);
  assert.equal(r.body.signedIn,true);
  assert.equal(r.body.formAllowed,true);
  assert.equal(r.body.accessMode,'public');
  assert.equal(r.body.editorVerified,false);
  assert.deepEqual(r.body.reasons,[]);
  assert.deepEqual(hits(),{owned:0,publicRequests:1,submissions:0});
 });
});
test('6a posts only after OAuth and explicit QA confirmation, without forms.get',async()=>{
 await mocked(async hits=>{
  const r=res();
  await qaSubmit({method:'POST',headers:{},body:postBody()},r);
  assert.equal(r.code,200);
  assert.equal(r.body.status,'page-confirmed');
  assert.deepEqual(hits(),{owned:0,publicRequests:1,submissions:1});
 });
});
test('No Google sign-in blocks 6a/6b and direct POST',async()=>{
 await mocked(async hits=>{
  auth.session=async()=>{const e=new Error('Login required');e.status=401;throw e;};
  let r=res();
  await qaStatus({method:'GET',query:{formUrl:FORM_URL},headers:{}},r);
  assert.equal(r.body.canSend,false);
  assert.equal(r.body.signedIn,false);
  r=res();await qaSubmit({method:'POST',headers:{},body:postBody()},r);
  assert.equal(r.code,401);
  assert.deepEqual(hits(),{owned:0,publicRequests:0,submissions:0});
 });
});
test('Private or closed Form is not treated as eligible',async()=>{
 await mocked(async hits=>{
  forms.loadPublicForm=async()=>{const e=new Error('Biểu mẫu chưa được công khai.');e.status=403;throw e;};
  let r=res();await qaStatus({method:'GET',query:{formUrl:FORM_URL},headers:{}},r);
  assert.equal(r.body.canSend,false);
  assert.match(r.body.reasons.join(' '),/chưa được công khai/);
  r=res();await qaSubmit({method:'POST',headers:{},body:postBody()},r);
  assert.equal(r.code,403);
  assert.equal(hits().submissions,0);
 });
});
test('Unsupported question or missing confirmation never submits',async()=>{
 await mocked(async hits=>{
  let r=res();await qaSubmit({method:'POST',headers:{},body:postBody(false)},r);
  assert.equal(r.code,400);
  forms.loadPublicForm=async()=>({...testForm(),questions:[{...testForm().questions[0],supported:false}]});
  r=res();await qaStatus({method:'GET',query:{formUrl:FORM_URL},headers:{}},r);
  assert.equal(r.body.canSend,false);
  r=res();await qaSubmit({method:'POST',headers:{},body:postBody()},r);
  assert.equal(r.code,400);
  assert.equal(hits().submissions,0);
 });
});
test('6c chooses explicitly provided Sheet and never queries Forms API',async()=>{
 await mocked(async hits=>{
  forms.responseCount=async()=>{throw new Error('Forms API should not run');};
  const r=res();await qaVerify({method:'POST',headers:{},
   body:{formUrl:FORM_URL,sheetUrl:SHEET_URL}},r);
  assert.equal(r.code,200);
  assert.equal(r.body.count,624);
  assert.equal(r.body.source,'google-sheet-public-csv');
  assert.equal(hits().owned,0);
 });
});
