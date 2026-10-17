'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const auth=require('../lib/auth');
const forms=require('../lib/forms');
const qa=require('../lib/qa-submit');
const billing=require('../lib/billing');
const handler=require('../api/qa-submit');
const member={sub:'real-google-sub',email:'member@example.com',email_verified:true};
const fixture={id:'test-form',responderUri:'https://docs.google.com/forms/d/e/TEST123/viewform',acceptingResponses:true,
 questions:[{id:'q1',title:'Name',required:true,type:'short_text',supported:true,entryIds:['123']}]};
function response(){return {code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};}
function request(extra={}){return {method:'POST',headers:{origin:'https://pandastudy.example'},body:{
 formUrl:'https://docs.google.com/forms/d/test-form/edit',answers:{q1:'QA'},confirmedTestOnly:true,
 operationId:'6548eb1b-836d-4817-9930-9b9659164d74',...extra}};}
async function mocked(run){
 const originals=new Map();
 function replace(object,key,value){originals.set([object,key],object[key]);object[key]=value;}
 let sends=0,settlements=0,seenIdentity;
 replace(auth,'configured',()=>true);replace(auth,'session',async()=>member);
 replace(auth,'origin',()=> 'https://pandastudy.example');replace(auth,'billingIdentity',async()=>member);
 replace(forms,'loadPublicForm',async()=>fixture);replace(billing,'enabled',()=>true);
 replace(billing,'reserveSubmission',async(identity)=>{seenIdentity=identity;return {dispatch:true,claimToken:'claim'};});
 replace(billing,'settleSubmission',async()=>{settlements++;});
 replace(qa,'sendOne',async()=>{sends++;return {status:'page-confirmed',delivery:'confirmed'};});
 try{await run(()=>({sends,settlements,seenIdentity}));}
 finally{for(const [[object,key],value] of originals)object[key]=value;}
}
test('Paid API trusts server identity and charges one confirmed dispatch',async()=>mocked(async stats=>{
 const res=response();await handler(request({sub:'attacker-selected',email:'admin@example.com',credits:999}),res);
 assert.equal(res.code,200);assert.equal(res.body.status,'page-confirmed');
 assert.deepEqual(stats(),{sends:1,settlements:1,seenIdentity:member});
}));
test('Direct request without funds returns 402 and proves Google was not called',async()=>mocked(async stats=>{
 billing.reserveSubmission=async()=>{throw new billing.BillingError(402,'INSUFFICIENT_CREDITS','No credits');};
 const res=response();await handler(request(),res);
 assert.equal(res.code,402);assert.equal(res.body.delivery,'not_sent');assert.equal(res.body.code,'INSUFFICIENT_CREDITS');
 assert.equal(stats().sends,0);assert.equal(stats().settlements,0);
}));
test('Unavailable billing does not fall back to legacy free sending',async()=>mocked(async stats=>{
 billing.reserveSubmission=async()=>{throw new billing.BillingError(503,'BILLING_UNAVAILABLE','Unavailable');};
 const res=response();await handler(request(),res);
 assert.equal(res.code,503);assert.equal(res.body.delivery,'not_sent');assert.equal(stats().sends,0);
}));
test('A repeated paid operation returns its stored result without another Google POST',async()=>mocked(async stats=>{
 billing.reserveSubmission=async()=>({dispatch:false,result:{status:'page-confirmed',delivery:'confirmed'}});
 const res=response();await handler(request(),res);
 assert.equal(res.code,200);assert.equal(res.body.replayed,true);assert.equal(stats().sends,0);assert.equal(stats().settlements,0);
}));
test('Unexpected database errors do not expose connection details through the paid submission API',async()=>mocked(async stats=>{
 billing.reserveSubmission=async()=>{throw Error('postgres://fake-user:fake-private-password@private-db/account');};
 const res=response();await handler(request(),res);
 assert.equal(res.code,503);assert.equal(res.body.code,'BILLING_UNAVAILABLE');
 assert.equal(JSON.stringify(res.body).includes('fake-private-password'),false);
 assert.equal(JSON.stringify(res.body).includes('private-db'),false);assert.equal(stats().sends,0);
}));
test('Cross-origin requests are refused before dispatch or charging',async()=>mocked(async stats=>{
 const req=request();req.headers.origin='https://attacker.example';
 const res=response();await handler(req,res);
 assert.equal(res.code,403);assert.equal(stats().sends,0);assert.equal(stats().settlements,0);
}));
test('Invalid row cannot reserve or submit',async()=>mocked(async stats=>{
 let reservations=0;billing.reserveSubmission=async()=>{reservations++;throw Error('Should not reserve');};
 const res=response();await handler(request({answers:{}}),res);
 assert.equal(res.code,400);assert.equal(res.body.delivery,'not_sent');assert.equal(reservations,0);assert.equal(stats().sends,0);
}));
test('Feature off retains the existing authenticated submission with no billing identity lookup',async()=>mocked(async stats=>{
 billing.enabled=()=>false;auth.billingIdentity=async()=>{throw Error('Must not upgrade free session');};
 const res=response();await handler(request({operationId:undefined}),res);
 assert.equal(res.code,200);assert.equal(stats().sends,1);assert.equal(stats().settlements,0);assert.equal(stats().seenIdentity,undefined);
}));
