'use strict';
const crypto = require('node:crypto');
const COOKIE_NAME='ps_session';
const STATE_NAME='ps_auth_state';
// Main sign-in is identity-only. The current production workflow reads published
// Google Forms/respondent pages without requiring sensitive Forms API scopes.
// Keeping login to OpenID profile scopes avoids Google's unverified-app warning
// for ordinary users and follows least-privilege OAuth.
const OAUTH_SCOPES=['openid','email','profile'];
function configured(){return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_SESSION_SECRET && process.env.APP_SESSION_SECRET.length>=32)}
function sessionKey(){if(!configured())throw new Error('Chưa cấu hình đăng nhập Google trên Vercel.');return crypto.createHash('sha256').update('PandaStudy:v1:'+process.env.APP_SESSION_SECRET).digest()}
function seal(value){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',sessionKey(),iv);const buf=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),buf]).toString('base64url')}
function unseal(value){try{const b=Buffer.from(value,'base64url'),d=crypto.createDecipheriv('aes-256-gcm',sessionKey(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8'))}catch{return null}}
function cookies(req){const all={};String(req.headers.cookie||'').split(';').forEach(x=>{const i=x.indexOf('=');if(i>0)all[x.slice(0,i).trim()]=x.slice(i+1).trim()});return all}
function setCookie(res,name,val,age){const parts=[`${name}=${val}`,'Path=/','HttpOnly','SameSite=Lax',`Max-Age=${age}`];if(process.env.VERCEL||process.env.NODE_ENV==='production')parts.push('Secure');const existing=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(Array.isArray(existing)?existing:existing?[existing]:[]),parts.join('; ')])}
function clearCookie(res,name){setCookie(res,name,'',0)}
function origin(req){if(process.env.PUBLIC_SITE_URL)return process.env.PUBLIC_SITE_URL.replace(/\/$/,'');const host=req.headers['x-forwarded-host']||req.headers.host;const proto=req.headers['x-forwarded-proto']||(process.env.VERCEL?'https':'http');if(!host||/[^a-zA-Z0-9.:-]/.test(host))throw new Error('Tên miền không hợp lệ.');return `${proto}://${host}`}
function redirectUri(req){return origin(req)+'/api/auth/callback'}
async function tokenRequest(params){const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw new Error('Google từ chối đăng nhập. Hãy thử kết nối lại.');return d}
async function session(req,res){const data=unseal(cookies(req)[COOKIE_NAME]||'');if(!data||!data.refresh_token&&!data.access_token){const e=new Error('Hãy kết nối tài khoản Google trước.');e.status=401;throw e}if(data.expires_at>Date.now()+60000)return data;if(!data.refresh_token){const e=new Error('Phiên Google đã hết hạn. Hãy đăng nhập lại.');e.status=401;throw e}
 const refreshed=await tokenRequest({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:data.refresh_token,grant_type:'refresh_token'});
 data.access_token=refreshed.access_token;data.expires_at=Date.now()+(refreshed.expires_in||3500)*1000;setCookie(res,COOKIE_NAME,seal(data),2592000);return data}
function setSession(res,data){setCookie(res,COOKIE_NAME,seal(data),2592000)}
function hasScope(data,scope){
 const granted=String(data?.scope||'').split(/\s+/).filter(Boolean);
 return granted.includes(scope);
}
// Billing uses Google's stable subject, never an email supplied by the browser.
// Existing cookies are upgraded on demand so the current Form flow stays valid.
async function billingIdentity(req,res,existingSession){
 const data=existingSession||await session(req,res);
 const fresh=Number(data.identity_checked_at)>Date.now()-3600000;
 if(!data.sub||data.email_verified!==true||!fresh){
  let response,user;
  try{
   response=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{
    headers:{Authorization:`Bearer ${data.access_token}`},signal:AbortSignal.timeout(10000)});
   user=response.ok?await response.json():null;
  }catch{
   const e=new Error('Chưa xác minh được tài khoản Google. Hãy thử lại.');e.status=503;throw e;
  }
  if(!user||typeof user.sub!=='string'||!user.sub||user.sub.length>255||
     typeof user.email!=='string'||!user.email.includes('@')||user.email_verified!==true){
   const e=new Error('Hãy kết nối lại tài khoản Google có email đã xác minh để sử dụng lượt.');e.status=401;throw e;
  }
  if(data.sub&&data.sub!==user.sub){
   const e=new Error('Tài khoản Google không khớp phiên đăng nhập. Hãy kết nối lại.');e.status=401;throw e;
  }
  data.sub=user.sub;data.email=user.email;data.email_verified=true;data.identity_checked_at=Date.now();
  setSession(res,data);
 }
 return {sub:data.sub,email:data.email,email_verified:data.email_verified};
}
module.exports={COOKIE_NAME,STATE_NAME,OAUTH_SCOPES,configured,seal,unseal,cookies,setCookie,clearCookie,origin,redirectUri,tokenRequest,session,setSession,hasScope,billingIdentity};
