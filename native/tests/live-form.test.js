'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadPublicForm}=require('../lib/forms');
const {validate,fields}=require('../lib/validation');
const url='https://docs.google.com/forms/d/1RC3eFGv0NBSFxzD7PHkhaENbaXf64Lfw28K5TTjisRE/edit';

test('Real published Google Form: import and validate 50/100 rows without OAuth or submissions',{
 skip:process.env.PANDASTUDY_LIVE_TEST!=='1',timeout:45000
}, async ()=>{
 const f=await loadPublicForm(url);
 assert.equal(f.id,'1RC3eFGv0NBSFxzD7PHkhaENbaXf64Lfw28K5TTjisRE');
 assert.equal(f.accessMode,'public');
 assert.match(f.title,/trải nghiệm khách hàng số/i);
 assert.equal(f.questions.length,11,'Eight choice questions and three grids, excluding section header');
 assert.equal(f.questions.filter(q=>q.type==='multiple_choice').length,8);
 assert.equal(f.questions.filter(q=>q.type==='grid').length,3);
 assert.equal(f.supportedCount,11);
 assert.equal(f.unsupportedCount,0);
 assert(f.responderUri.startsWith('https://docs.google.com/forms/d/e/'));
 assert(f.questions.every(q=>q.entryIds.length>=1));
 const answers={};
 for(const q of f.questions){
  if(q.type==='grid')answers[q.id]=q.rows.map(()=>q.columns[0]);
  else answers[q.id]=q.options[0];
 }
 for(const n of [50,100]){
  const rows=Array.from({length:n},()=>answers);
  const invalid=rows.filter(x=>validate(f.questions,x).length);
  assert.equal(invalid.length,0,'All '+n+' test rows should validate');
 }
 // Read-only preflight of the exact respondent page: verify session fields
 // required by the 6a sender, without posting a single response.
 const response=await fetch(f.responderUri,{
  headers:{'User-Agent':'Mozilla/5.0 (compatible; PandaStudy-QA/1.0)','Accept':'text/html'},
  signal:AbortSignal.timeout(18000)
 });
 assert(response.ok,'Published Google Form respondent page must return HTTP 200');
 const {hiddenFormValues,responseUrl}=require('../lib/qa-submit');
 const hidden=hiddenFormValues(await response.text());
 assert(hidden.get('fbzx'),'Google Form must provide fbzx on the live respondent page');
 assert(hidden.has('partialResponse'),'Google Form must provide partialResponse');
 assert(responseUrl(f.responderUri).endsWith('/formResponse'));
 const mapped=fields(f.questions,answers);
 assert(mapped.size>=19,'Published respondent field IDs should be mapped');
 console.log('Verified real published form: '+f.questions.length+
  ' questions, '+f.questions.filter(q=>q.type==='grid').length+' grids, '+mapped.size+' form entry IDs; no responses submitted.');
});
