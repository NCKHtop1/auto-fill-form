'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const forms=require('../lib/forms');
const validation=require('../lib/validation');
const qa=require('../lib/qa-submit');
function parsed(item,index=0){return forms.fromPublicItem(item,index)}
test('Checkbox questions accept several selected answers without flattening or losing them',()=>{
 const question=parsed([991,'Các kênh sử dụng',null,4,[[889,[['Facebook'],['Website'],['Bạn bè']],1]]]);
 assert.equal(question.type,'checkbox');
 assert.equal(question.supported,true);
 const answers={'991':['Facebook','Website']};
 assert.deepEqual(validation.validate([question],answers),[]);
 assert.deepEqual(validation.fields([question],answers).getAll('entry.889'),['Facebook','Website']);
 const payload=qa.prepareFields({acceptingResponses:true,questions:[question]},answers);
 assert.deepEqual(payload.getAll('entry.889'),['Facebook','Website']);
});
test('Checkbox grids preserve multiple chosen options per row and optional text stays empty',()=>{
 const checkboxGrid=parsed([992,'Các lựa chọn theo nhóm',null,6,[
  [881,[['Có'],['Không'],['Chưa biết']],1,['Hàng A']],
  [882,[['Có'],['Không'],['Chưa biết']],1,['Hàng B']]
 ]]);
 const optional=parsed([993,'Liên hệ (tùy chọn)',null,0,[[883,null,0]]]);
 const answers={'992':[['Có','Chưa biết'],['Không']]};
 assert.deepEqual(validation.validate([checkboxGrid,optional],answers),[]);
 const params=validation.fields([checkboxGrid,optional],answers);
 assert.deepEqual(params.getAll('entry.881'),['Có','Chưa biết']);
 assert.deepEqual(params.getAll('entry.882'),['Không']);
 assert.equal(params.has('entry.883'),false);
});
test('Unknown checkbox options are rejected, and required multi-choice cannot be empty',()=>{
 const question=parsed([994,'Câu bắt buộc',null,4,[[884,[['A'],['B']],1]]]);
 assert(validation.validate([question],{'994':['A','Sai']}).length>0);
 assert(validation.validate([question],{'994':[]}).some(x=>x.includes('Thiếu')));
});
