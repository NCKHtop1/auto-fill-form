'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {slugify,parseIssue} = require('../.github/scripts/publish-blog.cjs');
const payload = {title:'Làm sạch dữ liệu khảo sát',summary:'Các bước kiểm tra bộ dữ liệu khảo sát trước phân tích',category:'Dữ liệu',content:'Nội dung kiểm thử. '.repeat(12)};
const issue = {number:14,user:{login:'NCKHtop1'},title:'[PandaStudy] '+payload.title,body:'PANDASTUDY_POST_V1\n'+JSON.stringify(payload)};
test('Publishes a valid owner-authored article',() => {
  const post=parseIssue(issue);
  assert.match(post.id,/^lam-sach-du-lieu-khao-sat-14$/);
  assert.equal(post.category,'Dữ liệu');
});
test('Rejects users other than the owner',() => {
  assert.throws(()=>parseIssue({...issue,user:{login:'visitor'}}),/Only the repository owner/);
});
test('Rejects unsupported categories',() => {
  const modified={...payload,category:'Admin'};
  assert.throws(()=>parseIssue({...issue,body:'PANDASTUDY_POST_V1\n'+JSON.stringify(modified)}),/Unsupported category/);
});
test('Rejects title mismatches',() => {
  assert.throws(()=>parseIssue({...issue,title:'[PandaStudy] Khác'}),/does not match/);
});
test('Handles Vietnamese diacritics in slugs',() => {
  assert.equal(slugify('Bưởi đỏ và Ý dĩ'),'buoi-do-va-y-di');
});
