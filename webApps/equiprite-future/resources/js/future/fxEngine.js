define(['resources/js/future/fxSeed'], function (Seed) {
  'use strict';

  /**
   * EquipRite Future: the simulated backend (FDD v2.0). Pure functions on a plain state object; the store
   * (fxStore.js) keeps the state and calls apply(). Nothing here talks to Fusion: the Fusion transactions EquipRite
   * would create (intercompany AR and AP, project cost, customer invoices, transfer orders, netting) are recorded as
   * `tx` with the accounting Fusion would make for them, shown and never posted (FDD v2.0 GR-1..7).
   *
   * apply(state, type, payload) → { ok, state, error, result }: a new state (the input is never changed).
   */

  // ── Small helpers ──────────────────────────────────────────────────────────────────────────────────────────────
  var DAY = 86400000;
  function d(iso) { var p = String(iso).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(s, n) { return iso(d(s) + n * DAY); }
  function diffDays(a, b) { return Math.round((d(a) - d(b)) / DAY); }
  function dow(s) { return new Date(d(s)).getUTCDay(); }
  function monthOf(s) { return String(s).slice(0, 7); }
  function monthStart(p) { return p + '-01'; }
  function monthEnd(p) { var y = +p.slice(0, 4); var m = +p.slice(5, 7); return iso(Date.UTC(y, m, 0)); }
  function nextMonth(p) { var y = +p.slice(0, 4); var m = +p.slice(5, 7); return m === 12 ? (y + 1) + '-01' : y + '-' + (m < 9 ? '0' : '') + (m + 1); }
  function maxS(a, b) { return a > b ? a : b; }
  function minS(a, b) { return a < b ? a : b; }
  function r2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function byId(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function hd(x) { if (!x) return ''; var q = String(x).split('-'); return (+q[2]) + ' ' + MON[+q[1] - 1] + ' ' + q[0]; }
  function mny(n, cur) { var v = r2(n); return (cur ? cur + ' ' : '') + (v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function sum(list, f) { return r2((list || []).reduce(function (a, x) { return a + (f ? f(x) : x); }, 0)); }

  // ── Lookups ────────────────────────────────────────────────────────────────────────────────────────────────────
  function persona(s, id) { return byId(Seed.PERSONAS, id || s.personaId) || Seed.PERSONAS[0]; }
  function bu(s, id) { return byId(s.bus, id); }
  function le(s, id) { return byId(s.companies, id); }
  function leOf(s, buId) { var b = bu(s, buId); return b ? le(s, b.le) : null; }
  function country(s, code) { return byId(s.countries.map(function (c) { return Object.assign({ id: c.code }, c); }), code); }
  function unitOf(s, id) { return byId(s.units, id); }
  function project(s, id) { return byId(s.projects, id); }
  function customer(s, id) { return byId(s.customers, id); }
  function agreement(s, id) { return byId(s.agreements, id); }
  function requestOf(s, id) { return byId(s.requests, id); }
  function lineOf(s, rid, lid) { var r = requestOf(s, rid); return r ? byId(r.lines, lid) : null; }
  function buName(s, id) { var b = bu(s, id); return b ? b.name : id; }
  function leShort(s, id) { var c = le(s, id); return c ? c.short : id; }
  function can(p, role) { return p.roles.indexOf('admin') !== -1 || p.roles.indexOf(role) !== -1; }
  function inBu(p, buId) { return p.roles.indexOf('admin') !== -1 || p.bus.indexOf(buId) !== -1; }

  // Exchange rates: to the group currency, with a small deterministic daily drift (example only).
  function toGroup(s, cur, date) {
    var base = (s.fx.base || {})[cur];
    if (base == null) return 1;
    if (cur === s.settings.groupCurrency) return 1;
    var k = Math.round(d(date || s.today) / DAY);
    var wave = (((k * 7) % 11) - 5) / 5;
    return base * (1 + s.fx.drift * wave);
  }
  function rate(s, from, to, date) { return from === to ? 1 : toGroup(s, from, date) / toGroup(s, to, date); }

  // ── Relationships, prices, availability (MC-FR-04, 07, 11, 12, 18) ─────────────────────────────────────────────
  function relationType(s, providerBu, requesterBu, isCustomerRental) {
    if (isCustomerRental) return 'CUSTOMER';
    if (providerBu === requesterBu) return 'SAME_BU';
    var a = leOf(s, providerBu);
    var b = leOf(s, requesterBu);
    if (!a || !b) return '';
    if (a.id === b.id) return 'SAME_LE';
    return a.country === b.country ? 'IC_DOMESTIC' : 'IC_CROSS_BORDER';
  }
  function relationRow(s, provider, receiver) {
    return (s.icRelations || []).filter(function (r) { return r.provider === provider && r.receiver === receiver; })[0] || null;
  }
  function agreementFor(s, provider, receiver, customerId) {
    return (s.agreements || []).filter(function (a) {
      return a.status === 'ACTIVE' && a.provider === provider && (customerId ? a.customer === customerId : a.receiver === receiver);
    })[0] || null;
  }
  // Own equipment (SAME_BU): an internal cost rate from the asset's depreciation (cost to the project, no invoice).
  function ownRate(u) {
    var dep = (u.asset && u.asset.depMonthly) || 300;
    var day = r2(dep / 26);
    return { day: day, week: r2(day * 5) };
  }
  function priceFor(s, u, rel, ag) {
    if (rel === 'SAME_BU') return { day: ownRate(u).day, week: ownRate(u).week, currency: leOf(s, u.owner).currency, basis: 'Own equipment: internal cost rate' };
    var r = ag && ag.rates && ag.rates[u.cls];
    if (!r) return null;
    return { day: r.day, week: r.week, currency: ag.currency, basis: (ag.kind === 'CUSTOMER' ? 'Customer agreement ' : ag.kind === 'CROSS_CHARGE' ? 'Cross-charge rates ' : 'Intercompany agreement ') + ag.number + ' v' + ag.version };
  }
  function rental(days, r) {
    if (!r || days <= 0) return 0;
    var weeks = Math.floor(days / 7);
    var rem = days % 7;
    return r2(weeks * r.week + Math.min(rem * r.day, r.week));
  }
  var ACTIVE = { REQUESTED: 1, APPROVED: 1, SHIPPED: 1, ON_HIRE: 1, OFF_HIRED: 1 };
  function busy(s, unitId, from, to, ignoreLine) {
    var hit = null;
    (s.requests || []).forEach(function (r) {
      (r.lines || []).forEach(function (l) {
        if (hit || l.id === ignoreLine || l.unitId !== unitId || !ACTIVE[l.status] || l.status === 'REQUESTED') return;
        var end = l.events.returned || (l.status === 'OFF_HIRED' || l.status === 'SHIPPED' || l.status === 'ON_HIRE' ? maxS(r.to, s.today) : r.to);
        if (from <= end && to >= r.from) hit = { request: r.number, from: r.from, to: end };
      });
    });
    return hit;
  }
  function certCheck(s, u, countryCode, to) {
    var c = (u.certs || []).filter(function (x) { return x.country === countryCode; });
    if (!c.length) return { ok: false, text: 'No certificate for ' + country(s, countryCode).name };
    var bad = c.filter(function (x) { return x.expiry < to; })[0];
    if (bad) return { ok: false, text: bad.type + ' (' + countryCode + ') expires ' + hd(bad.expiry) + ', before the hire ends' };
    return { ok: true, text: c.map(function (x) { return x.type + ' to ' + hd(x.expiry); }).join('; ') };
  }

  /**
   * MC-FR-11: what the requesting BU can use for a class and window: its own fleet first, then the owners the IC
   * matrix allows, each unit with owner, relationship, country, lead time, price and an estimate in the requester's
   * currency; for a customer rental, the owner's own fleet at the customer agreement's rates.
   */
  function sourcing(s, q) {
    var reqBu = q.requestingBu;
    var reqLe = leOf(s, reqBu);
    var siteCountry = q.country || (reqLe && reqLe.country);
    var providers = [{ bu: reqBu, priority: 0, leadDays: 0, allowed: true }];
    if (!q.customerId) {
      (s.icRelations || []).forEach(function (r) { if (r.receiver === reqBu && r.allowed) providers.push({ bu: r.provider, priority: r.priority, leadDays: r.leadDays, allowed: true }); });
    }
    var out = [];
    providers.forEach(function (pv) {
      (s.units || []).filter(function (u) { return u.owner === pv.bu && (!q.cls || u.cls === q.cls) && u.status !== 'LOST'; }).forEach(function (u) {
        var rel = relationType(s, pv.bu, reqBu, !!q.customerId);
        var ag = rel === 'SAME_BU' ? null : agreementFor(s, pv.bu, reqBu, q.customerId);
        var price = priceFor(s, u, rel, ag);
        var b = q.from && q.to ? busy(s, u.id, q.from, q.to) : null;
        var cert = certCheck(s, u, siteCountry, q.to || s.today);
        var lec = reqLe ? reqLe.currency : 'AED';
        var est = price ? r2(rental(q.from && q.to ? diffDays(q.to, q.from) + 1 : 7, price) * rate(s, price.currency, lec, s.today)) : 0;
        out.push({
          unitId: u.id, serial: u.serial, name: u.name, cls: u.cls, hold: u.hold, owner: pv.bu, ownerName: buName(s, pv.bu), ownerLe: leOf(s, pv.bu).id,
          ownerShort: leOf(s, pv.bu).short, relation: rel, priority: pv.priority, leadDays: pv.leadDays, country: u.country,
          agreementId: ag ? ag.id : '', price: price, estimate: est, estimateCurrency: lec, estimateNote: price && price.currency !== lec ? 'estimate at today\'s rate' : '',
          free: !b, busyWith: b, certOk: cert.ok, certText: cert.text, unitStatus: u.status,
          usable: !b && cert.ok && !!price && ['IN_REPAIR', 'INSPECTION'].indexOf(u.status) === -1,
          why: b ? 'Booked on ' + b.request + ' until ' + hd(b.to) : u.status === 'IN_REPAIR' ? 'In repair at the yard' : u.status === 'INSPECTION' ? 'Back at the yard, waiting for its inspection'
            : !price ? 'No agreed price for this class with ' + buName(s, pv.bu) : !cert.ok ? cert.text : 'Free · ' + cert.text
        });
      });
    });
    out.sort(function (a, b) { return (b.usable - a.usable) || (a.priority - b.priority) || a.serial.localeCompare(b.serial); });
    return out;
  }

  // ── Notifications, log, numbering ─────────────────────────────────────────────────────────────────────────────
  function next(s, k) { s.seq[k] = (s.seq[k] || 0) + 1; return s.seq[k]; }
  function notify(s, to, text, link, kind) {
    s.notifications.unshift({ id: 'N' + next(s, 'note'), at: s.today, to: to, text: text, link: link || null, kind: kind || 'info', readBy: [] });
  }
  function log(s, p, what, refs) {
    s.log.unshift({ id: 'L' + next(s, 'log'), at: s.today, who: p.name, whoTitle: p.title, what: what, refs: refs || {} });
  }

  // ── Fusion transactions and their accounting (shown, never posted) ────────────────────────────────────────────
  var SOURCE = {
    TO_SHIP: 'Fusion Inventory: transfer order shipped (INT-04/05/06)', TO_RECEIPT: 'Fusion Inventory: transfer order received', TO_RETURN: 'Fusion Inventory: return transfer order',
    ASSET_CUSTODY: 'Fusion Assets / Maintenance: location updated (INT-23)', IC_AR: 'Fusion Receivables: intercompany invoice (INT-10)',
    IC_AP: 'Fusion Payables: intercompany invoice, project-coded (INT-10)', PROJECT_COST: 'Fusion PPM: supplier cost imported from Payables',
    ACCRUAL: 'Fusion GL: intercompany accrual (INT-24)', ACCRUAL_REVERSAL: 'Fusion GL: accrual reversed', CROSS_CHARGE: 'Fusion PPM: cross-charge (borrowed and lent)',
    OWN_COST: 'Fusion PPM: own equipment cost (INT-08)', CUSTOMER_AR: 'Fusion Receivables: customer invoice (INT-11)', PROJECT_BILL: 'Fusion PPM Billing → Receivables',
    CUSTOMER_RECEIPT: 'Fusion Receivables: receipt', DEPOSIT: 'Fusion Receivables: deposit received', DEPOSIT_SETTLE: 'Fusion Receivables: deposit applied and refunded',
    NETTING: 'Fusion Payables / Receivables: netting settlement (INT-25)', ASSET_RETIRE: 'Fusion Assets: retirement', STOCK_ISSUE: 'Fusion Inventory: issued (lost)'
  };
  function txNumber(s, leId, kind) {
    var pre = { 'LE-FC': 'FC', 'LE-PC': 'PC', 'LE-PK': 'PK' }[leId] || 'XX';
    var k = { IC_AR: 'AR', CUSTOMER_AR: 'AR', PROJECT_BILL: 'AR', IC_AP: 'AP', TO_SHIP: 'TO', TO_RETURN: 'TO', TO_RECEIPT: 'RCV', NETTING: 'NET' }[kind] || 'JE';
    return pre + '-' + k + '-' + pad(next(s, 'tx'), 6);
  }
  function addTx(s, o) {
    var c = le(s, o.le);
    var t = Object.assign({ date: s.today, currency: c.currency, status: 'CREATED', source: SOURCE[o.kind] || '', refs: {}, lines: [] }, o);
    t.id = 'T' + pad(next(s, 'txid'), 5);
    t.number = o.number || txNumber(s, o.le, o.kind);
    t.lines = (t.lines || []).filter(function (l) { return r2(l.dr) !== 0 || r2(l.cr) !== 0; }).map(function (l) {
      return { account: l.account, name: Seed.ACCOUNTS[l.account] + (l.sub ? ' · ' + l.sub : ''), dr: r2(l.dr), cr: r2(l.cr), memo: l.memo || '' };
    });
    t.total = sum(t.lines, function (l) { return l.dr; });
    s.tx.push(t);
    return t;
  }
  function vatOf(s, leId) { var c = le(s, leId); return country(s, c.country).vat; }

  // ── Actions ────────────────────────────────────────────────────────────────────────────────────────────────────
  var A = {};
  function fail(text) { var e = new Error(text); e.user = true; throw e; }

  A.setPersona = { run: function (s, p, x) { if (!byId(Seed.PERSONAS, x.id)) fail('No such person.'); s.personaId = x.id; } };

  A.advance = {
    run: function (s, p, x) {
      var days = Math.max(1, Math.min(120, Number(x.days) || 1));
      for (var i = 0; i < days; i++) { s.today = addDays(s.today, 1); daily(s); }
      log(s, p, 'Moved the demo clock to ' + hd(s.today));
    }
  };
  A.toMonthEnd = {
    run: function (s, p) {
      var end = monthEnd(monthOf(s.today));
      if (end === s.today) end = monthEnd(nextMonth(monthOf(s.today)));
      while (s.today < end) { s.today = addDays(s.today, 1); daily(s); }
      log(s, p, 'Moved the demo clock to the month end, ' + hd(s.today));
    }
  };

  /** Things that happen by themselves as days pass: silence accepts a statement, the IC cut-off accrues, alerts. */
  function daily(s) {
    var sys = { name: 'EquipRite', title: 'the system' };
    (s.statements || []).forEach(function (st) {
      if (st.status === 'RELEASED' && st.dueBy && s.today > st.dueBy) {
        var held = s.charges.filter(function (c) { return c.statementId === st.id && c.needsAcceptance && c.status !== 'ACCEPTED'; });
        s.charges.forEach(function (c) { if (c.statementId === st.id && c.status === 'IN_STATEMENT' && !c.needsAcceptance) c.status = 'ACCEPTED'; });
        st.status = held.length ? 'PARTLY_AGREED' : 'AGREED';
        st.agreedAt = s.today;
        st.agreedBy = 'No answer in ' + s.settings.disputeDays + ' days: accepted (MC-FR-23)';
        log(s, sys, 'Statement ' + st.number + ' accepted by silence', { statementId: st.id });
        notify(s, { bu: st.provider, roles: ['ic-finance', 'owner-finance'] }, 'Statement ' + st.number + ' agreed: create the invoice pair.', { navId: 'ic-workbench' }, 'action');
      }
    });
    // The IC cut-off (OD-06): day N of the next month; whatever is not invoiced for the period is accrued in both ledgers.
    var day = +s.today.slice(8, 10);
    if (day === s.settings.cutoffDay) {
      var prev = monthOf(addDays(monthStart(monthOf(s.today)), -1));
      (s.statements || []).filter(function (st) { return st.period === prev && !st.accrued && ['DRAFT', 'RELEASED', 'AGREED', 'PARTLY_AGREED', 'DISPUTED', 'FAILED'].indexOf(st.status) !== -1; })
        .forEach(function (st) { accrue(s, sys, st); });
    }
    // Customs (MC-FR-17) and certificates (MC-FR-18): alerts at 30, 14 and 7 days.
    (s.customs || []).filter(function (c) { return c.status === 'OPEN'; }).forEach(function (c) {
      var left = diffDays(c.reexportBy, s.today);
      [30, 14, 7].forEach(function (t) {
        if (left === t) notify(s, { bu: c.owner, roles: ['owner-em', 'yard', 'ic-finance'] }, 'Temporary import ' + c.permit + ' for ' + c.serial + ' ends in ' + t + ' days (' + hd(c.reexportBy) + '): extend, re-export or regularise.', { navId: 'reports' }, 'warning');
      });
    });
    (s.units || []).filter(function (u) { return u.custody.kind === 'site' || u.custody.kind === 'customer'; }).forEach(function (u) {
      (u.certs || []).filter(function (ct) { return ct.country === u.country; }).forEach(function (ct) {
        var left = diffDays(ct.expiry, s.today);
        if (left === 14 || left === 0) notify(s, { bu: u.owner, roles: ['owner-em'] }, u.serial + ': ' + ct.type + ' (' + ct.country + ') ' + (left ? 'expires in 14 days' : 'expires today') + ' while on site.', { navId: 'reports' }, 'warning');
      });
    });
    if (s.today === monthEnd(monthOf(s.today))) notify(s, { roles: ['ic-finance'] }, 'Month end ' + monthOf(s.today) + ': run the charges.', { navId: 'charges' }, 'action');
  }

  A.createRequest = {
    who: ['requester', 'desk'],
    run: function (s, p, x) {
      var reqBu = x.requestingBu;
      if (!reqBu || !inBu(p, reqBu)) fail('You can raise requests only for your own business units.');
      var rental = !!x.customerId;
      var prj = rental ? null : project(s, x.projectId);
      if (!rental && (!prj || prj.bu !== reqBu)) fail('Choose one of ' + buName(s, reqBu) + '\'s projects (MC-FR-10).');
      var cust = rental ? customer(s, x.customerId) : null;
      if (rental) {
        if (!cust || cust.of !== leOf(s, reqBu).id) fail('Choose one of ' + leShort(s, leOf(s, reqBu).id) + '\'s customers.');
        if (cust.onHold) {
          notify(s, { bu: reqBu, roles: ['desk', 'owner-finance'] }, cust.name + ' is on credit hold: the request cannot go on.', null, 'warning');
          fail(cust.name + ' is on credit hold in Fusion Receivables (INT-26): no new rentals until finance releases it.');
        }
      }
      if (!x.from || !x.to || x.to < x.from) fail('Give the dates the equipment is needed, from and to.');
      if (x.from < s.today) fail('The start cannot be in the past (today is ' + hd(s.today) + ').');
      if (!(x.lines || []).length) fail('Add at least one piece of equipment.');
      var siteCountry = rental ? cust.country : prj.country;
      var id = 'R' + next(s, 'request');
      var r = {
        id: id, number: 'FR-' + s.seq.request, requestingBu: reqBu, requestingLe: leOf(s, reqBu).id,
        type: rental ? 'CUSTOMER_RENTAL' : (prj.type === 'contract' ? 'CUSTOMER_PROJECT' : 'INTERNAL'),
        projectId: prj ? prj.id : '', task: x.task || (prj ? prj.tasks[0] : ''), customerId: rental ? cust.id : (prj && prj.customer) || '',
        site: x.site || (prj ? prj.site : 'Customer site'), country: siteCountry, from: x.from, to: x.to, note: x.note || '',
        createdBy: p.name, createdAt: s.today, status: 'SUBMITTED', deposit: null, lines: []
      };
      (x.lines || []).forEach(function (ln) {
        var opts = sourcing(s, { requestingBu: reqBu, cls: ln.cls, from: x.from, to: x.to, country: siteCountry, customerId: rental ? cust.id : '' });
        var o = ln.unitId ? opts.filter(function (q) { return q.unitId === ln.unitId; })[0] : opts.filter(function (q) { return q.usable && (!ln.provider || q.owner === ln.provider); })[0];
        if (!o) fail('Nothing usable in ' + ln.cls + ' for these dates.');
        if (!o.usable) fail(o.serial + ' cannot be used: ' + o.why + '.');
        r.lines.push({
          id: 'L' + next(s, 'line'), cls: ln.cls, provider: o.owner, providerLe: o.ownerLe, relation: o.relation, agreementId: o.agreementId, agreementVersion: o.agreementId ? agreement(s, o.agreementId).version : 0,
          preferredUnit: o.unitId, unitId: null, hold: o.hold, status: 'REQUESTED', price: o.price, estimate: o.estimate,
          segments: prj ? [{ projectId: prj.id, task: r.task, from: x.from }] : [], events: { requested: s.today }, inspection: null, loss: null, customsId: null, reason: ''
        });
      });
      var value = sum(r.lines, function (l) { return l.estimate; });
      if (s.settings.requesterApproval && !rental && value > s.settings.requesterThreshold) {
        r.status = 'AWAITING_REQUESTER_APPROVAL';
        notify(s, { bu: reqBu, roles: ['receiver-review'] }, r.number + ' (' + value + ') needs your approval before the owners see it.', { record: 'request', id: id }, 'action');
      } else {
        notifyOwners(s, r);
      }
      s.requests.push(r);
      log(s, p, 'Raised ' + r.number + ' for ' + buName(s, reqBu) + (prj ? ' · ' + prj.number : ' · ' + cust.name), { requestId: id });
      return { id: id, number: r.number };
    }
  };
  function notifyOwners(s, r) {
    var owners = {};
    r.lines.forEach(function (l) { owners[l.provider] = (owners[l.provider] || 0) + 1; });
    Object.keys(owners).forEach(function (o) {
      notify(s, { bu: o, roles: ['owner-em'] }, r.number + ': ' + owners[o] + ' line(s) to approve and allocate from your fleet.', { navId: 'approvals' }, 'action');
    });
  }
  A.approveRequest = {
    who: ['receiver-review'],
    run: function (s, p, x) {
      var r = requestOf(s, x.requestId);
      if (!r || r.status !== 'AWAITING_REQUESTER_APPROVAL') fail('Nothing to approve here.');
      if (!inBu(p, r.requestingBu)) fail('Only ' + buName(s, r.requestingBu) + ' approves its own requests.');
      r.status = 'SUBMITTED';
      notifyOwners(s, r);
      log(s, p, 'Approved ' + r.number + ' above the threshold', { requestId: r.id });
    }
  };

  function ownerLine(s, p, x, role) {
    var r = requestOf(s, x.requestId);
    var l = r && byId(r.lines, x.lineId);
    if (!l) fail('No such line.');
    if (!inBu(p, l.provider)) fail('Only ' + buName(s, l.provider) + ', the owner, acts on this line (MC-FR-14).');
    if (role && !can(p, role)) fail('Your role cannot do this.');
    return { r: r, l: l };
  }
  function userLine(s, p, x) {
    var r = requestOf(s, x.requestId);
    var l = r && byId(r.lines, x.lineId);
    if (!l) fail('No such line.');
    var ok = inBu(p, r.requestingBu) || (r.type === 'CUSTOMER_RENTAL' && inBu(p, l.provider) && can(p, 'desk'));
    if (!ok) fail('Only ' + buName(s, r.requestingBu) + ', the user, records this.');
    return { r: r, l: l };
  }

  A.approveLine = {
    who: ['owner-em'],
    run: function (s, p, x) {
      var o = ownerLine(s, p, x, 'owner-em');
      if (o.r.status === 'AWAITING_REQUESTER_APPROVAL') fail('The requesting BU has not approved this request yet.');
      if (o.l.status !== 'REQUESTED') fail('This line is already ' + o.l.status.toLowerCase().replace(/_/g, ' ') + '.');
      var u = unitOf(s, x.unitId || o.l.preferredUnit);
      if (!u || u.owner !== o.l.provider || u.cls !== o.l.cls) fail('Choose one of your own units of this class.');
      if (o.l.inPlace ? u.id !== o.l.preferredUnit : u.status !== 'AVAILABLE') fail(u.serial + ' cannot be allocated: ' + ({ IN_REPAIR: 'it is in repair', INSPECTION: 'it waits for its inspection', LOST: 'it is lost', OUT: 'it is out on another hire' }[u.status] || 'it is not in the yard') + '.');
      var b = busy(s, u.id, o.r.from, o.r.to, o.l.id);
      if (b) fail(u.serial + ' is booked on ' + b.request + ' until ' + hd(b.to) + '.');
      var c = certCheck(s, u, o.r.country, o.r.to);
      if (!c.ok) fail(u.serial + ' cannot go: ' + c.text + ' (MC-FR-18).');
      if (o.r.type === 'CUSTOMER_RENTAL') {
        var ag = agreement(s, o.l.agreementId);
        if (ag && ag.depositPct && !o.r.deposit) fail('Take the customer\'s deposit first (rental desk).');
      }
      o.l.unitId = u.id;
      o.l.status = 'APPROVED';
      o.l.events.approved = s.today;
      o.l.approvedBy = p.name;
      notify(s, { bu: o.r.requestingBu, roles: ['requester', 'site'] }, o.r.number + ': ' + u.serial + ' approved by ' + buName(s, o.l.provider) + '.', { record: 'request', id: o.r.id });
      notify(s, { bu: o.l.provider, roles: ['yard'] }, 'Ship ' + u.serial + ' for ' + o.r.number + ' to ' + o.r.site + ' (' + o.r.country + ').', { navId: 'yard' }, 'action');
      log(s, p, 'Approved and allocated ' + u.serial + ' on ' + o.r.number, { requestId: o.r.id, lineId: o.l.id });
    }
  };
  A.rejectLine = {
    who: ['owner-em'],
    run: function (s, p, x) {
      var o = ownerLine(s, p, x, 'owner-em');
      if (o.l.status !== 'REQUESTED') fail('Only a requested line can be refused.');
      if (!x.reason) fail('Say why (the requester sees it).');
      o.l.status = 'REJECTED';
      o.l.reason = x.reason;
      notify(s, { bu: o.r.requestingBu, roles: ['requester'] }, o.r.number + ': ' + buName(s, o.l.provider) + ' refused a line: ' + x.reason, { record: 'request', id: o.r.id }, 'warning');
      log(s, p, 'Refused a line on ' + o.r.number + ': ' + x.reason, { requestId: o.r.id, lineId: o.l.id });
    }
  };

  A.takeDeposit = {
    who: ['desk'],
    run: function (s, p, x) {
      var r = requestOf(s, x.requestId);
      if (!r || r.type !== 'CUSTOMER_RENTAL') fail('Deposits are for customer rentals.');
      if (r.deposit) fail('Deposit already received.');
      var l = r.lines[0];
      var ag = agreement(s, l.agreementId);
      if (!inBu(p, l.provider)) fail('Only the rental desk of the owner takes the deposit.');
      var amt = r2(sum(r.lines, function (q) { return q.price ? q.price.week * 4 : 0; }) * (ag.depositPct || 0.25));
      var t = addTx(s, { kind: 'DEPOSIT', le: l.providerLe, title: 'Deposit from ' + customer(s, r.customerId).name, refs: { requestId: r.id, customerId: r.customerId },
        lines: [{ account: '1100', dr: amt }, { account: '2300', cr: amt, sub: customer(s, r.customerId).name }] });
      r.deposit = { amount: amt, txId: t.id, date: s.today, settled: false };
      log(s, p, 'Received the deposit of ' + mny(amt, ag.currency) + ' on ' + r.number, { requestId: r.id });
    }
  };

  A.shipLine = {
    who: ['yard'],
    run: function (s, p, x) {
      var o = ownerLine(s, p, x, 'yard');
      if (o.l.status !== 'APPROVED') fail('Ship after the owner has approved and allocated.');
      var u = unitOf(s, o.l.unitId);
      var ownerLe = leOf(s, u.owner);
      var rel = o.l.relation;
      var cross = o.r.country !== u.country;
      if (u.hold === 'STOCK' && !o.l.inPlace) {
        // GR-6 / MC-FR-15: the transfer order stays inside the owner's legal entity.
        var dest = (s.orgs || []).filter(function (g) { return g.le === ownerLe.id && g.country === o.r.country && g.kind === (rel === 'CUSTOMER' ? 'customer' : 'deploy'); })[0]
          || (s.orgs || []).filter(function (g) { return g.le === ownerLe.id && g.country === o.r.country && g.kind === 'deploy'; })[0];
        if (!dest) fail('No ' + ownerLe.short + ' deployment org in ' + o.r.country + ': a transfer order may not cross into another company (GR-6).');
        var bv = u.stock.bookValue;
        var t = addTx(s, { kind: 'TO_SHIP', le: ownerLe.id, title: 'Transfer order ' + u.serial + ': ' + byId(s.orgs, u.home).name + ' → ' + dest.name, refs: { requestId: o.r.id, lineId: o.l.id, unitId: u.id },
          lines: [{ account: '1310', dr: bv, memo: u.serial }, { account: '1300', cr: bv, sub: byId(s.orgs, u.home).name }], destOrg: dest.id });
        o.l.toOrg = dest.id;
        o.l.toNumber = t.number;
      } else if (!o.l.inPlace) {
        addTx(s, { kind: 'ASSET_CUSTODY', le: ownerLe.id, title: u.serial + ' (asset ' + u.asset.number + ') dispatched to ' + o.r.site, refs: { requestId: o.r.id, lineId: o.l.id, unitId: u.id }, lines: [], note: 'Assets: location only, no accounting.' });
      }
      if (cross && !o.l.inPlace) {
        var c = { id: 'C' + next(s, 'customs'), unitId: u.id, serial: u.serial, owner: u.owner, from: u.country, to: o.r.country, regime: 'Temporary import',
          permit: 'TI-' + o.r.country + '-' + pad(s.seq.customs, 5), value: u.hold === 'ASSET' ? r2(u.asset.cost - u.asset.accDep) : u.stock.bookValue,
          entry: s.today, reexportBy: addDays(o.r.to, 30), status: 'OPEN', requestId: o.r.id, docs: ['Pro-forma invoice', 'Packing list', 'Certificates'] };
        s.customs.push(c);
        o.l.customsId = c.id;
      }
      o.l.status = 'SHIPPED';
      o.l.events.shipped = s.today;
      u.custody = { kind: 'transit', org: o.l.toOrg || u.home, label: 'On the way to ' + o.r.site };
      u.status = 'OUT';
      notify(s, { bu: o.r.requestingBu, roles: ['site'] }, u.serial + ' is on the way to ' + o.r.site + ': confirm receipt when it arrives.', { navId: 'site' }, 'action');
      log(s, p, 'Shipped ' + u.serial + (cross ? ' across the border (temporary import)' : ''), { requestId: o.r.id, lineId: o.l.id });
    }
  };

  A.receiveLine = {
    who: ['site', 'desk'],
    run: function (s, p, x) {
      var o = userLine(s, p, x);
      if (o.l.status !== 'SHIPPED' && !(o.l.status === 'APPROVED' && o.l.inPlace)) fail('Receive it when it has been shipped.');
      var u = unitOf(s, o.l.unitId);
      if (u.hold === 'STOCK' && o.l.toOrg && !o.l.inPlace) {
        addTx(s, { kind: 'TO_RECEIPT', le: leOf(s, u.owner).id, title: 'Transfer order ' + (o.l.toNumber || '') + ' received at ' + byId(s.orgs, o.l.toOrg).name + ' (locator ' + (o.r.projectId ? project(s, o.r.projectId).number : customer(s, o.r.customerId).name) + ')',
          refs: { requestId: o.r.id, lineId: o.l.id, unitId: u.id }, lines: [{ account: '1320', dr: u.stock.bookValue, sub: byId(s.orgs, o.l.toOrg).name }, { account: '1310', cr: u.stock.bookValue }] });
      }
      o.l.status = 'ON_HIRE';
      o.l.events.onHire = s.settings.onHire === 'DISPATCH' ? (o.l.events.shipped || s.today) : s.today;
      u.custody = { kind: o.r.type === 'CUSTOMER_RENTAL' ? 'customer' : 'site', org: o.l.toOrg || '', label: o.r.site + (o.r.projectId ? ' · ' + project(s, o.r.projectId).number : '') };
      u.country = o.r.country;
      log(s, p, 'Received ' + u.serial + ': on hire from ' + hd(o.l.events.onHire), { requestId: o.r.id, lineId: o.l.id });
    }
  };

  A.logHours = {
    who: ['site'],
    run: function (s, p, x) {
      var o = userLine(s, p, x);
      if (!o.l.events.onHire) fail('Hours start when the unit is on hire.');
      if (x.date < o.l.events.onHire || x.date > s.today || (o.l.events.offHire && x.date >= o.l.events.offHire)) fail('Only days on hire, up to today.');
      var usage = Math.max(0, Math.min(24, Number(x.usage) || 0));
      var standby = Math.max(0, Math.min(24 - usage, Number(x.standby) || 0));
      s.hours = s.hours.filter(function (h) { return !(h.lineId === o.l.id && h.date === x.date); });
      s.hours.push({ requestId: o.r.id, lineId: o.l.id, date: x.date, usage: usage, standby: standby, approved: false, by: p.name, weekend: isWeekend(s, o.r.country, x.date) });
    }
  };
  function isWeekend(s, code, date) { return (country(s, code).weekend || []).indexOf(dow(date)) !== -1; }
  A.fillHours = {
    who: ['site'],
    run: function (s, p, x) {
      var o = userLine(s, p, x);
      if (!o.l.events.onHire) fail('Hours start when the unit is on hire.');
      var end = o.l.events.offHire ? addDays(o.l.events.offHire, -1) : s.today;
      var n = 0;
      for (var dt = o.l.events.onHire; dt <= end; dt = addDays(dt, 1)) {
        if (isWeekend(s, o.r.country, dt)) continue;
        if (s.hours.some(function (h) { return h.lineId === o.l.id && h.date === dt; })) continue;
        n++;
        var standbyDay = n % 5 === 0;
        s.hours.push({ requestId: o.r.id, lineId: o.l.id, date: dt, usage: standbyDay ? 4 : 8, standby: standbyDay ? 4 : 0, approved: false, by: p.name, weekend: false });
      }
      log(s, p, 'Recorded ' + n + ' working days of hours (site calendar ' + o.r.country + ')', { requestId: o.r.id, lineId: o.l.id });
      return { days: n };
    }
  };
  A.approveHours = {
    who: ['requester', 'receiver-review'],
    run: function (s, p, x) {
      var o = userLine(s, p, x);
      var n = 0;
      s.hours.forEach(function (h) { if (h.lineId === o.l.id && !h.approved) { h.approved = true; h.approvedBy = p.name; n++; } });
      if (!n) fail('No hours waiting for approval.');
      notify(s, { bu: o.l.provider, roles: ['owner-em'] }, o.r.number + ': ' + n + ' days of hours approved by ' + buName(s, o.r.requestingBu) + '.', { record: 'request', id: o.r.id });
      log(s, p, 'Approved ' + n + ' days of hours', { requestId: o.r.id, lineId: o.l.id });
      return { days: n };
    }
  };
  A.reportBreakdown = {
    who: ['site'],
    run: function (s, p, x) {
      var o = userLine(s, p, x);
      if (o.l.status !== 'ON_HIRE') fail('Only a unit on hire can break down.');
      var days = Math.max(1, Math.min(30, Number(x.days) || 1));
      var why = x.reason || 'Owner-caused fault';
      s.breakdowns.push({ id: 'B' + next(s, 'note'), requestId: o.r.id, lineId: o.l.id, date: s.today, days: days, reason: why, by: p.name });
      notify(s, { bu: o.l.provider, roles: ['owner-em'] }, unitOf(s, o.l.unitId).serial + ' broke down at ' + o.r.site + ' (' + days + ' day(s)): ' + why, { record: 'request', id: o.r.id }, 'warning');
      log(s, p, 'Reported a breakdown of ' + days + ' day(s)', { requestId: o.r.id, lineId: o.l.id });
    }
  };
  A.offHire = {
    who: ['site', 'desk'],
    run: function (s, p, x) {
      var o = userLine(s, p, x);
      if (o.l.status !== 'ON_HIRE') fail('Only a unit on hire can be released.');
      o.l.status = 'OFF_HIRED';
      o.l.events.offHire = s.today;
      unitOf(s, o.l.unitId).custody.label = 'Released at ' + o.r.site + ', waiting for collection';
      notify(s, { bu: o.l.provider, roles: ['yard'] }, 'Collect ' + unitOf(s, o.l.unitId).serial + ' from ' + o.r.site + ' (off hire ' + hd(s.today) + ').', { navId: 'yard' }, 'action');
      log(s, p, 'Off hire: ' + unitOf(s, o.l.unitId).serial, { requestId: o.r.id, lineId: o.l.id });
    }
  };
  A.returnLine = {
    who: ['yard'],
    run: function (s, p, x) {
      var o = ownerLine(s, p, x, 'yard');
      if (o.l.status !== 'OFF_HIRED') fail('Receive it back after the site has released it.');
      var u = unitOf(s, o.l.unitId);
      if (u.hold === 'STOCK' && o.l.toOrg) {
        var bv = u.stock.bookValue;
        addTx(s, { kind: 'TO_RETURN', le: leOf(s, u.owner).id, title: 'Return transfer order ' + u.serial + ': ' + byId(s.orgs, o.l.toOrg).name + ' → ' + byId(s.orgs, u.home).name,
          refs: { requestId: o.r.id, lineId: o.l.id, unitId: u.id },
          lines: [{ account: '1310', dr: bv, memo: 'shipped back' }, { account: '1320', cr: bv, sub: byId(s.orgs, o.l.toOrg).name }, { account: '1300', dr: bv, sub: byId(s.orgs, u.home).name, memo: 'received home' }, { account: '1310', cr: bv }] });
      } else {
        addTx(s, { kind: 'ASSET_CUSTODY', le: leOf(s, u.owner).id, title: u.serial + ' back at ' + byId(s.orgs, u.home).name, refs: { requestId: o.r.id, lineId: o.l.id, unitId: u.id }, lines: [], note: 'Assets: location only.' });
      }
      if (o.l.customsId) { var c = byId(s.customs, o.l.customsId); c.status = 'CLOSED'; c.closed = s.today; c.outcome = 'Re-exported'; }
      o.l.status = 'RETURNED';
      o.l.events.returned = s.today;
      u.custody = { kind: 'yard', org: u.home, label: '' };
      u.country = byId(s.orgs, u.home).country;
      u.status = 'INSPECTION';
      log(s, p, 'Received back ' + u.serial + ': inspect it', { requestId: o.r.id, lineId: o.l.id });
    }
  };
  A.inspectLine = {
    who: ['yard', 'owner-em'],
    run: function (s, p, x) {
      var o = ownerLine(s, p, x);
      if (o.l.status !== 'RETURNED') fail('Inspect after it is back.');
      var amt = Math.max(0, r2(x.damage));
      var u = unitOf(s, o.l.unitId);
      o.l.inspection = { date: s.today, result: amt > 0 ? 'DAMAGED' : 'PASS', damage: amt, note: x.note || '', photos: amt > 0 ? (Number(x.photos) || 2) : 0, by: p.name };
      if (amt > 0 && !(Number(x.photos) >= 1 || x.photos == null)) fail('A damage charge needs photos (MC-FR-29).');
      o.l.status = 'CLOSED';
      u.status = amt > 0 ? 'IN_REPAIR' : 'AVAILABLE';
      if (amt > 0) notify(s, { bu: o.r.requestingBu, roles: ['requester', 'receiver-review'] }, u.serial + ' came back damaged: ' + mny(amt, (o.l.price || {}).currency) + ' will be charged' + (amt > s.settings.damageThreshold ? ' (needs your acceptance, OD-11)' : '') + '.', { record: 'request', id: o.r.id }, 'warning');
      log(s, p, 'Inspected ' + u.serial + ': ' + (amt > 0 ? 'damage ' + mny(amt, (o.l.price || {}).currency) : 'pass'), { requestId: o.r.id, lineId: o.l.id });
    }
  };
  A.repairDone = { who: ['owner-em', 'yard'], run: function (s, p, x) { var u = unitOf(s, x.unitId); if (!u || !inBu(p, u.owner)) fail('Not your unit.'); u.status = 'AVAILABLE'; log(s, p, u.serial + ' repaired, back in the fleet'); } };
  A.reportLoss = {
    who: ['site', 'owner-em'],
    run: function (s, p, x) {
      var r = requestOf(s, x.requestId);
      var l = r && byId(r.lines, x.lineId);
      if (!l || (!inBu(p, r.requestingBu) && !inBu(p, l.provider))) fail('Not your request.');
      if (['ON_HIRE', 'OFF_HIRED', 'SHIPPED'].indexOf(l.status) === -1) fail('Only equipment out can be lost.');
      var u = unitOf(s, l.unitId);
      var nbv = u.hold === 'ASSET' ? r2(u.asset.cost - u.asset.accDep) : u.stock.bookValue;
      var value = r2(nbv * (1 + s.settings.lossMarkupPct));
      l.loss = { date: s.today, value: value, nbv: nbv, by: p.name, claim: x.claim || 'INS-' + pad(next(s, 'note'), 5) };
      if (!l.events.offHire) l.events.offHire = s.today;
      l.status = 'LOST';
      u.status = 'LOST';
      u.custody = { kind: 'lost', org: '', label: 'Lost at ' + r.site };
      var ownerLe = leOf(s, u.owner).id;
      if (u.hold === 'ASSET') {
        addTx(s, { kind: 'ASSET_RETIRE', le: ownerLe, title: 'Asset ' + u.asset.number + ' (' + u.serial + ') retired: lost', refs: { requestId: r.id, lineId: l.id, unitId: u.id },
          lines: [{ account: '1510', dr: u.asset.accDep }, { account: '1520', dr: value }, value < nbv ? { account: '5300', dr: r2(nbv - value) } : { account: '4310', cr: r2(value - nbv) }, { account: '1500', cr: u.asset.cost }] });
      } else {
        addTx(s, { kind: 'STOCK_ISSUE', le: ownerLe, title: u.serial + ' issued out of inventory: lost', refs: { requestId: r.id, lineId: l.id, unitId: u.id },
          lines: [{ account: '1520', dr: value }, { account: l.toOrg ? '1320' : '1310', cr: nbv }, { account: '4310', cr: r2(value - nbv) }] });
      }
      if (l.customsId) { var c = byId(s.customs, l.customsId); c.status = 'REGULARISE'; c.outcome = 'Lost: regularise with customs'; }
      notify(s, { bu: l.provider, roles: ['owner-em', 'owner-finance'] }, u.serial + ' lost at ' + r.site + ': charged at ' + mny(value, leOf(s, u.owner).currency) + ' (net book value + ' + Math.round(s.settings.lossMarkupPct * 100) + ' %).', { record: 'request', id: r.id }, 'warning');
      log(s, p, 'Reported ' + u.serial + ' lost; insurance claim ' + l.loss.claim, { requestId: r.id, lineId: l.id });
    }
  };

  // MC-FR-31: moves while on hire.
  A.redeploy = {
    who: ['requester', 'site'],
    run: function (s, p, x) {
      var o = userLine(s, p, x);
      if (o.l.status !== 'ON_HIRE') fail('Move a unit while it is on hire.');
      var to = project(s, x.projectId);
      if (!to || to.bu !== o.r.requestingBu) fail('Choose another project of the same business unit.');
      if (o.l.segments.length && o.l.segments[o.l.segments.length - 1].projectId === to.id) fail('It is already on that project.');
      o.l.segments.push({ projectId: to.id, task: x.task || to.tasks[0], from: s.today });
      log(s, p, unitOf(s, o.l.unitId).serial + ' moved to ' + to.number + ' from ' + hd(s.today) + ': charges go there from today', { requestId: o.r.id, lineId: o.l.id });
    }
  };
  A.moveToCompany = {
    who: ['requester'],
    run: function (s, p, x) {
      var o = userLine(s, p, x);
      if (o.l.status !== 'ON_HIRE') fail('Move a unit while it is on hire.');
      if (o.r.type === 'CUSTOMER_RENTAL') fail('A customer has this unit: it comes back to the owner first.');
      var to = project(s, x.projectId);
      if (!to || to.bu === o.r.requestingBu) fail('Choose a project of another group company.');
      if (to.country !== o.r.country) fail('A handover on site stays in ' + country(s, o.r.country).name + ': across a border, return it and request it again.');
      if (o.l.relation === 'SAME_BU' || o.l.provider === to.bu) fail('Use the owner\'s own process for its own projects.');
      var rel = relationType(s, o.l.provider, to.bu, false);
      var ag = agreementFor(s, o.l.provider, to.bu);
      if (!ag && rel !== 'SAME_BU') fail('No agreement between ' + buName(s, o.l.provider) + ' and ' + buName(s, to.bu) + ': the owner cannot bill them (OD-13).');
      var u = unitOf(s, o.l.unitId);
      var c = certCheck(s, u, to.country, x.to || o.r.to);
      if (!c.ok) fail(c.text);
      o.l.status = 'OFF_HIRED';
      o.l.events.offHire = s.today;
      o.l.movedTo = to.bu;
      var nr = { id: 'R' + next(s, 'request'), number: 'FR-' + s.seq.request, requestingBu: to.bu, requestingLe: leOf(s, to.bu).id, type: to.type === 'contract' ? 'CUSTOMER_PROJECT' : 'INTERNAL',
        projectId: to.id, task: to.tasks[0], customerId: to.customer || '', site: to.site, country: to.country, from: s.today, to: x.to || o.r.to, note: 'Moved on site from ' + o.r.number,
        createdBy: p.name, createdAt: s.today, status: 'SUBMITTED', deposit: null, lines: [] };
      nr.lines.push({ id: 'L' + next(s, 'line'), cls: o.l.cls, provider: o.l.provider, providerLe: o.l.providerLe, relation: rel, agreementId: ag ? ag.id : '', agreementVersion: ag ? ag.version : 0, preferredUnit: u.id, unitId: null,
        hold: u.hold, status: 'REQUESTED', price: priceFor(s, u, rel, ag), estimate: 0, inPlace: true, toOrg: o.l.toOrg, toNumber: o.l.toNumber,
        segments: [{ projectId: to.id, task: to.tasks[0], from: s.today }], events: { requested: s.today }, inspection: null, loss: null, customsId: o.l.customsId, reason: '' });
      o.l.status = 'TRANSFERRED';
      o.l.events.returned = s.today;
      s.requests.push(nr);
      notifyOwners(s, nr);
      log(s, p, u.serial + ' off hire for ' + buName(s, o.r.requestingBu) + ', handed over on site to ' + buName(s, to.bu) + ' (' + nr.number + ', owner approval needed)', { requestId: o.r.id, lineId: o.l.id });
      return { id: nr.id, number: nr.number };
    }
  };

  // ── Charges (MC-FR-22) ─────────────────────────────────────────────────────────────────────────────────────────
  function chargeKey(c) { return [c.period, c.lineId, c.kind, c.seg || 0].join('|'); }
  function lineCharges(s, r, l, period) {
    var out = [];
    var ps = monthStart(period);
    var pe = monthEnd(period);
    var ag = agreement(s, l.agreementId);
    var price = l.price || {};
    var u = unitOf(s, l.unitId);
    var base = { period: period, requestId: r.id, requestNumber: r.number, lineId: l.id, unitId: l.unitId, serial: u ? u.serial : '', relation: l.relation, provider: l.provider,
      providerLe: l.providerLe, receiver: r.requestingBu, receiverLe: r.requestingLe, customerId: r.type === 'CUSTOMER_RENTAL' ? r.customerId : '', currency: price.currency,
      agreementId: l.agreementId, agreementVersion: l.agreementVersion || (ag ? ag.version : 0) };
    function add(o) { out.push(Object.assign({}, base, o)); }
    if (l.events.onHire) {
      var hireEnd = l.events.offHire ? addDays(l.events.offHire, -1) : pe;
      var segs = l.segments.length ? l.segments : [{ projectId: '', task: '', from: l.events.onHire }];
      segs.forEach(function (sg, i) {
        var sFrom = maxS(maxS(sg.from, l.events.onHire), ps);
        var sTo = minS(minS(i + 1 < segs.length ? addDays(segs[i + 1].from, -1) : hireEnd, hireEnd), pe);
        var days = sFrom <= sTo ? diffDays(sTo, sFrom) + 1 : 0;
        if (days > 0) add({ kind: 'RENTAL', seg: i, projectId: sg.projectId, task: sg.task, qty: days, uom: 'days', rate: price.day, from: sFrom, to: sTo, amount: rental(days, price),
          text: days + ' day(s) at ' + price.week + '/week or ' + price.day + '/day' });
      });
      var lastSeg = segs[segs.length - 1];
      var hrs = s.hours.filter(function (h) { return h.lineId === l.id && h.approved && h.date >= ps && h.date <= pe; });
      var sb = sum(hrs, function (h) { return h.standby; });
      if (sb > 0 && ag && ag.standbyPct) add({ kind: 'STANDBY', seg: 0, projectId: lastSeg.projectId, task: lastSeg.task, qty: sb, uom: 'hours', rate: r2(price.day / 8 * ag.standbyPct), amount: r2(sb * price.day / 8 * ag.standbyPct), text: sb + ' standby hours at ' + Math.round(ag.standbyPct * 100) + ' %' });
      s.breakdowns.filter(function (b) { return b.lineId === l.id && b.date >= ps && b.date <= pe; }).forEach(function (b, i) {
        if (ag && ag.breakdownCredit) add({ kind: 'BREAKDOWN_CREDIT', seg: i, projectId: lastSeg.projectId, task: lastSeg.task, qty: b.days, uom: 'days', rate: price.day, amount: -r2(b.days * price.day), text: 'Breakdown: ' + b.reason });
      });
      if (l.events.offHire && l.events.offHire >= ps && l.events.offHire <= pe && ag && ag.minDays && !l.loss) {
        var total = diffDays(l.events.offHire, l.events.onHire);
        if (total < ag.minDays) add({ kind: 'MIN_HIRE', seg: 0, projectId: lastSeg.projectId, task: lastSeg.task, qty: ag.minDays - total, uom: 'days', rate: price.day, amount: r2(rental(ag.minDays, price) - rental(total, price)), text: 'Minimum hire ' + ag.minDays + ' days' });
      }
      if (ag && ag.transport && !l.inPlace) {
        if (l.events.shipped && l.events.shipped >= ps && l.events.shipped <= pe) add({ kind: 'TRANSPORT', seg: 0, projectId: segs[0].projectId, task: segs[0].task, qty: 1, uom: 'trip', rate: ag.transport, amount: ag.transport, text: 'Transport out' });
        if (l.events.returned && l.status !== 'TRANSFERRED' && l.events.returned >= ps && l.events.returned <= pe) add({ kind: 'TRANSPORT', seg: 1, projectId: lastSeg.projectId, task: lastSeg.task, qty: 1, uom: 'trip', rate: ag.transport, amount: ag.transport, text: 'Transport back' });
      }
      if (l.inspection && l.inspection.damage > 0 && l.inspection.date >= ps && l.inspection.date <= pe) {
        add({ kind: 'DAMAGE', seg: 0, projectId: lastSeg.projectId, task: lastSeg.task, qty: 1, uom: 'each', rate: l.inspection.damage, amount: l.inspection.damage, text: 'Damage at return: ' + (l.inspection.note || 'repair'), needsAcceptance: l.inspection.damage > s.settings.damageThreshold && l.relation.indexOf('IC_') === 0 });
      }
      if (l.loss && l.loss.date >= ps && l.loss.date <= pe) {
        var lossAmt = price.currency === leOf(s, l.provider).currency ? l.loss.value : r2(l.loss.value * rate(s, leOf(s, l.provider).currency, price.currency, l.loss.date));
        add({ kind: 'LOSS', seg: 0, projectId: lastSeg.projectId, task: lastSeg.task, qty: 1, uom: 'each', rate: lossAmt, amount: lossAmt, text: 'Loss at agreed value (claim ' + l.loss.claim + ')' });
      }
    }
    return out;
  }

  A.runCharges = {
    who: ['ic-finance', 'owner-finance'],
    run: function (s, p, x) {
      var period = x.period || monthOf(addDays(monthStart(monthOf(s.today)), s.today === monthEnd(monthOf(s.today)) ? 0 : -1));
      if (s.today < monthEnd(period)) fail('The period ' + period + ' is still open: run it on or after ' + hd(monthEnd(period)) + ' (move the demo clock to the month end).');
      var made = 0;
      var changed = 0;
      var existing = {};
      s.charges.forEach(function (c) { existing[chargeKey(c)] = c; });
      s.requests.forEach(function (r) {
        r.lines.forEach(function (l) {
          lineCharges(s, r, l, period).forEach(function (c) {
            var k = chargeKey(c);
            var old = existing[k];
            if (old) {
              if (r2(old.amount) === r2(c.amount)) return;
              if (['CALCULATED', 'IN_STATEMENT'].indexOf(old.status) !== -1 && !old.statementId) { old.amount = c.amount; old.qty = c.qty; changed++; return; }
              c.kind = 'ADJUSTMENT';
              c.amount = r2(c.amount - old.amount);
              c.text = 'Adjustment to ' + old.id + ' (already ' + old.status.toLowerCase() + ')';
              c.seg = 'adj' + s.seq.charge;
            }
            c.id = 'CH' + pad(next(s, 'charge'), 5);
            c.status = 'CALCULATED';
            c.statementId = null;
            c.createdAt = s.today;
            s.charges.push(c);
            made++;
          });
        });
      });
      // Group: IC charges into statements per pair and period; customer and internal charges wait for their pages.
      var groups = {};
      s.charges.filter(function (c) { return c.period === period && c.status === 'CALCULATED' && c.relation.indexOf('IC_') === 0; }).forEach(function (c) {
        var k = c.provider + '>' + c.receiver;
        (groups[k] = groups[k] || []).push(c);
      });
      Object.keys(groups).forEach(function (k) {
        var cs = groups[k];
        var st = s.statements.filter(function (q) { return q.period === period && q.provider === cs[0].provider && q.receiver === cs[0].receiver && q.status === 'DRAFT'; })[0];
        if (!st) {
          var n = next(s, 'statement');
          st = { id: 'S' + n, number: 'ICS-' + period + '-' + pad(n, 3), period: period, provider: cs[0].provider, receiver: cs[0].receiver, providerLe: cs[0].providerLe, receiverLe: cs[0].receiverLe,
            relation: cs[0].relation, currency: cs[0].currency, agreementId: cs[0].agreementId, status: 'DRAFT', createdAt: s.today, disputes: [], pair: null, accrued: false };
          s.statements.push(st);
        }
        cs.forEach(function (c) { c.statementId = st.id; c.status = 'IN_STATEMENT'; });
        notify(s, { bu: st.provider, roles: ['owner-finance', 'ic-finance'] }, 'Statement ' + st.number + ' for ' + buName(s, st.receiver) + ' is ready to check and release.', { navId: 'charges' }, 'action');
      });
      log(s, p, 'Charge run ' + period + ': ' + made + ' new charge line(s)' + (changed ? ', ' + changed + ' updated' : ''), {});
      return { period: period, made: made, changed: changed, statements: Object.keys(groups).length };
    }
  };

  // ── Statements: release, review, disputes (MC-FR-23) ──────────────────────────────────────────────────────────
  function statementOf(s, id) { var st = byId(s.statements, id); if (!st) fail('No such statement.'); return st; }
  A.releaseStatement = {
    who: ['owner-finance', 'ic-finance'],
    run: function (s, p, x) {
      var st = statementOf(s, x.statementId);
      if (!inBu(p, st.provider)) fail('Only the owner releases its statement.');
      if (st.status !== 'DRAFT') fail('Already released.');
      st.status = 'RELEASED';
      st.releasedAt = s.today;
      st.dueBy = addDays(s.today, s.settings.disputeDays);
      notify(s, { bu: st.receiver, roles: ['receiver-review'] }, 'Statement ' + st.number + ' from ' + buName(s, st.provider) + ': agree or dispute by ' + hd(st.dueBy) + '.', { navId: 'charges' }, 'action');
      log(s, p, 'Released statement ' + st.number + ' (answer by ' + hd(st.dueBy) + ')', { statementId: st.id });
    }
  };
  A.acceptStatement = {
    who: ['receiver-review'],
    run: function (s, p, x) {
      var st = statementOf(s, x.statementId);
      if (!inBu(p, st.receiver)) fail('Only ' + buName(s, st.receiver) + ' agrees its statement.');
      if (['RELEASED', 'PARTLY_AGREED', 'DISPUTED'].indexOf(st.status) === -1) fail('Nothing to agree.');
      var held = 0;
      s.charges.forEach(function (c) {
        if (c.statementId !== st.id) return;
        if (c.status === 'DISPUTED') { held++; return; }
        if (c.status === 'IN_STATEMENT') c.status = 'ACCEPTED';
      });
      st.status = held ? 'PARTLY_AGREED' : 'AGREED';
      st.agreedAt = s.today;
      st.agreedBy = p.name;
      notify(s, { roles: ['ic-finance'] }, 'Statement ' + st.number + ' agreed by ' + buName(s, st.receiver) + (held ? ' (' + held + ' line(s) held in dispute)' : '') + ': create the invoice pair.', { navId: 'ic-workbench' }, 'action');
      log(s, p, 'Agreed statement ' + st.number + (held ? ', ' + held + ' line(s) held' : ''), { statementId: st.id });
    }
  };
  A.disputeCharge = {
    who: ['receiver-review'],
    run: function (s, p, x) {
      var c = byId(s.charges, x.chargeId);
      if (!c || !c.statementId) fail('No such charge.');
      var st = statementOf(s, c.statementId);
      if (!inBu(p, st.receiver)) fail('Only the user disputes.');
      if (['RELEASED', 'PARTLY_AGREED', 'DISPUTED'].indexOf(st.status) === -1 || ['IN_STATEMENT'].indexOf(c.status) === -1) fail('This line can no longer be disputed.');
      if (!x.reason) fail('Say why.');
      c.status = 'DISPUTED';
      c.dispute = { reason: x.reason, by: p.name, at: s.today };
      st.status = 'DISPUTED';
      st.disputes.push({ chargeId: c.id, reason: x.reason, at: s.today, by: p.name, resolved: false });
      notify(s, { bu: st.provider, roles: ['owner-finance', 'ic-finance'] }, st.number + ': ' + c.serial + ' ' + c.kind.toLowerCase() + ' disputed: ' + x.reason, { navId: 'charges' }, 'warning');
      log(s, p, 'Disputed ' + c.id + ' on ' + st.number + ': ' + x.reason, { statementId: st.id, requestId: c.requestId });
    }
  };
  A.acceptCharge = {
    who: ['receiver-review'],
    run: function (s, p, x) {
      var c = byId(s.charges, x.chargeId);
      var st = statementOf(s, c && c.statementId);
      if (!inBu(p, st.receiver)) fail('Only the user accepts.');
      if (!c.needsAcceptance && c.status !== 'IN_STATEMENT') fail('Nothing to accept.');
      c.status = 'ACCEPTED';
      c.acceptedBy = p.name;
      var open = s.charges.filter(function (q) { return q.statementId === st.id && (q.status === 'IN_STATEMENT' || q.status === 'DISPUTED'); });
      if (!open.length && st.status === 'PARTLY_AGREED') st.status = 'AGREED';
      log(s, p, 'Accepted ' + c.id + ' (' + c.kind.toLowerCase() + ')', { statementId: st.id });
    }
  };
  A.resolveDispute = {
    who: ['owner-finance', 'ic-finance'],
    run: function (s, p, x) {
      var c = byId(s.charges, x.chargeId);
      if (!c || c.status !== 'DISPUTED') fail('Not in dispute.');
      var st = statementOf(s, c.statementId);
      if (!inBu(p, st.provider)) fail('Only the owner resolves.');
      var dsp = st.disputes.filter(function (q) { return q.chargeId === c.id && !q.resolved; })[0];
      if (x.resolution === 'credit') {
        if (x.amount != null && x.amount !== '' && !(Number(x.amount) > 0)) fail('Give the credit as an amount above zero.');
        if (x.amount != null && x.amount !== '' && Number(x.amount) > Math.abs(c.amount)) fail('The credit cannot be more than the line (' + mny(Math.abs(c.amount), c.currency) + ').');
        var amt = x.amount == null || x.amount === '' ? Math.abs(c.amount) : Number(x.amount);
        var cr = Object.assign({}, c, { id: 'CH' + pad(next(s, 'charge'), 5), kind: 'CREDIT', amount: -r2(amt), qty: 1, uom: 'each', rate: -r2(amt), text: 'Credit for ' + c.id + ': ' + (dsp ? dsp.reason : ''), status: 'ACCEPTED', dispute: null, seg: 'cr' + s.seq.charge, createdAt: s.today });
        s.charges.push(cr);
        c.status = 'ACCEPTED';
      } else {
        c.status = 'IN_STATEMENT';
      }
      if (dsp) { dsp.resolved = true; dsp.resolution = x.resolution === 'credit' ? 'Credit given' : 'Charge kept, explained'; dsp.resolvedBy = p.name; dsp.resolvedAt = s.today; }
      var open = s.charges.filter(function (q) { return q.statementId === st.id && q.status === 'DISPUTED'; });
      if (!open.length) {
        var pending = s.charges.filter(function (q) { return q.statementId === st.id && q.status === 'IN_STATEMENT'; });
        st.status = pending.length ? 'RELEASED' : 'AGREED';
        if (st.status === 'RELEASED') st.dueBy = addDays(s.today, s.settings.disputeDays);
      }
      notify(s, { bu: st.receiver, roles: ['receiver-review'] }, st.number + ': dispute on ' + c.id + ' resolved (' + (dsp ? dsp.resolution : x.resolution) + ').', { navId: 'charges' });
      log(s, p, 'Resolved the dispute on ' + c.id + ': ' + (x.resolution === 'credit' ? 'credit' : 'kept'), { statementId: st.id });
    }
  };

  // ── The invoice pair (MC-FR-25), accruals (MC-FR-24), netting (MC-FR-28) ─────────────────────────────────────
  var COST_ACC = { RENTAL: '5100', STANDBY: '5100', MIN_HIRE: '5100', BREAKDOWN_CREDIT: '5100', CREDIT: '5100', ADJUSTMENT: '5100', TRANSPORT: '5110', DAMAGE: '5120', LOSS: '5120' };
  var REV_ACC = { RENTAL: '4110', STANDBY: '4110', MIN_HIRE: '4110', BREAKDOWN_CREDIT: '4110', CREDIT: '4110', ADJUSTMENT: '4110', TRANSPORT: '4120', DAMAGE: '4130', LOSS: '4130' };
  var EXP_TYPE = { RENTAL: 'IC Equipment Rental', STANDBY: 'IC Equipment Rental', MIN_HIRE: 'IC Equipment Rental', BREAKDOWN_CREDIT: 'IC Equipment Rental', CREDIT: 'IC Equipment Rental', ADJUSTMENT: 'IC Equipment Rental', TRANSPORT: 'IC Transport', DAMAGE: 'IC Damage and Loss', LOSS: 'IC Damage and Loss' };

  function invoiceable(s, st) { return s.charges.filter(function (c) { return c.statementId === st.id && c.status === 'ACCEPTED' && !c.arNumber; }); }
  function groupBy(list, f) { var o = {}; list.forEach(function (x) { var k = f(x); (o[k] = o[k] || []).push(x); }); return o; }

  A.createInvoicePair = {
    who: ['ic-finance'],
    run: function (s, p, x) {
      var st = statementOf(s, x.statementId);
      if (['AGREED', 'PARTLY_AGREED', 'FAILED'].indexOf(st.status) === -1) fail('Create the invoices once ' + buName(s, st.receiver) + ' has agreed the statement.');
      var cs = invoiceable(s, st);
      if (!cs.length) fail('Nothing agreed to invoice.');
      var ag = agreement(s, st.agreementId);
      var prov = le(s, st.providerLe);
      var recv = le(s, st.receiverLe);
      if (s.settings.simulateFailure) {
        s.settings.simulateFailure = false;
        st.failedOnce = true;
        st.status = 'FAILED';
        st.pair = { status: 'FAILED', error: 'Fusion Payables rejected the AP invoice: supplier site ' + prov.short + ' is not enabled for ' + buName(s, st.receiver) + ' (setup, section 12). Fix it in Fusion, then retry.', at: s.today };
        notify(s, { roles: ['ic-finance'] }, 'Invoice pair for ' + st.number + ' failed: ' + st.pair.error, { navId: 'ic-workbench' }, 'error');
        log(s, p, 'Invoice pair for ' + st.number + ' failed (INT-10)', { statementId: st.id });
        return { failed: true };
      }
      var net = sum(cs, function (c) { return c.amount; });
      var domestic = ag.tax === 'DOMESTIC';
      var vat = domestic ? r2(net * vatOf(s, prov.id)) : 0;
      var arNo = prov.short.replace(/\W/g, '').slice(0, 2).toUpperCase() + '-ICAR-' + pad(next(s, 'invoice'), 6);
      // FleetCo's AR invoice (in the agreement currency = its ledger currency).
      var arLines = [{ account: '1210', dr: r2(net + vat), sub: recv.short }];
      var byRev = groupBy(cs, function (c) { return REV_ACC[c.kind]; });
      Object.keys(byRev).forEach(function (a) { arLines.push({ account: a, cr: sum(byRev[a], function (c) { return c.amount; }) }); });
      if (vat) arLines.push({ account: '2200', cr: vat });
      var ar = addTx(s, { kind: 'IC_AR', le: prov.id, number: arNo, title: 'Intercompany invoice ' + arNo + ' to ' + recv.short + ' · ' + st.number, refs: { statementId: st.id, chargeIds: cs.map(function (c) { return c.id; }) },
        entered: { currency: st.currency, amount: r2(net + vat) }, lines: normalise(arLines) });
      // ProjectCo's mirror AP invoice, project-coded, in its own ledger currency at the invoice date's rate.
      var fx = rate(s, st.currency, recv.currency, s.today);
      var apNo = arNo;
      var apLines = [];
      var byProj = groupBy(cs, function (c) { return (c.projectId || '') + '|' + COST_ACC[c.kind] + '|' + (c.task || ''); });
      Object.keys(byProj).forEach(function (k) {
        var parts = k.split('|');
        var prj = project(s, parts[0]);
        apLines.push({ account: parts[1], dr: r2(sum(byProj[k], function (c) { return c.amount; }) * fx), sub: prj ? prj.number + ' · ' + parts[2] : '' });
      });
      var rc = 0;
      var inVat = 0;
      if (domestic) { inVat = r2(vat * fx); apLines.push({ account: '1400', dr: inVat }); } else if (ag.tax === 'REVERSE_CHARGE') {
        rc = r2(net * fx * vatOf(s, recv.id));
        apLines.push({ account: '1400', dr: rc, memo: 'self-assessed' });
        apLines.push({ account: '2200', cr: rc, memo: 'self-assessed (reverse charge)' });
      }
      var payable = r2(sum(apLines, function (l) { return l.dr || 0; }) - rc);
      apLines.push({ account: '2110', cr: payable, sub: prov.short });
      var ap = addTx(s, { kind: 'IC_AP', le: recv.id, number: apNo, title: 'Intercompany invoice ' + apNo + ' from ' + prov.short + ' · project-coded', refs: { statementId: st.id, chargeIds: cs.map(function (c) { return c.id; }) },
        entered: { currency: st.currency, amount: r2(net + vat) }, rate: fx, lines: normalise(apLines) });
      // PPM: the supplier cost on each project (no accounting of its own: Payables accounted it).
      var byPrj = groupBy(cs, function (c) { return c.projectId; });
      Object.keys(byPrj).forEach(function (pid) {
        var prj = project(s, pid);
        var lines = byPrj[pid];
        addTx(s, { kind: 'PROJECT_COST', le: recv.id, title: 'Project ' + (prj ? prj.number : '') + ': cost from ' + apNo, refs: { statementId: st.id, projectId: pid, chargeIds: lines.map(function (c) { return c.id; }) },
          amount: r2(sum(lines, function (c) { return c.amount; }) * fx), items: lines.map(function (c) { return { chargeId: c.id, expType: EXP_TYPE[c.kind], task: c.task, amount: r2(c.amount * fx), date: c.to || st.period }; }),
          billable: !!(prj && prj.type === 'contract'), billed: false, lines: [], note: 'Supplier cost: accounted by Payables (' + apNo + '), shown on the project by PPM.' });
      });
      cs.forEach(function (c) { c.arNumber = arNo; c.apNumber = apNo; c.status = 'INVOICED'; });
      st.pair = { status: 'CREATED', arTx: ar.id, apTx: ap.id, number: arNo, at: s.today, rate: fx, net: net, vat: vat, reverseCharge: rc };
      var rest = s.charges.filter(function (c) { return c.statementId === st.id && c.status !== 'INVOICED'; });
      st.status = rest.length ? 'PARTLY_INVOICED' : 'INVOICED';
      if (st.accrued) reverseAccrual(s, p, st);
      notify(s, { bu: st.receiver, roles: ['receiver-review', 'finance'] }, 'Invoice ' + apNo + ' from ' + prov.short + ' is in your Payables, coded to the project(s).', { navId: 'ic-workbench' });
      log(s, p, 'Created the invoice pair ' + arNo + ' (AR ' + prov.short + ', AP ' + recv.short + ') for ' + st.number, { statementId: st.id });
      return { number: arNo };
    }
  };
  function normalise(lines) { return lines.map(function (l) { return { account: l.account, dr: l.dr || 0, cr: l.cr || 0, sub: l.sub || '', memo: l.memo || '' }; }); }

  function accrue(s, p, st) {
    var cs = s.charges.filter(function (c) { return c.statementId === st.id && !c.arNumber; });
    var net = sum(cs, function (c) { return c.amount; });
    if (!net) return;
    var prov = le(s, st.providerLe);
    var recv = le(s, st.receiverLe);
    var date = monthEnd(st.period);
    var fx = rate(s, st.currency, recv.currency, date);
    var a1 = addTx(s, { kind: 'ACCRUAL', le: prov.id, date: date, title: 'Accrued IC revenue ' + st.number + ' (reverses ' + hd(addDays(date, 1)) + ')', refs: { statementId: st.id },
      lines: [{ account: '1220', dr: net, sub: recv.short }, { account: '4110', cr: net }] });
    var a2 = addTx(s, { kind: 'ACCRUAL', le: recv.id, date: date, title: 'Accrued IC cost ' + st.number + ' (reverses ' + hd(addDays(date, 1)) + ')', refs: { statementId: st.id },
      lines: [{ account: '5130', dr: r2(net * fx) }, { account: '2120', cr: r2(net * fx), sub: prov.short }] });
    st.accrued = { at: s.today, amount: net, txs: [a1.id, a2.id], reversed: false };
    notify(s, { roles: ['ic-finance'] }, st.number + ' was not invoiced by the IC cut-off: accrued in both ledgers (' + mny(net, st.currency) + ').', { navId: 'ic-workbench' }, 'warning');
    log(s, p, 'Accrued ' + st.number + ' at the cut-off in both ledgers', { statementId: st.id });
  }
  function reverseAccrual(s, p, st) {
    if (!st.accrued || st.accrued.reversed) return;
    st.accrued.txs.forEach(function (id) {
      var t = byId(s.tx, id);
      addTx(s, { kind: 'ACCRUAL_REVERSAL', le: t.le, date: addDays(t.date, 1), title: 'Reversal of ' + t.number, refs: { statementId: st.id },
        lines: t.lines.map(function (l) { return { account: l.account, dr: l.cr, cr: l.dr, sub: (l.name.split(' · ')[1] || '') }; }) });
    });
    st.accrued.reversed = true;
  }
  A.accrueNow = { who: ['ic-finance'], run: function (s, p, x) { var st = statementOf(s, x.statementId); if (st.accrued) fail('Already accrued.'); if (st.pair && st.pair.status === 'CREATED') fail('Already invoiced.'); accrue(s, p, st); } };

  A.settle = {
    who: ['ic-finance'],
    run: function (s, p, x) {
      var st = statementOf(s, x.statementId);
      if (['INVOICED', 'PARTLY_INVOICED'].indexOf(st.status) === -1 || !st.pair || st.pair.settled) fail('Settle an invoiced statement.');
      var ag = agreement(s, st.agreementId);
      var prov = le(s, st.providerLe);
      var recv = le(s, st.receiverLe);
      var ar = byId(s.tx, st.pair.arTx);
      var ap = byId(s.tx, st.pair.apTx);
      var gross = ar.entered.amount;
      var wht = r2(st.pair.net * (ag.wht || 0));
      var bank = s.settings.netting ? '1150' : '1100';
      var paidFc = r2(gross - wht);
      addTx(s, { kind: 'NETTING', le: prov.id, title: (s.settings.netting ? 'Netting' : 'Receipt') + ' ' + st.pair.number + ' from ' + recv.short, refs: { statementId: st.id },
        lines: [{ account: bank, dr: paidFc }, { account: '1410', dr: wht, memo: wht ? 'withheld by ' + recv.short : '' }, { account: '1210', cr: gross, sub: recv.short }] });
      var todayRate = rate(s, st.currency, recv.currency, s.today);
      var booked = byId(ap.lines.map(function (l) { return Object.assign({ id: l.account }, l); }), '2110').cr;
      var atToday = r2(gross * todayRate);
      var bankLocal = r2(paidFc * todayRate);
      var whtLocal = r2(atToday - bankLocal);
      var diff = r2(atToday - booked);
      if (st.pair.vat === 0 && recv.currency === prov.currency) diff = 0;
      var rl = [{ account: '2110', dr: booked, sub: prov.short }, { account: bank, cr: bankLocal }];
      if (wht) rl.push({ account: '2210', cr: whtLocal, memo: 'to ' + country(s, recv.country).name + '\'s tax authority' });
      if (diff > 0) rl.push({ account: '5900', dr: diff }); else if (diff < 0) rl.push({ account: '4900', cr: -diff });
      if (!wht && diff === 0 && recv.currency === prov.currency) rl = [{ account: '2110', dr: booked, sub: prov.short }, { account: bank, cr: booked }];
      addTx(s, { kind: 'NETTING', le: recv.id, title: (s.settings.netting ? 'Netting' : 'Payment') + ' ' + st.pair.number + ' to ' + prov.short + (diff ? ' (exchange difference)' : ''), refs: { statementId: st.id }, rate: todayRate, lines: rl });
      st.pair.settled = { at: s.today, wht: wht, fxDiff: diff };
      if (st.status === 'INVOICED') st.status = 'SETTLED';
      ar.status = 'SETTLED';
      ap.status = 'SETTLED';
      log(s, p, 'Settled ' + st.pair.number + (wht ? ' net of withholding ' + mny(wht, st.currency) : '') + (diff ? ', exchange difference ' + mny(diff, recv.currency) : ''), { statementId: st.id });
    }
  };

  // Same legal entity (cross-charge) and own fleet: posted to PPM without invoices (MC-FR-26).
  A.postInternal = {
    who: ['ic-finance', 'finance'],
    run: function (s, p, x) {
      var cs = s.charges.filter(function (c) { return (c.relation === 'SAME_LE' || c.relation === 'SAME_BU') && c.status === 'CALCULATED' && (!x.period || c.period === x.period); });
      if (!cs.length) fail('No cross-charges or own-equipment costs waiting. Run the charges first.');
      var g = groupBy(cs, function (c) { return c.relation + '|' + c.projectId + '|' + c.provider; });
      Object.keys(g).forEach(function (k) {
        var list = g[k];
        var c0 = list[0];
        var prj = project(s, c0.projectId);
        var amt = sum(list, function (c) { return c.amount; });
        var same = c0.relation === 'SAME_BU';
        addTx(s, { kind: same ? 'OWN_COST' : 'CROSS_CHARGE', le: c0.receiverLe, title: (same ? 'Own equipment cost' : 'Cross-charge from ' + buName(s, c0.provider)) + ' → ' + (prj ? prj.number : ''), refs: { projectId: c0.projectId, chargeIds: list.map(function (c) { return c.id; }) },
          amount: amt, billable: !!(prj && prj.type === 'contract'), billed: false,
          items: list.map(function (c) { return { chargeId: c.id, expType: same ? 'Own Equipment' : 'Cross-charged Equipment', task: c.task, amount: c.amount, date: c.to }; }),
          lines: [{ account: same ? '5140' : '5150', dr: amt, sub: prj ? prj.number : '' }, { account: '4300', cr: amt, sub: buName(s, c0.provider) }], note: same ? 'No invoice: the BU uses its own equipment.' : 'No invoice, no tax: one legal entity (OD-14).' });
        list.forEach(function (c) { c.status = 'POSTED'; });
      });
      log(s, p, 'Posted ' + cs.length + ' internal cost line(s) to PPM (no invoices)', {});
      return { lines: cs.length };
    }
  };

  // Customers: FleetCo's rental invoices (S3), ProjectCo's project billing (S2).
  A.invoiceCustomer = {
    who: ['desk', 'owner-finance', 'ic-finance'],
    run: function (s, p, x) {
      var cs = s.charges.filter(function (c) { return c.relation === 'CUSTOMER' && c.status === 'CALCULATED' && (!x.customerId || c.customerId === x.customerId); });
      if (!cs.length) fail('No customer charges waiting. Run the charges first.');
      var g = groupBy(cs, function (c) { return c.providerLe + '|' + c.customerId + '|' + c.period; });
      var made = [];
      Object.keys(g).forEach(function (k) {
        var list = g[k];
        var c0 = list[0];
        if (!inBu(p, c0.provider)) return;
        var cust = customer(s, c0.customerId);
        var net = sum(list, function (c) { return c.amount; });
        var vat = r2(net * vatOf(s, c0.providerLe));
        var rev = groupBy(list, function (c) { return c.kind === 'TRANSPORT' ? '4140' : (c.kind === 'DAMAGE' || c.kind === 'LOSS') ? '4150' : '4100'; });
        var lines = [{ account: '1200', dr: r2(net + vat), sub: cust.name }];
        Object.keys(rev).forEach(function (a) { lines.push({ account: a, cr: sum(rev[a], function (c) { return c.amount; }) }); });
        lines.push({ account: '2200', cr: vat });
        var t = addTx(s, { kind: 'CUSTOMER_AR', le: c0.providerLe, title: 'Rental invoice to ' + cust.name + ' · ' + c0.period, refs: { customerId: cust.id, chargeIds: list.map(function (c) { return c.id; }), requestId: c0.requestId },
          entered: { currency: c0.currency, amount: r2(net + vat) }, lines: normalise(lines), open: r2(net + vat) });
        list.forEach(function (c) { c.status = 'INVOICED'; c.arNumber = t.number; });
        made.push(t.number);
      });
      if (!made.length) fail('These charges belong to another BU.');
      log(s, p, 'Invoiced the customer(s): ' + made.join(', '), {});
      return { invoices: made };
    }
  };
  A.billProject = {
    who: ['finance', 'receiver-review', 'ic-finance'],
    run: function (s, p, x) {
      var prj = project(s, x.projectId);
      if (!prj || prj.type !== 'contract') fail('Only a customer project is billed.');
      if (!inBu(p, prj.bu)) fail('Only ' + buName(s, prj.bu) + ' bills its customer.');
      var costs = s.tx.filter(function (t) { return (t.kind === 'PROJECT_COST' || t.kind === 'CROSS_CHARGE' || t.kind === 'OWN_COST') && t.refs.projectId === prj.id && t.billable && !t.billed; });
      if (!costs.length) fail('No billable equipment cost on ' + prj.number + ' yet (it comes with the intercompany invoice).');
      var cost = sum(costs, function (t) { return t.amount; });
      var leP = leOf(s, prj.bu);
      var bill = r2(cost * (1 + prj.markupPct));
      var vat = r2(bill * vatOf(s, leP.id));
      var cust = customer(s, prj.customer);
      var ppm = s.settings.s2Billing === 'PPM';
      var t = addTx(s, { kind: ppm ? 'PROJECT_BILL' : 'CUSTOMER_AR', le: leP.id,
        title: (ppm ? 'Project invoice ' : 'EquipRite rental invoice (OD-07 b) ') + prj.number + ' to ' + cust.name + ' (cost + ' + Math.round(prj.markupPct * 100) + ' %)',
        refs: { projectId: prj.id, customerId: cust.id, costTxs: costs.map(function (q) { return q.id; }) },
        entered: { currency: leP.currency, amount: r2(bill + vat) }, lines: normalise([{ account: '1200', dr: r2(bill + vat), sub: cust.name }, { account: ppm ? '4200' : '4100', cr: bill, sub: prj.number }, { account: '2200', cr: vat }]),
        open: r2(bill + vat), cost: cost, margin: r2(bill - cost), note: ppm ? 'Billed by PPM under the contract (OD-07 a).' : 'Invoiced by EquipRite from ProjectCo; the IC cost lines are non-billable on the contract, so the customer is never billed twice.' });
      if (!ppm) costs.forEach(function (q) { q.nonBillableOnContract = true; });
      costs.forEach(function (q) { q.billed = t.number; });
      log(s, p, 'Billed ' + cust.name + ' for ' + prj.number + ': ' + mny(bill, leP.currency) + ' (equipment cost ' + mny(cost, leP.currency) + ')', { projectId: prj.id });
      return { number: t.number, bill: bill };
    }
  };
  A.customerPays = {
    who: ['desk', 'finance', 'owner-finance', 'ic-finance'],
    run: function (s, p, x) {
      var t = byId(s.tx, x.txId);
      if (!t || (t.kind !== 'CUSTOMER_AR' && t.kind !== 'PROJECT_BILL') || !(t.open > 0)) fail('Nothing open to collect.');
      var cust = customer(s, t.refs.customerId);
      addTx(s, { kind: 'CUSTOMER_RECEIPT', le: t.le, title: 'Receipt from ' + cust.name + ' for ' + t.number, refs: { customerId: cust.id, invoiceTx: t.id, requestId: t.refs.requestId, projectId: t.refs.projectId },
        lines: [{ account: '1100', dr: t.open }, { account: '1200', cr: t.open, sub: cust.name }] });
      t.open = 0;
      t.status = 'SETTLED';
      log(s, p, cust.name + ' paid ' + t.number, {});
    }
  };
  A.settleDeposit = {
    who: ['desk'],
    run: function (s, p, x) {
      var r = requestOf(s, x.requestId);
      if (!r || !r.deposit || r.deposit.settled) fail('No deposit to settle.');
      if (r.lines.some(function (l) { return l.status !== 'CLOSED' && l.status !== 'LOST'; })) fail('Settle the deposit after the return inspection.');
      var open = s.tx.filter(function (t) { return t.kind === 'CUSTOMER_AR' && t.refs.customerId === r.customerId && t.open > 0 && (t.refs.chargeIds || []).some(function (id) { var c = byId(s.charges, id); return c && c.requestId === r.id; }); });
      var dep = r.deposit.amount;
      var applied = 0;
      var lines = [{ account: '2300', dr: dep, sub: customer(s, r.customerId).name }];
      open.forEach(function (t) { var a = Math.min(t.open, dep - applied); if (a > 0) { applied = r2(applied + a); t.open = r2(t.open - a); if (!t.open) t.status = 'SETTLED'; } });
      if (applied) lines.push({ account: '1200', cr: applied, sub: customer(s, r.customerId).name, memo: 'applied to open invoices' });
      if (dep - applied > 0) lines.push({ account: '1100', cr: r2(dep - applied), memo: 'refunded' });
      addTx(s, { kind: 'DEPOSIT_SETTLE', le: r.lines[0].providerLe, title: 'Deposit settled on ' + r.number, refs: { requestId: r.id, customerId: r.customerId }, lines: lines });
      r.deposit.settled = { at: s.today, applied: applied, refunded: r2(dep - applied) };
      log(s, p, 'Settled the deposit on ' + r.number + ': ' + mny(applied, le(s, r.lines[0].providerLe).currency) + ' applied, ' + mny(dep - applied, le(s, r.lines[0].providerLe).currency) + ' refunded', { requestId: r.id });
    }
  };

  // Setup (MC-FR-05): a new agreement version keeps the charges priced on the old one.
  A.setAgreementRate = {
    who: ['ic-finance'],
    run: function (s, p, x) {
      var ag = agreement(s, x.agreementId);
      if (!ag || !ag.rates[x.cls]) fail('No such rate.');
      var day = Number(x.day);
      var week = Number(x.week);
      if (!(day > 0 && week > 0)) fail('Give a day and a week rate.');
      ag.versions.push({ version: ag.version + 1, from: s.today, approvedBy: p.name, note: x.cls + ': ' + ag.rates[x.cls].day + '/' + ag.rates[x.cls].week + ' → ' + day + '/' + week });
      ag.version += 1;
      ag.rates = Object.assign({}, ag.rates);
      ag.rates[x.cls] = { day: day, week: week };
      log(s, p, ag.number + ' v' + ag.version + ': ' + x.cls + ' ' + day + '/day, ' + week + '/week', {});
    }
  };
  A.setSetting = {
    who: ['ic-finance'],
    run: function (s, p, x) {
      if (!(x.key in s.settings)) fail('No such setting.');
      var v = x.value;
      var LIMITS = { requesterThreshold: [0, 1e9], disputeDays: [1, 30], cutoffDay: [1, 28], damageThreshold: [0, 1e9], lossMarkupPct: [0, 1] };
      var CHOICES = { onHire: ['RECEIPT', 'DISPATCH'], s2Billing: ['PPM', 'EQUIPRITE'], invoicing: ['PAIR'], billingFrequency: ['MONTHLY'], groupCurrency: ['AED'] };
      if (typeof s.settings[x.key] === 'number') {
        v = Number(v);
        var lim = LIMITS[x.key] || [0, 1e9];
        if (!isFinite(v) || v < lim[0] || v > lim[1]) fail('Give a number from ' + lim[0] + ' to ' + lim[1] + '.');
        if (x.key === 'cutoffDay' || x.key === 'disputeDays') v = Math.round(v);
      }
      if (typeof s.settings[x.key] === 'boolean') v = v === true || v === 'true';
      if (CHOICES[x.key] && CHOICES[x.key].indexOf(v) === -1) fail('Choose one of: ' + CHOICES[x.key].join(', ') + '.');
      s.settings[x.key] = v;
      log(s, p, 'Setting ' + x.key + ' = ' + v, {});
    }
  };
  A.setRelation = {
    who: ['ic-finance'],
    run: function (s, p, x) { var r = byId(s.icRelations, x.id); if (!r) fail('No such relationship.'); r.allowed = !!x.allowed; log(s, p, (r.allowed ? 'Allowed ' : 'Stopped ') + buName(s, r.provider) + ' → ' + buName(s, r.receiver), {}); }
  };
  A.markRead = { run: function (s, p) { s.notifications.forEach(function (n) { if (n.readBy.indexOf(p.id) === -1 && visibleTo(n, p)) n.readBy.push(p.id); }); } };
  function visibleTo(n, p) {
    if (p.roles.indexOf('admin') !== -1) return true;
    var t = n.to || {};
    if (t.bu && p.bus.indexOf(t.bu) === -1) return false;
    if (t.roles && !t.roles.some(function (r) { return p.roles.indexOf(r) !== -1; })) return false;
    return true;
  }

  /** Runs one action on a copy of the state: { ok, state, result } or { ok: false, error } (the state unchanged). */
  function apply(state, type, payload) {
    var a = A[type];
    if (!a) return { ok: false, error: 'Unknown action ' + type, state: state };
    var s = clone(state);
    var p = persona(s);
    try {
      if (a.who && !a.who.some(function (r) { return can(p, r); })) fail(p.name + ' (' + p.title + ') cannot do this: ' + type + '.');
      var result = a.run(s, p, payload || {});
      return { ok: true, state: s, result: result || null };
    } catch (e) {
      if (!e.user) { console.error('[fxEngine]', type, e); }
      return { ok: false, error: e.message, state: state };
    }
  }

  return {
    apply: apply, actions: Object.keys(A), sourcing: sourcing, relationType: relationType, rental: rental, rate: rate, persona: persona, visibleTo: visibleTo,
    lineCharges: lineCharges, certCheck: certCheck, busy: busy, isWeekend: isWeekend,
    util: { addDays: addDays, diffDays: diffDays, monthOf: monthOf, monthEnd: monthEnd, monthStart: monthStart, nextMonth: nextMonth, r2: r2, sum: sum, byId: byId, clone: clone, dow: dow },
    lookups: { bu: bu, le: le, leOf: leOf, country: country, unit: unitOf, project: project, customer: customer, agreement: agreement, request: requestOf, line: lineOf, buName: buName, leShort: leShort, can: can, inBu: inBu }
  };
});
