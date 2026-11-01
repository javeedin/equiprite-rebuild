define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine', 'resources/js/future/fxViews'], function (Seed, E, V) {
  'use strict';

  /**
   * EquipRite Future · the return on a date, the final timesheet and the final bill (Receive, hours, moves and a
   * request's Money tab). The engine stops a hire on a date (offHire { date }: today or earlier stops it that day, a
   * later day is a planned return that happens by itself) and takes the final timesheet in one go (logHoursBulk). This
   * module says what a person sees around them. Pure functions of the state (store.get()); nothing here changes it.
   *
   * The dialog follows the request's dates. The return date is the request's end when that is after today (else
   * today), never before the hire's start (the request's start date when the unit was delivered early). The timesheet
   * runs from the hire's start to the return: by the hour to and including the return day (its hours count), by the day
   * to the day before (the return day is not charged). Days up to today are the actual timesheet (recorded, agreed);
   * days after today are planned: prefilled with standard hours, editable as an estimate, never saved (the engine
   * records no day after today). Planned days make it a planned return, and the bill an estimate.
   *
   *   open(s, ids)                      the Return dialog for a line: { def, draft } (the rows of the timesheet, prefilled)
   *   def(s, ids, date, draft)          the dialog's rows for a return date: one per day from the start of the hire to the
   *                                     last day of the timesheet (planned after today), the site country's weekend marked
   *   fill(s, def, draft)               "Fill standard hours": 8 h of use on each empty working day → { draft, reset }
   *   preview(s, def, draft)            what Confirm does (a dry run as the person played) and the final bill, live
   *   bill(s, requestId, lineId, plan)  the bill of a hire, as the engine's charge run makes it: plan { date, days, planned }
   *                                     for a draft (its hours counted as agreed; the planned days on a copy whose clock is
   *                                     at the return date), or null (the approved timesheet, to today or to the return)
   *   lastDay(s, line, date)            the last day of the timesheet for a return date (the return day by the hour)
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
  function minD(a, b) { return a < b ? a : b; }
  function maxD(a, b) { return a > b ? a : b; }
  function hourlyLine(l) { return ((l && l.price) || {}).billing === 'HOURLY'; }
  /** A planned day's standard hours: 8 h of use and no standby on a working day, nothing on the site's weekend. */
  function standard(weekend, kind) { return weekend ? '' : (kind === 'usage' ? '8' : '0'); }

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
      custName: cust ? cust.name.split(' · ')[0] : 'the customer', from: r.from || '', to: r.to || '', early: l.earlyDelivery || null
    };
  }
  /** The last day of the timesheet for a return on `date`: by the hour the return day itself, by the day the day before. */
  function sheetEnd(c, date) { return c.hourly ? date : U.addDays(date, -1); }
  /** "on hire from 9 Nov (delivered early on 2 Nov)", "on hire since 7 Nov 2026", "on hire from 9 Nov 2026". */
  function startWords(s, c) {
    var on = c.l.events.onHire;
    if (c.early) return 'on hire from ' + F.short(on) + ' (delivered early on ' + F.short(c.early.arrived) + ')';
    return (on > s.today ? 'on hire from ' : 'on hire since ') + F.date(on);
  }
  /** "Requested 9 Nov – 6 Dec 2026 · on hire from 9 Nov (delivered early on 2 Nov)". */
  function datesText(s, c) { return (c.from && c.to ? 'Requested ' + range(c.from, c.to) + ' · ' : '') + startWords(s, c); }
  /** "The hire starts on 9 Nov 2026 (delivered early on 2 Nov)". */
  function startsText(c) { return 'The hire starts on ' + F.date(c.l.events.onHire) + (c.early ? ' (delivered early on ' + F.short(c.early.arrived) + ')' : ''); }
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
  // An estimate splits these into the actual days and the planned ones.
  var SPLIT = { RENTAL: true, STANDBY: true };

  function rowOf(c, x, many) {
    var back = x.kind === 'TRANSPORT' && x.seg === 1;
    var label = x.kind === 'TRANSPORT' ? (back ? 'Transport back' : 'Transport out') : LABEL[x.kind] || x.kind;
    var detail;
    if (x.kind === 'RENTAL') {
      detail = x.uom === 'hours' ? h(x.qty) + ' h of use × ' + F.money(x.rate, c.cur) + ' an hour'
        : plural(x.qty, 'day') + ' at ' + F.money(c.price.week, c.cur) + ' a week or ' + F.money(c.price.day, c.cur) + ' a day';
    } else if (x.kind === 'STANDBY') {
      detail = h(x.qty) + ' h × ' + F.money(x.rate, c.cur) + standbyWords(c);
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
    return { key: [x.kind, x.period, x.kind === 'TRANSPORT' ? x.seg : ''].join('|'), kind: x.kind, label: label, detail: detail, amount: U.r2(x.amount), phase: '',
      amountText: F.money(x.amount, c.cur), expected: !!x.expected, planned: false, credit: x.amount < 0, order: (ORDER[x.kind] || 6) + (back ? 1 : 0) };
  }
  function standbyWords(c) { return c.ag && c.ag.standbyPct ? ' (' + Math.round(c.ag.standbyPct * 100) + ' % of the ' + (c.hourly ? 'hour rate' : 'day rate ÷ 8') + ')' : ''; }
  /** A line of an estimate: the rental or the standby of the actual days, or of the planned ones. */
  function phaseRow(c, kind, phase, detail, amount) {
    return { key: kind + '|' + phase, kind: kind, phase: phase, label: (LABEL[kind] || kind) + ', ' + phase, detail: detail, amount: U.r2(amount), amountText: F.money(amount, c.cur),
      expected: false, planned: phase === 'planned', credit: amount < 0, order: ORDER[kind] + (phase === 'planned' ? 0.5 : 0) };
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
  /** The engine's charges of a line for every month from the start of the hire to `end`. */
  function chargesOf(st, requestId, lineId, end) {
    var r1 = L.request(st, requestId);
    var l1 = U.byId(r1.lines, lineId);
    var raw = [];
    for (var pm = U.monthOf(l1.events.onHire); pm <= U.monthOf(end); pm = U.nextMonth(pm)) raw = raw.concat(E.lineCharges(st, r1, l1, pm));
    return raw;
  }
  function kindSum(list, kind) { return U.r2(U.sum(list.filter(function (x) { return x.kind === kind; }), function (x) { return x.amount; })); }

  /**
   * The bill of a hire, from the engine's own charge rules (lineCharges) on a copy of the state, for every month from
   * the start of the hire to the return:
   *   plan { date, days, planned }  a draft: the actual days applied and counted as agreed (logHoursBulk, approve), the
   *                        planned days (after today) on the copy with its clock moved to the return date (the engine
   *                        takes them there), the return on that date (offHire): the final bill, or for a later date
   *                        the estimated final bill, the actual and the planned days apart
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
      basisShort: bs.short, basisText: bs.detail, basisTone: bs.tone, heading: 'The final bill', estimate: false, split: null };
    if (!c.l.events.onHire) {
      return Object.assign(head, { started: false, rows: [], notes: [], modeText: c.l.status === 'REJECTED' ? 'Refused by the owner: no bill.' : 'Starts when it is on hire.', error: '' });
    }
    var onHire = c.l.events.onHire;
    if (!plan && !c.l.events.offHire && s.today < onHire) {
      return Object.assign(head, { started: false, rows: [], notes: [], modeText: startsText(c) + ': nothing to bill yet.', error: '' });
    }
    var st = E.apply(s, 'setPersona', { id: 'p-admin' }).state;
    var error = '';
    var mode;
    var date;
    if (c.l.events.offHire) { mode = 'final'; date = c.l.events.offHire; }
    else {
      date = plan ? plan.date : U.addDays(s.today, 1);
      mode = !plan ? 'sofar' : date > s.today ? 'planned' : 'final';
      if (!ISO.test(date || '')) return Object.assign(head, { started: true, rows: [], notes: [], modeText: 'Pick the return date to see the final bill.', error: 'Give the return date.' });
    }
    // The actual days (up to today), counted as agreed.
    if (plan) {
      var a = E.apply(st, 'logHoursBulk', { requestId: requestId, lineId: lineId, days: plan.days || [], until: c.l.events.offHire ? undefined : date, approve: true });
      if (a.ok) st = a.state; else error = a.error;
    }
    var actualSt = st;
    var at = date > s.today ? date : s.today;
    // The planned days (after today): on the copy with its clock at the return date, where the engine takes them.
    if (mode === 'planned') {
      var pd = (plan.planned || []).filter(function (x) { return x && x.date > s.today; });
      if (pd.length) {
        var p2 = E.apply(Object.assign({}, st, { today: at }), 'logHoursBulk', { requestId: requestId, lineId: lineId, days: pd, until: date, approve: true });
        if (p2.ok) st = p2.state; else error = error || p2.error;
      }
    }
    if (!c.l.events.offHire) {
      var b = E.apply(Object.assign({}, st, { today: at }), 'offHire', { requestId: requestId, lineId: lineId, date: date });
      if (!b.ok) return Object.assign(head, { started: true, rows: [], notes: [], modeText: b.error, error: b.error });
      st = b.state;
    }
    var r1 = L.request(st, requestId);
    var l1 = U.byId(r1.lines, lineId);
    var end = date;
    [l1.events.returned, l1.inspection && l1.inspection.date, l1.loss && l1.loss.date].forEach(function (x) { if (x && x > end) end = x; });
    var raw = chargesOf(st, requestId, lineId, end);
    // The minimum comes at the return (not in a bill so far); a minimum that adds nothing is no line.
    raw = raw.filter(function (x) { return x.kind !== 'MIN_HIRE' || (mode !== 'sofar' && U.r2(x.amount) !== 0); });
    var hasBack = raw.some(function (x) { return x.kind === 'TRANSPORT' && x.seg === 1; });
    var transport = c.ag && c.ag.transport && !c.l.inPlace && c.l.status !== 'TRANSFERRED' && !l1.loss ? c.ag.transport : 0;
    if (mode !== 'sofar' && transport && !hasBack) raw.push({ kind: 'TRANSPORT', seg: 1, qty: 1, uom: 'trip', rate: transport, amount: transport, period: U.monthOf(date), expected: true, text: 'Transport back' });
    // The hours counted, over the days of the timesheet (by the hour to the return day, by the day to the day before).
    var last = sheetEnd(c, date);
    var hrs = (st.hours || []).filter(function (x) { return x.lineId === lineId && x.date >= onHire && x.date <= last && x.approved; });
    var usage = U.sum(hrs, function (x) { return x.usage; });
    var standby = U.sum(hrs, function (x) { return x.standby; });
    var daysOn = Math.max(0, U.diffDays(date, onHire));
    var sheetDays = last >= onHire ? U.diffDays(last, onHire) + 1 : 0;
    // An estimate: the rental and the standby of the actual days (the copy without the planned ones, as if the hire
    // stopped tomorrow) and of the planned days (the rest), each with its days and hours.
    var phaseRows = [];
    var split = null;
    if (mode === 'planned') {
      var aEnd = minD(s.today, last);
      var pStart = maxD(U.addDays(s.today, 1), onHire);
      var aDays = aEnd >= onHire ? U.diffDays(aEnd, onHire) + 1 : 0;
      var pDays = last >= pStart ? U.diffDays(last, pStart) + 1 : 0;
      var aHrs = hrs.filter(function (x) { return x.date <= s.today; });
      var pHrs = hrs.filter(function (x) { return x.date > s.today; });
      var aRaw = [];
      if (aDays) {
        var stop = U.addDays(s.today, 1);
        var ab = E.apply(Object.assign({}, actualSt, { today: stop }), 'offHire', { requestId: requestId, lineId: lineId, date: stop });
        if (ab.ok) aRaw = chargesOf(ab.state, requestId, lineId, stop);
      }
      var part = function (list, from, to, n) {
        var u = U.sum(list, function (x) { return x.usage; });
        var sb = U.sum(list, function (x) { return x.standby; });
        return { from: n ? from : '', to: n ? to : '', days: n, usage: u, standby: sb, rangeText: n ? range(from, to) : '' };
      };
      var ap = part(aHrs, onHire, aEnd, aDays);
      var pp = part(pHrs, pStart, last, pDays);
      ap.rental = kindSum(aRaw, 'RENTAL');
      ap.standbyAmount = kindSum(aRaw, 'STANDBY');
      pp.rental = U.r2(kindSum(raw, 'RENTAL') - ap.rental);
      pp.standbyAmount = U.r2(kindSum(raw, 'STANDBY') - ap.standbyAmount);
      var sbRate = U.r2((c.hourly ? c.hour : (c.price.day || 0) / 8) * ((c.ag && c.ag.standbyPct) || 0));
      [['actual', ap], ['planned', pp]].forEach(function (x) {
        var ph = x[0];
        var p = x[1];
        var est = ph === 'planned' ? ' (estimate)' : '';
        var lead = p.days ? p.rangeText + ' · ' : '';
        if (p.rental || (c.hourly && p.usage)) {
          phaseRows.push(phaseRow(c, 'RENTAL', ph, lead + (c.hourly ? h(p.usage) + ' h of use × ' + F.money(c.hour, c.cur) + ' an hour' + est : plural(p.days, 'day')), p.rental));
        }
        if (p.standbyAmount) phaseRows.push(phaseRow(c, 'STANDBY', ph, lead + h(p.standby) + ' h × ' + F.money(sbRate, c.cur) + standbyWords(c) + est, p.standbyAmount));
      });
      raw = raw.filter(function (x) { return !SPLIT[x.kind]; });
      var phaseText = function (p, none) {
        return p.days ? p.rangeText + ' · ' + plural(p.days, 'day') + (c.hourly || p.usage ? ' · ' + h(p.usage) + ' h of use' : '') + (p.standby ? ' · ' + h(p.standby) + ' h of standby' : '') : none;
      };
      split = {
        actual: { days: ap.days, usage: ap.usage, standby: ap.standby, text: phaseText(ap, s.today < onHire ? 'None yet: t' + startsText(c).slice(1) : 'None yet'),
          amount: U.r2(ap.rental + ap.standbyAmount), amountText: F.money(U.r2(ap.rental + ap.standbyAmount), c.cur) },
        planned: { days: pp.days, usage: pp.usage, standby: pp.standby, text: phaseText(pp, 'None'),
          amount: U.r2(pp.rental + pp.standbyAmount), amountText: F.money(U.r2(pp.rental + pp.standbyAmount), c.cur) },
        usageText: h(ap.usage) + ' h of use actual · ' + h(pp.usage) + ' h planned'
      };
    }
    var real = (s.charges || []).filter(function (x) { return x.lineId === lineId; });
    var credits = real.filter(function (x) { return x.kind === 'CREDIT'; });
    var merged = merge(raw.concat(credits));
    var periods = [];
    merged.forEach(function (x) { if (x.period && periods.indexOf(x.period) === -1) periods.push(x.period); });
    var rows = merged.map(function (x) { return rowOf(c, x, periods.length > 1); }).concat(phaseRows)
      .sort(function (p, q) { return p.order - q.order || (p.key < q.key ? -1 : 1); });
    var total = U.r2(U.sum(rows, function (x) { return x.amount; }));
    var charged = U.sum(real, function (x) { return x.amount; });
    var toCharge = U.r2(total - charged);
    var vat = null;
    if (c.l.relation === 'CUSTOMER') {
      var pct = (L.country(s, (L.le(s, c.l.providerLe) || {}).country) || {}).vat || 0;
      vat = { pct: pct, amount: U.r2(total * pct), text: 'VAT ' + Math.round(pct * 100) + ' %', amountText: F.money(U.r2(total * pct), c.cur) };
    }
    var gross = vat ? U.r2(total + vat.amount) : total;
    var notes = [];
    var waiting = (s.hours || []).filter(function (x) { return x.lineId === lineId && !x.approved && x.date <= last; });
    if (!plan && waiting.length) notes.push(plural(waiting.length, 'day') + ' of hours (' + h(U.sum(waiting, function (x) { return x.usage; })) + ' h of use) wait for approval: not counted until approved.');
    if (mode === 'sofar') {
      var later = [];
      if (c.hourly && c.price.minHours && usage < c.price.minHours) later.push('a minimum of ' + c.price.minHours + ' hours per hire');
      if (!c.hourly && c.ag && c.ag.minDays && daysOn < c.ag.minDays) later.push('a minimum hire of ' + c.ag.minDays + ' days');
      if (transport) later.push('transport back ' + F.money(transport, c.cur));
      if (later.length) notes.push('At the return: ' + names(later) + '.');
    }
    if (mode === 'planned') {
      notes.push('The planned days are an estimate (standard hours unless changed): the bill follows the hours recorded as the days pass, and the final timesheet is asked for on ' + F.date(date) + '.');
    }
    var damageNote = l1.loss ? '' : l1.inspection ? (l1.inspection.damage > 0 ? '' : 'Inspected ' + F.date(l1.inspection.date) + ': no damage.') : 'Damage, if any, is added after the yard’s inspection.';
    if (c.rental && c.r.deposit && !c.r.deposit.settled) notes.push('The deposit of ' + F.money(c.r.deposit.amount, c.cur) + ' is applied to the open invoices after the inspection, the rest refunded.');
    // By the hour the timesheet runs to the return day (its hours count); by the day the return day is not charged.
    var span = c.hourly ? 'on hire ' + range(onHire, last) + ' (' + plural(sheetDays, 'day') + ', the return day included)'
      : daysOn ? 'on hire ' + range(onHire, last) + ' (' + plural(daysOn, 'day') + ')' : 'the hire stops the day it started';
    var modeText = mode === 'final' ? 'Returned ' + F.date(date) + ': ' + span
      : mode === 'planned' ? 'Return planned for ' + F.date(date) + ': ' + span + (c.early ? ' · delivered early on ' + F.short(c.early.arrived) : '')
        : 'So far, to today (' + F.date(s.today) + '): on hire since ' + F.date(onHire) + (c.l.plannedReturn ? ' · return planned for ' + F.date(c.l.plannedReturn) : '');
    var estimate = mode === 'planned';
    return Object.assign(head, {
      started: true, error: error, mode: mode, date: date, last: last, modeText: modeText, daysOn: daysOn, sheetDays: sheetDays, rows: rows, empty: !rows.length,
      usage: usage, standby: standby, hoursDays: hrs.length, estimate: estimate, heading: estimate ? 'Estimated final bill' : 'The final bill', split: split,
      hoursText: c.hourly || hrs.length ? plural(hrs.length, 'day') + ' with hours · ' + h(usage) + ' h of use · ' + h(standby) + ' h of standby' + (plan ? '' : ' (approved)') : '',
      total: total, totalText: F.money(total, c.cur), charged: charged, chargedText: F.money(charged, c.cur), chargedNote: real.length ? plural(real.length, 'charge line') : 'nothing charged yet',
      toCharge: toCharge, toChargeText: F.money(toCharge, c.cur),
      toChargeNote: toCharge < 0 ? 'more was charged than the bill comes to: the next charge run adjusts it' : mode === 'sofar' ? 'to today, at the month end’s charge run' : 'at the next charge run' + (estimate ? ' after the return' : ''),
      vat: vat, gross: gross, grossText: F.money(gross, c.cur), grossLabel: estimate ? 'Estimated, with VAT, to the customer' : 'With VAT, to the customer',
      totalLabel: mode === 'sofar' ? 'Total so far' : estimate ? 'Estimated total for the hire' : 'Total for the hire',
      notes: notes, damageNote: damageNote
    });
  }

  // ── The Return dialog ─────────────────────────────────────────────────────────────────────────────────────────
  /**
   * The last day of the timesheet: by the hour the return day (or the return date picked), by the day the day before
   * it; days after today are planned. Without a return date that the engine takes, today.
   */
  function lastDay(s, l, date) {
    var hourly = hourlyLine(l);
    if (l.events.offHire) return hourly ? l.events.offHire : U.addDays(l.events.offHire, -1);
    if (ISO.test(date || '') && date >= l.events.onHire) return hourly ? date : U.addDays(date, -1);
    return s.today;
  }
  function valueOf(draft, kind, date, fallback) {
    var d = (draft && draft[kind]) || {};
    return Object.prototype.hasOwnProperty.call(d, date) ? String(d[date] === null || d[date] === undefined ? '' : d[date]) : fallback;
  }
  /** A row's value when nothing is typed: as recorded, or the standard hours of a planned day. */
  function fallbackOf(x, planned, weekend, kind) { return x ? String(x[kind]) : planned ? standard(weekend, kind) : ''; }

  /** The dialog's rows and words for a return date (the rows change with the date; the values typed are kept). */
  function def(s, ids, date, draft) {
    var i = ids || {};
    var c = ctx(s, i.requestId, i.lineId);
    if (!c || !c.l.events.onHire) {
      return { open: true, missing: true, requestId: i.requestId || '', lineId: i.lineId || '', kicker: '', title: 'Not here any more', sub: '', datesText: '', mode: 'return', date: '', minDate: '', rows: [],
        canApprove: false, approveLabel: '', waitText: '', weekendText: '', rangeText: '', returnedText: '', plannedText: '', basisText: '', basisShort: '', sheetTitle: 'The final timesheet',
        notYetText: '', planText: '', ruleText: '', dateNote: '', emptyText: '', hasActual: false, actualCount: 0, plannedCount: 0 };
    }
    var onHire = c.l.events.onHire;
    var returned = !!c.l.events.offHire;
    var rec = recorded(s, c.l.id);
    var end = lastDay(s, c.l, date);
    var retDate = returned ? c.l.events.offHire : (ISO.test(date || '') && date >= onHire ? date : '');
    var rows = [];
    for (var d = onHire; d <= end; d = U.addDays(d, 1)) {
      var x = rec[d];
      var we = E.isWeekend(s, c.r.country, d);
      var planned = !returned && d > s.today;
      var rday = c.hourly && d === retDate;
      rows.push({ date: d, dow: DOW[U.dow(d)], label: DOW[U.dow(d)] + ' ' + F.short(d), title: dayName(d) + (rday ? ' (the return day)' : '') + (we ? ' (weekend)' : '') + (planned ? ', planned' : ''),
        weekend: we, planned: planned, returnDay: rday, recorded: !!x, approved: !!(x && x.approved),
        usage: valueOf(draft, 'usage', d, fallbackOf(x, planned, we, 'usage')), standby: valueOf(draft, 'standby', d, fallbackOf(x, planned, we, 'standby')), uid: 'stRetU-' + d, sid: 'stRetS-' + d,
        cls: 'nx-row fx-sheet-row' + (we ? ' fx-sheet-row--we' : '') + (planned ? ' fx-sheet-row--planned' : '') + (rday ? ' fx-sheet-row--return' : '') });
    }
    var nPlanned = rows.filter(function (r) { return r.planned; }).length;
    var nActual = rows.length - nPlanned;
    var cty = L.country(s, c.r.country);
    var appr = people(c.r.requestingBu, ['requester', 'receiver-review']);
    var bs = basis(c);
    var notYet = !returned && s.today < onHire;
    return {
      open: true, missing: false, requestId: c.r.id, lineId: c.l.id, number: c.r.number, serial: c.serial, mode: returned ? 'timesheet' : 'return', rental: c.rental, hourly: c.hourly,
      kicker: 'On site · ' + c.serial + ' · ' + (c.rental ? c.custName + ' (customer rental)' : c.party),
      title: returned ? 'The final timesheet of ' + c.serial : 'Return ' + c.serial,
      sub: c.r.number + ' · ' + c.r.site + ' · ' + bs.short.toLowerCase(),
      datesText: datesText(s, c), early: !!c.early,
      date: returned ? c.l.events.offHire : (date || ''), minDate: onHire, today: s.today, onHire: onHire, from: c.from, to: c.to,
      dateNote: (c.to && c.to > s.today ? 'The request’s end (' + F.date(c.to) + ') unless you pick another day' : 'Today unless you pick another day')
        + '; not before the hire’s start (' + F.date(onHire) + '). A day after today books the return.',
      returnedText: returned ? 'Returned on ' + F.date(c.l.events.offHire) + ': the hire stopped that day. The timesheet runs to ' + F.date(lastDay(s, c.l, '')) + (c.hourly ? ', the return day included.' : '.') : '',
      plannedText: !returned && c.l.plannedReturn ? 'Return planned for ' + F.date(c.l.plannedReturn) + ': pick another date to move it, or today to return it now.' : '',
      rows: rows, actualCount: nActual, plannedCount: nPlanned, hasActual: nActual > 0,
      sheetTitle: nPlanned ? 'The timesheet: actual, then planned' : 'The final timesheet',
      rangeText: rows.length ? range(rows[0].date, rows[rows.length - 1].date) + ' · ' + plural(rows.length, 'day') + (nPlanned ? ' (' + (nActual ? nActual + ' actual, ' : '') + nPlanned + ' planned)' : '') : 'No day to record',
      weekendText: 'Weekend in ' + (cty ? cty.name : c.r.country) + ': ' + (cty ? cty.weekend.map(function (k) { return DOW[k]; }).join('–') : ''),
      ruleText: c.hourly ? 'By the hour, the return day counts: its hours are on the timesheet.' : 'By the day, the return day is not charged: the timesheet stops the day before.',
      notYetText: notYet ? startsText(c) + ': no day to record yet.' : '',
      planText: nPlanned ? 'Days after today (' + F.date(s.today) + ') are planned: standard hours, 8 h of use on each working day and the weekend empty, an estimate you can change. They are not saved: record the hours as the days pass.' : '',
      emptyText: notYet ? '' : 'No day to record: the hire stops the day it started.',
      canApprove: mayApprove(s, c.r),
      approveLabel: (nPlanned ? (nActual ? 'The hours up to today are agreed (' : 'The hours are agreed when the return is closed (') : 'These hours are agreed (') + (c.rental ? 'signed by the customer, ' + c.custName : 'approved by the project, ' + c.party) + ')',
      waitText: 'They wait for the approval of ' + (appr.length ? names(appr, 'or') : 'the requester') + '; the bill counts them once approved.',
      basisText: bs.text, basisShort: bs.short, basisTone: bs.tone
    };
  }

  /** The dialog for a line: the request's end as the return date when that is after today (else today, or the planned
   *  return when one is booked), never before the hire's start; the rows prefilled. */
  function open(s, ids) {
    var i = ids || {};
    var c = ctx(s, i.requestId, i.lineId);
    var date = '';
    if (c && c.l.events.offHire) date = c.l.events.offHire;
    else if (c) {
      date = c.l.plannedReturn || (c.to && c.to > s.today ? c.to : s.today);
      if (c.l.events.onHire && date < c.l.events.onHire) date = c.l.events.onHire;
    }
    var draft = { date: date, usage: {}, standby: {}, approve: false };
    return { def: def(s, i, date, draft), draft: draft };
  }

  /** Each row's values: typed, as recorded, or (a planned day) the standard hours. */
  function sheet(s, dv, draft) {
    var rec = recorded(s, dv.lineId);
    return (dv.rows || []).map(function (row) {
      var x = rec[row.date];
      var planned = dv.mode !== 'timesheet' && row.date > s.today;
      var us = valueOf(draft, 'usage', row.date, fallbackOf(x, planned, row.weekend, 'usage'));
      var sb = valueOf(draft, 'standby', row.date, fallbackOf(x, planned, row.weekend, 'standby'));
      var u = numOf(us);
      var b = numOf(sb);
      var bad = (!blank(us) && !isFinite(parseFloat(us))) || (!blank(sb) && !isFinite(parseFloat(sb))) || u < 0 || b < 0 || u + b > 24;
      var changed = x ? (u !== x.usage || b !== x.standby) : (u > 0 || b > 0);
      return { date: row.date, weekend: row.weekend, planned: planned, returnDay: !!row.returnDay, rec: x || null, us: us, sb: sb, usage: u, standby: b, bad: bad, changed: changed,
        empty: blank(us) && blank(sb) && !x };
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
  function sums(list) {
    var ok = list.filter(function (x) { return !x.bad; });
    return { usage: U.sum(ok, function (x) { return x.usage; }), standby: U.sum(ok, function (x) { return x.standby; }), withHours: ok.filter(function (x) { return x.usage + x.standby > 0; }).length };
  }

  /**
   * What Confirm does, from the dialog's rows and what is typed: the payloads (logHoursBulk with the actual days
   * changed, approved when ticked and allowed; offHire with the date, unless already returned or already booked for
   * it), a dry run as the person played (its refusal in the engine's words), who is told, the final bill (estimated
   * with the planned days for a later date) and the toast. The planned days are never sent.
   */
  function preview(s, dv, draft) {
    var d = draft || {};
    var c = dv && !dv.missing ? ctx(s, dv.requestId, dv.lineId) : null;
    if (!c || !c.l.events.onHire) {
      return { ok: false, warn: 'This line is not here any more.', bulk: null, offHire: null, states: {}, bill: null, told: [], does: [], confirm: 'Confirm', tone: 'primary', toast: '',
        whenText: '', sheetText: '', droppedText: '', canFill: false, planned: false };
    }
    var onHire = c.l.events.onHire;
    var returned = !!c.l.events.offHire;
    var date = returned ? c.l.events.offHire : String(d.date || '');
    var dateOk = returned || (ISO.test(date) && date >= onHire);
    var planned = !returned && dateOk && date > s.today;
    var last = dateOk ? sheetEnd(c, date) : s.today;
    var rows = sheet(s, dv, d);
    // The rows shown must be the ones for this date (the chain rebuilds them when the date changes).
    var inRange = rows.filter(function (x) { return x.date <= last; });
    var actual = inRange.filter(function (x) { return !x.planned; });
    var ahead = inRange.filter(function (x) { return x.planned; });
    var bad = inRange.filter(function (x) { return x.bad; });
    // Only the actual days that change go: an unchanged day keeps its approval; the planned ones are an estimate.
    var days = actual.filter(function (x) { return x.changed && !x.bad; }).map(function (x) { return { date: x.date, usage: x.usage, standby: x.standby }; });
    var est = ahead.filter(function (x) { return !x.bad && x.usage + x.standby > 0; }).map(function (x) { return { date: x.date, usage: x.usage, standby: x.standby }; });
    var waiting = (s.hours || []).filter(function (x) { return x.lineId === c.l.id && !x.approved && x.date <= last; });
    var approve = !!d.approve && dv.canApprove && actual.length > 0;
    // Closing the return now makes every day actual: the tick then agrees them all (the planned days too).
    var approveAll = !!d.approve && dv.canApprove;
    var bulk = days.length || (approve && waiting.length) ? { requestId: c.r.id, lineId: c.l.id, days: days, approve: approve } : null;
    if (bulk && !returned) bulk.until = date;
    var kept = planned && c.l.plannedReturn === date;
    var off = returned || kept ? null : { requestId: c.r.id, lineId: c.l.id, date: date };
    var warn = '';
    if (!returned && !ISO.test(date)) warn = 'Give the return date.';
    else if (!returned && date < onHire) warn = 'The return date cannot be before the hire started (' + F.date(onHire) + ').';
    else if (bad.length) warn = dayName(bad[0].date) + ': give hours from 0 to 24, use and standby together at most 24.';
    var st = s;
    if (!warn && bulk) { var a = E.apply(st, 'logHoursBulk', bulk); if (a.ok) st = a.state; else warn = a.error; }
    if (!warn && off) { var b = E.apply(st, 'offHire', off); if (b.ok) st = b.state; else warn = b.error; }
    if (!warn && returned && !bulk) warn = 'Nothing to send yet: record the days, or tick that the hours are agreed.';
    if (!warn && kept && !bulk) warn = 'The return is booked for ' + F.date(date) + ' already: record the days up to today, or pick another date.';
    // Each row's state, as the person sees it.
    var states = {};
    rows.forEach(function (x) {
      var empty = !x.rec && x.usage + x.standby === 0;
      states[x.date] = x.bad ? { text: 'Check', tone: 'bad' } : x.planned ? { text: 'Planned', tone: 'planned' } : empty ? { text: x.weekend ? 'Weekend' : '—', tone: 'na' }
        : x.changed ? { text: x.rec ? 'Changed' : 'New', tone: approve ? 'ok' : 'run' }
          : x.rec.approved ? { text: 'Approved', tone: 'ok' } : approve ? { text: 'Agreed', tone: 'ok' } : { text: 'Waiting', tone: 'todo' };
    });
    var sa = sums(actual);
    var sp = sums(ahead);
    var all = sums(inRange);
    var emptyWork = inRange.filter(function (x) { return x.empty && !x.weekend; }).length;
    var dropped = !returned && dateOk && !planned ? (s.hours || []).filter(function (x) { return x.lineId === c.l.id && x.date > last; }).map(function (x) { return x.date; }).sort() : [];
    var bl = dateOk ? bill(s, c.r.id, c.l.id, { date: date, days: days, planned: est }) : null;
    var daysOn = dateOk ? Math.max(0, U.diffDays(date, onHire)) : 0;
    var sheetDays = dateOk && last >= onHire ? U.diffDays(last, onHire) + 1 : 0;
    var yd = people(c.l.provider, ['yard']);
    var until = 'Until then, record the hours as the days pass; the final timesheet is asked for on the day.';
    var whenText = returned ? dv.returnedText
      : !dateOk ? (ISO.test(date) ? 'The return date cannot be before the hire started (' + F.date(onHire) + ').' : 'Give the return date.')
        : planned ? 'Planned return: the hire stops by itself on ' + F.date(date) + '. ' + until
          : (date === s.today ? 'Returned today' : 'Returned on ' + dayName(date)) + ': the hire stops that day'
            + (c.hourly ? '; by the hour, the hours of the return day count too.' : daysOn ? ', charged up to ' + F.date(U.addDays(date, -1)) + '.' : ', nothing charged for its days (it started that day).');
    var does = [];
    if (dateOk && !returned) {
      does.push(kept ? 'Keeps the return of ' + c.serial + ' booked for ' + F.date(date) + ': on that day the hire stops by itself.'
        : planned ? 'Books the return of ' + c.serial + ' for ' + F.date(date) + ': on that day the hire stops by itself, and ' + (c.rental ? 'the rental desk' : 'the site') + ' is asked for the final timesheet.'
          : 'Stops the hire of ' + c.serial + ' on ' + F.date(date) + (dropped.length ? '; ' + plural(dropped.length, 'day') + ' of hours recorded ' + (c.hourly ? 'after it' : 'from then on') + ' ' + (dropped.length === 1 ? 'is' : 'are') + ' dropped' : '') + '.');
      if (!kept) does.push(poss(L.buName(s, c.l.provider)) + ' yard' + (yd.length ? ' (' + names(yd) + ')' : '') + (planned ? ' is told when it comes back.' : ' is told to collect it.'));
    }
    var agreed = c.rental ? 'signed by the customer' : 'approved by the project';
    if (days.length) {
      does.push('Records ' + plural(days.length, 'day') + ' of the timesheet' + (approve ? ' and agrees every day of it (' + agreed + ').'
        : dv.canApprove ? '; they wait for approval (tick that they are agreed to approve them now).' : '; ' + dv.waitText.charAt(0).toLowerCase() + dv.waitText.slice(1)));
    } else if (approve && waiting.length) {
      does.push('Agrees the ' + plural(waiting.length, 'day') + ' of hours waiting (' + agreed + ').');
    }
    if (planned && ahead.length) does.push('The ' + plural(ahead.length, 'planned day') + ' (' + range(ahead[0].date, ahead[ahead.length - 1].date) + ') are an estimate for the bill: not saved.');
    var billText = bl && bl.started && !bl.error ? F.money(bl.total, c.cur) + (bl.vat ? ' + ' + bl.vat.text + ' ' + bl.vat.amountText : '') : '';
    var dayWords = c.hourly ? plural(sheetDays, 'day') + ' with the return day' : plural(daysOn, 'day');
    var toast = !dateOk ? '' : returned ? 'The final timesheet of ' + c.serial + ': ' + plural(all.withHours, 'day') + ', ' + h(all.usage) + ' h of use' + (approve ? ', agreed' : ', waiting for approval') + (billText ? '; final bill ' + billText : '') + '.'
      : planned ? 'Return booked for ' + F.date(date) + ' (' + c.serial + (days.length ? ', ' + plural(days.length, 'day') + ' of hours recorded' + (approve ? ' and agreed' : '') : approve && waiting.length ? ', the hours agreed' : '') + '). ' + until
        : c.serial + ' returned on ' + F.date(date) + ': ' + dayWords + ', ' + h(all.usage) + ' h of use' + (billText ? ', final bill ' + billText : '') + '.';
    var line = function (p, n) { return plural(p.withHours, 'day') + ' with hours · ' + h(p.usage) + ' h of use · ' + h(p.standby) + ' h of standby' + (n ? ' · ' + plural(n, 'working day') + ' empty' : ''); };
    var emptyActual = actual.filter(function (x) { return x.empty && !x.weekend; }).length;
    var emptyAhead = ahead.filter(function (x) { return x.empty && !x.weekend; }).length;
    return {
      ok: !warn, warn: warn, planned: planned, returned: returned, dateOk: dateOk, date: date, last: last, whenText: whenText, does: does, told: warn ? [] : toldRows(s, st),
      bulk: bulk, offHire: off, states: states, bill: bl, planDays: ahead.length, actualDays: actual.length,
      sheetText: ahead.length ? 'Actual: ' + (actual.length ? line(sa, emptyActual) : 'none yet') + ' — Planned: ' + line(sp, emptyAhead) + ' (an estimate)' : line(all, emptyWork),
      canFill: emptyWork > 0,
      droppedText: dropped.length ? 'Hours recorded on ' + names(dropped.map(function (x) { return F.short(x); })) + ' are dropped: the hire stops on ' + F.date(date)
        + (c.hourly ? ' (its hours count, not the days after).' : ' (the return day is not charged).') : '',
      confirm: returned ? 'Send the final timesheet' : !dateOk ? 'Close the return' : planned ? (kept ? 'Record the hours, keep the return on ' + F.date(date) : 'Book a future return for ' + F.date(date)) : 'Close the return on ' + F.date(date),
      tone: planned ? 'secondary' : 'ok', toast: toast,
      // A later date, returned now: the clock moves to it and the whole timesheet (actual and planned) is recorded.
      now: planned && dateOk && !returned && !warn ? { requestId: c.r.id, lineId: c.l.id, date: date, approve: approveAll,
        days: inRange.filter(function (x) { return !x.bad && x.usage + x.standby > 0; }).map(function (x) { return { date: x.date, usage: x.usage, standby: x.standby }; }) } : null,
      nowLabel: planned && dateOk ? 'Close the return on ' + F.date(date) : '',
      nowText: planned && dateOk ? 'Book a future return: the hire stops by itself on ' + F.date(date) + '. Close the return: done now, on ' + F.date(date) + '; it moves the demo clock from ' + F.date(s.today) + ' to ' + F.date(date) + ' (the days between pass for everyone), records the whole timesheet ('
        + h(all.usage) + ' h of use) as actual' + (approveAll ? ' and agreed (' + agreed + ')' : dv.canApprove ? ', waiting for approval (tick that they are agreed for the final bill to count them)' : ', waiting for approval') + ', and stops the hire on ' + F.date(date) + '.' : '',
      nowToast: planned && dateOk ? c.serial + ' returned on ' + F.date(date) + ' (the demo clock is now on ' + F.date(date) + '): ' + h(all.usage) + ' h of use' + (approveAll ? ', agreed' + (billText ? ', final bill ' + billText : '') : ', waiting for approval: the final bill counts them once agreed') + '.' : ''
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
    words: words, mayApprove: mayApprove, lastDay: lastDay, datesText: function (s, rid, lid) { var c = ctx(s, rid, lid); return c && c.l.events.onHire ? datesText(s, c) : ''; } };
});
