'use strict';
function isEmpty(v){return v===undefined||v===null||v===''||(Array.isArray(v)&&v.length===0)}
function norm(v){return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase().trim()}
function choice(v,choices,allowOther=false){const raw=String(v??'').trim();let found=choices.find(c=>String(c).trim()===raw);if(found!==undefined)return String(found);found=choices.find(c=>norm(c)===norm(raw));if(found!==undefined)return String(found);if(/^\d+$/.test(raw)&&Number(raw)>=1&&Number(raw)<=choices.length)return String(choices[Number(raw)-1]);if(allowOther&&raw)return raw;throw new Error('Không tìm thấy lựa chọn '+raw)}
function split(v){if(Array.isArray(v))return v.map(String).filter(x=>x.trim());if(typeof v==='string'){try{const a=JSON.parse(v);if(Array.isArray(a))return a.map(String)}catch{}return v.split(/[;|]/).map(x=>x.trim()).filter(Boolean)}return [String(v)]}
function validDate(s){
 const raw=String(s??'').trim(),m=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
 if(!m)return false;
 const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
 if(year<1||month<1||month>12||day<1)return false;
 return day<=new Date(Date.UTC(year,month,0)).getUTCDate();
}
function normalizeAnswer(q,v){if(isEmpty(v))return null;switch(q.type){
 case 'multiple_choice':case 'dropdown':return choice(v,q.options||[],!!q.allowOther);
 case 'checkbox':return split(v).map(x=>choice(x,q.options||[],!!q.allowOther));
 case 'linear_scale':case 'rating':return choice(v,q.options||[]);
 case 'grid':{const values=Array.isArray(v)?v:(q.rows||[]).map(x=>v?.[x]);if(values.length!==(q.rows||[]).length)throw new Error('Số hàng của lưới không khớp.');return values.map(x=>isEmpty(x)?'':choice(x,q.columns||[]))}
 case 'checkbox_grid':{const values=Array.isArray(v)?v:(q.rows||[]).map(x=>v?.[x]);if(values.length!==(q.rows||[]).length)throw new Error('Số hàng của lưới không khớp.');return values.map(x=>isEmpty(x)?[]:split(x).map(y=>choice(y,q.columns||[])))}
 case 'short_text':case 'paragraph':return String(v);
 case 'date':case 'datetime':if(!validDate(v))throw new Error('Ngày phải ở dạng YYYY-MM-DD.');return String(v);
 case 'time':if(!/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(String(v)))throw new Error('Giờ phải ở dạng HH:mm.');return String(v);
 case 'duration':if(!/^\d{1,3}:\d{1,2}:\d{1,2}$/.test(String(v)))throw new Error('Thời lượng phải ở dạng HH:mm:ss.');return String(v);
 default:throw new Error('Loại câu hỏi chưa được hỗ trợ.')
 }}
function validate(questions,answers){const issues=[];if(!answers||typeof answers!=='object'||Array.isArray(answers))return ['Dữ liệu câu trả lời không đúng dạng.'];for(const q of questions){if(!q.supported){if(q.required)issues.push('Câu hỏi bắt buộc chưa được hỗ trợ: '+q.title);continue}const raw=answers[q.id];if(isEmpty(raw)){if(q.required)issues.push('Thiếu câu trả lời: '+q.title);continue}try{const a=normalizeAnswer(q,raw);if(q.required&&(['grid','checkbox_grid'].includes(q.type))&&a.some(v=>isEmpty(v)))issues.push('Chưa trả lời đủ hàng: '+q.title)}catch(e){issues.push(q.title+': '+e.message)}}return issues}
function fields(questions,answers){const p=new URLSearchParams();for(const q of questions){if(!q.supported||isEmpty(answers[q.id]))continue;const answer=normalizeAnswer(q,answers[q.id]);const ids=q.entryIds||[];if(q.type==='checkbox'){for(const v of answer)p.append('entry.'+ids[0],v)}else if(q.type==='grid'){answer.forEach((v,i)=>{if(v)p.append('entry.'+ids[i],v)})}else if(q.type==='checkbox_grid'){answer.forEach((arr,i)=>arr.forEach(v=>p.append('entry.'+ids[i],v)))}else{p.append('entry.'+ids[0],String(answer))}}return p}
module.exports={isEmpty,choice,split,normalizeAnswer,validate,fields};
