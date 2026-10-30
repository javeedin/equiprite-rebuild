define(['resources/js/requestList', 'resources/js/requestProgress', 'resources/js/cartDrafts', 'resources/js/approvalQueue', 'resources/js/mobileRecent'],
  function (List, Progress, Drafts, Queue, Recent) {
  'use strict';

  // My requests on a phone, pure: a card per request (where it is, read from its equipment by requestProgress, as
  // Next's Requests does), the chips across the top, search, and one request's equipment in words. Which steps a card
  // offers (approve, pick, carry on with a draft) follows page access, as on the tabs that take them.
  //
  // Mine are the requests whose requester is you (cartDrafts.isMine); a manager can switch to everyone's.
  // Each card keeps its latest date (lastAt: when it was raised or last changed, its start, its end), so the list can
  // open on the last few days (mobileRecent), the copy kept on the phone too.

  var CHIPS = [
    { key: 'open', label: 'Open' },
    { key: 'action', label: 'Needs you' },
    { key: 'approval', label: 'Approval' },
    { key: 'ready', label: 'Getting ready' },
    { key: 'out', label: 'On the way' },
    { key: 'onsite', label: 'On site' },
    { key: 'back', label: 'Coming back' },
    { key: 'done', label: 'Done' },
    { key: 'all', label: 'All' }
  ];
  var CLOSED = { done: 1, stopped: 1 };

  function lc(v) { return String(v == null ? '' : v).toLowerCase(); }
  function up(v) { return String(v == null ? '' : v).toUpperCase(); }

  /**
   * The cards, newest first.
   *   o: { who: [your usernames and names], scope: 'mine' | 'all', can: { decide, pick, request }, now }
   */
  function cards(rows, linesByRequest, o) {
    var opts = o || {};
    var kinds = {};
    Queue.build(rows, linesByRequest, { now: opts.now }).forEach(function (q) { kinds[q.number] = q.kind; });
    return List.decorate(rows, linesByRequest, opts.now)
      .filter(function (r) { return r && r.requestNumber && (opts.scope === 'all' || Drafts.isMine(r, opts.who)); })
      .map(function (r) { return card(r, (linesByRequest || {})[r.requestNumber] || [], kinds[r.requestNumber] || '', opts.can); });
  }

  function card(r, lines, kind, can) {
    var c = can || {};
    var p = r.p;
    var acts = List.actions(r, lines, kind, c);
    var keys = List.keysOf(p);
    if (!CLOSED[p.stage] || p.headline === 'Sent back') keys.push('open');
    return {
      id: r.eqrEquipmentRequestId != null ? Number(r.eqrEquipmentRequestId) : null,
      number: String(r.requestNumber),
      party: r.party || '',
      partyFor: r.partyFor || '',
      task: r.taskName || '',
      dates: r.dates || '',
      start: String(r.startDate || '').slice(0, 10),
      end: String(r.endDate || '').slice(0, 10),
      requestor: r.requestorName || r.requestorUsername || '',
      location: r.deliveryLocation || r.deliveryAddress || r.locationName || '',
      external: !!r.external,
      status: up(r.status || r.requestStatus),
      headline: p.headline,
      tone: p.tone || p.stage || 'draft',
      detail: p.detail || '',
      next: p.next ? p.next.text : '',
      late: p.late && p.late.length ? p.late[0].text : '',
      pieces: r.pieces || 0,
      segs: r.segs && r.segs.length ? r.segs : [{ stage: p.tone || 'draft', title: p.headline }],
      keys: keys,
      draft: p.stage === 'draft',
      sentBack: p.headline === 'Sent back',
      approve: !!acts.approve,
      pick: acts.pick || 0,
      carryOn: !!c.request && (p.stage === 'draft' || p.headline === 'Sent back'),
      lastAt: Recent.latest(r),
      text: lc([r.requestNumber, r.party, r.partyFor, r.taskName, r.requestorName, p.headline, (lines || []).map(function (l) { return l.name; }).join(' ')].join(' '))
    };
  }

  /** The chips with their counts; a request counts in every stage its equipment is in. */
  function chips(list) {
    return CHIPS.map(function (ch) {
      var n = ch.key === 'all' ? list.length : list.filter(function (x) { return x.keys.indexOf(ch.key) !== -1; }).length;
      return { key: ch.key, label: ch.label, count: n };
    });
  }

  /** The cards under a chip whose text matches every word searched. */
  function filter(list, chip, text) {
    var words = lc(text).split(/\s+/).filter(Boolean);
    return (list || []).filter(function (x) {
      if (chip && chip !== 'all' && x.keys.indexOf(chip) === -1) return false;
      return words.every(function (w) { return x.text.indexOf(w) !== -1; });
    });
  }

  /** Where a request opens: the chip that holds what needs you, else Open, else All. */
  function firstChip(list) {
    if ((list || []).some(function (x) { return x.keys.indexOf('action') !== -1; })) return 'action';
    if ((list || []).some(function (x) { return x.keys.indexOf('open') !== -1; })) return 'open';
    return 'all';
  }

  /** A request's equipment, each piece in words: [{ key, name, cls, qty, label, stage, next, serial ("Unit RL-9" once assigned), dates }]. */
  function equipment(lines, external) {
    return (lines || []).map(function (l, i) {
      var info = Progress.line(l.lineStatus || l.status, external);
      return {
        key: l.key || String(i),
        name: l.name || 'Equipment',
        cls: l.cls || '',
        qty: Number(l.qty) || 1,
        label: info.label || 'Status not known',
        stage: info.stage || 'draft',
        next: info.who && info.what ? info.who + ' to ' + info.what : '',
        serial: l.serial ? 'Unit ' + l.serial : '',
        dates: l.start || l.end ? [l.start, l.end].filter(Boolean).join(' to ') : ''
      };
    });
  }

  /** What the offline copy keeps of a card (no search text). */
  function keep(list, max) {
    return (list || []).slice(0, max || 80).map(function (x) {
      var k = Object.assign({}, x);
      delete k.text;
      return k;
    });
  }

  /** Cards back from the offline copy: searchable again, no steps offered (they need a connection). */
  function restore(list) {
    return (list || []).map(function (x) {
      return Object.assign({}, x, { approve: false, pick: 0, carryOn: false,
        text: lc([x.number, x.party, x.partyFor, x.task, x.requestor, x.headline].join(' ')) });
    });
  }

  return { CHIPS: CHIPS, cards: cards, chips: chips, filter: filter, firstChip: firstChip, equipment: equipment, keep: keep, restore: restore };
});
