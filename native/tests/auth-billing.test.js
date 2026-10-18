'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const auth=require('../lib/auth');

const originalFetch=global.fetch;
const originalEnv={...process.env};
test.before(()=>{
 process.env.GOOGLE_CLIENT_ID='test-client';process.env.GOOGLE_CLIENT_SECRET='test-secret';
 process.env.APP_SESSION_SECRET='local-test-session-secret-not-production-123456';
});
test.after(()=>{global.fetch=originalFetch;process.env=originalEnv;});
const response=()=>({headers:{},getHeader(k){return this.headers[k];},setHeader(k,v){this.headers[k]=v;}});
const session=()=>({access_token:'server-token',refresh_token:'retained-refresh',email:'old@example.com',expires_at:Date.now()+3600000});

test('Existing Google cookie upgrades to verified stable identity without changing OAuth scopes',async()=>{
 const req={headers:{},body:{sub:'client-spoof',email:'admin@example.com'}},res=response();
 let calls=0;
 global.fetch=async(url,options)=>{
  calls++;assert.equal(url,'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(options.headers.Authorization,'Bearer server-token');
  return {ok:true,json:async()=>({sub:'google-sub-123',email:'real@example.com',email_verified:true})};
 };
 const identity=await auth.billingIdentity(req,res,session());
 assert.deepEqual(identity,{sub:'google-sub-123',email:'real@example.com',email_verified:true});
 assert.equal(calls,1);
 const cookie=res.headers['Set-Cookie'][0].split(';')[0].slice('ps_session='.length);
 const upgraded=auth.unseal(cookie);
 assert.equal(upgraded.refresh_token,'retained-refresh');
 assert.equal(upgraded.sub,'google-sub-123');
 assert.equal(upgraded.email_verified,true);
 assert.deepEqual(auth.OAUTH_SCOPES,['openid','email','profile',
  'https://www.googleapis.com/auth/forms.body.readonly','https://www.googleapis.com/auth/forms.responses.readonly']);
});

test('Fresh verified claims do not add a network dependency to every billing request',async()=>{
 global.fetch=async()=>{throw Error('must not fetch');};
 const identity=await auth.billingIdentity({headers:{}},response(),{
  ...session(),sub:'stable-sub',email:'member@example.com',email_verified:true,identity_checked_at:Date.now()});
 assert.equal(identity.sub,'stable-sub');
 assert.equal(identity.email,'member@example.com');
 assert.equal(Object.hasOwn(identity,'access_token'),false);
});

test('Unverified email cannot become a billing identity',async()=>{
 global.fetch=async()=>({ok:true,json:async()=>({sub:'x',email:'admin@example.com',email_verified:false})});
 const res=response();
 await assert.rejects(auth.billingIdentity({headers:{}},res,session()),e=>e.status===401);
 assert.equal(res.headers['Set-Cookie'],undefined);
});

test('Changing Google subject in an existing session is rejected',async()=>{
 global.fetch=async()=>({ok:true,json:async()=>({sub:'different-user',email:'real@example.com',email_verified:true})});
 await assert.rejects(auth.billingIdentity({headers:{}},response(),{...session(),sub:'original-user'}),e=>e.status===401);
});

test('Identity refresh failure does not silently trust the old email',async()=>{
 global.fetch=async()=>{throw Error('timeout');};
 await assert.rejects(auth.billingIdentity({headers:{}},response(),session()),e=>e.status===503);
});
