'use strict';
const fs = require('node:fs');
const OWNER = 'NCKHtop1', REPO = 'auto-fill-form';
const POST_PATH = 'native/blog/posts.json', MARKER = 'PANDASTUDY_POST_V1\n';
const categories = new Set(['SPSS','Stata','Python','Dữ liệu','Phương pháp','Khác']);
function slugify(input) {
  return String(input).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[đĐ]/g,'d').toLowerCase().replace(/[^a-z0-9]+/g,'-')
    .replace(/^-|-$/g,'').slice(0,72).replace(/-$/,'');
}
function parseIssue(issue) {
  if (!issue || issue.user?.login !== OWNER) throw new Error('Only the repository owner may publish.');
  if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('Invalid issue number.');
  if (typeof issue.body !== 'string' || !issue.body.startsWith(MARKER)) throw new Error('Invalid PandaStudy article body.');
  if (issue.body.length > 27000) throw new Error('Article is too large.');
  const obj = JSON.parse(issue.body.slice(MARKER.length));
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid article payload.');
  const title = String(obj.title || '').trim();
  const summary = String(obj.summary || '').trim();
  const content = String(obj.content || '').trim();
  const category = String(obj.category || '').trim();
  if (title.length < 8 || title.length > 130) throw new Error('Title length must be 8-130.');
  if (summary.length < 15 || summary.length > 280) throw new Error('Summary length must be 15-280.');
  if (content.length < 80 || content.length > 18000) throw new Error('Content length must be 80-18000.');
  if (!categories.has(category)) throw new Error('Unsupported category.');
  if (issue.title !== '[PandaStudy] ' + title) throw new Error('Title does not match the issue.');
  const slug = slugify(title);
  if (!slug) throw new Error('Title must contain letters or numbers.');
  return {
    id: slug + '-' + issue.number,
    title,summary,category,date:new Date().toISOString().slice(0,10),
    cover:category==='Dữ liệu'?'Data':category==='Phương pháp'?'Method':category,
    content
  };
}
async function github(method, path, body) {
  const response = await fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + path, {
    method,
    headers: {
      'Authorization':'Bearer ' + process.env.GH_TOKEN,
      'Accept':'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
      ...(body ? {'Content-Type':'application/json'} : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('GitHub '+method+' failed ('+response.status+'): '+(result.message || 'Unknown error'));
  return result;
}
async function publish(issue, post) {
  let committed = false;
  for (let attempt=0; attempt<3; attempt++) {
    const existing = await github('GET','/contents/' + POST_PATH + '?ref=main');
    const obj = JSON.parse(Buffer.from(String(existing.content).replace(/\s/g,''),'base64').toString('utf8'));
    if (!Array.isArray(obj.posts)) throw new Error('Invalid blog archive.');
    if (obj.posts.some(p=>p.id === post.id)) { committed=true; break; }
    const next = JSON.stringify({version:1,posts:[post,...obj.posts]},null,2) + '\n';
    try {
      await github('PUT','/contents/' + POST_PATH,{
        message:'PandaStudy blog: ' + post.title.slice(0,70),
        content:Buffer.from(next,'utf8').toString('base64'),
        sha:existing.sha,branch:'main'
      });
      committed=true; break;
    } catch(err) {
      if (!/409|422/.test(err.message) || attempt===2) throw err;
    }
  }
  if (!committed) throw new Error('Could not save article.');
  const url='https://auto-fill-form-liard.vercel.app/#blog/' + post.id;
  try {
    await github('POST','/issues/' + issue.number + '/comments',{
      body:'Bài đã được lưu vào PandaStudy. Vercel sẽ cập nhật sau khi build xong.\n\n[Đọc bài trên PandaStudy](' + url + ')'
    });
    await github('PATCH','/issues/' + issue.number,{state:'closed',state_reason:'completed'});
  } catch(err) { console.warn('Article saved, issue comment not added:',err.message); }
  console.log('Published:',post.id);
}
async function main() {
  if (!process.env.GH_TOKEN) throw new Error('GitHub token is unavailable.');
  if (process.env.GH_REPO !== OWNER + '/' + REPO) throw new Error('Unexpected repository.');
  const issue = JSON.parse(fs.readFileSync(process.env.GH_EVENT_PATH,'utf8')).issue;
  await publish(issue,parseIssue(issue));
}
module.exports={slugify,parseIssue};
if (require.main===module) main().catch(err=>{console.error(err.message);process.exitCode=1;});
