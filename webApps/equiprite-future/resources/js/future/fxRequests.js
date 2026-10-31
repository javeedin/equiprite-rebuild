define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine', 'resources/js/future/fxViews', 'resources/js/nav'], function (Seed, E, V, nav) {
  'use strict';

  /**
   * EquipRite Future · Requests: what My requests, New request and a request's tab show, computed from the state for
   * the person played (FDD v2.0: requests by the requesting BU, approvals by the sourcing BU, financial clarity per
   * request). Pure functions on top of fxViews and fxEngine; nothing here changes the state.
   *
   *   list(s, { chip, text })      My requests: fxViews.requests() with relationship chips, owners, money progress
   *   form(s, form)                New request: the three steps (For with Source from, Equipment, Review), the sourcing
   *                                cards (only the sourcing BU's when one is chosen), the cart
   *   payload(s, form)             what Submit sends to createRequest
   *   request(s, id)               a request's tab: head (its next step), approval & flow, equipment, money (the finance
   *                                checklist), accounting, history
   *   flow(s, id)                  a request's approval and flow: every step in order, its BU, its people, its state,
   *                                the next step, the approver in words, the journey (swimlanes)
   *   exportOf(kind, v)            { name, title, subtitle, rows, columns } for exportKit
   */
  var U = E.util;
  var L = E.lookups;
  var F = V.fmt;
  var REL = V.REL;
  var TYPE = V.TYPE;

  function unique(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function first(name) { return String(name || '').split(' ')[0]; }
  /** "ProjectCo Projects’", "FleetCo Fleet’s". */
  function whose(name) { return /s$/.test(name) ? name + '’' : name + '’s'; }
  function countryName(s, code) { var c = L.country(s, code); return c ? c.name : code; }
  /** 'the United Arab Emirates', 'Saudi Arabia': a country's name inside a sentence. */
  function inCountry(s, code) { var n = countryName(s, code); return /^United /.test(n) ? 'the ' + n : n; }
  function relOf(code) { var r = REL[code] || {}; return { code: code, label: r.label || code, tone: r.tone || 'neutral', words: r.words || '' }; }
  function pct(x) { return Math.round((x || 0) * 100) + ' %'; }
  function isAdmin(p) { return p.roles.indexOf('admin') !== -1; }
  function stageTone(stage) {
    return { requested: 'approval', approved: 'ready', shipped: 'out', onhire: 'onsite', offhire: 'back', returned: 'back', closed: 'done', rejected: 'stopped', lost: 'stopped' }[stage] || 'draft';
  }

  // ── Who does a step: the persona played, or the one to play (never Admin) ─────────────────────────────────────
  /**
   * A step on another screen: open it when the persona played may do it there (one of the roles, in the BU), else
   * the button that plays the person who does it ("Play as Ana and open Approve & allocate").
   */
  function doer(s, navId, roles, buId, what) {
    var me = E.persona(s);
    var it = nav.item(navId);
    var screen = it ? it.label : navId;
    var fits = function (p) { return roles.some(function (r) { return L.can(p, r); }) && L.inBu(p, buId) && nav.itemVisible(it, p.roles); };
    if (fits(me)) return { navId: navId, screen: screen, what: what, mine: true, none: false, persona: me.id, personaName: me.name, action: 'Open ' + screen };
    var list = Seed.PERSONAS.filter(function (p) { return !isAdmin(p) && fits(p); });
    var player = it && it.player ? list.filter(function (p) { return p.id === it.player; })[0] : null;
    var p = player || list[0];
    if (!p) {
      return { navId: navId, screen: screen, what: what, mine: false, none: true, persona: '', personaName: '',
        action: 'No one plays this for ' + L.buName(s, buId) + ' in the demo (Admin can)' };
    }
    return { navId: navId, screen: screen, what: what, mine: false, none: false, persona: p.id, personaName: p.name, personaTitle: p.title,
      action: 'Play as ' + first(p.name) + ' and open ' + screen };
  }
  function personaFor(buId, role) {
    return Seed.PERSONAS.filter(function (p) { return !isAdmin(p) && p.bus.indexOf(buId) !== -1 && p.roles.indexOf(role) !== -1; })[0] || null;
  }

  // ── My requests ───────────────────────────────────────────────────────────────────────────────────────────────
  var CHIPS = [['all', 'All'], ['open', 'Open'], ['unfinished', 'Money not complete']];

  function rowOf(s, row) {
    var r = L.request(s, row.id);
    var lines = r.lines;
    var rels = unique(lines.map(function (l) { return l.relation; })).map(relOf);
    var owners = unique(lines.map(function (l) { return l.provider; })).map(function (b) { return L.buName(s, b) + ' · ' + L.leShort(s, L.leOf(s, b).id); });
    var fin = V.finance(s, r.id);
    var prj = L.project(s, r.projectId);
    var cust = L.customer(s, r.customerId);
    var party = r.type === 'CUSTOMER_RENTAL' ? (cust ? cust.name : '') : (prj ? prj.number + ' · ' + prj.name : '');
    var partySub = r.type === 'CUSTOMER_PROJECT' && cust ? 'for ' + cust.name : r.site + ' · ' + countryName(s, r.country);
    // The money column names the first money step open; one still running counts only while nothing after it is done (as
    // in the flow). The equipment's own steps are the flow's (flowNext).
    var money = fin.items.filter(function (i) { return i.key !== 'ops'; });
    var nextItem = money.filter(function (i, k) {
      if (i.state === 'done' || i.state === 'na') return false;
      return i.state !== 'running' || !money.slice(k + 1).some(function (x) { return x.state === 'done'; });
    })[0];
    var nextText = fin.complete ? 'Financially complete' : nextItem ? 'Money next: ' + nextItem.label.replace(/ \([^)]*\)$/, '') + ' · ' + nextItem.who : fin.words;
    var fl = flow(s, r.id);
    return Object.assign({}, row, {
      flowNext: fl.nextListText, flowNextMine: !!(fl.next && fl.next.go && fl.next.go.mine), flowDots: fl.journey.dots,
      party: party, partySub: partySub, relChips: rels, relText: rels.map(function (x) { return x.label; }).join(', '), ownersText: owners.join('; '),
      buCompany: row.buName + ' · ' + row.company, stageTone: stageTone(row.stage), countryName: countryName(s, r.country),
      moneyText: row.finDone + ' of ' + row.finTotal, moneyNext: nextText, moneyLine: row.finDone + ' of ' + row.finTotal + ' · ' + nextText,
      moneyPct: row.finTotal ? Math.round(row.finDone / row.finTotal * 100) : 0,
      costSoFar: fin.costText || '', costNote: fin.costText ? 'on the project' : (fin.chargedText ? fin.chargedText + ' charged, not on the project yet' : 'No cost yet'),
      chargedText: fin.chargedText || '', fromText: F.date(r.from), toText: F.date(r.to),
      equipment: lines.map(function (l) { var u = L.unit(s, l.unitId || l.preferredUnit); return u ? u.serial : l.cls; }).join(', ')
    });
  }

  /** My requests: the requests of the persona's BUs (fxViews.requests), with chips counted and each row decorated. */
  function list(s, f) {
    var o = f || {};
    var chip = CHIPS.some(function (c) { return c[0] === o.chip; }) ? o.chip : 'all';
    var all = V.requests(s, {});
    var shown = V.requests(s, { stage: chip, text: o.text || '' });
    var counts = {
      all: all.rows.length,
      open: all.rows.filter(function (r) { return r.stage !== 'closed' && r.stage !== 'rejected'; }).length,
      unfinished: all.rows.filter(function (r) { return !r.finComplete; }).length
    };
    var me = V.me(s);
    var p = E.persona(s);
    return {
      me: me, scope: all.scope, chip: chip, text: o.text || '', count: shown.count, all: all.all,
      chips: CHIPS.map(function (c) { return { key: c[0], label: c[1], on: chip === c[0], count: counts[c[0]] }; }),
      rows: shown.rows.map(function (r) { return rowOf(s, r); }),
      canNew: L.can(p, 'requester') || L.can(p, 'desk'),
      summary: shown.count === all.all ? all.all + (all.all === 1 ? ' request' : ' requests') : shown.count + ' of ' + all.all + ' requests',
      empty: !all.all ? 'No requests raised by ' + me.busText + ' yet.' : (shown.count ? '' : 'Nothing matches. Try another chip or clear the search.')
    };
  }

  // ── New request ───────────────────────────────────────────────────────────────────────────────────────────────
  /** The BUs the persona raises requests for: a requester's BUs with projects; the rental desk's BUs that rent. */
  function requesterBus(s) {
    var p = E.persona(s);
    var req = L.can(p, 'requester');
    var desk = L.can(p, 'desk');
    if (!req && !desk) return [];
    var ids = isAdmin(p) ? s.bus.map(function (b) { return b.id; }) : p.bus;
    return ids.map(function (id) { return L.bu(s, id); }).filter(function (b) {
      if (!b) return false;
      var hasProjects = req && s.projects.some(function (x) { return x.bu === b.id; });
      var rents = desk && b.roles.indexOf('rental') !== -1 && s.customers.some(function (c) { return c.of === b.le; });
      return hasProjects || rents;
    }).map(function (b) {
      var c = L.le(s, b.le);
      return { id: b.id, name: b.name, company: c.short, companyName: c.name, country: countryName(s, c.country), currency: c.currency };
    });
  }
  /** What a request of this BU can be for: its projects (internal or customer), or at the rental desk its company's customers. */
  function forOptions(s, buId) {
    var p = E.persona(s);
    var b = L.bu(s, buId);
    if (!b) return [];
    var out = [];
    if (L.can(p, 'requester')) {
      s.projects.filter(function (x) { return x.bu === buId; }).forEach(function (x) {
        var cust = L.customer(s, x.customer);
        var k = L.country(s, x.country);
        out.push({ key: 'P:' + x.id, kind: 'project', id: x.id, type: x.type === 'contract' ? 'CUSTOMER_PROJECT' : 'INTERNAL', typeText: x.type === 'contract' ? TYPE.CUSTOMER_PROJECT : TYPE.INTERNAL,
          title: x.number + ' · ' + x.name, number: x.number, site: x.site, country: x.country, countryName: k.name, currency: k.currency, tasks: x.tasks.slice(),
          note: x.type === 'contract' ? 'Customer project for ' + (cust ? cust.name : '') + ': ' + L.leShort(s, b.le) + ' bills them at cost + ' + Math.round(x.markupPct * 100) + ' %'
            : 'Internal project: the cost stays with ' + L.leShort(s, b.le) + ' on the project',
          onHold: false, tone: x.type === 'contract' ? 'cust' : 'neutral' });
      });
    }
    if (L.can(p, 'desk') && b.roles.indexOf('rental') !== -1) {
      s.customers.filter(function (c) { return c.of === b.le; }).forEach(function (c) {
        var ag = s.agreements.filter(function (a) { return a.kind === 'CUSTOMER' && a.customer === c.id && a.provider === buId && a.status === 'ACTIVE'; })[0];
        var k = L.country(s, c.country);
        out.push({ key: 'C:' + c.id, kind: 'customer', id: c.id, type: 'CUSTOMER_RENTAL', typeText: TYPE.CUSTOMER_RENTAL, title: c.name, number: '', site: '', country: c.country,
          countryName: k.name, currency: k.currency, tasks: [], onHold: !!c.onHold, tone: 'cust',
          note: c.onHold ? 'On credit hold in Fusion Receivables: no new rentals until finance releases it'
            : (ag ? 'Rental agreement ' + ag.number + (ag.depositPct ? ', deposit ' + pct(ag.depositPct) + ' of a month before approval' : '') : 'No rental agreement with this customer') });
      });
    }
    return out;
  }

  var STEPS = [[1, 'For'], [2, 'Equipment'], [3, 'Review']];

  // ── Source from: the sourcing business units the requesting BU may borrow from (MC-FR-04, 11) ─────────────────
  /**
   * The BUs a requesting BU may source from, in fxEngine.sourcing's order: its own fleet first (when it owns units),
   * then every provider the IC matrix allows (receiver = the requesting BU, allowed), by priority. A customer rental
   * comes from the owner itself: its own fleet only.
   */
  function sourceBus(s, buId, rental) {
    if (!L.bu(s, buId)) return [];
    var out = [];
    if ((s.units || []).some(function (u) { return u.owner === buId && u.status !== 'LOST'; })) out.push({ bu: buId, leadDays: 0, priority: 0 });
    if (rental) return out;
    (s.icRelations || []).filter(function (r) { return r.receiver === buId && r.allowed && r.provider !== buId; })
      .map(function (r, i) { return { bu: r.provider, leadDays: r.leadDays || 0, priority: r.priority, i: i }; })
      .sort(function (a, b) { return (a.priority - b.priority) || (a.i - b.i); })
      .forEach(function (r) { if (!out.some(function (x) { return x.bu === r.bu; })) out.push({ bu: r.bu, leadDays: r.leadDays, priority: r.priority }); });
    return out;
  }
  /** A request is a customer rental when its option is a customer, or (nothing chosen yet) when every option is. */
  function isRental(opts, opt) {
    return opt ? opt.kind === 'customer' : (opts.length > 0 && opts.every(function (o) { return o.kind === 'customer'; }));
  }
  function leadText(days) { return days ? 'Lead time ' + days + (days === 1 ? ' day' : ' days') : 'On hand: no lead time'; }
  function unitsWord(n) { return n + (n === 1 ? ' unit' : ' units'); }

  /** What sourcing from this BU means for the money, in one line. */
  function moneyWords(s, rel, provider, reqBuId, ag) {
    var provLe = L.leOf(s, provider);
    var reqLe = L.leOf(s, reqBuId);
    if (rel === 'SAME_BU') return 'Cost straight to the project, no invoice';
    if (rel === 'SAME_LE') return 'PPM cross-charge to the project: no invoices, no tax (one legal entity)';
    if (rel === 'IC_DOMESTIC') return 'Invoice pair: AR in ' + provLe.short + ', AP in ' + reqLe.short + ' coded to the project; VAT ' + pct(L.country(s, provLe.country).vat);
    if (rel === 'IC_CROSS_BORDER') {
      return 'Invoice pair in ' + (ag ? ag.currency : provLe.currency) + ' without VAT: ' + reqLe.short + ' self-assesses ' + pct(L.country(s, reqLe.country).vat)
        + (ag && ag.wht ? ' and withholds ' + pct(ag.wht) : '') + '; customs at the border';
    }
    if (rel === 'CUSTOMER') return provLe.short + ' invoices the customer in Fusion Receivables: no intercompany';
    return '';
  }

  /**
   * Step 1's Source from: one card per sourcing BU (BU and company, country, relationship, the money in one line, lead
   * time, agreement and version, units in total and free for the dates, from fxEngine.sourcing), after a first card
   * "Any company in the group" (the default). A customer rental shows the own fleet only.
   */
  function sources(s, f, opt, rental, datesOk) {
    var reqBu = L.bu(s, f.bu);
    if (!reqBu) return [];
    var list = sourceBus(s, f.bu, rental);
    var units = E.sourcing(s, { requestingBu: f.bu, cls: '', from: datesOk ? f.from : '', to: datesOk ? f.to : '', country: opt ? opt.country : '' });
    var count = function (bu) {
      var mine = units.filter(function (o) { return !bu || o.owner === bu; });
      var free = mine.filter(function (o) { return o.free && ['IN_REPAIR', 'INSPECTION'].indexOf(o.unitStatus) === -1; }).length;
      return { total: mine.length, free: free, text: unitsWord(mine.length) + ' · ' + (datesOk ? free + ' free for the dates' : 'give the dates to see how many are free') };
    };
    var on = rental ? f.bu : f.source;
    var cards = list.map(function (x) {
      var le = L.leOf(s, x.bu);
      var rel = rental ? 'CUSTOMER' : E.relationType(s, x.bu, f.bu);
      var r = relOf(rel);
      var ag = rel === 'SAME_BU' ? null : (s.agreements || []).filter(function (a) {
        return a.status === 'ACTIVE' && a.provider === x.bu && (rel === 'CUSTOMER' ? (opt && opt.kind === 'customer' && a.customer === opt.id) : a.receiver === f.bu);
      })[0] || null;
      var agText = rel === 'SAME_BU' ? 'No agreement: own equipment at its internal cost rate'
        : rel === 'CUSTOMER' ? (opt ? (ag ? 'Rental agreement ' + ag.number + ' v' + ag.version : 'No rental agreement with this customer') : 'The customer’s rental agreement')
          : ag ? ag.number + ' v' + ag.version + (ag.kind === 'CROSS_CHARGE' ? ' (cross-charge rates)' : ' (intercompany agreement)') : 'No agreement yet: no price, its units cannot be used';
      var n = count(x.bu);
      return { key: x.bu, id: x.bu, any: false, own: x.bu === f.bu, on: on === x.bu, title: L.buName(s, x.bu), company: le.short, companyName: le.name,
        countryName: countryName(s, le.country), sub: le.name + ' · ' + countryName(s, le.country),
        relation: rel, relLabel: r.label, relTone: r.tone, money: moneyWords(s, rel, x.bu, f.bu, ag),
        leadDays: x.leadDays, lead: leadText(x.leadDays), agreement: agText, agreementNumber: ag ? ag.number : '', agreementVersion: ag ? ag.version : 0,
        total: n.total, free: n.free, unitsText: n.text };
    });
    if (rental || !cards.length) return cards;
    var all = count('');
    var leads = cards.map(function (c) { return c.leadDays; });
    var lo = Math.min.apply(null, leads);
    var hi = Math.max.apply(null, leads);
    var any = { key: 'any', id: '', any: true, own: false, on: !on, title: 'Any company in the group', company: '', companyName: '', countryName: '',
      sub: 'Step 2 shows every unit you may use' + (cards[0].own ? ', own fleet first' : ', by priority'),
      relation: '', relLabel: 'Every allowed owner', relTone: 'na', money: 'Each owner approves and bills its own lines, as its card says',
      leadDays: lo, lead: hi === lo ? leadText(hi) : (lo ? 'Lead time ' + lo : 'On hand') + ' to ' + hi + (hi === 1 ? ' day' : ' days') + ', by owner',
      agreement: 'Each owner’s own agreement', agreementNumber: '', agreementVersion: 0, total: all.total, free: all.free, unitsText: all.text };
    return [any].concat(cards);
  }

  /** "Requested by ProjectCo Projects (ProjectCo) → sourced from FleetCo Fleet (FleetCo)", or "… from any company in the group". */
  function routeOf(s, bu, source) {
    if (!bu) return null;
    var src = source ? L.bu(s, source) : null;
    var srcCo = src ? L.leShort(s, src.le) : '';
    var to = src ? src.name + ' (' + srcCo + ')' + (src.id === bu.id ? ', its own fleet' : '') : 'any company in the group';
    return { reqName: bu.name, reqCompany: bu.company, any: !src, srcName: src ? src.name : 'any company in the group', srcCompany: srcCo, own: !!src && src.id === bu.id,
      text: 'Requested by ' + bu.name + ' (' + bu.company + ') → sourced from ' + to };
  }

  /** The form made whole for the persona played: a BU they request for, a known option, dates, a class, units still offered. */
  function normalise(s, form) {
    var f = Object.assign({ step: 1, bu: '', forKey: '', task: '', from: '', to: '', site: '', note: '', cls: '', source: '', lines: [] }, form || {});
    var bus = requesterBus(s);
    if (!bus.some(function (b) { return b.id === f.bu; })) f.bu = bus.length ? bus[0].id : '';
    var opts = forOptions(s, f.bu);
    if (!opts.some(function (o) { return o.key === f.forKey; })) f.forKey = opts.length === 1 ? opts[0].key : '';
    var opt = opts.filter(function (o) { return o.key === f.forKey; })[0] || null;
    if (opt && opt.tasks.length && opt.tasks.indexOf(f.task) === -1) f.task = opt.tasks[0];
    if (!opt || !opt.tasks.length) f.task = '';
    if (!f.from) f.from = U.addDays(s.today, 7);
    if (!f.to) f.to = U.addDays(f.from, 27);
    if (!s.classes.some(function (c) { return c.id === f.cls; })) f.cls = s.classes[0].id;
    // The sourcing BU chosen on step 1: one the requesting BU may source from, else '' (any company in the group); a
    // customer rental always comes from the owner itself.
    var rental = isRental(opts, opt);
    var srcIds = sourceBus(s, f.bu, rental).map(function (x) { return x.bu; });
    if (rental) f.source = srcIds.indexOf(f.bu) !== -1 ? f.bu : '';
    else if (srcIds.indexOf(f.source) === -1) f.source = '';
    f.step = [1, 2, 3].indexOf(Number(f.step)) !== -1 ? Number(f.step) : 1;
    var seen = {};
    f.lines = (f.lines || []).filter(function (l) { if (!l || !l.unitId || seen[l.unitId]) return false; seen[l.unitId] = true; return true; });
    return { f: f, bus: bus, opts: opts, opt: opt, rental: rental };
  }

  function dateErrors(s, f) {
    var out = [];
    if (!f.from || !f.to) out.push('Give the dates the equipment is needed, from and to.');
    else {
      if (f.from < s.today) out.push('The start cannot be before the demo\'s today, ' + F.date(s.today) + '.');
      if (f.to < f.from) out.push('The end, ' + F.date(f.to) + ', is before the start, ' + F.date(f.from) + '.');
    }
    return out;
  }

  /** The certificate for the site's country, in words with dates ("SASO conformity expires 20 Nov 2026, before the hire ends"). */
  function certWords(s, u, code, to) {
    var cs = (u.certs || []).filter(function (c) { return c.country === code; });
    var cn = inCountry(s, code);
    if (!cs.length) return { ok: false, text: 'No certificate for ' + cn + ' (MC-FR-18)' };
    var bad = cs.filter(function (c) { return c.expiry < to; })[0];
    if (bad) return { ok: false, text: 'Its ' + bad.type + ' for ' + cn + ' expires ' + F.date(bad.expiry) + ', before the hire ends on ' + F.date(to) + ' (MC-FR-18)' };
    return { ok: true, text: cs.map(function (c) { return c.type + ' for ' + cn + ' to ' + F.date(c.expiry); }).join('; ') };
  }

  function priceText(price) {
    if (!price) return '';
    return F.money(price.week, price.currency) + ' a week · ' + F.money(price.day, price.currency) + ' a day';
  }

  /** One sourcing option (fxEngine.sourcing) as a card: owner, relationship, where it is, lead time, price, estimate, usable or why not. */
  function card(s, o, f, opt, picked) {
    var u = L.unit(s, o.unitId);
    var rel = relOf(o.relation);
    var cw = certWords(s, u, opt.country, f.to);
    var days = f.from && f.to && f.to >= f.from ? U.diffDays(f.to, f.from) + 1 : 7;
    var ready = U.addDays(s.today, o.leadDays || 0);
    var late = o.leadDays > 0 && f.from && ready > f.from;
    var why = '';
    if (!o.usable) {
      why = o.busyWith ? 'Booked on ' + o.busyWith.request + ' from ' + F.short(o.busyWith.from) + ' to ' + F.date(o.busyWith.to)
        : !o.certOk ? cw.text
          : !o.price ? 'No price agreed between ' + o.ownerName + ' and ' + L.buName(s, f.bu) + (opt.kind === 'customer' ? ' for this customer' : '')
            : u.status === 'IN_REPAIR' ? 'In repair at ' + o.ownerShort : 'Not usable';
    }
    var home = U.byId(s.orgs, u.home);
    var where = u.custody.label || ((U.byId(s.orgs, u.custody.org) || home || {}).name) || '';
    return {
      unitId: o.unitId, serial: o.serial, name: o.name, cls: o.cls, clsName: (U.byId(s.classes, o.cls) || {}).name || o.cls,
      owner: o.owner, ownerName: o.ownerName, ownerShort: o.ownerShort, ownerCompany: (L.le(s, o.ownerLe) || {}).name || o.ownerShort,
      relation: o.relation, relLabel: rel.label, relTone: rel.tone, relWords: rel.words, priority: o.priority,
      holdText: o.hold === 'STOCK' ? 'Stock · item ' + u.stock.item : 'Asset · ' + u.asset.number,
      where: where, country: o.country, countryName: countryName(s, o.country),
      lead: o.leadDays ? 'Lead time ' + o.leadDays + (o.leadDays === 1 ? ' day' : ' days') + ': on site from ' + F.date(ready) : 'On hand: no lead time',
      leadLate: !!late, leadNote: late ? 'That is after the start, ' + F.date(f.from) + ': move the start or expect it late' : '',
      price: o.price ? priceText(o.price) : 'No price agreed', priceBasis: o.price ? o.price.basis : '', priceCurrency: o.price ? o.price.currency : '',
      estimate: o.estimate, estimateText: o.price ? F.money(o.estimate, o.estimateCurrency) : '', estimateCurrency: o.estimateCurrency,
      estimateNote: o.estimateNote, estimateFor: 'for ' + days + (days === 1 ? ' day' : ' days') + (o.estimateNote ? ', ' + o.estimateNote : ''),
      usable: o.usable, why: why, certText: cw.text, certOk: cw.ok, picked: !!picked
    };
  }

  /**
   * The cards for a class and the dates, grouped by owner: own fleet first, then the same company, then intercompany;
   * only the sourcing BU's units when one is chosen on step 1 (f.source).
   */
  function sourcingFor(s, f, opt, cls) {
    if (!opt) return [];
    var q = { requestingBu: f.bu, cls: cls, from: f.from, to: f.to, country: opt.country, customerId: opt.kind === 'customer' ? opt.id : '' };
    var list = E.sourcing(s, q).filter(function (o) { return !f.source || o.owner === f.source; }).sort(function (a, b) { return (a.priority - b.priority) || (b.usable - a.usable) || a.serial.localeCompare(b.serial); });
    return list.map(function (o) { return card(s, o, f, opt, f.lines.some(function (l) { return l.unitId === o.unitId; })); });
  }
  function groupCards(cards) {
    var out = [];
    cards.forEach(function (c) {
      var g = out.filter(function (x) { return x.owner === c.owner; })[0];
      if (!g) {
        g = { owner: c.owner, ownerName: c.ownerName, ownerShort: c.ownerShort, relLabel: c.relLabel, relTone: c.relTone, relWords: c.relWords, cards: [],
          title: c.relation === 'SAME_BU' ? 'Your own fleet · ' + c.ownerName : c.ownerName + ' · ' + c.ownerShort };
        out.push(g);
      }
      g.cards.push(c);
    });
    out.forEach(function (g) { g.usable = g.cards.filter(function (c) { return c.usable; }).length; g.countText = g.usable + ' of ' + g.cards.length + ' usable'; });
    return out;
  }

  /** What will happen for one owner's lines: who approves, how it moves, how it is billed, tax, customs, terms. */
  function willHappen(s, f, opt, owner, cards) {
    var rel = cards[0].relation;
    var reqBu = L.bu(s, f.bu);
    var reqLe = L.le(s, reqBu.le);
    var ownLe = L.leOf(s, owner);
    var em = personaFor(owner, 'owner-em');
    var ag = rel === 'SAME_BU' ? null : (rel === 'CUSTOMER'
      ? s.agreements.filter(function (a) { return a.provider === owner && a.customer === opt.id && a.status === 'ACTIVE'; })[0]
      : s.agreements.filter(function (a) { return a.provider === owner && a.receiver === f.bu && a.status === 'ACTIVE'; })[0]);
    var prjText = opt.kind === 'project' ? opt.number : '';
    var out = [];
    out.push({ key: 'approve', label: 'Approves', text: (rel === 'SAME_BU' ? 'Your own BU, ' + L.buName(s, owner) + ', as the owner,' : L.buName(s, owner) + ', the owner,') + ' approves and allocates each unit in Approve & allocate'
      + (em ? ' (' + em.name + ', ' + em.title + ')' : ' (its equipment manager: no one plays it in the demo, Admin can)') + '.' });
    if (rel === 'CUSTOMER' && ag && ag.depositPct) {
      var dep = U.r2(U.sum(cards, function (c) { var o = L.unit(s, c.unitId); return o && ag.rates[o.cls] ? ag.rates[o.cls].week * 4 : 0; }) * ag.depositPct);
      out.push({ key: 'deposit', label: 'Deposit first', text: 'The rental desk takes a deposit of ' + F.money(dep, ag.currency) + ' (' + pct(ag.depositPct) + ' of four weeks) before approval: Fusion Receivables records it as a customer deposit.' });
    }
    var holds = unique(cards.map(function (c) { return L.unit(s, c.unitId).hold; }));
    var moves = [];
    if (holds.indexOf('ASSET') !== -1) moves.push('an asset moves by custody only: Fusion Assets updates its location, with no accounting');
    if (holds.indexOf('STOCK') !== -1) moves.push('stock moves by a transfer order inside ' + ownLe.short + ', from its yard to its own ' + (rel === 'CUSTOMER' ? 'org for customer sites' : 'deployment org') + ' in ' + inCountry(s, opt.country) + ' (GR-6)');
    out.push({ key: 'move', label: 'Moves', text: (rel === 'SAME_BU' ? 'It comes from your own store: ' : whose(ownLe.short) + ' yard ships it: ') + moves.join('; ') + '. On hire when the site receives it.' });
    if (rel === 'IC_DOMESTIC' || rel === 'IC_CROSS_BORDER') {
      out.push({ key: 'bill', label: 'Billed', text: 'Each month ' + ownLe.short + ' sends a statement that ' + reqLe.short + ' agrees; then the invoice pair: an AR invoice in ' + ownLe.short
        + ' and an AP invoice in ' + reqLe.short + ' coded to ' + (prjText || 'the project') + '. PPM shows the cost on the project.' + (s.settings.netting ? ' Settled by the monthly netting.' : '') });
      if (rel === 'IC_DOMESTIC') out.push({ key: 'tax', label: 'Tax', text: 'Domestic: VAT at ' + pct(L.country(s, ownLe.country).vat) + ' (' + countryName(s, ownLe.country) + ') on the invoice.' });
      else {
        out.push({ key: 'tax', label: 'Tax and currency', text: 'Cross-border: invoiced in ' + (ag ? ag.currency : ownLe.currency) + ' without VAT; ' + reqLe.short + ' self-assesses '
          + pct(L.country(s, reqLe.country).vat) + ' (reverse charge)' + (ag && ag.wht ? ' and withholds ' + pct(ag.wht) + ' at payment' : '') + '; booked in ' + reqLe.currency + ' at the invoice date\'s rate.' });
        out.push({ key: 'customs', label: 'Customs', text: 'From ' + inCountry(s, ownLe.country) + ' to ' + inCountry(s, opt.country) + ': a temporary import permit when it ships, re-exported within 30 days after the hire ends; certificates for '
          + inCountry(s, opt.country) + ' are checked.' });
      }
    } else if (rel === 'SAME_LE') {
      out.push({ key: 'bill', label: 'Billed', text: 'A PPM cross-charge from ' + L.buName(s, owner) + ' to ' + (prjText || 'the project') + ': no invoices and no tax, one legal entity (OD-14).' });
    } else if (rel === 'SAME_BU') {
      out.push({ key: 'bill', label: 'Cost', text: 'Your own equipment: its cost goes straight to ' + (prjText || 'the project') + ' in PPM at the internal cost rate (from its depreciation); no invoice.' });
    } else if (rel === 'CUSTOMER') {
      out.push({ key: 'bill', label: 'Billed', text: ownLe.short + ' invoices ' + opt.title + ' in Fusion Receivables from the month\'s charges, VAT ' + pct(L.country(s, ownLe.country).vat)
        + (ag && ag.depositPct ? '; the deposit is applied or refunded after the return inspection' : '') + '. No intercompany.' });
    }
    if (ag) {
      var terms = [];
      if (ag.transport) terms.push('transport ' + F.money(ag.transport, ag.currency) + ' each way');
      if (ag.minDays) terms.push('minimum hire ' + ag.minDays + ' days');
      if (ag.standbyPct) terms.push('standby at ' + pct(ag.standbyPct));
      if (ag.breakdownCredit) terms.push('breakdown days credited');
      out.push({ key: 'terms', label: 'Terms', text: ag.number + ' v' + ag.version + ': ' + terms.join(', ') + '.' });
    }
    return out;
  }

  /** New request: the three steps as the persona played sees them. */
  function form(s, raw) {
    var n = normalise(s, raw);
    var f = n.f;
    var opt = n.opt;
    var me = V.me(s);
    var bu = n.bus.filter(function (b) { return b.id === f.bu; })[0] || null;
    var errors = dateErrors(s, f);
    var forError = !opt ? 'Choose what the equipment is for: one of ' + (bu ? whose(bu.name) : 'your BU’s') + ' projects' + (n.opts.some(function (o) { return o.kind === 'customer'; }) ? ' or a customer' : '') + '.' : '';
    var step1Ok = !!opt && !errors.length;
    var cards = step1Ok ? sourcingFor(s, f, opt, f.cls) : [];
    var classes = s.classes.map(function (c) {
      var n2 = step1Ok ? sourcingFor(s, f, opt, c.id) : [];
      return { id: c.id, name: c.name, icon: c.icon, on: c.id === f.cls, count: n2.filter(function (x) { return x.usable; }).length, total: n2.length,
        picked: f.lines.filter(function (l) { return l.cls === c.id; }).length };
    });
    // The cart: each line as its card (priced for these dates), still offered and usable or not.
    var lines = [];
    if (step1Ok) {
      f.lines.forEach(function (l) {
        var c = sourcingFor(s, f, opt, l.cls).filter(function (x) { return x.unitId === l.unitId; })[0];
        if (c) lines.push(c);
      });
    }
    f.lines = lines.map(function (c) { return { unitId: c.unitId, cls: c.cls }; });
    var groups = [];
    lines.forEach(function (c) {
      var g = groups.filter(function (x) { return x.owner === c.owner; })[0];
      if (!g) { g = { owner: c.owner, ownerName: c.ownerName, ownerShort: c.ownerShort, relLabel: c.relLabel, relTone: c.relTone, relWords: c.relWords, cards: [] }; groups.push(g); }
      g.cards.push(c);
    });
    groups.forEach(function (g) {
      g.routeText = bu ? 'Requested by ' + bu.name + ' (' + bu.company + ') → Sourced from ' + g.ownerName + ' (' + g.ownerShort + ')' : '';
      g.happen = willHappen(s, f, opt, g.owner, g.cards);
      g.subtotal = U.sum(g.cards, function (c) { return c.estimate; });
      g.subtotalText = bu ? F.money(g.subtotal, bu.currency) : '';
    });
    var blocked = lines.filter(function (c) { return !c.usable; });
    var total = U.sum(lines, function (c) { return c.usable ? c.estimate : 0; });
    var converted = lines.some(function (c) { return !!c.estimateNote; });
    var days = f.from && f.to && f.to >= f.from ? U.diffDays(f.to, f.from) + 1 : 0;
    var over = s.settings.requesterApproval && opt && opt.kind === 'project' && total > s.settings.requesterThreshold;
    var prj = opt && opt.kind === 'project' ? L.project(s, opt.id) : null;
    var reqNotes = [];
    if (over) reqNotes.push('Over ' + F.money(s.settings.requesterThreshold, bu.currency) + ': ' + bu.name + ' approves it first (receiver review, OD-12), then the owners see their lines.');
    if (prj && prj.type === 'contract') {
      reqNotes.push(bu.company + ' bills ' + (L.customer(s, prj.customer) || {}).name + ' for it ' + (s.settings.s2Billing === 'PPM' ? 'under the project contract (PPM billing)' : 'with an EquipRite invoice (OD-07 b)')
        + ', at cost + ' + Math.round(prj.markupPct * 100) + ' %, once the cost is on the project.');
    }
    var stepOk = { 1: step1Ok, 2: step1Ok && lines.length > 0 && !blocked.length, 3: step1Ok && lines.length > 0 && !blocked.length };
    if (f.step > 1 && !step1Ok) f.step = 1;
    if (f.step > 2 && !stepOk[2]) f.step = 2;
    var canRaise = n.bus.length > 0;
    // Source from (step 1) and what steps 2 and 3 say about it.
    var srcCards = canRaise ? sources(s, f, opt, n.rental, !errors.length) : [];
    var src = srcCards.filter(function (c) { return c.on && !c.any; })[0] || null;
    var route = routeOf(s, bu, f.source);
    var clsName = (U.byId(s.classes, f.cls) || {}).name || f.cls;
    var owners = unique(lines.map(function (c) { return c.ownerName + ' · ' + c.ownerShort; }));
    return {
      ready: true, error: '', me: me, form: f, canRaise: canRaise, bus: n.bus, bu: bu, multiBu: n.bus.length > 1,
      options: n.opts.map(function (o) { return Object.assign({}, o, { on: o.key === f.forKey }); }), opt: opt,
      tasks: opt ? opt.tasks.map(function (t) { return { id: t, on: t === f.task }; }) : [],
      today: s.today, todayText: F.date(s.today), minTo: f.from > s.today ? f.from : s.today, days: days,
      daysText: days ? days + (days === 1 ? ' day' : ' days') + ': ' + F.date(f.from) + ' to ' + F.date(f.to) : '',
      dateErrors: errors, forError: forError,
      siteText: opt ? (opt.kind === 'customer' ? (f.site || 'Customer site') : opt.site) + ' · ' + opt.countryName : '',
      countryText: opt ? countryFacts(s, opt.country) : '',
      steps: STEPS.map(function (x) { return { n: x[0], label: x[1], state: x[0] === f.step ? 'current' : (x[0] < f.step ? 'done' : 'todo'), ok: x[0] === 1 ? true : stepOk[x[0] - 1] }; }),
      step: f.step, step1Ok: step1Ok, step2Ok: stepOk[2],
      sources: srcCards, source: src, rental: n.rental, route: route, routeText: route ? route.text : '',
      sourceIntro: n.rental ? 'The owner of the equipment rents it out' : 'The sourcing business unit owns the equipment: it approves each line, ships it and bills it',
      sourceNote: n.rental && bu ? 'A customer rental always comes from the owner itself: ' + bu.name + ' rents out its own units, never another company’s.' : '',
      sourceHint: !n.rental && lines.length ? 'On the request so far: ' + lines.map(function (c) { return c.serial + ' (' + c.ownerName + ')'; }).join(', ')
        + '. Choosing one company keeps only its units on the request.' : '',
      shownText: src ? 'Units of ' + src.title + ' (' + src.company + ')' + (src.own ? ', your own fleet' : '') + (n.rental ? ': a customer rental always comes from the owner itself' : '')
        : 'Units of every company you may source from' + (srcCards.some(function (c) { return c.own; }) ? ', own fleet first' : ', by priority'),
      canShowAll: !!src && !n.rental,
      emptyText: src && !n.rental ? src.title + ' has no ' + clsName + ' for you. Try another class, or show every company.'
        : 'No business unit you may source from has ' + clsName + '. Try another class.',
      sourcingText: owners.join('; '),
      classes: classes, cls: f.cls, clsName: clsName, groups: groupCards(cards), cardCount: cards.length, cards: cards,
      lines: lines, lineCount: lines.length, review: groups, blocked: blocked.map(function (c) { return c.serial + ': ' + c.why; }),
      total: total, totalText: bu ? F.money(total, bu.currency) : '', totalNote: converted ? 'estimate at today\'s rate' : 'estimate', reqNotes: reqNotes,
      submitText: canRaise && bu ? 'Submit raises the request for ' + bu.name + ' and tells each owner\'s equipment manager. EquipRite records it; nothing goes to Fusion yet: Fusion\'s part starts when the owner ships (asset location or a transfer order) and with the month\'s charges (invoices).' : '',
      title: opt ? (opt.kind === 'customer' ? 'Customer rental for ' + opt.title : opt.typeText + ' ' + opt.number) : 'New request'
    };
  }
  function countryFacts(s, code) {
    var c = L.country(s, code);
    if (!c) return '';
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return c.name + ': ' + c.currency + ', VAT ' + pct(c.vat) + (c.wht ? ', withholding ' + pct(c.wht) : '') + ', weekend ' + c.weekend.map(function (d) { return days[d]; }).join('–');
  }

  /** A change to the form from the page (field, value) → the new raw form. */
  function change(raw, field, value) {
    var f = Object.assign({}, raw || {});
    f.lines = (f.lines || []).slice();
    var v = value == null ? '' : String(value);
    if (field === 'bu') { f.bu = v; f.forKey = ''; f.task = ''; f.source = ''; f.lines = []; f.step = 1; }
    else if (field === 'forKey') { if (f.forKey !== v) f.lines = []; f.forKey = v; f.task = ''; f.site = ''; }
    else if (field === 'task' || field === 'site' || field === 'note' || field === 'cls') f[field] = v;
    else if (field === 'source') f.source = v === 'any' ? '' : v;
    else if (field === 'from') { f.from = v; if (f.to && v && f.to < v) f.to = v; }
    else if (field === 'to') f.to = v;
    else if (field === 'step') f.step = Number(v) || 1;
    else if (field === 'add') { var parts = v.split('|'); if (parts[0] && !f.lines.some(function (l) { return l.unitId === parts[0]; })) f.lines.push({ unitId: parts[0], cls: parts[1] || f.cls }); }
    else if (field === 'remove') f.lines = f.lines.filter(function (l) { return l.unitId !== v; });
    else if (field === 'reset') return { bu: f.bu, step: 1 };
    return f;
  }

  /** What Submit sends to fxEngine createRequest. */
  function payload(s, raw) {
    var n = normalise(s, raw);
    var f = n.f;
    var o = n.opt;
    // Each line names its sourcing BU (the unit's owner); a sourcing BU chosen on step 1 keeps only its units.
    var lines = f.lines.map(function (l) { var u = L.unit(s, l.unitId); return { cls: l.cls, unitId: l.unitId, provider: u ? u.owner : '' }; })
      .filter(function (l) { return !f.source || l.provider === f.source; });
    var p = { requestingBu: f.bu, from: f.from, to: f.to, note: f.note || '', lines: lines };
    if (o && o.kind === 'customer') { p.customerId = o.id; if (f.site) p.site = f.site; } else if (o) { p.projectId = o.id; if (f.task) p.task = f.task; }
    return p;
  }

  // ── A request in its own tab ─────────────────────────────────────────────────────────────────────────────────
  var EVENTS = [['requested', 'Requested'], ['approved', 'Approved and allocated'], ['shipped', 'Shipped'], ['onHire', 'On hire'], ['offHire', 'Off hire'], ['returned', 'Back at the yard']];

  function lineNext(s, r, l) {
    var rental = r.type === 'CUSTOMER_RENTAL';
    var siteRoles = rental ? ['desk'] : ['site'];
    var siteBu = rental ? l.provider : r.requestingBu;
    if (l.status === 'REQUESTED') {
      if (r.status === 'AWAITING_REQUESTER_APPROVAL') return null;
      var ag = L.agreement(s, l.agreementId);
      if (rental && ag && ag.depositPct && !r.deposit) return doer(s, 'billing', ['desk'], l.provider, 'The rental desk takes the deposit, then the owner approves');
      return doer(s, 'approvals', ['owner-em'], l.provider, L.buName(s, l.provider) + ' approves and allocates a unit');
    }
    if (l.status === 'APPROVED') return l.inPlace ? doer(s, 'site', siteRoles, siteBu, 'Receive it on site (handed over in place)') : doer(s, 'yard', ['yard'], l.provider, L.leShort(s, l.providerLe) + '\'s yard ships it');
    if (l.status === 'SHIPPED') return doer(s, 'site', siteRoles, siteBu, 'Receive it on site: it goes on hire');
    if (l.status === 'ON_HIRE') return doer(s, 'site', rental ? ['desk'] : ['site', 'requester'], siteBu, 'On site: hours, breakdowns, moves, off hire');
    if (l.status === 'OFF_HIRED') return doer(s, 'yard', ['yard'], l.provider, L.leShort(s, l.providerLe) + '\'s yard collects it');
    if (l.status === 'RETURNED') return doer(s, 'yard', ['yard', 'owner-em'], l.provider, L.leShort(s, l.providerLe) + ' inspects it');
    return null;
  }

  function lineDetail(s, r, l, lv) {
    var u = L.unit(s, l.unitId || l.preferredUnit);
    var events = EVENTS.filter(function (e) { return l.events[e[0]]; }).map(function (e) { return { label: e[1], date: F.date(l.events[e[0]]) }; });
    if (l.inspection) events.push({ label: 'Inspected', date: F.date(l.inspection.date) });
    if (l.loss) events.push({ label: 'Lost', date: F.date(l.loss.date) });
    var bds = s.breakdowns.filter(function (b) { return b.lineId === l.id; }).map(function (b) { return F.date(b.date) + ': ' + b.days + (b.days === 1 ? ' day' : ' days') + ', ' + b.reason + ' (' + b.by + ')'; });
    var moves = l.segments.map(function (sg, i) {
      var prj = L.project(s, sg.projectId);
      return (i ? 'Moved to ' : 'On ') + (prj ? prj.number + ' · ' + prj.name : '') + (sg.task ? ', task ' + sg.task : '') + ' from ' + F.date(sg.from);
    });
    var c = lv.customs;
    var ag = L.agreement(s, l.agreementId);
    var cur = l.price ? l.price.currency : '';
    var ins = l.inspection;
    var hrs = s.hours.filter(function (h) { return h.lineId === l.id; });
    var dayCount = hrs.length;
    return Object.assign({}, lv, {
      unitTitle: u ? u.serial + ' · ' + u.name : lv.clsName + ' (unit to be chosen)',
      ownerText: lv.providerName + ' · ' + L.le(s, l.providerLe).name, relChip: relOf(l.relation), stageTone: stageTone(lv.stage),
      agreementText: ag ? ag.number + ' v' + ag.version + ' (' + { INTERCOMPANY: 'intercompany agreement', CROSS_CHARGE: 'cross-charge rates', CUSTOMER: 'customer agreement' }[ag.kind] + ')' : 'None: own equipment at the internal cost rate',
      priceText: l.price ? priceText(l.price) : '', estimateText: l.estimate ? F.money(l.estimate, L.le(s, r.requestingLe).currency) + ' estimated at request' : '',
      eventList: events, hoursText: dayCount ? dayCount + (dayCount === 1 ? ' day' : ' days') + ' of hours: ' + lv.usage + ' h worked, ' + lv.standby + ' h standby'
        + (lv.hoursWaiting ? ' (' + lv.hoursWaiting + ' waiting for approval)' : ', all approved') : (l.events.onHire ? 'No hours recorded yet' : 'Hours start when it is on hire'),
      breakdownList: bds, moveList: moves, moved: l.segments.length > 1,
      customsText: c ? c.regime + ' ' + c.permit + ': ' + countryName(s, c.from) + ' → ' + countryName(s, c.to) + ', entered ' + F.date(c.entry) + ', re-export by ' + F.date(c.reexportBy)
        + ' · ' + (c.status === 'OPEN' ? 'open' : c.status === 'CLOSED' ? 'closed (' + (c.outcome || '') + ')' : 'to regularise: ' + (c.outcome || '')) + '; value ' + F.money(c.value, L.leOf(s, c.owner).currency) : '',
      inspectionText: ins ? 'Inspected ' + F.date(ins.date) + ' by ' + ins.by + ': ' + (ins.damage > 0 ? 'damaged' : 'pass') : '',
      damageText: ins && ins.damage > 0 ? F.money(ins.damage, cur) + (ins.note ? ' · ' + ins.note : '') + ' · ' + ins.photos + ' photos'
        + (ins.damage > s.settings.damageThreshold && l.relation.indexOf('IC_') === 0 ? ' · above ' + F.money(s.settings.damageThreshold, cur) + ': needs the user\'s acceptance (OD-11)' : '') : '',
      lossText: l.loss ? 'Lost ' + F.date(l.loss.date) + ': charged ' + F.money(l.loss.value, L.leOf(s, l.provider).currency) + ' (net book value ' + F.money(l.loss.nbv, L.leOf(s, l.provider).currency)
        + ' + ' + pct(s.settings.lossMarkupPct) + '), insurance claim ' + l.loss.claim : '',
      transferText: l.status === 'TRANSFERRED' && l.movedTo ? 'Handed over on site to ' + L.buName(s, l.movedTo) + ' on ' + F.date(l.events.offHire) : '',
      reasonText: l.reason ? 'Refused: ' + l.reason : '',
      next: lineNext(s, r, l)
    });
  }

  // Each finance checklist item: where it is done, by whom (fxViews.finance keys).
  var GO = {
    charges: ['charges', ['ic-finance', 'owner-finance'], 'provider'], agreed: ['charges', ['receiver-review'], 'requesting'],
    ar: ['ic-workbench', ['ic-finance'], 'provider'], ap: ['ic-workbench', ['ic-finance'], 'requesting'], cost: ['ic-workbench', ['ic-finance'], 'requesting'],
    accrual: ['ic-workbench', ['ic-finance'], 'provider'], settled: ['ic-workbench', ['ic-finance'], 'provider'], internal: ['ic-workbench', ['ic-finance', 'finance'], 'requesting'],
    bill: ['billing', ['finance', 'receiver-review', 'ic-finance'], 'requesting'], deposit: ['billing', ['desk'], 'provider'], invoiced: ['billing', ['desk', 'owner-finance', 'ic-finance'], 'provider'],
    depositSettled: ['billing', ['desk'], 'provider'], damage: ['charges', ['receiver-review', 'owner-finance', 'ic-finance'], 'requesting']
  };
  function financeItems(s, r, fin) {
    var provider = (r.lines[0] || {}).provider;
    return fin.items.map(function (it) {
      var g = GO[it.key];
      if (it.key === 'paid') g = ['billing', ['desk', 'finance', 'owner-finance', 'ic-finance'], r.type === 'CUSTOMER_RENTAL' ? 'provider' : 'requesting'];
      var go = g && (it.state === 'pending' || it.state === 'failed') ? doer(s, g[0], g[1], g[2] === 'provider' ? provider : r.requestingBu, it.label) : null;
      return Object.assign({}, it, { tone: { done: 'ok', pending: 'todo', failed: 'bad', running: 'run', na: 'na' }[it.state] || 'todo', go: go });
    });
  }

  // ── Approval & flow: every step of a request in order, the BU that does it, who can, and where it is ──────────
  /**
   * The rules (FDD v2.0): the requesting BU asks and carries the cost; the sourcing BU (the owner) approves and
   * allocates (owner-em) and ships (yard); the requesting BU approves first only when OD-12 asks for it (above its
   * threshold, status AWAITING_REQUESTER_APPROVAL); a customer rental takes the rental desk's deposit before the owner
   * may approve; the site receives (for a customer rental the owner's rental desk); the requesting BU approves the
   * hours; then the money steps of fxViews.finance. Each step's people are PERSONAS with one of its roles in its BU.
   */
  var FLOW_STATE = { done: ['ok', 'Done'], current: ['next', 'Now'], waiting: ['todo', 'Waiting'], na: ['na', 'Not needed'], refused: ['bad', 'Refused'], running: ['run', 'Running'] };

  /** A title's role inside a sentence: "Rental desk" → "rental desk"; "Equipment Manager" stays. */
  function roleWords(title) {
    var role = String(title || '').split(' · ')[0];
    var w = role.split(' ');
    return w.length > 1 && /^[A-Z]/.test(w[1]) ? role : role.charAt(0).toLowerCase() + role.slice(1);
  }

  /**
   * Who can do a step: the people played (never Admin) with one of its roles in its BU, who may open its screen (the
   * request's own tab when navId is ''); the screen's player first, so "Play as" names the first one.
   */
  function peopleFor(s, roles, buId, navId) {
    var it = navId ? nav.item(navId) : null;
    var list = Seed.PERSONAS.filter(function (p) {
      return !isAdmin(p) && p.bus.indexOf(buId) !== -1 && roles.some(function (x) { return p.roles.indexOf(x) !== -1; }) && (!it || nav.itemVisible(it, p.roles));
    });
    if (it && it.player) list = list.filter(function (p) { return p.id === it.player; }).concat(list.filter(function (p) { return p.id !== it.player; }));
    return list.map(function (p) {
      var role = p.title.split(' · ')[0];
      return { id: p.id, name: p.name, initials: p.initials, title: p.title, role: role, text: p.name + ' · ' + p.title, inWords: p.name + ', ' + roleWords(p.title) };
    });
  }

  /** The current step's button: "It's you" (open its screen, or act here), or "Play as Ana and open Approve & allocate". */
  function stepGo(s, st, people) {
    var me = E.persona(s);
    var it = st.navId ? nav.item(st.navId) : null;
    var screen = it ? it.label : '';
    var mine = st.roles.some(function (x) { return L.can(me, x); }) && L.inBu(me, st.bu) && (!it || nav.itemVisible(it, me.roles));
    if (mine) {
      return { mine: true, none: false, persona: me.id, personaName: me.name, navId: st.navId, act: st.act || '', requestId: st.requestId || '',
        action: st.act ? st.actLabel : 'Open ' + screen, youText: 'It\'s you: ' + me.name + (st.act ? ' does it here' : ' does it in ' + screen) };
    }
    var p = people[0];
    if (!p) return { mine: false, none: true, persona: '', personaName: '', navId: '', act: '', requestId: '', youText: '', action: 'No one plays this for ' + L.buName(s, st.bu) + ' in the demo (Admin can)' };
    return { mine: false, none: false, persona: p.id, personaName: p.name, navId: st.navId, act: '', requestId: '', youText: '',
      action: 'Play as ' + first(p.name) + (screen ? ' and open ' + screen : ' and ' + st.hereText) };
  }

  /** The log entries of this request (newest first), the first one that matches: { at, who } of a step done. */
  function saidOn(s, r, re, lineId) {
    return (s.log || []).filter(function (x) { return x.refs && x.refs.requestId === r.id && (!lineId || x.refs.lineId === lineId) && re.test(x.what); })[0] || null;
  }

  /** One line's steps in order, before their states are settled (open, done, na, refused). */
  function lineSteps(s, r, l) {
    var rental = r.type === 'CUSTOMER_RENTAL';
    var u = L.unit(s, l.unitId || l.preferredUnit);
    var serial = u ? u.serial : ((U.byId(s.classes, l.cls) || {}).name || l.cls);
    var reqBu = r.requestingBu;
    var own = l.provider;
    var ownCo = L.leShort(s, l.providerLe);
    var ownName = L.buName(s, own);
    var reqName = L.buName(s, reqBu);
    var cust = L.customer(s, r.customerId);
    var custName = cust ? cust.name.split(' · ')[0] : 'the customer';
    var refused = l.status === 'REJECTED';
    var lost = l.status === 'LOST';
    var moved = l.status === 'TRANSFERRED';
    var siteBu = rental ? own : reqBu;
    var siteRoles = rental ? ['desk'] : ['site'];
    var gone = 'Not needed: ' + ownName + ' refused the line';
    var said = function (re, perLine) { return saidOn(s, r, re, perLine ? l.id : ''); };
    var out = [];

    out.push({ key: 'raised', label: 'Raised', short: 'raising', bu: reqBu, roles: rental ? ['desk'] : ['requester'], navId: 'new-request', state: 'done', at: r.createdAt, who: r.createdBy, note: r.note || '',
      what: rental ? whose(reqName) + ' rental desk raises it for ' + custName + ' and carries it' : reqName + ' asks for ' + serial + ' for its project and carries the cost' });

    // The requesting BU's approval, only above its threshold when OD-12 asks for it.
    var cur = L.le(s, r.requestingLe).currency;
    var est = U.sum(r.lines, function (x) { return x.estimate || 0; });
    var thText = F.money(s.settings.requesterThreshold, cur);
    var awaiting = r.status === 'AWAITING_REQUESTER_APPROVAL';
    var apLog = said(/above the threshold$/);
    var why = 'The estimate, ' + F.money(est, cur) + ', is above ' + whose(reqName) + ' threshold of ' + thText + ' (OD-12)';
    out.push({ key: 'requester', label: 'Requesting BU approves', short: whose(reqName) + ' approval', bu: reqBu, roles: ['receiver-review'], navId: '', act: 'approveRequest', actLabel: 'Approve for my BU', requestId: r.id,
      hereText: 'approve it here', state: awaiting ? 'open' : apLog ? 'done' : 'na', at: apLog ? apLog.at : '', who: apLog ? apLog.who : '',
      what: reqName + ' agrees to the request before the owner sees it (receiver review)',
      note: awaiting || apLog ? why : rental ? 'Not needed: a customer rental is approved by the owner only'
        : !s.settings.requesterApproval ? 'Not needed: only the owner approves (OD-12)'
          : est <= s.settings.requesterThreshold ? 'Not needed: the estimate, ' + F.money(est, cur) + ', is not above its threshold of ' + thText + ' (OD-12)'
            : 'Not needed: raised before OD-12 asked for it' });

    var ag = L.agreement(s, l.agreementId);
    var deposit = rental && ag && ag.depositPct;
    if (rental) {
      var amt = r.deposit ? r.deposit.amount : U.r2(U.sum(r.lines, function (q) { return q.price ? q.price.week * 4 : 0; }) * (deposit || 0));
      var dLog = said(/^Received the deposit/);
      out.push({ key: 'deposit', label: 'Deposit taken', short: 'the deposit', bu: own, roles: ['desk'], navId: 'billing', at: r.deposit ? r.deposit.date : '', who: dLog ? dLog.who : '',
        state: !deposit ? 'na' : r.deposit ? 'done' : 'open',
        what: 'The rental desk takes ' + whose(custName) + ' deposit' + (deposit ? ', ' + pct(deposit) + ' of four weeks (' + F.money(amt, ag.currency) + ')' : '') + ', before the owner may approve; Fusion Receivables records it',
        note: deposit ? '' : 'Not needed: the rental agreement asks for no deposit' });
    }

    var rLog = said(/^Refused a line/, true);
    var allocated = l.unitId ? L.unit(s, l.unitId) : null;
    out.push({ key: 'approve', approver: true, label: 'Owner approves and allocates', short: 'approval', bu: own, roles: ['owner-em'], navId: 'approvals',
      state: refused ? 'refused' : l.events.approved ? 'done' : 'open', at: refused ? (rLog ? rLog.at : '') : l.events.approved || '', who: refused ? (rLog ? rLog.who : '') : l.approvedBy || '',
      what: ownName + ', the owner of ' + serial + ', approves the line and allocates a unit: the approver',
      note: refused ? 'Refused: ' + (l.reason || 'no reason given') : l.events.approved ? (allocated ? 'Allocated ' + allocated.serial : '')
        : awaiting ? 'Waits for ' + whose(reqName) + ' approval first' : deposit && !r.deposit ? 'Waits for the deposit: the rental desk takes it first' : '' });

    var sLog = said(/^Shipped /, true);
    var customs = l.customsId ? U.byId(s.customs, l.customsId) : null;
    out.push({ key: 'ship', label: 'Shipped', short: 'shipping', bu: own, roles: ['yard'], navId: 'yard',
      state: refused || l.inPlace ? 'na' : l.events.shipped ? 'done' : 'open', at: l.events.shipped || '', who: sLog ? sLog.who : '',
      what: whose(ownCo) + ' yard ships it to ' + r.site + (u && u.hold === 'STOCK' ? ': a transfer order inside ' + ownCo + ' (GR-6)' : ': Fusion Assets updates its location'),
      note: refused ? gone : l.inPlace ? 'Not needed: handed over on site, it is already there' : customs ? 'Temporary import ' + customs.permit + ' at the border' : '' });

    var vLog = said(/: on hire from /, true);
    out.push({ key: 'receive', label: 'Received: on hire', short: 'receipt on site', bu: siteBu, roles: siteRoles, navId: 'site',
      state: refused ? 'na' : l.events.onHire ? 'done' : 'open', at: l.events.onHire || '', who: vLog ? vLog.who : '',
      what: rental ? 'The rental desk confirms ' + custName + ' has it: on hire from that day' : 'The site receives it at ' + r.site + ': on hire from that day (OD-05)',
      note: refused ? gone : '' });

    if (!rental) {
      var hrs = s.hours.filter(function (h) { return h.lineId === l.id; });
      var waiting = hrs.filter(function (h) { return !h.approved; }).length;
      var approved = hrs.filter(function (h) { return h.approved; });
      var hLog = said(/^Approved \d+ days of hours/, true);
      var ended = !!l.events.offHire || lost || moved;
      var hs = 'open';
      var hn = '';
      if (refused) { hs = 'na'; hn = gone; } else if (!l.events.onHire) hn = 'From the day it is on hire';
      else if (waiting) hn = waiting + (waiting === 1 ? ' day' : ' days') + ' of hours waiting for approval' + (approved.length ? '; ' + approved.length + ' approved' : '');
      else if (!hrs.length) { hs = ended ? 'na' : 'open'; hn = ended ? 'No hours were recorded' : 'No hours recorded yet: the site records them each day on hire'; }
      else { hs = 'done'; hn = approved.length + (approved.length === 1 ? ' day' : ' days') + ' approved' + (ended ? '' : ' so far; more come while it is on hire'); }
      out.push({ key: 'hours', label: 'Hours recorded and approved', short: 'the hours', bu: reqBu, roles: ['requester', 'receiver-review'], navId: 'site', state: hs,
        at: hs === 'done' && hLog ? hLog.at : '', who: hs === 'done' ? (hLog ? hLog.who : (approved[approved.length - 1] || {}).approvedBy || '') : '',
        what: 'The site records the hours each day on hire; ' + reqName + ' approves them: they are what is charged', note: hn });
    }

    var oLog = said(/^Off hire: /, true);
    var mLog = said(/handed over on site to/, true);
    out.push({ key: 'offHire', label: 'Off hire', short: 'off hire', bu: siteBu, roles: siteRoles, navId: 'site',
      state: refused ? 'na' : moved || lost || l.events.offHire ? 'done' : 'open', at: lost ? l.loss.date : l.events.offHire || '', who: lost ? l.loss.by : moved ? (mLog ? mLog.who : '') : (oLog ? oLog.who : ''),
      what: (rental ? 'The rental desk' : 'The site') + ' releases it when the job is done: the charges stop that day',
      note: refused ? gone : moved ? 'Handed over on site to ' + L.buName(s, l.movedTo) : lost ? 'Lost: charged at the agreed value' : '' });

    var bLog = said(/^Received back /, true);
    var ins = l.inspection;
    out.push({ key: 'back', label: 'Back at the yard and inspected', short: 'the return and inspection', bu: own, roles: ['yard', 'owner-em'], navId: 'yard',
      state: refused || moved || lost ? 'na' : ins ? 'done' : 'open', at: ins ? ins.date : '', who: ins ? ins.by : '',
      what: whose(ownCo) + ' yard collects it and inspects it; damage is charged with photos (MC-FR-29)',
      note: refused ? gone : moved ? 'Not needed: handed over on site to ' + L.buName(s, l.movedTo) + ', it stays out' : lost ? 'Not needed: lost, charged at the agreed value'
        : ins ? (ins.damage > 0 ? 'Damaged: ' + F.money(ins.damage, (l.price || {}).currency) + (ins.note ? ', ' + ins.note : '') : 'Passed')
          : l.events.returned ? 'Back at the yard ' + F.date(l.events.returned) + (bLog ? ' (' + bLog.who + ')' : '') + ': to inspect' : '' });
    return out;
  }

  // Each money step (fxViews.finance key): where it is done, by which roles, on which side, its name in a sentence.
  var MONEY = {
    charges: ['charges', ['ic-finance', 'owner-finance'], 'provider', 'the charge run'],
    agreed: ['charges', ['receiver-review'], 'requesting', 'the statement agreed'],
    ar: ['ic-workbench', ['ic-finance'], 'provider', 'the invoice pair'], ap: ['ic-workbench', ['ic-finance'], 'requesting', 'the invoice pair'],
    cost: ['ic-workbench', ['ic-finance'], 'requesting', 'the cost on the project'], accrual: ['ic-workbench', ['ic-finance'], 'provider', 'the accruals reversed'],
    settled: ['ic-workbench', ['ic-finance'], 'provider', 'settlement'], internal: ['ic-workbench', ['ic-finance'], 'requesting', 'posting to PPM'],
    bill: ['billing', ['finance', 'receiver-review'], 'requesting', 'billing the customer'], invoiced: ['billing', ['desk'], 'provider', 'the customer invoice'],
    paid: ['billing', ['desk', 'finance', 'owner-finance', 'ic-finance'], 'requesting', 'the customer’s payment'],
    depositSettled: ['billing', ['desk'], 'provider', 'settling the deposit'], damage: ['charges', ['receiver-review', 'owner-finance', 'ic-finance'], 'requesting', 'the damage charge']
  };

  /** When a money step was done and by whom, where the state knows it (the log, the statement, the transaction). */
  function moneyDone(s, r, key) {
    var cs = s.charges.filter(function (c) { return c.requestId === r.id; });
    var ids = cs.map(function (c) { return c.id; });
    var stIds = unique(cs.map(function (c) { return c.statementId; }));
    var sts = stIds.map(function (id) { return U.byId(s.statements, id); }).filter(Boolean);
    var find = function (re, f) { return (s.log || []).filter(function (x) { return re.test(x.what) && (!f || f(x)); })[0] || null; };
    var onSt = function (x) { return !!x.refs && stIds.indexOf(x.refs.statementId) !== -1; };
    var mine = function (t) { return (t.refs.chargeIds || []).some(function (x) { return ids.indexOf(x) !== -1; }); };
    var last = function (list) { return list[list.length - 1] || null; };
    var x = null;
    if (key === 'charges') {
      var periods = unique(cs.map(function (c) { return c.period; }));
      x = find(/^Charge run /, function (q) { return periods.some(function (p) { return q.what.indexOf('Charge run ' + p) === 0; }); });
    } else if (key === 'agreed') {
      var st = last(sts.filter(function (q) { return q.agreedAt; }));
      if (st) return { at: st.agreedAt, who: /^No answer/.test(st.agreedBy || '') ? 'silence (no answer in time, MC-FR-23)' : st.agreedBy || '' };
    } else if (key === 'ar' || key === 'ap' || key === 'cost' || key === 'accrual') x = find(/^Created the invoice pair/, onSt);
    else if (key === 'settled') x = find(/^Settled /, onSt);
    else if (key === 'internal') {
      var it = last(s.tx.filter(function (t) { return (t.kind === 'CROSS_CHARGE' || t.kind === 'OWN_COST') && mine(t); }));
      if (it) { x = find(/internal cost line/, function (q) { return q.at === it.date; }); return { at: it.date, who: x ? x.who : '' }; }
    } else if (key === 'bill') {
      var bt = last(s.tx.filter(function (t) { return (t.kind === 'PROJECT_COST' || t.kind === 'CROSS_CHARGE' || t.kind === 'OWN_COST') && mine(t) && t.billed; }));
      var bill = bt ? s.tx.filter(function (t) { return t.number === bt.billed; })[0] : null;
      if (bill) { x = find(/^Billed /, function (q) { return q.refs && q.refs.projectId === r.projectId && q.at === bill.date; }); return { at: bill.date, who: x ? x.who : '' }; }
    } else if (key === 'invoiced') {
      var inv = last(s.tx.filter(function (t) { return t.kind === 'CUSTOMER_AR' && mine(t); }));
      if (inv) x = find(/^Invoiced the customer/, function (q) { return q.what.indexOf(inv.number) !== -1; });
    } else if (key === 'paid') {
      var nos = s.tx.filter(function (t) { return (t.kind === 'CUSTOMER_AR' && mine(t)) || t.kind === 'PROJECT_BILL'; }).map(function (t) { return t.number; });
      x = find(/ paid /, function (q) { return nos.some(function (n) { return q.what.slice(-n.length) === n; }); });
    } else if (key === 'depositSettled') x = saidOn(s, r, /^Settled the deposit on/);
    return x ? { at: x.at, who: x.who } : null;
  }

  /** The money steps (fxViews.finance, without the equipment and the deposit, which are steps of the lines). */
  function moneySteps(s, r, fin) {
    var rental = r.type === 'CUSTOMER_RENTAL';
    var live = r.lines.filter(function (l) { return l.status !== 'REJECTED'; });
    var provider = (live[0] || r.lines[0] || {}).provider;
    var ownCo = L.leShort(s, L.leOf(s, provider).id);
    var reqCo = L.leShort(s, r.requestingLe);
    var sts = unique(s.charges.filter(function (c) { return c.requestId === r.id; }).map(function (c) { return c.statementId; })).map(function (id) { return U.byId(s.statements, id); }).filter(Boolean);
    var draft = sts.some(function (x) { return x.status === 'DRAFT'; });
    var prj = L.project(s, r.projectId);
    var cust = L.customer(s, r.customerId);
    var WHAT = {
      charges: 'The month’s charge run prices each day on hire from the agreement: rental, standby, transport',
      agreed: ownCo + ' releases the month’s statement; ' + reqCo + ' agrees it, or disputes a line within ' + s.settings.disputeDays + ' days (MC-FR-23)',
      ar: 'EquipRite creates the invoice pair: the AR invoice in ' + ownCo, ap: 'The AP invoice in ' + reqCo + ', coded to ' + (prj ? prj.number : 'the project') + ' and its task',
      cost: 'Fusion PPM takes the AP invoice’s cost onto ' + (prj ? prj.number : 'the project'), accrual: 'The cut-off accruals in both ledgers are reversed once the pair is invoiced',
      settled: 'The monthly netting, or a payment, settles the invoice pair', internal: 'One legal entity: a PPM cost on ' + (prj ? prj.number : 'the project') + ', no invoice and no tax',
      bill: reqCo + ' bills ' + (cust ? cust.name.split(' · ')[0] : 'the customer') + ' for the equipment at cost + ' + (prj && prj.markupPct ? Math.round(prj.markupPct * 100) + ' %' : 'its markup'),
      invoiced: ownCo + ' invoices ' + (cust ? cust.name.split(' · ')[0] : 'the customer') + ' in Fusion Receivables from the month’s charges',
      paid: 'The customer pays; the receipt is recorded in Fusion Receivables', depositSettled: 'After the return inspection the deposit is applied to open invoices or refunded',
      damage: 'Damage or loss found at the return is charged (the user accepts it above the threshold, OD-11)'
    };
    var started = r.lines.some(function (l) { return l.events.onHire; });
    var items = fin.items.filter(function (it) { return it.key !== 'ops' && it.key !== 'deposit' && MONEY[it.key]; });
    return items.map(function (it, i) {
      var g = MONEY[it.key];
      // Running (still on hire this month): the step to watch only while nothing after it is done; else it runs alongside.
      var later = items.slice(i + 1).some(function (x) { return x.state === 'done'; });
      var side = it.key === 'paid' ? (rental ? 'provider' : 'requesting') : g[2];
      var roles = g[1];
      var note = /^0 /.test(it.detail || '') ? '' : it.detail || '';
      if (it.key === 'agreed' && draft) { roles = ['owner-finance', 'ic-finance']; side = 'provider'; note = 'The owner releases it first: ' + note; }
      var state = it.state === 'done' ? 'done' : it.state === 'na' ? 'na' : it.state === 'running' && later ? 'running' : 'open';
      if (it.key === 'charges' && it.state === 'na' && !started && live.length) { state = 'open'; note = 'From the day it is on hire, at each month end'; }
      var done = it.state === 'done' ? moneyDone(s, r, it.key) : null;
      return { key: 'm-' + it.key, money: true, label: it.label, short: g[3], bu: side === 'provider' ? provider : r.requestingBu, roles: roles, navId: g[0],
        state: state, failed: it.state === 'failed', running: it.state === 'running',
        at: done ? done.at : '', who: done ? done.who : '', what: WHAT[it.key] || it.label, note: note };
    });
  }

  /** The states settled: the first open step is the current one (unless held), the other open ones wait. */
  function settle(s, r, raw, hold) {
    var cur = -1;
    if (!hold) raw.some(function (st, i) { if (st.state === 'open') { cur = i; return true; } return false; });
    var both = function (b) { return b === r.requestingBu && r.lines.some(function (l) { return l.provider === b; }); };
    return raw.map(function (st, i) {
      var state = st.state === 'open' ? (i === cur ? 'current' : 'waiting') : st.state;
      var people = peopleFor(s, st.roles, st.bu, st.navId);
      var b = L.bu(s, st.bu);
      var tone = st.failed && state !== 'done' ? ['bad', state === 'current' ? 'Failed: now' : 'Failed'] : st.running && state === 'current' ? ['run', 'Now: running'] : FLOW_STATE[state];
      return Object.assign({}, st, {
        n: i + 1, state: state, current: i === cur, tone: tone[0], stateText: tone[1], approver: !!st.approver, failed: !!st.failed, running: !!st.running,
        buName: L.buName(s, st.bu), company: b ? L.leShort(s, b.le) : '', side: both(st.bu) ? 'Requesting and sourcing BU' : st.bu === r.requestingBu ? 'Requesting BU' : 'Sourcing BU',
        buText: L.buName(s, st.bu) + ' · ' + (b ? L.leShort(s, b.le) : ''),
        people: people, peopleText: people.length ? people.map(function (p) { return p.text; }).join('; ') : 'No one plays this in the demo (Admin can)',
        doneText: state === 'done' || state === 'refused' ? [st.at ? F.date(st.at) : '', st.who ? 'by ' + st.who : ''].filter(Boolean).join(' ') : '',
        // A step still running (charged at the month end) has nothing to press yet.
        go: i === cur && !st.running ? stepGo(s, st, people) : null
      });
    });
  }

  /** "Approver: Ana Costa (Equipment Manager, FleetCo Fleet), the owner of EX-1001." and what the requesting BU does. */
  function approverWords(s, r, lines) {
    var order = [];
    var serials = {};
    r.lines.forEach(function (l, i) {
      if (order.indexOf(l.provider) === -1) order.push(l.provider);
      (serials[l.provider] = serials[l.provider] || []).push(lines[i].serial);
    });
    var rental = r.type === 'CUSTOMER_RENTAL';
    var approvers = order.map(function (b) {
      var em = peopleFor(s, ['owner-em'], b, 'approvals')[0] || null;
      var who = em ? em.name + ' (' + em.role + ', ' + L.buName(s, b) + ')' : whose(L.buName(s, b)) + ' equipment manager (no one plays it in the demo; Admin can)';
      return { bu: b, buName: L.buName(s, b), company: L.leShort(s, L.leOf(s, b).id), id: em ? em.id : '', name: em ? em.name : '', role: em ? em.role : '', initials: em ? em.initials : '',
        short: who, serials: serials[b].join(', '), own: b === r.requestingBu && !rental,
        text: who + ', the owner of ' + serials[b].join(', ') + (b === r.requestingBu && !rental ? ' (its own fleet)' : '') };
    });
    var reqName = L.buName(s, r.requestingBu);
    var cur = L.le(s, r.requestingLe).currency;
    var est = U.sum(r.lines, function (x) { return x.estimate || 0; });
    var apLog = saidOn(s, r, /above the threshold$/);
    var reviewers = peopleFor(s, ['receiver-review'], r.requestingBu, '');
    var also = '';
    if (rental) {
      var ag = L.agreement(s, (r.lines[0] || {}).agreementId);
      var desk = peopleFor(s, ['desk'], (r.lines[0] || {}).provider, 'billing')[0];
      var dLog = saidOn(s, r, /^Received the deposit/);
      also = !(ag && ag.depositPct) ? 'A customer rental: only the owner approves, no deposit.'
        : r.deposit ? 'The rental desk took the deposit first (' + F.date(r.deposit.date) + (dLog ? ' by ' + dLog.who : '') + ').'
          : 'First ' + (desk ? desk.name + ' (' + roleWords(desk.title) + ')' : 'the rental desk') + ' takes the deposit; only then may the owner approve.';
    } else if (r.status === 'AWAITING_REQUESTER_APPROVAL') {
      also = reqName + ' approves first (receiver review: ' + (reviewers.map(function (p) { return p.name; }).join(' or ') || 'no one plays it in the demo') + '), as the estimate, ' + F.money(est, cur)
        + ', is above its threshold of ' + F.money(s.settings.requesterThreshold, cur) + ' (OD-12); then the owner.';
    } else if (apLog) {
      also = reqName + ' approved it first (' + F.date(apLog.at) + ' by ' + apLog.who + '), as the estimate was above its threshold (OD-12).';
    } else if (r.lines.every(function (l) { return l.provider === r.requestingBu; })) {
      also = reqName + ' is the owner too: no other approval (OD-12 ' + (s.settings.requesterApproval ? 'on, but not above the threshold' : 'off') + ').';
    } else {
      var reqWho = r.lines.some(function (l) { return l.providerLe === r.requestingLe; }) ? reqName : L.leShort(s, r.requestingLe);
      also = reqWho + ' does not approve: ' + (s.settings.requesterApproval ? 'the estimate, ' + F.money(est, cur) + ', is not above its threshold of ' + F.money(s.settings.requesterThreshold, cur) + ' (OD-12).'
        : 'only the owner approves (OD-12 off).');
    }
    return { approvers: approvers, text: (approvers.length > 1 ? 'Approvers: ' : 'Approver: ') + approvers.map(function (a) { return a.text; }).join('; ') + '.', also: also,
      short: approvers.map(function (a) { return a.short; }).join('; ') };
  }

  // ── The journey: the flow drawn as swimlanes (requesting side, sourcing side, money) ────────────────────────────
  // Per step: [node label, what the person does on the node, does (a sentence), do it (to the persona played), did].
  var WORDS = {
    raised: ['Raised', 'raises it', 'raises it', 'raise it', 'raised it'],
    requester: ['BU approves', 'approves', 'approves it for its BU', 'approve it for your BU', 'approved it for its BU'],
    deposit: ['Deposit', 'takes the deposit', 'takes the deposit', 'take the deposit', 'took the deposit'],
    approve: ['Owner approves', 'approves', 'approves and allocates', 'approve and allocate a unit', 'approved and allocated it'],
    ship: ['Shipped', 'ships', 'ships it', 'ship it', 'shipped it'],
    receive: ['On hire', 'receives', 'receives it: on hire', 'receive it: it goes on hire', 'received it'],
    hours: ['Hours', 'approves the hours', 'records and approves the hours', 'record and approve the hours', 'approved the hours'],
    offHire: ['Off hire', 'releases it', 'releases it: off hire', 'release it when the job is done', 'released it'],
    back: ['Back & inspected', 'inspects', 'collects and inspects it', 'collect and inspect it', 'inspected it'],
    'm-charges': ['Charge run', 'runs the charges', 'runs the month’s charges', 'run the month’s charges', 'ran the charges'],
    'm-agreed': ['Statement', 'agrees', 'agrees the statement', 'agree the statement', 'agreed the statement'],
    'm-ar': ['Invoice pair', 'invoices', 'creates the invoice pair', 'create the invoice pair', 'created the invoice pair'],
    'm-settled': ['Settled', 'settles', 'settles the invoice pair', 'settle the invoice pair', 'settled the invoice pair'],
    'm-internal': ['Posted to PPM', 'posts it', 'posts the cost to PPM', 'post the cost to PPM', 'posted the cost to PPM'],
    'm-bill': ['Customer billed', 'bills', 'bills the customer', 'bill the customer', 'billed the customer'],
    'm-invoiced': ['Customer invoice', 'invoices', 'invoices the customer', 'invoice the customer', 'invoiced the customer'],
    'm-paid': ['Paid', 'records it', 'records the customer’s payment', 'record the customer’s payment', 'recorded the customer’s payment'],
    'm-depositSettled': ['Deposit settled', 'settles it', 'settles the deposit', 'settle the deposit', 'settled the deposit'],
    'm-damage': ['Damage', 'charges it', 'charges the damage', 'charge the damage', 'charged the damage']
  };
  WORDS['m-ap'] = WORDS['m-cost'] = WORDS['m-accrual'] = WORDS['m-ar'];
  var RELEASE = ['Statement', 'releases', 'releases the statement', 'release the statement', 'released the statement'];
  // The money nodes: the invoice pair is one node (AR, AP, the cost on the project, the accruals reversed).
  var NODE_OF = { 'm-ar': 'm-pair', 'm-ap': 'm-pair', 'm-cost': 'm-pair', 'm-accrual': 'm-pair' };
  // The steps the requesting side does (for a customer rental, the rental desk for the customer); the rest are the owner's.
  var REQ_LANE = { raised: 1, requester: 1, deposit: 1, receive: 1, hours: 1, offHire: 1 };

  function wordsOf(st) { return st.key === 'm-agreed' && st.roles.indexOf('owner-finance') !== -1 ? RELEASE : WORDS[st.key] || [st.label, 'does it', 'does it', 'do it', 'did it']; }

  /**
   * The journey of one line (the one where the request is now): its steps as nodes in the lane of the side that does
   * them, then the money in a lane of its own from the day it is on hire. Each node: done (its date), current (the one
   * where the request is now carries the "Here now" flag and its person), waiting; connectors between steps, and a
   * hand-over where the next step is the other side's.
   */
  function journey(s, r, lines, money, next) {
    var rental = r.type === 'CUSTOMER_RENTAL';
    var focus = (next && !next.money ? lines.filter(function (l) { return l.serial === next.line; })[0] : null)
      || lines.filter(function (l) { return r.lines.some(function (x) { return x.id === l.id && x.status !== 'REJECTED'; }); })[0] || lines[0];
    var raw = r.lines.filter(function (x) { return x.id === focus.id; })[0];
    var isHere = function (st) { return !!next && st.key === next.key && st.line === next.line; };
    var node = function (st, i, lane, col, group) {
      var w = wordsOf(st);
      var list = group || [st];
      var here = list.some(isHere);
      var state = list.some(function (x) { return x.state === 'refused'; }) ? 'refused' : list.some(function (x) { return x.state === 'current'; }) ? 'current'
        : list.every(function (x) { return x.state === 'done'; }) ? 'done' : list.some(function (x) { return x.state === 'running'; }) ? 'running' : 'waiting';
      var failed = list.some(function (x) { return x.failed && x.state !== 'done'; });
      var dates = list.filter(function (x) { return x.state === 'done' && x.at; }).map(function (x) { return x.at; }).sort();
      var at = dates.length ? dates[dates.length - 1] : (st.state === 'refused' ? st.at : '');
      var hereStep = list.filter(isHere)[0] || st;
      var p = here && hereStep.people[0] ? hereStep.people[0] : null;
      return {
        key: (group ? NODE_OF[st.key] || st.key : st.key), label: w[0], lane: lane, col: col, state: failed ? 'failed' : state, here: here, n: i + 1,
        dateText: at ? F.short(at) : '', personInitials: p ? p.initials : '', personText: p ? p.name + ' · ' + wordsOf(hereStep)[1] : '',
        title: w[0] + ': ' + (FLOW_STATE[state] || ['', state])[1] + (at ? ' ' + F.date(at) : '') + (st.who && state === 'done' ? ' by ' + st.who : '') + ' · ' + st.buName,
        style: { gridColumn: String(col + 1), gridRow: String(lane) }
      };
    };
    var ops = focus.steps.filter(function (x) { return x.state !== 'na'; });
    var nodes = ops.map(function (st, i) { return node(st, i, REQ_LANE[st.key] ? 1 : 2, i + 1); });
    var links = [];
    nodes.forEach(function (n, i) {
      var prev = nodes[i - 1];
      n.inLine = !!prev;
      n.outLine = i < nodes.length - 1;
      n.inDone = !!prev && prev.state === 'done';
      n.outDone = n.state === 'done';
      n.cls = 'fx-jr-node fx-jr-node--' + n.state + (n.here ? ' fx-jr-node--here' : '') + (prev ? ' fx-jr-node--in' : '') + (n.outLine ? ' fx-jr-node--out' : '')
        + (n.inDone ? ' fx-jr-node--indone' : '') + (n.outDone ? ' fx-jr-node--outdone' : '');
      if (prev && prev.lane !== n.lane) {
        links.push({ key: 'x' + n.col, done: prev.state === 'done', up: n.lane < prev.lane, cls: 'fx-jr-link' + (prev.state === 'done' ? ' fx-jr-link--done' : ''),
          style: { gridColumn: String(n.col + 1), gridRow: '1 / span 2' }, title: 'Handed over to ' + (n.lane === 1 ? 'the requesting side' : 'the owner') });
      }
    });
    // Money: from the column where it went on hire, one node per step (the invoice pair as one).
    var start = 1;
    ops.forEach(function (st, i) { if (st.key === 'receive') start = i + 1; });
    var groups = [];
    money.filter(function (x) { return x.state !== 'na'; }).forEach(function (st) {
      var k = NODE_OF[st.key] || st.key;
      var g = groups.filter(function (x) { return x.key === k; })[0];
      if (g) g.steps.push(st); else groups.push({ key: k, steps: [st] });
    });
    var mnodes = groups.map(function (g, j) { return node(g.steps[0], j, 3, start + j, g.steps); });
    mnodes.forEach(function (n, j) {
      var prev = mnodes[j - 1];
      n.cls = 'fx-jr-node fx-jr-node--money fx-jr-node--' + n.state + (n.here ? ' fx-jr-node--here' : '') + (prev ? ' fx-jr-node--in' : '') + (j < mnodes.length - 1 ? ' fx-jr-node--out' : '')
        + (prev && prev.state === 'done' ? ' fx-jr-node--indone' : '') + (n.state === 'done' ? ' fx-jr-node--outdone' : '');
    });
    var cols = Math.max(nodes.length, start + mnodes.length - 1, 1);
    var cust = L.customer(s, r.customerId);
    var owners = unique(r.lines.map(function (l) { return L.buName(s, l.provider); }));
    var reqName = L.buName(s, r.requestingBu);
    var started = r.lines.some(function (l) { return l.events.onHire; });
    var lanes = [
      { key: 'req', name: rental ? (cust ? cust.name.split(' · ')[0] : 'The customer') : reqName, role: rental ? 'rents, through ' + whose(owners[0]) + ' rental desk' : 'requests and pays',
        cls: 'fx-jr-lane fx-jr-lane--req', nameCls: 'fx-jr-lanename fx-jr-lanename--req', style: { gridRow: '1' } },
      { key: 'src', name: owners.join(', '), role: owners.length > 1 ? 'own, approve, ship' : 'owns, approves, ships', cls: 'fx-jr-lane fx-jr-lane--src', nameCls: 'fx-jr-lanename fx-jr-lanename--src',
        style: { gridRow: '2' } },
      { key: 'money', name: 'Money', role: started ? 'from the day it is on hire' : 'starts when it is on hire', cls: 'fx-jr-lane fx-jr-lane--money', nameCls: 'fx-jr-lanename fx-jr-lanename--money', style: { gridRow: '3' } }
    ];
    // In words: where the request is now, who does it (or "It's your turn"), and what came just before.
    var seq = focus.steps.concat(money);
    var at = next ? seq.map(isHere).indexOf(true) : -1;
    var before = (at === -1 ? seq : seq.slice(0, at)).filter(function (x) { return x.state === 'done'; }).slice(-1)[0] || null;
    var sentence;
    if (next) {
      var p = next.people[0];
      var w = wordsOf(next);
      var it = next.navId ? nav.item(next.navId) : null;
      sentence = r.number + ' is with ' + next.buName + (next.go && next.go.mine ? '. It\'s your turn: ' + w[3] + (next.go.act ? ' here' : it ? ' in ' + it.label : '') + '.'
        : ': ' + (p ? p.name + ' (' + p.role + ')' : whose(next.buName) + ' ' + roleWords(next.roles[0])) + ' ' + w[2] + '.');
    } else if (raw && raw.status === 'REJECTED') {
      sentence = r.number + ' was refused by ' + L.buName(s, raw.provider) + (raw.reason ? ': ' + raw.reason : '') + '.';
    } else {
      sentence = r.number + ' is done: the equipment is back and every step of its money is complete.';
    }
    if (before) sentence += ' Before that: ' + (before.who || before.buName) + ' ' + wordsOf(before)[4] + (before.at ? ' on ' + F.date(before.at) : '') + '.';
    return {
      lanes: lanes, nodes: nodes, links: links, money: mnodes, all: nodes.concat(mnodes), cols: cols, line: focus.serial, lineText: lines.length > 1 ? 'Shown for ' + focus.title + ', where the request is now' : '',
      gridStyle: { gridTemplateColumns: 'var(--fx-jr-label) repeat(' + cols + ', minmax(var(--fx-jr-col), 1fr))' },
      sentence: sentence,
      dots: nodes.concat(mnodes).map(function (n, i) { return { key: n.key + '-' + i, cls: 'fx-jr-dot fx-jr-dot--' + n.state + (n.here ? ' fx-jr-dot--here' : '') + (i === nodes.length ? ' fx-jr-dot--money' : ''), title: n.title }; })
    };
  }

  /**
   * A request's approval and flow: per line its steps in order (raised, the requesting BU's approval, the deposit, the
   * owner's approval: the approver, shipped, received, hours, off hire, back and inspected), then the money steps; the
   * next step (operations first, then money: the earliest current step), and the approver in words.
   */
  function flow(s, id) {
    var r = L.request(s, id);
    if (!r) return null;
    var fin = V.finance(s, r.id);
    var lines = r.lines.map(function (l) {
      var u = L.unit(s, l.unitId || l.preferredUnit);
      var serial = u ? u.serial : l.cls;
      var steps = settle(s, r, lineSteps(s, r, l), false).map(function (x) { return Object.assign({}, x, { line: serial, labelFull: x.label + (r.lines.length > 1 ? ' · ' + serial : '') }); });
      return { id: l.id, serial: serial, title: u ? u.serial + ' · ' + u.name : ((U.byId(s.classes, l.cls) || {}).name || l.cls) + ' (unit to be chosen)',
        sub: 'Owner: ' + L.buName(s, l.provider) + ' · ' + L.leShort(s, l.providerLe) + ' · ' + relOf(l.relation).label, relChip: relOf(l.relation), steps: steps,
        current: steps.filter(function (x) { return x.current; })[0] || null };
    });
    var started = r.lines.some(function (l) { return l.events.onHire; });
    var money = settle(s, r, moneySteps(s, r, fin), !started).map(function (x) { return Object.assign({}, x, { line: '', labelFull: x.label }); });
    var opsNext = lines.map(function (l) { return l.current; }).filter(Boolean).sort(function (a, b) { return a.n - b.n; })[0] || null;
    var next = opsNext || money.filter(function (x) { return x.current; })[0] || null;
    var who = function (st) { return st.people[0] ? st.people[0].inWords : 'no one plays it for ' + st.buName + ' in the demo'; };
    var words = approverWords(s, r, lines);
    var all = [];
    lines.forEach(function (l) { all = all.concat(l.steps); });
    var counted = all.filter(function (x) { return x.state !== 'na'; });
    var refused = r.lines.length > 0 && r.lines.every(function (l) { return l.status === 'REJECTED'; });
    var sections = lines.map(function (l) { return { key: l.id, kind: 'line', title: l.title, sub: l.sub, relChip: l.relChip, steps: l.steps }; });
    var mCount = money.filter(function (x) { return x.state !== 'na'; });
    sections.push({ key: 'money', kind: 'money', title: 'Then the money', sub: started ? mCount.filter(function (x) { return x.state === 'done'; }).length + ' of ' + mCount.length + ' done; the Money tab has the details'
      : 'Starts when the equipment is on hire', relChip: null, steps: money });
    // In a list: the step's person and their company, or their BU when it is in the requesting BU's own company.
    var whereOf = function (st) { var b = L.bu(s, st.bu); return b && b.le !== r.requestingLe ? st.company : st.buName; };
    return {
      lines: lines, money: money, sections: sections, next: next, approvers: words.approvers, approverText: words.text, alsoText: words.also, approverShort: words.short,
      journey: journey(s, r, lines, money, next),
      nextText: next ? 'Next: ' + next.short + ' · ' + who(next) : '',
      nextListText: next ? 'Here now: ' + next.short + ' · ' + (next.people[0] ? next.people[0].name + ' (' + whereOf(next) + ')' : next.buName) : '',
      badge: next ? 'Next: ' + next.short + ' · ' + who(next) : fin.complete ? 'Financially complete' : refused ? 'Refused by the owner: nothing more to do' : 'Nothing left to do',
      done: counted.filter(function (x) { return x.state === 'done'; }).length, total: counted.length,
      countText: counted.filter(function (x) { return x.state === 'done'; }).length + ' of ' + counted.length
    };
  }

  /** Totals per company: what each company charged, invoiced, booked as cost, settled, for this request's charges only. */
  function companyTotals(s, r) {
    var cs = s.charges.filter(function (c) { return c.requestId === r.id; });
    var ids = cs.map(function (c) { return c.id; });
    var out = {};
    function row(leId, part) {
      var c = L.le(s, leId);
      out[leId] = out[leId] || { le: leId, company: c.short, name: c.name, currency: c.currency, parts: [], facts: [] };
      if (part && out[leId].parts.indexOf(part) === -1) out[leId].parts.push(part);
      return out[leId];
    }
    row(r.requestingLe, 'Requesting · ' + L.buName(s, r.requestingBu));
    r.lines.filter(function (l) { return l.status !== 'REJECTED'; }).forEach(function (l) { row(l.providerLe, 'Owner · ' + L.buName(s, l.provider)); });
    var byProv = {};
    cs.forEach(function (c) { (byProv[c.providerLe] = byProv[c.providerLe] || []).push(c); });
    Object.keys(byProv).forEach(function (k) {
      var list = byProv[k];
      var cur = list[0].currency;
      var x = row(k);
      x.facts.push({ label: 'Charged', value: F.money(U.sum(list, function (c) { return c.amount; }), cur), note: list.length + (list.length === 1 ? ' charge line' : ' charge lines') });
      var inv = list.filter(function (c) { return c.arNumber; });
      var ic = list.filter(function (c) { return c.relation.indexOf('IC_') === 0 || c.relation === 'CUSTOMER'; });
      if (ic.length) x.facts.push({ label: 'Invoiced (AR, net)', value: F.money(U.sum(inv, function (c) { return c.amount; }), cur), note: unique(inv.map(function (c) { return c.arNumber; })).join(', ') || 'not yet' });
      var posted = list.filter(function (c) { return c.status === 'POSTED'; });
      if (list.some(function (c) { return c.relation === 'SAME_LE' || c.relation === 'SAME_BU'; })) x.facts.push({ label: 'Posted to PPM (no invoice)', value: F.money(U.sum(posted, function (c) { return c.amount; }), cur), note: posted.length ? '' : 'not yet' });
    });
    // The user's AP invoice: the invoiced IC charges at the pair's rate, in the user's ledger currency.
    var apBy = {};
    cs.filter(function (c) { return c.apNumber && c.relation.indexOf('IC_') === 0; }).forEach(function (c) {
      var st = U.byId(s.statements, c.statementId);
      var k = c.receiverLe;
      apBy[k] = apBy[k] || { amount: 0, numbers: [] };
      apBy[k].amount = U.r2(apBy[k].amount + c.amount * ((st && st.pair && st.pair.rate) || 1));
      if (apBy[k].numbers.indexOf(c.apNumber) === -1) apBy[k].numbers.push(c.apNumber);
    });
    if (r.lines.some(function (l) { return l.relation.indexOf('IC_') === 0; })) {
      row(r.requestingLe).facts.push({ label: 'Invoiced to it (AP, net)', value: F.money((apBy[r.requestingLe] || {}).amount || 0, L.le(s, r.requestingLe).currency),
        note: apBy[r.requestingLe] ? apBy[r.requestingLe].numbers.join(', ') + ', coded to the project' : 'not yet' });
    }
    var costTx = s.tx.filter(function (t) { return ['PROJECT_COST', 'CROSS_CHARGE', 'OWN_COST'].indexOf(t.kind) !== -1 && (t.refs.chargeIds || []).some(function (x) { return ids.indexOf(x) !== -1; }); });
    var byLe = {};
    costTx.forEach(function (t) {
      (t.items || []).forEach(function (i) { if (ids.indexOf(i.chargeId) !== -1) byLe[t.le] = U.r2((byLe[t.le] || 0) + i.amount); });
    });
    Object.keys(byLe).forEach(function (k) {
      var prj = L.project(s, r.projectId);
      row(k).facts.push({ label: 'Cost on the project', value: F.money(byLe[k], L.le(s, k).currency), note: (prj ? prj.number : '') + ' in PPM' });
    });
    var sts = unique(cs.map(function (c) { return c.statementId; })).map(function (id) { return U.byId(s.statements, id); }).filter(Boolean);
    sts.forEach(function (st) {
      var txt = st.pair && st.pair.settled ? 'Settled ' + F.date(st.pair.settled.at) + (st.pair.settled.wht ? ', withholding ' + F.num(st.pair.settled.wht) : '') + (st.pair.settled.fxDiff ? ', exchange difference ' + F.num(st.pair.settled.fxDiff) + ' ' + L.le(s, st.receiverLe).currency : '') : 'Not settled yet';
      [st.providerLe, st.receiverLe].forEach(function (k) { if (out[k]) out[k].facts.push({ label: st.number, value: txt, note: '' }); });
    });
    if (r.type === 'CUSTOMER_RENTAL' || r.type === 'CUSTOMER_PROJECT') {
      var cust = L.customer(s, r.customerId);
      var arTx = s.tx.filter(function (t) { return t.kind === 'CUSTOMER_AR' && (t.refs.chargeIds || []).some(function (x) { return ids.indexOf(x) !== -1; }); });
      var bills = s.tx.filter(function (t) { return t.kind === 'PROJECT_BILL' && costTx.some(function (c) { return c.billed === t.number; }); });
      var inv2 = arTx.concat(bills);
      if (cust) {
        var key = 'CUST:' + cust.id;
        out[key] = { le: key, company: cust.name, name: 'Customer of ' + L.leShort(s, cust.of), currency: '', parts: ['Customer'], facts: [] };
        out[key].facts.push({ label: 'Invoiced (gross)', value: inv2.length ? inv2.map(function (t) { return F.money(t.entered ? t.entered.amount : t.total, t.currency); }).join(', ') : 'Not yet', note: inv2.map(function (t) { return t.number; }).join(', ') });
        out[key].facts.push({ label: 'Paid', value: inv2.length && inv2.every(function (t) { return !(t.open > 0); }) ? 'Paid' : (inv2.length ? 'Open ' + inv2.map(function (t) { return F.money(t.open, t.currency); }).join(', ') : '—'), note: '' });
        if (r.deposit) out[key].facts.push({ label: 'Deposit', value: F.money(r.deposit.amount, L.le(s, r.lines[0].providerLe).currency), note: r.deposit.settled ? 'applied ' + F.num(r.deposit.settled.applied) + ', refunded ' + F.num(r.deposit.settled.refunded) : 'held' });
      }
    }
    var order = s.companies.map(function (c) { return c.id; });
    return Object.keys(out).sort(function (a, b) { var ia = order.indexOf(a); var ib = order.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); }).map(function (k) {
      var x = out[k];
      x.partText = x.parts.join('; ');
      if (!x.facts.length) x.facts.push({ label: 'Nothing yet', value: '', note: 'no charges for this request so far' });
      return x;
    });
  }

  /** The accounting shown: per company, this request's transactions only (a transaction for other requests alone is left out). */
  function accounting(s, r, acc) {
    var cs = s.charges.filter(function (c) { return c.requestId === r.id; });
    var ids = cs.map(function (c) { return c.id; });
    var order = s.companies.map(function (c) { return c.id; });
    return acc.slice().sort(function (a, b) { return order.indexOf(a.le) - order.indexOf(b.le); }).map(function (a) {
      var txs = a.txs.filter(function (t) {
        var raw = U.byId(s.tx, t.id);
        var cids = (raw && raw.refs.chargeIds) || [];
        return !cids.length || cids.some(function (x) { return ids.indexOf(x) !== -1; });
      }).map(function (t) {
        var raw = U.byId(s.tx, t.id);
        var cids = raw.refs.chargeIds || [];
        var mine = cids.filter(function (x) { return ids.indexOf(x) !== -1; });
        var shared = '';
        if (cids.length && mine.length < cids.length) {
          var others = unique(cids.filter(function (x) { return ids.indexOf(x) === -1; }).map(function (x) { return (U.byId(s.charges, x) || {}).requestNumber; }));
          var part = U.sum(mine.map(function (x) { return U.byId(s.charges, x); }), function (c) { return c.amount; });
          shared = 'Covers other requests too (' + others.join(', ') + '): this request\'s part is ' + F.money(part, (U.byId(s.charges, mine[0]) || {}).currency) + ' net';
        } else if (!cids.length && raw.refs.statementId) {
          var st = U.byId(s.statements, raw.refs.statementId);
          var reqs = unique(s.charges.filter(function (c) { return c.statementId === raw.refs.statementId; }).map(function (c) { return c.requestNumber; }));
          if (reqs.length > 1) shared = 'Covers the whole statement ' + (st ? st.number : '') + ', with other requests too (' + reqs.filter(function (x) { return x !== r.number; }).join(', ') + ')';
        }
        var dr = U.sum(raw.lines, function (l) { return l.dr; });
        var cr = U.sum(raw.lines, function (l) { return l.cr; });
        return Object.assign({}, t, {
          sharedText: shared, shared: !!shared, statusText: { CREATED: 'Created', SETTLED: 'Settled' }[t.status] || t.status,
          enteredText: raw.entered ? 'Entered ' + F.money(raw.entered.amount, raw.entered.currency) + (raw.entered.currency !== raw.currency ? ' · rate ' + (Math.round((raw.rate || 1) * 10000) / 10000) + ' · booked in ' + raw.currency : ' · booked in ' + raw.currency)
            : (raw.rate && raw.rate !== 1 ? 'Rate ' + (Math.round(raw.rate * 10000) / 10000) + ' · booked in ' + raw.currency : 'In ' + raw.currency),
          drTotal: t.lines.length ? F.num(dr) : '', crTotal: t.lines.length ? F.num(cr) : '', balanced: U.r2(dr - cr) === 0,
          itemsText: (t.items || []).map(function (i) { return i.expType + (i.task ? ' · ' + i.task : '') + ': ' + i.amount; }).join('; ')
        });
      });
      var c = L.le(s, a.le);
      return { le: a.le, company: a.company, name: c.name, currency: a.currency, countryName: countryName(s, a.country), txs: txs, count: txs.length,
        countText: txs.length + (txs.length === 1 ? ' transaction' : ' transactions') };
    }).filter(function (a) { return a.txs.length; });
  }

  /** A request's tab: fxViews.request(id) for the persona played, with the line details, money, accounting and history in words. */
  function request(s, id) {
    var v = V.request(s, id);
    if (!v) return { ready: true, error: '', missing: true, hidden: false };
    if (v.hidden) return { ready: true, error: '', missing: false, hidden: true, me: V.me(s) };
    var r = L.request(s, id);
    var p = E.persona(s);
    var lines = r.lines.map(function (l, i) { return lineDetail(s, r, l, v.lineRows[i]); });
    var fin = v.finance;
    var items = financeItems(s, r, fin);
    var cur = L.le(s, r.requestingLe).currency;
    var acc = accounting(s, r, v.accounting);
    var charges = v.chargeRows.map(function (c) {
      return Object.assign({}, c, { qtyText: c.qty + ' ' + c.uom, arText: c.arNumber ? 'AR ' + c.arNumber : '', apText: c.apNumber ? 'AP ' + c.apNumber : '', invoiceText: c.arNumber ? 'AR ' + c.arNumber + (c.apNumber ? ' · AP ' + c.apNumber : '') : (c.status === 'POSTED' ? 'No invoice (PPM)' : '—'),
        projectText: c.project ? c.project + (c.task ? ' · ' + c.task : '') : (c.receiver || ''), periodLine: c.periodText + (c.from ? ' · ' + c.from + '–' + c.to : ''),
        statusTone: { CALCULATED: 'todo', IN_STATEMENT: 'run', DISPUTED: 'bad', ACCEPTED: 'ok', INVOICED: 'ok', POSTED: 'ok' }[c.status] || 'na' });
    });
    var byCur = {};
    charges.forEach(function (c) { byCur[c.currency] = U.r2((byCur[c.currency] || 0) + c.amount); });
    var prj = L.project(s, r.projectId);
    var cust = L.customer(s, r.customerId);
    var openLines = lines.filter(function (l) { return l.next; });
    var head = rowOf(s, v);
    var fl = flow(s, r.id);
    return Object.assign({}, v, {
      ready: true, error: '', missing: false, me: V.me(s), stageTone: stageTone(v.stage),
      ownersText: head.ownersText, relChips: head.relChips, relText: head.relText, moneyNext: head.moneyNext,
      finWordsShort: fin.complete ? 'Financially complete' : head.moneyNext,
      party: r.type === 'CUSTOMER_RENTAL' ? (cust ? cust.name : '') : (prj ? prj.number + ' · ' + prj.name : ''),
      partyLabel: r.type === 'CUSTOMER_RENTAL' ? 'Customer' : 'Project', customerText: r.type === 'CUSTOMER_PROJECT' && cust ? 'for ' + cust.name : '',
      taskText: r.task || '', siteText: r.site + ' · ' + countryName(s, r.country), datesText: F.date(r.from) + ' to ' + F.date(r.to),
      buText: v.buName + ' · ' + L.le(s, r.requestingLe).name, raisedText: 'Raised by ' + r.createdBy + ' on ' + F.date(r.createdAt),
      // The head's badge names the request's real next step (the flow's: operations first, then money).
      flow: fl, defaultTab: r.lines.some(function (l) { return !l.events.onHire; }) ? 'flow' : 'equipment',
      finBadge: fl.badge, finTone: fin.complete ? 'ok' : 'todo', finProgress: fin.done + ' of ' + fin.total + ' done',
      finPct: fin.total ? Math.round(fin.done / fin.total * 100) : 0,
      lines: lines, lineCount: lines.length, openLines: openLines.length,
      items: items, charges: charges, chargeTotals: Object.keys(byCur).map(function (k) { return F.money(byCur[k], k); }).join(' · '),
      companies: companyTotals(s, r), acc: acc, accCount: U.sum(acc, function (a) { return a.count; }),
      history: v.timeline, requesterCurrency: cur,
      approveText: v.needsMyApproval ? 'Approve: ' + v.buName + ' agrees to this request above its threshold of ' + F.money(s.settings.requesterThreshold, cur)
        + ' (OD-12); then each owner sees its lines in Approve & allocate. EquipRite records it; nothing goes to Fusion.' : '',
      awaitingText: r.status === 'AWAITING_REQUESTER_APPROVAL' && !v.needsMyApproval ? 'Waiting for ' + v.buName + '\'s approval (above its threshold): its receiver review approves it here.' : '',
      depositText: r.deposit ? 'Deposit ' + F.money(r.deposit.amount, L.le(s, r.lines[0].providerLe).currency) + ' received ' + F.date(r.deposit.date) + (r.deposit.settled ? '; settled ' + F.date(r.deposit.settled.at) : '') : '',
      canNew: L.can(p, 'requester') || L.can(p, 'desk')
    });
  }

  // ── Exports (exportKit columns) ─────────────────────────────────────────────────────────────────────────────
  function col(key, label, type) { return { key: key, label: label, type: type || 'text' }; }
  var COLUMNS = {
    requests: [col('number', 'Request'), col('typeText', 'Type'), col('party', 'Project or customer'), col('buName', 'Requesting BU'), col('company', 'Company'),
      col('ownersText', 'Owners'), col('relText', 'Relationships'), col('words', 'Stage'), col('flowNext', 'Here now'), col('finDone', 'Money steps done', 'number'), col('finTotal', 'Money steps', 'number'),
      col('moneyNext', 'Money'), col('costSoFar', 'Cost so far'), col('equipment', 'Equipment'), col('site', 'Site'), col('countryName', 'Country'), col('fromText', 'From'), col('toText', 'To')],
    equipment: [col('serial', 'Unit'), col('unitName', 'Name'), col('providerName', 'Owner BU'), col('providerShort', 'Owner company'), col('relationLabel', 'Relationship'),
      col('agreementText', 'Agreement'), col('priceText', 'Price'), col('words', 'Status'), col('eventsText', 'Events'), col('hoursText', 'Hours'), col('customsText', 'Customs'),
      col('inspectionText', 'Inspection'), col('damageText', 'Damage'), col('lossText', 'Loss')],
    money: [col('periodText', 'Period'), col('kindText', 'Kind'), col('text', 'What'), col('serial', 'Unit'), col('project', 'Project'), col('task', 'Task'), col('qty', 'Quantity', 'number'),
      col('uom', 'Unit of measure'), col('amount', 'Amount', 'number'), col('currency', 'Currency'), col('statusText', 'Status'), col('arNumber', 'AR invoice'), col('apNumber', 'AP invoice'), col('id', 'Charge id')],
    accounting: [col('company', 'Company'), col('number', 'Transaction'), col('kindText', 'Kind'), col('date', 'Date'), col('account', 'Account'), col('name', 'Account name'),
      col('dr', 'Debit', 'number'), col('cr', 'Credit', 'number'), col('currency', 'Currency'), col('memo', 'Memo'), col('source', 'Made by (Fusion)')],
    history: [col('at', 'When'), col('who', 'Who'), col('title', 'Role'), col('what', 'What happened')],
    flow: [col('section', 'Line or money'), col('n', 'Step', 'number'), col('label', 'What'), col('what', 'What happens'), col('side', 'Side'), col('buText', 'Business unit'),
      col('peopleText', 'Who can do it'), col('stateText', 'State'), col('doneText', 'Done'), col('note', 'Note')],
    options: [col('serial', 'Unit'), col('name', 'Name'), col('ownerName', 'Owner BU'), col('ownerShort', 'Owner company'), col('relLabel', 'Relationship'), col('holdText', 'Asset or stock'),
      col('where', 'Where it is'), col('countryName', 'Country'), col('lead', 'Lead time'), col('price', 'Price'), col('estimateText', 'Estimate'), col('estimateNote', 'Estimate note'),
      col('why', 'Why not usable'), col('certText', 'Certificate')]
  };
  /** What an export takes for a list of these screens (kind: requests, flow, equipment, money, accounting, history, options). */
  function exportOf(kind, v) {
    var x = v || {};
    var rows;
    if (kind === 'requests') rows = x.rows || [];
    else if (kind === 'equipment') rows = x.lines || [];
    else if (kind === 'money') rows = x.charges || [];
    else if (kind === 'history') rows = x.history || [];
    else if (kind === 'flow') {
      rows = [];
      ((x.flow && x.flow.sections) || []).forEach(function (sec) { sec.steps.forEach(function (st) { rows.push(Object.assign({ section: sec.title }, st)); }); });
    }
    else if (kind === 'options') rows = x.cards || [];
    else if (kind === 'accounting') {
      rows = [];
      (x.acc || []).forEach(function (a) {
        a.txs.forEach(function (t) {
          (t.lines.length ? t.lines : [{ account: '', name: t.note || 'No accounting of its own', dr: '', cr: '', memo: '' }]).forEach(function (l) {
            rows.push({ company: a.company, number: t.number, kindText: t.kindText, date: t.date, account: l.account, name: l.name, dr: l.dr ? Number(String(l.dr).replace(/,/g, '').replace('−', '-')) : '',
              cr: l.cr ? Number(String(l.cr).replace(/,/g, '').replace('−', '-')) : '', currency: t.currency, memo: l.memo, source: t.source });
          });
        });
      });
    } else rows = [];
    var names = { requests: 'requests', flow: 'approval-and-flow', equipment: 'equipment', money: 'charges', accounting: 'accounting', history: 'history', options: 'equipment-options' };
    var titles = { requests: 'My requests', flow: 'Approval & flow', equipment: 'Equipment', money: 'Charges', accounting: 'Accounting (shown)', history: 'History', options: 'Equipment for the request' };
    var subtitle = kind === 'requests' ? [x.scope, x.chip && x.chip !== 'all' ? (CHIPS.filter(function (c) { return c[0] === x.chip; })[0] || [])[1] : '', x.text ? '"' + x.text + '"' : ''].filter(Boolean).join(' · ')
      : kind === 'options' ? [x.title, x.shownText, x.clsName, x.daysText].filter(Boolean).join(' · ') : [x.number, x.party].filter(Boolean).join(' · ');
    return { name: (kind === 'requests' || kind === 'options' ? '' : (x.number || '') + '-') + names[kind], title: (kind === 'requests' || kind === 'options' ? '' : (x.number || '') + ' · ') + titles[kind],
      subtitle: subtitle, rows: rows, columns: COLUMNS[kind] || [] };
  }

  return { list: list, form: form, change: change, payload: payload, request: request, flow: flow, exportOf: exportOf, requesterBus: requesterBus, forOptions: forOptions, sourceBus: sourceBus,
    certWords: certWords, doer: doer, COLUMNS: COLUMNS, CHIPS: CHIPS };
});
