'use strict';
const auth=require('../lib/auth');
const forms=require('../lib/forms');
const publicSheet=require('../lib/public-sheet');
function fail(res,status,message){return res.status(status).json({ok:false,error:message});}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return fail(res,405,'Chỉ hỗ trợ POST.');
 try{
  if(req.headers.origin&&req.headers.origin!==auth.origin(req))
   return fail(res,403,'Yêu cầu không cùng tên miền.');
  const data=typeof req.body==='string'?JSON.parse(req.body):req.body;
  const id=forms.formIdFromUrl(data?.formUrl);
  // The connected public Sheet is an independent, reliable count source;
  // do not query the editor-only Forms API first and fail on its 403.
  let sheetError=null;
  if(data?.sheetUrl){
   try{
    const result=await publicSheet.publicSheetCount(data.sheetUrl);
    return res.status(200).json({ok:true,...result});
   }catch(e){sheetError=e;}
  }
  if(auth.configured()){
   let s;
   try{s=await auth.session(req,res);}catch{}
   if(s){
    try{
     const count=await forms.responseCount(id,s.access_token);
     return res.status(200).json({ok:true,count,source:'google-forms-api',
      checkedAt:new Date().toISOString(),note:'Tổng phản hồi theo Google Forms API.'});
    }catch(e){if(!sheetError)sheetError=e;}
   }
  }
  if(sheetError)throw sheetError;
  return fail(res,409,'Không đọc được tổng Google Form. Hãy dán Sheet phản hồi công khai để đối chiếu.');
 }catch(e){
  console.error('[PandaStudy count]',e.message);
  return fail(res,e.status>=400&&e.status<=500?e.status:400,e.message||'Không đọc được số phản hồi.');
 }
};
