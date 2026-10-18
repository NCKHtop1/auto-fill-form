'use strict';
const qa=require('./qa-submit');
const billing=require('./billing');

// The claim is committed before Google is called. A repeated operation can read
// its recorded result, but it can never claim a second external dispatch.
async function submitWithCredits({identity,form,answers,operationId}){
 try{qa.prepareFields(form,answers);}
 catch(error){throw new billing.BillingError(400,'INVALID_RESPONSE',error.message);}
 const claim=await billing.reserveSubmission(identity,{operationId,formId:form.id,answers});
 if(!claim.dispatch)return {...claim.result,operationId,replayed:true};
 let result;
 try{result=await qa.sendOne({form,answers});}
 catch{
  // A thrown error is not proof that the network request did not reach Google.
  result={status:'unverified',delivery:'unknown',note:'Chưa xác định được kết quả gửi. Lượt đang chờ đối chiếu; hệ thống không tự gửi lại.'};
 }
 const outcome=result.delivery==='not_sent'?'not_sent':
  result.status==='page-confirmed'&&result.delivery==='confirmed'?'confirmed':'unknown';
 if(outcome==='unknown')result={...result,status:'unverified',delivery:'unknown'};
 try{
  await billing.settleSubmission(identity,{operationId,claimToken:claim.claimToken,result,outcome});
 }catch{
  // Keep the durable hold if the database is unavailable after dispatch.
  // Recovery is an audited reconciliation, never a second Google request.
  return {status:'unverified',delivery:'unknown',operationId,
   note:'Chưa hoàn tất đối soát lượt sau yêu cầu gửi. Hãy giữ mã '+operationId+' và kiểm tra Form/Sheet; không gửi lại dòng này.'};
 }
 return {...result,operationId};
}
module.exports={submitWithCredits};
