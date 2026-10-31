define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine', 'resources/js/future/fxViews'], function (Seed, E, V) {
  'use strict';

  /**
   * EquipRite Future · the return on a date, the final timesheet and the final bill (Receive, hours, moves and a
   * request's Money tab). The engine stops a hire on a date (offHire { date }: today or earlier stops it that day, a
   * later day is a planned return that happens by itself) and takes the final timesheet in one go (logHoursBulk). This
   * module says what a person sees around them. Pure functions of the state (store.get()); nothing here changes it.
   *
   *   open(s, ids)                      the Return dialog for a line: { def, draft } (the rows of the timesheet, prefilled)
   *   def(s, ids, date, draft)          the dialog's rows for a return date: one per day from the start of the hire to
   *                                     the day before the return (not after today), the site country's weekend marked
   *   fill(s, def, draft)               "Fill standard hours": 8 h of use on each empty working day → { draft, reset }
   *   preview(s, def, draft)            what Confirm does (a dry run as the person played) and the final bill, live
   *   bill(s, requestId, lineId, plan)  the bill of a hire, as the engine's charge run makes it: plan { date, days } for
   *                                     a draft (its hours counted as agreed), or null (the approved timesheet, to today
   *                                     or to the return)
   *   words(text)                       a view's words with the return in them (fxViews still says "Off hire")
   */
  var U = E.util;
  var L = E.lookups;
  var F = V.fmt;
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  // ── Small helpers ──────────────────────────────────────────────────────────────────────────────────────────────
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }
  function names(list, word) {
    var n = (list || []).filter(Boolean);
    if (n.length < 2) return n.join('');
    return n.slice(0, -1).join(', ') + ' ' + (word || 'and') + ' ' + n[n.length - 1];
  }
  function people(bu, roles) {
    return Seed.PERSONAS.filter(function (p) {
      return p.roles.indexOf('admin') === -1 && p.bus.indexOf(bu) !== -1 && p.roles.some(function (r) { return roles.indexOf(r) !== -1; });
    }).map(function (p) { return p.name; });
  }
  /** Hours as a person writes them: 8, 4.5. */
  function h(n) { return String(U.r2(n)); }
  function blank(v) { return v === undefined || v === null || String(v).trim() === ''; }
  function numOf(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  /** "7 Nov – 11 Nov 2026" (the year once when both share it). */
  function range(a, b) { return a === b ? F.date(a) : (a.slice(0, 4) === b.slice(0, 4) ? F.short(a) + ' – ' + F.date(b) : F.date(a) + ' – ' + F.date(b)); }
  function dayName(d) { return DOW[U.dow(d)] + ' ' + F.date(d); }

  /** A line with what the screens need around it, or null. */
  function ctx(s, requestId, lineId) {
    var r = L.request(s, requestId);
    var l = r ? U.byId(r.lines, lineId) : null;
    if (!l) return null;
    var u = L.unit(s, l.unitId || l.preferredUnit);
    var price = l.price || {};
    var cust = L.customer(s, r.customerId);
    var prj = L.project(s, r.projectId);
    return {
      r: r, l: l, u: u, ag: L.agreement(s, l.agreementId), price: price, hourly: price.billing === 'HOURLY', rental: r.type === 'CUSTOMER_RENTAL',
      cur: price.currency || (L.leOf(s, l.provider) || {}).currency || '', hour: price.hour != null ? price.hour : U.r2((price.day || 0) / 8),
      serial: u ? u.serial : l.cls, party: r.type === 'CUSTOMER_RENTAL' ? (cust ? cust.name.split(' · ')[0] : 'the customer') : (prj ? prj.number : 'the project'),
      custName: cust ? cust.name.split(' · ')[0] : 'the customer'
    };
  }
  /** Whether the persona played may approve hours on this request (fxEngine logHoursBulk / approveHours). */
  function mayApprove(s, r) {
    var p = E.persona(s);
    return L.inBu(p, r.requestingBu) && (L.can(p, 'requester') || L.can(p, 'receiver-review'));
  }
  function recorded(s, lineId) {
    var out = {};
    (s.hours || []).forEach(function (x) { if (x.lineId === lineId) out[x.date] = x; });
    return out;
  }

  // ── The basis: by the hour or by the day ──────────────────────────────────────────────────────────────────────
  function basis(c) {
    var detail;
    if (c.hourly) {
      detail = F.money(c.hour, c.cur) + ' an hour of use' + (c.ag && c.ag.standbyPct ? ', standby at ' + Math.round(c.ag.standbyPct * 100) + ' % of it' : '')
        + (c.price.minHours ? ', a minimum of ' + c.price.minHours + ' hours per hire' : '') + ' (' + (c.ag ? c.ag.number + ' v' + (c.l.agreementVersion || c.ag.version) : 'the agreement') + ')';
      return { short: 'By the hour: from the approved timesheet', tone: 'cust', detail: detail, text: 'By the hour: from the approved timesheet, ' + detail };
    }
    detail = F.money(c.price.day, c.cur) + ' a day or ' + F.money(c.price.week, c.cur) + ' a week' + (c.ag && c.ag.minDays ? ', a minimum hire of ' + c.ag.minDays + ' days' : '')
      + (c.ag ? ' (' + c.ag.number + ' v' + (c.l.agreementVersion || c.ag.version) + ')' : ' (own equipment at the internal cost rate)');
    return { short: 'By the day', tone: 'ic', detail: detail, text: 'By the day: ' + detail };
  }

  // ── The bill ──────────────────────────────────────────────────────────────────────────────────────────────────
  var LABEL = { RENTAL: 'Rental', STANDBY: 'Standby', MIN_HIRE: 'Minimum hire', BREAKDOWN_CREDIT: 'Breakdown credit', DAMAGE: 'Damage at the return', LOSS: 'Loss at the agreed value', CREDIT: 'Credit given' };
  var ORDER = { RENTAL: 1, STANDBY: 2, MIN_HIRE: 3, BREAKDOWN_CREDIT: 4, TRANSPORT: 5, DAMAGE: 7, LOSS: 8, CREDIT: 9 };

  function rowOf(c, x, many) {
    var back = x.kind === 'TRANSPORT' && x.seg === 1;
    var label = x.kind === 'TRANSPORT' ? (back ? 'Transport back' : 'Transport out') : LABEL[x.kind] || x.kind;
    var detail;
    if (x.kind === 'RENTAL') {
      detail = x.uom === 'hours' ? h(x.qty) + ' h of use × ' + F.money(x.rate, c.cur) + ' an hour'
        : plural(x.qty, 'day') + ' at ' + F.money(c.price.week, c.cur) + ' a week or ' + F.money(c.price.day, c.cur) + ' a day';
    } else if (x.kind === 'STANDBY') {
      detail = h(x.qty) + ' h × ' + F.money(x.rate, c.cur) + (c.ag && c.ag.standbyPct ? ' (' + Math.round(c.ag.standbyPct * 100) + ' % of the ' + (c.hourly ? 'hour rate' : 'day rate ÷ 8') + ')' : '');
    } else if (x.kind === 'MIN_HIRE') {
      label = x.uom === 'hours' ? 'Minimum ' + c.price.minHours + ' hours per hire' : 'Minimum hire ' + ((c.ag && c.ag.minDays) || '') + ' days';
      detail = x.uom === 'hours' ? 'top-up of ' + h(x.qty) + ' h × ' + F.money(x.rate, c.cur) : plural(x.qty, 'more day') + ' charged';
    } else if (x.kind === 'TRANSPORT') {
      detail = back ? (x.expected ? 'when the yard collects it' : 'collected') : (x.text === 'Transport out' ? 'to the site' : x.text || '');
    } else if (x.kind === 'BREAKDOWN_CREDIT') {
      detail = plural(x.qty, 'day') + ' off · ' + String(x.text || '').replace(/^Breakdown: /, '');
    } else {
      detail = x.text || '';
    }
    if (many && x.period && x.kind !== 'TRANSPORT') detail = F.period(x.period) + ' · ' + detail;
    return { key: [x.kind, x.period, x.kind === 'TRANSPORT' ? x.seg : ''].join('|'), kind: x.kind, label: label, detail: detail, amount: U.r2(x.amount),
      amountText: F.money(x.amount, c.cur), expected: !!x.expected, credit: x.amount < 0, order: (ORDER[x.kind] || 6) + (back ? 1 : 0) };
  }
  /** The lines of charges merged by kind and month (two projects of a moved unit are one rental line a month). */
  function merge(list) {
    var out = [];
    list.forEach(function (x) {
      var k = [x.kind, x.period, x.kind === 'TRANSPORT' ? x.seg : ''].join('|');
      var m = out.filter(function (y) { return y.k === k; })[0];
      if (m) { m.qty = U.r2(m.qty + x.qty); m.amount = U.r2(m.amount + x.amount); } else out.push(Object.assign({}, x, { k: k }));
    });
    return out;
  }

  /**
   * The bill of a hire, from the engine's own charge rules (lineCharges) on a copy of the state, for every month from
   * the start of the hire to the return:
   *   plan { date, days }  a draft: the timesheet applied and counted as agreed (logHoursBulk, approve), the return on
   *                        that date (offHire; a later date as if the clock had reached it): the final bill
   *   null                 the approved timesheet: to the return when returned, else so far (to today, as if the hire
   *                        stopped tomorrow; the minimum and the transport back come at the return)
   * Already charged: the charge lines made so far; still to charge: the rest. The amounts are in the agreement's
   * currency; a customer's bill adds VAT at the owner's country rate.
   */
  function bill(s, requestId, lineId, plan) {
    var c = ctx(s, requestId, lineId);
    if (!c) return { ready: false, started: false, error: 'This line is not here any more.', rows: [], notes: [] };
    var bs = basis(c);
    var head = { ready: true, lineId: lineId, requestId: requestId, serial: c.serial, title: c.serial + (c.u ? ' · ' + c.u.name : ''), cur: c.cur, hourly: c.hourly,
      basisShort: bs.short, basisText: bs.detail, basisTone: bs.tone };
    if (!c.l.events.onHire) {
      return Object.assign(head, { started: false, rows: [], notes: [], modeText: c.l.status === 'REJECTED' ? 'Refused by the owner: no bill.' : 'Starts when it is on hire.', error: '' });
    }
    var st = E.apply(s, 'setPersona', { id: 'p-admin' }).state;
    var error = '';
    if (plan) {
      var a = E.apply(st, 'logHoursBulk', { requestId: requestId, lineId: lineId, days: plan.days || [], until: c.l.events.offHire ? undefined : plan.date, approve: true });
      if (a.ok) st = a.state; else error = a.error;
    }
    var mode;
    var date;
    if (c.l.events.offHire) { mode = 'final'; date = c.l.events.offHire; }
    else {
      date = plan ? plan.date : U.addDays(s.today, 1);
      mode = !plan ? 'sofar' : date > s.today ? 'planned' : 'final';
      if (!ISO.test(date || '')) return Object.assign(head, { started: true, rows: [], notes: [], modeText: 'Pick the return date to see the final bill.', error: 'Give the return date.' });
      var b = E.apply(Object.assign({}, st, { today: date > st.today ? date : st.today }), 'offHire', { requestId: requestId, lineId: lineId, date: date });
      if (!b.ok) return Object.assign(head, { started: true, rows: [], notes: [], modeText: b.error, error: b.error });
      st = b.state;
    }
    var r1 = L.request(st, requestId);
    var l1 = U.byId(r1.lines, lineId);
    var end = date;
    [l1.events.returned, l1.inspection && l1.inspection.date, l1.loss && l1.loss.date].forEach(function (x) { if (x && x > end) end = x; });
    var raw = [];
    for (var pm = U.monthOf(l1.events.onHire); pm <= U.monthOf(end); pm = U.nextMonth(pm)) raw = raw.concat(E.lineCharges(st, r1, l1, pm));
    // The minimum comes at the return (not in a bill so far); a minimum that adds nothing is no line.
    raw = raw.filter(function (x) { return x.kind !== 'MIN_HIRE' || (mode !== 'sofar' && U.r2(x.amount) !== 0); });
    var hasBack = raw.some(function (x) { return x.kind === 'TRANSPORT' && x.seg === 1; });
    var transport = c.ag && c.ag.transport && !c.l.inPlace && c.l.status !== 'TRANSFERRED' && !l1.loss ? c.ag.transport : 0;
    if (mode !== 'sofar' && transport && !hasBack) raw.push({ kind: 'TRANSPORT', seg: 1, qty: 1, uom: 'trip', rate: transport, amount: transport, period: U.monthOf(date), expected: true, text: 'Transport back' });
    var real = (s.charges || []).filter(function (x) { return x.lineId === lineId; });
    var credits = real.filter(function (x) { return x.kind === 'CREDIT'; });
    var merged = merge(raw.concat(credits));
    var periods = [];
    merged.forEach(function (x) { if (x.period && periods.indexOf(x.period) === -1) periods.push(x.period); });
    var rows = merged.map(function (x) { return rowOf(c, x, periods.length > 1); }).sort(function (p, q) { return p.order - q.order || (p.key < q.key ? -1 : 1); });
    var total = U.sum(rows, function (x) { return x.amount; });
    var charged = U.sum(real, function (x) { return x.amount; });
    var toCharge = U.r2(total - charged);
    // The hours counted, over the days on hire (to the day before the return).
    var last = U.addDays(date, -1);
    var hrs = (st.hours || []).filter(function (x) { return x.lineId === lineId && x.date >= l1.events.onHire && x.date <= last && x.approved; });
    var usage = U.sum(hrs, function (x) { return x.usage; });
    var standby = U.sum(hrs, function (x) { return x.standby; });
    var daysOn = Math.max(0, U.diffDays(date, l1.events.onHire));
    var vat = null;
    if (c.l.relation === 'CUSTOMER') {
      var pct = (L.country(s, (L.le(s, c.l.providerLe) || {}).country) || {}).vat || 0;
      vat = { pct: pct, amount: U.r2(total * pct), text: 'VAT ' + Math.round(pct * 100) + ' %', amountText: F.money(U.r2(total * pct), c.cur) };
    }
    var gross = vat ? U.r2(total + vat.amount) : total;
    var notes = [];
    var waiting = (s.hours || []).filter(function (x) { return x.lineId === lineId && !x.approved && x.date < date; });
    if (!plan && waiting.length) notes.push(plural(waiting.length, 'day') + ' of hours (' + h(U.sum(waiting, function (x) { return x.usage; })) + ' h of use) wait for approval: not counted until approved.');
    if (mode === 'sofar') {
      var later = [];
      if (c.hourly && c.price.minHours && usage < c.price.minHours) later.push('a minimum of ' + c.price.minHours + ' hours per hire');
      if (!c.hourly && c.ag && c.ag.minDays && daysOn < c.ag.minDays) later.push('a minimum hire of ' + c.ag.minDays + ' days');
      if (transport) later.push('transport back ' + F.money(transport, c.cur));
      if (later.length) notes.push('At the return: ' + names(later) + '.');
    }
    if (mode === 'planned') notes.push('Hours from ' + F.short(U.addDays(s.today, 1)) + ' to ' + F.short(last) + ' come with the final timesheet, asked for on ' + F.date(date) + '.');
    var damageNote = l1.loss ? '' : l1.inspection ? (l1.inspection.damage > 0 ? '' : 'Inspected ' + F.date(l1.inspection.date) + ': no damage.') : 'Damage, if any, is added after the yard’s inspection.';
    if (c.rental && c.r.deposit && !c.r.deposit.settled) notes.push('The deposit of ' + F.money(c.r.deposit.amount, c.cur) + ' is applied to the open invoices after the inspection, the rest refunded.');
    var modeText = mode === 'final' ? 'Returned ' + F.date(date) + ': ' + (daysOn ? 'on hire ' + range(l1.events.onHire, last) + ' (' + plural(daysOn, 'day') + ')' : 'the hire stops the day it started')
      : mode === 'planned' ? 'Return planned for ' + F.date(date) + ': on hire ' + range(l1.events.onHire, last) + ' (' + plural(daysOn, 'day') + ')'
        : 'So far, to today (' + F.date(s.today) + '): on hire since ' + F.date(l1.events.onHire) + (c.l.plannedReturn ? ' · return planned for ' + F.date(c.l.plannedReturn) : '');
    return Object.assign(head, {
      started: true, error: error, mode: mode, date: date, modeText: modeText, daysOn: daysOn, rows: rows, empty: !rows.length,
      usage: usage, standby: standby, hoursDays: hrs.length,
      hoursText: c.hourly || hrs.length ? plural(hrs.length, 'day') + ' with hours · ' + h(usage) + ' h of use · ' + h(standby) + ' h of standby' + (plan ? '' : ' (approved)') : '',
      total: total, totalText: F.money(total, c.cur), charged: charged, chargedText: F.money(charged, c.cur), chargedNote: real.length ? plural(real.length, 'charge line') : 'nothing charged yet',
      toCharge: toCharge, toChargeText: F.money(toCharge, c.cur),
      toChargeNote: toCharge < 0 ? 'more was charged than the bill comes to: the next charge run adjusts it' : mode === 'sofar' ? 'to today, at the month end’s charge run' : 'at the next charge run' + (mode === 'planned' ? ' after the return' : ''),
      vat: vat, gross: gross, grossText: F.money(gross, c.cur), totalLabel: mode === 'sofar' ? 'Total so far' : 'Total for the hire',
      notes: notes, damageNote: damageNote
    });
  }

  // ── The Return dialog ─────────────────────────────────────────────────────────────────────────────────────────
  /** The last day of the timesheet: the day before the return (or before the return date), not after today. */
  function lastDay(s, l, date) {
    if (l.events.offHire) return U.addDays(l.events.offHire, -1);
    var end = ISO.test(date || '') && date >= l.events.onHire ? U.addDays(date, -1) : s.today;
    return end < s.today ? end : s.today;
  }
  function valueOf(draft, kind, date, fallback) {
    var d = (draft && draft[kind]) || {};
    return Object.prototype.hasOwnProperty.call(d, date) ? String(d[date] === null || d[date] === undefined ? '' : d[date]) : fallback;
  }

  /** The dialog's rows and words for a return date (the rows change with the date; the values typed are kept). */
  function def(s, ids, date, draft) {
    var i = ids || {};
    var c = ctx(s, i.requestId, i.lineId);
    if (!c || !c.l.events.onHire) {
      return { open: true, missing: true, requestId: i.requestId || '', lineId: i.lineId || '', kicker: '', title: 'Not here any more', sub: '', mode: 'return', date: '', minDate: '', rows: [],
        canApprove: false, approveLabel: '', waitText: '', weekendText: '', rangeText: '', returnedText: '', plannedText: '', basisText: '', basisShort: '' };
    }
    var returned = !!c.l.events.offHire;
    var rec = recorded(s, c.l.id);
    var end = lastDay(s, c.l, date);
    var rows = [];
    for (var d = c.l.events.onHire; d <= end; d = U.addDays(d, 1)) {
      var x = rec[d];
      var we = E.isWeekend(s, c.r.country, d);
      rows.push({ date: d, dow: DOW[U.dow(d)], label: DOW[U.dow(d)] + ' ' + F.short(d), title: dayName(d) + (we ? ' (weekend)' : ''), weekend: we, recorded: !!x, approved: !!(x && x.approved),
        usage: valueOf(draft, 'usage', d, x ? String(x.usage) : ''), standby: valueOf(draft, 'standby', d, x ? String(x.standby) : ''), uid: 'stRetU-' + d, sid: 'stRetS-' + d,
        cls: 'nx-row fx-sheet-row' + (we ? ' fx-sheet-row--we' : '') });
    }
    var cty = L.country(s, c.r.country);
    var appr = people(c.r.requestingBu, ['requester', 'receiver-review']);
    var bs = basis(c);
    return {
      open: true, missing: false, requestId: c.r.id, lineId: c.l.id, number: c.r.number, serial: c.serial, mode: returned ? 'timesheet' : 'return', rental: c.rental, hourly: c.hourly,
      kicker: 'On site · ' + c.serial + ' · ' + (c.rental ? c.custName + ' (customer rental)' : c.party),
      title: returned ? 'The final timesheet of ' + c.serial : 'Return ' + c.serial,
      sub: c.r.number + ' · ' + c.r.site + ' · on hire since ' + F.date(c.l.events.onHire) + ' · ' + bs.short.toLowerCase(),
      date: returned ? c.l.events.offHire : (date || ''), minDate: c.l.events.onHire, today: s.today, onHire: c.l.events.onHire,
      returnedText: returned ? 'Returned on ' + F.date(c.l.events.offHire) + ': the hire stopped that day. The timesheet runs to ' + F.date(U.addDays(c.l.events.offHire, -1)) + '.' : '',
      plannedText: !returned && c.l.plannedReturn ? 'Return planned for ' + F.date(c.l.plannedReturn) + ': pick another date to move it, or today to return it now.' : '',
      rows: rows, rangeText: rows.length ? range(rows[0].date, rows[rows.length - 1].date) + ' · ' + plural(rows.length, 'day') : 'No day to record',
      weekendText: 'Weekend in ' + (cty ? cty.name : c.r.country) + ': ' + (cty ? cty.weekend.map(function (k) { return DOW[k]; }).join('–') : ''),
      canApprove: mayApprove(s, c.r),
      approveLabel: 'These hours are agreed (' + (c.rental ? 'signed by the customer, ' + c.custName : 'approved by the project, ' + c.party) + ')',
      waitText: 'They wait for the approval of ' + (appr.length ? names(appr, 'or') : 'the requester') + '; the bill counts them once approved.',
      basisText: bs.text, basisShort: bs.short, basisTone: bs.tone
    };
  }

  /** The dialog for a line: today as the return date (or the planned one), the rows prefilled from the hours recorded. */
  function open(s, ids) {
    var i = ids || {};
    var c = ctx(s, i.requestId, i.lineId);
    var date = !c ? '' : c.l.events.offHire ? c.l.events.offHire : (c.l.plannedReturn || s.today);
    var draft = { date: date, usage: {}, standby: {}, approve: false };
    return { def: def(s, i, date, draft), draft: draft };
  }

  /** Each row's values: typed, or as recorded. */
  function sheet(s, dv, draft) {
    var rec = recorded(s, dv.lineId);
    return (dv.rows || []).map(function (row) {
      var x = rec[row.date];
      var us = valueOf(draft, 'usage', row.date, x ? String(x.usage) : '');
      var sb = valueOf(draft, 'standby', row.date, x ? String(x.standby) : '');
      var u = numOf(us);
      var b = numOf(sb);
      var bad = (!blank(us) && !isFinite(parseFloat(us))) || (!blank(sb) && !isFinite(parseFloat(sb))) || u < 0 || b < 0 || u + b > 24;
      var changed = x ? (u !== x.usage || b !== x.standby) : (u > 0 || b > 0);
      return { date: row.date, weekend: row.weekend, rec: x || null, us: us, sb: sb, usage: u, standby: b, bad: bad, changed: changed, empty: blank(us) && blank(sb) && !x };
    });
  }

  /** "Fill standard hours": 8 h of use on each working day without hours. reset: the inputs to set (native inputs keep what was typed). */
  function fill(s, dv, draft) {
    var d = { date: (draft || {}).date || '', usage: Object.assign({}, (draft || {}).usage || {}), standby: Object.assign({}, (draft || {}).standby || {}), approve: !!(draft || {}).approve };
    var reset = [];
    sheet(s, dv, draft).forEach(function (x) {
      if (x.weekend || !x.empty) return;
      d.usage[x.date] = '8';
      d.standby[x.date] = '0';
      reset.push({ id: 'stRetU-' + x.date, value: '8' }, { id: 'stRetS-' + x.date, value: '0' });
    });
    return { draft: d, reset: reset, filled: reset.length / 2 };
  }

  function toldRows(s, after) {
    var n = after.notifications.length - s.notifications.length;
    return after.notifications.slice(0, Math.max(0, n)).reverse().map(function (x) {
      var to = Seed.PERSONAS.filter(function (p) { return p.roles.indexOf('admin') === -1 && E.visibleTo(x, p); }).map(function (p) { return p.name; });
      return { who: names(to) || 'No one in the demo', text: x.text };
    });
  }

  /**
   * What Confirm does, from the dialog's rows and what is typed: the payloads (logHoursBulk with the days changed,
   * approved when ticked and allowed; offHire with the date, unless already returned), a dry run as the person
   * played (its refusal in the engine's words), who is told, the final bill and the toast.
   */
  function preview(s, dv, draft) {
    var d = draft || {};
    var c = dv && !dv.missing ? ctx(s, dv.requestId, dv.lineId) : null;
    if (!c || !c.l.events.onHire) {
      return { ok: false, warn: 'This line is not here any more.', bulk: null, offHire: null, states: {}, bill: null, told: [], does: [], confirm: 'Confirm', tone: 'primary', toast: '',
        whenText: '', sheetText: '', droppedText: '', canFill: false, planned: false };
    }
    var returned = !!c.l.events.offHire;
    var date = returned ? c.l.events.offHire : String(d.date || '');
    var dateOk = returned || (ISO.test(date) && date >= c.l.events.onHire);
    var planned = !returned && dateOk && date > s.today;
    var rows = sheet(s, dv, d);
    // The rows shown must be the ones for this date (the chain rebuilds them when the date changes).
    var inRange = rows.filter(function (x) { return !dateOk || x.date < date; });
    var bad = inRange.filter(function (x) { return x.bad; });
    // Only the days that change go: an unchanged day keeps its approval.
    var days = inRange.filter(function (x) { return x.changed && !x.bad; }).map(function (x) { return { date: x.date, usage: x.usage, standby: x.standby }; });
    var waiting = (s.hours || []).filter(function (x) { return x.lineId === c.l.id && !x.approved && (!dateOk || x.date < date); });
    var approve = !!d.approve && dv.canApprove;
    var bulk = days.length || (approve && (waiting.length || days.length)) ? { requestId: c.r.id, lineId: c.l.id, days: days, approve: approve } : null;
    if (bulk && !returned) bulk.until = date;
    var off = returned ? null : { requestId: c.r.id, lineId: c.l.id, date: date };
    var warn = '';
    if (!returned && !ISO.test(date)) warn = 'Give the return date.';
    else if (!returned && date < c.l.events.onHire) warn = 'The return date cannot be before the hire started (' + F.date(c.l.events.onHire) + ').';
    else if (bad.length) warn = dayName(bad[0].date) + ': give hours from 0 to 24, use and standby together at most 24.';
    var st = s;
    if (!warn && bulk) { var a = E.apply(st, 'logHoursBulk', bulk); if (a.ok) st = a.state; else warn = a.error; }
    if (!warn && off) { var b = E.apply(st, 'offHire', off); if (b.ok) st = b.state; else warn = b.error; }
    if (!warn && returned && !bulk) warn = 'Nothing to send yet: record the days, or tick that the hours are agreed.';
    // Each row's state, as the person sees it.
    var states = {};
    rows.forEach(function (x) {
      var empty = !x.rec && x.usage + x.standby === 0;
      states[x.date] = x.bad ? { text: 'Check', tone: 'bad' } : empty ? { text: x.weekend ? 'Weekend' : '—', tone: 'na' }
        : x.changed ? { text: x.rec ? 'Changed' : 'New', tone: approve ? 'ok' : 'run' }
          : x.rec.approved ? { text: 'Approved', tone: 'ok' } : approve ? { text: 'Agreed', tone: 'ok' } : { text: 'Waiting', tone: 'todo' };
    });
    var shown = inRange.filter(function (x) { return !x.bad; });
    var usage = U.sum(shown, function (x) { return x.usage; });
    var standby = U.sum(shown, function (x) { return x.standby; });
    var withHours = shown.filter(function (x) { return x.usage + x.standby > 0; }).length;
    var emptyWork = inRange.filter(function (x) { return x.empty && !x.weekend; }).length;
    var dropped = !returned && dateOk && !planned ? (s.hours || []).filter(function (x) { return x.lineId === c.l.id && x.date >= date; }).map(function (x) { return x.date; }).sort() : [];
    var bl = dateOk ? bill(s, c.r.id, c.l.id, { date: date, days: days }) : null;
    var daysOn = dateOk ? Math.max(0, U.diffDays(date, c.l.events.onHire)) : 0;
    var yd = people(c.l.provider, ['yard']);
    var whenText = returned ? dv.returnedText
      : !dateOk ? (ISO.test(date) ? 'The return date cannot be before the hire started (' + F.date(c.l.events.onHire) + ').' : 'Give the return date.')
        : planned ? 'Planned return: the hire stops by itself on ' + F.date(date) + '; the final timesheet is asked for then.'
          : (date === s.today ? 'Returned today' : 'Returned on ' + dayName(date)) + ': the hire stops that day' + (daysOn ? ', charged up to ' + F.date(U.addDays(date, -1)) : ', nothing charged for its days (it started that day)') + '.';
    var does = [];
    if (dateOk && !returned) {
      does.push(planned ? 'Books the return of ' + c.serial + ' for ' + F.date(date) + ': on that day the hire stops by itself, and ' + (c.rental ? 'the rental desk' : 'the site') + ' is asked for the final timesheet.'
        : 'Stops the hire of ' + c.serial + ' on ' + F.date(date) + (dropped.length ? '; ' + plural(dropped.length, 'day') + ' of hours recorded from then on ' + (dropped.length === 1 ? 'is' : 'are') + ' dropped' : '') + '.');
      does.push(poss(L.buName(s, c.l.provider)) + ' yard' + (yd.length ? ' (' + names(yd) + ')' : '') + (planned ? ' is told when it comes back.' : ' is told to collect it.'));
    }
    var agreed = c.rental ? 'signed by the customer' : 'approved by the project';
    if (days.length) {
      does.push('Records ' + plural(days.length, 'day') + ' of the timesheet' + (approve ? ' and agrees every day of it (' + agreed + ').'
        : dv.canApprove ? '; they wait for approval (tick that they are agreed to approve them now).' : '; ' + dv.waitText.charAt(0).toLowerCase() + dv.waitText.slice(1)));
    } else if (approve && waiting.length) {
      does.push('Agrees the ' + plural(waiting.length, 'day') + ' of hours waiting (' + agreed + ').');
    }
    var billText = bl && bl.started && !bl.error ? F.money(bl.total, c.cur) + (bl.vat ? ' + ' + bl.vat.text + ' ' + bl.vat.amountText : '') : '';
    var toast = !dateOk ? '' : returned ? 'The final timesheet of ' + c.serial + ': ' + plural(withHours, 'day') + ', ' + h(usage) + ' h of use' + (approve ? ', agreed' : ', waiting for approval') + (billText ? '; final bill ' + billText : '') + '.'
      : planned ? c.serial + ': return planned for ' + F.date(date) + ' (the hire stops by itself then)' + (days.length ? '; ' + plural(days.length, 'day') + ' of hours sent so far' : '') + '.'
        : c.serial + ' returned on ' + F.date(date) + ': ' + plural(daysOn, 'day') + ', ' + h(usage) + ' h of use' + (billText ? ', final bill ' + billText : '') + '.';
    return {
      ok: !warn, warn: warn, planned: planned, returned: returned, dateOk: dateOk, date: date, whenText: whenText, does: does, told: warn ? [] : toldRows(s, st),
      bulk: bulk, offHire: off, states: states, bill: bl,
      sheetText: plural(withHours, 'day') + ' with hours · ' + h(usage) + ' h of use · ' + h(standby) + ' h of standby' + (emptyWork ? ' · ' + plural(emptyWork, 'working day') + ' empty' : ''),
      canFill: emptyWork > 0,
      droppedText: dropped.length ? 'Hours recorded on ' + names(dropped.map(function (x) { return F.short(x); })) + ' are dropped: the hire stops on ' + F.date(date) + '.' : '',
      confirm: returned ? 'Send the final timesheet' : !dateOk ? 'Return' : planned ? 'Book the return for ' + F.date(date) : 'Return ' + c.serial + ' on ' + F.date(date),
      tone: planned ? 'primary' : 'ok', toast: toast
    };
  }
  function poss(n) { return /s$/.test(n) ? n + '\'' : n + '\'s'; }

  // ── Words ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // fxViews (the engine's views) still names the return "off hire": the screens show it in these words.
  var WORDS = [
    [/Off hire, waiting for collection/g, 'Returned, waiting for collection'],
    [/\(off hire, return, damage\)/g, '(the return, the transport back, damage)'],
    [/units to collect \(off hire\)/g, 'units returned by the site, to collect'],
    [/^Off hire, return, inspect$/, 'Return it on a date with the final timesheet, collect it, inspect it'],
    [/\bOff hire (\d)/g, 'Returned $1'],
    [/; deposit, approve, ship, invoice\.$/, '; deposit, approve, ship, return it with the customer’s signed timesheet (billed by the hour), invoice.']
  ];
  function words(text) {
    var t = String(text === undefined || text === null ? '' : text);
    WORDS.forEach(function (w) { t = t.replace(w[0], w[1]); });
    return t;
  }

  return { open: open, def: def, fill: fill, preview: preview, bill: bill, basis: function (s, rid, lid) { var c = ctx(s, rid, lid); return c ? basis(c) : null; },
    words: words, mayApprove: mayApprove, lastDay: lastDay };
});
