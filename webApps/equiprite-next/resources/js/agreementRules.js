define(['resources/js/fmt'], function (fmt) {
  'use strict';

  // Agreements (Commercial): the rental-agreement rules, pure. They are New EquipRite's (webApps/equiprite/flows/
  // master/pages/agreements-page.js, agreement-lines-page.js, agreement-edit-page.js and their chains), copied with
  // their logic unchanged:
  //   - statuses DRAFT, PENDING, APPROVED, ACTIVE, REJECTED, EXPIRED, CANCELLED; Approve sets ACTIVE, Reject REJECTED;
  //   - ACTIVE, REJECTED and EXPIRED cannot be edited, approved or rejected (canEdit / canDecide); only an ACTIVE
  //     agreement's lines can be requested (canRequest); an agreement needs a line before it is approved;
  //   - ending soon: ACTIVE and ending within 60 days;
  //   - a new agreement is numbered PREFIX-#### (its type's prefix, else AGR; the highest number with that prefix +1),
  //     created as DRAFT; a new line is numbered max(line numbers) + 1; Save sends the loaded header's number, status and
  //     objectVersionNumber with the PUT;
  //   - Create request: each ticked line needs its agreement line id, duplicates are dropped, the rate is the line's
  //     unitPrice else its bill rate, the unit its priceUom (DAY when blank), and the hand-off keys go to draftStorage.
  // Next's own: the tone and words of a status, what is next, sorting, the summary and what the lists export.

  var STATUSES = ['DRAFT', 'PENDING', 'APPROVED', 'ACTIVE', 'REJECTED', 'EXPIRED', 'CANCELLED'];
  var LABELS = { DRAFT: 'Draft', PENDING: 'Pending', APPROVED: 'Approved', ACTIVE: 'Active', REJECTED: 'Rejected',
    EXPIRED: 'Expired', CANCELLED: 'Cancelled' };
  var TONES = { DRAFT: 'draft', PENDING: 'approval', APPROVED: 'approval', ACTIVE: 'active', REJECTED: 'stopped',
    EXPIRED: 'ended', CANCELLED: 'stopped' };
  var EXPIRING_DAYS = 60;
  var SHOW_STEP = 200;
  var UOMS = [{ value: 'HOUR', label: 'Hour' }, { value: 'DAY', label: 'Day' }, { value: 'WEEK', label: 'Week' }, { value: 'MONTH', label: 'Month' }];
  var CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD'];

  var txt = function (v) { return v == null ? '' : String(v); };
  var up = function (v) { return txt(v).toUpperCase(); };
  var utcDay = function (iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(iso));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  };

  function statusLabel(code) {
    var c = up(code);
    return LABELS[c] || (c ? c.charAt(0) + c.slice(1).toLowerCase() : '—');
  }

  function tone(code) { return TONES[up(code)] || 'draft'; }

  /** Whole days from today to the end date (negative once past), or null. */
  function daysLeft(endDate, today) {
    var end = utcDay(endDate);
    if (end == null) return null;
    var t = utcDay(today || new Date().toISOString().slice(0, 10));
    return Math.round((end - t) / 86400000);
  }

  /** An ACTIVE agreement ending within 60 days (RPT-16 / NTF-09 "agreement expiring"). */
  function isExpiring(row, today) {
    var d = daysLeft(row && row.endDate, today);
    return !!row && row.statusCode === 'ACTIVE' && d !== null && d >= 0 && d <= EXPIRING_DAYS;
  }

  function expiryText(row, today) {
    var d = daysLeft(row && row.endDate, today);
    if (d === null) return '';
    if (d < 0) return row && row.statusCode === 'ACTIVE' ? 'Past its end date' : '';
    if (d === 0) return 'Ends today';
    return d <= EXPIRING_DAYS ? 'Ends in ' + d + (d === 1 ? ' day' : ' days') : '';
  }

  /** The old list's edit rule (navigateToEditChain): ACTIVE, REJECTED and EXPIRED agreements cannot be edited. */
  function canEdit(statusCode) {
    return ['ACTIVE', 'REJECTED', 'EXPIRED'].indexOf(up(statusCode)) === -1;
  }

  /** The old page's rule: Approve and Reject are offered until the agreement is ACTIVE, REJECTED or EXPIRED. */
  function canDecide(status) {
    return ['ACTIVE', 'REJECTED', 'EXPIRED'].indexOf(up(status)) === -1;
  }

  /** Lines can be requested only from an ACTIVE agreement (the old page's tick boxes were disabled otherwise). */
  function canRequest(status) {
    return up(status) === 'ACTIVE';
  }

  // ── the list ─────────────────────────────────────────────────────────────────────────────────────────────

  /** One row of the list: the old RentalAgreementInitChain's mapping (views/rental-agreements), unchanged. */
  function listRow(r) {
    return {
      headerId:        r.id != null ? r.id : null,
      agreementNumber: r.agreementNumber || '',
      agreementName:   r.agreementName   || '',
      customer:        r.customerName    || '',
      agreementType:   r.agreementType   || '',
      startDate:       r.effectiveFrom ? r.effectiveFrom.substring(0, 10) : '',
      endDate:         r.effectiveTo   ? r.effectiveTo.substring(0, 10)   : '',
      statusCode:      r.status          || '',
      lineCount:       r.lines           || 0
    };
  }

  /** Newest created first: headerId is the sequence-generated EQR_AGREEMENT_HEADER_ID; null ids sink to the bottom. */
  function newestFirst(records) {
    return (records || []).slice().sort(function (a, b) {
      var aId = a.headerId != null ? Number(a.headerId) : -Infinity;
      var bId = b.headerId != null ? Number(b.headerId) : -Infinity;
      return bId - aId;
    });
  }

  /**
   * Chips with counts: All, Ending soon (when any), Waiting for approval (draft, pending, approved), then each other
   * status present. Old statuses not in the list keep their code in words.
   */
  function chips(rows, today) {
    var list = Array.isArray(rows) ? rows : [];
    var counts = {};
    list.forEach(function (r) { var s = up(r.statusCode) || 'NONE'; counts[s] = (counts[s] || 0) + 1; });
    var out = [{ key: 'all', label: 'All', count: list.length }];
    var exp = list.filter(function (r) { return isExpiring(r, today); }).length;
    if (exp) out.push({ key: 'expiring', label: 'Ending soon', count: exp, warn: true });
    var known = STATUSES.filter(function (s) { return counts[s]; });
    var other = Object.keys(counts).filter(function (s) { return STATUSES.indexOf(s) === -1; }).sort();
    known.concat(other).forEach(function (s) {
      out.push({ key: s, label: s === 'NONE' ? 'No status' : statusLabel(s), count: counts[s] });
    });
    return out;
  }

  /** The rows shown: the chip, then free text over number, name, customer and type (the old Smart Search's fields). */
  function filterRows(rows, text, chip, today) {
    var q = txt(text).trim().toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (chip === 'expiring' && !isExpiring(r, today)) return false;
      if (chip && chip !== 'all' && chip !== 'expiring' && (up(r.statusCode) || 'NONE') !== chip) return false;
      if (!q) return true;
      return [r.agreementNumber, r.agreementName, r.customer, r.agreementType]
        .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  var SORTS = {
    newest: null,
    number: function (r) { return txt(r.agreementNumber).toLowerCase(); },
    customer: function (r) { return txt(r.customer).toLowerCase(); },
    valid: function (r) { return txt(r.endDate) || '9999'; },
    status: function (r) { var i = STATUSES.indexOf(up(r.statusCode)); return i === -1 ? 99 : i; },
    lines: function (r) { return Number(r.lineCount) || 0; }
  };

  /** Sorted by a column ('newest' keeps the newest-first order). */
  function sort(rows, key, dir) {
    var f = SORTS[key];
    if (!f) return newestFirst(rows);
    var sign = dir === 'desc' ? -1 : 1;
    return newestFirst(rows).sort(function (a, b) {
      var x = f(a);
      var y = f(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign;
    });
  }

  /** What is next for an agreement, and who does it, in words. */
  function nextStep(statusCode, endDate, lineCount, today) {
    var s = up(statusCode);
    var d = daysLeft(endDate, today);
    if (s === 'ACTIVE') {
      if (d !== null && d < 0) return 'Past its end date: Finance to close it or extend the dates';
      if (d !== null && d <= EXPIRING_DAYS) return 'Ends ' + (d === 0 ? 'today' : 'in ' + d + (d === 1 ? ' day' : ' days')) + ': renew it with the customer, or let it end';
      return 'In use: request equipment from its lines';
    }
    if (s === 'EXPIRED') return 'Ended: its lines can no longer be requested';
    if (s === 'REJECTED') return 'Rejected: it cannot be edited or approved again';
    if (s === 'CANCELLED') return 'Cancelled: its lines cannot be requested';
    if (!Number(lineCount)) return 'Add its lines, then Finance approves it';
    return 'Finance to approve it; then its lines can be requested';
  }

  /** "3 agreements · 1 active · 1 ending within 60 days · 1 waiting for approval". */
  function summary(rows, today) {
    var list = Array.isArray(rows) ? rows : [];
    var active = list.filter(function (r) { return up(r.statusCode) === 'ACTIVE'; }).length;
    var ending = list.filter(function (r) { return isExpiring(r, today); }).length;
    var waiting = list.filter(function (r) { return ['DRAFT', 'PENDING', 'APPROVED'].indexOf(up(r.statusCode)) !== -1; }).length;
    return [fmt.count(list.length, 'agreement'), active + ' active', ending ? ending + ' ending within ' + EXPIRING_DAYS + ' days' : '',
      waiting ? waiting + ' waiting for approval' : ''].filter(Boolean).join(' · ');
  }

  function listExportColumns(today) {
    return [
      { key: 'agreementNumber', label: 'Agreement' }, { key: 'agreementName', label: 'Name' }, { key: 'customer', label: 'Customer' },
      { key: 'agreementType', label: 'Type' },
      { key: 'statusCode', label: 'Status', value: function (r) { return statusLabel(r.statusCode); } },
      { key: 'startDate', label: 'Valid from' }, { key: 'endDate', label: 'Valid to' },
      { key: 'ends', label: 'Ending', value: function (r) { return expiryText(r, today); } },
      { key: 'lineCount', label: 'Lines', type: 'number', value: function (r) { return Number(r.lineCount) || 0; } },
      { key: 'next', label: 'Next step', value: function (r) { return nextStep(r.statusCode, r.endDate, r.lineCount, today); } }
    ];
  }

  // ── one agreement: its lines ─────────────────────────────────────────────────────────────────────────────

  /**
   * The lines of one agreement and the map to their EQR_AGREEMENT_LINE_ID (New's agreementLinesInitChain): the view
   * lines carry the names, the raw lines the ids; joined by line number, keyed agreementNumber:lineNumber, sorted.
   */
  function buildLines(agreementNumber, viewRows, rawRows) {
    var rawByLineNumber = {};
    (rawRows || []).forEach(function (r) {
      if (r && r.lineNumber != null) rawByLineNumber[Number(r.lineNumber)] = r;
    });
    var idMap = {};
    var lines = (viewRows || []).filter(function (r) { return r != null; }).map(function (r, idx) {
      var lineNo = r.lineNumber != null ? Number(r.lineNumber) : (idx + 1);
      var compositeKey = agreementNumber + ':' + lineNo;
      var raw = rawByLineNumber[lineNo] || null;
      var agreementLineId = raw ? raw.id : null;
      if (agreementLineId != null) {
        idMap[compositeKey] = {
          agreementLineId:    Number(agreementLineId),
          equipmentMasterId:  raw && raw.equipmentMasterId != null ? Number(raw.equipmentMasterId) : null,
          equipmentClassId:   raw && raw.equipmentClassId  != null ? Number(raw.equipmentClassId)  : null,
          unitPrice:          raw ? raw.unitPrice : null,
          priceUom:           raw ? raw.priceUom  : null,
          minCommitDays:      raw ? raw.minCommitDays : null
        };
      }
      return {
        compositeKey:   compositeKey,
        line_no:        lineNo,
        equipment_name: r.equipmentName  || r.description || '—',
        class_name:     r.className      || '—',
        subClassName:   r.subClassName   || '—',
        qty:            r.qty            != null ? r.qty : 0,
        availability:   r.availability   != null ? r.availability : 0,
        status:         r.status         || '—',
        bill_rate:      r.billRate       != null ? r.billRate : 0,
        price_uom:      r.priceUom       || '—',
        est_cost:       r.estCost        != null ? r.estCost : 0,
        util_pct:       r.utilPct        != null ? r.utilPct : 0,
        description:    r.description    || ''
      };
    });
    lines.sort(function (a, b) { return (Number(a.line_no) || 0) - (Number(b.line_no) || 0); });
    return { lines: lines, idMap: idMap };
  }

  /**
   * The old FilterLinesChain's rule: every typed word must appear in the equipment name, class, subclass or
   * description (any case).
   */
  function filterLines(lines, text) {
    var words = txt(text).trim().toLowerCase().split(/\s+/).filter(function (w) { return w; });
    return (Array.isArray(lines) ? lines : []).filter(function (item) {
      if (!words.length) return true;
      var hay = [item.equipment_name, item.class_name, item.subClassName, item.description]
        .map(function (v) { return String(v || '').toLowerCase(); }).join(' ');
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  function rateText(line) {
    if (!line) return '';
    var uom = up(line.price_uom);
    return Number(line.bill_rate) > 0 ? fmt.money(line.bill_rate) + (uom && uom !== '—' ? ' / ' + uom.toLowerCase() : '') : 'From the rate schedule';
  }

  function selectedCount(selected) { return Object.keys(selected || {}).length; }

  /** A NEW map with one line ticked or not; only lines with an agreement line id can be requested. */
  function toggle(selected, key, on, idMap) {
    var next = Object.assign({}, selected || {});
    if (!key || !(idMap || {})[key]) return next;
    if (on) { next[key] = true; } else { delete next[key]; }
    return next;
  }

  /** Tick / untick every line the search shows. */
  function toggleShown(selected, lines, text, on, idMap) {
    var next = Object.assign({}, selected || {});
    filterLines(lines, text).forEach(function (l) {
      if (!(idMap || {})[l.compositeKey]) return;
      if (on) { next[l.compositeKey] = true; } else { delete next[l.compositeKey]; }
    });
    return next;
  }

  function allShownSelected(selected, lines, text, idMap) {
    var shown = filterLines(lines, text).filter(function (l) { return (idMap || {})[l.compositeKey]; });
    return shown.length > 0 && shown.every(function (l) { return !!(selected || {})[l.compositeKey]; });
  }

  /**
   * What Create request will do, before the click: how many lines go, at whose rates, and how many name only a
   * class (those take the first equipment of the class, as the old Create Request did).
   */
  function requestPreview(selected, lines, idMap) {
    var keys = Object.keys(selected || {});
    if (!keys.length) return 'Tick the lines to request.';
    var classOnly = keys.filter(function (k) { return (idMap || {})[k] && (idMap[k].equipmentMasterId == null); }).length;
    var t = keys.length + (keys.length === 1 ? ' line goes' : ' lines go') + ' to New request at this agreement\'s rates.';
    if (classOnly) {
      t += ' ' + classOnly + (classOnly === 1 ? ' line names' : ' lines name') + ' only a class: it takes the first equipment of that class.';
    }
    return t + ' You add the project, dates and delivery there.';
  }

  /**
   * Step 1 of Create request (the old AddToCartChain) over the ticked lines: each needs its agreement line id (else
   * skipped, "no ID"), duplicates by agreement line id are dropped; the rate is the line's unitPrice, else its view
   * bill rate, the unit its priceUom (DAY when blank). { pending, dupCount, unresolvedCount }.
   */
  function pendingLines(linesArray, selected, idMap) {
    var selectedRows = (linesArray || []).filter(function (l) { return (selected || {})[l.compositeKey]; });
    var pending = [];
    var seen = {};
    var dupCount = 0;
    var unresolvedCount = 0;
    selectedRows.forEach(function (line) {
      var idEntry = (idMap || {})[line.compositeKey];
      if (!idEntry || idEntry.agreementLineId == null) { unresolvedCount++; return; }
      if (seen[idEntry.agreementLineId]) { dupCount++; return; }
      seen[idEntry.agreementLineId] = true;
      pending.push({
        compositeKey:      line.compositeKey,
        agreementLineId:   idEntry.agreementLineId,
        equipmentMasterId: idEntry.equipmentMasterId,
        equipmentClassId:  idEntry.equipmentClassId,
        equipment_name:    line.equipment_name,
        class_name:        line.class_name,
        subClassName:      line.subClassName,
        quantity:          1,
        billingRate:       idEntry.unitPrice != null ? idEntry.unitPrice : line.bill_rate,
        priceUom:          idEntry.priceUom || line.price_uom || 'DAY'
      });
    });
    return { selected: selectedRows.length, pending: pending, dupCount: dupCount, unresolvedCount: unresolvedCount };
  }

  /** One cart item and its agreement maps for a resolved line (the old CreateRequestFromAgreementChain). */
  function cartItem(p, masterId, masterName) {
    return {
      item: {
        id:          masterId,
        equipmentId: masterId,
        name:        masterName,
        class:       p.class_name,
        classId:     p.equipmentClassId,
        quantity:    1,
        billingRate: p.billingRate || 0,
        billingUnit: p.priceUom   || 'DAY'
      },
      rate: { billingRate: p.billingRate || 0, billingUnit: p.priceUom || 'DAY' }
    };
  }

  /**
   * The hand-off to New request, written exactly as New EquipRite writes it: draftStorage cleared, then the same
   * keys, then the tab flag eqr.agreement.active. `a` is the agreement { headerId, number, customerName,
   * customerRefId, fusionCustomerId, effectiveFrom, effectiveTo, notes }.
   */
  function writeHandoff(draftStorage, session, a, cartItems, agreementLineIdByEquipmentId, agreementRateByEquipmentId) {
    draftStorage.clear();
    draftStorage.save('CartItemsArray', cartItems);
    draftStorage.save('requestOrigin', 'agreement');
    draftStorage.save('fromAgreementId', Number(a.headerId));
    draftStorage.save('fromAgreementNumber', a.number || '');
    draftStorage.save('fromAgreementCustomer', a.customerName || '');
    draftStorage.save('fromAgreementCustomerRefId', a.customerRefId || null);
    draftStorage.save('fromAgreementFusionCustomerId', a.fusionCustomerId || null);
    draftStorage.save('fromAgreementEffectiveFrom', a.effectiveFrom || '');
    draftStorage.save('fromAgreementEffectiveTo', a.effectiveTo || '');
    draftStorage.save('fromAgreementNotes', a.notes || '');
    draftStorage.save('agreementLineIdByEquipmentId', agreementLineIdByEquipmentId);
    draftStorage.save('agreementRateByEquipmentId', agreementRateByEquipmentId);
    try { session.setItem('eqr.agreement.active', '1'); } catch (e) { /* private mode */ }
  }

  function linesExportColumns() {
    var num = function (v) { return v == null || v === '' || isNaN(Number(v)) ? '' : Number(v); };
    return [
      { key: 'line_no', label: 'Line', type: 'number', value: function (l) { return num(l.line_no); } },
      { key: 'equipment_name', label: 'Equipment' }, { key: 'class_name', label: 'Class' }, { key: 'subClassName', label: 'Subclass' },
      { key: 'description', label: 'Description' },
      { key: 'bill_rate', label: 'Rate', type: 'number', value: function (l) { return Number(l.bill_rate) > 0 ? Number(l.bill_rate) : ''; } },
      { key: 'price_uom', label: 'Per', value: function (l) { return l.price_uom === '—' ? '' : txt(l.price_uom).toLowerCase(); } },
      { key: 'rateFrom', label: 'Rate from', value: function (l) { return Number(l.bill_rate) > 0 ? 'Agreement' : 'Rate schedule'; } },
      { key: 'qty', label: 'Qty', type: 'number', value: function (l) { return num(l.qty); } },
      { key: 'est_cost', label: 'Estimated cost', type: 'number', value: function (l) { return num(l.est_cost); } },
      { key: 'status', label: 'Stored status', value: function (l) { return l.status === '—' ? '' : l.status; } }
    ];
  }

  // ── one agreement: edit ──────────────────────────────────────────────────────────────────────────────────

  /** The edit form's empty formData (New's agreement-edit page; the fields the old page never saved left out). */
  function emptyForm() {
    return { agreementName: '', agreementType: '', notes: '', customerRefId: null, customerId: null, customerName: '',
      startDate: '', endDate: '', currencyCode: 'USD' };
  }

  /** formData from a loaded header (GET /agreement-headers/{id}). */
  function formFromHeader(base, header) {
    return Object.assign({}, base || emptyForm(), {
      agreementName: header.agreementName    || '',
      agreementType: header.agreementType    || '',
      customerRefId: null,
      customerId:    header.fusionCustomerId != null ? Number(header.fusionCustomerId) : null,
      startDate:     header.effectiveFrom ? header.effectiveFrom.substring(0, 10) : '',
      endDate:       header.effectiveTo   ? header.effectiveTo.substring(0, 10)   : '',
      currencyCode:  header.currencyCode  || 'USD',
      notes:         header.notes         || ''
    });
  }

  /** The edit lines: raw lines for ids and values, view lines for names, joined by line number, sorted. */
  function editLines(rawLines, viewLines) {
    var lines = (rawLines || []).map(function (line) {
      var v = (viewLines || []).filter(function (vl) { return vl.lineNumber === line.lineNumber; })[0] || null;
      return {
        lineId:                line.id,
        lineNumber:            line.lineNumber,
        equipmentClassId:      line.equipmentClassId,
        equipmentMasterId:     line.equipmentMasterId  || null,
        description:           line.description        || '',
        unitPrice:             line.unitPrice,
        priceUom:              line.priceUom            || 'DAY',
        equipmentClassName:    v ? (v.className     || '—') : '—',
        equipmentSubclassName: v ? (v.subClassName  || '—') : '—',
        equipmentName:         v ? (v.equipmentName || '—') : '—'
      };
    });
    lines.sort(function (a, b) { return (Number(a.lineNumber) || 0) - (Number(b.lineNumber) || 0); });
    return lines;
  }

  /**
   * The old saveAgreementChain's collectMissingFields: every missing required field at once (name, type,
   * customer, start, end), so one Save attempt reports all of them.
   */
  function missingFields(formData) {
    var f = formData || {};
    var missing = [];
    if (!f.agreementName || !String(f.agreementName).trim()) missing.push('Agreement Name');
    if (!f.agreementType) missing.push('Agreement Type');
    if (!f.customerId)    missing.push('Customer');
    if (!f.startDate)     missing.push('Start Date');
    if (!f.endDate)       missing.push('End Date');
    return missing;
  }

  /** End before start is not caught by the old page; it is shown but does not block Save (same calls). */
  function datesBackwards(formData) {
    var f = formData || {};
    return !!(f.startDate && f.endDate && String(f.endDate).slice(0, 10) < String(f.startDate).slice(0, 10));
  }

  /**
   * The old addAgreementLineChain's checks for a draft line: a class, a rate above 0, and not the same equipment
   * twice. Returns '' or the message the old chain showed.
   */
  function lineProblem(draft, lines) {
    var d = draft || {};
    if (!d.classId) return 'Please select an Equipment Class before adding a line.';
    if (d.unitPrice == null || d.unitPrice === '' || Number(d.unitPrice) <= 0) return 'Rate must be greater than 0.';
    if (d.equipmentMasterId != null && (lines || []).some(function (l) { return Number(l.equipmentMasterId) === Number(d.equipmentMasterId); })) {
      return 'This equipment is already on the agreement. The same equipment cannot be added twice.';
    }
    return '';
  }

  /** max(existing line numbers) + 1 (UK_EQR_AGR_LINE_NUM; numbers can have gaps), as the old chain did. */
  function nextLineNumber(lines) {
    var nums = (lines || []).map(function (l) { return Number(l.lineNumber) || 0; });
    return (nums.length ? Math.max.apply(null, nums) : 0) + 1;
  }

  /** The line a draft becomes (the old addAgreementLineChain). */
  function lineFromDraft(draft, lines) {
    return {
      lineNumber:            nextLineNumber(lines),
      equipmentClassId:      draft.classId,
      equipmentClassName:    draft.className || '',
      equipmentSubclassId:   draft.subclassId || null,
      equipmentSubclassName: draft.subclassName || '',
      equipmentMasterId:     draft.equipmentMasterId != null ? Number(draft.equipmentMasterId) : null,
      equipmentName:         draft.equipmentName || '',
      description:           draft.description || '',
      unitPrice:             draft.unitPrice,
      priceUom:              draft.priceUom || 'DAY'
    };
  }

  function toIso(dateStr) {
    if (!dateStr) return null;
    if (dateStr.indexOf('T') !== -1) return dateStr;
    return dateStr + 'T00:00:00Z';
  }

  /** PUT /agreement-headers/{id}: the full DTO from the loaded header, with the edits (PATCH cannot take the dates). */
  function putHeaderBody(headerId, loaded, formData) {
    var l = loaded || {};
    return {
      id:                  headerId,
      agreementNumber:     l.agreementNumber,
      agreementName:       formData.agreementName,
      customerRefId:       null,
      fusionCustomerId:    formData.customerId != null ? Number(formData.customerId) : null,
      projectRefId:        l.projectRefId        != null ? l.projectRefId        : null,
      equipmentClassId:    l.equipmentClassId    != null ? l.equipmentClassId    : null,
      agreementType:       formData.agreementType,
      status:              l.status || 'DRAFT',
      effectiveFrom:       toIso(formData.startDate),
      effectiveTo:         toIso(formData.endDate),
      currencyCode:        formData.currencyCode || 'USD',
      notes:               formData.notes || '',
      objectVersionNumber: l.objectVersionNumber != null ? l.objectVersionNumber : 1
    };
  }

  /** POST /agreement-headers: a new agreement, as DRAFT. */
  function createHeaderBody(agreementNumber, formData) {
    return {
      agreementNumber:  agreementNumber,
      agreementName:    formData.agreementName,
      customerRefId:    null,
      fusionCustomerId: formData.customerId != null ? Number(formData.customerId) : null,
      agreementType:    formData.agreementType,
      status:           'DRAFT',
      effectiveFrom:    toIso(formData.startDate),
      effectiveTo:      toIso(formData.endDate),
      currencyCode:     formData.currencyCode || 'USD',
      notes:            formData.notes || ''
    };
  }

  /** PATCH /agreement-lines/{id} for a kept line. */
  function patchLineBody(line) {
    return {
      equipmentClassId:  line.equipmentClassId,
      equipmentMasterId: line.equipmentMasterId || null,
      description:       line.description || '',
      unitPrice:         line.unitPrice,
      priceUom:          line.priceUom
    };
  }

  /** POST /agreement-lines for a new line: quantity goes to MIN_COMMIT_DAYS (NOT NULL), 1 by default. */
  function createLineBody(headerId, line) {
    return {
      agreementHeaderId: headerId,
      lineNumber:        line.lineNumber,
      equipmentClassId:  line.equipmentClassId,
      equipmentMasterId: line.equipmentMasterId || null,
      description:       line.description || '',
      unitPrice:         line.unitPrice,
      priceUom:          line.priceUom,
      quantity:          (line.quantity != null ? Number(line.quantity) : 1)
    };
  }

  /** The number prefix of an agreement type: its configured typePrefix, else AGR. */
  function typePrefix(types, agreementType) {
    var match = (Array.isArray(types) ? types : []).filter(function (t) { return t && t.typeCode === agreementType; })[0];
    return match && match.typePrefix ? String(match.typePrefix).toUpperCase() : 'AGR';
  }

  /** PREFIX-####: the highest number with that prefix in the list + 1 (an anchored match, so ST- is not STX-). */
  function nextAgreementNumber(prefixCode, rows) {
    var seqRe = new RegExp('^' + prefixCode + '-(\\d+)$');
    var matches = (rows || [])
      .map(function (a) { return a && a.agreementNumber && seqRe.exec(a.agreementNumber); })
      .filter(Boolean)
      .map(function (m) { return parseInt(m[1], 10) || 0; });
    var nextSeq = matches.length > 0 ? Math.max.apply(null, matches) + 1 : 1;
    var s = String(nextSeq);
    while (s.length < 4) s = '0' + s;
    return prefixCode + '-' + s;
  }

  function uomLabel(v) {
    var o = UOMS.filter(function (u) { return u.value === v; })[0];
    return o ? o.label.toLowerCase() : txt(v).toLowerCase();
  }

  /** What Save will write, before the click. */
  function saveText(isEdit, lines, deletedIds) {
    var n = (lines || []).length;
    var fresh = (lines || []).filter(function (l) { return !l.lineId; }).length;
    var del = (deletedIds || []).length;
    if (!isEdit) return 'Creates the agreement as a draft with ' + n + (n === 1 ? ' line' : ' lines') + '; it is used once approved.';
    var parts = ['updates the header'];
    if (del) parts.push('removes ' + del + (del === 1 ? ' line' : ' lines'));
    if (n - fresh) parts.push('updates ' + (n - fresh) + (n - fresh === 1 ? ' line' : ' lines'));
    if (fresh) parts.push('adds ' + fresh + (fresh === 1 ? ' line' : ' lines'));
    return 'Save ' + parts.join(', ') + '.';
  }

  return {
    STATUSES: STATUSES,
    EXPIRING_DAYS: EXPIRING_DAYS,
    SHOW_STEP: SHOW_STEP,
    UOMS: UOMS,
    CURRENCIES: CURRENCIES,
    statusLabel: statusLabel,
    tone: tone,
    daysLeft: daysLeft,
    isExpiring: isExpiring,
    expiryText: expiryText,
    canEdit: canEdit,
    canDecide: canDecide,
    canRequest: canRequest,
    listRow: listRow,
    newestFirst: newestFirst,
    chips: chips,
    filterRows: filterRows,
    sort: sort,
    nextStep: nextStep,
    summary: summary,
    listExportColumns: listExportColumns,
    buildLines: buildLines,
    filterLines: filterLines,
    rateText: rateText,
    selectedCount: selectedCount,
    toggle: toggle,
    toggleShown: toggleShown,
    allShownSelected: allShownSelected,
    requestPreview: requestPreview,
    pendingLines: pendingLines,
    cartItem: cartItem,
    writeHandoff: writeHandoff,
    linesExportColumns: linesExportColumns,
    emptyForm: emptyForm,
    formFromHeader: formFromHeader,
    editLines: editLines,
    missingFields: missingFields,
    datesBackwards: datesBackwards,
    lineProblem: lineProblem,
    nextLineNumber: nextLineNumber,
    lineFromDraft: lineFromDraft,
    toIso: toIso,
    putHeaderBody: putHeaderBody,
    createHeaderBody: createHeaderBody,
    patchLineBody: patchLineBody,
    createLineBody: createLineBody,
    typePrefix: typePrefix,
    nextAgreementNumber: nextAgreementNumber,
    uomLabel: uomLabel,
    saveText: saveText
  };
});
