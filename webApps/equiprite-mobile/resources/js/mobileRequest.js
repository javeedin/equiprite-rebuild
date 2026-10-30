define(['resources/js/orderForm', 'resources/js/fmt', 'resources/js/cartDrafts', 'resources/js/rules'], function (order, fmt, cartDrafts, rules) {
  'use strict';

  // The Request tab on a phone, pure: what each screen says, the summary under each step, the copy of a request this
  // phone keeps while it is being raised, the drafts and past requests to start from, and a request copied into a new
  // one (fixing one that was sent back, ordering again). The rules are Next's orderForm (what each step needs, the
  // estimate, the snapshot the shared builders post); this only reads them for a phone. Nothing is fetched or written.

  var STEPS = [{ n: 1, label: 'Equipment' }, { n: 2, label: 'Project' }, { n: 3, label: 'Review' }];
  var KEEP_VERSION = 1;
  // What a copied request takes from the one it is copied from. Dates and notes only when fixing one sent back: an
  // order again is for new dates.
  var COPY_FIELDS = ['projectId', 'projectNumber', 'projectName', 'projectBuId', 'projectBuName', 'taskId', 'taskNumber', 'taskName',
    'customerId', 'customerName', 'contractId', 'contractNumber', 'locationType', 'location', 'deliveryInvOrgId', 'deliveryLocationId', 'hours'];
  var FIX_FIELDS = ['startDate', 'endDate', 'notes'];

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
  function plain(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function plural(n, one, many) { return fmt.count(n, one, many); }

  /** The three steps across the top, each with what it holds so far: done, current or to do. */
  function steps(step, form, cart) {
    var cur = Number(step) || 1;
    var f = form || {};
    var s = order.cartSummary(cart, '', '', true);
    var sub = {
      1: s.units ? plural(s.units, 'piece') : 'Nothing yet',
      2: f.projectName || f.projectNumber || 'Not chosen',
      3: order.missingFor('review', f, cart).length ? '' : 'Ready'
    };
    return STEPS.map(function (x) {
      return { n: x.n, label: x.label, sub: sub[x.n], state: x.n < cur ? 'done' : (x.n === cur ? 'current' : 'todo') };
    });
  }

  /** The screen's title: the draft held here, or a new request. */
  function title(resume) {
    return resume && resume.requestNumber ? 'Draft ' + resume.requestNumber : 'New request';
  }

  /** Under the title: the dates and the project, or what to do. */
  function subline(form) {
    var f = form || {};
    var bits = [];
    if (f.startDate && f.endDate) bits.push(fmt.range(f.startDate, f.endDate));
    if (f.projectName) bits.push(f.projectName);
    return bits.length ? bits.join(' · ') : 'Equipment and dates, then the project.';
  }

  /** The count on the cart button: pieces, '' for none, '99+' past 99. */
  function count(cart) {
    var n = order.cartSummary(cart, '', '', true).units;
    return n > 99 ? '99+' : (n > 0 ? String(n) : '');
  }

  /** "3 items · 4 pieces" ("Empty" when nothing is in it). */
  function cartCount(cart) {
    var s = order.cartSummary(cart, '', '', true);
    if (!s.lines) return 'Empty';
    return plural(s.lines, 'item') + (s.units !== s.lines ? ' · ' + plural(s.units, 'piece') : '');
  }

  /** The estimated total and how much of the cart it covers: { total, note } (Next's rail). */
  function totals(cart, form, hideRates) {
    var f = form || {};
    var s = order.cartSummary(cart, f.startDate, f.endDate, hideRates);
    if (!s.priced) return { total: '—', note: f.startDate && f.endDate ? 'no prices yet' : 'once the dates are in' };
    return { total: order.money(s.total), note: s.priced < s.lines ? s.priced + ' of ' + s.lines + ' priced' : '' };
  }

  /** Above the catalog: how many, and for which dates. */
  function catalogNote(count, all, form) {
    var f = form || {};
    var n = count === all ? plural(all, 'item') : count + ' of ' + all + ' items';
    return n + (f.startDate && f.endDate ? ' · free and priced for these dates' : ' · pick the dates to see what is free');
  }

  /** Under a customer or project list: "Searching…", "No project matches “x”.", "50 customers from Oracle Fusion". */
  function listNote(kind, results, query, searching) {
    if (searching) return 'Searching…';
    var n = Array.isArray(results) ? results.length : 0;
    var what = function (k) { return k + ' ' + kind + (k === 1 ? '' : 's'); };
    if (query) return n ? what(n) + (n === 1 ? ' matches' : ' match') + ' “' + query + '”.' : 'No ' + kind + ' matches “' + query + '”.';
    return n ? what(n) + ' from Oracle Fusion. Type a name or number to narrow it.' : '';
  }

  /** "Still needed: Customer, Project and Task." in the screen's order (the customer first). */
  function missingText(missing) {
    return 'Still needed: ' + order.listWords(order.screenOrder(missing || [])) + '.';
  }

  /** "PRJ-2026-001 Pipeline North · EPC_US_BU". */
  function projectText(form) {
    var f = form || {};
    return [[f.projectNumber, f.projectName].filter(Boolean).join(' '), f.projectBuName].filter(Boolean).join(' · ');
  }

  function taskText(form) {
    var f = form || {};
    return [f.taskNumber, f.taskName].filter(Boolean).join(' ');
  }

  /** The delivery as Review says it. */
  function deliveryText(form) {
    var f = form || {};
    var where = String(f.location || '').trim();
    if (!where) return '';
    return f.locationType === 'PROJECT_SITE' ? where + ' (a site on the contract)' : where;
  }

  /** "29.76040, -95.36980" for a point. */
  function coords(p) {
    return p && p.lat != null && p.lng != null && p.lat !== '' && p.lng !== '' && !isNaN(Number(p.lat)) && !isNaN(Number(p.lng))
      ? Number(p.lat).toFixed(5) + ', ' + Number(p.lng).toFixed(5) : '';
  }

  /** Under the delivery address once it is pinned: "Pinned on the map · 29.76040, -95.36980". */
  function pinText(form) {
    var f = form || {};
    var c = coords({ lat: f.locationLatitude, lng: f.locationLongitude });
    return c ? 'Pinned on the map · ' + c : 'Pinned on the map';
  }

  /** What Submit does, said before it is pressed. */
  function submitWords(cart, resume) {
    var n = (Array.isArray(cart) ? cart : []).length;
    var what = resume && resume.requestNumber ? 'Draft ' + resume.requestNumber : 'A new request';
    return what + ' with ' + plural(n, 'line') + ' goes to the project’s approver. You can follow it in My requests.';
  }

  /** What Save draft does. */
  function draftWords(resume) {
    return resume && resume.requestNumber
      ? 'Save draft updates ' + resume.requestNumber + '. Nothing is sent for approval.'
      : 'Save draft keeps it in My requests as a draft. Nothing is sent for approval.';
  }

  /** Said when Submit or Save draft is pressed with no connection (nothing is sent). */
  function offlineText(isDraft) {
    return 'No connection: nothing was sent. What you have entered is kept on this phone; ' + (isDraft ? 'save the draft' : 'send it')
      + ' once the signal is back.';
  }

  /** First letters of the class or name for a card with no picture (Next's rule). */
  function initials(name) {
    return String(name || '').split(/\s+/).filter(function (w) { return /^[A-Za-z0-9]/.test(w); }).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }

  /** A picture the card can use: absolute and data: URIs as they are, app-relative ones under the app's path. */
  function imageSrc(raw, appPath) {
    if (!raw) return '';
    return /^(https?:|data:)/.test(raw) ? raw : (appPath || '') + raw;
  }

  /** Whether anything has been entered: equipment, dates, a project or customer, a task, an address, notes or hours. */
  function started(form, cart) {
    var f = form || {};
    if (Array.isArray(cart) && cart.length) return true;
    return ['startDate', 'endDate', 'projectId', 'customerId', 'taskId', 'location', 'notes', 'hours']
      .some(function (k) { return f[k] != null && String(f[k]).trim() !== ''; });
  }

  /** Whether step 1 offers the drafts and past requests to start from: a new request with nothing in the cart. */
  function fresh(cart, resume) {
    return !(resume && resume.id != null) && !(Array.isArray(cart) && cart.length);
  }

  /** What this phone keeps of the request being raised (offlineSnapshot 'request'): plain values only. */
  function keep(v) {
    var x = v || {};
    return plain({
      v: KEEP_VERSION,
      form: x.form || {},
      cart: Array.isArray(x.cart) ? x.cart : [],
      step: Number(x.step) || 1,
      resume: x.resume && x.resume.id != null ? x.resume : null,
      agreementId: x.agreementId != null ? Number(x.agreementId) : null,
      agreementLineMap: x.agreementLineMap || {}
    });
  }

  /**
   * The kept copy back, or null when there is none worth restoring (another shape, nothing entered). The form takes
   * the empty form's shape first, so a field added since is there.
   */
  function restore(data, name, actor) {
    var d = data || {};
    if (d.v !== KEEP_VERSION || !d.form || typeof d.form !== 'object' || !Array.isArray(d.cart)) return null;
    var resume = d.resume && d.resume.id != null ? d.resume : null;
    if (!resume && !started(d.form, d.cart)) return null;
    var step = Math.min(3, Math.max(1, Number(d.step) || 1));
    return {
      form: Object.assign(order.emptyForm(name, actor), plain(d.form)),
      cart: plain(d.cart).filter(function (it) { return it && it.id != null; }),
      step: step,
      resume: plain(resume),
      agreementId: d.agreementId != null ? Number(d.agreementId) : null,
      agreementLineMap: plain(d.agreementLineMap) || {}
    };
  }

  /** Equipment on a request in words, from its lines in the shared list: "2 pieces · Wheel Loader 950". */
  function aboutLines(lines) {
    var list = Array.isArray(lines) ? lines : [];
    var names = list.map(function (l) { return l.name; }).filter(Boolean);
    var pieces = list.reduce(function (n, l) { return n + (Number(l.qty) || 1); }, 0);
    return cartDrafts.about({ pieces: pieces, lines: list.length,
      names: names.slice(0, 2).join(', ') + (names.length > 2 ? ' and ' + (names.length - 2) + ' more' : '') });
  }

  function mineInternal(r, who) {
    return !!(r && r.requestNumber) && !rules.isExternalSource(r.requestOrigin || r.source) && cartDrafts.isMine(r, who);
  }

  /**
   * What to carry on with at the start: your drafts (cartDrafts.list's, at most max), then your requests sent back to
   * fix (status REJECTED), as cards { id, number, party, about, dates, saved, pill, stage }. Returns { cards, more }:
   * more is how many drafts are not shown (they are in My requests).
   */
  function carryOn(drafts, rows, linesByRequest, who, max) {
    var mine = Array.isArray(drafts) ? drafts : [];
    var n = max || 5;
    var cards = mine.slice(0, n).map(function (d) {
      return { id: d.id, number: d.number, party: d.party || 'No project yet', about: cartDrafts.about(d), saved: d.saved || '',
        dates: d.dates || '', pill: 'Draft', stage: 'draft' };
    });
    (Array.isArray(rows) ? rows : []).filter(function (r) {
      return up(r && (r.status || r.requestStatus)) === 'REJECTED' && mineInternal(r, who);
    }).slice(0, 3).forEach(function (r) {
      cards.push({ id: r.eqrEquipmentRequestId != null ? Number(r.eqrEquipmentRequestId) : null, number: String(r.requestNumber),
        party: r.projectName || 'No project', about: aboutLines((linesByRequest || {})[r.requestNumber]),
        saved: 'Sent back: fix it and send it again', dates: fmt.range(r.startDate || r.requestedStartDate, r.endDate || r.requestedEndDate),
        pill: 'Sent back', stage: 'stopped' });
    });
    return { cards: cards, more: Math.max(0, mine.length - n) };
  }

  /**
   * Your past project requests with equipment on them, newest first, to order the same again: [{ id, number, party,
   * about, dates }]. Drafts are carried on with and requests sent back are fixed instead (carryOn); customer requests
   * are raised in New EquipRite.
   */
  function recent(rows, linesByRequest, who, max) {
    var byReq = linesByRequest || {};
    return (Array.isArray(rows) ? rows : []).filter(function (r) {
      var s = up(r && (r.status || r.requestStatus));
      return s && s !== 'DRAFT' && s !== 'REJECTED' && mineInternal(r, who) && (byReq[r.requestNumber] || []).length > 0;
    }).slice(0, max || 4).map(function (r) {
      return {
        id: r.eqrEquipmentRequestId != null ? Number(r.eqrEquipmentRequestId) : null,
        number: String(r.requestNumber),
        party: r.projectName || r.projectInternalCustomer || 'No project',
        about: aboutLines(byReq[r.requestNumber]),
        dates: fmt.range(r.startDate || r.requestedStartDate, r.endDate || r.requestedEndDate)
      };
    });
  }

  /**
   * A request copied into a new one (it keeps nothing of the old one's identity: a new request is raised, the old one
   * stays as it was):
   *   how 'fix'    one sent back: everything, its dates and notes too, so it can be put right and sent again
   *   how 'again'  ordering again: the equipment, project, task, customer, contract and delivery; new dates
   * state: requestHeaderBody.toFlowState(header); priced: draftResume.reprice (today's prices for its equipment);
   * header: the saved header; me: { name, actor }, the requester now.
   * Returns { form, cart, agreementId, agreementLineMap, notice }.
   */
  function copyOf(state, priced, how, header, me) {
    var req = (state && state.request) || {};
    var h = header || {};
    var who = me || {};
    var fix = how === 'fix';
    var form = order.emptyForm(who.name || '', who.actor || '');
    COPY_FIELDS.concat(fix ? FIX_FIELDS : []).forEach(function (k) {
      if (req[k] !== undefined && req[k] !== null) form[k] = req[k];
    });
    form.locationType = form.locationType || 'DELIVERY_LOCATION';
    form.startDate = form.startDate || '';
    form.endDate = form.endDate || '';
    var cart = plain(((priced && priced.items) || []).map(function (it) {
      var x = Object.assign({}, it);
      if (!fix) { delete x.startDate; delete x.endDate; }
      return x;
    }));
    var agreement = fix && h.eqrAgreementHeaderId != null ? Number(h.eqrAgreementHeaderId) : null;
    var number = h.requestNumber || 'it';
    var gone = priced && priced.missing ? priced.missing.length : 0;
    var notice = fix
      ? number + ' was sent back. It is copied into a new request here: put right what is needed and send it again. ' + number
        + ' itself stays as it was.'
      : 'Ordering again from ' + number + ': its equipment, project and delivery are filled in. Pick the dates.';
    if (gone) {
      notice += ' ' + (gone === 1 ? '1 line is no longer in the catalog, so it was left out.' : gone + ' lines are no longer in the catalog, so they were left out.');
    }
    return { form: form, cart: cart, agreementId: agreement, agreementLineMap: agreement != null ? plain((priced && priced.agreementLineIdByEquipmentId) || {}) : {},
      notice: notice };
  }

  /** "Use my location" did not find you, in words (the geolocation error, or none). */
  function locateError(code) {
    if (code === 'denied') return 'Location is off for this app. Allow it in the phone’s settings, or search the address.';
    if (code === 'unsupported') return 'This phone cannot share its location here. Search the address, or tap the map.';
    if (code === 'timeout') return 'Your location took too long to find. Try again in the open, or search the address.';
    return 'Your location could not be found. Search the address, or tap the map.';
  }

  /** The question before something entered here is replaced by a request asked for: { title, body, go }. */
  function replaceText(pending, form, cart, resume) {
    var p = pending || {};
    var n = p.number || 'it';
    var what = p.mode === 'fix' ? 'Fix ' + n + '?' : (p.mode === 'again' ? 'Order again from ' + n + '?' : 'Open draft ' + n + '?');
    var here = [cartCount(cart) === 'Empty' ? '' : cartCount(cart), (form || {}).projectName || ''].filter(Boolean).join(' · ');
    var body = 'What you have started here' + (here ? ' (' + here + ')' : '') + ' is cleared from this screen.'
      + (resume && resume.requestNumber ? ' Draft ' + resume.requestNumber + ' stays saved as it was last saved.' : ' It has not been saved.');
    var go = p.mode === 'fix' ? 'Fix ' + n : (p.mode === 'again' ? 'Order again' : 'Open ' + n);
    return { title: what, body: body, go: go };
  }

  /** Before Start another: what goes. */
  function resetText(resume, cart) {
    return 'The equipment and details here are cleared' + (cartCount(cart) === 'Empty' ? '.' : ' (' + cartCount(cart) + ').')
      + (resume && resume.requestNumber ? ' Draft ' + resume.requestNumber + ' stays in My requests as it was last saved.' : '');
  }

  /** After a submit: what happens next. */
  function sentText(sent) {
    var s = sent || {};
    return (s.number || 'Your request') + ' waits for the project’s approver. Then the Equipment Manager assigns the units and the yard picks and ships them.';
  }

  /** A cart line's second row: its class, its rate as quoted, its own dates. */
  function lineAbout(l) {
    var x = l || {};
    return [x.cls, x.rate, x.own ? x.window : '', x.agreement ? 'agreement rate' : ''].filter(Boolean).join(' · ');
  }

  return {
    STEPS: STEPS,
    steps: steps,
    title: title,
    subline: subline,
    count: count,
    cartCount: cartCount,
    totals: totals,
    catalogNote: catalogNote,
    listNote: listNote,
    missingText: missingText,
    projectText: projectText,
    taskText: taskText,
    deliveryText: deliveryText,
    coords: coords,
    pinText: pinText,
    submitWords: submitWords,
    draftWords: draftWords,
    offlineText: offlineText,
    initials: initials,
    imageSrc: imageSrc,
    started: started,
    fresh: fresh,
    keep: keep,
    restore: restore,
    carryOn: carryOn,
    aboutLines: aboutLines,
    recent: recent,
    copyOf: copyOf,
    locateError: locateError,
    replaceText: replaceText,
    resetText: resetText,
    sentText: sentText,
    lineAbout: lineAbout
  };
});
