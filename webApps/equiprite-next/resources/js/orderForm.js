define(['resources/js/requestLineBody', 'resources/js/fmt'], function (lineBody, fmt) {
  'use strict';

  // New request in EquipRite Next: the page's rules, pure and testable. The business rules are New EquipRite's
  // (flows/request/pages/new-request-page.js, itself the old create page and cart for a project request), kept as
  // they are: the form's shape, what a draft and a submit need, the snapshot the shared builders read
  // (requestHeaderBody, requestLineBody), and the estimate, which is exactly what requestLineBody posts as
  // estimatedCost. What Next adds is how it reads: the catalog rows as shown, the cart as shown, and the words.

  var DAY_MS = 86400000;
  var LENGTHS = [{ days: 7, label: '1 week' }, { days: 14, label: '2 weeks' }, { days: 28, label: '4 weeks' }];
  var NOUNS = { DAY: 'day', DAILY: 'day', WEEK: 'week', WEEKLY: 'week', MONTH: 'month', MONTHLY: 'month',
    HOUR: 'hour', HOURLY: 'hour', YEAR: 'year', YEARLY: 'year', EACH: 'unit' };

  function d10(v) { return v ? String(v).slice(0, 10) : ''; }
  function num(v) { return v == null || v === '' || isNaN(Number(v)) ? null : Number(v); }
  function isConsumable(it) {
    return !!it && (it.isConsumable === true || it.isRentable === false || String(it.billingUnit || '').toUpperCase() === 'EACH');
  }
  function noun(t) { var u = String(t || '').trim().toUpperCase(); return NOUNS[u] || u.toLowerCase(); }
  function money(n) { return fmt.money(n) || '—'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /** 'A', 'A and B', 'A, B and C'. */
  function listWords(items) {
    var a = (items || []).filter(function (x) { return !!x; });
    if (a.length < 2) return a.join('');
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }

  /** A blank form in the old flow's request shape (requestModel), INTERNAL: the requestor is the signed-in user. */
  function emptyForm(requestorName, requestorUsername) {
    return {
      requestType: 'INTERNAL',
      requestorId: null, requestorName: requestorName || '', requestorUsername: requestorUsername || '',
      projectId: null, projectNumber: '', projectName: '', projectBuId: null, projectBuName: '',
      taskId: null, taskNumber: '', taskName: '',
      customerId: null, customerName: '',
      contractId: null, contractNumber: '',
      locationType: 'DELIVERY_LOCATION', location: '', deliveryInvOrgId: null, deliveryLocationId: null,
      locationLatitude: null, locationLongitude: null,
      startDate: '', endDate: '', hours: null, notes: '', isSoftReservation: false
    };
  }

  /** Rental days, both ends counted (the line builder's rule). */
  function days(start, end) { return lineBody.rentalDays(d10(start), d10(end)); }

  /** The end date that makes a rental of n days from start (both ends counted), or ''. */
  function endAfter(start, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d10(start));
    var k = Number(n);
    if (!m || !(k > 0)) return '';
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + (k - 1) * DAY_MS).toISOString().slice(0, 10);
  }

  /** The quick lengths (1, 2, 4 weeks), the one the dates make marked on. */
  function lengths(start, end) {
    var n = start && end ? days(start, end) : 0;
    return LENGTHS.map(function (l) { return { days: l.days, label: l.label, on: n === l.days }; });
  }

  /**
   * Estimated cost of one cart line over its own window, exactly as requestLineBody.build stores estimatedCost:
   * qty × daily rate × days for a rentable, qty × unit price for a consumable, null while a quote is pending.
   */
  function lineCost(item, start, end, hideRates) {
    if (!item || hideRates) return null;
    var qty = Number(item.quantity) || 1;
    var rate = Number(item.billingRate) || 0;
    if (isConsumable(item)) return lineBody.round2(qty * rate);
    var n = days(item.startDate || start, item.endDate || end);
    return n > 0 ? lineBody.round2(qty * rate * n) : null;
  }

  /** The cart's totals: { lines, units, total, priced }. Unpriced lines (no rate, no days) are left out. */
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

  /** The price as the business quotes it ($3,200 / week, $25 / unit) for a catalog row or a cart item. */
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

  /** Whether a catalog row is free for the dates: { key: ok | part | none | unknown, label }. No dates: unknown. */
  function availability(row) {
    var s = String((row && row.availabilityStatus) || '').toUpperCase();
    var qty = row && row.availableQty != null ? Number(row.availableQty) : null;
    if (!s) return { key: 'unknown', label: 'Pick dates' };
    if (s === 'AVAILABLE') return { key: 'ok', label: qty != null ? qty + ' free' : 'Free' };
    if (s === 'NOT AVAILABLE') return { key: 'none', label: 'Not free' };
    if (s === 'PARTIAL QUANTITY') return { key: 'part', label: qty != null ? 'Only ' + qty + ' free' : 'Some free' };
    if (s === 'PARTIAL DURATION') return { key: 'part', label: 'Some dates only' };
    return { key: 'part', label: s.charAt(0) + s.slice(1).toLowerCase() };
  }

  /**
   * One unit of a catalog row for the dates, as the line would be priced: { amount, note }, or null without dates,
   * without a price, when it is not free or while a quote is pending.
   */
  function estimate(row, start, end, hideRates) {
    if (!row || hideRates || availability(row).key === 'none') return null;
    if (row.isRentable === false) return row.unitPrice != null ? { amount: Number(row.unitPrice), note: 'each' } : null;
    var n = days(start, end);
    if (row.rate == null || n <= 0) return null;
    return { amount: lineBody.round2(Number(row.rate) * n), note: plural(n, 'day') + ', each' };
  }

  /** Class chips with counts, "All equipment" first, then by name. */
  function classChips(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var counts = {};
    list.forEach(function (r) {
      var c = r.className || 'Other';
      counts[c] = (counts[c] || 0) + 1;
    });
    return [{ key: 'all', label: 'All equipment', count: list.length }]
      .concat(Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); })
        .map(function (c) { return { key: c, label: c, count: counts[c] }; }));
  }

  /** The rows shown: class, availability (free = available or partly) and text over name, class and description. */
  function filterCatalog(rows, text, cls, avail) {
    var q = String(text || '').trim().toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (cls && cls !== 'all' && (r.className || 'Other') !== cls) return false;
      if (avail === 'free' && ['ok', 'part'].indexOf(availability(r).key) === -1) return false;
      if (!q) return true;
      return [r.equipmentName, r.className, r.subclassName, r.equipmentDescription]
        .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  /** Catalog rows as the list shows them: name, class, availability, the quoted rate, one unit for the dates. */
  function catalogView(rows, start, end, hideRates) {
    return (Array.isArray(rows) ? rows : []).map(function (r) {
      var a = availability(r);
      var est = estimate(r, start, end, hideRates);
      return {
        id: Number(r.eqrEquipmentMasterId),
        name: r.equipmentName || 'Equipment',
        image: r.equipmentImage || '',
        cls: [r.className, r.subclassName].filter(function (x) { return !!x; }).join(' · '),
        avail: a.key,
        availLabel: a.label,
        rate: rateText(r, hideRates),
        est: est ? money(est.amount) : '',
        estNote: est ? est.note : (hideRates ? 'On the quote' : ''),
        addable: a.key !== 'none'
      };
    });
  }

  /** Tasks matching the filter text (number or name), at most 30 so a big WBS stays readable. */
  function taskMatches(tasks, text) {
    var q = String(text || '').trim().toLowerCase();
    return (Array.isArray(tasks) ? tasks : [])
      .filter(function (t) { return !q || [t.TaskNumber, t.TaskName].some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; }); })
      .slice(0, 30);
  }

  /** Quantity of one equipment already in the cart (0 when not there). */
  function qtyIn(cart, id) {
    var it = (Array.isArray(cart) ? cart : []).filter(function (c) { return Number(c.id) === Number(id); })[0];
    return it ? Number(it.quantity) || 0 : 0;
  }

  /**
   * What is missing, as labels. 1: the dates and the equipment; 2: what the old create page required for an
   * INTERNAL request (project, task, customer, delivery location); 'review': both (what Review needs, as New's
   * step 3 does); 'draft': what a draft needs (dates and equipment); 'submit': everything, and each line's dates.
   */
  function missingFor(step, form, cart) {
    var f = form || {};
    var out = [];
    var all = step === 'submit';
    var both = all || step === 'review';
    if (step === 1 || step === 'draft' || both) {
      if (!f.startDate) out.push('Start date');
      if (!f.endDate) out.push('End date');
      if (f.startDate && f.endDate && d10(f.endDate) < d10(f.startDate)) out.push('End date on or after the start date');
      if (!(Array.isArray(cart) && cart.length)) out.push('At least one piece of equipment');
    }
    if (step === 2 || both) {
      if (!f.projectId) out.push('Project');
      if (!f.taskId) out.push('Task');
      if (f.customerId == null || f.customerId === '') out.push('Customer');
      if (!String(f.location || '').trim()) out.push('Delivery location');
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

  /**
   * The ActiveRequestDetail snapshot the old NavigateToCatalogChain takes for an INTERNAL request; requestHeaderBody
   * and requestLineBody read it (detail.* after request.*), so a request from here posts what the old page posts.
   */
  function buildDetail(form) {
    var f = form || {};
    return {
      requestorId: f.requestorId != null ? f.requestorId : null,
      requestorName: f.requestorName || '',
      location: f.location || '',
      locationType: f.locationType || null,
      deliveryInvOrgId: num(f.deliveryInvOrgId),
      deliveryLocationId: num(f.deliveryLocationId),
      requestedStartDate: f.startDate || null,
      requestedEndDate: f.endDate || null,
      hours: num(f.hours),
      projectId: f.projectId,
      projectNumber: f.projectNumber || '',
      projectName: f.projectName || '',
      projectBuId: f.projectBuId != null ? f.projectBuId : null,
      projectBuName: f.projectBuName || '',
      taskId: f.taskId,
      taskNumber: f.taskNumber || '',
      taskName: f.taskName || '',
      customerRefId: null,
      customerName: '',
      internalCustomerId: f.customerId != null && f.customerId !== '' ? f.customerId : null,
      internalCustomerName: f.customerName || '',
      contractId: f.contractId != null && f.contractId !== '' ? f.contractId : null,
      contractNumber: f.contractNumber || '',
      notes: f.notes || '',
      isSoftReservation: false
    };
  }

  /** "2 Nov – 27 Nov 2026 · 26 days", or a prompt while a date is missing. */
  function windowText(start, end) {
    if (!start || !end) return 'Pick the dates';
    var n = days(start, end);
    return fmt.range(d10(start), d10(end)) + (n > 0 ? ' · ' + plural(n, 'day') : '');
  }

  /** One cart line as the rail and Review show it: quantity, rate, its own window and what it comes to. */
  function lineView(it, form, hideRates) {
    var f = form || {};
    if (!it) return { id: 0, name: '', cls: '', qty: 0, rate: '', cost: '', start: '', end: '', own: false, window: '', notes: '', agreement: false, about: '' };
    var cost = lineCost(it, f.startDate, f.endDate, hideRates);
    var own = !!(it.startDate || it.endDate);
    var rate = rateText(it, hideRates);
    var agreement = it.source === 'agreement';
    var win = own ? windowText(it.startDate || f.startDate, it.endDate || f.endDate) : '';
    return {
      id: Number(it.id),
      name: it.name || 'Equipment',
      cls: it['class'] || '',
      qty: Number(it.quantity) || 1,
      rate: rate,
      cost: hideRates ? '' : (cost != null && Number(it.billingRate) > 0 ? money(cost) : (Number(it.billingRate) > 0 ? '—' : 'No rate')),
      start: d10(it.startDate || f.startDate),
      end: d10(it.endDate || f.endDate),
      own: own,
      window: win,
      notes: it.notes || '',
      agreement: agreement,
      about: [rate, win, agreement ? 'agreement rate' : ''].filter(function (x) { return !!x; }).join(' · ')
    };
  }

  /** The cart as the rail and Review show it. */
  function cartLines(cart, form, hideRates) {
    return (Array.isArray(cart) ? cart : []).map(function (it) { return lineView(it, form, hideRates); });
  }

  /**
   * The cart's equipment ids. The lists render from these (numbers), and each row reads its line with cartLine, so
   * a change to the cart or the form updates the rows in place instead of drawing them again: the field being typed
   * in keeps its focus.
   */
  function cartIds(cart) {
    return (Array.isArray(cart) ? cart : []).map(function (it) { return Number(it.id); });
  }

  /** One line of the cart by equipment id, as lineView reads it. */
  function cartLine(cart, id, form, hideRates) {
    var it = (Array.isArray(cart) ? cart : []).filter(function (c) { return Number(c.id) === Number(id); })[0];
    return lineView(it, form, hideRates);
  }

  // The order the screen asks for things in (the customer comes first on the Project step), for saying what is missing.
  // The labels themselves are missingFor's, New EquipRite's rule.
  var SCREEN_ORDER = ['Start date', 'End date', 'End date on or after the start date', 'At least one piece of equipment', 'Customer', 'Project', 'Task',
    'Delivery location'];

  /** Missing labels in the order the screen asks for them (others after, as they came). */
  function screenOrder(missing) {
    var list = Array.isArray(missing) ? missing.slice() : [];
    var rank = function (m) { var i = SCREEN_ORDER.indexOf(m); return i === -1 ? SCREEN_ORDER.length + list.indexOf(m) : i; };
    return list.sort(function (a, b) { return rank(a) - rank(b); });
  }

  /** The rail's line under the cart: what Submit still needs, in words, or that it is ready for review. */
  function stillNeeded(form, cart) {
    var m = screenOrder(missingFor('review', form, cart));
    return m.length ? 'Still needed: ' + listWords(m) + '.' : '';
  }

  /** What Submit for approval will do, said before it is pressed. */
  function submitWords(cart, resume) {
    var n = (Array.isArray(cart) ? cart : []).length;
    var what = resume && resume.requestNumber ? 'Draft ' + resume.requestNumber : 'A new request';
    return what + ' with ' + plural(n, 'line') + ' goes to the project\'s approver; it then opens in a tab of its own.';
  }

  /** What Save draft will do. */
  function draftWords(resume) {
    return resume && resume.requestNumber
      ? 'Save draft updates ' + resume.requestNumber + '. Nothing is sent for approval.'
      : 'Save draft keeps it as a draft in Requests. Nothing is sent for approval.';
  }

  /** New EquipRite's customer New request (where a customer request and its Fusion contract are raised today). */
  function customerRequestUrl(newBase, draftId) {
    if (!newBase) return '';
    var base = newBase.slice(-1) === '/' ? newBase : newBase + '/';
    return base + 'vp/shell/customer/customer-new-request' + (Number(draftId) > 0 ? '?draftId=' + encodeURIComponent(draftId) : '');
  }

  /** "From agreement AG-12 · Acme · 3 lines in the cart at the agreement's rates." */
  function agreementText(a) {
    if (!a) return '';
    return 'From agreement ' + (a.number || a.id) + (a.customer ? ' · ' + a.customer : '') + ' · '
      + plural(Number(a.lines) || 0, 'line') + ' in the cart at the agreement\'s rates. Pick the dates and the project for this rental.';
  }

  return {
    LENGTHS: LENGTHS,
    emptyForm: emptyForm,
    days: days,
    endAfter: endAfter,
    lengths: lengths,
    lineCost: lineCost,
    cartSummary: cartSummary,
    rateText: rateText,
    availability: availability,
    estimate: estimate,
    classChips: classChips,
    filterCatalog: filterCatalog,
    catalogView: catalogView,
    taskMatches: taskMatches,
    qtyIn: qtyIn,
    missingFor: missingFor,
    buildDetail: buildDetail,
    windowText: windowText,
    cartLines: cartLines,
    cartIds: cartIds,
    cartLine: cartLine,
    stillNeeded: stillNeeded,
    submitWords: submitWords,
    draftWords: draftWords,
    customerRequestUrl: customerRequestUrl,
    agreementText: agreementText,
    listWords: listWords,
    screenOrder: screenOrder,
    money: money
  };
});
