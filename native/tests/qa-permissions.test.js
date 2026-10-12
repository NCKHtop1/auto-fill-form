'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../lib/auth');
const forms = require('../lib/forms');
const qa = require('../lib/qa-submit');
const statusHandler = require('../api/qa-status');
const submitHandler = require('../api/qa-submit');

const formUrl = 'https://docs.google.com/forms/d/AuthorizedFixture0123/edit';
const fixture = {
 id:'AuthorizedFixture0123',
 acceptingResponses:true,
 questions:[{id:'q1',type:'multiple_choice',title:'QA fixture',
   supported:true,required:true,entryIds:['1234'],options:['A','B']}]
};

function fakeResponse() {
 return {
  code:200,headers:{},body:null,
  setHeader(name,value){this.headers[name]=value;},
  status(code){this.code=code;return this;},
  json(body){this.body=body;return this;}
 };
}
async function withMocks(mocks,fn) {
 const originals = [];
 for (const [obj,key,value] of mocks) {
  originals.push([obj,key,obj[key]]);
  obj[key]=value;
 }
 try { return await fn(); }
 finally { for (const [obj,key,value] of originals.reverse()) obj[key]=value; }
}
function authorized(sessionEmail='editor@example.com') {
 return [
  [auth,'configured',()=>true],
  [auth,'session',async()=>({email:sessionEmail,access_token:'fake-token'})],
  [forms,'loadOwnedForm',async()=>fixture],
  [forms,'verifyResponseAccess',async()=>true]
 ];
}
test('OAuth test user alone is insufficient: signed-out sessions never enable sending',async()=>{
 await withMocks([[auth,'configured',()=>true],[auth,'session',async()=>{const e=new Error('No Google session');e.status=401;throw e;}]],async()=>{
  const res=fakeResponse();
  await statusHandler({method:'GET',query:{formUrl}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.signedIn,false);
  assert.equal(res.body.canSend,false);
 });
});
test('Form editor with response-reading permission can send without global admin allowlists',async()=>{
 await withMocks(authorized(),async()=>{
  const res=fakeResponse();
  await statusHandler({method:'GET',query:{formUrl}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.signedIn,true);
  assert.equal(res.body.formAllowed,true);
  assert.equal(res.body.canSend,true);
  assert.deepEqual(res.body.reasons,[]);
 });
});
test('Google account that cannot access the Form responses is denied',async()=>{
 const mocks=authorized().map(([o,k,v])=>[o,k,k==='verifyResponseAccess'?async()=>{throw new Error('No Google Forms response access');}:v]);
 await withMocks(mocks,async()=>{
  const res=fakeResponse();
  await statusHandler({method:'GET',query:{formUrl}},res);
  assert.equal(res.code,200);
  assert.equal(res.body.signedIn,true);
  assert.equal(res.body.canSend,false);
  assert.equal(res.body.formAllowed,false);
  assert.match(res.body.reasons.join(' '),/response access/i);
 });
});
test('Unsupported form questions disable send even for an editor',async()=>{
 const f={...fixture,questions:[{...fixture.questions[0],supported:false}]};
 const mocks=authorized().map(([o,k,v])=>[o,k,k==='loadOwnedForm'?async()=>f:v]);
 await withMocks(mocks,async()=>{
  const res=fakeResponse();
  await statusHandler({method:'GET',query:{formUrl}},res);
  assert.equal(res.body.formReady,false);
  assert.equal(res.body.canSend,false);
 });
});
test('QA POST never calls sendOne without response-reading rights',async()=>{
 let sendCalls=0;
 const mocks=[
  ...authorized().map(([o,k,v])=>[o,k,k==='verifyResponseAccess'?async()=>{const e=new Error('Forbidden');e.status=403;throw e;}:v]),
  [qa,'sendOne',async()=>{sendCalls++;return {status:'page-confirmed'};}]
 ];
 await withMocks(mocks,async()=>{
  const res=fakeResponse();
  await submitHandler({
   method:'POST',headers:{},body:{formUrl,answers:{q1:'A'},confirmedTestOnly:true}
  },res);
  assert.equal(res.code,403);
  assert.equal(sendCalls,0);
 });
});
test('QA POST passes a single authorized test row to the existing guarded submission bridge',async()=>{
 let sendCalls=0;
 await withMocks([...authorized(),[qa,'sendOne',async({form,answers})=>{
  sendCalls++;assert.equal(form.id,fixture.id);assert.equal(answers.q1,'A');
  return {status:'page-confirmed',note:'Fixture response only'};
 }]],async()=>{
  const res=fakeResponse();
  await submitHandler({
   method:'POST',headers:{},body:{formUrl,answers:{q1:'A'},confirmedTestOnly:true}
  },res);
  assert.equal(res.code,200);
  assert.equal(res.body.status,'page-confirmed');
  assert.equal(sendCalls,1);
 });
});
test('QA POST requires explicit confirmation; validation fails before any external access',async()=>{
 let sent=0;
 await withMocks([...authorized(),[qa,'sendOne',async()=>{sent++;return {status:'page-confirmed'};}]],async()=>{
  const res=fakeResponse();
  await submitHandler({method:'POST',headers:{},body:{formUrl,answers:{q1:'A'},confirmedTestOnly:false}},res);
  assert.equal(res.code,400);
  assert.equal(sent,0);
 });
});