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
   *   request(s, id)               a request's tab: head, equipment, money (the finance checklist), accounting, history
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
    var nextItem = fin.items.filter(function (i) { return i.state !== 'done' && i.state !== 'na'; })[0];
    var nextText = fin.complete ? 'Financially complete' : nextItem ? 'Next: ' + nextItem.label.replace(/ \([^)]*\)$/, '') + ' · ' + nextItem.who : fin.words;
    return Object.assign({}, row, {
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
    return Object.assign({}, v, {
      ready: true, error: '', missing: false, me: V.me(s), stageTone: stageTone(v.stage),
      ownersText: head.ownersText, relChips: head.relChips, relText: head.relText, moneyNext: head.moneyNext,
      finWordsShort: fin.complete ? 'Financially complete' : head.moneyNext,
      party: r.type === 'CUSTOMER_RENTAL' ? (cust ? cust.name : '') : (prj ? prj.number + ' · ' + prj.name : ''),
      partyLabel: r.type === 'CUSTOMER_RENTAL' ? 'Customer' : 'Project', customerText: r.type === 'CUSTOMER_PROJECT' && cust ? 'for ' + cust.name : '',
      taskText: r.task || '', siteText: r.site + ' · ' + countryName(s, r.country), datesText: F.date(r.from) + ' to ' + F.date(r.to),
      buText: v.buName + ' · ' + L.le(s, r.requestingLe).name, raisedText: 'Raised by ' + r.createdBy + ' on ' + F.date(r.createdAt),
      finBadge: fin.complete ? 'Financially complete' : head.moneyNext, finTone: fin.complete ? 'ok' : 'todo', finProgress: fin.done + ' of ' + fin.total + ' done',
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
      col('ownersText', 'Owners'), col('relText', 'Relationships'), col('words', 'Stage'), col('finDone', 'Money steps done', 'number'), col('finTotal', 'Money steps', 'number'),
      col('moneyNext', 'Money'), col('costSoFar', 'Cost so far'), col('equipment', 'Equipment'), col('site', 'Site'), col('countryName', 'Country'), col('fromText', 'From'), col('toText', 'To')],
    equipment: [col('serial', 'Unit'), col('unitName', 'Name'), col('providerName', 'Owner BU'), col('providerShort', 'Owner company'), col('relationLabel', 'Relationship'),
      col('agreementText', 'Agreement'), col('priceText', 'Price'), col('words', 'Status'), col('eventsText', 'Events'), col('hoursText', 'Hours'), col('customsText', 'Customs'),
      col('inspectionText', 'Inspection'), col('damageText', 'Damage'), col('lossText', 'Loss')],
    money: [col('periodText', 'Period'), col('kindText', 'Kind'), col('text', 'What'), col('serial', 'Unit'), col('project', 'Project'), col('task', 'Task'), col('qty', 'Quantity', 'number'),
      col('uom', 'Unit of measure'), col('amount', 'Amount', 'number'), col('currency', 'Currency'), col('statusText', 'Status'), col('arNumber', 'AR invoice'), col('apNumber', 'AP invoice'), col('id', 'Charge id')],
    accounting: [col('company', 'Company'), col('number', 'Transaction'), col('kindText', 'Kind'), col('date', 'Date'), col('account', 'Account'), col('name', 'Account name'),
      col('dr', 'Debit', 'number'), col('cr', 'Credit', 'number'), col('currency', 'Currency'), col('memo', 'Memo'), col('source', 'Made by (Fusion)')],
    history: [col('at', 'When'), col('who', 'Who'), col('title', 'Role'), col('what', 'What happened')],
    options: [col('serial', 'Unit'), col('name', 'Name'), col('ownerName', 'Owner BU'), col('ownerShort', 'Owner company'), col('relLabel', 'Relationship'), col('holdText', 'Asset or stock'),
      col('where', 'Where it is'), col('countryName', 'Country'), col('lead', 'Lead time'), col('price', 'Price'), col('estimateText', 'Estimate'), col('estimateNote', 'Estimate note'),
      col('why', 'Why not usable'), col('certText', 'Certificate')]
  };
  /** What an export takes for a list of these screens (kind: requests, equipment, money, accounting, history, options). */
  function exportOf(kind, v) {
    var x = v || {};
    var rows;
    if (kind === 'requests') rows = x.rows || [];
    else if (kind === 'equipment') rows = x.lines || [];
    else if (kind === 'money') rows = x.charges || [];
    else if (kind === 'history') rows = x.history || [];
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
    var names = { requests: 'requests', equipment: 'equipment', money: 'charges', accounting: 'accounting', history: 'history', options: 'equipment-options' };
    var titles = { requests: 'My requests', equipment: 'Equipment', money: 'Charges', accounting: 'Accounting (shown)', history: 'History', options: 'Equipment for the request' };
    var subtitle = kind === 'requests' ? [x.scope, x.chip && x.chip !== 'all' ? (CHIPS.filter(function (c) { return c[0] === x.chip; })[0] || [])[1] : '', x.text ? '"' + x.text + '"' : ''].filter(Boolean).join(' · ')
      : kind === 'options' ? [x.title, x.shownText, x.clsName, x.daysText].filter(Boolean).join(' · ') : [x.number, x.party].filter(Boolean).join(' · ');
    return { name: (kind === 'requests' || kind === 'options' ? '' : (x.number || '') + '-') + names[kind], title: (kind === 'requests' || kind === 'options' ? '' : (x.number || '') + ' · ') + titles[kind],
      subtitle: subtitle, rows: rows, columns: COLUMNS[kind] || [] };
  }

  return { list: list, form: form, change: change, payload: payload, request: request, exportOf: exportOf, requesterBus: requesterBus, forOptions: forOptions, sourceBus: sourceBus,
    certWords: certWords, doer: doer, COLUMNS: COLUMNS, CHIPS: CHIPS };
});
