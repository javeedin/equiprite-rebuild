define(['resources/js/requestLineBody', 'resources/js/requestModel', 'resources/js/fmt'], function (lineBody, requestModel, fmt) {
  'use strict';

  // A customer's new request (EquipRite Next, flows/customer order page): the rules of New EquipRite's customer New
  // request (flows/customer/pages/customer-new-request-page.js), ported function for function (the same answers, tested
  // side by side with New's page module), plus what the Next page shows (catalogView, cartLine, the words).
  //
  //   emptyForm, missingFor   the fields of the old customer-create-req form, and what each step needs
  //   buildDetail, buildRequest  the two objects the old CreateRequestNextChain hands the cart, so the shared
  //                           requestHeaderBody / requestLineBody builders post exactly what the old customer cart posts
  //   lineCost, cartSummary, rateText, cardEstimate, availability, classChips, filterCatalog, partyMatches, qtyIn

  function d10(v) { return v ? String(v).slice(0, 10) : ''; }
  function isConsumable(it) {
    return !!it && (it.isConsumable === true || it.isRentable === false || String(it.billingUnit || '').toUpperCase() === 'EACH');
  }
  var NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };
  function noun(t) { var u = String(t || '').trim().toUpperCase(); return NOUNS[u] || u; }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function money(n) {
    if (n == null || isNaN(Number(n))) return '—';
    var v = Number(n);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  function day(v) {
    var s = d10(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    return Number(s.slice(8, 10)) + ' ' + MONTHS[Number(s.slice(5, 7)) - 1];
  }

  /** A blank customer request: customer-create-req's formData fields. No project, task, contract, site or hours. */
  function emptyForm() {
    return {
      requestType: 'EXTERNAL',
      customerRefId: null, customerName: '',
      requestorId: null, requestorName: '',
      location: '', locationType: null, locationLatitude: null, locationLongitude: null,
      startDate: '', endDate: '', notes: ''
    };
  }

  /** Rental days, both ends counted (the line builder's rule). */
  function days(start, end) { return lineBody.rentalDays(d10(start), d10(end)); }

  /** Estimated cost of one cart line, as requestLineBody.build stores estimatedCost (null while a quote is pending). */
  function lineCost(item, start, end, hideRates) {
    if (!item || hideRates) return null;
    var qty = Number(item.quantity) || 1;
    var rate = Number(item.billingRate) || 0;
    if (isConsumable(item)) return lineBody.round2(qty * rate);
    var n = days(item.startDate || start, item.endDate || end);
    return n > 0 ? lineBody.round2(qty * rate * n) : null;
  }

  /** The totals: { lines, units, total, priced }. */
  function cartSummary(cart, start, end, hideRates) {
    var list = Array.isArray(cart) ? cart : [];
    var total = 0;
    var priced = 0;
    var units = 0;
    list.forEach(function (it) {
      units += Number(it.quantity) || 0;
      var c = lineCost(it, start, end, hideRates);
      if (c != null && Number(it.billingRate) > 0) {
        total += c;
        priced += 1;
      }
    });
    return { lines: list.length, units: units, total: lineBody.round2(total), priced: priced };
  }

  /** The price as the business quotes it ($3,200 / WEEK, $25 / unit) for a catalog row or a cart item. */
  function rateText(x, hideRates) {
    if (!x) return '';
    if (hideRates) return 'Rate on request';
    if (x.billingRate !== undefined) {
      if (isConsumable(x)) return money(x.billingRate) + ' / unit';
      if (x.periodAmount != null && x.periodUom) return money(x.periodAmount) + ' / ' + noun(x.periodUom);
      return Number(x.billingRate) > 0 ? money(x.billingRate) + ' / ' + noun(x.billingUnit || 'DAY') : 'No rate';
    }
    if (x.isRentable === false) return x.unitPrice != null ? money(x.unitPrice) + ' / unit' : 'Unit price not set';
    if (x.rate == null) return 'Rate on request';
    if (x.periodAmount == null) return money(x.rate) + (x.rateUom ? ' / ' + noun(x.rateUom) : '');
    return money(x.periodAmount) + (x.periodType ? ' / ' + noun(x.periodType) : '');
  }

  /** The availability badge: { key: ok | part | none | unknown, label }. No dates → unknown (browse mode). */
  function availability(row) {
    var s = String((row && row.availabilityStatus) || '').toUpperCase();
    var qty = row && row.availableQty != null ? Number(row.availableQty) : null;
    if (!s) return { key: 'unknown', label: 'Pick dates to check' };
    if (s === 'AVAILABLE') return { key: 'ok', label: qty != null ? 'Available · ' + qty : 'Available' };
    if (s === 'NOT AVAILABLE') return { key: 'none', label: 'Not available' };
    if (s === 'PARTIAL QUANTITY') return { key: 'part', label: 'Partial: ' + (qty != null ? qty + ' free' : 'some free') };
    if (s === 'PARTIAL DURATION') return { key: 'part', label: 'Partial: part of the dates' };
    return { key: 'part', label: s.charAt(0) + s.slice(1).toLowerCase() };
  }

  /** "Est. $38,400 for 26 days" for one unit; empty without dates, a price or when unavailable. */
  function cardEstimate(row, start, end, hideRates) {
    if (!row || hideRates || availability(row).key === 'none') return '';
    if (row.isRentable === false) return row.unitPrice != null ? 'Est. ' + money(row.unitPrice) + ' each' : '';
    var n = days(start, end);
    if (row.rate == null || n <= 0) return '';
    return 'Est. ' + money(lineBody.round2(Number(row.rate) * n)) + ' for ' + n + (n === 1 ? ' day' : ' days');
  }

  /** Class chips with counts, "All equipment" first, then by name. */
  function classChips(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var counts = {};
    list.forEach(function (r) { var c = r.className || 'Other'; counts[c] = (counts[c] || 0) + 1; });
    return [{ key: 'all', label: 'All equipment', count: list.length }]
      .concat(Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); }).map(function (c) { return { key: c, label: c, count: counts[c] }; }));
  }

  /** The rows shown: class, availability (ok = available or partial) and free text over name and class. */
  function filterCatalog(rows, text, cls, avail) {
    var q = String(text || '').trim().toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (cls && cls !== 'all' && (r.className || 'Other') !== cls) return false;
      if (avail === 'free' && ['ok', 'part'].indexOf(availability(r).key) === -1) return false;
      if (!q) return true;
      return [r.equipmentName, r.className, r.subclassName, r.equipmentDescription].some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  /** Customers or contacts matching the typed text, at most 20. */
  function partyMatches(list, text) {
    var q = String(text || '').trim().toLowerCase();
    return (Array.isArray(list) ? list : [])
      .filter(function (p) { return !q || [p.customerName, p.contactName, p.username, p.email].some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; }); })
      .slice(0, 20);
  }

  /** Quantity of one equipment already in the cart (0 when not there). */
  function qtyIn(cart, id) {
    var it = (Array.isArray(cart) ? cart : []).filter(function (c) { return Number(c.id) === Number(id); })[0];
    return it ? Number(it.quantity) || 0 : 0;
  }

  /**
   * What is missing, as labels. Step 1: the dates and equipment; step 2: what CreateRequestNextChain required (customer,
   * contact, delivery address). 'draft' checks what a draft needs; 'submit' checks everything.
   */
  function missingFor(step, form, cart) {
    var f = form || {};
    var out = [];
    var all = step === 'submit';
    var blank = function (v) { return v == null || (typeof v === 'string' && v.trim() === ''); };
    if (step === 1 || step === 'draft' || all) {
      if (!f.startDate) out.push('Start date');
      if (!f.endDate) out.push('End date');
      if (f.startDate && f.endDate && d10(f.endDate) < d10(f.startDate)) out.push('End date on or after the start date');
      if (!(Array.isArray(cart) && cart.length)) out.push('At least one piece of equipment');
    }
    if (step === 2 || all) {
      if (blank(f.customerRefId)) out.push('Customer');
      if (blank(f.requestorId)) out.push('Contact');
      if (blank(f.location)) out.push('Delivery address');
    }
    if (all) {
      (Array.isArray(cart) ? cart : []).forEach(function (it) {
        var s = d10(it.startDate || f.startDate);
        var e = d10(it.endDate || f.endDate);
        if (s && e && e < s) out.push('Dates of ' + (it.name || 'a line'));
      });
    }
    return out;
  }

  /** The ActiveRequestDetail snapshot CreateRequestNextChain takes for a customer request, field for field. */
  function buildDetail(form) {
    var f = form || {};
    return {
      customerRefId:      f.customerRefId,
      customerName:       f.customerName,
      requestorId:        f.requestorId,
      requestorName:      f.requestorName,
      location:           f.location,
      requestedStartDate: f.startDate,
      requestedEndDate:   f.endDate,
      notes:              f.notes || '',
      projectId:          null,
      projectNumber:      '',
      projectName:        '',
      taskId:             null,
      taskNumber:         '',
      taskName:           '',
      internalCustomerId:   null,
      internalCustomerName: '',
      contractId:         null,
      contractNumber:     '',
      isSoftReservation:  false
    };
  }

  /** $flow.variables.request as CreateRequestNextChain builds it: requestModel.defaultRequest() with the customer form. */
  function buildRequest(form) {
    var f = form || {};
    var r = Object.assign(requestModel.defaultRequest(), {
      customerId:        f.customerRefId,
      requestorId:       f.requestorId,
      requestorName:     f.requestorName,
      location:          f.location,
      startDate:         f.startDate,
      endDate:           f.endDate,
      notes:             f.notes || '',
      projectId:         null,
      projectNumber:     '',
      projectName:       '',
      taskId:            null,
      taskNumber:        '',
      taskName:          '',
      isSoftReservation: false
    });
    r.requestType = 'EXTERNAL';
    r.locationLatitude = f.locationLatitude != null ? f.locationLatitude : null;
    r.locationLongitude = f.locationLongitude != null ? f.locationLongitude : null;
    if (f.locationType) r.locationType = f.locationType;
    return r;
  }

  /** "2 Nov – 15 Dec · 44 days", or a prompt when the dates are not set yet. */
  function windowText(start, end) {
    if (!start || !end) return 'Pick the dates';
    var n = days(start, end);
    return day(start) + ' – ' + day(end) + (n > 0 ? ' · ' + n + (n === 1 ? ' day' : ' days') : '');
  }

  // ── What the Next page shows ─────────────────────────────────────────────────────────────────────────────────────

  /** The catalog as shown: [{ id, name, cls, avail, availLabel, rate, est, addable }], with the count before the limit. */
  function catalogView(rows, text, cls, avail, limit, form, hideRates) {
    var f = form || {};
    var list = filterCatalog(rows, text, cls, avail);
    return {
      count: list.length,
      chips: classChips(rows),
      shown: list.slice(0, limit || 48).map(function (r) {
        var a = availability(r);
        return {
          id: Number(r.eqrEquipmentMasterId),
          name: r.equipmentName || 'Equipment',
          cls: [r.className, r.subclassName].filter(Boolean).join(' · '),
          avail: a.key,
          availLabel: a.label,
          rate: rateText(r, hideRates),
          est: cardEstimate(r, f.startDate, f.endDate, hideRates),
          addable: a.key !== 'none'
        };
      })
    };
  }

  /** The cart's equipment ids, in order (rows render from these, so editing one line keeps the others' inputs). */
  function ids(cart) { return (Array.isArray(cart) ? cart : []).map(function (c) { return Number(c.id); }); }

  /** One cart line as shown: name, class, qty, rate, cost, dates (its own or the request's), note. */
  function cartLine(cart, id, form, hideRates) {
    var it = (Array.isArray(cart) ? cart : []).filter(function (c) { return Number(c.id) === Number(id); })[0] || {};
    var f = form || {};
    var cost = lineCost(it, f.startDate, f.endDate, hideRates);
    var start = d10(it.startDate || f.startDate);
    var end = d10(it.endDate || f.endDate);
    return {
      id: Number(id),
      name: it.name || 'Equipment',
      cls: it['class'] || '',
      qty: Number(it.quantity) || 1,
      rate: rateText(it, hideRates),
      cost: hideRates ? 'On the quote' : (cost != null ? money(cost) : '—'),
      start: start,
      end: end,
      ownDates: !!(it.startDate || it.endDate),
      notes: it.notes || '',
      about: isConsumable(it) ? 'consumable' : (start && end ? fmt.range(start, end) : 'pick the dates')
    };
  }

  /** "Estimated total" and its note, or the quote that is coming. */
  function totals(cart, form, hideRates) {
    var f = form || {};
    var s = cartSummary(cart, f.startDate, f.endDate, hideRates);
    if (hideRates) return { total: '', note: 'Prices come on the quote for this request.', summary: s };
    var unpriced = s.lines - s.priced;
    return {
      total: money(s.total),
      note: unpriced ? unpriced + (unpriced === 1 ? ' line has' : ' lines have') + ' no price for these dates yet' : 'for ' + (days(f.startDate, f.endDate) || 0) + ' days',
      summary: s
    };
  }

  /** "Still needed: Start date, Customer." */
  function missingText(list) {
    var l = Array.isArray(list) ? list : [];
    return l.length ? 'Still needed: ' + l.join(', ') + '.' : '';
  }

  /** "3 pieces on 2 lines". */
  function cartCount(cart) {
    var s = cartSummary(cart, '', '', true);
    return s.lines ? s.units + (s.units === 1 ? ' piece' : ' pieces') + ' on ' + s.lines + (s.lines === 1 ? ' line' : ' lines') : 'Empty';
  }

  return {
    emptyForm: emptyForm,
    days: days,
    lineCost: lineCost,
    cartSummary: cartSummary,
    rateText: rateText,
    cardEstimate: cardEstimate,
    availability: availability,
    classChips: classChips,
    filterCatalog: filterCatalog,
    partyMatches: partyMatches,
    qtyIn: qtyIn,
    missingFor: missingFor,
    buildDetail: buildDetail,
    buildRequest: buildRequest,
    windowText: windowText,
    day: day,
    money: money,
    catalogView: catalogView,
    ids: ids,
    cartLine: cartLine,
    totals: totals,
    missingText: missingText,
    cartCount: cartCount
  };
});
