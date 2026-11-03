'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, looksTabular, normalizeHeader, validateUnique, suggestColumn, detectFormat } = require('../pasted-table');
const grades = require('./fixtures/student-grade-216.json').grades;
const plain = row => Object.assign({}, row);

function example216() {
  const lines = ['| Mã học   sinh | Khối |', '| ------------- | ---- |'];
  for (let i = 1; i <= 216; i++) {
    const code = 'HS' + String(i).padStart(3, '0');
    lines.push('| ' + code + ' | ' + grades[i - 1] + ' |');
  }
  return lines.join('\n');
}

test('216-row legacy Markdown student dataset remains identical and aligned', () => {
  const data = parse(example216());
  assert.deepEqual(data.columns, ['Mã học   sinh', 'Khối']);
  assert.equal(data.rows.length, 216);
  assert.deepEqual(plain(data.rows[0]), {'Mã học   sinh': 'HS001', Khối: '10'});
  assert.deepEqual(plain(data.rows[213]), {'Mã học   sinh': 'HS214', Khối: '12'});
  assert.deepEqual(plain(data.rows[214]), {'Mã học   sinh': 'HS215', Khối: '12'});
  assert.deepEqual(plain(data.rows[215]), {'Mã học   sinh': 'HS216', Khối: '10'});
  assert.deepEqual(data.rows.map(row => Number(row.Khối)), grades);
  validateUnique(data.rows, 'Mã học   sinh');
});

test('tabular Sheets clipboard preserves row pairing, zeros, and Unicode', () => {
  const result = parse('Mã học sinh\tKhối\tGhi chú\r\nHS001\t10\t0\r\nHS002\t12\tDữ liệu thử');
  assert.deepEqual(result.columns, ['Mã học sinh','Khối','Ghi chú']);
  assert.deepEqual(plain(result.rows[0]), {'Mã học sinh':'HS001',Khối:'10','Ghi chú':'0'});
  assert.equal(result.rows[1]['Ghi chú'],'Dữ liệu thử');
});

test('single-column respondents, IDs and free-text lists are accepted', () => {
  const a = parse('Mã dự án\n0001\n0002\n0003');
  assert.equal(a.columns.length, 1);
  assert.deepEqual(a.rows.map(row => row['Mã dự án']), ['0001','0002','0003']);
  const b = parse('0001\n0002\n0003', {headerMode:'none'});
  assert.deepEqual(b.columns, ['Cột 1']);
  assert.deepEqual(b.rows.map(row => row['Cột 1']), ['0001','0002','0003']);
  assert.equal(looksTabular('0001\n0002'),false); // free-text answers must not be moved
});

test('headerless two and three column data generate safe generic column names', () => {
  const a = parse('001\t11\n002\t12', {headerMode:'none'});
  assert.deepEqual(a.columns, ['Cột 1','Cột 2']);
  assert.deepEqual(plain(a.rows[0]), {'Cột 1':'001','Cột 2':'11'});
  const b = parse('A,B,C\n1,2,3', {headerMode:'none'});
  assert.equal(b.rows.length,2);
  assert.equal(b.rows[1]['Cột 3'],'3');
});

test('CSV double quotes, commas, and multiline cells parse without splitting rows', () => {
  const a = parse('Name,Comment\n"Anna, B","Line one\nLine two"\n"Ben","Says ""Hello"""');
  assert.equal(a.rows.length,2);
  assert.equal(a.rows[0].Name,'Anna, B');
  assert.equal(a.rows[0].Comment,'Line one\nLine two');
  assert.equal(a.rows[1].Comment,'Says "Hello"');
});

test('semicolon-delimited locale CSV with comma decimals is supported', () => {
  const a = parse('Tên;Điểm;Ghi chú\nBình;10,5;"Đạt; kiểm tra"\nLan;9,0;Có');
  assert.equal(a.format,'semicolon');
  assert.equal(a.rows[0]['Điểm'],'10,5');
  assert.equal(a.rows[0]['Ghi chú'],'Đạt; kiểm tra');
});

test('tab-delimited multiline quoted spreadsheet cells preserve newline', () => {
  const a = parse('ID\tNote\n001\t"first\nsecond"\n002\tother');
  assert.equal(a.rows.length,2);
  assert.equal(a.rows[0].Note, 'first\nsecond');
});

test('Markdown escaped pipe and alignment row', () => {
  const a = parse('| Nhóm | Ghi chú |\n|:---|---:|\n| A | chứa \\| bên trong |\n| B | 20 |');
  assert.equal(a.rows.length,2);
  assert.equal(a.rows[0]['Ghi chú'],'chứa | bên trong');
});

test('pasted JSON list of objects supports arbitrary fields; no special ID rules', () => {
  const a = parse('[{"invoice":"0007","amount":200},{"invoice":"0008","amount":0,"region":"Hà Nội"}]');
  assert.equal(a.format,'json');
  assert.deepEqual(a.columns,['invoice','amount','region']);
  assert.equal(a.rows[0].invoice,'0007');
  assert.equal(a.rows[1].amount,'0');
  assert.equal(a.rows[0].region,'');
});

test('repeated IDs allowed by default; optional key catches duplicates and empty cells', () => {
  const a = parse('Mã học sinh\tLớp\nA\t1\nA\t1');
  assert.equal(a.rows.length,2); // no hidden hardcoded uniqueness
  assert.throws(() => validateUnique(a.rows,'Mã học sinh'), /bị lặp/);
  const b = parse('Name,Email\nAlice,alice@example.org\nBob,');
  assert.throws(() => validateUnique(b.rows,'Email'), /trống/);
  assert.equal(validateUnique(a.rows,'' ).valid, true);
});

test('ambiguous fuzzy labels never silently auto-map to the wrong question', () => {
  assert.equal(normalizeHeader('Mã  học sinh:'),'ma hoc sinh');
  assert.equal(suggestColumn('Mã học sinh:', ['Mã  học sinh','Khối']), 'Mã  học sinh');
  assert.equal(suggestColumn('Mã:', ['Mã đặt hàng', 'Mã khách hàng']), '');
  assert.equal(suggestColumn('Tên người trả lời', ['Họ tên','Tên người trả lời']), 'Tên người trả lời');
  assert.equal(suggestColumn('Khảo sát nhân sự', ['Tuổi','Giới tính']), '');
  assert.equal(suggestColumn('Bảng Likert','Bảng Likert / Hài lòng',['Bảng Likert / Hài lòng']), '');
  assert.equal(suggestColumn('Lưới',['Lưới / Chất lượng','Khác'], 'Chất lượng'), 'Lưới / Chất lượng');
});

test('invalid row width, duplicate headers, missing header, oversized data fail explicitly', () => {
  assert.throws(() => parse('A\tB\n1\t2\n3'), /3.*1 cột|Dòng 3/);
  assert.throws(() => parse('Mã học sinh\tMã  học sinh\nHS001\t10'), /Tên cột trùng/);
  assert.throws(() => parse('\tB\n1\t2'), /Tên cột đang trống/);
  assert.throws(() => parse('A,B\n"foo,bar'), /ngoặc kép/);
  assert.throws(() => parse('A'), /Chưa có dòng dữ liệu/);
  assert.throws(() => parse('X'.repeat(5000001)), /5 MB/);
  assert.throws(() => parse('a,b\n1,2,3'), /dấu phân cách/);
});

test('manual format selection handles exotic separators and disabled header', () => {
  const a = parse('A|B\n1|2', {format:'pipe'});
  assert.equal(a.rows[0].B,'2');
  const b = parse('first item\nsecond item', {format:'lines',headerMode:'none'});
  assert.deepEqual(b.rows.map(x=>x['Cột 1']),['first item','second item']);
  assert.equal(detectFormat('A;B\n1;2'),'semicolon');
  assert.equal(detectFormat('A\tB\n1\t2'),'tsv');
  assert.equal(detectFormat('Simple header\nvalue'),'lines');
});

test('unsupported JSON nested objects and unsafe column names fail rather than corrupt', () => {
  assert.throws(() => parse('[{"A":{"nested":true}}]'), /lồng nhau/);
  assert.throws(() => parse('[{"__proto__":"x","B":"y"}]'), /không an toàn/);
  assert.throws(() => parse('A,B\nfoo'), /Dòng 2/);
});
