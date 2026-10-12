'use strict';
const crypto=require('node:crypto');const auth=require('../../lib/auth');
module.exports=async(req,res)=>{
 try{if(req.method!=='GET')return res.status(405).end();if(!auth.configured())return res.status(503).send('Chưa cấu hình Google OAuth. Cần GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET và APP_SESSION_SECRET trong Vercel.');
 const state=crypto.randomBytes(24).toString('base64url');auth.setCookie(res,auth.STATE_NAME,auth.seal({state,expires:Date.now()+600000}),600);
 const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.searchParams.set('client_id',process.env.GOOGLE_CLIENT_ID);u.searchParams.set('redirect_uri',auth.redirectUri(req));u.searchParams.set('response_type','code');u.searchParams.set('scope',auth.OAUTH_SCOPES.join(' '));u.searchParams.set('access_type','offline');u.searchParams.set('prompt','consent');u.searchParams.set('state',state);res.writeHead(302,{Location:u.href});res.end();
 }catch(e){res.status(500).send(e.message)}};
