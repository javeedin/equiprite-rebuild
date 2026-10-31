define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine'], function (Seed, E) {
  'use strict';

  /**
   * EquipRite Future: what each screen shows, computed from the state for the person being played (MC-BR-12:
   * requests by the requesting BU, approvals by the sourcing BU, finance by legal entity). Pure functions.
   */
  var U = E.util;
  var L = E.lookups;
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function date(s) { if (!s) return ''; var p = String(s).split('-'); return (+p[2]) + ' ' + MON[+p[1] - 1] + ' ' + p[0]; }
  function short(s) { if (!s) return ''; var p = String(s).split('-'); return (+p[2]) + ' ' + MON[+p[1] - 1]; }
  function period(p) { return MON[+p.slice(5, 7) - 1] + ' ' + p.slice(0, 4); }
  function num(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    var neg = v < 0;
    var t = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '−' : '') + t;
  }
  function money(n, cur) { return (cur ? cur + ' ' : '') + num(n); }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }

  var REL = {
    SAME_BU: { label: 'Own fleet', tone: 'neutral', words: 'Own equipment: cost straight to the project, no invoice' },
    SAME_LE: { label: 'Same company · cross-charge', tone: 'info', words: 'Two BUs of one legal entity: PPM cross-charge, no invoices, no tax' },
    IC_DOMESTIC: { label: 'Intercompany · domestic', tone: 'ic', words: 'Two legal entities, one country: invoice pair, domestic VAT' },
    IC_CROSS_BORDER: { label: 'Intercompany · cross-border', tone: 'xb', words: 'Two countries: invoice pair, reverse charge, withholding, exchange rate, customs' },
    CUSTOMER: { label: 'Customer rental', tone: 'cust', words: 'The owner rents to its own customer: AR invoice, no intercompany' }
  };
  var TYPE = { INTERNAL: 'Internal project', CUSTOMER_PROJECT: 'Customer project', CUSTOMER_RENTAL: 'Customer rental' };
  var LINE = {
    REQUESTED: { stage: 'requested', words: 'Waiting for the owner to approve' },
    APPROVED: { stage: 'approved', words: 'Approved, to ship' },
    SHIPPED: { stage: 'shipped', words: 'On the way' },
    ON_HIRE: { stage: 'onhire', words: 'On hire' },
    OFF_HIRED: { stage: 'offhire', words: 'Off hire, waiting for collection' },
    RETURNED: { stage: 'returned', words: 'Back at the yard, to inspect' },
    CLOSED: { stage: 'closed', words: 'Returned and inspected' },
    REJECTED: { stage: 'rejected', words: 'Refused by the owner' },
    LOST: { stage: 'lost', words: 'Lost: charged at the agreed value' },
    TRANSFERRED: { stage: 'closed', words: 'Handed over to another company on site' }
  };
  var ST = {
    DRAFT: 'Draft: owner to check and release', RELEASED: 'Released: waiting for the user', DISPUTED: 'In dispute', PARTLY_AGREED: 'Agreed, some lines held',
    AGREED: 'Agreed: create the invoice pair', FAILED: 'Invoice pair failed: retry', PARTLY_INVOICED: 'Invoiced in part', INVOICED: 'Invoiced: settle', SETTLED: 'Settled'
  };
  var TXK = {
    TO_SHIP: 'Transfer order shipped', TO_RECEIPT: 'Transfer order received', TO_RETURN: 'Return transfer order', ASSET_CUSTODY: 'Asset location', IC_AR: 'Intercompany AR invoice',
    IC_AP: 'Intercompany AP invoice', PROJECT_COST: 'Project cost (PPM)', ACCRUAL: 'Accrual', ACCRUAL_REVERSAL: 'Accrual reversal', CROSS_CHARGE: 'Cross-charge (PPM)', OWN_COST: 'Own equipment cost (PPM)',
    CUSTOMER_AR: 'Customer invoice', PROJECT_BILL: 'Project invoice (PPM billing)', CUSTOMER_RECEIPT: 'Customer receipt', DEPOSIT: 'Deposit', DEPOSIT_SETTLE: 'Deposit settled', NETTING: 'Settlement / netting',
    ASSET_RETIRE: 'Asset retired', STOCK_ISSUE: 'Stock issued (lost)'
  };

  function me(s) {
    var p = E.persona(s);
    return { id: p.id, name: p.name, initials: p.initials, title: p.title, roles: p.roles, bus: p.bus, busText: p.bus.map(function (b) { return L.buName(s, b); }).join(', '),
      today: s.today, todayText: date(s.today), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][U.dow(s.today)], monthEnd: U.monthEnd(U.monthOf(s.today)) === s.today };
  }
  function personas(s) {
    return Seed.PERSONAS.map(function (p) { return { id: p.id, name: p.name, initials: p.initials, title: p.title, on: p.id === s.personaId, busText: p.bus.map(function (b) { return L.buName(s, b); }).join(', ') }; });
  }
  function can(s, role) { return L.can(E.persona(s), role); }
  function mine(s, buId) { return L.inBu(E.persona(s), buId); }

  // ── Requests ───────────────────────────────────────────────────────────────────────────────────────────────────
  function lineView(s, r, l) {
    var u = L.unit(s, l.unitId || l.preferredUnit);
    var lw = LINE[l.status] || { stage: 'requested', words: l.status };
    var hrs = s.hours.filter(function (h) { return h.lineId === l.id; });
    var seg = l.segments.length ? l.segments[l.segments.length - 1] : null;
    return {
      id: l.id, requestId: r.id, cls: l.cls, clsName: (U.byId(s.classes, l.cls) || {}).name || l.cls, unitId: l.unitId || '', serial: u ? u.serial : '', unitName: u ? u.name : '',
      chosen: !!l.unitId, hold: l.hold, holdText: l.hold === 'STOCK' ? 'Stock (inventory item)' : 'Asset (fixed asset)', provider: l.provider, providerName: L.buName(s, l.provider),
      providerShort: L.leShort(s, l.providerLe), relation: l.relation, relationLabel: (REL[l.relation] || {}).label || l.relation, relationTone: (REL[l.relation] || {}).tone || '', relationWords: (REL[l.relation] || {}).words || '',
      agreement: l.agreementId ? (L.agreement(s, l.agreementId) || {}).number : 'none (own equipment)', price: l.price ? money(l.price.week, l.price.currency) + '/week · ' + money(l.price.day, '') + '/day' : '',
      status: l.status, stage: lw.stage, words: lw.words + (l.status === 'ON_HIRE' && l.events.onHire ? ' since ' + short(l.events.onHire) : '') + (l.reason ? ': ' + l.reason : ''),
      events: l.events, eventsText: ['requested', 'approved', 'shipped', 'onHire', 'offHire', 'returned'].filter(function (k) { return l.events[k]; })
        .map(function (k) { return { requested: 'Requested', approved: 'Approved', shipped: 'Shipped', onHire: 'On hire', offHire: 'Off hire', returned: 'Back' }[k] + ' ' + short(l.events[k]); }).join(' · '),
      hoursDays: hrs.length, hoursWaiting: hrs.filter(function (h) { return !h.approved; }).length, usage: U.sum(hrs, function (h) { return h.usage; }), standby: U.sum(hrs, function (h) { return h.standby; }),
      breakdowns: s.breakdowns.filter(function (b) { return b.lineId === l.id; }).length, project: seg ? (L.project(s, seg.projectId) || {}).number : '', moves: l.segments.length > 1 ? l.segments.length - 1 : 0,
      inspection: l.inspection, damage: l.inspection && l.inspection.damage ? money(l.inspection.damage, l.price && l.price.currency) : '', loss: l.loss ? money(l.loss.value, L.leOf(s, l.provider).currency) : '',
      customs: l.customsId ? U.byId(s.customs, l.customsId) : null, inPlace: !!l.inPlace, toNumber: l.toNumber || ''
    };
  }
  function requestStage(r) {
    var st = r.lines.map(function (l) { return l.status; });
    if (r.status === 'AWAITING_REQUESTER_APPROVAL') return { stage: 'requested', words: 'Waiting for the requesting BU\'s approval' };
    var order = ['REQUESTED', 'APPROVED', 'SHIPPED', 'ON_HIRE', 'OFF_HIRED', 'RETURNED'];
    for (var i = 0; i < order.length; i++) if (st.indexOf(order[i]) !== -1) {
      var n = st.filter(function (x) { return x === order[i]; }).length;
      return { stage: LINE[order[i]].stage, words: LINE[order[i]].words + (r.lines.length > 1 ? ' (' + n + ' of ' + r.lines.length + ')' : '') };
    }
    if (st.every(function (x) { return x === 'REJECTED'; })) return { stage: 'rejected', words: 'Refused' };
    return { stage: 'closed', words: 'Equipment back' };
  }
  function requestRow(s, r) {
    var prj = L.project(s, r.projectId);
    var cust = L.customer(s, r.customerId);
    var fin = finance(s, r.id);
    var st = requestStage(r);
    return {
      id: r.id, number: r.number, type: r.type, typeText: TYPE[r.type], bu: r.requestingBu, buName: L.buName(s, r.requestingBu), company: L.leShort(s, r.requestingLe),
      project: prj ? prj.number + ' · ' + prj.name : '', customer: cust ? cust.name : '', site: r.site, country: r.country, from: r.from, to: r.to, dates: short(r.from) + ' – ' + date(r.to),
      stage: st.stage, words: st.words, lines: r.lines.length, owners: unique(r.lines.map(function (l) { return L.leShort(s, l.providerLe); })).join(', '),
      relations: unique(r.lines.map(function (l) { return (REL[l.relation] || {}).label; })).join(', '), finDone: fin.done, finTotal: fin.total, finComplete: fin.complete, finWords: fin.words,
      cost: fin.costText, search: [r.number, prj && prj.number, prj && prj.name, cust && cust.name, r.site, L.buName(s, r.requestingBu)].concat(r.lines.map(function (l) { var u = L.unit(s, l.unitId || l.preferredUnit); return u ? u.serial + ' ' + u.name : ''; })).join(' ').toLowerCase()
    };
  }
  function unique(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }

  /** My requests: the requests of the BUs I request for (MC-FR-08); finance and admins see all of theirs. */
  function requests(s, f) {
    var p = E.persona(s);
    var o = f || {};
    var rows = s.requests.filter(function (r) { return L.inBu(p, r.requestingBu); }).map(function (r) { return requestRow(s, r); });
    var q = String(o.text || '').toLowerCase().trim();
    var list = rows.filter(function (r) { return (!o.stage || o.stage === 'all' || (o.stage === 'open' ? r.stage !== 'closed' && r.stage !== 'rejected' : o.stage === 'unfinished' ? !r.finComplete : r.stage === o.stage)) && (!q || r.search.indexOf(q) !== -1); });
    list.sort(function (a, b) { return b.number.localeCompare(a.number); });
    return { rows: list, count: list.length, all: rows.length, scope: 'Requests of ' + p.bus.map(function (b) { return L.buName(s, b); }).join(', '),
      chips: [['all', 'All'], ['open', 'Open'], ['unfinished', 'Money not complete']].map(function (c) { return { key: c[0], label: c[1], on: (o.stage || 'all') === c[0] }; }) };
  }

  function request(s, id) {
    var r = L.request(s, id);
    if (!r) return null;
    var p = E.persona(s);
    var visible = L.inBu(p, r.requestingBu) || r.lines.some(function (l) { return L.inBu(p, l.provider); });
    if (!visible) return { hidden: true };
    var row = requestRow(s, r);
    var lines = r.lines.map(function (l) { return lineView(s, r, l); });
    var charges = s.charges.filter(function (c) { return c.requestId === r.id; }).map(function (c) { return chargeRow(s, c); });
    return Object.assign(row, {
      hidden: false, lineRows: lines, chargeRows: charges, finance: finance(s, r.id), accounting: requestAccounting(s, r.id),
      timeline: s.log.filter(function (x) { return x.refs && x.refs.requestId === r.id; }).map(function (x) { return { at: date(x.at), who: x.who, title: x.whoTitle, what: x.what }; }),
      createdBy: r.createdBy, createdAt: date(r.createdAt), note: r.note, deposit: r.deposit, requestingLe: L.leShort(s, r.requestingLe), status: r.status,
      iAmUser: L.inBu(p, r.requestingBu), iAmOwner: r.lines.some(function (l) { return L.inBu(p, l.provider); }), needsMyApproval: r.status === 'AWAITING_REQUESTER_APPROVAL' && L.inBu(p, r.requestingBu) && L.can(p, 'receiver-review')
    });
  }

  function chargeRow(s, c) {
    var prj = L.project(s, c.projectId);
    return {
      id: c.id, period: c.period, periodText: period(c.period), kind: c.kind, kindText: { RENTAL: 'Rental', STANDBY: 'Standby', TRANSPORT: 'Transport', BREAKDOWN_CREDIT: 'Breakdown credit', MIN_HIRE: 'Minimum hire',
        DAMAGE: 'Damage', LOSS: 'Loss', CREDIT: 'Credit', ADJUSTMENT: 'Adjustment' }[c.kind] || c.kind, text: c.text, serial: c.serial, requestId: c.requestId, requestNumber: c.requestNumber,
      project: prj ? prj.number : '', task: c.task || '', qty: c.qty, uom: c.uom, amount: c.amount, amountText: money(c.amount, c.currency), currency: c.currency, status: c.status,
      statusText: { CALCULATED: 'Calculated', IN_STATEMENT: 'On a statement', DISPUTED: 'Disputed', ACCEPTED: 'Agreed', INVOICED: 'Invoiced', POSTED: 'Posted to PPM' }[c.status] || c.status,
      needsAcceptance: !!c.needsAcceptance && c.status === 'IN_STATEMENT', dispute: c.dispute ? c.dispute.reason : '', arNumber: c.arNumber || '', apNumber: c.apNumber || '',
      relation: c.relation, relationLabel: (REL[c.relation] || {}).label || '', statementId: c.statementId || '', from: c.from ? short(c.from) : '', to: c.to ? short(c.to) : '',
      provider: L.leShort(s, c.providerLe), receiver: c.customerId ? (L.customer(s, c.customerId) || {}).name : L.leShort(s, c.receiverLe), agreementVersion: c.agreementVersion
    };
  }

  /**
   * Is this request financially complete? Every financial transaction it should produce, and whether it is done
   * (EquipRite creates the transactions; Fusion makes the accounting, shown read-only).
   */
  function finance(s, id) {
    var r = L.request(s, id);
    var items = [];
    function add(key, label, who, state, detail) { items.push({ key: key, label: label, who: who, state: state, detail: detail || '', stateText: { done: 'Done', pending: 'To do', failed: 'Failed', na: 'Not needed', running: 'Running' }[state] }); }
    var lines = r.lines.filter(function (l) { return l.status !== 'REJECTED'; });
    var cs = s.charges.filter(function (c) { return c.requestId === r.id; });
    var opDone = lines.every(function (l) { return ['CLOSED', 'LOST', 'TRANSFERRED'].indexOf(l.status) !== -1; });
    add('ops', 'Equipment back and inspected (or handed over / lost)', 'Owner\'s yard', !lines.length ? 'na' : opDone ? 'done' : (lines.some(function (l) { return l.events.onHire; }) ? 'running' : 'pending'),
      lines.map(function (l) { return (L.unit(s, l.unitId || l.preferredUnit) || {}).serial + ': ' + (LINE[l.status] || {}).words; }).join('; '));
    // Every closed month on hire is charged.
    var missing = [];
    var stale = [];
    var openMonth = false;
    lines.forEach(function (l) {
      if (!l.events.onHire) return;
      var end = l.events.returned || l.events.offHire || s.today;
      if (l.inspection && l.inspection.date > end) end = l.inspection.date;
      for (var pm = U.monthOf(l.events.onHire); pm <= U.monthOf(end); pm = U.nextMonth(pm)) {
        var expected = E.lineCharges(s, r, l, pm);
        if (U.monthEnd(pm) > s.today) { if (expected.length) openMonth = true; continue; }
        var have = cs.filter(function (c) { return c.lineId === l.id && c.period === pm && c.kind !== 'CREDIT'; });
        if (!have.length) { if (expected.length) missing.push(period(pm)); continue; }
        if (Math.abs(U.sum(expected, function (c) { return c.amount; }) - U.sum(have, function (c) { return c.amount; })) > 0.005) stale.push(period(pm));
      }
    });
    var hiring = lines.some(function (l) { return l.events.onHire && !l.events.offHire; });
    add('charges', 'Charges calculated for every month on hire', 'IC finance (charge run)', !lines.some(function (l) { return l.events.onHire; }) ? 'na' : missing.length || stale.length ? 'pending' : hiring || openMonth ? 'running' : 'done',
      missing.length ? 'Not yet run: ' + unique(missing).join(', ') : stale.length ? 'Changed since it was charged (off hire, return, damage): run ' + unique(stale).join(', ') + ' again'
        : openMonth ? 'This month is charged at its month end (' + date(U.monthEnd(U.monthOf(s.today))) + ')' : (cs.length ? plural(cs.length, 'charge line') + ' so far' : 'Still on hire this month'));
    var rels = unique(lines.map(function (l) { return l.relation; }));
    var unf = function (list, f) { return list.length && list.every(f); };
    if (rels.some(function (x) { return x.indexOf('IC_') === 0; })) {
      var ic = cs.filter(function (c) { return c.relation.indexOf('IC_') === 0; });
      var sts = unique(ic.map(function (c) { return c.statementId; })).map(function (sid) { return U.byId(s.statements, sid); }).filter(Boolean);
      add('agreed', 'Intercompany statement agreed by ' + L.leShort(s, r.requestingLe), 'User\'s review', !ic.length ? 'pending' : unf(ic, function (c) { return ['ACCEPTED', 'INVOICED'].indexOf(c.status) !== -1; }) ? 'done' : ic.some(function (c) { return c.status === 'DISPUTED'; }) ? 'failed' : 'pending',
        sts.map(function (x) { return x.number + ': ' + ST[x.status]; }).join('; ') || 'No statement yet');
      var failed = sts.some(function (x) { return x.status === 'FAILED'; });
      add('ar', 'Intercompany AR invoice in the owner (' + unique(lines.filter(function (l) { return l.relation.indexOf('IC_') === 0; }).map(function (l) { return L.leShort(s, l.providerLe); })).join(', ') + ')', 'IC finance (workbench)',
        failed ? 'failed' : unf(ic, function (c) { return !!c.arNumber; }) ? 'done' : 'pending', unique(ic.map(function (c) { return c.arNumber; })).join(', '));
      add('ap', 'Intercompany AP invoice in ' + L.leShort(s, r.requestingLe) + ', coded to the project', 'IC finance (workbench)', failed ? 'failed' : unf(ic, function (c) { return !!c.apNumber; }) ? 'done' : 'pending', unique(ic.map(function (c) { return c.apNumber; })).join(', '));
      var pc = s.tx.filter(function (t) { return t.kind === 'PROJECT_COST' && (t.refs.chargeIds || []).some(function (x) { return ic.some(function (c) { return c.id === x; }); }); });
      add('cost', 'Cost on the project in PPM', 'PPM (from Payables)', unf(ic, function (c) { return pc.some(function (t) { return t.refs.chargeIds.indexOf(c.id) !== -1; }); }) ? 'done' : 'pending',
        pc.length ? money(U.sum(pc, function (t) { return t.amount; }), L.le(s, r.requestingLe).currency) + ' on ' + unique(pc.map(function (t) { return (L.project(s, t.refs.projectId) || {}).number; })).join(', ') : '');
      var acc = sts.filter(function (x) { return x.accrued; });
      if (acc.length) add('accrual', 'Accruals reversed after invoicing', 'Fusion GL', acc.every(function (x) { return x.accrued.reversed; }) ? 'done' : 'pending', acc.map(function (x) { return x.number; }).join(', '));
      add('settled', 'Settled (netting or payment)', 'Treasury', sts.length && sts.every(function (x) { return x.pair && x.pair.settled; }) && unf(ic, function (c) { return !!c.arNumber; }) ? 'done' : 'pending',
        sts.filter(function (x) { return x.pair && x.pair.settled; }).map(function (x) { return x.pair.number + ' ' + date(x.pair.settled.at) + (x.pair.settled.wht ? ', withholding ' + num(x.pair.settled.wht) : '') + (x.pair.settled.fxDiff ? ', FX ' + num(x.pair.settled.fxDiff) : ''); }).join('; '));
    }
    if (rels.indexOf('SAME_LE') !== -1 || rels.indexOf('SAME_BU') !== -1) {
      var inn = cs.filter(function (c) { return c.relation === 'SAME_LE' || c.relation === 'SAME_BU'; });
      add('internal', rels.indexOf('SAME_LE') !== -1 ? 'Cross-charge posted to PPM (no invoice, no tax)' : 'Own equipment cost posted to PPM', 'Finance', unf(inn, function (c) { return c.status === 'POSTED'; }) ? 'done' : 'pending', plural(inn.length, 'line'));
    }
    if (r.type === 'CUSTOMER_PROJECT') {
      var prj = L.project(s, r.projectId);
      var costTx = s.tx.filter(function (t) { return (t.kind === 'PROJECT_COST' || t.kind === 'CROSS_CHARGE' || t.kind === 'OWN_COST') && (t.refs.chargeIds || []).some(function (x) { return cs.some(function (c) { return c.id === x; }); }); });
      var billed = costTx.length && costTx.every(function (t) { return !!t.billed; });
      var bills = s.tx.filter(function (t) { return (t.kind === 'PROJECT_BILL' || t.kind === 'CUSTOMER_AR') && costTx.some(function (c) { return c.billed === t.number; }); });
      add('bill', 'Customer billed by ' + L.leShort(s, r.requestingLe) + (s.settings.s2Billing === 'PPM' ? ' (project contract, PPM)' : ' (EquipRite invoice, OD-07 b)'), L.leShort(s, r.requestingLe) + ' finance', billed ? 'done' : 'pending', bills.map(function (t) { return t.number; }).join(', ') || (prj ? 'Customer: ' + (L.customer(s, prj.customer) || {}).name : ''));
      add('paid', 'Customer paid', 'Customer', bills.length && bills.every(function (t) { return !(t.open > 0); }) && billed ? 'done' : 'pending', '');
    }
    if (r.type === 'CUSTOMER_RENTAL') {
      var ag = L.agreement(s, (r.lines[0] || {}).agreementId);
      if (ag && ag.depositPct) add('deposit', 'Deposit received', 'Rental desk', r.deposit ? 'done' : 'pending', r.deposit ? money(r.deposit.amount, ag.currency) : '');
      var cust = cs.filter(function (c) { return c.relation === 'CUSTOMER'; });
      add('invoiced', 'Customer invoiced (Fusion Receivables)', 'Rental desk', unf(cust, function (c) { return c.status === 'INVOICED'; }) ? 'done' : 'pending', unique(cust.map(function (c) { return c.arNumber; })).join(', '));
      var inv = s.tx.filter(function (t) { return t.kind === 'CUSTOMER_AR' && cust.some(function (c) { return c.arNumber === t.number; }); });
      add('paid', 'Customer paid', 'Customer', inv.length && inv.every(function (t) { return !(t.open > 0); }) && unf(cust, function (c) { return c.status === 'INVOICED'; }) ? 'done' : 'pending', '');
      if (ag && ag.depositPct) add('depositSettled', 'Deposit applied or refunded', 'Rental desk', r.deposit && r.deposit.settled ? 'done' : 'pending', r.deposit && r.deposit.settled ? 'applied ' + num(r.deposit.settled.applied) + ', refunded ' + num(r.deposit.settled.refunded) : '');
    }
    var dmg = lines.filter(function (l) { return (l.inspection && l.inspection.damage > 0) || l.loss; });
    if (dmg.length) add('damage', 'Damage or loss charged', 'Owner', dmg.every(function (l) { return cs.some(function (c) { return c.lineId === l.id && (c.kind === 'DAMAGE' || c.kind === 'LOSS') && ['ACCEPTED', 'INVOICED', 'POSTED'].indexOf(c.status) !== -1; }); }) ? 'done' : 'pending', '');
    var counted = items.filter(function (i) { return i.state !== 'na'; });
    var done = counted.filter(function (i) { return i.state === 'done'; }).length;
    var nextItem = counted.filter(function (i) { return i.state !== 'done'; })[0];
    var costRx = s.tx.filter(function (t) { return ['PROJECT_COST', 'CROSS_CHARGE', 'OWN_COST'].indexOf(t.kind) !== -1 && (t.refs.chargeIds || []).some(function (x) { return cs.some(function (c) { return c.id === x; }); }); });
    var curr = L.le(s, r.requestingLe).currency;
    return {
      items: items, total: counted.length, done: done, complete: counted.length > 0 && done === counted.length,
      words: counted.length && done === counted.length ? 'Financially complete' : nextItem ? 'Next: ' + nextItem.label + ' (' + nextItem.who + ')' : 'Nothing yet',
      cost: U.sum(costRx, function (t) { return t.amount; }), costText: costRx.length ? money(U.sum(costRx, function (t) { return t.amount; }), curr) : '',
      charged: U.sum(cs, function (c) { return c.amount; }), chargedText: cs.length ? money(U.sum(cs, function (c) { return c.amount; }), (cs[0] || {}).currency) : ''
    };
  }

  /** The accounting each company's Fusion makes for this request's transactions: shown, never created by EquipRite. */
  function requestAccounting(s, id) {
    var r = L.request(s, id);
    var chargeIds = s.charges.filter(function (c) { return c.requestId === r.id; }).map(function (c) { return c.id; });
    var stIds = unique(s.charges.filter(function (c) { return c.requestId === r.id && c.statementId; }).map(function (c) { return c.statementId; }));
    var costTx = s.tx.filter(function (t) { return ['PROJECT_COST', 'CROSS_CHARGE', 'OWN_COST'].indexOf(t.kind) !== -1 && (t.refs.chargeIds || []).some(function (x) { return chargeIds.indexOf(x) !== -1; }); });
    var billNos = unique(costTx.map(function (t) { return t.billed; }));
    var txs = s.tx.filter(function (t) {
      var rf = t.refs || {};
      return rf.requestId === r.id || (rf.chargeIds || []).some(function (x) { return chargeIds.indexOf(x) !== -1; })
        || (rf.statementId && stIds.indexOf(rf.statementId) !== -1 && !(rf.chargeIds || []).length)
        || billNos.indexOf(t.number) !== -1 || (rf.invoiceTx && s.tx.some(function (q) { return q.id === rf.invoiceTx && billNos.indexOf(q.number) !== -1; }));
    });
    var byLe = {};
    txs.forEach(function (t) { (byLe[t.le] = byLe[t.le] || []).push(txView(s, t, chargeIds)); });
    return Object.keys(byLe).map(function (k) { var c = L.le(s, k); return { le: k, company: c.short, currency: c.currency, country: c.country, txs: byLe[k] }; });
  }
  function txView(s, t, chargeIds) {
    var shared = (t.refs.chargeIds || []).length && chargeIds && (t.refs.chargeIds || []).some(function (x) { return chargeIds.indexOf(x) === -1; });
    return {
      id: t.id, number: t.number, kind: t.kind, kindText: TXK[t.kind] || t.kind, title: t.title, date: date(t.date), currency: t.currency, source: t.source, status: t.status,
      lines: t.lines.map(function (l) { return { account: l.account, name: l.name, dr: l.dr ? num(l.dr) : '', cr: l.cr ? num(l.cr) : '', memo: l.memo }; }),
      total: t.total ? money(t.total, t.currency) : (t.amount ? money(t.amount, t.currency) : ''), noAccounting: !t.lines.length, note: t.note || (t.lines.length ? '' : 'No accounting of its own.'),
      entered: t.entered && t.entered.currency !== t.currency ? money(t.entered.amount, t.entered.currency) + ' at ' + (Math.round((t.rate || 1) * 10000) / 10000) : '',
      shared: !!shared, sharedText: shared ? 'Covers other requests of the same statement too' : '', open: t.open, items: (t.items || []).map(function (i) { return { expType: i.expType, task: i.task, amount: num(i.amount), date: i.date }; })
    };
  }

  // ── Work queues ────────────────────────────────────────────────────────────────────────────────────────────────
  function allLines(s, f) {
    var out = [];
    s.requests.forEach(function (r) { r.lines.forEach(function (l) { if (f(r, l)) out.push(Object.assign(lineView(s, r, l), { number: r.number, buName: L.buName(s, r.requestingBu), company: L.leShort(s, r.requestingLe), site: r.site, country: r.country, dates: short(r.from) + ' – ' + date(r.to), from: r.from, to: r.to, typeText: TYPE[r.type] })); }); });
    return out;
  }

  /** Approve & allocate: the lines that use MY fleet (the sourcing BU decides, MC-FR-13/14). */
  function approvals(s) {
    var p = E.persona(s);
    var rows = allLines(s, function (r, l) { return l.status === 'REQUESTED' && r.status !== 'AWAITING_REQUESTER_APPROVAL' && L.inBu(p, l.provider); }).map(function (x) {
      var r = L.request(s, x.requestId);
      var opts = E.sourcing(s, { requestingBu: r.requestingBu, cls: x.cls, from: r.from, to: r.to, country: r.country, customerId: r.type === 'CUSTOMER_RENTAL' ? r.customerId : '' })
        .filter(function (o) { return o.owner === x.provider; });
      var l = L.line(s, r.id, x.id);
      return Object.assign(x, { options: opts.map(function (o) { return { unitId: o.unitId, serial: o.serial, name: o.name, hold: o.hold, usable: o.usable, preferred: o.unitId === l.preferredUnit,
        why: o.why }; }),
        needsDeposit: r.type === 'CUSTOMER_RENTAL' && !r.deposit && !!(L.agreement(s, l.agreementId) || {}).depositPct, requester: r.createdBy });
    });
    return { rows: rows, count: rows.length, scope: 'Lines that use the fleet of ' + p.bus.map(function (b) { return L.buName(s, b); }).join(', ') };
  }
  function yard(s) {
    var p = E.persona(s);
    var mineL = function (r, l) { return L.inBu(p, l.provider) && l.relation !== 'SAME_BU' ? true : L.inBu(p, l.provider); };
    var toShip = allLines(s, function (r, l) { return mineL(r, l) && l.status === 'APPROVED' && !l.inPlace; });
    var toCollect = allLines(s, function (r, l) { return mineL(r, l) && l.status === 'OFF_HIRED'; });
    var toInspect = allLines(s, function (r, l) { return mineL(r, l) && l.status === 'RETURNED'; });
    var out = allLines(s, function (r, l) { return mineL(r, l) && ['SHIPPED', 'ON_HIRE'].indexOf(l.status) !== -1; });
    var fleet = s.units.filter(function (u) { return L.inBu(p, u.owner); }).map(function (u) { return unitRow(s, u); });
    return { toShip: toShip, toCollect: toCollect, toInspect: toInspect, out: out, fleet: fleet, repairs: fleet.filter(function (u) { return u.status === 'IN_REPAIR'; }),
      counts: { ship: toShip.length, collect: toCollect.length, inspect: toInspect.length, out: out.length } };
  }
  function unitRow(s, u) {
    var c = L.country(s, u.country);
    var cust = s.customs.filter(function (x) { return x.unitId === u.id && x.status !== 'CLOSED'; })[0];
    return { id: u.id, serial: u.serial, name: u.name, cls: u.cls, hold: u.hold, holdText: u.hold === 'STOCK' ? 'Stock' : 'Asset', owner: L.buName(s, u.owner), ownerShort: L.leOf(s, u.owner).short,
      status: u.status, statusText: { AVAILABLE: 'In the yard', OUT: 'Out', INSPECTION: 'To inspect', IN_REPAIR: 'In repair', LOST: 'Lost' }[u.status] || u.status,
      where: u.custody.label || (U.byId(s.orgs, u.custody.org) || {}).name || '', country: c ? c.name : u.country, countryCode: u.country,
      value: u.hold === 'ASSET' ? money(u.asset.cost - u.asset.accDep, L.leOf(s, u.owner).currency) + ' NBV' : money(u.stock.bookValue, L.leOf(s, u.owner).currency) + ' book',
      ref: u.hold === 'ASSET' ? u.asset.number : u.stock.item, certs: u.certs.map(function (x) { return x.country + ' ' + x.type + ' to ' + short(x.expiry) + (x.expiry < s.today ? ' (expired)' : ''); }).join('; '),
      customs: cust ? cust.permit + ' until ' + date(cust.reexportBy) : '' };
  }
  function site(s) {
    var p = E.persona(s);
    var mineR = function (r) { return L.inBu(p, r.requestingBu) || (r.type === 'CUSTOMER_RENTAL' && r.lines.some(function (l) { return L.inBu(p, l.provider); }) && L.can(p, 'desk')); };
    var toReceive = allLines(s, function (r, l) { return mineR(r) && (l.status === 'SHIPPED' || (l.status === 'APPROVED' && l.inPlace)); });
    var onHire = allLines(s, function (r, l) { return mineR(r) && l.status === 'ON_HIRE'; });
    var projects = s.projects.filter(function (x) { return L.inBu(p, x.bu); }).map(function (x) { return { id: x.id, label: x.number + ' · ' + x.name, bu: x.bu }; });
    var others = s.projects.filter(function (x) { return !L.inBu(p, x.bu); }).map(function (x) { return { id: x.id, label: x.number + ' · ' + x.name + ' (' + L.leOf(s, x.bu).short + ')', bu: x.bu, country: x.country }; });
    return { toReceive: toReceive, onHire: onHire, projects: projects, otherCompanies: others, counts: { receive: toReceive.length, onHire: onHire.length, hoursWaiting: U.sum(onHire, function (l) { return l.hoursWaiting; }) } };
  }
  function hours(s, lineId) {
    return s.hours.filter(function (h) { return h.lineId === lineId; }).sort(function (a, b) { return a.date.localeCompare(b.date); })
      .map(function (h) { return { date: h.date, dateText: short(h.date), usage: h.usage, standby: h.standby, approved: h.approved, weekend: h.weekend }; });
  }

  // ── Charges, statements, workbench ─────────────────────────────────────────────────────────────────────────────
  function stRow(s, st) {
    var cs = s.charges.filter(function (c) { return c.statementId === st.id; });
    var pr = L.le(s, st.providerLe);
    var rc = L.le(s, st.receiverLe);
    var p = E.persona(s);
    return {
      id: st.id, number: st.number, period: st.period, periodText: period(st.period), provider: pr.short, receiver: rc.short, providerBu: L.buName(s, st.provider), receiverBu: L.buName(s, st.receiver),
      relation: st.relation, relationLabel: (REL[st.relation] || {}).label, currency: st.currency, status: st.status, statusText: ST[st.status] || st.status,
      total: U.sum(cs, function (c) { return c.amount; }), totalText: money(U.sum(cs, function (c) { return c.amount; }), st.currency), lines: cs.length,
      disputed: cs.filter(function (c) { return c.status === 'DISPUTED'; }).length, held: cs.filter(function (c) { return c.needsAcceptance && c.status === 'IN_STATEMENT'; }).length,
      dueBy: st.dueBy ? date(st.dueBy) : '', accrued: !!st.accrued, accruedText: st.accrued ? 'Accrued ' + num(st.accrued.amount) + (st.accrued.reversed ? ', reversed' : '') : '',
      pair: st.pair, pairNumber: st.pair && st.pair.number || '', pairError: st.pair && st.pair.status === 'FAILED' ? st.pair.error : '', settled: !!(st.pair && st.pair.settled),
      charges: cs.map(function (c) { return chargeRow(s, c); }), requests: unique(cs.map(function (c) { return c.requestNumber; })).join(', '),
      iOwn: L.inBu(p, st.provider), iUse: L.inBu(p, st.receiver), disputes: st.disputes,
      canRelease: st.status === 'DRAFT' && L.inBu(p, st.provider) && (L.can(p, 'owner-finance') || L.can(p, 'ic-finance')),
      canReview: ['RELEASED', 'PARTLY_AGREED', 'DISPUTED'].indexOf(st.status) !== -1 && L.inBu(p, st.receiver) && L.can(p, 'receiver-review')
        && cs.some(function (c) { return c.status === 'IN_STATEMENT' || (c.needsAcceptance && c.status !== 'ACCEPTED' && c.status !== 'INVOICED'); }),
      canPair: ['AGREED', 'PARTLY_AGREED', 'FAILED'].indexOf(st.status) !== -1 && L.can(p, 'ic-finance') && cs.some(function (c) { return c.status === 'ACCEPTED' && !c.arNumber; }),
      canSettle: ['INVOICED', 'PARTLY_INVOICED'].indexOf(st.status) !== -1 && st.pair && !st.pair.settled && L.can(p, 'ic-finance'),
      canAccrue: !st.accrued && !(st.pair && st.pair.status === 'CREATED') && L.can(p, 'ic-finance')
    };
  }
  function charges(s, f) {
    var p = E.persona(s);
    var o = f || {};
    var periods = unique(s.charges.map(function (c) { return c.period; }).concat([U.monthOf(U.addDays(U.monthStart(U.monthOf(s.today)), -1)), U.monthOf(s.today)])).sort().reverse();
    var sts = s.statements.filter(function (st) { return L.inBu(p, st.provider) || L.inBu(p, st.receiver); }).filter(function (st) { return !o.period || st.period === o.period; }).map(function (st) { return stRow(s, st); });
    sts.sort(function (a, b) { return b.number.localeCompare(a.number); });
    var waiting = s.charges.filter(function (c) { return c.status === 'CALCULATED' && (L.inBu(p, c.provider) || L.inBu(p, c.receiver)); }).map(function (c) { return chargeRow(s, c); });
    var runPeriod = U.monthEnd(U.monthOf(s.today)) === s.today ? U.monthOf(s.today) : U.monthOf(U.addDays(U.monthStart(U.monthOf(s.today)), -1));
    return { statements: sts, waiting: waiting, waitingCustomer: waiting.filter(function (c) { return c.relation === 'CUSTOMER'; }), waitingInternal: waiting.filter(function (c) { return c.relation === 'SAME_LE' || c.relation === 'SAME_BU'; }),
      periods: periods.map(function (x) { return { key: x, label: period(x) }; }), runPeriod: runPeriod, runPeriodText: period(runPeriod), canRun: L.can(p, 'ic-finance') || L.can(p, 'owner-finance'),
      runReady: s.today >= U.monthEnd(runPeriod), counts: { release: sts.filter(function (x) { return x.canRelease; }).length, review: sts.filter(function (x) { return x.canReview; }).length, disputes: U.sum(sts, function (x) { return x.disputed; }) } };
  }
  function workbench(s) {
    var p = E.persona(s);
    var all = s.statements.filter(function (st) { return L.inBu(p, st.provider) || L.inBu(p, st.receiver); }).map(function (st) { return stRow(s, st); });
    var recon = all.filter(function (x) { return x.pair && x.pair.status === 'CREATED'; }).map(function (x) {
      var st = U.byId(s.statements, x.id);
      var ar = U.byId(s.tx, st.pair.arTx);
      var ap = U.byId(s.tx, st.pair.apTx);
      var invoiced = U.sum(s.charges.filter(function (c) { return c.statementId === st.id && c.arNumber; }), function (c) { return c.amount; });
      var arNet = U.r2(ar.entered.amount - st.pair.vat);
      var apNet = U.r2(ap.entered.amount - st.pair.vat);
      return { number: x.number, pair: st.pair.number, charges: money(invoiced, st.currency), ar: money(arNet, st.currency), ap: money(apNet, st.currency) + (ap.currency !== st.currency ? ' (booked ' + money(U.byId(ap.lines.map(function (l) { return Object.assign({ id: l.account }, l); }), '2110').cr, ap.currency) + ')' : ''),
        booked: (function () { var bk = U.byId(ap.lines.map(function (l) { return Object.assign({ id: l.account }, l); }), '2110').cr; var exp = U.r2(U.r2(ar.entered.amount) * st.pair.rate); return { amount: bk, expected: exp, ok: Math.abs(bk - exp) < 0.05 + 0.01 * ap.lines.length }; })(),
        diff: U.r2(Math.abs(invoiced - arNet) + Math.abs(arNet - apNet)), ok: U.r2(invoiced - arNet) === 0 && U.r2(arNet - apNet) === 0 };
    });
    var internal = s.charges.filter(function (c) { return (c.relation === 'SAME_LE' || c.relation === 'SAME_BU') && c.status === 'CALCULATED'; }).map(function (c) { return chargeRow(s, c); });
    return {
      toCreate: all.filter(function (x) { return x.canPair || (x.status === 'FAILED'); }), toSettle: all.filter(function (x) { return x.canSettle; }), waitingUser: all.filter(function (x) { return ['DRAFT', 'RELEASED', 'DISPUTED', 'PARTLY_AGREED'].indexOf(x.status) !== -1; }),
      done: all.filter(function (x) { return x.settled; }), accrued: all.filter(function (x) { return x.accrued; }), recon: recon, reconOk: recon.every(function (x) { return x.ok; }), internal: internal,
      txs: s.tx.filter(function (t) { return ['IC_AR', 'IC_AP', 'PROJECT_COST', 'NETTING', 'ACCRUAL', 'ACCRUAL_REVERSAL', 'CROSS_CHARGE', 'OWN_COST'].indexOf(t.kind) !== -1; }).slice().reverse().map(function (t) { return Object.assign(txView(s, t), { company: L.le(s, t.le).short }); }),
      canAct: L.can(p, 'ic-finance'), simulateFailure: s.settings.simulateFailure
    };
  }
  function billing(s) {
    var p = E.persona(s);
    var invoices = s.tx.filter(function (t) { return (t.kind === 'CUSTOMER_AR' || t.kind === 'PROJECT_BILL') && L.inBu(p, (s.bus.filter(function (b) { return b.le === t.le; }).map(function (b) { return b.id; }).filter(function (b) { return L.inBu(p, b); })[0]) || '__'); })
      .map(function (t) { return Object.assign(txView(s, t), { company: L.le(s, t.le).short, customer: (L.customer(s, t.refs.customerId) || {}).name, openText: t.open > 0 ? money(t.open, t.currency) : 'Paid', paid: !(t.open > 0), margin: t.margin != null ? money(t.margin, t.currency) : '' }); });
    var waiting = s.charges.filter(function (c) { return c.relation === 'CUSTOMER' && c.status === 'CALCULATED' && L.inBu(p, c.provider); }).map(function (c) { return chargeRow(s, c); });
    var projects = s.projects.filter(function (x) { return x.type === 'contract' && L.inBu(p, x.bu); }).map(function (x) {
      var costs = s.tx.filter(function (t) { return ['PROJECT_COST', 'CROSS_CHARGE', 'OWN_COST'].indexOf(t.kind) !== -1 && t.refs.projectId === x.id && t.billable; });
      var open = costs.filter(function (t) { return !t.billed; });
      var cur = L.leOf(s, x.bu).currency;
      return { id: x.id, number: x.number, name: x.name, customer: (L.customer(s, x.customer) || {}).name, markup: Math.round(x.markupPct * 100) + ' %', cost: money(U.sum(costs, function (t) { return t.amount; }), cur),
        toBill: U.sum(open, function (t) { return t.amount; }), toBillText: money(U.sum(open, function (t) { return t.amount; }) * (1 + x.markupPct), cur), canBill: open.length > 0 };
    });
    var deposits = s.requests.filter(function (r) { return r.type === 'CUSTOMER_RENTAL' && r.lines.some(function (l) { return L.inBu(p, l.provider); }); }).map(function (r) {
      var ag = L.agreement(s, r.lines[0].agreementId) || {};
      return { id: r.id, number: r.number, customer: (L.customer(s, r.customerId) || {}).name, deposit: r.deposit ? money(r.deposit.amount, ag.currency) : '', needed: !!ag.depositPct && !r.deposit,
        settled: r.deposit && r.deposit.settled ? 'Applied ' + num(r.deposit.settled.applied) + ', refunded ' + num(r.deposit.settled.refunded) : '', canSettle: !!r.deposit && !r.deposit.settled && r.lines.every(function (l) { return ['CLOSED', 'LOST', 'REJECTED'].indexOf(l.status) !== -1; }) };
    });
    return { invoices: invoices.reverse(), waiting: waiting, projects: projects, deposits: deposits, s2Mode: s.settings.s2Billing, canDeposit: L.can(p, 'desk'), canDesk: L.can(p, 'desk') || L.can(p, 'ic-finance') || L.can(p, 'owner-finance'), canBill: L.can(p, 'finance') || L.can(p, 'receiver-review') || L.can(p, 'ic-finance') };
  }

  // ── Accounting (shown) and the group view ─────────────────────────────────────────────────────────────────────
  function ledger(s, leId) {
    var c = L.le(s, leId);
    var txs = s.tx.filter(function (t) { return t.le === leId; });
    var tb = {};
    txs.forEach(function (t) { t.lines.forEach(function (l) { var k = l.account; tb[k] = tb[k] || { account: k, name: Seed.ACCOUNTS[k], dr: 0, cr: 0 }; tb[k].dr = U.r2(tb[k].dr + l.dr); tb[k].cr = U.r2(tb[k].cr + l.cr); }); });
    var rows = Object.keys(tb).sort().map(function (k) { var x = tb[k]; var bal = U.r2(x.dr - x.cr); return { account: k, name: x.name, dr: num(x.dr), cr: num(x.cr), balance: num(bal), side: bal >= 0 ? 'Dr' : 'Cr', bal: bal }; });
    var dr = U.sum(txs, function (t) { return U.sum(t.lines, function (l) { return l.dr; }); });
    var cr = U.sum(txs, function (t) { return U.sum(t.lines, function (l) { return l.cr; }); });
    return { le: leId, company: c.short, name: c.name, currency: c.currency, country: L.country(s, c.country).name, txs: txs.slice().reverse().map(function (t) { return txView(s, t); }), trial: rows, dr: num(dr), cr: num(cr), balanced: U.r2(dr - cr) === 0, count: txs.length };
  }
  var IC_PAIRS = [
    { label: 'Intercompany receivable ↔ payable', a: ['1210'], b: ['2110'] },
    { label: 'Unbilled IC receivable ↔ accrued IC payable', a: ['1220'], b: ['2120'] },
    { label: 'IC revenue ↔ IC project cost', a: ['4110', '4120', '4130'], b: ['5100', '5110', '5120', '5130'] }
  ];
  function consolidation(s) {
    var g = s.settings.groupCurrency;
    var acc = {};
    s.tx.forEach(function (t) {
      var fx = E.rate(s, t.currency, g, t.date);
      t.lines.forEach(function (l) { acc[l.account] = U.r2((acc[l.account] || 0) + (l.dr - l.cr) * fx); });
    });
    var elim = IC_PAIRS.map(function (p) {
      var a = U.r2(p.a.reduce(function (x, k) { return x + (acc[k] || 0); }, 0));
      var b = U.r2(p.b.reduce(function (x, k) { return x + (acc[k] || 0); }, 0));
      return { label: p.label, side1: num(a), side2: num(b), diff: U.r2(a + b), diffText: num(U.r2(a + b)), ok: Math.abs(U.r2(a + b)) < 1 };
    });
    var ext = Object.keys(acc).filter(function (k) { return acc[k] !== 0 && ['1210', '2110', '1220', '2120', '4110', '4120', '4130', '5100', '5110', '5120', '5130'].indexOf(k) === -1; }).sort()
      .map(function (k) { return { account: k, name: Seed.ACCOUNTS[k], amount: num(acc[k]), side: acc[k] >= 0 ? 'Dr' : 'Cr' }; });
    return { currency: g, eliminations: elim, after: ext, note: 'Converted to ' + g + ' at each transaction\'s date; differences on the IC lines are exchange differences, eliminated against FX reserves in a real consolidation.' };
  }

  // ── Reports (MC-FR-32) ─────────────────────────────────────────────────────────────────────────────────────────
  function reports(s) {
    var p = E.persona(s);
    var g = s.settings.groupCurrency;
    var fleet = s.units.filter(function (u) { return L.inBu(p, u.owner); }).map(function (u) { return unitRow(s, u); });
    var byOwner = {};
    s.units.forEach(function (u) {
      var k = L.leOf(s, u.owner).short + ' · ' + L.country(s, u.country).name;
      byOwner[k] = byOwner[k] || { key: k, units: 0, out: 0 };
      byOwner[k].units++;
      if (u.status === 'OUT') byOwner[k].out++;
    });
    var pairs = {};
    s.charges.filter(function (c) { return c.relation.indexOf('IC_') === 0; }).forEach(function (c) {
      var k = L.leShort(s, c.providerLe) + ' → ' + L.leShort(s, c.receiverLe) + '|' + c.period;
      pairs[k] = pairs[k] || { pair: k.split('|')[0], period: period(c.period), amount: 0, currency: c.currency, invoiced: 0 };
      pairs[k].amount = U.r2(pairs[k].amount + c.amount);
      if (c.arNumber) pairs[k].invoiced = U.r2(pairs[k].invoiced + c.amount);
    });
    var margins = s.requests.map(function (r) {
      var cs = s.charges.filter(function (c) { return c.requestId === r.id; });
      var cost = U.sum(cs.filter(function (c) { return c.relation !== 'CUSTOMER'; }), function (c) { return c.amount * E.rate(s, c.currency, g, s.today); });
      var rev = r.type === 'CUSTOMER_RENTAL' ? U.sum(cs, function (c) { return c.amount * E.rate(s, c.currency, g, s.today); }) : 0;
      if (r.type === 'CUSTOMER_PROJECT') {
        var prj = L.project(s, r.projectId);
        rev = U.r2(cost * (1 + (prj ? prj.markupPct : 0)));
      }
      return { number: r.number, type: TYPE[r.type], company: L.leShort(s, r.requestingLe), cost: num(cost), revenue: rev ? num(rev) : '', margin: rev ? num(rev - (r.type === 'CUSTOMER_RENTAL' ? 0 : cost)) : '', note: r.type === 'CUSTOMER_PROJECT' ? 'customer billed at cost + markup' : r.type === 'CUSTOMER_RENTAL' ? 'FleetCo revenue' : 'internal: cost only' };
    }).filter(function (x) { return x.cost !== '0.00' || x.revenue; });
    return {
      utilisation: Object.keys(byOwner).sort().map(function (k) { var x = byOwner[k]; return { key: k, units: x.units, out: x.out, pct: Math.round(x.out / x.units * 100) }; }),
      icByPair: Object.keys(pairs).sort().map(function (k) { var x = pairs[k]; return { pair: x.pair, period: x.period, amount: money(x.amount, x.currency), invoiced: money(x.invoiced, x.currency), open: money(x.amount - x.invoiced, x.currency) }; }),
      margins: margins, fleet: fleet, customs: s.customs.map(function (c) { return { permit: c.permit, serial: c.serial, route: c.from + ' → ' + c.to, regime: c.regime, entry: date(c.entry), reexportBy: date(c.reexportBy), daysLeft: c.status === 'OPEN' ? U.diffDays(c.reexportBy, s.today) : '', status: c.status === 'OPEN' ? 'Open' : c.status === 'CLOSED' ? 'Closed: ' + (c.outcome || '') : 'Regularise' }; }),
      certs: s.units.reduce(function (a, u) { return a.concat(u.certs.map(function (c) { var left = U.diffDays(c.expiry, s.today); return { serial: u.serial, country: c.country, type: c.type, expiry: date(c.expiry), daysLeft: left, soon: left < 90 }; })); }, []).sort(function (a, b) { return a.daysLeft - b.daysLeft; }),
      accrued: s.statements.filter(function (st) { return st.accrued; }).map(function (st) { return { number: st.number, amount: money(st.accrued.amount, st.currency), reversed: st.accrued.reversed ? 'Reversed' : 'Open' }; }),
      disputes: s.statements.reduce(function (a, st) { return a.concat(st.disputes.map(function (d) { return { statement: st.number, charge: d.chargeId, reason: d.reason, raised: date(d.at), age: U.diffDays(d.resolved ? d.resolvedAt : s.today, d.at) + ' days', state: d.resolved ? d.resolution : 'Open' }; })); }, [])
    };
  }

  // ── Setup (MC-FR-01..07) and the guide ────────────────────────────────────────────────────────────────────────
  var SETTINGS = [
    ['requesterApproval', 'OD-12', 'Requesting BU also approves above a threshold', 'bool'], ['requesterThreshold', 'OD-12', 'That threshold (requester\'s currency)', 'number'],
    ['onHire', 'OD-05', 'On hire at', 'choice', [['RECEIPT', 'Receipt on site'], ['DISPATCH', 'Dispatch from the yard']]], ['disputeDays', 'MC-FR-23', 'Days to agree a statement', 'number'],
    ['cutoffDay', 'OD-06', 'IC cut-off: day of the next month', 'number'], ['s2Billing', 'OD-07', 'Who bills Customer X (scenario 2)', 'choice', [['PPM', 'ProjectCo\'s project contract (PPM)'], ['EQUIPRITE', 'EquipRite invoice from ProjectCo']]],
    ['netting', 'OD-10', 'Settle by monthly netting', 'bool'], ['damageThreshold', 'OD-11', 'Damage above this needs the user\'s acceptance', 'number'], ['lossMarkupPct', 'OD-11', 'Loss value = net book value + (0.1 = 10 %)', 'number'],
    ['simulateFailure', 'demo', 'Make the next invoice pair fail once (to show retry)', 'bool']
  ];
  function setup(s) {
    return {
      companies: s.companies.map(function (c) { var k = L.country(s, c.country); return { id: c.id, name: c.name, short: c.short, country: k.name, currency: c.currency, taxReg: c.taxReg, icOrg: c.icOrg, role: c.role, vat: Math.round(k.vat * 100) + ' %', wht: k.wht ? Math.round(k.wht * 100) + ' %' : 'none', eInvoicing: k.eInvoicing, weekend: k.weekend.map(function (x) { return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]; }).join('–') }; }),
      bus: s.bus.map(function (b) { return { id: b.id, name: b.name, company: L.le(s, b.le).short, roles: b.roles.map(function (r) { return { fleet: 'owns fleet', rental: 'rents to customers', projects: 'runs projects' }[r]; }).join(', ') }; }),
      orgs: s.orgs.map(function (o) { return { name: o.name, owner: L.le(s, o.le).short, country: o.country, kind: { yard: 'Home yard', deploy: 'Deployment org (at sites)', customer: 'At customer sites', site: 'Site store' }[o.kind] }; }),
      relations: s.icRelations.map(function (r) { return { id: r.id, provider: L.buName(s, r.provider), receiver: L.buName(s, r.receiver), type: (REL[E.relationType(s, r.provider, r.receiver)] || {}).label, mechanism: r.mechanism === 'PAIR' ? 'Invoice pair (OD-01 A)' : 'PPM cross-charge (OD-14)', allowed: r.allowed, lead: r.leadDays + ' days', netting: r.netting ? 'Yes' : 'No' }; }),
      agreements: s.agreements.map(function (a) { return { id: a.id, number: a.number, kind: { INTERCOMPANY: 'Intercompany', CROSS_CHARGE: 'Cross-charge', CUSTOMER: 'Customer' }[a.kind], between: L.buName(s, a.provider) + ' → ' + (a.customer ? (L.customer(s, a.customer) || {}).name : L.buName(s, a.receiver)),
        currency: a.currency, version: a.version, tax: { DOMESTIC: 'Domestic VAT', REVERSE_CHARGE: 'Reverse charge + withholding ' + Math.round((a.wht || 0) * 100) + ' %', NONE: 'No tax (same entity)' }[a.tax], terms: a.terms,
        rates: Object.keys(a.rates).map(function (k) { return { cls: k, clsName: (U.byId(s.classes, k) || {}).name, day: a.rates[k].day, week: a.rates[k].week }; }), versions: a.versions, transport: a.transport, minDays: a.minDays, standby: Math.round((a.standbyPct || 0) * 100) + ' %' }; }),
      settings: SETTINGS.map(function (x) { return { key: x[0], ref: x[1], label: x[2], kind: x[3], value: s.settings[x[0]], valueText: String(s.settings[x[0]]), choices: (x[4] || []).map(function (c) { return { value: c[0], label: c[1], on: s.settings[x[0]] === c[0] }; }) }; }),
      personas: personas(s), canEdit: can(s, 'ic-finance')
    };
  }

  /** The end-to-end story: each step, who does it, whether it has happened yet, and who to play next. */
  function guide(s) {
    var any = function (f) { return s.requests.some(function (r) { return r.lines.some(function (l) { return f(r, l); }); }); };
    var stAny = function (f) { return s.statements.some(f); };
    var steps = [
      ['Raise a request for ProjectCo\'s project', 'p-pm', 'new-request', any(function () { return true; })],
      ['FleetCo approves and allocates (the sourcing BU)', 'p-em', 'approvals', any(function (r, l) { return !!l.events.approved; })],
      ['FleetCo\'s yard ships it (asset: custody; stock: transfer order inside FleetCo)', 'p-yard', 'yard', any(function (r, l) { return !!l.events.shipped; })],
      ['ProjectCo receives it on site: on hire', 'p-site', 'site', any(function (r, l) { return !!l.events.onHire; })],
      ['Record and approve the hours', 'p-pm', 'site', s.hours.some(function (h) { return h.approved; })],
      ['Move the demo clock to the month end, run the charges', 'p-fin', 'charges', s.charges.length > 0],
      ['FleetCo releases the statement', 'p-fin', 'charges', stAny(function (x) { return x.status !== 'DRAFT'; })],
      ['ProjectCo agrees it (or disputes a line)', 'p-pcfin', 'charges', stAny(function (x) { return ['AGREED', 'PARTLY_AGREED', 'INVOICED', 'PARTLY_INVOICED', 'SETTLED', 'FAILED'].indexOf(x.status) !== -1; })],
      ['Intercompany workbench: create the AR and AP pair', 'p-fin', 'ic-workbench', stAny(function (x) { return x.pair && x.pair.status === 'CREATED'; })],
      ['ProjectCo bills Customer X (scenario 2)', 'p-pcfin', 'billing', s.tx.some(function (t) { return t.kind === 'PROJECT_BILL' || (t.kind === 'CUSTOMER_AR' && t.le === 'LE-PC'); })],
      ['Settle by netting', 'p-fin', 'ic-workbench', stAny(function (x) { return x.pair && x.pair.settled; })],
      ['Off hire, return, inspect', 'p-yard', 'yard', any(function (r, l) { return l.status === 'CLOSED'; })],
      ['See the request\'s money: complete, with its accounting', 'p-pm', 'requests', s.requests.some(function (r) { return finance(s, r.id).complete; })]
    ];
    var firstOpen = -1;
    var rows = steps.map(function (x, i) { if (!x[3] && firstOpen === -1) firstOpen = i; return { n: i + 1, text: x[0], persona: x[1], personaName: (U.byId(Seed.PERSONAS, x[1]) || {}).name, navId: x[2], done: x[3] }; });
    rows.forEach(function (r, i) { r.next = i === firstOpen; });
    return { steps: rows, done: rows.filter(function (r) { return r.done; }).length, total: rows.length,
      scenarios: [
        { id: 'S1', title: 'Scenario 1 · ProjectCo internal project uses FleetCo equipment', how: 'Priya: New request → project PC-INT-014 → a FleetCo excavator (intercompany, domestic).' },
        { id: 'S2', title: 'Scenario 2 · ProjectCo customer project (Customer X)', how: 'Priya: New request → PC-C-2207 → a FleetCo unit; later Mark bills Customer X in Customer billing.' },
        { id: 'S3', title: 'Scenario 3 · FleetCo rents to its customer (Customer Y)', how: 'Lena (rental desk): New request → customer rental → Customer Y; deposit, approve, ship, invoice.' },
        { id: 'XB', title: 'Cross-border · ProjectCo KSA uses FleetCo equipment', how: 'Faisal: New request → PK-C-0310 (Riyadh): customs, reverse charge, withholding, SAR exchange.' },
        { id: 'LE', title: 'Same company · Facilities lends to Projects', how: 'Priya: pick ProjectCo Facilities\' light tower: cross-charge, no invoice.' }
      ] };
  }

  function notifications(s) {
    var p = E.persona(s);
    var list = s.notifications.filter(function (n) { return E.visibleTo(n, p); }).slice(0, 60).map(function (n) {
      return { id: n.id, at: date(n.at), text: n.text, kind: n.kind, unread: n.readBy.indexOf(p.id) === -1, link: n.link };
    });
    return { rows: list, unread: list.filter(function (n) { return n.unread; }).length };
  }

  /** What is waiting for me, across the screens (My work and the menu badges). */
  function work(s) {
    var p = E.persona(s);
    var a = approvals(s);
    var y = yard(s);
    var st = site(s);
    var c = charges(s);
    var w = workbench(s);
    var b = billing(s);
    var items = [];
    function add(n, label, navId, who) { if (n > 0 && who) items.push({ count: n, label: label, navId: navId }); }
    add(a.count, 'lines to approve and allocate from your fleet', 'approvals', L.can(p, 'owner-em'));
    add(y.counts.ship, 'units to ship', 'yard', L.can(p, 'yard'));
    add(y.counts.collect, 'units to collect (off hire)', 'yard', L.can(p, 'yard'));
    add(y.counts.inspect, 'units to inspect', 'yard', L.can(p, 'yard') || L.can(p, 'owner-em'));
    add(st.counts.receive, 'units arriving: confirm receipt', 'site', L.can(p, 'site') || L.can(p, 'desk'));
    add(st.counts.hoursWaiting, 'days of hours to approve', 'site', L.can(p, 'requester') || L.can(p, 'receiver-review'));
    add(c.counts.release, 'statements to release', 'charges', L.can(p, 'owner-finance') || L.can(p, 'ic-finance'));
    add(c.counts.review, 'statements to agree or dispute', 'charges', L.can(p, 'receiver-review'));
    add(w.toCreate.length, 'invoice pairs to create', 'ic-workbench', L.can(p, 'ic-finance'));
    add(w.toSettle.length, 'invoiced statements to settle', 'ic-workbench', L.can(p, 'ic-finance'));
    add(w.internal.length, 'cross-charges and own-equipment costs to post', 'ic-workbench', L.can(p, 'ic-finance') || L.can(p, 'finance'));
    add(b.waiting.length, 'customer charges to invoice', 'billing', b.canDesk);
    add(b.projects.filter(function (x) { return x.canBill; }).length, 'customer projects to bill', 'billing', b.canBill);
    add(s.requests.filter(function (r) { return r.status === 'AWAITING_REQUESTER_APPROVAL' && L.inBu(p, r.requestingBu); }).length, 'requests over your threshold to approve', 'requests', L.can(p, 'receiver-review'));
    var mineReq = requests(s, {}).rows;
    return { me: me(s), items: items, total: U.sum(items, function (i) { return i.count; }), myRequests: mineReq.slice(0, 6), unfinished: mineReq.filter(function (r) { return !r.finComplete; }).length,
      notifications: notifications(s), guide: guide(s) };
  }

  return { me: me, personas: personas, requests: requests, request: request, finance: finance, requestAccounting: requestAccounting, approvals: approvals, yard: yard, site: site, hours: hours,
    charges: charges, workbench: workbench, billing: billing, ledger: ledger, consolidation: consolidation, reports: reports, setup: setup, guide: guide, notifications: notifications, work: work,
    fmt: { date: date, short: short, period: period, num: num, money: money }, REL: REL, TYPE: TYPE };
});
