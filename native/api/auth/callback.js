'use strict';
const auth=require('../../lib/auth');
module.exports=async(req,res)=>{
 try{
 if(req.method!=='GET')return res.status(405).end();
 const cookie=auth.unseal(auth.cookies(req)[auth.STATE_NAME]||'');auth.clearCookie(res,auth.STATE_NAME);
 if(req.query?.error)throw new Error('Bạn chưa cấp quyền truy cập Google Form.');
 if(!cookie||Date.now()>cookie.expires||req.query?.state!==cookie.state||!req.query?.code)throw new Error('Phiên đăng nhập không hợp lệ. Hãy thử lại.');
 const token=await auth.tokenRequest({code:String(req.query.code),client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:auth.redirectUri(req),grant_type:'authorization_code'});
 if(!token.access_token)throw new Error('Không lấy được quyền truy cập Google.');
 const userResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(10000)});
 const user=userResponse.ok?await userResponse.json():{};
 auth.setSession(res,{access_token:token.access_token,refresh_token:token.refresh_token||'',expires_at:Date.now()+(token.expires_in||3500)*1000,email:user.email||'',sub:typeof user.sub==='string'?user.sub:'',email_verified:user.email_verified===true,identity_checked_at:userResponse.ok?Date.now():0});
 res.writeHead(302,{Location:'/index.html#app'});res.end();
 }catch(e){res.status(400).type('html').send(`<p>${String(e.message).replace(/[<&>"']/g,'')}</p><a href="/">Quay lại PandaStudy</a>`)}};
