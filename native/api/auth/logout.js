'use strict';const auth=require('../../lib/auth');
module.exports=async(req,res)=>{if(req.method!=='POST')return res.status(405).end();auth.clearCookie(res,auth.COOKIE_NAME);res.status(200).json({ok:true})};
