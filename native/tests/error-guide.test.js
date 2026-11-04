'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, mailto, supportSummary, SUPPORT_EMAIL, SUPPORT_ZALO } = require('../error-guide');

test('data formats, row count, CSV, Excel and headers classify as input', () => {
  for (const message of [
    'Dòng 4 có 2 cột, khác 3 cột ở dòng đầu',
    'Không tải được thư viện Excel',
    'CSV có dấu ngoặc kép chưa đóng',
    'File chưa có dòng dữ liệu'
  ]) {
    const result = classify(message, {stage:'upload'});
    assert.equal(result.kind,'data');
    assert.match(result.action, /hàng tiêu đề|loại tệp/);
  }
});
test('validation is not blamed on user data without the actual rejected answers', () => {
  const x = classify('196 dòng chưa hợp lệ.',{stage:'validation'});
  assert.equal(x.kind,'validation');
  assert.equal(x.uncertain,true);
  assert.match(x.action,/Chưa thể kết luận/);
});
test('mapping and required selections get actionable instructions', () => {
  const x=classify('Câu A: Không tìm thấy lựa chọn XYZ',{stage:'validation'});
  assert.equal(x.kind,'mapping');
  assert.match(x.action,/Bước 3/);
});
test('auth, network, payment, server status and generic errors are distinct', () => {
  assert.equal(classify('Forbidden',{stage:'importForm',status:403}).kind,'auth');
  assert.equal(classify('Failed to fetch',{stage:'validation'}).kind,'network');
  assert.equal(classify('Số dư không đủ',{stage:'submission'}).kind,'payment');
  assert.equal(classify('Server down',{stage:'submission',status:500}).kind,'system');
  assert.equal(classify('Lỗi bất ngờ',{stage:'general'}).kind,'unknown');
});
test('unknown runtime remains uncertain and never blames customer', () => {
  const x=classify('Cannot read properties of undefined',{stage:'preview'});
  assert.equal(x.kind,'unknown');
  assert.equal(x.source,'Cần kiểm tra thêm');
});
test('support contact is grounded and reports never leak private inputs', () => {
  const issue=classify('student HS216 user@example.com token=secret123 https://docs.google.com/forms/d/SECRET/edit',{stage:'upload'});
  const text=supportSummary(issue),email=mailto(issue);
  assert.equal(issue.email,SUPPORT_EMAIL);
  assert.equal(issue.zalo,SUPPORT_ZALO);
  assert.equal(issue.email,'trangnguyen11850.marketing@gmail.com');
  assert.equal(issue.zalo,'https://zalo.me/0349222590');
  assert.ok(email.startsWith('mailto:'+SUPPORT_EMAIL+'?subject='));
  for (const secret of ['HS216','user@example.com','secret123','SECRET','docs.google.com']) {
    assert.equal(text.includes(secret),false);
    assert.equal(decodeURIComponent(email).includes(secret),false);
  }
  assert.ok(text.includes('Nhóm lỗi'));
});
test('error text remains on-screen only and classification has a bounded length', () => {
  const issue=classify('X'.repeat(10000));
  assert.equal(issue.details.length,2000);
  assert.equal(supportSummary(issue).includes('X'.repeat(50)),false);
});
