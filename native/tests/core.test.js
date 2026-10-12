'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {formIdFromUrl,readArrayLiteral,mergeEntries,fromOfficialItem}=require('../lib/forms');
const {validate,fields,choice,normalizeAnswer}=require('../lib/validation');
test('only editable google form URLs are accepted',()=>{
 assert.equal(formIdFromUrl('https://docs.google.com/forms/d/Ab_c-123/edit'),'Ab_c-123');
 for(const u of ['https://evil.com/forms/d/Ab_c/edit','https://docs.google.com/forms/d/abc/viewform','http://docs.google.com/forms/d/abc/edit'])assert.throws(()=>formIdFromUrl(u));
});
test('public load data parsed without evaluating JavaScript',()=>{
 const text='var FB_PUBLIC_LOAD_DATA_ = [null,[null,[[123,"Name; field",null,0,[[555,null,1]]]]]]; next();';
 const arr=readArrayLiteral(text,'FB_PUBLIC_LOAD_DATA_');assert.equal(arr[1][1][0][4][0][0],555);
});
test('maps imported form questions to public entry ids',()=>{
 const api=[fromOfficialItem({itemId:'123',title:'Màu',questionItem:{question:{required:true,choiceQuestion:{type:'RADIO',options:[{value:'Đỏ'},{value:'Xanh'}]}}}},0)];
 const mapped=mergeEntries(api,[{itemId:'123',title:'Màu',entryIds:['987']}]);
 assert.equal(mapped[0].supported,true);assert.deepEqual(mapped[0].entryIds,['987']);
 assert.deepEqual(validate(mapped,{'123':'2'}),[]);
 assert.equal(fields(mapped,{'123':'2'}).get('entry.987'),'Xanh');
});
test('50, 100, 500 generated plan entries use same independent row validation',()=>{
 const q=[{id:'1',title:'Đồng ý?',required:true,supported:true,type:'multiple_choice',options:['Có','Không'],entryIds:['123']}];
 for(const n of [50,100,500]){const rows=Array.from({length:n},(_,i)=>({1:String((i%2)+1)}));assert.equal(rows.filter(x=>validate(q,x).length).length,0)}
});
test('checkbox grid maps multiple selections on each row',()=>{
 const q=[{id:'30',title:'Grid',required:true,supported:true,type:'checkbox_grid',rows:['A','B'],columns:['Có','Không'],entryIds:['7','8']}];
 const ans={'30':[['Có','Không'],['Không']]};
 assert.deepEqual(validate(q,ans),[]);const p=fields(q,ans);assert.deepEqual(p.getAll('entry.7'),['Có','Không']);assert.deepEqual(p.getAll('entry.8'),['Không']);
});
test('server rejects unsupported mandatory question',()=>{
 assert.equal(validate([{id:'1',title:'Tải tệp',required:true,supported:false}],{}).length,1);
});
test('numeric-coded options and Vietnamese accents',()=>{assert.equal(choice('hoan toan dong y',['Hoàn toàn đồng ý','Không đồng ý']), 'Hoàn toàn đồng ý');assert.equal(choice('2',['Hoàn toàn đồng ý','Không đồng ý']),'Không đồng ý')});
