'use strict';
// Generic, deterministic clipboard import for arbitrary Google Forms.
// No special meaning is assigned to student IDs, usernames or any column name.
// Node + browser compatible; import never sends data to a remote server.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PandaStudyTable = api;
})(typeof window === 'object' ? window : null, function () {
  const MAX_CHARS = 5000000;
  const MAX_ROWS = 100000;
  const SEP = { tsv: '\t', csv: ',', semicolon: ';', pipe: '|' };
  const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

  function normalizeHeader(value) {
    return String(value ?? '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
      .replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
  }

  function looksTabular(raw) {
    const text = String(raw ?? '').replace(/^\uFEFF/, '').trim();
    if (!text) return false;
    const first = text.replace(/\r\n?/g, '\n').split('\n').find(line => line.trim()) || '';
    return /^\s*\|.*\|\s*$/.test(first) ||
      first.includes('\t') || first.includes(';') || first.includes(',');
  }

  function delimiterCount(line, separator) {
    let quoted = false, count = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (quoted && line[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (line[i] === separator && !quoted) count++;
    }
    return count;
  }

  function detectFormat(text) {
    const head = text.replace(/\r\n?/g, '\n').split('\n').find(line => line.trim()) || '';
    if (/^\s*[\[{]/.test(text.trim())) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) || (parsed && typeof parsed === 'object' && Array.isArray(parsed.data))) return 'json';
      } catch (_) {}
    }
    if (/^\s*\|.*\|\s*$/.test(head)) return 'markdown';
    if (head.includes('\t')) return 'tsv';
    const counts = ['semicolon', 'csv', 'pipe'].map(mode =>
      ({ mode, count: delimiterCount(head, SEP[mode]) }));
    counts.sort((a, b) => b.count - a.count);
    return counts[0].count ? counts[0].mode : 'lines';
  }

  // RFC-4180 style quoting also works with tabs, semicolons and pipes.
  // Embedded newlines inside quoted values are not discarded.
  function delimitedRows(text, delimiter) {
    let cell = '', row = [], rows = [], quoted = false, started = false;
    const push = () => {
      row.push(cell);
      if (row.some(value => String(value).trim())) rows.push(row);
      row = []; cell = ''; started = false;
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else if (quoted) quoted = false;
        else if (!cell.trim()) quoted = true;
        else cell += ch;
        started = true;
      } else if (ch === delimiter && !quoted) {
        row.push(cell); cell = ''; started = true;
      } else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        push();
      } else {
        cell += ch; started = true;
      }
    }
    if (quoted) throw new Error('Dữ liệu có dấu ngoặc kép chưa đóng. Kiểm tra ô chứa xuống dòng.');
    if (started || cell || row.length) push();
    return rows;
  }

  function markdownRows(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n').filter(line => line.trim());
    const rows = lines.map((line, index) => {
      const src = line.trim();
      if (!src.startsWith('|') || !src.endsWith('|')) {
        throw new Error('Dòng Markdown ' + (index + 1) + ' chưa đúng định dạng | cột | cột |.');
      }
      const values = [], inner = src.slice(1, -1);
      let cell = '', escaped = false;
      for (const ch of inner) {
        if (escaped) {
          cell += ch === '|' || ch === '\\' ? ch : '\\' + ch;
          escaped = false;
        } else if (ch === '\\') escaped = true;
        else if (ch === '|') { values.push(cell.trim()); cell = ''; }
        else cell += ch;
      }
      if (escaped) cell += '\\';
      values.push(cell.trim());
      return values;
    });
    if (rows.length > 1 &&
        rows[1].every(cell => /^:?-{3,}:?$/.test(cell.trim()))) rows.splice(1, 1);
    return rows;
  }

  function validHeader(columns) {
    const seen = new Set();
    for (const name of columns) {
      const key = normalizeHeader(name);
      if (!key) throw new Error('Tên cột đang trống. Chọn "Không có tiêu đề" hoặc sửa hàng đầu.');
      if (FORBIDDEN.has(name)) throw new Error('Tên cột không an toàn: ' + name);
      if (seen.has(key)) throw new Error('Tên cột trùng nhau: "' + name + '". Hãy sửa tên cột.');
      seen.add(key);
    }
  }

  function jsonRows(raw) {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (error) { throw new Error('JSON không hợp lệ: ' + error.message); }
    let list = Array.isArray(parsed) ? parsed : parsed?.data;
    if (!Array.isArray(list) || !list.length) throw new Error('JSON phải là mảng các bản ghi có dữ liệu.');
    if (list.length > MAX_ROWS) throw new Error('Giới hạn ' + MAX_ROWS + ' dòng mỗi lần nhập.');
    if (!list.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
      throw new Error('JSON cần là mảng đối tượng (mỗi đối tượng là một dòng).');
    }
    const headers = Array.from(new Set(list.flatMap(item => Object.keys(item))));
    validHeader(headers);
    const rows = list.map((item, index) => {
      const row = Object.create(null);
      for (const h of headers) {
        const value = item[h] ?? '';
        if (value !== null && typeof value === 'object') {
          throw new Error('Dữ liệu JSON lồng nhau ở dòng ' + (index + 1) +
            ', cột "' + h + '". Hãy chuyển sang giá trị đơn.');
        }
        row[h] = String(value);
      }
      return row;
    });
    return { columns: headers, rows, format: 'json', headerMode: 'first' };
  }

  function parse(raw, options) {
    const text = String(raw ?? '').replace(/^\uFEFF/, '');
    const cfg = options || {};
    const requested = cfg.format || 'auto';
    const headerMode = cfg.headerMode || 'first';
    if (!text.trim()) throw new Error('Chưa có dữ liệu. Dán hoặc tải bảng trước.');
    if (text.length > MAX_CHARS) throw new Error('Bảng vượt 5 MB. Hãy dùng tệp Excel/CSV.');
    if (!['first', 'none'].includes(headerMode)) throw new Error('Chế độ tiêu đề không hợp lệ.');
    const format = requested === 'auto' ? detectFormat(text) : requested;
    if (!['json', 'markdown', 'tsv', 'csv', 'semicolon', 'pipe', 'lines'].includes(format)) {
      throw new Error('Định dạng bảng không được hỗ trợ: ' + format);
    }
    if (format === 'json') return jsonRows(text);
    const matrix = format === 'markdown' ? markdownRows(text) :
      format === 'lines' ? text.replace(/\r\n?/g, '\n').split('\n')
        .filter(line => line.trim()).map(line => [line.trim()]) :
        delimitedRows(text, SEP[format]);
    if (!matrix.length) throw new Error('Không tìm thấy hàng dữ liệu.');
    const width = matrix[0].length;
    if (matrix.some(row => row.length !== width)) {
      const position = matrix.findIndex(row => row.length !== width);
      throw new Error('Dòng ' + (position + 1) + ' có ' + matrix[position].length +
        ' cột, khác ' + width + ' cột ở dòng đầu. Chọn đúng dấu phân cách hoặc sửa dữ liệu.');
    }
    const headers = headerMode === 'first' ? matrix[0].map(v => String(v).trim()) :
      Array.from({ length: width }, (_, i) => 'Cột ' + (i + 1));
    validHeader(headers);
    const cells = headerMode === 'first' ? matrix.slice(1) : matrix;
    if (!cells.length) throw new Error('Chưa có dòng dữ liệu. Nếu dòng đầu là dữ liệu, chọn "Không có tiêu đề".');
    if (cells.length > MAX_ROWS) throw new Error('Giới hạn ' + MAX_ROWS + ' dòng mỗi lần nhập.');
    const rows = cells.map(items => {
      const row = Object.create(null);
      headers.forEach((h, i) => { row[h] = String(items[i] ?? '').trim(); });
      return row;
    });
    return { columns: headers, rows, format, headerMode };
  }

  function validateUnique(rows, column) {
    if (!column) return { valid: true };
    if (!Array.isArray(rows) || !rows.length || !Object.hasOwn(rows[0], column)) {
      throw new Error('Chọn lại cột khóa duy nhất trong bảng hiện tại.');
    }
    const seen = new Map();
    rows.forEach((row, i) => {
      const value = String(row[column] ?? '').trim();
      if (!value) throw new Error('Cột khóa "' + column + '" trống tại dòng dữ liệu ' + (i + 1) + '.');
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) {
        throw new Error('Giá trị "' + value + '" trong cột "' + column +
          '" bị lặp ở dòng dữ liệu ' + seen.get(key) + ' và ' + (i + 1) + '.');
      }
      seen.set(key, i + 1);
    });
    return { valid: true };
  }

  // Strict automatic mapping: a normalized exact title matches only one column.
  // A partial match can silently corrupt survey data and must be mapped manually.
  function suggestColumn(questionTitle, columns, rowTitle) {
    const key = normalizeHeader(rowTitle || questionTitle);
    const combined = normalizeHeader(rowTitle ?
      String(questionTitle) + ' ' + String(rowTitle) : questionTitle);
    for (const target of rowTitle ? [combined, key] : [key]) {
      const hits = columns.filter(col => normalizeHeader(col) === target);
      if (hits.length === 1) return hits[0];
    }
    return '';
  }

  return { parse, looksTabular, normalizeHeader, validateUnique, suggestColumn, detectFormat };
});
