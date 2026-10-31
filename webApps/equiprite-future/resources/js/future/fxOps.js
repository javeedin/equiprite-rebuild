define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine', 'resources/js/future/fxViews'], function (Seed, E, V) {
  'use strict';

  /**
   * EquipRite Future · the owner and the site (Approve & allocate, Yard, Receive, hours, moves): what those three
   * screens show beyond their views (fxViews approvals, yard, site, hours), and the confirmation each action shows
   * before it runs. Pure functions of the state (store.get()).
   *
   *   approvals(s)                 the sourcing BU's lines, each with its unit options (preferred first, usable or why not)
   *   yard(s)                      to ship, out, to collect, to inspect, in repair, the fleet
   *   site(s)                      to receive, on hire (the hours grid, the moves and what each means for the money)
   *   ask(s, kind, ids, form)      an action's confirmation: what EquipRite does, the money, what Fusion would do (the
   *                                transactions and their accounting from a dry run of the engine, never posted), who is
   *                                told, and the payload. { def, form, preview }
   *   exportSpec(model, list)      a list as exportKit.run takes it ({ name, title, subtitle, rows, columns })
   */
  var U = E.util;
  var L = E.lookups;
  var F = V.fmt;
  var REL = V.REL;
  var TYPE = V.TYPE;
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // The roles each action of these screens needs (fxEngine's `who`): a button shows only when the engine would take it.
  var WHO = {
    approveLine: ['owner-em'], rejectLine: ['owner-em'], shipLine: ['yard'], returnLine: ['yard'], inspectLine: ['yard', 'owner-em'], repairDone: ['owner-em', 'yard'],
    receiveLine: ['site', 'desk'], logHours: ['site'], fillHours: ['site'], approveHours: ['requester', 'receiver-review'], reportBreakdown: ['site'],
    offHire: ['site', 'desk'], redeploy: ['requester', 'site'], moveToCompany: ['requester'], reportLoss: ['site', 'owner-em']
  };
  function may(s, type) { var p = E.persona(s); return (WHO[type] || []).some(function (r) { return L.can(p, r); }); }

  // Fusion's transactions as the screens name them (fxViews TXK).
  var TXK = {
    TO_SHIP: 'Transfer order shipped', TO_RECEIPT: 'Transfer order received', TO_RETURN: 'Return transfer order', ASSET_CUSTODY: 'Asset location update',
    ASSET_RETIRE: 'Asset retired', STOCK_ISSUE: 'Stock issued (lost)', DEPOSIT: 'Deposit'
  };

  // ── Small helpers ──────────────────────────────────────────────────────────────────────────────────────────────
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }
  function names(list) {
    var n = (list || []).filter(Boolean);
    if (n.length < 2) return n.join('');
    return n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
  }
  function orNames(list) {
    var n = (list || []).filter(Boolean);
    if (n.length < 2) return n.join('');
    return n.slice(0, -1).join(', ') + ' or ' + n[n.length - 1];
  }
  /** "FleetCo Fleet's", "ProjectCo Projects'". */
  function poss(n) { return /s$/.test(n) ? n + '\'' : n + '\'s'; }
  /** "3 Nov – 20 Dec 2026" (the year once when both dates share it). */
  function range(a, b) { return a && b && a.slice(0, 4) === b.slice(0, 4) ? F.short(a) + ' – ' + F.date(b) : F.date(a) + ' – ' + F.date(b); }
  function sentence(t) { var x = String(t || '').trim(); return x && !/[.!?]$/.test(x) ? x + '.' : x; }
  function person(name) { return Seed.PERSONAS.filter(function (p) { return p.name === name; })[0] || null; }
  function who(name) { var p = person(name); return { name: name || '', initials: p ? p.initials : String(name || '?').slice(0, 2).toUpperCase(), title: p ? p.title : '' }; }
  /** The people of the demo (never Admin) in a BU with any of these roles, but not exceptId. */
  function people(bu, roles, exceptId) {
    return Seed.PERSONAS.filter(function (p) {
      return p.roles.indexOf('admin') === -1 && p.id !== exceptId && p.bus.indexOf(bu) !== -1 && p.roles.some(function (r) { return roles.indexOf(r) !== -1; });
    }).map(function (p) { return p.name; });
  }
  function countryName(s, code) { var c = L.country(s, code); return c ? c.name : code; }
  function weekendText(s, code) { var c = L.country(s, code); return c ? c.weekend.map(function (x) { return DOW[x]; }).join('–') : ''; }
  function orgName(s, id) { var o = U.byId(s.orgs, id); return o ? o.name : (id || ''); }
  function nbv(u) { return u.hold === 'ASSET' ? U.r2(u.asset.cost - u.asset.accDep) : u.stock.bookValue; }
  function holdText(u) { return u.hold === 'ASSET' ? 'Asset ' + u.asset.number : 'Stock item ' + u.stock.item; }
  function ownerCur(s, u) { return L.leOf(s, u.owner).currency; }
  function priceText(price) { return price ? F.money(price.week, price.currency) + '/week or ' + F.money(price.day, price.currency) + '/day' : 'No price'; }
  function agreementText(s, l) {
    var ag = L.agreement(s, l.agreementId);
    if (ag) return ag.number + ' v' + ag.version;
    return l.relation === 'SAME_BU' ? 'Own equipment: internal cost rate' : 'No agreement';
  }
  function forText(s, r) {
    var prj = L.project(s, r.projectId);
    var cust = L.customer(s, r.customerId);
    if (r.type === 'CUSTOMER_RENTAL') return { main: cust ? cust.name : '', sub: 'Customer rental · ' + L.leShort(s, r.requestingLe) + '\'s own customer' };
    return { main: prj ? prj.number + ' · ' + prj.name : '', sub: (r.type === 'CUSTOMER_PROJECT' ? 'Customer project for ' + (cust ? cust.name : '') : 'Internal project') + (r.task ? ' · task ' + r.task : '') };
  }
  /** The org a stock unit's transfer order goes to (fxEngine shipLine): the owner's own deployment org in the site's country (GR-6). */
  function destOrg(s, u, r, rel) {
    var ownerLe = L.leOf(s, u.owner).id;
    var orgs = s.orgs || [];
    return orgs.filter(function (g) { return g.le === ownerLe && g.country === r.country && g.kind === (rel === 'CUSTOMER' ? 'customer' : 'deploy'); })[0]
      || orgs.filter(function (g) { return g.le === ownerLe && g.country === r.country && g.kind === 'deploy'; })[0] || null;
  }
  /** A unit's certificate for a country, in words, as fxEngine.certCheck decides it (valid through the hire's end). */
  function certFor(s, u, code, to) {
    var c = (u.certs || []).filter(function (x) { return x.country === code; });
    if (!c.length) return { ok: false, text: 'No certificate for ' + countryName(s, code) };
    var bad = c.filter(function (x) { return x.expiry < to; })[0];
    if (bad) return { ok: false, text: bad.type + ' (' + code + ') ends ' + F.date(bad.expiry) + ', before the hire ends' };
    return { ok: true, text: c.map(function (x) { return x.type + ' to ' + F.date(x.expiry); }).join('; ') };
  }
  /** What stopping the hire today leaves charged: "charged up to 13 Nov 2026", or nothing when it started today. */
  function chargedTo(s, l) {
    var last = U.addDays(s.today, -1);
    return l.events.onHire && last >= l.events.onHire ? 'charged up to ' + F.date(last) : 'no day charged (the hire started today)';
  }
  function lineOf(s, rid, lid) { var r = L.request(s, rid); return r ? U.byId(r.lines, lid) : null; }
  function currentSeg(l) { return l.segments.length ? l.segments[l.segments.length - 1] : null; }

  /** What the relationship means for the money of this line, in a sentence. */
  function moneyWords(s, r, l) {
    var owner = L.leShort(s, l.providerLe);
    var user = L.leShort(s, r.requestingLe);
    var prj = L.project(s, (currentSeg(l) || {}).projectId || r.projectId);
    var p = priceText(l.price);
    var ag = L.agreement(s, l.agreementId);
    if (l.relation === 'SAME_BU') return 'Own equipment at ' + p + ' (internal cost rate): the cost goes straight to ' + (prj ? prj.number : 'the project') + ' in PPM, no invoice.';
    if (l.relation === 'SAME_LE') return 'One legal entity: cross-charged to ' + (prj ? prj.number : 'the project') + ' in PPM at ' + p + ', no invoice and no tax (OD-14).';
    if (l.relation === 'CUSTOMER') return owner + ' invoices ' + (L.customer(s, r.customerId) || {}).name + ' at ' + p + ' (' + (ag ? ag.number : '') + '); the deposit is applied or refunded at the end.';
    var base = 'Charged monthly at ' + p + ' on ' + owner + '\'s statement to ' + L.buName(s, r.requestingBu) + ', then an invoice pair: the AR invoice in ' + owner
      + ', the AP invoice in ' + user + ' coded to ' + (prj ? prj.number : 'the project') + '.';
    if (l.relation === 'IC_CROSS_BORDER') return base + ' Cross-border: ' + user + ' books it in ' + L.le(s, r.requestingLe).currency + ' at the day\'s rate, self-assesses VAT (reverse charge) and withholds ' + Math.round(((ag && ag.wht) || 0) * 100) + ' % at payment.';
    return base + ' Domestic VAT at ' + Math.round(L.country(s, L.le(s, l.providerLe).country).vat * 100) + ' %.';
  }

  // ── Approve & allocate ────────────────────────────────────────────────────────────────────────────────────────
  /** What approving this line with this unit sets off. */
  function setsOff(s, r, l, u, meId) {
    var out = [];
    var owner = L.leOf(s, u.owner);
    var yardPeople = people(u.owner, ['yard'], meId);
    out.push({ icon: 'oj-ux-ico-fullfilment-box', text: poss(L.buName(s, u.owner)) + ' yard' + (yardPeople.length ? ' (' + names(yardPeople) + ')' : '') + ' is told to ship ' + u.serial + ' to ' + r.site + '.' });
    if (u.hold === 'STOCK') {
      var dest = destOrg(s, u, r, l.relation);
      out.push(dest ? { icon: 'oj-ux-ico-swap', text: 'When it ships, Fusion Inventory makes a transfer order inside ' + owner.short + ': ' + orgName(s, u.home) + ' → ' + dest.name + ' (GR-6).' }
        : { icon: 'oj-ux-ico-warning', text: owner.short + ' has no deployment org in ' + countryName(s, r.country) + ': a transfer order may not cross into another company, so it could not ship (GR-6).', bad: true });
    } else {
      out.push({ icon: 'oj-ux-ico-location-pin', text: 'When it ships, Fusion Assets updates the location of asset ' + u.asset.number + ': no accounting, it stays on ' + owner.short + '\'s books (GR-1).' });
    }
    if (r.country !== u.country) {
      out.push({ icon: 'oj-ux-ico-globe', text: 'It crosses into ' + countryName(s, r.country) + ': a temporary import opens when it ships (pro-forma invoice, packing list, certificates), to re-export by ' + F.date(U.addDays(r.to, 30)) + '.' });
    }
    var req = people(r.requestingBu, ['requester', 'site'], meId);
    out.push({ icon: 'oj-ux-ico-notification', text: L.buName(s, r.requestingBu) + (req.length ? ' (' + names(req) + ')' : '') + ' is told it was approved.' });
    return out;
  }
  function option(s, r, l, u, o, meId) {
    var cert = certFor(s, u, r.country, r.to);
    var b = E.busy(s, u.id, r.from, r.to, l.id);
    var why;
    if (b) why = 'Booked on ' + b.request + ' until ' + F.date(b.to);
    else if (!cert.ok) why = cert.text;
    else if (u.status === 'IN_REPAIR') why = 'In repair';
    else if (!o.usable) why = 'No price for ' + l.cls + ' in ' + agreementText(s, l);
    else why = 'Free for these dates · ' + cert.text + (u.status === 'INSPECTION' ? ' · back from a hire, not inspected yet' : '');
    var where = u.custody.label || orgName(s, u.custody.org) || '';
    return { unitId: u.id, serial: u.serial, name: u.name, hold: u.hold, holdText: holdText(u), preferred: o.preferred, usable: !!o.usable, why: why, tone: o.usable ? 'ok' : 'bad',
      where: where + (where ? ' · ' : '') + countryName(s, u.country), setsOff: setsOff(s, r, l, u, meId) };
  }
  function approvals(s) {
    var v = V.approvals(s);
    var me = V.me(s);
    var rows = v.rows.map(function (x) {
      var r = L.request(s, x.requestId);
      var l = lineOf(s, r.id, x.id);
      var reqLe = L.le(s, r.requestingLe);
      var days = U.diffDays(r.to, r.from) + 1;
      var opts = x.options.map(function (o) { return option(s, r, l, L.unit(s, o.unitId), o, me.id); });
      opts.sort(function (a, b) { return (b.preferred - a.preferred) || (b.usable - a.usable) || a.serial.localeCompare(b.serial); });
      var def = opts.filter(function (o) { return o.preferred && o.usable; })[0] || opts.filter(function (o) { return o.usable; })[0] || null;
      var f = forText(s, r);
      var ag = L.agreement(s, l.agreementId);
      var desk = x.needsDeposit ? Seed.PERSONAS.filter(function (p) { return p.roles.indexOf('desk') !== -1 && p.bus.indexOf(l.provider) !== -1; })[0] : null;
      return {
        id: l.id, requestId: r.id, number: r.number, type: r.type, typeText: TYPE[r.type], cls: l.cls, clsName: x.clsName,
        company: reqLe.short, buName: L.buName(s, r.requestingBu), forMain: f.main, forSub: f.sub,
        site: r.site, country: countryName(s, r.country), countryCode: r.country, from: r.from, to: r.to, dates: range(r.from, r.to), days: plural(days, 'day'),
        relation: l.relation, relationLabel: x.relationLabel, relationTone: x.relationTone, relationWords: x.relationWords, money: moneyWords(s, r, l),
        agreement: agreementText(s, l), price: priceText(l.price), estimate: l.estimate ? F.money(l.estimate, reqLe.currency) + ' for ' + plural(days, 'day')
          + (l.price && l.price.currency !== reqLe.currency ? ' (in ' + reqLe.short + '\'s ' + reqLe.currency + ', at today\'s rate)' : '') : '',
        requester: who(r.createdBy), raised: F.date(r.createdAt), note: r.note || '',
        options: opts, defaultPick: def ? def.unitId : '', usable: opts.filter(function (o) { return o.usable; }).length,
        needsDeposit: !!x.needsDeposit, depositText: x.needsDeposit ? (L.customer(s, r.customerId) || {}).name + '\'s deposit (' + Math.round(((ag && ag.depositPct) || 0) * 100)
          + ' % of a month) has not been received: the rental desk takes it in Customer billing, then you can approve.' : '',
        depositBy: desk ? { id: desk.id, first: desk.name.split(' ')[0] } : null
      };
    });
    var rels = [];
    rows.forEach(function (r) { if (rels.indexOf(r.relation) === -1) rels.push(r.relation); });
    var chips = [{ key: 'all', label: 'All', count: rows.length }].concat(['IC_DOMESTIC', 'IC_CROSS_BORDER', 'SAME_LE', 'CUSTOMER', 'SAME_BU'].filter(function (k) { return rels.indexOf(k) !== -1; })
      .map(function (k) { return { key: k, label: REL[k].label, count: rows.filter(function (r) { return r.relation === k; }).length }; }));
    return { rows: rows, count: rows.length, scope: v.scope, busText: me.busText, me: me, chips: chips, canApprove: may(s, 'approveLine'),
      empty: 'Nothing to approve for ' + me.busText, todayText: me.todayText };
  }

  // ── Yard ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function yardLine(s, x) {
    var r = L.request(s, x.requestId);
    var l = lineOf(s, r.id, x.id);
    var u = L.unit(s, l.unitId);
    var owner = L.leOf(s, u.owner);
    return { r: r, l: l, u: u, owner: owner, base: {
      id: l.id, requestId: r.id, number: r.number, typeText: TYPE[r.type], serial: u.serial, unitName: u.name, hold: u.hold, holdText: holdText(u), unitId: u.id,
      user: L.leShort(s, r.requestingLe) + ' · ' + L.buName(s, r.requestingBu), forMain: forText(s, r).main, site: r.site, country: countryName(s, r.country),
      dates: range(r.from, r.to), relationLabel: x.relationLabel, relationTone: x.relationTone, home: orgName(s, u.home)
    } };
  }
  function shipText(s, r, l, u) {
    var owner = L.leOf(s, u.owner);
    if (u.hold === 'STOCK') {
      var dest = destOrg(s, u, r, l.relation);
      return dest ? { text: 'Transfer order inside ' + owner.short + ': ' + orgName(s, u.home) + ' → ' + dest.name, tone: 'run' }
        : { text: 'No ' + owner.short + ' deployment org in ' + countryName(s, r.country) + ': cannot ship (GR-6)', tone: 'bad' };
    }
    return { text: 'Asset location update, no accounting', tone: 'na' };
  }
  function yard(s) {
    var v = V.yard(s);
    var me = V.me(s);
    var toShip = v.toShip.map(function (x) {
      var y = yardLine(s, x);
      var st = shipText(s, y.r, y.l, y.u);
      var cross = y.r.country !== y.u.country;
      return Object.assign(y.base, { fusion: st.text, fusionTone: st.tone, cross: cross, crossText: cross ? 'Temporary import into ' + countryName(s, y.r.country) + ': pro-forma invoice, packing list, certificates' : '',
        approved: y.l.events.approved ? 'Approved ' + F.date(y.l.events.approved) + (y.l.approvedBy ? ' by ' + y.l.approvedBy : '') : '', from: F.date(y.r.from) });
    });
    var out = v.out.map(function (x) {
      var y = yardLine(s, x);
      var c = y.l.customsId ? U.byId(s.customs, y.l.customsId) : null;
      return Object.assign(y.base, { status: y.l.status, statusText: x.words, stage: x.stage, where: y.u.custody.label || orgName(s, y.u.custody.org), whereCountry: countryName(s, y.u.country),
        since: y.l.status === 'ON_HIRE' ? 'On hire since ' + F.date(y.l.events.onHire) : 'Shipped ' + F.date(y.l.events.shipped), project: x.project || '',
        customs: c ? c.permit + ' · re-export by ' + F.date(c.reexportBy) : '' });
    });
    var toCollect = v.toCollect.map(function (x) {
      var y = yardLine(s, x);
      var c = y.l.customsId ? U.byId(s.customs, y.l.customsId) : null;
      return Object.assign(y.base, { offHire: 'Off hire ' + F.date(y.l.events.offHire),
        fusion: y.u.hold === 'STOCK' && y.l.toOrg ? 'Return transfer order inside ' + y.owner.short + ': ' + orgName(s, y.l.toOrg) + ' → ' + orgName(s, y.u.home) : 'Asset location back to ' + orgName(s, y.u.home) + ', no accounting',
        fusionTone: y.u.hold === 'STOCK' && y.l.toOrg ? 'run' : 'na', customs: c && c.status === 'OPEN' ? 'Closes temporary import ' + c.permit + ' (re-exported)' : '' });
    });
    var threshold = s.settings.damageThreshold;
    var toInspect = v.toInspect.map(function (x) {
      var y = yardLine(s, x);
      var ic = y.l.relation.indexOf('IC_') === 0;
      return Object.assign(y.base, { returned: 'Back ' + F.date(y.l.events.returned), cur: (y.l.price && y.l.price.currency) || y.owner.currency,
        threshold: ic ? 'Damage above ' + F.money(threshold, s.settings.groupCurrency) + ' needs ' + poss(L.buName(s, y.r.requestingBu)) + ' acceptance (OD-11)' : 'Damage is charged on the next charges' });
    });
    var repairs = s.units.filter(function (u) { return L.inBu(E.persona(s), u.owner) && u.status === 'IN_REPAIR'; }).map(function (u) {
      var last = null;
      s.requests.forEach(function (r) { r.lines.forEach(function (l) { if (l.unitId === u.id && l.inspection && l.inspection.damage > 0 && (!last || l.inspection.date >= last.l.inspection.date)) last = { r: r, l: l }; }); });
      return { unitId: u.id, serial: u.serial, unitName: u.name, holdText: holdText(u), home: orgName(s, u.home),
        damage: last ? F.money(last.l.inspection.damage, (last.l.price && last.l.price.currency) || ownerCur(s, u)) + ' on ' + last.r.number : '',
        note: last ? (last.l.inspection.note || 'No note') + ' · ' + plural(last.l.inspection.photos, 'photo') + ' · ' + F.date(last.l.inspection.date) + ' by ' + last.l.inspection.by : '' };
    });
    var fleet = s.units.filter(function (u) { return L.inBu(E.persona(s), u.owner); }).map(function (u) {
      var row = v.fleet.filter(function (f) { return f.id === u.id; })[0] || {};
      var customs = s.customs.filter(function (c) { return c.unitId === u.id && c.status !== 'CLOSED'; }).map(function (c) {
        return { text: c.permit + ' · ' + c.from + ' → ' + c.to + (c.status === 'OPEN' ? ' · re-export by ' + F.date(c.reexportBy) : ' · ' + (c.outcome || 'regularise')), bad: c.status !== 'OPEN' || U.diffDays(c.reexportBy, s.today) <= 14 };
      });
      return { id: u.id, serial: u.serial, name: u.name, cls: u.cls, clsName: (U.byId(s.classes, u.cls) || {}).name || u.cls, owner: L.buName(s, u.owner), status: u.status, statusText: row.statusText,
        tone: { AVAILABLE: 'ok', OUT: 'run', INSPECTION: 'todo', IN_REPAIR: 'todo', LOST: 'bad' }[u.status] || 'na',
        where: row.where || orgName(s, u.home), country: countryName(s, u.country), holdText: u.hold === 'ASSET' ? 'Asset' : 'Stock', ref: u.hold === 'ASSET' ? u.asset.number : u.stock.item,
        value: F.money(nbv(u), ownerCur(s, u)), valueNote: u.hold === 'ASSET' ? 'net book value' : 'book value',
        certs: (u.certs || []).map(function (c) { var left = U.diffDays(c.expiry, s.today); return { country: c.country, type: c.type, expiry: F.date(c.expiry), expired: c.expiry < s.today, soon: left >= 0 && left <= 30,
          text: c.country + ' · ' + c.type + ' · ' + (c.expiry < s.today ? 'expired ' : 'to ') + F.date(c.expiry) }; }),
        customs: customs };
    });
    return { toShip: toShip, out: out, toCollect: toCollect, toInspect: toInspect, repairs: repairs, fleet: fleet, me: me, busText: me.busText,
      counts: { ship: toShip.length, out: out.length, collect: toCollect.length, inspect: toInspect.length, repair: repairs.length, fleet: fleet.length },
      canShip: may(s, 'shipLine'), canReturn: may(s, 'returnLine'), canInspect: may(s, 'inspectLine'), canRepair: may(s, 'repairDone') };
  }

  // ── On site ───────────────────────────────────────────────────────────────────────────────────────────────────
  /** The days on hire up to today (or the day before off hire), each with its hours, the site's weekend marked. */
  function hoursGrid(s, r, l) {
    var out = [];
    if (!l.events.onHire) return out;
    var end = l.events.offHire ? U.addDays(l.events.offHire, -1) : s.today;
    var rec = {};
    V.hours(s, l.id).forEach(function (h) { rec[h.date] = h; });
    for (var d = l.events.onHire; d <= end; d = U.addDays(d, 1)) {
      var h = rec[d];
      var we = E.isWeekend(s, r.country, d);
      var state = !h ? (we ? 'weekend' : 'empty') : (h.approved ? 'approved' : 'waiting');
      out.push({ date: d, dow: DOW[U.dow(d)], day: +d.slice(8, 10), label: F.short(d), weekend: we, recorded: !!h, usage: h ? h.usage : 0, standby: h ? h.standby : 0,
        approved: !!(h && h.approved), state: state, text: h ? h.usage + ' h' : (we ? 'Off' : '—'), sub: h && h.standby ? '+' + h.standby + ' sb' : '',
        title: DOW[U.dow(d)] + ' ' + F.date(d) + (we ? ' (weekend)' : '') + ': ' + (h ? h.usage + ' h use, ' + h.standby + ' h standby, ' + (h.approved ? 'approved' : 'waiting for approval') : 'nothing recorded') });
    }
    return out;
  }
  function handoverOptions(s, v, r, l) {
    // Own equipment goes through its owner; a customer rental is with the customer, not on a group company's site.
    if (l.relation === 'SAME_BU' || r.type === 'CUSTOMER_RENTAL') return [];
    return v.otherCompanies.filter(function (o) {
      return o.country === r.country && o.bu !== r.requestingBu && o.bu !== l.provider
        && (s.agreements || []).some(function (a) { return a.status === 'ACTIVE' && a.provider === l.provider && a.receiver === o.bu; });
    });
  }
  function hire(s, v, x) {
    var r = L.request(s, x.requestId);
    var l = lineOf(s, r.id, x.id);
    var u = L.unit(s, l.unitId);
    var ag = L.agreement(s, l.agreementId);
    var me = V.me(s);
    var end = l.events.offHire ? U.addDays(l.events.offHire, -1) : s.today;
    var days = U.diffDays(end, l.events.onHire) + 1;
    var grid = hoursGrid(s, r, l);
    var rec = grid.filter(function (g) { return g.recorded; });
    var seg = currentSeg(l);
    var segments = l.segments.map(function (g, i) {
      var prj = L.project(s, g.projectId);
      var next = l.segments[i + 1];
      var from = g.from < l.events.onHire ? l.events.onHire : g.from;
      return { projectId: g.projectId, text: prj ? prj.number + ' · ' + prj.name : g.projectId, task: g.task, current: !next,
        period: (next ? F.short(from) + ' – ' + F.short(U.addDays(next.from, -1)) : 'from ' + F.short(from)) };
    });
    var cur = seg ? L.project(s, seg.projectId) : null;
    var rental = r.type === 'CUSTOMER_RENTAL';
    var redeployTo = rental ? [] : v.projects.filter(function (p) { return p.bu === r.requestingBu && (!seg || p.id !== seg.projectId); });
    var handTo = handoverOptions(s, v, r, l);
    var price = l.price || {};
    var total = U.diffDays(s.today, l.events.onHire);
    var minLeft = ag && ag.minDays && total < ag.minDays ? ag.minDays - total : 0;
    var loss = U.r2(nbv(u) * (1 + s.settings.lossMarkupPct));
    var approvers = people(r.requestingBu, ['requester', 'receiver-review']);
    return {
      id: l.id, requestId: r.id, number: r.number, typeText: TYPE[r.type], serial: u.serial, unitName: u.name, unitId: u.id, holdText: holdText(u),
      owner: L.leShort(s, l.providerLe) + ' · ' + L.buName(s, l.provider), relationLabel: x.relationLabel, relationTone: x.relationTone,
      site: r.site, country: countryName(s, r.country), weekend: weekendText(s, r.country), since: F.date(l.events.onHire), daysText: plural(days, 'day') + ' on hire',
      agreement: agreementText(s, l), price: priceText(l.price), segments: segments, moved: segments.length > 1, project: cur ? cur.number : '',
      rental: rental, forLabel: rental ? 'Customer' : 'Project', customer: rental ? ((L.customer(s, r.customerId) || {}).name || '') + ' · customer rental' : '',
      grid: grid, recorded: rec.length, usage: U.sum(rec, function (g) { return g.usage; }), standby: U.sum(rec, function (g) { return g.standby; }),
      waiting: rec.filter(function (g) { return !g.approved; }).length, approvedDays: rec.filter(function (g) { return g.approved; }).length,
      approvers: orNames(approvers), breakdowns: s.breakdowns.filter(function (b) { return b.lineId === l.id; }).map(function (b) { return F.date(b.date) + ': ' + plural(b.days, 'day') + ', ' + b.reason; }),
      moves: {
        breakdown: ag && ag.breakdownCredit ? 'A credit of ' + F.money(price.day, price.currency) + ' a day off this month\'s charges (' + ag.number + ').'
          : (l.relation === 'SAME_BU' ? 'Own equipment: no credit, the cost stays on the project.' : 'No breakdown credit in ' + agreementText(s, l) + '.'),
        offHire: 'The hire stops today: ' + chargedTo(s, l) + '.' + (minLeft ? ' Minimum hire ' + ag.minDays + ' days: ' + plural(minLeft, 'more day') + ' charged.' : '')
          + (ag && ag.transport && !l.inPlace ? ' Transport back ' + F.money(ag.transport, ag.currency) + '.' : ''),
        redeploy: redeployTo.length ? 'Charges go to the new project from today; until yesterday they stay on ' + (cur ? cur.number : 'this project') + '.'
          : (rental ? 'A customer rental has no project.' : 'No other project of ' + L.buName(s, r.requestingBu) + '.'),
        handover: rental ? 'The customer has it: off hire it, then raise a request for the group company.' : handTo.length ? 'Off hire for ' + L.leShort(s, r.requestingLe) + ' today; ' + L.buName(s, l.provider) + ' approves a new line and bills the other company directly (no sub-lending).'
          : (l.relation === 'SAME_BU' ? 'Own equipment: hand it over through its owner.' : 'No other group company\'s project in ' + countryName(s, r.country) + ' that ' + L.leShort(s, l.providerLe) + ' has an agreement with.'),
        loss: 'Charged at ' + F.money(loss, ownerCur(s, u)) + ': net book value ' + F.money(nbv(u), ownerCur(s, u)) + ' + ' + Math.round(s.settings.lossMarkupPct * 100) + ' % (OD-11).'
      },
      canRedeploy: redeployTo.length > 0, canHandover: handTo.length > 0, inPlace: !!l.inPlace, me: me.id
    };
  }
  function site(s) {
    var v = V.site(s);
    var me = V.me(s);
    var toReceive = v.toReceive.map(function (x) {
      var r = L.request(s, x.requestId);
      var l = lineOf(s, r.id, x.id);
      var u = L.unit(s, l.unitId);
      var stock = u.hold === 'STOCK' && l.toOrg && !l.inPlace;
      return { id: l.id, requestId: r.id, number: r.number, typeText: TYPE[r.type], serial: u.serial, unitName: u.name, holdText: holdText(u),
        owner: L.leShort(s, l.providerLe) + ' · ' + L.buName(s, l.provider), relationLabel: x.relationLabel, relationTone: x.relationTone, site: r.site, country: countryName(s, r.country),
        forMain: forText(s, r).main, shipped: l.inPlace ? 'Handed over on site ' + F.date(l.events.requested) : 'Shipped ' + F.date(l.events.shipped) + ' from ' + orgName(s, u.home),
        fusion: stock ? 'Transfer order ' + (l.toNumber || '') + ' received into ' + orgName(s, l.toOrg) : (l.inPlace ? 'Already on site: no transport' : 'No Fusion transaction at receipt (asset)'),
        fusionTone: stock ? 'run' : 'na', price: priceText(l.price) };
    });
    var onHire = v.onHire.map(function (x) { return hire(s, v, x); });
    return { toReceive: toReceive, onHire: onHire, me: me, busText: me.busText,
      counts: { receive: toReceive.length, onHire: onHire.length, waiting: U.sum(onHire, function (h) { return h.waiting; }) },
      can: { receive: may(s, 'receiveLine'), fill: may(s, 'fillHours'), log: may(s, 'logHours'), approve: may(s, 'approveHours'), breakdown: may(s, 'reportBreakdown'),
        offHire: may(s, 'offHire'), redeploy: may(s, 'redeploy'), handover: may(s, 'moveToCompany'), loss: may(s, 'reportLoss') } };
  }

  // ── The confirmation of an action: a dry run of the engine says what Fusion would do and who is told ────────────
  function txRows(s, after) {
    return after.tx.slice(s.tx.length).map(function (t) {
      return { number: t.number, company: L.le(after, t.le).short, kindText: TXK[t.kind] || t.kind, title: t.title, source: t.source, currency: t.currency,
        lines: t.lines.map(function (x) { return { account: x.account, name: x.name, dr: x.dr ? F.num(x.dr) : '', cr: x.cr ? F.num(x.cr) : '', memo: x.memo || '' }; }),
        noAccounting: !t.lines.length, note: t.note || (t.lines.length ? 'Accounting made by ' + L.le(after, t.le).short + '\'s Fusion: shown here, never posted by EquipRite.' : 'No accounting of its own.') };
    });
  }
  function customsRows(s, after) {
    var out = after.customs.slice(s.customs.length).map(function (c) {
      return { permit: c.permit, text: c.regime + ' ' + c.permit + ': ' + c.serial + ' from ' + countryName(after, c.from) + ' into ' + countryName(after, c.to) + ', declared at '
        + F.money(c.value, L.leOf(after, c.owner).currency) + '. Papers: ' + c.docs.join(', ').toLowerCase() + '. Re-export by ' + F.date(c.reexportBy) + '.' };
    });
    s.customs.forEach(function (c) {
      var n = U.byId(after.customs, c.id);
      if (n && n.status !== c.status) out.push({ permit: c.permit, text: c.regime + ' ' + c.permit + ' (' + c.serial + '): ' + (n.status === 'CLOSED' ? 'closes, ' + (n.outcome || '').toLowerCase() : (n.outcome || n.status)) + '.' });
    });
    return out;
  }
  function toldRows(s, after) {
    var n = after.notifications.length - s.notifications.length;
    return after.notifications.slice(0, Math.max(0, n)).reverse().map(function (x) {
      var to = Seed.PERSONAS.filter(function (p) { return p.roles.indexOf('admin') === -1 && E.visibleTo(x, p); }).map(function (p) { return p.name; });
      return { who: names(to) || 'No one in the demo', text: x.text };
    });
  }
  function loggedRows(s, after) {
    var n = after.log.length - s.log.length;
    return after.log.slice(0, Math.max(0, n)).reverse().map(function (x) { return sentence(x.what); });
  }
  function num(v, d) { var n = parseFloat(v); return isFinite(n) ? n : d; }

  function hoursNote(s, l) {
    var ag = L.agreement(s, l.agreementId);
    return 'Nothing in Fusion now: once the requester approves them, the month-end charge run prices the days on hire'
      + (ag && ag.standbyPct ? ', and standby hours at ' + Math.round(ag.standbyPct * 100) + ' % of the day rate (' + ag.number + ')' : '') + '.';
  }
  function chargesNote(l) {
    if (l.relation.indexOf('IC_') === 0) return 'It is a line of this month\'s charges: on the statement, then the invoice pair (the owner\'s AR, the user\'s AP coded to the project).';
    if (l.relation === 'CUSTOMER') return 'It is a line of this month\'s charges, on the customer\'s invoice.';
    return 'It is a line of this month\'s charges, posted to the project in PPM (no invoice).';
  }

  // Each kind: its action, its words, its fields and its payload. c = { r, l, u, ag, me, p }.
  var KINDS = {
    approve: {
      type: 'approveLine',
      def: function (s, c) {
        return { kicker: 'Approve & allocate · ' + L.buName(s, c.l.provider) + ' decides', title: 'Approve ' + c.r.number + ' with ' + c.u.serial,
          sub: c.u.name + ' for ' + L.leShort(s, c.r.requestingLe) + ' · ' + L.buName(s, c.r.requestingBu) + ', ' + forText(s, c.r).main + ', ' + range(c.r.from, c.r.to),
          confirm: 'Approve and allocate ' + c.u.serial, tone: 'ok', fields: [] };
      },
      payload: function (c, ids) { return { requestId: c.r.id, lineId: c.l.id, unitId: ids.unitId || c.l.preferredUnit }; },
      does: function (s, c) {
        return ['Allocates ' + c.u.serial + ' (' + c.u.name + ', ' + (c.u.hold === 'ASSET' ? 'asset ' + c.u.asset.number : 'stock item ' + c.u.stock.item) + ') to ' + c.r.number + ' and books it from ' + F.date(c.r.from) + ' to ' + F.date(c.r.to) + ': no other request can have it then.']
          .concat(setsOff(s, c.r, c.l, c.u, c.me.id).filter(function (x) { return !/Fusion|temporary import|org in/.test(x.text); }).map(function (x) { return x.text; }));
      },
      money: function (s, c) { return [moneyWords(s, c.r, c.l)]; },
      fusion: function (s, c) {
        return ['Nothing in Fusion at approval.'].concat(setsOff(s, c.r, c.l, c.u, c.me.id).filter(function (x) { return /Fusion|temporary import|org in/.test(x.text); }).map(function (x) { return x.text; }));
      }
    },
    refuse: {
      type: 'rejectLine',
      def: function (s, c) {
        return { kicker: 'Approve & allocate · ' + L.buName(s, c.l.provider) + ' decides', title: 'Refuse a line of ' + c.r.number,
          sub: c.l.cls + ' for ' + L.leShort(s, c.r.requestingLe) + ' · ' + L.buName(s, c.r.requestingBu) + ', ' + forText(s, c.r).main, confirm: 'Refuse the line', tone: 'danger',
          fields: [{ key: 'reason', type: 'textarea', label: 'Why (the requester sees it)', initial: '', required: true, placeholder: 'For example: the excavators are booked for the shutdown; ask again from 1 December' }] };
      },
      payload: function (c, ids, f) { return { requestId: c.r.id, lineId: c.l.id, reason: String(f.reason || '').trim() }; },
      does: function (s, c, f) {
        var req = people(c.r.requestingBu, ['requester'], c.me.id);
        return ['Refuses this line of ' + c.r.number + ': no unit is booked, the request\'s other lines go on.',
          (req.length ? names(req) : L.buName(s, c.r.requestingBu)) + ' see' + (req.length === 1 ? 's' : '') + ' the reason' + (String(f.reason || '').trim() ? ': "' + String(f.reason).trim() + '"' : '') + '.'];
      },
      fusion: function () { return ['Nothing in Fusion: no transaction, no accounting.']; }
    },
    ship: {
      type: 'shipLine',
      def: function (s, c) {
        return { kicker: 'Yard · ' + L.buName(s, c.u.owner), title: 'Ship ' + c.u.serial + ' for ' + c.r.number,
          sub: orgName(s, c.u.home) + ' → ' + c.r.site + ' (' + countryName(s, c.r.country) + ') for ' + L.leShort(s, c.r.requestingLe) + ' · ' + L.buName(s, c.r.requestingBu), confirm: 'Ship ' + c.u.serial, tone: 'ok', fields: [] };
      },
      payload: function (c) { return { requestId: c.r.id, lineId: c.l.id }; },
      does: function (s, c) {
        var site = people(c.r.requestingBu, ['site']);
        return ['Ships ' + c.u.serial + ' (' + c.u.name + ') from ' + orgName(s, c.u.home) + ' to ' + c.r.site + ', ' + countryName(s, c.r.country) + '.',
          'It shows as on the way until ' + poss(L.buName(s, c.r.requestingBu)) + ' site' + (site.length ? ' (' + names(site) + ')' : '') + ' confirms receipt; '
          + (s.settings.onHire === 'RECEIPT' ? 'the hire starts then (OD-05).' : 'the hire starts today, at dispatch (OD-05).')];
      },
      money: function (s, c) { return c.ag && c.ag.transport && !c.l.inPlace ? ['Transport out: ' + F.money(c.ag.transport, c.ag.currency) + ' on this month\'s charges (' + c.ag.number + ').'] : []; },
      fusion: function (s, c) {
        var owner = L.leOf(s, c.u.owner);
        var out = [];
        if (c.u.hold === 'STOCK') {
          var dest = destOrg(s, c.u, c.r, c.l.relation);
          out.push(dest ? 'Fusion Inventory: a transfer order inside ' + owner.short + ', from ' + orgName(s, c.u.home) + ' to ' + dest.name + ' (GR-6: stock moves stay inside the owner). It stays '
            + owner.short + '\'s stock: from the yard\'s inventory to in transit now, into the deployment org at receipt.' : 'No ' + owner.short + ' deployment org in ' + countryName(s, c.r.country) + ' (GR-6).');
        } else {
          out.push('Fusion Assets: the location of asset ' + c.u.asset.number + ' becomes ' + c.r.site + '. No accounting: the asset stays on ' + owner.short + '\'s books (GR-1).');
        }
        if (c.r.country !== c.u.country) out.push('Customs: the papers for a temporary import into ' + countryName(s, c.r.country) + ' go with it.');
        return out;
      }
    },
    receive: {
      type: 'receiveLine',
      def: function (s, c) {
        return { kicker: 'On site · ' + L.buName(s, c.r.requestingBu), title: 'Receive ' + c.u.serial + ' at ' + c.r.site,
          sub: c.u.name + ' from ' + L.leShort(s, c.l.providerLe) + ' · ' + L.buName(s, c.l.provider) + ' for ' + c.r.number, confirm: 'Confirm receipt', tone: 'ok', fields: [] };
      },
      payload: function (c) { return { requestId: c.r.id, lineId: c.l.id }; },
      does: function (s, c) {
        var start = s.settings.onHire === 'DISPATCH' ? (c.l.events.shipped || s.today) : s.today;
        return ['Confirms ' + c.u.serial + ' is at ' + c.r.site + (c.l.inPlace ? ' (handed over on site: no transport).' : '.'),
          'The hire starts ' + F.date(start) + ' (OD-05: ' + (s.settings.onHire === 'DISPATCH' ? 'at dispatch' : 'at receipt on site') + '), at ' + priceText(c.l.price) + '.'];
      },
      money: function (s, c) { return [moneyWords(s, c.r, c.l)]; },
      fusion: function (s, c) {
        var owner = L.leOf(s, c.u.owner);
        if (c.u.hold === 'STOCK' && c.l.toOrg && !c.l.inPlace) {
          var prj = L.project(s, c.r.projectId);
          return ['Fusion Inventory: transfer order ' + (c.l.toNumber || '') + ' is received into ' + orgName(s, c.l.toOrg) + (prj ? ', locator ' + prj.number : '') + '. It is still ' + owner.short + '\'s stock (GR-6).'];
        }
        return [c.l.inPlace ? 'Nothing in Fusion: the unit was already here.' : 'Nothing in Fusion at receipt: the asset\'s location was updated when it shipped.'];
      }
    },
    fill: {
      type: 'fillHours',
      def: function (s, c) {
        return { kicker: 'Hours · ' + c.u.serial, title: 'Record standard hours to today', sub: c.r.number + ' · ' + c.r.site + ' · weekend in ' + countryName(s, c.r.country) + ': ' + weekendText(s, c.r.country),
          confirm: 'Record the hours', tone: 'primary', fields: [] };
      },
      payload: function (c) { return { requestId: c.r.id, lineId: c.l.id }; },
      does: function (s, c, f, dry) {
        var n = dry.ok && dry.result ? dry.result.days : 0;
        var end = c.l.events.offHire ? U.addDays(c.l.events.offHire, -1) : s.today;
        var appr = people(c.r.requestingBu, ['requester', 'receiver-review']);
        if (!n) return ['Nothing to record: every working day from ' + F.short(c.l.events.onHire) + ' to ' + F.short(end) + ' already has hours (weekends are left out).'];
        return ['Records ' + plural(n, 'working day') + ' not yet recorded, ' + F.short(c.l.events.onHire) + ' – ' + F.short(end) + ': 8 hours of use a day; every fifth day 4 hours of use and 4 of standby.',
          'Leaves out the weekend in ' + countryName(s, c.r.country) + ' (' + weekendText(s, c.r.country) + ') and the days already recorded.',
          'They wait for the approval of ' + (appr.length ? orNames(appr) : 'the requester') + '.'];
      },
      fusion: function (s, c) { return [hoursNote(s, c.l)]; }
    },
    log: {
      type: 'logHours',
      def: function (s, c, ids) {
        var h = s.hours.filter(function (x) { return x.lineId === c.l.id && x.date === ids.date; })[0];
        var we = E.isWeekend(s, c.r.country, ids.date);
        return { kicker: 'Hours · ' + c.u.serial, title: 'Hours on ' + DOW[U.dow(ids.date)] + ' ' + F.date(ids.date),
          sub: c.r.number + ' · ' + c.r.site + (we ? ' · a weekend day in ' + countryName(s, c.r.country) : ''), confirm: 'Record the day', tone: 'primary',
          fields: [{ key: 'usage', type: 'number', label: 'Hours of use', initial: h ? h.usage : (we ? 0 : 8), min: 0, max: 24, step: 0.5 },
            { key: 'standby', type: 'number', label: 'Hours of standby', initial: h ? h.standby : 0, min: 0, max: 24, step: 0.5 }] };
      },
      payload: function (c, ids, f) { return { requestId: c.r.id, lineId: c.l.id, date: ids.date, usage: num(f.usage, 0), standby: num(f.standby, 0) }; },
      does: function (s, c, f, dry, ids) {
        var h = s.hours.filter(function (x) { return x.lineId === c.l.id && x.date === ids.date; })[0];
        var u = Math.max(0, Math.min(24, num(f.usage, 0)));
        var sb = Math.max(0, Math.min(24 - u, num(f.standby, 0)));
        var appr = people(c.r.requestingBu, ['requester', 'receiver-review']);
        return ['Records ' + u + ' h of use and ' + sb + ' h of standby on ' + F.date(ids.date) + (h ? ', in place of ' + h.usage + ' h and ' + h.standby + ' h' + (h.approved ? ' (approved)' : '') : '') + '.',
          'The day waits for the approval of ' + (appr.length ? orNames(appr) : 'the requester') + (h && h.approved ? ' again' : '') + '.'];
      },
      fusion: function (s, c) { return [hoursNote(s, c.l)]; }
    },
    approveHours: {
      type: 'approveHours',
      def: function (s, c) {
        return { kicker: 'Hours · ' + L.buName(s, c.r.requestingBu) + ' approves', title: 'Approve the hours of ' + c.u.serial, sub: c.r.number + ' · ' + c.r.site, confirm: 'Approve the hours', tone: 'ok', fields: [] };
      },
      payload: function (c) { return { requestId: c.r.id, lineId: c.l.id }; },
      does: function (s, c) {
        var w = s.hours.filter(function (h) { return h.lineId === c.l.id && !h.approved; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
        var em = people(c.l.provider, ['owner-em']);
        if (!w.length) return ['No hours wait for approval.'];
        return ['Approves ' + plural(w.length, 'day') + ' of hours, ' + F.short(w[0].date) + ' – ' + F.short(w[w.length - 1].date) + ': ' + U.sum(w, function (h) { return h.usage; }) + ' h of use, '
          + U.sum(w, function (h) { return h.standby; }) + ' h of standby.', L.buName(s, c.l.provider) + (em.length ? ' (' + names(em) + ')' : '') + ' is told.'];
      },
      money: function (s, c) { return [moneyWords(s, c.r, c.l)]; },
      fusion: function (s, c) { return [hoursNote(s, c.l).replace('once the requester approves them, ', '')]; }
    },
    breakdown: {
      type: 'reportBreakdown',
      def: function (s, c) {
        return { kicker: 'On site · ' + c.u.serial, title: 'Report a breakdown of ' + c.u.serial, sub: c.r.number + ' · ' + c.r.site, confirm: 'Report the breakdown', tone: 'primary',
          fields: [{ key: 'days', type: 'number', label: 'Days it could not work', initial: 1, min: 1, max: 30, step: 1 },
            { key: 'reason', type: 'text', label: 'What happened', initial: '', placeholder: 'For example: hydraulic leak, waiting for the owner\'s fitter' }] };
      },
      payload: function (c, ids, f) { return { requestId: c.r.id, lineId: c.l.id, days: num(f.days, 1), reason: String(f.reason || '').trim() }; },
      does: function (s, c, f) {
        var em = people(c.l.provider, ['owner-em']);
        var d = Math.max(1, Math.min(30, Math.round(num(f.days, 1)) || 1));
        return ['Records a breakdown of ' + plural(d, 'day') + ' at ' + c.r.site + ': ' + (String(f.reason || '').trim() || 'owner-caused fault') + '.',
          L.buName(s, c.l.provider) + (em.length ? ' (' + names(em) + ')' : '') + ' is told, to send a fitter or a replacement.'];
      },
      money: function (s, c, f) {
        var d = Math.max(1, Math.min(30, Math.round(num(f.days, 1)) || 1));
        var p = c.l.price || {};
        if (c.ag && c.ag.breakdownCredit) return ['A credit of ' + d + ' × ' + F.money(p.day, p.currency) + ' = ' + F.money(-U.r2(d * p.day), p.currency) + ' on this month\'s charges (' + c.ag.number + ' gives a breakdown credit).'];
        return [c.l.relation === 'SAME_BU' ? 'Own equipment: no credit, the cost stays on the project.' : 'No credit: ' + agreementText(s, c.l) + ' gives none.'];
      },
      fusion: function (s, c) { return ['Nothing in Fusion now. ' + chargesNote(c.l)]; }
    },
    offHire: {
      type: 'offHire',
      def: function (s, c) {
        return { kicker: 'On site · ' + c.u.serial, title: 'Off hire ' + c.u.serial, sub: c.r.number + ' · ' + c.r.site, confirm: 'Off hire today', tone: 'primary', fields: [] };
      },
      payload: function (c) { return { requestId: c.r.id, lineId: c.l.id }; },
      does: function (s, c) {
        var yd = people(c.l.provider, ['yard']);
        return ['Releases ' + c.u.serial + ' at ' + c.r.site + ' today, ' + F.date(s.today) + ': the hire stops, ' + chargedTo(s, c.l) + '.',
          poss(L.buName(s, c.l.provider)) + ' yard' + (yd.length ? ' (' + names(yd) + ')' : '') + ' is told to collect it.'];
      },
      money: function (s, c) {
        var out = [];
        var total = U.diffDays(s.today, c.l.events.onHire);
        if (c.ag && c.ag.minDays && total < c.ag.minDays) out.push('Minimum hire ' + c.ag.minDays + ' days (' + c.ag.number + '): on hire ' + plural(total, 'day') + ', so ' + plural(c.ag.minDays - total, 'more day') + ' charged.');
        if (c.ag && c.ag.transport && !c.l.inPlace) out.push('Transport back: ' + F.money(c.ag.transport, c.ag.currency) + ' when the yard has it back.');
        return out.length ? out : ['No more charges after today.'];
      },
      fusion: function (s, c) {
        return ['Nothing in Fusion until the yard collects it: then ' + (c.u.hold === 'STOCK' && c.l.toOrg ? 'a return transfer order inside ' + L.leShort(s, c.l.providerLe) + ', back to ' + orgName(s, c.u.home) : 'the asset\'s location goes back to ' + orgName(s, c.u.home)) + '.'];
      }
    },
    redeploy: {
      type: 'redeploy',
      def: function (s, c) {
        var seg = currentSeg(c.l);
        var opts = s.projects.filter(function (x) { return x.bu === c.r.requestingBu && (!seg || x.id !== seg.projectId); });
        return { kicker: 'Move · ' + L.buName(s, c.r.requestingBu), title: 'Move ' + c.u.serial + ' to another project', sub: 'Now on ' + ((L.project(s, (seg || {}).projectId) || {}).number || '') + ' · ' + c.r.number,
          confirm: 'Move from today', tone: 'primary',
          fields: [{ key: 'projectId', type: 'choice', label: 'To the project', initial: opts.length ? opts[0].id : '',
            options: opts.map(function (x) { return { value: x.id, label: x.number + ' · ' + x.name, sub: (x.type === 'contract' ? 'Customer project for ' + (L.customer(s, x.customer) || {}).name : 'Internal project') + ' · ' + x.site }; }) }] };
      },
      payload: function (c, ids, f) { return { requestId: c.r.id, lineId: c.l.id, projectId: f.projectId || '' }; },
      does: function (s, c, f) {
        var to = L.project(s, f.projectId);
        var seg = currentSeg(c.l);
        var from = L.project(s, (seg || {}).projectId);
        if (!to) return ['Choose the project.'];
        var out = ['Moves ' + c.u.serial + ' to ' + to.number + ' · ' + to.name + ' from today, ' + F.date(s.today) + ' (task ' + to.tasks[0] + ').',
          'Charges from today go to ' + to.number + '; ' + (U.addDays(s.today, -1) >= c.l.events.onHire ? 'up to ' + F.date(U.addDays(s.today, -1)) + ' they stay on '
            + (from ? from.number : 'the old project') : 'nothing was charged to ' + (from ? from.number : 'the old project') + ' yet') + '.'];
        if (to.type === 'contract') out.push(to.number + ' is a customer project: its equipment cost is billable to ' + (L.customer(s, to.customer) || {}).name + ' (cost + ' + Math.round(to.markupPct * 100) + ' %).');
        return out;
      },
      fusion: function (s, c) {
        if (c.l.relation.indexOf('IC_') === 0) return ['Nothing in Fusion now. At the month end the charges split by project: ' + L.leShort(s, c.r.requestingLe) + '\'s AP invoice has a line for each project, and PPM shows the cost on each.'];
        return ['Nothing in Fusion now. At the month end the cost posts to each project in PPM for its own days.'];
      }
    },
    handover: {
      type: 'moveToCompany',
      def: function (s, c) {
        var v = V.site(s);
        var opts = handoverOptions(s, v, c.r, c.l);
        return { kicker: 'Move · hand over on site', title: 'Hand ' + c.u.serial + ' over to another group company', sub: 'In ' + countryName(s, c.r.country) + ', at ' + c.r.site + ' · ' + c.r.number,
          confirm: 'Hand it over', tone: 'primary',
          fields: [{ key: 'projectId', type: 'choice', label: 'To the project', initial: opts.length ? opts[0].id : '',
            options: opts.map(function (x) { var p = L.project(s, x.id); return { value: x.id, label: x.label, sub: L.buName(s, x.bu) + ' · ' + p.site }; }) }] };
      },
      payload: function (c, ids, f) { return { requestId: c.r.id, lineId: c.l.id, projectId: f.projectId || '' }; },
      does: function (s, c, f, dry) {
        var to = L.project(s, f.projectId);
        if (!to) return ['Choose the project.'];
        var ag = (s.agreements || []).filter(function (a) { return a.status === 'ACTIVE' && a.provider === c.l.provider && a.receiver === to.bu; })[0];
        return ['Ends ' + poss(L.buName(s, c.r.requestingBu)) + ' hire today (off hire): ' + chargedTo(s, c.l) + '.',
          'Raises ' + (dry.ok && dry.result ? dry.result.number : 'a new request') + ' for ' + L.buName(s, to.bu) + ' on ' + to.number + ': ' + L.buName(s, c.l.provider) + ' approves the new line; the unit stays on site, no transport.',
          'No sub-lending: ' + L.leShort(s, c.l.providerLe) + ' bills ' + L.buName(s, to.bu) + ' directly' + (ag ? ' under ' + ag.number : '') + '; ' + L.leShort(s, c.r.requestingLe) + ' never re-bills it.'];
      },
      fusion: function (s, c) {
        return ['Nothing in Fusion now: ' + (c.u.hold === 'STOCK' && c.l.toOrg ? 'the stock stays in ' + orgName(s, c.l.toOrg) + ', no transfer order.' : 'the asset stays where it is.')];
      }
    },
    loss: {
      type: 'reportLoss',
      def: function (s, c) {
        return { kicker: 'On site · ' + c.u.serial, title: 'Report ' + c.u.serial + ' lost', sub: c.u.name + ' · ' + c.r.number + ' · ' + c.r.site, confirm: 'Report it lost', tone: 'danger', fields: [] };
      },
      payload: function (c) { return { requestId: c.r.id, lineId: c.l.id }; },
      does: function (s, c) {
        var em = people(c.l.provider, ['owner-em', 'owner-finance']);
        return ['Reports ' + c.u.serial + ' lost at ' + c.r.site + ': the hire stops today and an insurance claim is opened.', L.buName(s, c.l.provider) + (em.length ? ' (' + names(em) + ')' : '') + ' is told.'];
      },
      money: function (s, c) {
        var v = U.r2(nbv(c.u) * (1 + s.settings.lossMarkupPct));
        return ['Charged at the agreed value: ' + F.money(v, ownerCur(s, c.u)) + ', the net book value ' + F.money(nbv(c.u), ownerCur(s, c.u)) + ' + ' + Math.round(s.settings.lossMarkupPct * 100) + ' % (OD-11). ' + chargesNote(c.l)];
      },
      fusion: function (s, c) {
        return [c.u.hold === 'ASSET' ? 'Fusion Assets retires asset ' + c.u.asset.number + ' in ' + L.leShort(s, c.l.providerLe) + ' (GR-1: it was always theirs).' : 'Fusion Inventory issues the stock out of ' + L.leShort(s, c.l.providerLe) + '\'s inventory.'];
      }
    },
    'return': {
      type: 'returnLine',
      def: function (s, c) {
        return { kicker: 'Yard · ' + L.buName(s, c.u.owner), title: 'Collect ' + c.u.serial + ' from ' + c.r.site, sub: c.r.site + ' → ' + orgName(s, c.u.home) + ' · ' + c.r.number, confirm: 'Receive it back', tone: 'ok', fields: [] };
      },
      payload: function (c) { return { requestId: c.r.id, lineId: c.l.id }; },
      does: function (s, c) {
        return ['Receives ' + c.u.serial + ' back at ' + orgName(s, c.u.home) + ' from ' + c.r.site + '.', 'It waits for inspection; the hire stopped at off hire (' + F.date(c.l.events.offHire) + ').'];
      },
      money: function (s, c) { return c.ag && c.ag.transport && !c.l.inPlace ? ['Transport back: ' + F.money(c.ag.transport, c.ag.currency) + ' on this month\'s charges (' + c.ag.number + ').'] : []; },
      fusion: function (s, c) {
        var owner = L.leShort(s, c.l.providerLe);
        var out = [c.u.hold === 'STOCK' && c.l.toOrg ? 'Fusion Inventory: a return transfer order inside ' + owner + ', from ' + orgName(s, c.l.toOrg) + ' back to ' + orgName(s, c.u.home) + ' (GR-6).'
          : 'Fusion Assets: the location of asset ' + (c.u.asset || {}).number + ' goes back to ' + orgName(s, c.u.home) + '; no accounting.'];
        return out;
      }
    },
    inspect: {
      type: 'inspectLine',
      def: function (s, c) {
        var cur = (c.l.price && c.l.price.currency) || ownerCur(s, c.u);
        return { kicker: 'Yard · inspection', title: 'Inspect ' + c.u.serial, sub: 'Back from ' + c.r.site + ' · ' + c.r.number + ' · ' + L.buName(s, c.r.requestingBu), confirm: 'Record the inspection', tone: 'ok',
          fields: [{ key: 'result', type: 'choice', label: 'Result', initial: 'pass', options: [{ value: 'pass', label: 'Passed', sub: 'Back in the fleet' }, { value: 'damage', label: 'Damaged', sub: 'Charge the repair, then repair it' }] },
            { key: 'damage', type: 'number', label: 'Damage (' + cur + ')', initial: '', min: 0, step: 50, showIf: { key: 'result', value: 'damage' } },
            { key: 'photos', type: 'number', label: 'Photos taken', initial: 2, min: 0, max: 20, step: 1, showIf: { key: 'result', value: 'damage' } },
            { key: 'note', type: 'textarea', label: 'What was found', initial: '', placeholder: 'For example: cracked side panel, bucket teeth worn' }] };
      },
      payload: function (c, ids, f) {
        var dmg = f.result === 'damage';
        return { requestId: c.r.id, lineId: c.l.id, damage: dmg ? num(f.damage, 0) : 0, note: String(f.note || '').trim(), photos: dmg ? num(f.photos, 0) : 0 };
      },
      does: function (s, c, f) {
        var cur = (c.l.price && c.l.price.currency) || ownerCur(s, c.u);
        var amt = f.result === 'damage' ? Math.max(0, num(f.damage, 0)) : 0;
        if (!amt) return [c.u.serial + ' passes: back in the fleet, free to allocate.' + (f.result === 'damage' ? ' (Give the damage amount to charge it.)' : ''), 'The request\'s equipment is done: returned and inspected.'];
        var th = s.settings.damageThreshold;
        var ic = c.l.relation.indexOf('IC_') === 0;
        var req = people(c.r.requestingBu, ['requester', 'receiver-review']);
        return ['Charges the damage of ' + F.money(amt, cur) + ' to ' + L.buName(s, c.r.requestingBu) + ': ' + (String(f.note || '').trim() || 'repair') + ' (' + plural(num(f.photos, 0), 'photo') + ').',
          amt > th ? (ic ? 'Above ' + F.money(th, s.settings.groupCurrency) + ' (OD-11): ' + L.buName(s, c.r.requestingBu) + ' must accept it on the statement before it is invoiced.' : 'Above ' + F.money(th, s.settings.groupCurrency) + ' (OD-11): say so to the customer before invoicing.')
            : 'Up to ' + F.money(th, s.settings.groupCurrency) + ': charged without a separate acceptance (OD-11).',
          c.u.serial + ' goes to repair.', (req.length ? names(req) : L.buName(s, c.r.requestingBu)) + ' ' + (req.length === 1 ? 'is' : 'are') + ' told.'];
      },
      fusion: function (s, c, f) { return [f.result === 'damage' && num(f.damage, 0) > 0 ? 'Nothing in Fusion now. ' + chargesNote(c.l) : 'Nothing in Fusion.']; }
    },
    repair: {
      type: 'repairDone',
      def: function (s, c) { return { kicker: 'Yard · ' + L.buName(s, c.u.owner), title: c.u.serial + ' repaired', sub: c.u.name + ' · ' + orgName(s, c.u.home), confirm: 'Back in the fleet', tone: 'ok', fields: [] }; },
      payload: function (c) { return { unitId: c.u.id }; },
      does: function (s, c) { return [c.u.serial + ' is repaired: back in the fleet, free to allocate again.']; },
      fusion: function () { return ['Nothing in Fusion here: the repair is the owner\'s own maintenance.']; }
    }
  };

  /**
   * The confirmation of an action of these screens: kind (approve, refuse, ship, return, inspect, repair, receive, fill,
   * log, approveHours, breakdown, offHire, redeploy, handover, loss), ids ({ requestId, lineId, unitId, date }), form
   * (the values typed, or null for the defaults). The preview comes from a dry run of the engine on a copy of the state.
   */
  function ask(s, kind, ids, form) {
    var K = KINDS[kind];
    var i = ids || {};
    if (!K) return { def: { open: false, fields: [] }, form: {}, preview: { ok: false, warn: 'Nothing to do.', type: '', payload: {} } };
    var r = i.requestId ? L.request(s, i.requestId) : null;
    var l = r ? U.byId(r.lines, i.lineId) : null;
    var u = L.unit(s, i.unitId || (l && (l.unitId || l.preferredUnit)));
    var me = V.me(s);
    if ((kind !== 'repair' && !l) || !u) {
      return { def: { open: true, kind: kind, ids: i, kicker: '', title: 'Not here any more', sub: '', confirm: '', tone: 'primary', fields: [] }, form: {},
        preview: { ok: false, warn: 'This line is not here any more.', type: K.type, payload: {}, does: [], money: [], fusion: [], txs: [], customs: [], told: [], logged: [] } };
    }
    var c = { r: r, l: l, u: u, ag: l ? L.agreement(s, l.agreementId) : null, me: me, p: E.persona(s) };
    var def = K.def(s, c, i);
    var f = {};
    (def.fields || []).forEach(function (x) { f[x.key] = x.initial; });
    Object.keys(form || {}).forEach(function (k) { f[k] = form[k]; });
    var payload = K.payload(c, i, f);
    var dry = E.apply(s, K.type, payload);
    var after = dry.ok ? dry.state : s;
    var preview = {
      ok: dry.ok, warn: dry.ok ? '' : dry.error, type: K.type, payload: payload,
      does: K.does(s, c, f, dry, i), money: K.money ? K.money(s, c, f) : [], fusion: K.fusion(s, c, f),
      txs: txRows(s, after), customs: customsRows(s, after), told: toldRows(s, after), logged: loggedRows(s, after)
    };
    return { def: Object.assign({ open: true, kind: kind, ids: i }, def), form: f, preview: preview };
  }

  // ── Exports: every list ─────────────────────────────────────────────────────────────────────────────────────────
  function col(key, label, value) { return { key: key, label: label, value: value }; }
  var EXPORTS = {
    approvals: { title: 'Approve & allocate', columns: [col('number', 'Request'), col('typeText', 'Type'), col('company', 'Requesting company'), col('buName', 'Requesting BU'),
      col('forMain', 'Project or customer'), col('site', 'Site'), col('country', 'Country'), col('from', 'From'), col('to', 'To'), col('relationLabel', 'Relationship'),
      col('agreement', 'Agreement'), col('price', 'Price'), col('estimate', 'Estimate'), col('requester', 'Requester', function (r) { return r.requester.name; }),
      col('preferred', 'Preferred unit', function (r) { return (r.options.filter(function (o) { return o.preferred; })[0] || {}).serial || ''; }),
      col('usable', 'Usable units', function (r) { return r.options.filter(function (o) { return o.usable; }).map(function (o) { return o.serial; }).join(', '); }),
      col('deposit', 'Deposit', function (r) { return r.needsDeposit ? 'Not received' : ''; })] },
    toShip: { title: 'Yard · to ship', columns: [col('number', 'Request'), col('serial', 'Unit'), col('unitName', 'Equipment'), col('holdText', 'Asset or stock'), col('home', 'From'),
      col('site', 'To site'), col('country', 'Country'), col('user', 'For'), col('from', 'Needed from'), col('fusion', 'What Fusion does'), col('crossText', 'Customs')] },
    out: { title: 'Yard · out', columns: [col('serial', 'Unit'), col('unitName', 'Equipment'), col('number', 'Request'), col('user', 'Used by'), col('statusText', 'Status'),
      col('where', 'Where'), col('whereCountry', 'Country'), col('since', 'Since'), col('customs', 'Customs')] },
    toCollect: { title: 'Yard · to collect', columns: [col('serial', 'Unit'), col('unitName', 'Equipment'), col('number', 'Request'), col('site', 'Site'), col('country', 'Country'),
      col('offHire', 'Off hire'), col('fusion', 'What Fusion does'), col('customs', 'Customs')] },
    toInspect: { title: 'Yard · to inspect', columns: [col('serial', 'Unit'), col('unitName', 'Equipment'), col('number', 'Request'), col('user', 'Used by'), col('returned', 'Back'), col('threshold', 'Damage rule')] },
    repairs: { title: 'Yard · in repair', columns: [col('serial', 'Unit'), col('unitName', 'Equipment'), col('home', 'Yard'), col('damage', 'Damage'), col('note', 'Inspection')] },
    fleet: { title: 'Yard · the fleet', columns: [col('serial', 'Unit'), col('name', 'Equipment'), col('clsName', 'Class'), col('owner', 'Owner'), col('statusText', 'Status'), col('where', 'Where'),
      col('country', 'Country'), col('holdText', 'Asset or stock'), col('ref', 'Reference'), col('value', 'Value'), col('certs', 'Certificates', function (u) { return u.certs.map(function (c) { return c.text; }).join('; '); }),
      col('customs', 'Customs', function (u) { return u.customs.map(function (c) { return c.text; }).join('; '); })] },
    toReceive: { title: 'On site · to receive', columns: [col('number', 'Request'), col('serial', 'Unit'), col('unitName', 'Equipment'), col('owner', 'Owner'), col('relationLabel', 'Relationship'),
      col('site', 'Site'), col('country', 'Country'), col('shipped', 'Shipped'), col('fusion', 'What Fusion does')] },
    onHire: { title: 'On site · on hire', columns: [col('serial', 'Unit'), col('unitName', 'Equipment'), col('number', 'Request'), col('owner', 'Owner'), col('relationLabel', 'Relationship'),
      col('project', 'Project now'), col('site', 'Site'), col('since', 'On hire since'), col('recorded', 'Days recorded'), col('usage', 'Hours of use'), col('standby', 'Hours of standby'),
      col('waiting', 'Days waiting for approval'), col('price', 'Price')] },
    hours: { title: 'Hours', columns: [col('date', 'Date'), col('dow', 'Day'), col('weekend', 'Weekend', function (g) { return g.weekend ? 'Yes' : ''; }), col('usage', 'Hours of use'),
      col('standby', 'Hours of standby'), col('state', 'State', function (g) { return { approved: 'Approved', waiting: 'Waiting for approval', empty: 'Not recorded', weekend: 'Weekend, not recorded' }[g.state]; })] }
  };
  /** Approve & allocate's lines under a relationship chip ('all' or a relation). */
  function byRelation(rows, rel) { return (rows || []).filter(function (r) { return !rel || rel === 'all' || r.relation === rel; }); }

  /**
   * A list of a screen's model as exportKit.run takes it, exactly as shown. list: a key of EXPORTS, or 'hours:<lineId>'
   * on the site's model; opts.rel: Approve & allocate's chip.
   */
  function exportSpec(model, list, opts) {
    var m = model || {};
    var o = opts || {};
    var key = String(list || '');
    if (key.indexOf('hours:') === 0) {
      var h = (m.onHire || []).filter(function (x) { return x.id === key.slice(6); })[0];
      return { name: 'hours-' + (h ? h.serial : 'unit'), title: 'Hours of ' + (h ? h.serial + ' · ' + h.number : ''), subtitle: h ? h.site + ' · ' + h.daysText : '', rows: h ? h.grid : [], columns: EXPORTS.hours.columns };
    }
    var e = EXPORTS[key];
    if (!e) return { name: key, title: key, subtitle: '', rows: [], columns: [] };
    var rows = key === 'approvals' ? byRelation(m.rows, o.rel) : m[key];
    var chip = key === 'approvals' && o.rel && o.rel !== 'all' && REL[o.rel] ? ' · ' + REL[o.rel].label : '';
    return { name: e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), title: e.title, subtitle: (m.busText || '') + chip, rows: rows || [], columns: e.columns };
  }

  return { approvals: approvals, yard: yard, site: site, ask: ask, exportSpec: exportSpec, byRelation: byRelation, hoursGrid: hoursGrid, may: may, WHO: WHO, KINDS: Object.keys(KINDS), certFor: certFor, destOrg: destOrg };
});
