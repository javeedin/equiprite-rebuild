define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine', 'resources/js/future/fxViews'], function (Seed, E, V) {
  'use strict';

  /**
   * EquipRite Future · Money: what the three money screens add to their views (fxViews charges, workbench, billing).
   * Pure functions of the state, for the persona played.
   *
   * Every action is previewed before it runs by a DRY RUN: the engine plays it on a copy of the state (nothing is
   * saved) and the preview shows exactly what that run made: the charge lines, the AR and AP invoices, the project
   * cost, the settlement with its withholding and exchange difference, the customer invoice and the accounting each
   * company's Fusion makes for them (shown, never posted).
   *
   *   charges(state, view, ui)     Charges & statements: the charge run, statements with their lines, who does what
   *   workbench(state, view, ui)   Intercompany workbench: the invoice pairs to create, settlements, internal postings,
   *                                reconciliation, the transactions created
   *   billing(state, view, ui)     Customer billing: scenario 3 (FleetCo's customers, deposits), scenario 2 (ProjectCo
   *                                bills Customer X), the customer invoices and their payments
   *   check(state, request)        a page's own check before an action ('' when fine), in plain words
   *   failure(state, request, e)   a failed action as the page keeps it in view: { text, type, ref }
   *   exportSpec(page, list, v)    what exportKit.run takes for one list of a screen
   */
  var U = E.util;
  var L = E.lookups;
  var F = V.fmt;
  var ADMIN = 'p-admin';

  var KIND = { RENTAL: 'Rental', STANDBY: 'Standby', TRANSPORT: 'Transport', BREAKDOWN_CREDIT: 'Breakdown credit', MIN_HIRE: 'Minimum hire', DAMAGE: 'Damage', LOSS: 'Loss',
    CREDIT: 'Credit', ADJUSTMENT: 'Adjustment' };
  var TXK = {
    IC_AR: 'Intercompany AR invoice', IC_AP: 'Intercompany AP invoice', PROJECT_COST: 'Project cost (PPM)', NETTING: 'Settlement / netting', ACCRUAL: 'Accrual',
    ACCRUAL_REVERSAL: 'Accrual reversal', CROSS_CHARGE: 'Cross-charge (PPM)', OWN_COST: 'Own equipment cost (PPM)', CUSTOMER_AR: 'Customer invoice',
    PROJECT_BILL: 'Project invoice (PPM billing)', CUSTOMER_RECEIPT: 'Customer receipt', DEPOSIT: 'Deposit received', DEPOSIT_SETTLE: 'Deposit applied and refunded'
  };
  // The transaction kinds the workbench lists, in the chips' groups.
  var TX_GROUPS = [
    { key: '', label: 'All' }, { key: 'IC_AR', label: 'IC AR', kinds: ['IC_AR'] }, { key: 'IC_AP', label: 'IC AP', kinds: ['IC_AP'] },
    { key: 'PROJECT_COST', label: 'Project cost', kinds: ['PROJECT_COST'] }, { key: 'NETTING', label: 'Settlement', kinds: ['NETTING'] },
    { key: 'ACCRUAL', label: 'Accruals and reversals', kinds: ['ACCRUAL', 'ACCRUAL_REVERSAL'] }, { key: 'INTERNAL', label: 'Cross-charge and own cost', kinds: ['CROSS_CHARGE', 'OWN_COST'] }
  ];
  var ST_TONE = { DRAFT: 'na', RELEASED: 'run', DISPUTED: 'bad', PARTLY_AGREED: 'todo', AGREED: 'ok', FAILED: 'bad', PARTLY_INVOICED: 'run', INVOICED: 'run', SETTLED: 'ok' };
  var CH_TONE = { CALCULATED: 'na', IN_STATEMENT: 'run', DISPUTED: 'bad', ACCEPTED: 'ok', INVOICED: 'ok', POSTED: 'ok' };

  function lowerFirst(t) { var x = String(t || ''); return x.charAt(0).toLowerCase() + x.slice(1); }
  function pct(x) { return (Math.round((Number(x) || 0) * 1000) / 10) + ' %'; }
  function rate4(r) { return (Math.round((Number(r) || 0) * 10000) / 10000).toFixed(4); }
  function qty(n) { return String(Math.round((Number(n) || 0) * 100) / 100); }
  function unique(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function arr(a) { return Array.isArray(a) ? a : []; }
  function plural(n, a, b) { return n + ' ' + (n === 1 ? a : (b || a + 's')); }
  function vatOf(s, leId) { var c = L.le(s, leId); return c ? L.country(s, c.country).vat : 0; }
  function countryName(s, leId) { var c = L.le(s, leId); return c ? L.country(s, c.country).name : ''; }
  function has(p, role) { return L.can(p, role); }

  /**
   * A dry run: the action played on a copy of the state by the engine itself, as someone allowed to run it (nothing
   * is saved). { ok, error, result, state (after), txs (the Fusion transactions it made), charges (the lines it made) }.
   */
  function dry(s, type, payload, opts) {
    var o = opts || {};
    var base = Object.assign({}, s, { personaId: o.as || ADMIN });
    if (o.settings) base.settings = Object.assign({}, s.settings, o.settings);
    var r = E.apply(base, type, payload || {});
    if (!r.ok) return { ok: false, error: r.error || '', result: null, state: null, txs: [], charges: [] };
    var knownTx = {};
    var knownCh = {};
    arr(s.tx).forEach(function (t) { knownTx[t.id] = 1; });
    arr(s.charges).forEach(function (c) { knownCh[c.id] = 1; });
    return { ok: true, error: '', result: r.result, state: r.state, txs: r.state.tx.filter(function (t) { return !knownTx[t.id]; }),
      charges: r.state.charges.filter(function (c) { return !knownCh[c.id]; }) };
  }

  /** A Fusion transaction with the accounting Fusion makes for it (shown, not posted). */
  function txRow(s, t, openMap) {
    var c = L.le(s, t.le) || {};
    var lines = arr(t.lines).map(function (l) {
      return { account: l.account, name: l.name, dr: l.dr, cr: l.cr, drText: l.dr ? F.num(l.dr) : '', crText: l.cr ? F.num(l.cr) : '', memo: l.memo || '' };
    });
    var dr = U.sum(lines, function (l) { return l.dr; });
    var cr = U.sum(lines, function (l) { return l.cr; });
    var ent = t.entered || null;
    var foreign = !!(ent && ent.currency && ent.currency !== t.currency);
    var booked = U.sum(arr(t.lines).filter(function (l) { return l.account === '2110'; }), function (l) { return l.cr; });
    var amount = ent ? F.money(ent.amount, ent.currency) + (foreign && booked ? ' (' + F.money(booked, t.currency) + ')' : '')
      : (t.total ? F.money(t.total, t.currency) : (t.amount != null ? F.money(t.amount, t.currency) : ''));
    return {
      id: t.id, number: t.number, kind: t.kind, kindText: TXK[t.kind] || t.kind, title: t.title, company: c.short || t.le, le: t.le, currency: t.currency,
      date: t.date, dateText: F.date(t.date), source: t.source || '', status: t.status, statusText: t.status === 'SETTLED' ? 'Settled' : 'Created',
      lines: lines, hasLines: lines.length > 0, drcr: lines.map(function (l) { return (l.dr ? 'Dr ' : 'Cr ') + l.account + ' ' + l.name; }).join(' / '), totalDr: F.num(dr), totalCr: F.num(cr), balanced: U.r2(dr - cr) === 0, amountText: amount,
      enteredText: foreign ? 'Entered ' + F.money(ent.amount, ent.currency) + ', booked in ' + t.currency + ' at ' + rate4(t.rate || 1) + ' (1 ' + ent.currency + ' = ' + rate4(t.rate || 1) + ' ' + t.currency + ')'
        : (ent ? 'Entered and booked in ' + t.currency : (t.rate && t.rate !== 1 ? 'Booked in ' + t.currency + ' at today\'s rate ' + rate4(t.rate) : 'Booked in ' + t.currency)),
      note: t.note || (lines.length ? '' : 'No accounting of its own.'),
      items: arr(t.items).map(function (i) { return { expType: i.expType, task: i.task || '', amountText: F.money(i.amount, t.currency), date: i.date ? F.date(String(i.date).length === 7 ? U.monthEnd(i.date) : i.date) : '' }; }),
      expanded: !!(openMap && openMap[t.id]), openAmount: t.open
    };
  }
  /** The project and task an AP cost line is coded to ("PC-INT-014 · 1.1 Site works"), from its name. */
  function subOf(l) {
    var base = Seed.ACCOUNTS[l.account] || '';
    return l.name && l.name.indexOf(base + ' · ') === 0 ? l.name.slice(base.length + 3) : '';
  }

  // ── Charges & statements ───────────────────────────────────────────────────────────────────────────────────────
  var RUN_DOES = [
    { key: 'rental', text: 'Rental by the rate engine: the agreement\'s week and day rates for the days on hire in the month (MC-FR-22).' },
    { key: 'standby', text: 'Standby from the approved hours, at the agreement\'s standby percentage.' },
    { key: 'transport', text: 'Transport out and back, at the agreement\'s rate per trip.' },
    { key: 'breakdown', text: 'Breakdown credits for the days a unit was down by the owner\'s fault.' },
    { key: 'minimum', text: 'Minimum hire when a unit came back before the agreed minimum.' },
    { key: 'damage', text: 'Damage from the return inspection, with its photos.' },
    { key: 'loss', text: 'Loss at the agreed value (net book value plus the loss mark-up).' },
    { key: 'statements', text: 'One statement per company pair and month for the intercompany lines; customer and same-company lines wait for Customer billing and the workbench.' }
  ];

  /** A charge line's detail with its money written out: "24 days, 7 Nov – 30 Nov, at AED 3,500.00 a week or AED 800.00 a day". */
  function detailOf(c) {
    var t = String(c.text || '').replace(/\bday\(s\)/, c.qty === 1 ? 'day' : 'days');
    t = t.replace(/(-?\d+(?:\.\d+)?)\/week or (-?\d+(?:\.\d+)?)\/day/, function (m, a, b) { return F.money(Number(a), c.currency) + ' a week or ' + F.money(Number(b), c.currency) + ' a day'; });
    if (c.kind === 'RENTAL' && c.from && c.to) t = t.replace(/^(\d+ days?) at/, '$1, ' + c.from + ' – ' + c.to + ', at');
    return t;
  }

  function statementWords(s, raw, st) {
    var held = st.disputed + st.held;
    switch (raw.status) {
      case 'DRAFT': return st.providerBu + ' checks it and releases it to ' + st.receiverBu + '.';
      case 'RELEASED': return st.receiverBu + ' agrees or disputes it by ' + st.dueBy + '; no answer by then accepts it.';
      case 'DISPUTED': return plural(st.disputed, 'line') + ' in dispute: ' + st.providerBu + ' credits or keeps ' + (st.disputed === 1 ? 'it' : 'them') + '. ' + st.receiverBu + ' can agree the rest now.';
      case 'PARTLY_AGREED': return 'Agreed, ' + plural(held, 'line') + ' held' + (st.held ? ' (damage waiting for ' + st.receiverBu + '\'s acceptance)' : '') + ': the rest goes to the invoice pair.';
      case 'AGREED': return 'Agreed' + (raw.agreedBy ? ' (' + raw.agreedBy + ')' : '') + ': intercompany finance creates the invoice pair in the Intercompany workbench.';
      case 'FAILED': return 'The invoice pair failed: intercompany finance retries it in the Intercompany workbench.';
      case 'PARTLY_INVOICED': return 'Invoiced in part (' + st.pairNumber + '); the held lines follow when they are agreed.';
      case 'INVOICED': return 'Invoiced (' + st.pairNumber + '): AR in ' + st.provider + ', AP in ' + st.receiver + '. Next: settle it (netting).';
      case 'SETTLED': return 'Settled (' + st.pairNumber + '): every financial transaction of this statement is done.';
      default: return '';
    }
  }

  function statementCard(s, st, p, ui) {
    var raw = U.byId(s.statements, st.id) || {};
    var ag = L.agreement(s, raw.agreementId) || {};
    var o = ui || {};
    var canResolve = st.iOwn && (has(p, 'owner-finance') || has(p, 'ic-finance'));
    var disputes = arr(raw.disputes);
    var pending = arr(st.charges).filter(function (c) { return c.status === 'IN_STATEMENT'; });
    var disputedRows = arr(st.charges).filter(function (c) { return c.status === 'DISPUTED'; });
    var due = U.addDays(s.today, s.settings.disputeDays);
    var lines = arr(st.charges).map(function (c) {
      var d = disputes.filter(function (x) { return x.chargeId === c.id; }).slice(-1)[0];
      var max = Math.abs(c.amount);
      return Object.assign({}, c, {
        what: (KIND[c.kind] || c.kind), whatLower: (KIND[c.kind] || c.kind).toLowerCase(), detail: detailOf(c), qtyText: qty(c.qty) + ' ' + c.uom, projectTask: c.project ? c.project + (c.task ? ' · ' + c.task : '') : 'No project',
        period: c.period, credit: c.amount < 0, statusTone: CH_TONE[c.status] || 'na',
        canDispute: st.canReview && c.status === 'IN_STATEMENT', canAccept: st.canReview && c.needsAcceptance, canResolve: canResolve && c.status === 'DISPUTED',
        heldText: c.needsAcceptance ? 'Held: damage above ' + F.money(s.settings.damageThreshold, c.currency) + ' waits for ' + st.receiverBu + '\'s acceptance (OD-11).' : '',
        disputeText: d ? '“' + d.reason + '” · ' + d.by + ', ' + F.date(d.at) : (c.dispute ? '“' + c.dispute + '”' : ''),
        resolvedText: d && d.resolved ? d.resolution + ' by ' + d.resolvedBy + ', ' + F.date(d.resolvedAt) : '',
        invoiceText: c.arNumber ? 'AR and AP ' + c.arNumber : '',
        maxCredit: max, maxCreditText: F.money(max, c.currency),
        creditDefault: String(max),
        disputeDoes: 'Holds this line with your reason: ' + st.providerBu + ' sees it and credits or keeps it. The rest of the statement goes on. In Fusion: nothing.',
        acceptDoes: 'Accepts the damage charge, so it goes on the invoice pair with the rest. In Fusion: nothing yet.',
        creditDoes: 'Adds a credit line to the statement and agrees the disputed line with it; both go on the invoice pair. In Fusion: nothing until the pair, which carries the net.',
        keepDoes: 'Keeps the charge and sends it back to ' + st.receiverBu + ' to agree, with ' + s.settings.disputeDays + ' more days (silence accepts). In Fusion: nothing.'
      });
    });
    var agreeAmount = U.sum(pending, function (c) { return c.amount; });
    return Object.assign({}, st, {
      pairText: st.provider + ' → ' + st.receiver, busText: st.providerBu + ' → ' + st.receiverBu, relTone: (V.REL[st.relation] || {}).tone || 'ic',
      statusTone: ST_TONE[st.status] || 'na', nextText: statementWords(s, raw, st),
      roleText: st.iOwn && st.iUse ? 'You see both sides' : st.iOwn ? 'You are the owner' : 'You are the user',
      taxText: ag.tax === 'DOMESTIC' ? 'Domestic: VAT ' + pct(vatOf(s, raw.providerLe)) + ' on the invoice pair'
        : ag.tax === 'REVERSE_CHARGE' ? 'Cross-border: no VAT on the AR (the user self-assesses it), withholding ' + pct(ag.wht) + ' at payment' : '',
      agreementText: ag.number ? ag.number + ' v' + (raw.agreementVersion || ag.version) : '',
      dueText: ['RELEASED', 'DISPUTED'].indexOf(raw.status) !== -1 && st.dueBy ? 'Answer by ' + st.dueBy : (raw.agreedAt ? 'Agreed ' + F.date(raw.agreedAt) : (raw.status === 'DRAFT' ? 'Not released yet' : '')),
      released: raw.releasedAt ? F.date(raw.releasedAt) : '',
      rows: lines, lineCount: lines.length,
      canAgree: st.canReview && pending.length > 0, canResolveAny: canResolve && disputedRows.length > 0,
      releaseDoes: 'Sends ' + st.number + ' (' + plural(lines.length, 'line') + ', ' + st.totalText + ') to ' + st.receiverBu + ' to agree or dispute by ' + F.date(due)
        + '; no answer by then accepts it. In Fusion: nothing yet; the invoices come after the agreement.',
      agreeDoes: 'Agrees ' + plural(pending.length, 'line') + ' (' + F.money(agreeAmount, st.currency) + ')' + (disputedRows.length ? '; ' + plural(disputedRows.length, 'disputed line') + ' stay' + (disputedRows.length === 1 ? 's' : '') + ' held' : '')
        + '. Then intercompany finance creates the AR invoice in ' + st.provider + ' and the AP invoice in ' + st.receiver + '. In Fusion: nothing yet.',
      disputes: disputes.map(function (x) { return { chargeId: x.chargeId, reason: x.reason, by: x.by, at: F.date(x.at), resolved: !!x.resolved, resolution: x.resolution || '', resolvedBy: x.resolvedBy || '' }; }),
      expanded: o.openSt ? !!o.openSt[st.id] : true
    });
  }

  function runPanel(s, v, period) {
    var p = E.persona(s);
    var keys = unique(arr(v.periods).map(function (x) { return x.key; }).concat([v.runPeriod])).sort().reverse();
    var per = period && keys.indexOf(period) !== -1 ? period : v.runPeriod;
    var end = U.monthEnd(per);
    var ready = s.today >= end;
    var preview = null;
    if (ready) {
      var d = dry(s, 'runCharges', { period: per });
      if (d.ok) {
        var made = d.charges;
        var kinds = {};
        made.forEach(function (c) { kinds[c.kind] = (kinds[c.kind] || 0) + 1; });
        var sts = arr(d.state.statements).filter(function (x) { return x.period === per && x.status === 'DRAFT'; });
        var ic = made.filter(function (c) { return c.relation.indexOf('IC_') === 0; }).length;
        preview = {
          ok: true, made: d.result.made, changed: d.result.changed, statements: d.result.statements,
          kinds: Object.keys(kinds).map(function (k) { return { kind: k, text: (KIND[k] || k) + ' ' + kinds[k] }; }),
          words: d.result.made || d.result.changed
            ? 'Run now, it makes ' + plural(d.result.made, 'new charge line') + (d.result.changed ? ' and updates ' + d.result.changed : '') + ': ' + plural(ic, 'intercompany line') + ' on '
              + plural(d.result.statements, 'statement') + ' (' + sts.map(function (x) { return L.leShort(s, x.providerLe) + ' → ' + L.leShort(s, x.receiverLe); }).join(', ') + '), '
              + plural(made.length - ic, 'customer or same-company line') + ' for Customer billing and the workbench.'
            : 'Nothing new to charge for ' + F.period(per) + ': a rerun adds only what changed, and an invoiced line is never edited.'
        };
      } else preview = { ok: false, error: d.error, kinds: [] };
    }
    return {
      period: per, periodText: F.period(per), monthEnd: end, monthEndText: F.date(end), ready: ready, todayText: F.date(s.today),
      readyText: ready ? 'Ready: ' + F.period(per) + ' closed on ' + F.date(end) + '.' : 'Not yet: ' + F.period(per) + ' runs to ' + F.date(end) + ' (today is ' + F.date(s.today) + ').',
      notReadyText: 'Move the demo clock to the month end, ' + F.date(end) + '.', canMoveClock: !ready && U.monthOf(s.today) === per,
      options: keys.map(function (k) { return { key: k, label: F.period(k), on: k === per, ready: s.today >= U.monthEnd(k) }; }),
      canRun: !!v.canRun && (has(p, 'ic-finance') || has(p, 'owner-finance')), preview: preview || { ok: false, error: '', kinds: [] },
      does: RUN_DOES.map(function (x) { return x.text; }),
      fusion: 'In Fusion: nothing yet. Charges are EquipRite\'s own lines; Fusion sees them when the invoices are created.'
    };
  }

  /** Charges & statements, for the persona played: the view (fxViews.charges) plus the run, the cards, the rules. */
  function charges(s, view, ui) {
    var v = view || {};
    var o = ui || {};
    var p = E.persona(s);
    var me = V.me(s);
    var all = V.charges(s, {}).statements;
    var statements = arr(v.statements).map(function (st) { return statementCard(s, st, p, o); });
    var wc = arr(v.waitingCustomer).map(function (c) { return Object.assign({}, c, { detail: detailOf(c) }); });
    var wi = arr(v.waitingInternal).map(function (c) { return Object.assign({}, c, { detail: detailOf(c) }); });
    function totals(list) {
      var by = {};
      list.forEach(function (c) { by[c.currency] = U.r2((by[c.currency] || 0) + c.amount); });
      return Object.keys(by).map(function (k) { return F.money(by[k], k); }).join(' + ') || F.money(0, 'AED');
    }
    var lastRun = s.log.filter(function (l) { return /^Charge run /.test(l.what); })[0];
    return Object.assign({}, v, {
      me: me, statements: statements,
      periodChips: [{ key: '', label: 'All periods', count: all.length, on: !o.period }].concat(unique(all.map(function (x) { return x.period; })).sort().reverse()
        .map(function (k) { return { key: k, label: F.period(k), count: all.filter(function (x) { return x.period === k; }).length, on: o.period === k }; })),
      filterText: o.period ? F.period(o.period) : 'All periods',
      run: runPanel(s, v, o.runPeriod),
      lastRunText: lastRun ? lastRun.what + ' (' + lastRun.who + ', ' + F.date(lastRun.at) + ').' : 'No charge run yet.',
      waitingCustomer: wc, waitingInternal: wi, waitingAll: wc.concat(wi), waitingCustomerTotal: totals(wc), waitingInternalTotal: totals(wi),
      allLines: [].concat.apply([], statements.map(function (st) { return st.rows.map(function (c) { return Object.assign({ statement: st.number, pair: st.pairText }, c); }); })),
      rules: [
        { key: 'silence', text: 'Silence accepts: a released statement not answered in ' + plural(s.settings.disputeDays, 'day') + ' is agreed by itself (MC-FR-23).' },
        { key: 'held', text: 'A disputed line is held; the rest of the statement goes on to the invoice pair. The owner resolves it: a credit (all or part) or the charge kept.' },
        { key: 'damage', text: 'Damage above ' + F.money(s.settings.damageThreshold, 'AED') + ' waits for the user\'s acceptance (OD-11); silence does not accept it.' },
        { key: 'rerun', text: 'A rerun of a month adds only what changed; an invoiced line is never edited (an adjustment line is added instead).' },
        { key: 'duties', text: 'The owner (sourcing BU) runs and releases; the user (requesting BU) agrees or disputes; intercompany finance creates the invoices.' }
      ],
      canOwner: has(p, 'owner-finance') || has(p, 'ic-finance'), canUser: has(p, 'receiver-review')
    });
  }

  // ── Intercompany workbench ─────────────────────────────────────────────────────────────────────────────────────
  /** What "Create the invoice pair" will create for a statement: a dry run of createInvoicePair. */
  function pairPreview(s, stId) {
    var raw = U.byId(s.statements, stId);
    if (!raw) return { ok: false, error: 'No such statement.' };
    var ag = L.agreement(s, raw.agreementId) || {};
    var prov = L.le(s, raw.providerLe);
    var recv = L.le(s, raw.receiverLe);
    var d = dry(s, 'createInvoicePair', { statementId: stId }, { settings: { simulateFailure: false } });
    var willFail = !!s.settings.simulateFailure;
    if (!d.ok) return { ok: false, error: d.error, willFail: willFail };
    var pair = U.byId(d.state.statements, stId).pair;
    var ar = d.txs.filter(function (t) { return t.kind === 'IC_AR'; })[0];
    var ap = d.txs.filter(function (t) { return t.kind === 'IC_AP'; })[0];
    var costs = d.txs.filter(function (t) { return t.kind === 'PROJECT_COST'; });
    var rev = d.txs.filter(function (t) { return t.kind === 'ACCRUAL_REVERSAL'; });
    var invoiced = d.state.charges.filter(function (c) { return c.statementId === stId && c.arNumber === pair.number; });
    var held = s.charges.filter(function (c) { return c.statementId === stId && !c.arNumber && c.status !== 'ACCEPTED'; });
    var domestic = ag.tax === 'DOMESTIC';
    var same = ap.currency === raw.currency;
    var payable = ap.lines.filter(function (l) { return l.account === '2110'; }).reduce(function (a, l) { return a + l.cr; }, 0);
    var inputVat = ap.lines.filter(function (l) { return l.account === '1400'; }).reduce(function (a, l) { return a + l.dr; }, 0);
    return {
      ok: true, willFail: willFail, number: pair.number, lines: invoiced.length, numberNote: 'the next free number, if created now; the AR and the AP carry the same one',
      held: held.length, heldText: held.length ? plural(held.length, 'line') + ' held (in dispute or waiting for acceptance): not on this pair, invoiced when agreed.' : '',
      ar: {
        number: ar.number, company: prov.short, companyName: prov.name, bu: L.buName(s, raw.provider), currency: raw.currency, to: recv.short,
        net: F.money(pair.net, raw.currency), vat: pair.vat ? F.money(pair.vat, raw.currency) : '', total: F.money(ar.entered.amount, raw.currency),
        vatText: pair.vat ? 'VAT ' + pct(vatOf(s, prov.id)) + ': ' + F.money(pair.vat, raw.currency) : 'No VAT: reverse charge (cross-border), ' + recv.short + ' self-assesses it',
        words: 'AR invoice ' + ar.number + ' in ' + prov.short + ' (Fusion Receivables), customer: ' + recv.short + '\'s intercompany account.',
        tx: txRow(s, ar)
      },
      ap: {
        number: ap.number, company: recv.short, companyName: recv.name, bu: L.buName(s, raw.receiver), currency: ap.currency, from: prov.short,
        rate: pair.rate, rateText: same ? 'Same currency (' + ap.currency + '): no exchange rate' : '1 ' + raw.currency + ' = ' + rate4(pair.rate) + ' ' + ap.currency + ', the rate of ' + F.date(s.today),
        costLines: ap.lines.filter(function (l) { return /^51/.test(l.account); }).map(function (l) {
          return { account: l.account, expType: Seed.ACCOUNTS[l.account], projectTask: subOf(l) || 'No project', amount: F.money(l.dr - l.cr, ap.currency) };
        }),
        vatText: domestic ? 'Input VAT ' + F.money(inputVat, ap.currency) + ' (recoverable)'
          : 'VAT self-assessed ' + F.money(pair.reverseCharge, ap.currency) + ' (' + pct(vatOf(s, recv.id)) + ', reverse charge: input and output VAT, no cash)',
        payable: F.money(payable, ap.currency),
        words: 'AP invoice ' + ap.number + ' in ' + recv.short + ' (Fusion Payables), supplier: ' + prov.short + ', the same number and amounts, each line coded to its project and task.',
        tx: txRow(s, ap)
      },
      ppm: costs.map(function (t) {
        var prj = L.project(s, t.refs.projectId);
        var cust = prj && prj.customer ? L.customer(s, prj.customer) : null;
        return { projectId: t.refs.projectId, project: prj ? prj.number : 'No project', name: prj ? prj.name : '', amount: F.money(t.amount, t.currency),
          billable: !!t.billable, billText: t.billable ? 'Billable to ' + (cust ? cust.name : 'the customer') + ' (scenario 2)' : 'Not billable: internal project',
          items: arr(t.items).map(function (i) { return { expType: i.expType, task: i.task || '', amount: F.money(i.amount, t.currency) }; }) };
      }),
      reversalText: rev.length ? 'The accrual made at the cut-off is reversed in both ledgers (' + rev.map(function (t) { return L.leShort(s, t.le); }).join(', ') + ').' : '',
      does: 'Creates the AR invoice in ' + prov.short + ' and the mirror AP invoice in ' + recv.short + ' with one number (' + pair.number + '), the AP coded to each project and task; PPM takes the cost from Payables. Fusion makes the accounting below (shown, not posted by EquipRite); safe to retry by statement.',
      txs: d.txs.map(function (t) { return txRow(s, t); })
    };
  }

  /** What "Settle" will record: a dry run of settle (netting or payment, withholding, exchange difference). */
  function settlePreview(s, stId) {
    var raw = U.byId(s.statements, stId);
    if (!raw || !raw.pair) return { ok: false, error: 'Not invoiced yet.' };
    var ag = L.agreement(s, raw.agreementId) || {};
    var prov = L.le(s, raw.providerLe);
    var recv = L.le(s, raw.receiverLe);
    var d = dry(s, 'settle', { statementId: stId });
    if (!d.ok) return { ok: false, error: d.error };
    var set = U.byId(d.state.statements, stId).pair.settled;
    var ar = U.byId(s.tx, raw.pair.arTx);
    var ap = U.byId(s.tx, raw.pair.apTx);
    var gross = ar.entered.amount;
    var paid = U.r2(gross - set.wht);
    var todayRate = E.rate(s, raw.currency, recv.currency, s.today);
    var booked = ap.lines.filter(function (l) { return l.account === '2110'; }).reduce(function (a, l) { return a + l.cr; }, 0);
    var foreign = recv.currency !== raw.currency;
    var netting = !!s.settings.netting;
    var diff = set.fxDiff || 0;
    return {
      ok: true, netting: netting, method: netting ? 'Monthly netting (OD-10, INT-25)' : 'Payment',
      methodText: netting ? 'Fusion nets ' + prov.short + '\'s receivable against ' + recv.short + '\'s payable; only the group\'s net position moves through the bank.' : recv.short + ' pays ' + prov.short + ' by bank transfer.',
      gross: F.money(gross, raw.currency), paid: F.money(paid, raw.currency), wht: set.wht, whtAmount: F.money(set.wht, raw.currency),
      whtText: set.wht ? 'Withholding ' + pct(ag.wht) + ' of the net: ' + recv.short + ' keeps ' + F.money(set.wht, raw.currency) + ' and pays it to ' + countryName(s, recv.id) + '\'s tax authority; '
        + prov.short + ' books a withholding tax credit.' : 'No withholding tax (domestic).',
      foreign: foreign, invoiceRate: rate4(raw.pair.rate), todayRate: rate4(todayRate), booked: F.money(booked, recv.currency), atToday: F.money(U.r2(gross * todayRate), recv.currency),
      fxDiff: diff, fxAmount: F.money(Math.abs(diff), recv.currency),
      fxText: !foreign ? 'Same currency (' + raw.currency + '): no exchange difference.'
        : diff > 0 ? 'Exchange loss of ' + F.money(diff, recv.currency) + ' in ' + recv.short + ': invoiced at ' + rate4(raw.pair.rate) + ', settled at ' + rate4(todayRate) + '.'
          : diff < 0 ? 'Exchange gain of ' + F.money(-diff, recv.currency) + ' in ' + recv.short + ': invoiced at ' + rate4(raw.pair.rate) + ', settled at ' + rate4(todayRate) + '.'
            : 'No exchange difference: today\'s rate (' + rate4(todayRate) + ') is the invoice\'s. Move the demo clock a few days to see one.',
      does: 'Records the settlement of ' + raw.pair.number + ' in both companies: ' + (netting ? 'netting' : 'payment') + (set.wht ? ' net of withholding' : '') + (foreign ? ', with the exchange difference' : '')
        + '. The AR and AP show settled; Fusion makes the accounting below (shown, not posted).',
      txs: d.txs.map(function (t) { return txRow(s, t); })
    };
  }

  function cutoffOf(s, period) {
    var day = s.settings.cutoffDay;
    return U.nextMonth(period) + '-' + (day < 10 ? '0' : '') + day;
  }
  function accruePreview(s, stId) {
    var d = dry(s, 'accrueNow', { statementId: stId });
    if (!d.ok) return { ok: false, error: d.error, txs: [] };
    if (!d.txs.length) return { ok: false, error: 'Nothing to accrue: every line is invoiced.', txs: [] };
    return { ok: true, txs: d.txs.map(function (t) { return txRow(s, t); }),
      text: d.txs.map(function (t) { return L.leShort(s, t.le) + ' ' + F.money(t.total, t.currency); }).join(', ') };
  }

  function whoActs(s, raw, st) {
    if (raw.status === 'DRAFT') return st.providerBu + ' (owner) checks and releases it in Charges & statements.';
    if (raw.status === 'RELEASED') return st.receiverBu + ' (user) agrees or disputes it by ' + st.dueBy + '; silence accepts it then.';
    if (raw.status === 'DISPUTED') return st.providerBu + ' resolves the dispute (credit or keep); ' + st.receiverBu + ' can agree the rest.';
    if (raw.status === 'PARTLY_AGREED') return 'Agreed with lines held: what is agreed can be invoiced now; the held lines wait.';
    return '';
  }

  /** Intercompany workbench: the view (fxViews.workbench) plus previews of each action and the accounting. */
  function workbench(s, view, ui) {
    var v = view || {};
    var o = ui || {};
    var p = E.persona(s);
    var me = V.me(s);
    var canAct = has(p, 'ic-finance');
    function deco(st) {
      var raw = U.byId(s.statements, st.id) || {};
      var cut = cutoffOf(s, st.period);
      var acc = st.canAccrue && !st.settled && !(raw.pair && raw.pair.status === 'CREATED') ? accruePreview(s, st.id) : { ok: false, txs: [] };
      return Object.assign({}, st, {
        pairText: st.provider + ' → ' + st.receiver, busText: st.providerBu + ' → ' + st.receiverBu, relTone: (V.REL[st.relation] || {}).tone || 'ic', statusTone: ST_TONE[st.status] || 'na',
        failed: st.status === 'FAILED', errorText: st.pairError, cutoff: cut, cutoffText: 'IC cut-off ' + F.date(cut) + (s.today > cut ? ' (passed)' : ''),
        accrueOk: acc.ok, accrueText: acc.ok ? 'Accrue now: books ' + acc.text + ' in both ledgers at ' + F.date(U.monthEnd(st.period)) + ' (Dr unbilled IC receivable / Cr IC revenue in ' + st.provider
          + '; Dr accrued project cost / Cr accrued IC payable in ' + st.receiver + '), reversed when the pair is created. In Fusion: GL journals (INT-24).' : '',
        accrueTxs: acc.txs, whoText: whoActs(s, raw, st), lineCount: st.lines
      });
    }
    var toCreate = arr(v.toCreate).map(function (st) { return Object.assign(deco(st), { preview: pairPreview(s, st.id) }); });
    var toSettle = arr(v.toSettle).map(function (st) { return Object.assign(deco(st), { preview: settlePreview(s, st.id), arNumber: st.pairNumber }); });
    var internal = arr(v.internal);
    var post = internal.length ? dry(s, 'postInternal', {}) : null;
    var internalTxs = post && post.ok ? post.txs.map(function (t) { return txRow(s, t); }) : [];
    var group = TX_GROUPS.filter(function (g) { return g.key === (o.txKind || ''); })[0] || TX_GROUPS[0];
    var txAll = s.tx.filter(function (t) { return ['IC_AR', 'IC_AP', 'PROJECT_COST', 'NETTING', 'ACCRUAL', 'ACCRUAL_REVERSAL', 'CROSS_CHARGE', 'OWN_COST'].indexOf(t.kind) !== -1; }).slice().reverse();
    var txs = txAll.filter(function (t) { return !group.kinds || group.kinds.indexOf(t.kind) !== -1; }).map(function (t) { return txRow(s, t, o.openTx); });
    var waiting = arr(v.waitingUser).map(deco);
    var recon = arr(v.recon).map(function (r) { return Object.assign({}, r, { diffText: r.ok ? '✓ Equal' : 'Difference ' + F.num(r.diff) }); });
    return Object.assign({}, v, {
      me: me, canAct: canAct, canPost: canAct || has(p, 'finance'), toCreate: toCreate, toSettle: toSettle, waitingUser: waiting, recon: recon, txs: txs, txCount: txAll.length,
      internal: internal, internalTxs: internalTxs, internalError: post && !post.ok ? post.error : '',
      internalDoes: 'Posts ' + plural(internal.length, 'line') + ' to PPM without invoices: a cross-charge between two BUs of one company (no tax, OD-14) or the cost of a BU\'s own equipment. In Fusion: PPM cost (borrowed and lent), accounting below.',
      txChips: TX_GROUPS.map(function (g) { return { key: g.key, label: g.label, on: g.key === group.key, count: g.kinds ? txAll.filter(function (t) { return g.kinds.indexOf(t.kind) !== -1; }).length : txAll.length }; }),
      reconText: recon.length ? (v.reconOk ? 'Every invoiced statement: EquipRite\'s charges = the AR = the AP.' : 'A difference: look at the statement below.') : 'Nothing invoiced yet.',
      switchText: s.settings.simulateFailure ? 'the next invoice pair fails once (Fusion Payables rejects the AP), to show the error and Retry; then the switch turns itself off.' : 'Off',
      switchDoes: s.settings.simulateFailure ? 'Turns the demo failure off: invoice pairs go through first time.' : 'Turns the demo failure on: the next invoice pair fails once (Fusion Payables rejects the AP), so you can see the error and Retry.',
      done: arr(v.done).map(deco),
      kpi: { create: toCreate.length, settle: toSettle.length, internal: internal.length, waiting: waiting.length, recon: recon.filter(function (r) { return r.ok; }).length + ' of ' + recon.length }
    });
  }

  // ── Customer billing ───────────────────────────────────────────────────────────────────────────────────────────
  /** Customer billing: the view (fxViews.billing) plus the previews for scenario 3, deposits, scenario 2, payments. */
  function billing(s, view, ui) {
    var v = view || {};
    var o = ui || {};
    var p = E.persona(s);
    var me = V.me(s);
    var desk = has(p, 'desk');
    var canInvoice = desk || has(p, 'owner-finance') || has(p, 'ic-finance');
    var canPay = desk || has(p, 'finance') || has(p, 'owner-finance') || has(p, 'ic-finance');
    // Scenario 3: the waiting customer charges, one card per customer.
    var byCust = {};
    arr(v.waiting).forEach(function (c) {
      var raw = U.byId(s.charges, c.id) || {};
      (byCust[raw.customerId] = byCust[raw.customerId] || []).push(c);
    });
    var customers = Object.keys(byCust).map(function (cid) {
      var cust = L.customer(s, cid) || {};
      var list = byCust[cid];
      var le = L.le(s, cust.of) || {};
      var ctry = L.country(s, le.country) || {};
      var d = dry(s, 'invoiceCustomer', { customerId: cid });
      var invs = d.ok ? d.txs.filter(function (t) { return t.kind === 'CUSTOMER_AR'; }) : [];
      return {
        id: cid, name: cust.name, company: le.short, count: list.length,
        lines: list.map(function (c) { return Object.assign({}, c, { detail: detailOf(c) }); }),
        invoices: invs.map(function (t) {
          var net = t.lines.filter(function (l) { return /^41/.test(l.account); }).reduce(function (a, l) { return a + l.cr; }, 0);
          var vat = t.lines.filter(function (l) { return l.account === '2200'; }).reduce(function (a, l) { return a + l.cr; }, 0);
          return { title: t.title, net: F.money(net, t.currency), vat: F.money(vat, t.currency), vatText: 'VAT ' + pct(ctry.vat) + ': ' + F.money(vat, t.currency), total: F.money(t.entered.amount, t.currency), tx: txRow(s, t) };
        }),
        error: d.ok ? '' : d.error,
        eInvoicing: 'E-invoicing is Fusion\'s, not EquipRite\'s: ' + ctry.name + ', ' + lowerFirst(ctry.eInvoicing) + '.',
        does: 'Creates ' + (invs.length === 1 ? 'a Fusion Receivables invoice' : plural(invs.length, 'Fusion Receivables invoice')) + ' in ' + le.short + ' for ' + cust.name
          + ' (one per month), with VAT; Fusion sends it as an e-invoice. No intercompany: the owner rents to its own customer.'
      };
    });
    var deposits = arr(v.deposits).map(function (dp) {
      var r = L.request(s, dp.id) || {};
      var take = dp.needed ? dry(s, 'takeDeposit', { requestId: dp.id }) : null;
      var settle = dp.canSettle ? dry(s, 'settleDeposit', { requestId: dp.id }) : null;
      var takeTx = take && take.ok ? take.txs[0] : null;
      var setTx = settle && settle.ok ? settle.txs[0] : null;
      var setInfo = setTx ? U.byId(settle.state.requests, dp.id).deposit.settled : null;
      var ag = L.agreement(s, (r.lines || [{}])[0].agreementId) || {};
      return Object.assign({}, dp, {
        canTake: dp.needed && desk, canSettleNow: dp.canSettle && desk,
        statusText: dp.needed ? 'Needed before the owner can approve: ' + pct(ag.depositPct) + ' of four weeks\' rent' : dp.settled ? dp.settled : r.deposit ? 'Received ' + F.date(r.deposit.date) + ': held until the return inspection' : 'No deposit on this agreement',
        tone: dp.needed ? 'todo' : dp.settled ? 'ok' : 'run',
        takeText: takeTx ? 'Records ' + F.money(takeTx.total, takeTx.currency) + ' received from ' + dp.customer + ' (Fusion Receivables: Dr bank, Cr customer deposits).' : (take ? take.error : ''),
        settleText: setInfo ? 'Applies ' + F.money(setInfo.applied, setTx.currency) + ' to the open invoices of ' + dp.customer + ' and refunds ' + F.money(setInfo.refunded, setTx.currency) + ' (Fusion Receivables).' : (settle ? settle.error : ''),
        txs: [takeTx, setTx].filter(Boolean).map(function (t) { return txRow(s, t); })
      });
    });
    // Scenario 2: ProjectCo bills Customer X for its project, at cost plus the mark-up.
    var ppm = v.s2Mode === 'PPM';
    var projects = arr(v.projects).map(function (x) {
      var prj = L.project(s, x.id);
      var cur = L.leOf(s, prj.bu).currency;
      var costs = s.tx.filter(function (t) { return ['PROJECT_COST', 'CROSS_CHARGE', 'OWN_COST'].indexOf(t.kind) !== -1 && t.refs.projectId === x.id && t.billable; });
      var d = x.canBill ? dry(s, 'billProject', { projectId: x.id }) : null;
      var bill = d && d.ok ? d.txs[0] : null;
      var bills = s.tx.filter(function (t) { return (t.kind === 'PROJECT_BILL' || t.kind === 'CUSTOMER_AR') && t.refs.projectId === x.id; });
      return Object.assign({}, x, {
        costLines: costs.map(function (t) { return { id: t.id, number: t.number, kindText: TXK[t.kind] || t.kind, title: t.title, amount: F.money(t.amount, t.currency), billed: t.billed || '', billedText: t.billed ? 'Billed on ' + t.billed : 'To bill' }; }),
        canBillNow: x.canBill && (has(p, 'finance') || has(p, 'receiver-review') || has(p, 'ic-finance')),
        preview: bill ? { cost: F.money(bill.cost, cur), markup: x.markup, bill: F.money(U.r2(bill.cost + bill.margin), cur), margin: F.money(bill.margin, cur),
          vat: F.money(bill.entered.amount - U.r2(bill.cost + bill.margin), cur), total: F.money(bill.entered.amount, cur), tx: txRow(s, bill) } : null,
        error: d && !d.ok ? d.error : '',
        billedNumbers: bills.map(function (t) { return t.number; }).join(', '),
        does: ppm ? 'Bills ' + x.customer + ' through ' + prj.number + '\'s contract in Fusion PPM (OD-07 a): the IC equipment cost plus ' + x.markup + ', invoiced by PPM Billing to Receivables. EquipRite issues no invoice of its own.'
          : 'Invoices ' + x.customer + ' from ProjectCo through EquipRite (OD-07 b): the IC equipment cost plus ' + x.markup + '; the IC cost lines become non-billable on the contract.'
      });
    });
    var invoices = arr(v.invoices).map(function (t) {
      var raw = U.byId(s.tx, t.id) || {};
      var pay = !t.paid ? dry(s, 'customerPays', { txId: t.id }) : null;
      var rc = pay && pay.ok ? pay.txs[0] : null;
      var receipts = s.tx.filter(function (q) { return q.kind === 'CUSTOMER_RECEIPT' && q.refs.invoiceTx === t.id; });
      var row = txRow(s, raw, o.openTx);
      return Object.assign({}, t, {
        expanded: row.expanded, accounting: row, kindWords: raw.kind === 'PROJECT_BILL' ? 'Project invoice (PPM billing)' : 'Customer invoice', canPayNow: !t.paid && canPay,
        totalText: raw.entered ? F.money(raw.entered.amount, raw.entered.currency) : t.total, marginText: t.margin ? 'Margin ' + t.margin + ' on cost ' + F.money(raw.cost, raw.currency) : '',
        payDoes: rc ? 'Records the payment of ' + F.money(rc.total, rc.currency) + ' from ' + t.customer + ' in Fusion Receivables (Dr bank, Cr receivable); the invoice shows paid.' : '',
        payTx: rc ? txRow(s, rc) : null,
        receipts: receipts.map(function (q) { return txRow(s, q, o.openTx); }), receiptText: receipts.length ? 'Paid ' + receipts.map(function (q) { return F.date(q.date) + ' (' + q.number + ')'; }).join(', ') : ''
      });
    });
    var open = invoices.filter(function (t) { return !t.paid; });
    return Object.assign({}, v, {
      me: me, customers: customers, deposits: deposits, projects: projects, invoices: invoices, canInvoice: canInvoice, canDeposit: desk, canPay: canPay,
      s2ModeText: ppm ? 'PPM contract billing (OD-07 a): ProjectCo\'s project contract bills Customer X' : 'EquipRite invoice from ProjectCo (OD-07 b): the IC cost is non-billable on the contract',
      neverBoth: 'Never both: the customer is billed once, either by the project contract or by EquipRite. The mode is the setting “Who bills Customer X” in Setup.',
      kpi: { waiting: arr(v.waiting).length, deposits: deposits.filter(function (d) { return d.needed || d.canSettle; }).length, projects: projects.filter(function (x) { return x.canBill; }).length, open: open.length }
    });
  }

  // ── Checks and failures ─────────────────────────────────────────────────────────────────────────────────────
  /** A page's own check before an action ('' when it may go to the engine). */
  function check(s, req) {
    var r = req || {};
    var x = r.payload || {};
    if (r.type === 'disputeCharge' && !String(x.reason || '').trim()) return 'Give the reason for the dispute: ' + 'the owner sees it and resolves the line.';
    if (r.type === 'resolveDispute' && x.resolution === 'credit') {
      var c = U.byId(s.charges, x.chargeId);
      var amt = Number(x.amount);
      if (c && !(amt > 0 && amt <= Math.abs(c.amount) + 0.001)) return 'Give a credit between ' + F.money(0.01, c.currency) + ' and ' + F.money(Math.abs(c.amount), c.currency) + ' (the disputed amount).';
    }
    return '';
  }
  /** Where a failure is shown: the statement, charge, transaction, project or request it was about. */
  function failure(s, req, text) {
    var r = req || {};
    var x = r.payload || {};
    var ref = x.statementId || '';
    if (!ref && x.chargeId) { var c = U.byId(s.charges, x.chargeId); ref = c && c.statementId ? c.statementId : x.chargeId; }
    ref = ref || x.txId || x.projectId || x.requestId || x.customerId || ({ runCharges: 'run', toMonthEnd: 'run', postInternal: 'internal', setSetting: 'switch' }[r.type]) || r.type || '';
    return { text: String(text || 'That did not go through.'), type: r.type || '', ref: ref, chargeId: x.chargeId || '' };
  }
  var NO_FAILURE = { text: '', type: '', ref: '', chargeId: '' };
  var FORM_KEYS = { disputing: '', reason: '', resolving: '', credit: '' };

  /** The action a form sends: the dispute's reason and the credit's amount come from the page's open form (ui). */
  function withForm(req, ui) {
    var r = Object.assign({}, req || {});
    var u = ui || {};
    r.payload = Object.assign({}, r.payload || {});
    if (r.type === 'disputeCharge' && r.payload.reason == null) r.payload.reason = String(u.reason || '').trim();
    if (r.type === 'resolveDispute' && r.payload.resolution === 'credit' && r.payload.amount == null) r.payload.amount = u.credit === '' || u.credit == null ? NaN : Number(u.credit);
    return r;
  }

  /**
   * What a pick or a typed value changes on a money page: { set: { variable: value }, reload }. Fields: period,
   * runPeriod, txKind (reload the view); exportOpen (toggle the list's menu); dispute / resolve / cancel (open or close
   * a line's form); reason, credit (typed); tx (open or close a transaction's accounting).
   */
  function pick(vars, field, value, s) {
    var o = vars || {};
    var ui = Object.assign({}, o.ui || {});
    var val = value == null ? '' : String(value);
    switch (field) {
      case 'period': return { set: { period: val }, reload: true };
      case 'runPeriod': return { set: { runPeriod: val }, reload: true };
      case 'txKind': ui.txKind = val; return { set: { ui: ui }, reload: true };
      case 'exportOpen': return { set: { exportOpen: o.exportOpen === val ? '' : val } };
      case 'dispute': return { set: { ui: Object.assign(ui, { disputing: ui.disputing === val ? '' : val, reason: '', resolving: '', credit: '' }), failure: NO_FAILURE } };
      case 'resolve': {
        var c = U.byId((s && s.charges) || [], val);
        return { set: { ui: Object.assign(ui, { resolving: ui.resolving === val ? '' : val, credit: c ? String(Math.abs(c.amount)) : '', disputing: '', reason: '' }), failure: NO_FAILURE } };
      }
      case 'cancel': return { set: { ui: Object.assign(ui, FORM_KEYS), failure: NO_FAILURE } };
      case 'reason': case 'credit': ui[field] = val; return { set: { ui: ui } };
      case 'tx': {
        var open = Object.assign({}, ui.openTx || {});
        if (open[val]) delete open[val]; else open[val] = true;
        ui.openTx = open;
        return { set: { ui: ui } };
      }
      default: return { set: {} };
    }
  }

  /** What an action's outcome changes on the page: the failure kept in view (or cleared), the forms closed, the run's result. */
  function afterAct(req, res, s, vars) {
    var r = res || {};
    if (r.cancelled) return { set: {} };
    if (!r.ok) return { set: { failure: failure(s, req, r.error) } };
    var set = { failure: NO_FAILURE, ui: Object.assign({}, (vars && vars.ui) || {}, FORM_KEYS) };
    var x = r.result || {};
    if (req && req.type === 'runCharges') {
      set.lastRun = { done: true, period: x.period, made: x.made, statements: x.statements,
        text: 'Charge run ' + F.period(x.period) + ' done: ' + plural(x.made || 0, 'new charge line') + (x.changed ? ', ' + x.changed + ' updated' : '') + ', '
          + plural(x.statements || 0, 'statement') + ' made or topped up.' + (x.made ? '' : ' Nothing new: the month was already charged.') };
    }
    return { set: set };
  }

  // ── Exports: every list ─────────────────────────────────────────────────────────────────────────────────────
  var COLS = {
    statements: [{ key: 'number', label: 'Statement' }, { key: 'periodText', label: 'Period' }, { key: 'provider', label: 'Owner company' }, { key: 'providerBu', label: 'Owner BU' },
      { key: 'receiver', label: 'User company' }, { key: 'receiverBu', label: 'User BU' }, { key: 'relationLabel', label: 'Relationship' }, { key: 'statusText', label: 'Status' },
      { key: 'dueText', label: 'Due' }, { key: 'total', label: 'Total', type: 'number' }, { key: 'currency', label: 'Currency' }, { key: 'lineCount', label: 'Lines', type: 'number' },
      { key: 'disputed', label: 'Disputed', type: 'number' }, { key: 'pairNumber', label: 'Invoice pair' }],
    lines: [{ key: 'statement', label: 'Statement' }, { key: 'pair', label: 'Pair' }, { key: 'id', label: 'Charge' }, { key: 'what', label: 'Kind' }, { key: 'detail', label: 'Detail' },
      { key: 'serial', label: 'Unit' }, { key: 'requestNumber', label: 'Request' }, { key: 'project', label: 'Project' }, { key: 'task', label: 'Task' }, { key: 'qty', label: 'Quantity', type: 'number' },
      { key: 'uom', label: 'Unit of measure' }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'currency', label: 'Currency' }, { key: 'statusText', label: 'Status' },
      { key: 'disputeText', label: 'Dispute' }, { key: 'arNumber', label: 'AR / AP number' }],
    waiting: [{ key: 'id', label: 'Charge' }, { key: 'periodText', label: 'Period' }, { key: 'relationLabel', label: 'Relationship' }, { key: 'kindText', label: 'Kind' }, { key: 'text', label: 'Detail' },
      { key: 'serial', label: 'Unit' }, { key: 'requestNumber', label: 'Request' }, { key: 'provider', label: 'Owner' }, { key: 'receiver', label: 'User or customer' }, { key: 'project', label: 'Project' },
      { key: 'task', label: 'Task' }, { key: 'qty', label: 'Quantity', type: 'number' }, { key: 'uom', label: 'Unit of measure' }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'currency', label: 'Currency' }],
    pairs: [{ key: 'number', label: 'Statement' }, { key: 'periodText', label: 'Period' }, { key: 'pairText', label: 'Pair' }, { key: 'relationLabel', label: 'Relationship' }, { key: 'statusText', label: 'Status' },
      { key: 'total', label: 'Total', type: 'number' }, { key: 'currency', label: 'Currency' }, { key: 'pairNumber', label: 'Invoice pair' }, { key: 'errorText', label: 'Error' }, { key: 'cutoffText', label: 'Cut-off' }],
    waitingUser: [{ key: 'number', label: 'Statement' }, { key: 'periodText', label: 'Period' }, { key: 'pairText', label: 'Pair' }, { key: 'statusText', label: 'Status' }, { key: 'whoText', label: 'Who acts' },
      { key: 'dueBy', label: 'Due' }, { key: 'total', label: 'Total', type: 'number' }, { key: 'currency', label: 'Currency' }, { key: 'accruedText', label: 'Accrued' }],
    recon: [{ key: 'number', label: 'Statement' }, { key: 'pair', label: 'Invoice pair' }, { key: 'charges', label: 'EquipRite charges' }, { key: 'ar', label: 'AR (owner)' }, { key: 'ap', label: 'AP (user)' },
      { key: 'diffText', label: 'Check' }],
    txLines: [{ key: 'number', label: 'Transaction' }, { key: 'kindText', label: 'Kind' }, { key: 'company', label: 'Company' }, { key: 'dateText', label: 'Date' }, { key: 'title', label: 'What' },
      { key: 'account', label: 'Account' }, { key: 'name', label: 'Account name' }, { key: 'dr', label: 'Debit', type: 'number' }, { key: 'cr', label: 'Credit', type: 'number' }, { key: 'currency', label: 'Currency' },
      { key: 'source', label: 'Fusion' }],
    invoices: [{ key: 'number', label: 'Invoice' }, { key: 'kindWords', label: 'Kind' }, { key: 'company', label: 'Company' }, { key: 'customer', label: 'Customer' }, { key: 'date', label: 'Date' },
      { key: 'totalText', label: 'Total' }, { key: 'openText', label: 'Open' }, { key: 'margin', label: 'Margin' }],
    deposits: [{ key: 'number', label: 'Request' }, { key: 'customer', label: 'Customer' }, { key: 'deposit', label: 'Deposit' }, { key: 'statusText', label: 'Status' }],
    projects: [{ key: 'number', label: 'Project' }, { key: 'name', label: 'Name' }, { key: 'customer', label: 'Customer' }, { key: 'cost', label: 'Billable equipment cost' }, { key: 'markup', label: 'Mark-up' },
      { key: 'toBillText', label: 'To bill (cost + mark-up)' }, { key: 'billedNumbers', label: 'Billed on' }]
  };
  function txLineRows(txs) {
    var out = [];
    arr(txs).forEach(function (t) {
      if (!t.lines.length) out.push({ number: t.number, kindText: t.kindText, company: t.company, dateText: t.dateText, title: t.title, account: '', name: t.note, dr: '', cr: '', currency: t.currency, source: t.source });
      t.lines.forEach(function (l) { out.push({ number: t.number, kindText: t.kindText, company: t.company, dateText: t.dateText, title: t.title, account: l.account, name: l.name, dr: l.dr || '', cr: l.cr || '', currency: t.currency, source: t.source }); });
    });
    return out;
  }
  var LISTS = {
    charges: {
      statements: { title: 'Intercompany statements', rows: function (v) { return v.statements; }, cols: 'statements' },
      lines: { title: 'Statement lines', rows: function (v) { return v.allLines; }, cols: 'lines' },
      waiting: { title: 'Charges waiting elsewhere (customer and same company)', rows: function (v) { return arr(v.waitingCustomer).concat(arr(v.waitingInternal)); }, cols: 'waiting' }
    },
    workbench: {
      create: { title: 'Invoice pairs to create', rows: function (v) { return v.toCreate; }, cols: 'pairs' },
      settle: { title: 'Invoiced statements to settle', rows: function (v) { return v.toSettle; }, cols: 'pairs' },
      internal: { title: 'Internal postings waiting (cross-charge, own equipment)', rows: function (v) { return v.internal; }, cols: 'waiting' },
      waitingUser: { title: 'Statements waiting on users', rows: function (v) { return v.waitingUser; }, cols: 'waitingUser' },
      recon: { title: 'Reconciliation: charges, AR, AP', rows: function (v) { return v.recon; }, cols: 'recon' },
      txs: { title: 'Transactions created, with their accounting (shown, not posted)', rows: function (v) { return txLineRows(v.txs); }, cols: 'txLines' }
    },
    billing: {
      waiting: { title: 'Customer charges to invoice (scenario 3)', rows: function (v) { return v.waiting; }, cols: 'waiting' },
      deposits: { title: 'Customer deposits', rows: function (v) { return v.deposits; }, cols: 'deposits' },
      projects: { title: 'Customer projects to bill (scenario 2)', rows: function (v) { return v.projects; }, cols: 'projects' },
      invoices: { title: 'Customer invoices', rows: function (v) { return v.invoices; }, cols: 'invoices' }
    }
  };
  /** What exportKit.run takes for one list of a screen: { name, title, subtitle, rows, columns }. */
  function exportSpec(page, list, v) {
    var l = (LISTS[page] || {})[list];
    if (!l) return { name: page, title: page, rows: [], columns: [] };
    var me = (v && v.me) || {};
    return { name: 'equiprite-future-' + page + '-' + list, title: l.title, subtitle: [me.name ? 'As ' + me.name : '', v && v.filterText ? v.filterText : '', me.todayText ? 'Demo date ' + me.todayText : ''].filter(Boolean).join(' · '),
      rows: arr(l.rows(v || {})), columns: COLS[l.cols] };
  }
  function exportCount(page, list, v) { var l = (LISTS[page] || {})[list]; return l ? arr(l.rows(v || {})).length : 0; }

  return { charges: charges, workbench: workbench, billing: billing, dry: dry, txRow: txRow, pairPreview: pairPreview, settlePreview: settlePreview, runPanel: runPanel,
    check: check, failure: failure, NO_FAILURE: NO_FAILURE, withForm: withForm, pick: pick, afterAct: afterAct, exportSpec: exportSpec, exportCount: exportCount, LISTS: LISTS, COLS: COLS, TX_GROUPS: TX_GROUPS };
});
