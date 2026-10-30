define([], function () {
  'use strict';

  // Export for every list in EquipRite Next: CSV, Excel (.xlsx), PDF (the print dialog, Save as PDF) and Copy
  // (tab-separated, pastes into Excel or an email). Exactly what the list shows: its filter, its columns, its order.
  // No library: the .xlsx is written here (a zip of the Office Open XML parts, stored, with CRC-32).
  //
  // Columns: [{ key, label, value?: (row) => any, type?: 'text' | 'number' }]. A column's value is value(row) when
  // given, else row[key]. Numbers stay numbers in Excel; everything else is text.
  //
  // Safety: a text cell starting with = + - @ (or a tab/CR) is prefixed with ' so a spreadsheet never runs it as a
  // formula (CSV/formula injection).

  var RISKY = /^[=+\-@\t\r]/;

  function value(row, col) {
    var v = typeof col.value === 'function' ? col.value(row) : (row ? row[col.key] : '');
    return v === undefined || v === null ? '' : v;
  }

  function isNumber(v, col) {
    return typeof v === 'number' && isFinite(v) && (!col || col.type !== 'text');
  }

  function safeText(v) {
    var s = String(v);
    return RISKY.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
  }

  /** Header and body cells as the export sees them. */
  function table(rows, columns) {
    var cols = columns || [];
    return {
      head: cols.map(function (c) { return c.label || c.key; }),
      body: (rows || []).map(function (r) { return cols.map(function (c) { return value(r, c); }); })
    };
  }

  /** CSV with a byte-order mark (Excel reads UTF-8), CRLF lines, quotes doubled. */
  function csv(rows, columns) {
    var t = table(rows, columns);
    var cell = function (v, i) {
      var s = isNumber(v, columns[i]) ? String(v) : safeText(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + [t.head.map(function (h) { return cell(h, -1); })]
      .concat(t.body.map(function (r) { return r.map(cell); }))
      .map(function (r) { return r.join(','); }).join('\r\n') + '\r\n';
  }

  /** Tab-separated text for the clipboard. */
  function tsv(rows, columns) {
    var t = table(rows, columns);
    var cell = function (v, i) { return (isNumber(v, columns[i]) ? String(v) : safeText(v)).replace(/[\t\r\n]+/g, ' '); };
    return [t.head.map(function (h) { return cell(h, -1); })].concat(t.body.map(function (r) { return r.map(cell); }))
      .map(function (r) { return r.join('\t'); }).join('\n');
  }

  // ── .xlsx ────────────────────────────────────────────────────────────────────────────────────────────────────
  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  }());

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(s) { return new TextEncoder().encode(s); }

  /** A zip of { name: string } entries, stored (no compression). */
  function zip(files) {
    var parts = [];
    var central = [];
    var offset = 0;
    var le = function (n, size) { var b = []; for (var i = 0; i < size; i++) b.push((n >>> (8 * i)) & 0xFF); return b; };
    Object.keys(files).forEach(function (name) {
      var data = utf8(files[name]);
      var nameBytes = utf8(name);
      var crc = crc32(data);
      var header = [].concat(le(0x04034b50, 4), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2),
        le(crc, 4), le(data.length, 4), le(data.length, 4), le(nameBytes.length, 2), le(0, 2));
      parts.push(new Uint8Array(header), nameBytes, data);
      central.push([[].concat(le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x0800, 2), le(0, 2), le(0, 2), le(0x21, 2),
        le(crc, 4), le(data.length, 4), le(data.length, 4), le(nameBytes.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2),
        le(0, 4), le(offset, 4)), nameBytes]);
      offset += header.length + nameBytes.length + data.length;
    });
    var cdStart = offset;
    var cdSize = 0;
    central.forEach(function (c) {
      var head = new Uint8Array(c[0]);
      parts.push(head, c[1]);
      cdSize += head.length + c[1].length;
    });
    var n = central.length;
    parts.push(new Uint8Array([].concat(le(0x06054b50, 4), le(0, 2), le(0, 2), le(n, 2), le(n, 2), le(cdSize, 4), le(cdStart, 4), le(0, 2))));
    var total = parts.reduce(function (s, p) { return s + p.length; }, 0);
    var out = new Uint8Array(total);
    var at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }

  function xml(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; })
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  function colName(i) {
    var s = '';
    for (var n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  function sheetName(name) {
    return String(name || 'Sheet1').replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31) || 'Sheet1';
  }

  /** An .xlsx workbook (bytes): one sheet, bold frozen header with a filter, columns sized to their content. */
  function xlsx(rows, columns, name) {
    var t = table(rows, columns);
    var sheet = sheetName(name);
    var widths = t.head.map(function (h, i) {
      return Math.min(60, Math.max(8, String(h).length + 2, t.body.reduce(function (m, r) { return Math.max(m, String(r[i]).length + 2); }, 0)));
    });
    var rowXml = function (cells, r, head) {
      return '<row r="' + r + '">' + cells.map(function (v, i) {
        var ref = colName(i) + r;
        if (!head && isNumber(v, columns[i])) return '<c r="' + ref + '"><v>' + v + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"' + (head ? ' s="1"' : '') + '><is><t xml:space="preserve">' + xml(head ? v : safeText(v)) + '</t></is></c>';
      }).join('') + '</row>';
    };
    var last = colName(Math.max(0, t.head.length - 1)) + (t.body.length + 1);
    var files = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '</Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>',
      'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets><sheet name="' + xml(sheet) + '" sheetId="1" r:id="rId1"/></sheets>'
        + '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'' + xml(sheet.replace(/'/g, "''")) + '\'!$A$1:$'
        + last.replace(/(\d+)$/, '$$$1') + '</definedName></definedNames></workbook>',
      'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + '</Relationships>',
      'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>',
      'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + '<cols>' + widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>'
        + '<sheetData>' + rowXml(t.head, 1, true) + t.body.map(function (r, i) { return rowXml(r, i + 2, false); }).join('') + '</sheetData>'
        + '<autoFilter ref="A1:' + last + '"/></worksheet>'
    };
    return zip(files);
  }

  // ── PDF (print) ──────────────────────────────────────────────────────────────────────────────────────────────
  /** A printable page: title, what was exported and when, the table; landscape when wide. */
  function printHtml(title, subtitle, rows, columns, when) {
    var t = table(rows, columns);
    var esc = function (s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>'
      + '@page { size: ' + (t.head.length > 6 ? 'A4 landscape' : 'A4') + '; margin: 12mm; }'
      + 'body { font: 10pt/1.35 "Oracle Sans", "Segoe UI", Arial, sans-serif; color: #111827; }'
      + 'h1 { font-size: 15pt; margin: 0 0 2px; } p { margin: 0 0 10px; color: #475569; }'
      + 'table { width: 100%; border-collapse: collapse; } th { text-align: left; background: #f1f5f9; }'
      + 'th, td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; } tr { break-inside: avoid; }'
      + 'td.n { text-align: right; font-variant-numeric: tabular-nums; }'
      + '</style></head><body><h1>' + esc(title) + '</h1><p>' + esc(subtitle || '') + (subtitle ? ' · ' : '') + t.body.length
      + (t.body.length === 1 ? ' row' : ' rows') + ' · ' + esc(when || '') + '</p><table><thead><tr>'
      + t.head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + t.body.map(function (r) {
        return '<tr>' + r.map(function (v, i) { return '<td' + (isNumber(v, columns[i]) ? ' class="n"' : '') + '>' + esc(v) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></body></html>';
  }

  /** 'equiprite-requests-2026-10-30.xlsx' */
  function fileName(base, ext, d) {
    var day = (d || new Date()).toISOString().slice(0, 10);
    return 'equiprite-' + String(base || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + day + '.' + ext;
  }

  // ── In the browser ───────────────────────────────────────────────────────────────────────────────────────────
  function download(name, mime, data) {
    var blob = new Blob([data], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function printDocument(html) {
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    var doc = frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(function () {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(function () { frame.remove(); }, 2000);
    }, 250);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  /**
   * Runs one export: format 'csv' | 'xlsx' | 'pdf' | 'copy'; opts { name, title, subtitle, rows, columns }.
   * Resolves { ok, message } in words for a toast.
   */
  function run(format, opts) {
    var o = opts || {};
    var rows = o.rows || [];
    var cols = o.columns || [];
    var n = rows.length + (rows.length === 1 ? ' row' : ' rows');
    try {
      if (!cols.length) return Promise.resolve({ ok: false, message: 'Nothing to export.' });
      if (format === 'csv') {
        download(fileName(o.name, 'csv'), 'text/csv;charset=utf-8', csv(rows, cols));
        return Promise.resolve({ ok: true, message: n + ' exported to CSV.' });
      }
      if (format === 'xlsx') {
        download(fileName(o.name, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsx(rows, cols, o.title || o.name));
        return Promise.resolve({ ok: true, message: n + ' exported to Excel.' });
      }
      if (format === 'pdf') {
        printDocument(printHtml(o.title || o.name, o.subtitle, rows, cols, new Date().toLocaleString()));
        return Promise.resolve({ ok: true, message: 'Choose "Save as PDF" in the print dialog.' });
      }
      if (format === 'copy') {
        return copyText(tsv(rows, cols)).then(function (ok) {
          return ok ? { ok: true, message: n + ' copied. Paste into Excel or an email.' } : { ok: false, message: 'The clipboard is not available here.' };
        });
      }
    } catch (e) {
      return Promise.resolve({ ok: false, message: 'The export failed: ' + (e && e.message ? e.message : e) });
    }
    return Promise.resolve({ ok: false, message: 'Unknown export format.' });
  }

  return {
    FORMATS: [
      { key: 'xlsx', label: 'Excel (.xlsx)', icon: 'oj-ux-ico-file-excel' },
      { key: 'csv', label: 'CSV', icon: 'oj-ux-ico-file-csv' },
      { key: 'pdf', label: 'PDF (print)', icon: 'oj-ux-ico-file-pdf' },
      { key: 'copy', label: 'Copy rows', icon: 'oj-ux-ico-copy' }
    ],
    table: table,
    csv: csv,
    tsv: tsv,
    xlsx: xlsx,
    zip: zip,
    crc32: crc32,
    printHtml: printHtml,
    fileName: fileName,
    run: run
  };
});
