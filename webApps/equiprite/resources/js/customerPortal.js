define([], function () {
  'use strict';

  // The customer portal's shared logic (New EquipRite, flows/customer): the words a customer sees for each status, the
  // parcel-style tracker, "what needs you next", and the invoice maths. Pure functions, no calls: the chains read and
  // write through the old endpoints and hand the rows here.
  //
  // The invoice part (parseDate … invoiceTotals) is carried over unchanged from Old EquipRite's
  // flows/customer-portal/pages/customer-billing-detail-page-chains/BillingDetailInitChain.js, so a customer sees the
  // same statuses and totals in both apps.

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function up(s) { return String(s == null ? '' : s).trim().toUpperCase(); }

  // ── Words ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  // Plain words for a request or line status, and a tone for its pill. A status not listed (a new backend value) reads
  // as its own words, lower case, in the neutral tone.
  var STATUS = {
    DRAFT:                   ['Draft, not sent', 'action'],
    SUBMITTED:               ['Sent, waiting for review', 'wait'],
    IN_PROCESS:              ['In progress', 'wait'],
    QUOTE_GENERATED:         ['Quote ready for you', 'action'],
    QUOTE_ACCEPTED:          ['Confirmed', 'ok'],
    APPROVED:                ['Confirmed', 'ok'],
    ALLOCATED:               ['Confirmed', 'ok'],
    UNDER_PROCUREMENT:       ['Being sourced', 'ok'],
    PICK_INITIATED:          ['Being prepared', 'ok'],
    PICK_RELEASED:           ['Being prepared', 'ok'],
    EQP_INSPECTION_COMPLETE: ['Checked, ready to ship', 'ok'],
    SHIPPED:                 ['On the way', 'moving'],
    SHIP_TO_SITE:            ['Arrived, please confirm', 'action'],
    DEPLOYED:                ['On site', 'onsite'],
    DELIVERED:               ['On site', 'onsite'],
    CONSUMED:                ['Used', 'done'],
    RETURN_INITIATED:        ['Going back', 'moving'],
    RETURNED:                ['Returned', 'done'],
    CLOSED:                  ['Done', 'done'],
    REJECTED:                ['Turned down', 'stopped'],
    CANCELLED:               ['Cancelled', 'stopped'],
    DECLINED:                ['Declined', 'stopped']
  };

  function statusText(code) {
    var c = up(code);
    if (!c) return '';
    if (STATUS[c]) return STATUS[c][0];
    var w = c.replace(/_/g, ' ').toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  /** 'er-cu-pill er-cu-pill--<tone>' for a status. */
  function statusClass(code) {
    var c = up(code);
    return 'er-cu-pill er-cu-pill--' + (STATUS[c] ? STATUS[c][1] : 'neutral');
  }

  // ── Dates and money ───────────────────────────────────────────────────────────────────────────────────────────────

  function d10(v) { return v ? String(v).substring(0, 10) : ''; }

  /** '2 Nov' from an ISO date (or ''), with the year when asked. */
  function day(v, withYear) {
    var s = d10(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    return Number(s.slice(8, 10)) + ' ' + MONTHS[Number(s.slice(5, 7)) - 1] + (withYear ? ' ' + s.slice(0, 4) : '');
  }

  /** '2 Nov – 15 Dec 2026' (the year once when both dates share it). */
  function dateRange(a, b) {
    var s = d10(a), e = d10(b);
    if (day(s) && day(e)) {
      return s.slice(0, 4) === e.slice(0, 4) ? day(s) + ' – ' + day(e, true) : day(s, true) + ' – ' + day(e, true);
    }
    return day(s, true) || day(e, true) || '';
  }

  /** '$18,420' or '$1,250.50'; '—' for nothing. */
  function money(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    var v = Number(n);
    var neg = v < 0;
    var s = '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
    return neg ? '−' + s : s;
  }

  // ── The parcel tracker ────────────────────────────────────────────────────────────────────────────────────────────

  // Six stops a customer understands, with the request and line statuses that mean "at this stop". The furthest line
  // counts: a request whose lines are on site reads On site even while the header still says IN_PROCESS.
  var STEPS = [
    { key: 'requested', label: 'Requested',      statuses: ['DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_GENERATED'] },
    { key: 'confirmed', label: 'Confirmed',      statuses: ['QUOTE_ACCEPTED', 'APPROVED', 'ALLOCATED', 'UNDER_PROCUREMENT'] },
    { key: 'preparing', label: 'Being prepared', statuses: ['PICK_INITIATED', 'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE'] },
    { key: 'onway',     label: 'On the way',     statuses: ['SHIPPED', 'SHIP_TO_SITE'] },
    { key: 'onsite',    label: 'On site',        statuses: ['DEPLOYED', 'DELIVERED', 'CONSUMED'] },
    { key: 'returned',  label: 'Returned',       statuses: ['RETURN_INITIATED', 'RETURNED', 'CLOSED'] }
  ];
  var STOPPED = { REJECTED: 'Turned down', CANCELLED: 'Cancelled', DECLINED: 'Declined' };
  var FINISHED_LINE = { RETURNED: 1, CLOSED: 1, CONSUMED: 1, REJECTED: 1, CANCELLED: 1 };

  function stepIndex(status) {
    var c = up(status);
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i].statuses.indexOf(c) !== -1) return i;
    }
    return -1;
  }

  /**
   * The tracker for one request: [{ key, label, state: done | current | todo | stopped, when }].
   *
   * @param {string} status  the request (header) status
   * @param {Array}  lines   its lines ({ lineStatus }), or [] when only the header is known (lists)
   * @param {Object} [info]  { startDate, endDate, createdDate, contractNumber } for the small print under each stop
   */
  function trackSteps(status, lines, info) {
    var header = up(status);
    var list = Array.isArray(lines) ? lines : [];
    var x = info || {};
    var at = stepIndex(header);
    list.forEach(function (l) { at = Math.max(at, stepIndex(l && l.lineStatus)); });
    // Finished: the request is closed, or every line is finished (back, used up or turned down) and at least one came
    // back, so a request whose lines were all turned down does not read as returned.
    var finished = header === 'CLOSED' || header === 'RETURNED' || (list.length > 0
      && list.every(function (l) { return !!FINISHED_LINE[up(l && l.lineStatus)]; })
      && list.some(function (l) { var s = up(l && l.lineStatus); return s === 'RETURNED' || s === 'CLOSED'; }));
    var stopped = STOPPED[header];
    if (at < 0) at = 0;
    var anyArrived = list.some(function (l) { return up(l && l.lineStatus) === 'SHIP_TO_SITE'; });
    var when = {
      requested: header === 'DRAFT' ? 'Not sent yet' : (header === 'QUOTE_GENERATED' ? 'Quote ready' : day(x.createdDate)),
      confirmed: x.contractNumber ? 'Contract ' + x.contractNumber : '',
      preparing: '',
      onway:     anyArrived ? 'Arrived' : (x.startDate ? 'Due ' + day(x.startDate) : ''),
      onsite:    x.startDate ? 'From ' + day(x.startDate) : '',
      returned:  finished ? 'All back' : (x.endDate ? 'Due back ' + day(x.endDate) : '')
    };
    return STEPS.map(function (s, i) {
      var state;
      if (stopped && i === at) state = 'stopped';
      else if (finished) state = 'done';
      else if (i < at) state = 'done';
      else if (i === at) state = 'current';
      else state = 'todo';
      return {
        key: s.key,
        label: stopped && i === at ? stopped : s.label,
        state: state,
        when: stopped && i === at ? '' : when[s.key]
      };
    });
  }

  // ── What needs the customer ───────────────────────────────────────────────────────────────────────────────────────

  var CONFIRMED = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'DEPLOYED'];

  /** Line actions (accept delivery, return) only once the request is in operations: the old page's allowlist. */
  function headerIsConfirmed(status) {
    return CONFIRMED.indexOf(up(status)) !== -1;
  }

  /**
   * The one thing to show at the top of a request: { key, tone, title, text, action }.
   * action: 'draft' | 'quote' | 'delivery' | 'return' | '' (no button).
   *
   * @param {Object} fd    { status, endDate }
   * @param {Array}  lines the request's lines ({ lineStatus })
   * @param {Object} opts  { quotingAllowed }
   */
  function nextAction(fd, lines, opts) {
    var s = up(fd && fd.status);
    var list = Array.isArray(lines) ? lines : [];
    var quoting = !!(opts && opts.quotingAllowed);
    var count = function (st) { return list.filter(function (l) { return up(l && l.lineStatus) === st; }).length; };
    var items = function (n) { return n + (n === 1 ? ' item' : ' items'); };
    if (s === 'DRAFT') {
      return { key: 'draft', tone: 'action', action: 'draft', title: 'This request has not been sent',
        text: 'Check it and send it when you are ready. Nothing is reserved for you until you do.' };
    }
    if (s === 'QUOTE_GENERATED') {
      return quoting
        ? { key: 'quote', tone: 'action', action: 'quote', title: 'Your quote is ready',
            text: 'Check the prices and accept the quote to confirm your rental. Accepting creates your rental contract.' }
        : { key: 'quote', tone: 'wait', action: '', title: 'Your quote is ready',
            text: 'Accepting quotes online is switched off. Your equipment manager will confirm it with you.' };
    }
    if (headerIsConfirmed(s) && count('SHIP_TO_SITE') > 0) {
      return { key: 'delivery', tone: 'action', action: 'delivery', title: 'Your equipment has arrived',
        text: items(count('SHIP_TO_SITE')) + ' arrived at your site. Check them, then accept the delivery, or refuse it if something is wrong.' };
    }
    if (STOPPED[s]) {
      return { key: 'stopped', tone: 'stopped', action: '', title: 'This request was ' + STOPPED[s].toLowerCase(),
        text: 'Contact your equipment manager if you still need the equipment. You can raise a new request at any time.' };
    }
    if (s === 'CLOSED' || s === 'RETURNED') {
      return { key: 'done', tone: 'done', action: '', title: 'All done', text: 'Everything on this request is back with us. Thank you.' };
    }
    if (headerIsConfirmed(s) && count('DEPLOYED') > 0) {
      return { key: 'return', tone: 'onsite', action: 'return', title: 'Finished with the equipment?',
        text: items(count('DEPLOYED')) + ' on site' + (fd && fd.endDate ? ', due back ' + day(fd.endDate, true) : '')
          + '. Start the return for anything you no longer need.' };
    }
    if (s === 'SUBMITTED' || s === 'IN_PROCESS') {
      return { key: 'wait', tone: 'wait', action: '', title: 'We are working on it',
        text: 'Your equipment manager is reviewing the request. '
          + (quoting ? 'Your quote will appear here to accept.' : 'You will see it move here as it is prepared and shipped.') };
    }
    return { key: 'wait', tone: 'ok', action: '', title: 'Nothing for you to do right now',
      text: 'We will update this page as your equipment is prepared and shipped.' };
  }

  // ── Lists ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  var DONE = { CLOSED: 1, RETURNED: 1, REJECTED: 1, CANCELLED: 1, DECLINED: 1 };
  var NEEDS = { DRAFT: 1, QUOTE_GENERATED: 1 };

  /** needs (waiting on the customer) | open | done, from the request status alone. */
  function groupOf(status) {
    var s = up(status);
    if (NEEDS[s]) return 'needs';
    return DONE[s] ? 'done' : 'open';
  }

  var GROUPS = [
    { key: 'needs', label: 'Needs you' },
    { key: 'open',  label: 'Open' },
    { key: 'done',  label: 'Finished' },
    { key: 'all',   label: 'All' }
  ];

  /** Chips with counts. "Open" counts everything not finished, including what needs the customer. */
  function groupChips(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var n = { needs: 0, open: 0, done: 0, all: list.length };
    list.forEach(function (r) {
      var g = groupOf(r && r.status);
      if (g === 'done') n.done++; else n.open++;
      if (g === 'needs') n.needs++;
    });
    return GROUPS.map(function (g) { return { key: g.key, label: g.label, count: n[g.key] }; });
  }

  /** Rows for a chip and the search text (request number, customer, contact, contract). */
  function filterRequests(rows, group, text) {
    var q = String(text || '').trim().toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      var g = groupOf(r && r.status);
      if (group === 'needs' && g !== 'needs') return false;
      if (group === 'open' && g === 'done') return false;
      if (group === 'done' && g !== 'done') return false;
      if (!q) return true;
      return [r.requestNumber, r.customerName, r.customerContact, r.contractNumber, statusText(r.status)]
        .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  /** A quote can be viewed once one exists (the old request page's rule), and only where quoting is on. */
  function hasQuote(status, quotingAllowed) {
    return !!quotingAllowed && ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED'].indexOf(up(status)) !== -1;
  }

  /**
   * The home page's "Next for you" list, most urgent first:
   *   quotes to accept, deliveries to confirm, drafts to send, overdue invoices.
   * @param {Array}  requests      mapped customer-my-requests rows ({ id, requestNumber, status })
   * @param {Object} arrivedById   { requestId: number of SHIP_TO_SITE lines }
   * @param {Object} billing       { overdueCount, overdueAmount } or null when billing is not shown
   * @param {Object} opts          { quotingAllowed }
   * @returns {Array} [{ kind, title, sub, requestId, requestNumber, cta }]
   */
  function todo(requests, arrivedById, billing, opts) {
    var out = [];
    var list = Array.isArray(requests) ? requests : [];
    var arrived = arrivedById || {};
    var quoting = !!(opts && opts.quotingAllowed);
    list.forEach(function (r) {
      if (up(r.status) === 'QUOTE_GENERATED') {
        out.push({ kind: 'quote', title: 'Accept the quote for ' + r.requestNumber,
          sub: quoting ? 'Accepting confirms the rental and creates your contract.' : 'Your equipment manager will confirm it with you.',
          requestId: r.id, requestNumber: r.requestNumber, cta: quoting ? 'View quote' : 'Open' });
      }
    });
    list.forEach(function (r) {
      var n = Number(arrived[r.id] || 0);
      if (n > 0) {
        out.push({ kind: 'delivery', title: 'Confirm the delivery of ' + r.requestNumber,
          sub: n + (n === 1 ? ' item has' : ' items have') + ' arrived at your site.',
          requestId: r.id, requestNumber: r.requestNumber, cta: 'Check delivery' });
      }
    });
    list.forEach(function (r) {
      if (up(r.status) === 'DRAFT') {
        out.push({ kind: 'draft', title: 'Finish and send ' + r.requestNumber,
          sub: 'Saved as a draft; nothing is reserved until you send it.',
          requestId: r.id, requestNumber: r.requestNumber, cta: 'Open draft' });
      }
    });
    if (billing && billing.overdueCount > 0) {
      out.push({ kind: 'invoice', title: billing.overdueCount + (billing.overdueCount === 1 ? ' invoice is' : ' invoices are') + ' overdue',
        sub: money(billing.overdueAmount) + ' past its due date.', requestId: null, requestNumber: '', cta: 'See billing' });
    }
    return out;
  }

  // ── Invoices (from BillingDetailInitChain, unchanged) ─────────────────────────────────────────────────────────────

  function parseDate(s) {
    if (!s) return null;
    var parts = String(s).substring(0, 10).split('-');
    if (parts.length !== 3) return null;
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m - 1, d);
  }

  function midnight(dt) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); }

  function fmt(dt) {
    if (!dt || isNaN(dt.getTime())) return '—';
    return MONTHS[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear();
  }

  function money2(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function periodLabel(startD, endD) {
    if (!startD || isNaN(startD.getTime())) {
      return (endD && !isNaN(endD.getTime())) ? fmt(endD) : '—';
    }
    var s = MONTHS[startD.getMonth()] + ' ' + startD.getDate();
    if (!endD || isNaN(endD.getTime())) return s;
    var e = MONTHS[endD.getMonth()] + ' ' + endD.getDate() + ', ' + endD.getFullYear();
    return s + ' → ' + e;
  }

  // Raw transaction status → display bucket (EQP_C_MYBILLING.status, V237: SCHEDULED/POSTED/PAID/OVERDUE/VOID, plus
  // DRAFT/CANCELLED as legacy synonyms). A POSTED invoice past its due date is OVERDUE, otherwise OPEN.
  function displayStatus(rawStatus, dueD, today) {
    if (rawStatus === 'PAID') return 'PAID';
    if (rawStatus === 'VOID' || rawStatus === 'CANCELLED') return 'CANCELLED';
    if (rawStatus === 'SCHEDULED' || rawStatus === 'DRAFT') return 'SCHEDULED';
    if (rawStatus === 'OVERDUE') return 'OVERDUE';
    if (dueD && midnight(dueD) < today) return 'OVERDUE';
    return 'OPEN';
  }

  function whenBucket(startD, endD, today) {
    if (endD && midnight(endD) < today) return 'past';
    if (startD && midnight(startD) > today) return 'future';
    return 'current';
  }

  /** One customer-my-billing row as the old billing detail shows it. */
  function mapInvoice(r, lineKey, i, today) {
    var rawStatus = String(r.status || r.transactionStatus || '').toUpperCase();
    var txnType = String(r.transactionType || 'INVOICE').toUpperCase();
    var isCredit = txnType === 'CREDIT';
    var isRepost = txnType === 'REPOST';
    var isAdjustment = isCredit || isRepost;
    var startD = parseDate(r.billingPeriodStart);
    var endD   = parseDate(r.billingPeriodEnd);
    var billD  = parseDate(r.transactionDate);
    var dueD   = parseDate(r.dueDate);
    var amount = (r.grossAmount != null ? r.grossAmount : (r.netAmount != null ? r.netAmount : 0));
    return {
      invId:         String(r.eqrBillingTransactionId != null ? r.eqrBillingTransactionId : (lineKey + '-' + i)),
      invoiceNumber: r.invoiceNumber || r.transactionNumber || '',
      periodLabel:   periodLabel(startD, endD),
      billDate:      billD ? fmt(billD) : '—',
      dueDate:       dueD ? fmt(dueD) : '—',
      amount:        amount,
      amountText:    money2(amount),
      status:        isAdjustment ? (isCredit ? 'CREDIT' : 'REPOST') : displayStatus(rawStatus, dueD, today),
      when:          whenBucket(startD, endD, today),
      txnType:       txnType,
      isAdjustment:  isAdjustment,
      periodType:    r.periodType || '',
      adjustmentOf:  (r.adjustmentOf != null ? String(r.adjustmentOf) : ''),
      _sort:         startD ? startD.getTime() : (billD ? billD.getTime() : 0),
      requestId:     r.eqrEquipmentRequestId != null ? String(r.eqrEquipmentRequestId) : '',
      lineId:        r.eqrRequestLineId != null ? String(r.eqrRequestLineId) : ''
    };
  }

  /**
   * The old billing detail's banner figures over a set of mapped invoices: cancelled ones do not count; credits and
   * reposts net into the total and are tracked as adjustments; everything not PAID is outstanding.
   * Also counts what is overdue, for the home page and the billing summary.
   */
  function invoiceTotals(invoices) {
    var totalInvoiced = 0, paidAmount = 0, outstanding = 0, lastInvTime = 0, netAdjustment = 0;
    var overdueCount = 0, overdueAmount = 0, openCount = 0;
    (Array.isArray(invoices) ? invoices : []).forEach(function (inv) {
      var amt = Number(inv.amount) || 0;
      if (inv.status === 'CANCELLED') return;
      if (inv.isAdjustment) netAdjustment += amt;
      totalInvoiced += amt;
      if (inv.status === 'PAID') paidAmount += amt;
      else outstanding += amt;
      if (inv.status === 'OVERDUE') { overdueCount++; overdueAmount += amt; }
      if (inv.status === 'OPEN' || inv.status === 'OVERDUE') openCount++;
      if (inv._sort > lastInvTime) lastInvTime = inv._sort;
    });
    var r2 = function (n) { return Math.round(n * 100) / 100; };
    return {
      totalInvoiced: r2(totalInvoiced),
      paidAmount: r2(paidAmount),
      outstandingAmount: r2(outstanding),
      lastInvoiceLabel: lastInvTime ? fmt(new Date(lastInvTime)) : '—',
      netAdjustment: r2(netAdjustment),
      hasAdjustments: netAdjustment !== 0,
      overdueCount: overdueCount,
      overdueAmount: r2(overdueAmount),
      openCount: openCount
    };
  }

  /** Every invoice of the customer-my-billing view, mapped, newest period first. */
  function mapInvoices(rows, today) {
    var t = today ? midnight(today) : midnight(new Date());
    return (Array.isArray(rows) ? rows : []).map(function (r, i) {
      return mapInvoice(r, String(r && r.eqrRequestLineId != null ? r.eqrRequestLineId : 'x'), i, t);
    }).sort(function (a, b) { return b._sort - a._sort; });
  }

  /** Plain words for an invoice status. */
  var INVOICE_WORDS = { PAID: 'Paid', OPEN: 'To pay', OVERDUE: 'Overdue', SCHEDULED: 'Not billed yet', CANCELLED: 'Cancelled', CREDIT: 'Credit', REPOST: 'Re-billed' };
  var INVOICE_TONE = { PAID: 'done', OPEN: 'wait', OVERDUE: 'stopped', SCHEDULED: 'neutral', CANCELLED: 'neutral', CREDIT: 'ok', REPOST: 'ok' };
  function invoiceText(s) { return INVOICE_WORDS[s] || statusText(s); }
  function invoiceClass(s) { return 'er-cu-pill er-cu-pill--' + (INVOICE_TONE[s] || 'neutral'); }

  /**
   * True when the signed-in user is staff using the portal for customers (FDD 7.18.5, "acting on behalf"): they can
   * open a page that is not a customer page. Customer pages are the EQR_CUST_* codes; EQR_DASHBOARD does not count,
   * as every role holds it. Not app-flow.js hasInternalPageAccess: that one counts EQR_CUST_CREATE_REQ and
   * EQR_CUST_MY_REQUESTS as internal, because they sit on the Request menu items, so a customer would read as staff.
   * False while page access is loading.
   * @param {Object}  map    - $application.variables.pageAccessMap
   * @param {boolean} loaded - $application.variables.pageAccessLoaded
   */
  function actsForCustomers(map, loaded) {
    if (!loaded || !map) return false;
    return Object.keys(map).some(function (code) {
      var lvl = map[code];
      return (lvl === 'FULL' || lvl === 'READ_ONLY') && code.indexOf('EQR_CUST_') !== 0 && code !== 'EQR_DASHBOARD';
    });
  }

  /**
   * The same screen in Old EquipRite's customer portal (vp/shell/customer-portal/<page>, with the request when given),
   * or '' while the old app's address is unknown. Same form as app-flow.js oldAppLink and request-detail's links.
   */
  function oldLink(oldAppUrl, oldPage, requestNumber, numericId) {
    if (!oldAppUrl || !oldPage) return '';
    var base = oldAppUrl.charAt(oldAppUrl.length - 1) === '/' ? oldAppUrl : oldAppUrl + '/';
    var url = base + 'vp/shell/customer-portal/' + oldPage;
    if (numericId) {
      url += '?requestId=' + encodeURIComponent(requestNumber || '') + '&requestNumericId=' + encodeURIComponent(numericId);
    }
    return url;
  }

  return {
    actsForCustomers: actsForCustomers,
    oldLink: oldLink,
    STEPS: STEPS,
    statusText: statusText,
    statusClass: statusClass,
    day: day,
    dateRange: dateRange,
    money: money,
    trackSteps: trackSteps,
    headerIsConfirmed: headerIsConfirmed,
    nextAction: nextAction,
    groupOf: groupOf,
    groupChips: groupChips,
    filterRequests: filterRequests,
    hasQuote: hasQuote,
    todo: todo,
    parseDate: parseDate,
    displayStatus: displayStatus,
    mapInvoice: mapInvoice,
    mapInvoices: mapInvoices,
    invoiceTotals: invoiceTotals,
    money2: money2,
    invoiceText: invoiceText,
    invoiceClass: invoiceClass
  };
});
