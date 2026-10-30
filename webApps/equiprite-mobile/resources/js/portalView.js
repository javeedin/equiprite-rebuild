define(['resources/js/requestProgress', 'resources/js/customerPortal', 'resources/js/fmt'], function (Progress, portal, fmt) {
  'use strict';

  // The customer portal of EquipRite Next, as a customer reads it: their requests read from the equipment
  // (requestProgress, external), what is on its way and on their site, what needs them, their invoices.
  //
  // The rules are New EquipRite's (resources/js/customerPortal.js, copied unchanged): which request needs the customer
  // (todo, nextAction), what is open or finished (groupOf), when a quote exists (hasQuote), the invoice maths
  // (mapInvoices, invoiceTotals). The rows are mapped exactly as New's customer chains map them (mapRequest, mapLine,
  // quoteLine). The words are Next's: a customer sees "On the way to your site", never a stored status or a staff step.
  // Pure: no calls; the chains read and hand the rows here. Customers never see serial numbers: no row carries one.

  var DAY = 86400000;

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function d10(v) { return v ? String(v).substring(0, 10) : ''; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function low(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : ''; }

  // ── Rows, mapped as New's customer chains map them ───────────────────────────────────────────────────────────────

  /** One views/customer-my-requests row (homeInitChain, loadRequestsChain and billingInitChain map it the same way). */
  function mapRequest(r) {
    var x = r || {};
    return {
      id:              x.eqrEquipmentRequestId || x.rowId,
      requestNumber:   x.requestNumber         || '',
      customerName:    x.customerName          || '',
      customerContact: x.customerContact       || '',
      agreementType:   x.agreementType         || '',
      status:          x.requestStatus         || '',
      startDate:       x.startDate    ? x.startDate.substring(0, 10)   : '',
      endDate:         x.endDate      ? x.endDate.substring(0, 10)     : '',
      lines:           x.lines        || 0,
      createdDate:     x.createdDate  ? x.createdDate.substring(0, 10) : '',
      contractNumber:  x.contractNumber || '',
      createdRaw:      x.createdDate  || null,
      hasQuoteDoc:     !!x.quoteDocument
    };
  }

  /**
   * The customer's requests: one per request (the view repeats a request on each of its line rows, so the first row
   * of a request is kept, and the quote document is noted from any of them), newest first, as New's list sorts.
   */
  function requestsOf(rows) {
    var seen = {};
    var out = [];
    (Array.isArray(rows) ? rows : []).forEach(function (raw) {
      var r = mapRequest(raw);
      if (r.id == null || r.id === '') return;
      var k = String(r.id);
      if (seen[k]) { if (r.hasQuoteDoc) seen[k].hasQuoteDoc = true; return; }
      seen[k] = r;
      out.push(r);
    });
    return out.sort(function (a, b) { return Number(b.id || 0) - Number(a.id || 0); });
  }

  /** One views/request-detail-lines row, as New's customer request page maps it (initChain), plus where it goes. */
  function mapLine(r, index) {
    var x = r || {};
    return {
      lineId:            String(x.lineId !== undefined && x.lineId !== null ? x.lineId : (x.id !== undefined ? x.id : index + 1)),
      equipmentName:     x.equipmentName  || '',
      equipmentClass:    x.className      || x.equipmentClass || '',
      quantity:          x.quantity       !== undefined && x.quantity !== null ? x.quantity : '',
      utilizationPct:    x.targetUtilPercent !== undefined && x.targetUtilPercent !== null ? x.targetUtilPercent : '',
      lineStatus:        x.lineStatus     || '',
      consumableFlag:    x.consumableFlag || 'N',
      autoConsumeFlag:   x.autoConsumeFlag || 'N',
      deliveredQuantity: x.deliveredQuantity != null ? Number(x.deliveredQuantity) : null,
      consumedQuantity:  x.consumedQuantity  != null ? Number(x.consumedQuantity)  : null,
      startDate:         x.startDate      ? x.startDate.substring(0, 10)  : '',
      endDate:           x.endDate        ? x.endDate.substring(0, 10)    : '',
      billRate:          x.billRate       !== undefined && x.billRate !== null ? x.billRate : '',
      priceUom:          x.priceUom || '',
      estimatedCost:     x.estimatedCost != null ? x.estimatedCost : null,
      billFrequency:     x.billFrequency || '',
      location:          x.deploymentLocation || '',
      // Kept in step with the return: DEPLOYED only (New's initChain stamp and initiateReturnChain's filter).
      isReturnable:      (x.lineStatus || '') === 'DEPLOYED'
    };
  }

  function linesOf(rows) { return (Array.isArray(rows) ? rows : []).map(mapLine); }

  /** The request header of the customer request pages (views/customer-request-details, first row for the number). */
  function headerOf(first, requestNumber) {
    var f = first || null;
    return {
      requestNumber:   (f && f.requestNumber)   || requestNumber || '',
      customerName:    (f && f.customerName)    || '',
      customerContact: (f && f.customerContact) || '',
      status:          (f && f.requestStatus)   || '',
      startDate:       (f && f.startDate) ? f.startDate.substring(0, 10) : '',
      endDate:         (f && f.endDate)   ? f.endDate.substring(0, 10)   : '',
      location:        (f && (f.deploymentLocation || f.location)) || '',
      contractNumber:  (f && f.contractNumber)  || '',
      createdDate:     (f && f.createdDate) ? String(f.createdDate).substring(0, 10) : ''
    };
  }

  /**
   * The row of views/customer-request-details for a request, by its number (New's rule) or, with only an id, by id.
   * Only a request found here is the customer's own: nothing else of it is read (Next's guard).
   */
  function findOwn(rows, number, id) {
    var list = Array.isArray(rows) ? rows : [];
    var byNumber = number ? list.filter(function (r) { return r && r.requestNumber === number; })[0] : null;
    if (byNumber) return byNumber;
    if (id) return list.filter(function (r) { return r && r.eqrEquipmentRequestId != null && String(r.eqrEquipmentRequestId) === String(id); })[0] || null;
    return null;
  }

  // ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────

  // What a piece of equipment's status means to the customer. The stage (and its colour) is requestProgress's; the
  // words are the customer's. A status not listed reads as requestProgress words it.
  var WORDS = {
    DRAFT:                   'Not sent yet',
    SUBMITTED:               'Sent, waiting for review',
    IN_PROCESS:              'With your equipment manager',
    QUOTE_GENERATED:         'Quote ready for you to accept',
    QUOTE_ACCEPTED:          'Quote accepted, being arranged',
    APPROVED:                'Confirmed, being arranged',
    ALLOCATED:               'Confirmed, being arranged',
    UNDER_PROCUREMENT:       'Being sourced for you',
    SCHEDULED_FOR_PICKING:   'Being prepared at the yard',
    PICK_INITIATED:          'Being prepared at the yard',
    PICK_RELEASED:           'Being prepared at the yard',
    EQP_INSPECTION_COMPLETE: 'Checked, ready to ship',
    INSPECTION_FAILED:       'Being replaced after a failed check',
    SHIP_TO_SITE:            'On the way to your site',
    SHIPPED:                 'On the way to your site',
    DELIVERED:               'On your site',
    DEPLOYED:                'On your site',
    RETURN_INITIATED:        'Return asked for, waiting for pickup',
    RETURN_IN_PROCESS:       'Being collected',
    SHIPPED_TO_YARD:         'On the way back to us',
    RETURNED:                'Back with us',
    CLOSED:                  'Back with us',
    CONSUMED:                'Used up on site',
    REJECTED:                'Turned down',
    CANCELLED:               'Cancelled',
    DECLINED:                'Declined'
  };

  function lineWords(status) {
    var c = up(status);
    return WORDS[c] || Progress.line(c, true).label || '';
  }

  function lineStage(status) {
    return Progress.line(up(status), true).stage || 'ready';
  }

  // The step holding a request up (requestProgress's next: who, what), told to the customer.
  var NEXT = {
    'Customer|accept the quote':                               'Accept the quote',
    'Site|accept the delivery':                                'Accept the delivery when it arrives',
    'Requester|submit it':                                     'Send it when you are ready',
    'Requester|fix it and send it again':                      'Contact your equipment manager',
    'Requester|return it when the job is done':                'Start the return when you are done',
    'Equipment Manager|review it and assign a unit':           'We review it and choose your equipment',
    'Equipment Manager|approve it':                            'We review it',
    'Equipment Manager|assign a unit':                         'We choose your equipment',
    'Equipment Manager|confirm it for picking':                'We get it ready at the yard',
    'Equipment Manager|swap the unit, have it repaired or cancel the line': 'We replace a piece that failed its check',
    'Procurement|buy it':                                      'We source it for you',
    'Yard|start picking':                                      'Our yard prepares and ships it',
    'Yard|pick and ship it':                                   'Our yard prepares and ships it',
    'Yard|ship it':                                            'Our yard ships it',
    'Yard|collect it':                                         'We collect it from your site',
    'Yard|receive it':                                         'We receive it back',
    'Yard|receive and inspect it':                             'We receive it back'
  };

  /** "Accept the delivery when it arrives (2 of 3)", "In use until 12 Nov", "Start the return: it was due back 12 Nov". */
  function nextText(p) {
    var n = p && p.next;
    if (!n) return '';
    var t = String(n.text || '');
    if (/^In use/.test(t)) return t;
    var ended = /\(ended ([^)]+)\)$/.exec(t);
    if (ended) return 'Return it: it was due back ' + ended[1];
    var words = NEXT[n.who + '|' + n.what] || cap(n.what || '');
    var m = /\((\d+) of (\d+)\)$/.exec(t);
    return words + (m && m[1] !== m[2] ? ' (' + m[1] + ' of ' + m[2] + ')' : '');
  }

  /**
   * The Next column of a request: what the customer has to do when New's nextAction gives them a step (accept the
   * quote, accept the delivery, send the draft), else what holds the request up (requestProgress), in their words.
   */
  function nextFor(r, lines, p, quotingAllowed) {
    var n = portal.nextAction({ status: r.status, endDate: r.endDate }, lines, { quotingAllowed: !!quotingAllowed });
    if (n.action === 'quote') return { text: 'Accept the quote', mine: true };
    if (n.action === 'draft') return { text: 'Check it and send it', mine: true };
    if (n.action === 'delivery') {
      var c = lines.filter(function (l) { return l.lineStatus === 'SHIP_TO_SITE'; }).length;
      return { text: 'Accept the delivery when it arrives (' + plural(c, 'piece') + ')', mine: true };
    }
    return { text: nextText(p), mine: nextIsMine(p) };
  }

  /** Is the next step the customer's own? */
  function nextIsMine(p) {
    var who = p && p.next && p.next.who;
    return who === 'Customer' || who === 'Site' || who === 'Requester';
  }

  /** "2 on the way to your site · 1 being prepared at the yard", for a request whose pieces are all at one stage. */
  function detailWords(lines) {
    var counts = {};
    var order = [];
    (Array.isArray(lines) ? lines : []).forEach(function (l) {
      var w = lineWords(l && l.lineStatus);
      if (!w) return;
      if (!counts[w]) { counts[w] = 0; order.push(w); }
      counts[w] += 1;
    });
    if (order.length < 2) return '';
    return order.map(function (w) { return counts[w] + ' ' + low(w); }).join(' · ');
  }

  // ── A request, read from its equipment ───────────────────────────────────────────────────────────────────────────

  /** requestProgress for a customer request: its own status, then its lines (when read). */
  function progressOf(status, lines, start, end, now) {
    return Progress.summarize(up(status), Array.isArray(lines) ? lines : [], { start: start, end: end, external: true, now: now });
  }

  /** The headline a customer reads: requestProgress's, with a quote waiting for them and a request turned down said so. */
  function headline(p, status) {
    if (!p) return '';
    if (p.stage === 'stopped') return p.headline === 'Sent back' ? 'Turned down' : p.headline;
    if (p.stage === 'approval' && up(status) === 'QUOTE_GENERATED') return 'Quote ready for you';
    return p.headline;
  }

  /** The line under the headline: what the pieces are doing, in the customer's words. */
  function detailFor(p, lines) {
    if (!lines.length) return p.detail || '';
    if (p.stage === 'mixed') return p.detail;
    if (p.stage === 'stopped' || p.stage === 'draft') return '';
    var several = detailWords(lines);
    if (several) return several;
    return p.stage === 'approval' || p.stage === 'ready' ? lineWords(lines[0].lineStatus) : '';
  }

  /** "Starts in 5 days", "Ends today", "Ended 3 days ago". */
  function when(start, end, now) {
    var t = fmt.today(now);
    var s = fmt.dayMs(start);
    var e = fmt.dayMs(end);
    if (s != null && t < s) return 'Starts ' + fmt.relative(start, now);
    if (e != null && t <= e) return 'Ends ' + fmt.relative(end, now);
    if (e != null) return 'Ended ' + fmt.relative(end, now);
    return '';
  }

  /**
   * The requests with what a person sees: { ...request, p, headline, detail, next, mine, segs, pieces, group,
   * hasQuote, dates, when, late, linesRead }.
   * linesById: { requestId: [mapped lines] } for the requests whose equipment was read.
   */
  function decorate(requests, linesById, opts) {
    var o = opts || {};
    var by = linesById || {};
    return (Array.isArray(requests) ? requests : []).map(function (r) {
      var read = Object.prototype.hasOwnProperty.call(by, String(r.id));
      var lines = read ? by[String(r.id)] : [];
      var p = progressOf(r.status, lines, r.startDate, r.endDate, o.now);
      var nx = nextFor(r, lines, p, o.quotingAllowed);
      return Object.assign({}, r, {
        p: p,
        headline: headline(p, r.status),
        detail: detailFor(p, lines),
        next: nx.text,
        mine: nx.mine,
        segs: lines.map(function (l) {
          return { stage: lineStage(l.lineStatus), title: (l.equipmentName || 'Equipment') + ': ' + lineWords(l.lineStatus) };
        }),
        pieces: lines.reduce(function (s, l) { return s + (Number(l.quantity) || 1); }, 0),
        names: lines.map(function (l) { return l.equipmentName; }).filter(Boolean),
        group: portal.groupOf(r.status),
        hasQuote: portal.hasQuote(r.status, o.quotingAllowed),
        dates: fmt.range(r.startDate, r.endDate),
        when: when(r.startDate, r.endDate, o.now),
        late: p.late.map(function (l) { return l.text; }).join(' · '),
        linesRead: read
      });
    });
  }

  /** The requests whose equipment the portal reads: not finished (New's groupOf), newest first, at most `max`. */
  function toRead(requests, max) {
    return (Array.isArray(requests) ? requests : []).filter(function (r) { return portal.groupOf(r.status) !== 'done'; })
      .slice(0, max == null ? 50 : max);
  }

  // The header statuses New's home reads the lines of for "arrived" (homeInitChain ACTIVE_HEADER).
  var ACTIVE_HEADER = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'DEPLOYED'];

  /** { requestId: lines shipped to the site (SHIP_TO_SITE) }, for requests in operations (New's home rule). */
  function arrivedById(requests, linesById) {
    var out = {};
    (Array.isArray(requests) ? requests : []).forEach(function (r) {
      var lines = (linesById || {})[String(r.id)];
      if (ACTIVE_HEADER.indexOf(up(r.status)) === -1 || !Array.isArray(lines)) return;
      out[r.id] = lines.filter(function (l) { return l.lineStatus === 'SHIP_TO_SITE'; }).length;
    });
    return out;
  }

  /**
   * What needs the customer, most urgent first: New's todo (quotes to accept, deliveries to accept, drafts to send,
   * overdue invoices), each with Next's words and the tab it opens.
   * billing: invoice totals, or null while billing is not shown. opts { quotingAllowed, overdueRequest }.
   */
  function needs(requests, linesById, billing, opts) {
    var o = opts || {};
    var arrived = arrivedById(requests, linesById);
    return portal.todo(requests, arrived, billing, { quotingAllowed: o.quotingAllowed }).map(function (t) {
      var params = { id: t.requestId, number: t.requestNumber };
      if (t.kind === 'quote') {
        return { kind: 'quote', icon: 'oj-ux-ico-document-check', title: t.title,
          text: o.quotingAllowed ? 'Check the prices and the rental terms, then accept it to confirm your rental.' : t.sub,
          cta: o.quotingAllowed ? 'See the quote' : 'Open', open: { record: o.quotingAllowed ? 'quote' : 'customer-request', params: params } };
      }
      if (t.kind === 'delivery') {
        var n = Number(arrived[t.requestId] || 0);
        return { kind: 'delivery', icon: 'oj-ux-ico-truck', title: 'Accept the delivery of ' + t.requestNumber,
          text: plural(n, 'piece was', 'pieces were') + ' shipped to your site. When ' + (n === 1 ? 'it arrives, check it and accept it, or refuse it if it is wrong.'
            : 'they arrive, check them and accept them, or refuse what is wrong.'),
          cta: 'Check the delivery', open: { record: 'customer-request', params: params } };
      }
      if (t.kind === 'draft') {
        return { kind: 'draft', icon: 'oj-ux-ico-edit', title: t.title, text: t.sub, cta: 'Open the draft', open: { record: 'customer-request', params: params } };
      }
      return { kind: 'invoice', icon: 'oj-ux-ico-invoice', title: t.title, text: t.sub, cta: 'See the invoices',
        open: o.overdueRequest ? { record: 'invoice', params: o.overdueRequest } : { view: 'invoices', chip: 'overdue' } };
    });
  }

  /** The request whose invoices are overdue when they are all on one ({ id, number }), else null. */
  function overdueRequest(invoices, requests) {
    var ids = [];
    (Array.isArray(invoices) ? invoices : []).forEach(function (i) { if (i.status === 'OVERDUE' && ids.indexOf(i.requestId) === -1) ids.push(i.requestId); });
    if (ids.length !== 1) return null;
    var r = (Array.isArray(requests) ? requests : []).filter(function (x) { return String(x.id) === String(ids[0]); })[0];
    return { id: ids[0], number: r ? r.requestNumber : '' };
  }

  // ── The requests list ────────────────────────────────────────────────────────────────────────────────────────────

  /** New's chips (Needs you, Open, Finished, All), with counts. */
  function requestChips(rows) { return portal.groupChips(rows); }

  /** Rows for a chip and the search: number, customer, contact, contract, where it is, the equipment. */
  function filterRequests(rows, group, text) {
    var q = String(text || '').trim().toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (group === 'needs' && r.group !== 'needs') return false;
      if (group === 'open' && r.group === 'done') return false;
      if (group === 'done' && r.group !== 'done') return false;
      if (!q) return true;
      return [r.requestNumber, r.customerName, r.customerContact, r.contractNumber, r.headline, r.next].concat(r.names || [])
        .some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  /** Sort: number (newest first by default) or dates. */
  function sortRequests(rows, key, dir) {
    var m = dir === 'asc' ? 1 : -1;
    return (Array.isArray(rows) ? rows : []).slice().sort(function (a, b) {
      var x;
      var y;
      if (key === 'dates') { x = a.startDate || ''; y = b.startDate || ''; }
      else { x = Number(a.id) || 0; y = Number(b.id) || 0; }
      return x < y ? -m : (x > y ? m : 0);
    });
  }

  // ── The equipment, one row per piece ─────────────────────────────────────────────────────────────────────────────

  /** A piece that is late, in words: not on site by its start, or still out after its end. '' when it is not. */
  function lateOf(stage, start, end, now) {
    var t = fmt.today(now);
    var s = fmt.dayMs(start);
    var e = fmt.dayMs(end);
    if ((stage === 'approval' || stage === 'ready') && s != null && t > s) {
      return 'Due on site ' + fmt.date(start, false) + ' · ' + plural(Math.round((t - s) / DAY), 'day') + ' late';
    }
    if ((stage === 'out' || stage === 'onsite') && e != null && t > e) {
      return 'Due back ' + fmt.date(end, false) + ' · ' + plural(Math.round((t - e) / DAY), 'day') + ' over';
    }
    return '';
  }

  /** What the customer does next with one piece, by its status, while the request is in operations (New's rule). */
  function pieceNext(status, headerStatus) {
    if (!portal.headerIsConfirmed(headerStatus)) return '';
    if (status === 'SHIP_TO_SITE') return 'Accept it when it arrives';
    if (status === 'DEPLOYED') return 'Start the return when you are done';
    return '';
  }

  /** Every piece of equipment on the requests whose equipment was read. */
  function equipmentRows(requests, linesById, now) {
    var out = [];
    (Array.isArray(requests) ? requests : []).forEach(function (r) {
      if (up(r.status) === 'DRAFT') return;
      ((linesById || {})[String(r.id)] || []).forEach(function (l) {
        var stage = lineStage(l.lineStatus);
        var start = l.startDate || r.startDate;
        var end = l.endDate || r.endDate;
        out.push({
          key: r.id + ':' + l.lineId,
          requestId: r.id,
          requestNumber: r.requestNumber,
          name: l.equipmentName || 'Equipment',
          cls: l.equipmentClass,
          qty: Number(l.quantity) || 1,
          status: l.lineStatus,
          stage: stage,
          words: lineWords(l.lineStatus),
          start: start,
          end: end,
          dates: fmt.range(start, end),
          location: l.location,
          late: lateOf(stage, start, end, now),
          next: pieceNext(l.lineStatus, r.status)
        });
      });
    });
    return out;
  }

  var EQUIPMENT_CHIPS = [
    { key: 'all', label: 'All' },
    { key: 'late', label: 'Late' },
    { key: 'coming', label: 'Being arranged', stages: ['approval', 'ready'] },
    { key: 'out', label: 'On the way to you', stages: ['out'] },
    { key: 'onsite', label: 'On your site', stages: ['onsite'] },
    { key: 'back', label: 'Going back', stages: ['back'] },
    { key: 'done', label: 'Done', stages: ['done', 'stopped', 'draft'] }
  ];

  function chipOf(key) { return EQUIPMENT_CHIPS.filter(function (c) { return c.key === key; })[0] || EQUIPMENT_CHIPS[0]; }

  function equipmentIn(row, key) {
    if (key === 'all') return true;
    if (key === 'late') return !!row.late;
    var c = chipOf(key);
    return !!c.stages && c.stages.indexOf(row.stage) !== -1;
  }

  function equipmentChips(rows) {
    var list = Array.isArray(rows) ? rows : [];
    return EQUIPMENT_CHIPS.map(function (c) {
      return { key: c.key, label: c.label, count: list.filter(function (r) { return equipmentIn(r, c.key); }).length };
    });
  }

  function filterEquipment(rows, key, text) {
    var q = String(text || '').trim().toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (!equipmentIn(r, key || 'all')) return false;
      if (!q) return true;
      return [r.name, r.cls, r.requestNumber, r.words, r.location].some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  // ── The home's figures ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The tiles: on the way, on site, being arranged, and (billing shown) what there is to pay.
   * Each: { key, label, value, note, tone, view, chip }.
   */
  function tiles(requests, eqRows, totals, billingShown, now) {
    var rows = Array.isArray(eqRows) ? eqRows : [];
    var sum = function (key) { return rows.filter(function (r) { return equipmentIn(r, key); }).reduce(function (s, r) { return s + r.qty; }, 0); };
    var t = fmt.today(now);
    var qty = function (list) { return list.reduce(function (s, r) { return s + r.qty; }, 0); };
    var dueSoon = qty(rows.filter(function (r) {
      var e = fmt.dayMs(r.end);
      return r.stage === 'onsite' && e != null && e >= t && e - t <= 7 * DAY;
    }));
    var over = qty(rows.filter(function (r) { return r.stage === 'onsite' && !!r.late; }));
    var toAccept = qty(rows.filter(function (r) { return r.status === 'SHIP_TO_SITE' && !!r.next; }));
    var open = (Array.isArray(requests) ? requests : []).filter(function (r) { return r.group !== 'done'; }).length;
    var out = [
      { key: 'out', label: 'On the way to you', value: String(sum('out')), tone: 'out', view: 'equipment', chip: 'out',
        note: toAccept ? plural(toAccept, 'piece') + ' to accept when ' + (toAccept === 1 ? 'it arrives' : 'they arrive') : 'Nothing to accept right now' },
      { key: 'onsite', label: 'On your site', value: String(sum('onsite')), tone: 'onsite', view: 'equipment', chip: 'onsite',
        note: over ? plural(over, 'piece') + ' past the end date' : (dueSoon ? plural(dueSoon, 'piece') + ' due back this week' : 'Working for you now') },
      { key: 'coming', label: 'Being arranged', value: String(sum('coming')), tone: 'ready', view: 'equipment', chip: 'coming',
        note: plural(open, 'open request') }
    ];
    if (billingShown && totals) {
      out.push({ key: 'pay', label: 'To pay', value: fmt.money(totals.outstandingAmount || 0) || '$0', tone: totals.overdueCount ? 'stopped' : 'approval',
        view: 'invoices', chip: totals.overdueCount ? 'overdue' : 'topay',
        note: (totals.openCount || 0) + ' open · ' + (totals.overdueCount || 0) + ' overdue' });
    }
    return out;
  }

  /** "Lone Star Paving LLC · 3 open requests · 2 things need you". */
  function summary(customerName, requests, needCount, loading) {
    if (loading) return 'Loading your requests…';
    var open = (Array.isArray(requests) ? requests : []).filter(function (r) { return r.group !== 'done'; }).length;
    return [customerName, plural(open, 'open request'),
      needCount ? plural(needCount, 'thing needs', 'things need') + ' you' : 'nothing needs you right now'].filter(Boolean).join(' · ');
  }

  /** The one customer of every request (a customer sign-in), else ''. */
  function customerOf(requests) {
    var names = [];
    (Array.isArray(requests) ? requests : []).forEach(function (r) { if (r.customerName && names.indexOf(r.customerName) === -1) names.push(r.customerName); });
    return names.length === 1 ? names[0] : '';
  }

  // ── Invoices ─────────────────────────────────────────────────────────────────────────────────────────────────────

  var INVOICE_CHIPS = [
    { key: 'all', label: 'All' },
    { key: 'topay', label: 'To pay', statuses: ['OPEN', 'OVERDUE'] },
    { key: 'overdue', label: 'Overdue', statuses: ['OVERDUE'] },
    { key: 'paid', label: 'Paid', statuses: ['PAID'] },
    { key: 'other', label: 'Not billed yet, credits', statuses: ['SCHEDULED', 'CREDIT', 'REPOST', 'CANCELLED'] }
  ];
  var INVOICE_TONE = { PAID: 'done', OPEN: 'approval', OVERDUE: 'stopped', SCHEDULED: 'draft', CANCELLED: 'draft', CREDIT: 'back', REPOST: 'back' };

  /** Mapped invoices (customerPortal.mapInvoices) with their request number, equipment and words. */
  function invoiceRows(invoices, requests, linesById) {
    var reqs = {};
    (Array.isArray(requests) ? requests : []).forEach(function (r) { reqs[String(r.id)] = r; });
    return (Array.isArray(invoices) ? invoices : []).map(function (i) {
      var r = reqs[String(i.requestId)];
      var line = ((linesById || {})[String(i.requestId)] || []).filter(function (l) { return l.lineId === i.lineId; })[0];
      return Object.assign({}, i, {
        requestNumber: r ? r.requestNumber : '',
        contractNumber: r ? r.contractNumber : '',
        equipment: line ? line.equipmentName : '',
        words: portal.invoiceText(i.status),
        tone: INVOICE_TONE[i.status] || 'draft',
        note: i.isAdjustment ? (i.txnType === 'CREDIT' ? 'Credit for an earlier invoice' : 'Re-billed' + (i.periodType ? ' as ' + String(i.periodType).toLowerCase() : '')) : ''
      });
    });
  }

  function invoiceChips(rows) {
    var list = Array.isArray(rows) ? rows : [];
    return INVOICE_CHIPS.map(function (c) {
      return { key: c.key, label: c.label, count: c.statuses ? list.filter(function (r) { return c.statuses.indexOf(r.status) !== -1; }).length : list.length };
    });
  }

  function filterInvoices(rows, key, text) {
    var c = INVOICE_CHIPS.filter(function (x) { return x.key === key; })[0];
    var q = String(text || '').trim().toLowerCase();
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      if (c && c.statuses && c.statuses.indexOf(r.status) === -1) return false;
      if (!q) return true;
      return [r.invoiceNumber, r.requestNumber, r.contractNumber, r.equipment, r.words].some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  /**
   * One request's invoices by piece of equipment, as New's invoice page groups them (invoiceInitChain): the billing
   * rows of this request with a line, mapped with the old billing detail's rules, oldest period first, under each line.
   */
  function invoiceGroups(lineRows, billingRows, requestId, today) {
    var t = today || new Date();
    var midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    var byLine = {};
    (Array.isArray(billingRows) ? billingRows : [])
      .filter(function (r) { return String(r.eqrEquipmentRequestId) === String(requestId) && r.eqrRequestLineId != null; })
      .forEach(function (r, i) {
        var key = String(r.eqrRequestLineId);
        (byLine[key] = byLine[key] || []).push(portal.mapInvoice(r, key, i, midnight));
      });
    Object.keys(byLine).forEach(function (k) { byLine[k].sort(function (a, b) { return a._sort - b._sort; }); });
    return (Array.isArray(lineRows) ? lineRows : []).map(function (r, index) {
      var lineId = String(r.lineId != null ? r.lineId : (r.id != null ? r.id : index + 1));
      var invoices = invoiceRows(byLine[lineId] || [], [], {}).map(function (inv) {
        return Object.assign({}, inv, { equipment: r.equipmentName || '' });
      });
      return {
        lineId: lineId,
        equipmentName: r.equipmentName || '',
        equipmentClass: r.className || r.equipmentClass || '',
        quantity: r.quantity != null ? r.quantity : '',
        billRate: r.billRate != null ? r.billRate : '',
        billFrequency: r.billFrequency || '',
        lineStatus: r.lineStatus || '',
        invoices: invoices,
        invoiceCount: invoices.length,
        totalValue: invoices.reduce(function (s, inv) { return s + (Number(inv.amount) || 0); }, 0)
      };
    });
  }

  // ── A request's tab ──────────────────────────────────────────────────────────────────────────────────────────────

  var NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };

  /** The rate as quoted ("$1,400 / DAY"), or '—' while a quote is still to come (New's rateText). */
  function rateText(line) {
    if (!line || line.billRate === '' || line.billRate == null) return '—';
    var u = String(line.priceUom || '').trim().toUpperCase();
    return portal.money(line.billRate) + (u ? ' / ' + (NOUNS[u] || u) : '');
  }

  /**
   * The next thing the customer does on a request: New's nextAction (which, and when), in Next's words for a
   * delivery: SHIP_TO_SITE is "shipped to your site", accepted when it arrives.
   */
  function nextStep(head, lines, quotingAllowed) {
    var n = portal.nextAction(head || {}, lines, { quotingAllowed: !!quotingAllowed });
    if (n.key === 'delivery') {
      var c = (Array.isArray(lines) ? lines : []).filter(function (l) { return l.lineStatus === 'SHIP_TO_SITE'; }).length;
      return Object.assign({}, n, { title: 'Your equipment is on its way',
        text: plural(c, 'piece was', 'pieces were') + ' shipped to your site. When they arrive, check them, then accept the delivery, or refuse a piece that is wrong.' });
    }
    if (n.key === 'quote' && n.action === 'quote') {
      return Object.assign({}, n, { text: 'Check the prices and the rental terms, then accept the quote to confirm your rental. Accepting creates your rental contract.' });
    }
    return n;
  }

  /** The ticked lines (ticks: { lineId: true }), in line order. */
  function ticked(lines, ticks) {
    var t = ticks || {};
    return (Array.isArray(lines) ? lines : []).filter(function (l) { return !!t[l.lineId]; });
  }

  /** New's selection state over the ticked lines (getSelectionStateRaw), for the action buttons. */
  function selection(lines, ticks) {
    var sel = ticked(lines, ticks);
    var count = sel.length;
    var all = Array.isArray(lines) ? lines : [];
    if (!count) return { count: 0, sharedStatus: '', isMixed: false, allSelected: false, allDeployed: false, allReturnable: false, allShipToSite: false };
    var first = sel[0].lineStatus || '';
    var same = sel.every(function (l) { return (l.lineStatus || '') === first; });
    return {
      count: count,
      sharedStatus: same ? first : '',
      isMixed: !same,
      allSelected: all.length > 0 && count === all.length,
      allDeployed: sel.every(function (l) { return l.lineStatus === 'DEPLOYED'; }),
      allReturnable: sel.every(function (l) { return l.isReturnable != null ? l.isReturnable === true : l.lineStatus === 'DEPLOYED'; }),
      allShipToSite: sel.every(function (l) { return l.lineStatus === 'SHIP_TO_SITE'; })
    };
  }

  // A consumable whose subclass issues it from stock on delivery (New's acceptDeliveryChain autoConsume): accepting it
  // posts a material issue (inventory consumption), which Fusion Inventory receives. Next does not write to Fusion.
  function issuesFromStock(l) { return !!l && l.consumableFlag === 'Y' && l.autoConsumeFlag === 'Y'; }

  var SOURCE = { accept: 'SHIP_TO_SITE', refuse: 'SHIP_TO_SITE', return: 'DEPLOYED' };

  /**
   * What an action will do, before it does it, on the same lines the chain acts on (New's pool: the ticked lines, or
   * every line when none is ticked; then those in the action's source status).
   * Returns { kind, pool, eligible, skipped, fusion, ok, title, text, button }.
   */
  function plan(kind, lines, ticks) {
    var all = Array.isArray(lines) ? lines : [];
    var sel = ticked(all, ticks);
    var pool = sel.length ? sel : all;
    var eligible = pool.filter(function (l) { return l.lineStatus === SOURCE[kind]; });
    var fusion = kind === 'accept' ? eligible.filter(issuesFromStock) : [];
    var names = eligible.map(function (l) { return l.equipmentName || 'Equipment'; });
    var list = names.length > 3 ? names.slice(0, 3).join(', ') + ' and ' + (names.length - 3) + ' more' : names.join(', ');
    var n = eligible.length;
    var res = { kind: kind, pool: pool, eligible: eligible, skipped: pool.length - n, fusion: fusion, ok: n > 0 && !fusion.length };
    if (!n) {
      res.title = kind === 'return' ? 'Nothing to return' : 'Nothing to accept or refuse';
      res.text = kind === 'return' ? 'None of these pieces is on your site. A piece can be returned once it is on site.'
        : 'None of these pieces is on its way to you.';
      return res;
    }
    if (fusion.length) {
      res.title = 'Accept ' + (fusion.length === 1 ? 'this piece' : 'these pieces') + ' in New EquipRite';
      res.text = plural(fusion.length, 'piece is a consumable', 'pieces are consumables') + ' issued from stock as soon as '
        + (fusion.length === 1 ? 'it is' : 'they are') + ' accepted (' + fusion.map(function (l) { return l.equipmentName; }).join(', ')
        + '). That issue is recorded in Oracle Fusion, which EquipRite Next does not write to yet, so nothing is accepted here. '
        + 'Accept them in New EquipRite, or tick the other pieces to accept those here.';
      return res;
    }
    var skip = res.skipped ? ' ' + plural(res.skipped, 'ticked piece is', 'ticked pieces are') + ' left as ' + (res.skipped === 1 ? 'it is' : 'they are') + '.' : '';
    if (kind === 'accept') {
      res.title = 'Accept the delivery of ' + plural(n, 'piece');
      res.text = list + ' will be marked on your site. Billing for ' + (n === 1 ? 'it' : 'them') + ' starts from then.' + skip;
      res.button = 'Accept ' + plural(n, 'piece');
    } else if (kind === 'refuse') {
      res.title = 'Refuse the delivery of ' + plural(n, 'piece');
      res.text = list + ' will be turned down: tell us what is wrong and we will arrange the rest.' + skip;
      res.button = 'Refuse ' + plural(n, 'piece');
    } else {
      res.title = 'Start the return of ' + plural(n, 'piece');
      res.text = list + ' will be marked for collection. We collect ' + (n === 1 ? 'it' : 'them') + ' and close the request once everything is back.' + skip;
      res.button = 'Start the return';
    }
    return res;
  }

  /** The rental contract of a request, in plain words (New's contract page). */
  function contractState(contractNumber, quotingAllowed) {
    if (contractNumber) return { title: 'Contract ' + contractNumber, text: 'Created in Oracle Fusion for this request.' };
    return {
      title: 'No contract yet',
      text: quotingAllowed
        ? 'Your rental contract is created when you accept the quote for this request.'
        : 'Your rental contract is created when the request is submitted. If it is missing, your equipment manager can raise it.'
    };
  }

  /** { total, priced, lines }: the line totals stored on the request (New's contract page). */
  function contractValue(lines) {
    var list = Array.isArray(lines) ? lines : [];
    var total = 0;
    var priced = 0;
    list.forEach(function (l) {
      if (l && l.estimatedCost != null && l.estimatedCost !== '' && !isNaN(Number(l.estimatedCost))) {
        total += Number(l.estimatedCost);
        priced += 1;
      }
    });
    return { total: Math.round(total * 100) / 100, priced: priced, lines: list.length };
  }

  // ── The quote ────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * One request-detail-lines row as a quote line, exactly as New's quote page maps it (quoteLine): the total is the
   * stored estimatedCost, else rate × qty × days for a daily rate (or no unit), else rate × qty.
   */
  function quoteLine(r) {
    var startStr = r.startDate ? r.startDate.substring(0, 10) : '';
    var endStr = r.endDate ? r.endDate.substring(0, 10) : '';
    var days = 0;
    if (startStr && endStr) {
      var s = new Date(startStr);
      var e = new Date(endStr);
      days = Math.max(0, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
    }
    var qty = r.quantity != null ? r.quantity : 1;
    var rate = r.billRate != null ? r.billRate : 0;
    var uom = String(r.priceUom || '').toUpperCase();
    var isPerDay = !uom || uom === 'DAY' || uom === 'DAILY';
    var lineTotal;
    if (r.estimatedCost != null) lineTotal = Number(r.estimatedCost);
    else if (isPerDay) lineTotal = rate * qty * days;
    else lineTotal = rate * qty;
    return {
      equipmentName:  r.equipmentName  || '',
      equipmentClass: r.className      || r.equipmentClass || '',
      quantity:       qty,
      startDate:      startStr,
      endDate:        endStr,
      billRate:       rate,
      priceUom:       r.priceUom || null,
      lineTotal:      lineTotal
    };
  }

  /** Where a quote stands: { key: none | ready | accepted | off, title, text, pill, tone }. New's quote page rules. */
  function quoteState(q, hasDoc, acceptAllowed) {
    if (!hasDoc) {
      return { key: 'none', pill: 'Not ready yet', tone: 'draft', title: 'Your quote is not ready yet',
        text: 'No quote document is available for this request yet. When your equipment manager sends it, it shows here.' };
    }
    if (q && q.contractNumber) {
      return { key: 'accepted', pill: 'Accepted', tone: 'onsite', title: 'You accepted this quote',
        text: 'Rental contract ' + q.contractNumber + ' was created. Track the request to see your equipment prepared and shipped.' };
    }
    if (!acceptAllowed) {
      return { key: 'off', pill: 'Ready', tone: 'approval', title: 'Accepting quotes online is switched off',
        text: 'Your equipment manager will confirm the quote with you.' };
    }
    var lines = (q && q.lines) || [];
    return { key: 'ready', pill: 'Ready for you', tone: 'approval', title: 'Accept the quote to confirm your rental',
      text: 'Total ' + portal.money((q && q.grandTotal) || 0) + ' for ' + plural(lines.length, 'line') + '. Accepting creates your rental contract and '
        + 'confirms the equipment for you; it cannot be undone online.' };
  }

  // ── New EquipRite, for the steps that write to Fusion ────────────────────────────────────────────────────────────

  /** A page of New EquipRite's customer portal (vp/shell/customer/<page>?…), or '' while New's address is unknown. */
  function newPage(newBase, page, params) {
    if (!newBase || !page) return '';
    var base = newBase.slice(-1) === '/' ? newBase : newBase + '/';
    var q = Object.keys(params || {}).filter(function (k) { return params[k] != null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return base + 'vp/shell/customer/' + page + (q ? '?' + q : '');
  }

  /** New's customer request page for a request ({ requestId: number, requestNumericId: id }, New's parameters). */
  function newRequestPage(newBase, page, number, id) {
    return newPage(newBase, page, { requestId: number || '', requestNumericId: id || '' });
  }

  // ── Export ───────────────────────────────────────────────────────────────────────────────────────────────────────

  function num(v) { return v === '' || v == null || isNaN(Number(v)) ? '' : Number(v); }

  function exportColumns(what) {
    if (what === 'requests') {
      return [
        { key: 'requestNumber', label: 'Request' },
        { key: 'headline', label: 'Where the equipment is' },
        { key: 'detail', label: 'Detail' },
        { key: 'next', label: 'Next' },
        { key: 'startDate', label: 'Start' },
        { key: 'endDate', label: 'End' },
        { key: 'pieces', label: 'Pieces', type: 'number', value: function (r) { return r.linesRead ? r.pieces : num(r.lines); } },
        { key: 'contractNumber', label: 'Contract' },
        { key: 'customerName', label: 'Customer' },
        { key: 'customerContact', label: 'Contact' },
        { key: 'late', label: 'Late' },
        { key: 'createdDate', label: 'Raised' },
        { key: 'status', label: 'Stored status' }
      ];
    }
    if (what === 'equipment') {
      return [
        { key: 'name', label: 'Equipment' }, { key: 'cls', label: 'Class' }, { key: 'qty', label: 'Qty', type: 'number' },
        { key: 'requestNumber', label: 'Request' }, { key: 'words', label: 'Where it is' }, { key: 'start', label: 'Start' }, { key: 'end', label: 'End' },
        { key: 'location', label: 'Deliver to' }, { key: 'late', label: 'Late' }, { key: 'next', label: 'Next for you' }, { key: 'status', label: 'Stored status' }
      ];
    }
    if (what === 'invoices') {
      return [
        { key: 'invoiceNumber', label: 'Invoice' }, { key: 'requestNumber', label: 'Request' }, { key: 'contractNumber', label: 'Contract' },
        { key: 'equipment', label: 'Equipment' }, { key: 'periodLabel', label: 'Period' }, { key: 'billDate', label: 'Billed' },
        { key: 'dueDate', label: 'Due' }, { key: 'amount', label: 'Amount', type: 'number', value: function (r) { return num(r.amount); } },
        { key: 'words', label: 'Status' }, { key: 'note', label: 'Note' }
      ];
    }
    if (what === 'lines') {
      return [
        { key: 'equipmentName', label: 'Equipment' }, { key: 'equipmentClass', label: 'Class' },
        { key: 'quantity', label: 'Qty', type: 'number', value: function (l) { return num(l.quantity); } },
        { key: 'startDate', label: 'Start' }, { key: 'endDate', label: 'End' },
        { key: 'rate', label: 'Rate', value: function (l) { return rateText(l) === '—' ? '' : rateText(l); } },
        { key: 'where', label: 'Where it is', value: function (l) { return lineWords(l.lineStatus); } },
        { key: 'lineStatus', label: 'Stored status' }
      ];
    }
    if (what === 'quote') {
      return [
        { key: 'equipmentName', label: 'Equipment' }, { key: 'equipmentClass', label: 'Class' },
        { key: 'quantity', label: 'Qty', type: 'number', value: function (l) { return num(l.quantity); } },
        { key: 'startDate', label: 'Start' }, { key: 'endDate', label: 'End' },
        { key: 'rate', label: 'Rate', value: function (l) { return l.billRate === '' || l.billRate == null ? '' : rateText(l); } },
        { key: 'lineTotal', label: 'Line total', type: 'number', value: function (l) { return num(l.lineTotal); } }
      ];
    }
    return [];
  }

  return {
    WORDS: WORDS,
    mapRequest: mapRequest,
    requestsOf: requestsOf,
    mapLine: mapLine,
    linesOf: linesOf,
    headerOf: headerOf,
    findOwn: findOwn,
    lineWords: lineWords,
    lineStage: lineStage,
    nextText: nextText,
    nextFor: nextFor,
    detailWords: detailWords,
    progressOf: progressOf,
    headline: headline,
    detailFor: detailFor,
    when: when,
    decorate: decorate,
    toRead: toRead,
    arrivedById: arrivedById,
    needs: needs,
    overdueRequest: overdueRequest,
    requestChips: requestChips,
    filterRequests: filterRequests,
    sortRequests: sortRequests,
    lateOf: lateOf,
    equipmentRows: equipmentRows,
    equipmentChips: equipmentChips,
    filterEquipment: filterEquipment,
    tiles: tiles,
    summary: summary,
    customerOf: customerOf,
    invoiceRows: invoiceRows,
    invoiceChips: invoiceChips,
    filterInvoices: filterInvoices,
    invoiceGroups: invoiceGroups,
    rateText: rateText,
    nextStep: nextStep,
    ticked: ticked,
    selection: selection,
    issuesFromStock: issuesFromStock,
    plan: plan,
    contractState: contractState,
    contractValue: contractValue,
    quoteLine: quoteLine,
    quoteState: quoteState,
    newPage: newPage,
    newRequestPage: newRequestPage,
    exportColumns: exportColumns
  };
});
