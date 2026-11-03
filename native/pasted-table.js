'use strict';
// Parse table data copied from Google Sheets, Excel or a Markdown table.
// This file works in both a browser and Node tests. Nothing is sent remotely.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PandaStudyTable = api;
})(typeof window === 'object' ? window : null, function () {
  function normalizeHeader(value) {
    return String(value ?? '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
      .replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
  }
  function looksTabular(raw) {
    const first = String(raw ?? '').replace(/\r\n?/g, '\n').split('\n')
      .find(line => line.trim().length) || '';
    return /^\s*\|[^|]+\|/.test(first) || first.includes('\t') || first.includes(',');
  }
  function csvRows(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        row.push(cell); cell = '';
      } else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
    if (quoted) throw new Error('Dữ liệu CSV có dấu ngoặc kép chưa được đóng.');
    row.push(cell);
    if (row.some(value => value.trim())) rows.push(row);
    return rows;
  }
  function parse(raw) {
    const text = String(raw ?? '').replace(/^\uFEFF/, '');
    if (!text.trim()) throw new Error('Hãy dán bảng dữ liệu có hàng tiêu đề trước.');
    if (text.length > 5000000) throw new Error('Bảng dán quá lớn (tối đa 5 MB). Hãy tải tệp Excel/CSV.');
    const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim());
    let matrix;
    if (/^\s*\|[^|]+\|/.test(lines[0])) {
      matrix = lines.map((line, index) => {
        const s = line.trim();
        if (!s.startsWith('|') || !s.endsWith('|')) {
          throw new Error('Dòng ' + (index + 1) + ' không đúng định dạng bảng Markdown.');
        }
        return s.slice(1, -1).split('|').map(cell => cell.trim());
      }).filter(row => !row.every(cell => /^:?-{3,}:?$/.test(cell)));
    } else if (lines[0].includes('\t')) {
      matrix = lines.map(line => line.split('\t').map(cell => cell.trim()));
    } else if (lines[0].includes(',')) {
      matrix = csvRows(text).map(row => row.map(cell => cell.trim()));
    } else {
      throw new Error('Bảng cần có hàng tiêu đề và ít nhất 2 cột, ngăn bằng Tab, dấu phẩy hoặc ký tự |.');
    }
    if (matrix.length < 2) throw new Error('Bảng chưa có dòng dữ liệu sau hàng tiêu đề.');
    const headers = matrix[0].map(value => String(value ?? '').trim());
    if (headers.length < 2 || headers.some(h => !h)) {
      throw new Error('Hãy dán cả tiêu đề và ít nhất 2 cột, ví dụ: Mã học sinh và Khối.');
    }
    const keys = headers.map(normalizeHeader);
    if (new Set(keys).size !== keys.length) {
      throw new Error('Có tên cột trùng trong bảng dán. Hãy đổi tên cột trước khi nhập.');
    }
    if (matrix.length - 1 > 100000) {
      throw new Error('Tối đa 100.000 dòng mỗi lần nhập.');
    }
    const rows = matrix.slice(1).map((cells, index) => {
      if (cells.length !== headers.length) {
        throw new Error('Dòng dữ liệu ' + (index + 2) + ' có ' + cells.length +
          ' cột, khác ' + headers.length + ' cột tiêu đề.');
      }
      return Object.fromEntries(headers.map((h, i) => [h, String(cells[i] ?? '').trim()]));
    });
    const studentColumn = headers.find(header =>
      ['ma hoc sinh', 'ma hs', 'student id', 'student code'].includes(normalizeHeader(header)));
    if (studentColumn) {
      const seen = new Map();
      for (let i = 0; i < rows.length; i++) {
        const code = rows[i][studentColumn].trim();
        if (!code) throw new Error('Thiếu mã học sinh ở dòng dữ liệu ' + (i + 2) + '.');
        const key = code.toUpperCase();
        if (seen.has(key)) {
          throw new Error('Mã học sinh "' + code + '" bị lặp ở dòng ' +
            seen.get(key) + ' và ' + (i + 2) + '.');
        }
        seen.set(key, i + 2);
      }
    }
    return { columns: headers, rows, hasStudentIds: !!studentColumn };
  }
  return { parse, looksTabular, normalizeHeader };
});
