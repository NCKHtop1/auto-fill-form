'use strict';
// Count rows from a published Google Sheet without returning its private cell contents.
function exportUrl(value){
  let u;
  try{u=new URL(String(value||''));}catch{throw Error('Link Google Sheet không hợp lệ.');}
  if(u.protocol!=='https:'||u.hostname!=='docs.google.com')throw Error('Chỉ nhận link Google Sheets tại docs.google.com.');
  const m=/^\/spreadsheets\/d\/([a-zA-Z0-9_-]{15,})\/(?:edit|view)(?:\/)?$/.exec(u.pathname);
  if(!m)throw Error('Dán link Google Sheets dạng /spreadsheets/d/.../edit.');
  const gid=u.searchParams.get('gid')||(/(?:^|[&#])gid=(\d+)/.exec(u.hash)||[])[1]||'0';
  if(!/^\d{1,12}$/.test(gid))throw Error('gid của trang tính không hợp lệ.');
  return 'https://docs.google.com/spreadsheets/d/'+m[1]+'/export?format=csv&gid='+gid;
}
function countCsvRows(text){
  if(typeof text!=='string'||text.length>10000000)throw Error('Tệp CSV quá lớn để kiểm tra.');
  let inQuote=false,cell='',record=[],count=0;
  function flush(){
    record.push(cell);
    if(record.some(x=>x.trim()!==''))count++;
    record=[];cell='';
  }
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inQuote){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"')inQuote=false;
      else cell+=ch;
    }else if(ch==='"'){inQuote=true;}
    else if(ch===','){record.push(cell);cell='';}
    else if(ch==='\n'||ch==='\r'){flush();if(ch==='\r'&&text[i+1]==='\n')i++;}
    else cell+=ch;
  }
  if(inQuote)throw Error('CSV trả về chưa hoàn chỉnh.');
  if(cell||record.length)flush();
  return Math.max(0,count-1); // subtract column header
}
async function publicSheetCount(sheetUrl,fetchImpl=fetch){
  const uri=exportUrl(sheetUrl);
  let r;
  try{r=await fetchImpl(uri,{redirect:'follow',signal:AbortSignal.timeout(20000),
    headers:{Accept:'text/csv'}});}
  catch{throw Error('Không tải được Sheet công khai. Kiểm tra lại quyền chia sẻ.');}
  if(!r.ok)throw Error('Google Sheets báo lỗi '+r.status+'.');
  if(r.url){
    let final;
    try{final=new URL(r.url);}catch{throw Error('Google Sheets trả về đường dẫn không hợp lệ.');}
    if(final.protocol!=='https:' || !(final.hostname==='docs.google.com'||final.hostname.endsWith('.googleusercontent.com')))
      throw Error('Google Sheets chuyển sang nguồn không hợp lệ.');
  }
  const contentType=String(r.headers?.get?.('content-type')||'').toLowerCase();
  if(contentType && !/text\/csv|application\/octet-stream/.test(contentType))
    throw Error('Google Sheets không trả CSV công khai. Hãy bật quyền xem bằng liên kết.');
  const len=Number(r.headers?.get?.('content-length')||0);
  if(len>10000000)throw Error('Sheet quá lớn để kiểm tra nhanh.');
  const raw=await r.text();
  if(/^\s*<!doctype html|^\s*<html/i.test(raw))throw Error('Sheet yêu cầu đăng nhập, không đọc được CSV.');
  return {count:countCsvRows(raw),source:'google-sheet-public-csv',
    checkedAt:new Date().toISOString(),
    note:'Số dòng trên Sheet được chia sẻ công khai; chỉ đúng nếu Sheet này liên kết với Google Form và không có chỉnh sửa ngoài.'};
}
module.exports={exportUrl,countCsvRows,publicSheetCount};
