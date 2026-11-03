'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, looksTabular } = require('../pasted-table');

function example216() {
  const lines = ['| Mã học   sinh | Khối |', '| ------------- | ---- |'];
  for (let i = 1; i <= 216; i++) {
    const code = 'HS' + String(i).padStart(3, '0');
    const grade = i === 214 || i === 215 || i === 7 || i === 8 ? '12' :
      (i === 216 ? '10' : ['10', '11', '12'][i % 3]);
    lines.push('| ' + code + ' | ' + grade + ' |');
  }
  return lines.join('\n');
}
test('parse a full 216-row student/grade Markdown table with intentional header spacing', () => {
  const result = parse(example216());
  assert.deepEqual(result.columns, ['Mã học   sinh', 'Khối']);
  assert.equal(result.rows.length, 216);
  assert.equal(result.hasStudentIds, true);
  assert.deepEqual(result.rows[0], {'Mã học   sinh': 'HS001', Khối: '11'});
  assert.deepEqual(result.rows[213], {'Mã học   sinh': 'HS214', Khối: '12'});
  assert.deepEqual(result.rows[214], {'Mã học   sinh': 'HS215', Khối: '12'});
  assert.deepEqual(result.rows[215], {'Mã học   sinh': 'HS216', Khối: '10'});
  assert.equal(new Set(result.rows.map(row => row['Mã học   sinh'])).size, 216);
});
test('parse tab-separated Excel / Google Sheets clipboard keeping row alignment', () => {
  const result = parse('Mã học sinh\tKhối\r\nHS001\t10\r\nHS002\t12\r\nHS216\t10');
  assert.deepEqual(result.rows, [
    {'Mã học sinh': 'HS001', 'Khối': '10'},
    {'Mã học sinh': 'HS002', 'Khối': '12'},
    {'Mã học sinh': 'HS216', 'Khối': '10'}
  ]);
});
test('parse comma CSV quoted fields and reject malformed rows and duplicates', () => {
  assert.deepEqual(parse('"Mã học sinh","Khối"\n"HS001","10"\n"HS002","12"').rows[1],
    {'Mã học sinh': 'HS002', Khối: '12'});
  assert.throws(() => parse('Mã học sinh\tKhối\nHS001\t10\nHS001\t12'), /bị lặp/);
  assert.throws(() => parse('Mã học sinh\tKhối\nHS001\t10\nHS002'), /khác 2 cột/);
  assert.throws(() => parse('Mã học sinh\tKhối\n\t10'), /Thiếu mã học sinh/);
  assert.throws(() => parse('Mã học sinh\tKhối\nHS001\t10\nHS002\t12\tX'), /khác 2 cột/);
  assert.throws(() => parse('Mã học sinh\tMã  học sinh\nHS001\t10'), /tên cột trùng/);
});
test('only recognize real tabular clipboard text', () => {
  assert.equal(looksTabular('HS001\nHS002'), false);
  assert.equal(looksTabular(example216()), true);
  assert.equal(looksTabular('Mã học sinh\tKhối\nHS001\t10'), true);
});
