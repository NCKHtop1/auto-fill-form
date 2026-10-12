'use strict';
const auth=require('../lib/auth');
const forms=require('../lib/forms');
const qa=require('../lib/qa-submit');
const publicSheet=require('../lib/public-sheet');
function fail(res,status,message){return res.status(status).json({ok:false,error:message})}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return fail(res,405,'Chỉ hỗ trợ POST.');
  try{
    if(req.headers.origin&&req.headers.origin!==auth.origin(req))
      return fail(res,403,'Yêu cầu không cùng tên miền.');
    const data=typeof req.body==='string'?JSON.parse(req.body):req.body;
    const id=forms.formIdFromUrl(data?.formUrl);
    if(auth.configured()){
      let s;
      try{s=await auth.session(req,res)}catch{}
      if(s&&qa.allowedAdmin(s.email)){
        try{
          const count=await forms.responseCount(id,s.access_token);
          return res.status(200).json({ok:true,count,source:'google-forms-api',
            checkedAt:new Date().toISOString(),note:'Tổng phản hồi theo Google Forms API.'});
        }catch(e){
          if(!data?.sheetUrl)throw e;
        }
      }
    }
    if(data?.sheetUrl){
      const result=await publicSheet.publicSheetCount(data.sheetUrl);
      return res.status(200).json({ok:true,...result});
    }
    return fail(res,409,'Để xem số phản hồi, hãy kết nối Google quản trị hoặc dán Google Sheet được chia sẻ công khai.');
  }catch(e){
    console.error('[PandaStudy count]',e.message);
    return fail(res,e.status>=400&&e.status<=500?e.status:400,e.message||'Không đọc được số phản hồi.');
  }
};
