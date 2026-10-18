'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const billing=require('../lib/billing');
const qa=require('../lib/qa-submit');
const {submitWithCredits}=require('../lib/billed-submit');
const identity={sub:'test-user',email:'user@example.com',email_verified:true};
const form={id:'test-form',responderUri:'https://docs.google.com/forms/d/e/TEST123/viewform',acceptingResponses:true,
 questions:[{id:'q1',title:'Name',required:true,type:'short_text',supported:true,entryIds:['123']}]};
const args={identity,form,answers:{q1:'Test'},operationId:'669b0c74-0ff4-4a88-ae74-3d090f1e3dc0'};
async function mocked(run){
 const original={reserve:billing.reserveSubmission,settle:billing.settleSubmission,send:qa.sendOne};
 const events=[];
 billing.reserveSubmission=async()=>{events.push('reserve');return {dispatch:true,claimToken:'claim'};};
 billing.settleSubmission=async(_,data)=>{events.push(['settle',data]);};
 qa.sendOne=async()=>{events.push('send');return {status:'page-confirmed',delivery:'confirmed',note:'TEST'};};
 try{await run(events);}finally{billing.reserveSubmission=original.reserve;billing.settleSubmission=original.settle;qa.sendOne=original.send;}
}
test('Validates row before reserving credits or calling Google',async()=>mocked(async events=>{
 await assert.rejects(submitWithCredits({...args,answers:{}}));assert.deepEqual(events,[]);
}));
test('Reservation commits before dispatch; confirmed response settles exactly once',async()=>mocked(async events=>{
 const result=await submitWithCredits(args);
 assert.equal(result.status,'page-confirmed');assert.equal(result.operationId,args.operationId);
 assert.deepEqual(events.slice(0,2),['reserve','send']);
 assert.equal(events[2][1].outcome,'confirmed');assert.equal(events[2][1].claimToken,'claim');assert.equal(events.length,3);
}));
test('Repeated operation only returns the stored result',async()=>mocked(async events=>{
 billing.reserveSubmission=async()=>({dispatch:false,result:{status:'page-confirmed',delivery:'confirmed'}});
 const result=await submitWithCredits(args);assert.equal(result.replayed,true);assert.deepEqual(events,[]);
}));
test('Insufficient credits never reaches Google',async()=>mocked(async events=>{
 billing.reserveSubmission=async()=>{const e=Error('Insufficient');e.status=402;throw e;};
 await assert.rejects(submitWithCredits(args),e=>e.status===402);assert.deepEqual(events,[]);
}));
test('A proven pre-POST failure releases the reservation',async()=>mocked(async events=>{
 qa.sendOne=async()=>({status:'failed',delivery:'not_sent'});
 await submitWithCredits(args);assert.equal(events[1][1].outcome,'not_sent');
}));
test('An HTTP failure without proof of no dispatch must remain unknown',async()=>mocked(async events=>{
 qa.sendOne=async()=>({status:'failed',note:'HTTP 500'});
 await submitWithCredits(args);assert.equal(events[1][1].outcome,'unknown');
}));
test('Thrown network failure is held for review and never retried',async()=>mocked(async events=>{
 let sends=0;qa.sendOne=async()=>{sends++;throw Error('timeout');};
 const result=await submitWithCredits(args);assert.equal(result.status,'unverified');assert.equal(sends,1);
 assert.equal(events[1][1].outcome,'unknown');
}));
test('Database failure after Google confirms never reports a refund or dispatches again',async()=>mocked(async events=>{
 billing.settleSubmission=async()=>{throw Error('database unavailable');};
 const result=await submitWithCredits(args);
 assert.equal(result.status,'unverified');assert.equal(result.delivery,'unknown');
 assert.equal(result.operationId,args.operationId);assert.deepEqual(events,['reserve','send']);
}));
