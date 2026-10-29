define(['jspdf'], function (jspdfModule) {
  'use strict';

  // 'jspdf' is an app-flow.json requirejs path (cdnjs 4.0.0, UMD). Declared as
  // a dependency rather than read off window so this module fails loudly at
  // load time if the path is ever dropped, matching request-quote-page.js.
  var jsPDF = jspdfModule.jsPDF;

  // ── Pick Slip document builder ────────────────────────────────────────────
  //
  // The pick slip is the INTERNAL warehouse worksheet printed at Release for
  // Picking: it exists to be carried into the yard, marked up by hand during
  // the walk, and thrown away. That single fact drives every decision below —
  // most visibly the sort order (see sortForWalk).
  //
  // Why EquipRite generates this at all: Oracle Fusion Shipping already prints
  // a Pick Slip via BI Publisher, but ONLY where a Transfer Order and delivery
  // exist, and TO creation is gated on the item's Fusion stockable/transactable
  // flags. Non-stockable equipment, transactable-only lines with no TO, and
  // customers who do not track equipment as stock get no Fusion paperwork at
  // all. Those lines still have to be walked out and loaded.
  //
  // Pure functions only — no VB $context, no Actions.callRest. A plain JS
  // module cannot reach a service-catalog endpoint (proxy, auth, forceProxy)
  // the way an action chain can, so PrintPickSlipChain does the fetching and
  // hands the assembled rows in here. Same split as resources/js/bipLov.js.

  // A4 portrait in jsPDF default units (mm): 210 x 297.
  var PAGE_BOTTOM   = 272;  // start a new page past this y
  var MARGIN_LEFT   = 14;
  var MARGIN_RIGHT  = 196;  // 210 - 14

  // Grid columns: x offset AND width, both in mm, laid end to end from
  // MARGIN_LEFT to MARGIN_RIGHT (14 -> 196 = 182mm).
  //
  // Width is declared, not implied by the next column's offset, and every
  // maxWidth is DERIVED from it (see colWidth). An earlier version carried
  // offsets only and hardcoded each maxWidth separately; the two drifted and
  // "QTY PKD" printed straight through "SERIAL PICKED". Keeping one number per
  // column makes that overlap structurally impossible.
  //
  // The two hand-written columns are sized for a person's handwriting, not for
  // their headers, which is why the header font is smaller than the body font
  // and "SERIAL PKD" is abbreviated — the pen needs the millimetres more than
  // the label does.
  var COLS = {
    lineNo:       { x: 14,  w: 6  },
    equipment:    { x: 20,  w: 36 },
    klass:        { x: 56,  w: 22 },
    qty:          { x: 78,  w: 8  },
    subinv:       { x: 86,  w: 24 },
    locator:      { x: 110, w: 24 },
    serial:       { x: 134, w: 30 },  // long lot numbers, e.g. LOT-2026-6003-0001
    qtyPicked:    { x: 164, w: 14 },
    serialPicked: { x: 178, w: 18 },
  };

  // Gutter kept clear between one column's text and the next column's x.
  var COL_GUTTER = 2;
  function colWidth(col) { return col.w - COL_GUTTER; }

  // Rows with no locator cannot be placed on the walk path, so they are held
  // back and printed under their own heading rather than being scattered
  // through it. Constant rather than a literal so the sort and the heading
  // can never disagree.
  var UNLOCATED = 'Unlocated';

  // ── Which lines belong on a slip ─────────────────────────────────────────
  // A line reaches the sheet once it has actually been RELEASED for picking —
  // PICK_INITIATED or past it. The slip is the paperwork for released work, so
  // a line nobody has released does not belong on it.
  //
  // SCHEDULED_FOR_PICKING is deliberately excluded. lineStatusLabels.js
  // documents it as the state BETWEEN confirmed and released to the warehouse:
  // the request is queued, but nothing has authorised a picker to go and take
  // the equipment off the yard.
  //
  // KNOWN CONSEQUENCE: only a successful OIC release advances a line to
  // PICK_INITIATED, so while OIC is unreachable no slip can be produced at all.
  // That is accepted on purpose — a slip listing unreleased equipment is worse
  // than no slip, because it reads exactly like an authorised one. If an outage
  // ever has to be worked around, add SCHEDULED_FOR_PICKING here AND stamp the
  // document "NOT YET RELEASED"; do not quietly widen the gate on its own.
  //
  // Everything past PICK_INITIATED stays eligible so a reprint still works
  // after the equipment has shipped or been deployed — the slip is a record of
  // a pick that happened, and a blank reprint would be useless.
  //
  // An explicit set, not an ordinal comparison: the status vocabulary is not
  // linear (returns branch off it), so ranking the codes would invent an order
  // the data does not have.
  var RELEASED = {
    PICK_INITIATED:    true,
    SHIP_TO_SITE:      true,
    DELIVERED:         true,
    DEPLOYED:          true,
    SHIPPED_TO_YARD:   true,
    RETURN_INITIATED:  true,
    RETURN_IN_PROCESS: true,
    CONSUMED:          true,
    CLOSED:            true,
  };

  function isReleasedForPicking(line) {
    return !!(line && RELEASED[String(line.lineStatus || '').toUpperCase()]);
  }

  // True when the request has released work worth printing. Drives the icon's
  // visibility, so the icon and the document can never disagree about whether
  // there is a slip to produce — no icon rather than an empty sheet.
  function hasReleasedLines(lines) {
    return Array.isArray(lines) && lines.some(isReleasedForPicking);
  }

  function s(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  function dash(v) {
    var t = s(v).trim();
    return t === '' ? '—' : t;
  }

  // yyyy-MM-dd HH:mm, local. Printed on the slip so a marked-up sheet found on
  // a desk later can be tied back to the release it came from.
  function stamp(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function compactStamp(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate()) +
           p(d.getHours()) + p(d.getMinutes());
  }

  // Date only — required-by is a day, and printing a midnight time next to it
  // reads as false precision.
  //
  // The calendar date is taken STRAIGHT off an ISO-shaped string rather than
  // via new Date(). Parsing '2026-09-01T00:00:00Z' and re-reading local parts
  // shifts it to 31-Aug in every timezone behind UTC — and a pick slip that
  // says the equipment is required a day earlier than it is will have someone
  // loading a truck on the wrong morning. Only a non-ISO value falls through
  // to Date parsing, where local interpretation is the best available guess.
  function dateOnly(v) {
    if (!v) return '';
    var str = s(v);
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    var d = new Date(str);
    if (isNaN(d.getTime())) return str;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  // ── Document number ───────────────────────────────────────────────────────
  // PS-{requestNumber}-{yyyyMMddHHmm}. This is a PRINT REFERENCE, not a
  // persisted document number: there is no EQR_PICK_SLIP_SEQ and no
  // EQR_SHIPPING_DOCUMENT row behind it, so two prints of the same request
  // produce two different references. That is honest for a disposable
  // worksheet. When the sequence and the document table land, this is the one
  // function that changes.
  function buildDocNumber(requestNumber, now) {
    return 'PS-' + (s(requestNumber).trim() || 'REQ') + '-' + compactStamp(now);
  }

  // ── Walk-path sort ────────────────────────────────────────────────────────
  // THE ENTIRE POINT OF THE DOCUMENT. A pick slip sorted by line number makes
  // the picker criss-cross the yard; sorted by subinventory then locator it is
  // a single efficient walk. Equipment name is the third key only so repeat
  // prints of the same request come out in the same order.
  //
  // localeCompare with numeric:true so "Row A, Bay 9" precedes "Row A, Bay 10"
  // — a plain string sort puts Bay 10 first and sends the picker back up the
  // row. Rows with no locator sort last, under their own heading.
  function sortForWalk(rows) {
    var cmp = function (a, b) {
      return s(a).localeCompare(s(b), undefined, { numeric: true, sensitivity: 'base' });
    };
    return rows.slice().sort(function (a, b) {
      var aUn = !s(a.subinventory).trim() && !s(a.locator).trim();
      var bUn = !s(b.subinventory).trim() && !s(b.locator).trim();
      if (aUn !== bUn) return aUn ? 1 : -1;
      return cmp(a.subinventory, b.subinventory)
          || cmp(a.locator, b.locator)
          || cmp(a.equipmentName, b.equipmentName);
    });
  }

  // ── Document model ────────────────────────────────────────────────────────
  // Flattens the drawer's line objects into one printable row per line.
  //
  // subinventory and locator are already resolved on the line by
  // openPickingDrawerChain — the same values the on-screen grid shows. The
  // document deliberately does not re-derive them: a pick slip that disagreed
  // with the screen it was printed from would be worse than one with gaps.
  function buildModel(request, lines, now) {
    var when = now || new Date();
    // Line # is the line's position on the REQUEST, stamped BEFORE the filter
    // and carried through the walk-path sort. So a slip covering lines 1 and 3
    // prints "3" then "1" when line 3 is nearer the door — which is the point:
    // the number ties a row back to the request the picker is working from, and
    // the ORDER is the route. Numbering the sorted rows 1..n instead would give
    // the picker a counter that matches nothing.
    //
    // Only released lines reach the sheet — see isReleasedForPicking.
    var rows = (lines || []).map(function (line, idx) {
      return {
        lineNo:        idx + 1,
        released:      isReleasedForPicking(line),
        equipmentName: s(line.equipmentName),
        equipmentClass: s(line.equipmentClass),
        quantity:      line.quantity == null ? '' : String(line.quantity),
        // Quantity prints WITHOUT a unit of measure. There is no shipping UOM
        // anywhere on the line — EQR_REQUEST_LINE carries only PRICE_UOM,
        // which is a pricing unit, and line-detail-units returns uomCode null.
        // A wrong UOM on a warehouse document is worse than no UOM.
        subinventory:  s(line.subinventory),
        locator:       s(line.locator),
        serialNumber:  s(line.serialNumber),
      };
    });

    rows = rows.filter(function (r) { return r.released; });

    return {
      docNumber:    buildDocNumber(request && request.requestNumber, when),
      printedAt:    stamp(when),
      requestNumber: s(request && request.requestNumber),
      // Blank where the line has no Transfer Order. That is the normal case
      // for the lines this document exists to serve, not a missing value, so
      // it prints blank rather than as an em-dash.
      toNumber:     s(request && request.toNumber),
      yard:         s(request && request.yard),
      project:      s(request && request.project),
      requiredBy:   dateOnly(request && request.neededByDate),
      rows:         sortForWalk(rows),
      fileName:     'pick-slip-' + (s(request && request.requestNumber) || 'request') + '.pdf',
    };
  }

  // ── Rendering helpers ─────────────────────────────────────────────────────

  // Header labels, paired with their column. Abbreviated where the column is
  // narrow: at 7pt these all clear their own width (asserted in the tests), and
  // a label that does not fit is what produced the overlap this replaced.
  var HEADINGS = [
    ['#',            'lineNo'],
    ['EQUIPMENT',    'equipment'],
    ['CLASS',        'klass'],
    ['QTY',          'qty'],
    ['SUBINVENTORY', 'subinv'],
    ['LOCATOR',      'locator'],
    ['SERIAL / LOT', 'serial'],
    ['QTY PKD',      'qtyPicked'],
    ['SERIAL PKD',   'serialPicked'],
  ];

  function headerRow(doc, y) {
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    HEADINGS.forEach(function (h) {
      doc.text(h[0], COLS[h[1]].x, y, { maxWidth: colWidth(COLS[h[1]]) });
    });
    doc.setFont(undefined, 'normal');
    y += 2;
    doc.setLineWidth(0.3);
    doc.line(MARGIN_LEFT, y, MARGIN_RIGHT, y);
    return y + 5;
  }

  function sectionHeading(doc, text, y) {
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text(text, MARGIN_LEFT, y);
    doc.setFont(undefined, 'normal');
    return y + 5;
  }

  // One printed line. Returns the next y. The hand-written columns get a ruled
  // underline rather than being left as whitespace — an unruled gap invites
  // the picker to write across the column boundary.
  function bodyRow(doc, row, y) {
    doc.setFontSize(8);

    // Wrap every cell FIRST, then size the row to the tallest one. Equipment
    // names ("Concrete Curing Compound (55 Gal Drum)") and long lot numbers
    // both overflow their columns routinely, and the row height used to be a
    // flat 7mm — so the second line of a wrapped cell printed on top of the
    // next row. Measuring before drawing is what stops that; it also means a
    // column can be narrowed later without silently corrupting the grid.
    var cells = [
      [String(row.lineNo),          'lineNo'],
      [dash(row.equipmentName),     'equipment'],
      [dash(row.equipmentClass),    'klass'],
      [dash(row.quantity),          'qty'],
      [dash(row.subinventory),      'subinv'],
      [dash(row.locator),           'locator'],
      [dash(row.serialNumber),      'serial'],
    ].map(function (c) {
      var col = COLS[c[1]];
      return { lines: doc.splitTextToSize(c[0], colWidth(col)), col: col };
    });

    var maxLines = cells.reduce(function (n, c) {
      return Math.max(n, c.lines.length || 1);
    }, 1);

    cells.forEach(function (c) { doc.text(c.lines, c.col.x, y); });

    // Ruled write-in lines, on the row's FIRST baseline so they stay aligned
    // with the line number however tall the row grew, and each stopping inside
    // its own column so the picker is not invited to write across the boundary.
    doc.setLineWidth(0.15);
    doc.setDrawColor(150);
    doc.line(COLS.qtyPicked.x,    y + 1, COLS.qtyPicked.x + colWidth(COLS.qtyPicked),       y + 1);
    doc.line(COLS.serialPicked.x, y + 1, COLS.serialPicked.x + colWidth(COLS.serialPicked), y + 1);
    doc.setDrawColor(0);

    return y + rowHeight(maxLines);
  }

  // 8pt text sits on a ~3.6mm line; ROW_PAD keeps consecutive rows legible.
  var LINE_H  = 3.6;
  var ROW_PAD = 3.4;
  function rowHeight(lineCount) {
    return Math.max(1, lineCount) * LINE_H + ROW_PAD;
  }

  // ── Main entry ────────────────────────────────────────────────────────────
  // Returns { base64, fileName, docNumber, rowCount } — base64 WITHOUT the
  // "data:application/pdf;base64," prefix, matching what buildQuotePdf returns
  // and what the preview's atob() expects.
  function buildPickSlipPdf(model) {
    var doc = new jsPDF();
    var y = 18;

    // ── Title ──
    doc.setFontSize(15);
    doc.setFont(undefined, 'bold');
    doc.text('PICK SLIP', MARGIN_LEFT, y);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(8);
    doc.text(model.docNumber, MARGIN_RIGHT, y, { align: 'right' });
    y += 6;
    doc.setFontSize(7.5);
    doc.text('Internal warehouse worksheet — not a shipping document',
      MARGIN_LEFT, y);
    doc.text('Printed ' + model.printedAt, MARGIN_RIGHT, y, { align: 'right' });
    y += 4;
    doc.setLineWidth(0.5);
    doc.line(MARGIN_LEFT, y, MARGIN_RIGHT, y);
    y += 7;

    // ── Header block: two columns of label/value pairs ──
    var field = function (label, value, x, yy) {
      doc.setFontSize(6.5);
      doc.setTextColor(110);
      doc.text(String(label).toUpperCase(), x, yy);
      doc.setTextColor(0);
      doc.setFontSize(9);
      doc.text(dash(value), x, yy + 4.5, { maxWidth: 80 });
    };
    field('Request',       model.requestNumber, MARGIN_LEFT, y);
    field('Transfer Order', model.toNumber,     108,         y);
    y += 11;
    field('Source Yard',   model.yard,          MARGIN_LEFT, y);
    field('Project / Task', model.project,      108,         y);
    y += 11;
    field('Required By',   model.requiredBy,    MARGIN_LEFT, y);
    field('Lines',         String(model.rows.length), 108,   y);
    y += 13;

    // ── Line grid ──
    y = headerRow(doc, y);

    var lastGroup = null;
    model.rows.forEach(function (row) {
      // Group heading whenever the subinventory changes — the picker reads
      // this as "now walk to this part of the yard".
      var group = s(row.subinventory).trim() ||
                  (s(row.locator).trim() ? '' : UNLOCATED);
      if (group && group !== lastGroup) {
        if (y > PAGE_BOTTOM - 12) { doc.addPage(); y = 18; y = headerRow(doc, y); }
        y = sectionHeading(doc, group, y);
        lastGroup = group;
      }
      if (y > PAGE_BOTTOM) {
        doc.addPage();
        y = 18;
        y = headerRow(doc, y);
        // Re-assert the group after a page break so a continued section is not
        // orphaned from its heading.
        if (lastGroup) y = sectionHeading(doc, lastGroup + ' (cont.)', y);
      }
      y = bodyRow(doc, row, y);
    });

    if (model.rows.length === 0) {
      doc.setFontSize(8);
      doc.text('No equipment lines on this request.', MARGIN_LEFT, y);
      y += 7;
    }

    // ── Picker signature ──
    if (y > PAGE_BOTTOM - 24) { doc.addPage(); y = 18; }
    y += 6;
    doc.setLineWidth(0.3);
    doc.line(MARGIN_LEFT, y, MARGIN_RIGHT, y);
    y += 9;
    doc.setFontSize(6.5);
    doc.setTextColor(110);
    doc.text('PICKED BY', MARGIN_LEFT, y);
    doc.text('SIGNATURE', 74, y);
    doc.text('DATE', 150, y);
    doc.setTextColor(0);
    y += 7;
    doc.setLineWidth(0.2);
    doc.line(MARGIN_LEFT, y, 68, y);
    doc.line(74, y, 144, y);
    doc.line(150, y, MARGIN_RIGHT, y);

    var dataUri = doc.output('datauristring');
    var base64  = dataUri.substring(dataUri.indexOf(',') + 1);

    return {
      base64:    base64,
      fileName:  model.fileName,
      docNumber: model.docNumber,
      rowCount:  model.rows.length,
    };
  }

  // Decodes the base64 the builder returns into an object URL the preview
  // iframe can load. Identical to the decode in QuoteInitChain — VB's callRest
  // pipeline is JSON-oriented with no working precedent for raw binary
  // transport, so base64 is how a PDF moves in this app.
  //
  // The caller owns the returned URL and must URL.revokeObjectURL it, or every
  // print leaks a blob for the life of the tab.
  function toBlobUrl(base64) {
    var chars = atob(base64);
    var bytes = new Uint8Array(chars.length);
    for (var i = 0; i < chars.length; i++) { bytes[i] = chars.charCodeAt(i); }
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }

  return {
    // Exposed for the layout tests: a column overlap is invisible in code and
    // obvious only on paper, so it is asserted rather than eyeballed.
    COLS:              COLS,
    HEADINGS:          HEADINGS,
    MARGIN_LEFT:       MARGIN_LEFT,
    MARGIN_RIGHT:      MARGIN_RIGHT,
    COL_GUTTER:        COL_GUTTER,

    rowHeight:         rowHeight,
    isReleasedForPicking: isReleasedForPicking,
    hasReleasedLines:     hasReleasedLines,
    buildModel:       buildModel,
    buildPickSlipPdf: buildPickSlipPdf,
    toBlobUrl:        toBlobUrl,
    sortForWalk:      sortForWalk,
    buildDocNumber:   buildDocNumber,
  };
});
