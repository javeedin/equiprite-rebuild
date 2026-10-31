define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine', 'resources/js/future/fxViews'], function (Seed, E, V) {
  'use strict';

  /**
   * EquipRite Future · Finance (flows/finance): what Accounting (shown) and Reports show, from the store's state for
   * the person played. Pure functions over fxViews.ledger / consolidation / reports / workbench, with what those views
   * leave out: the company switch limited to the persona's companies (Group for IC finance and Admin), each journal
   * entry's request, statement and project, the entered currency and rate, the trial balance's check, the group's
   * eliminations side by side with their exchange differences explained, and the reports scoped by company
   * (MC-BR-12) with their currencies. EquipRite never creates accounting: each company's Fusion does; this is shown.
   */
  var U = E.util;
  var L = E.lookups;
  var F = V.fmt;
  var GROUP = 'GROUP';

  // The intercompany accounts that eliminate in the group (as fxViews.consolidation), with the words for each side.
  var PAIRS = [
    { key: 'icbal', label: 'Intercompany receivable ↔ payable', a: ['1210'], b: ['2110'],
      sideA: 'Intercompany receivable · 1210 (the owner)', sideB: 'Intercompany payable · 2110 (the user)' },
    { key: 'accrual', label: 'Unbilled IC receivable ↔ accrued IC payable', a: ['1220'], b: ['2120'],
      sideA: 'Unbilled IC receivable · 1220 (the owner)', sideB: 'Accrued IC payable · 2120 (the user)' },
    { key: 'pl', label: 'IC revenue ↔ IC project cost', a: ['4110', '4120', '4130'], b: ['5100', '5110', '5120', '5130'],
      sideA: 'IC revenue · 4110, 4120, 4130 (the owner)', sideB: 'IC project cost · 5100–5130 (the user)' }
  ];
  var IC_ACCOUNTS = PAIRS.reduce(function (a, p) { return a.concat(p.a, p.b); }, []);

  // A journal entry's tone (fx-chip--<tone>) by kind.
  var TONE = {
    IC_AR: 'ic', IC_AP: 'ic', PROJECT_COST: 'ic', ACCRUAL: 'todo', ACCRUAL_REVERSAL: 'todo', NETTING: 'run', CROSS_CHARGE: 'info', OWN_COST: 'neutral',
    CUSTOMER_AR: 'cust', PROJECT_BILL: 'cust', CUSTOMER_RECEIPT: 'cust', DEPOSIT: 'cust', DEPOSIT_SETTLE: 'cust',
    TO_SHIP: 'neutral', TO_RECEIPT: 'neutral', TO_RETURN: 'neutral', ASSET_CUSTODY: 'neutral', ASSET_RETIRE: 'bad', STOCK_ISSUE: 'bad'
  };

  function unique(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function r2(x) { return U.r2(x); }
  function rate4(x) { return (Math.round((Number(x) || 0) * 10000) / 10000).toFixed(4); }
  function abs(x) { return Math.abs(Number(x) || 0); }
  function isAdmin(p) { return p.roles.indexOf('admin') !== -1; }
  function wholeGroup(p) { return isAdmin(p) || p.roles.indexOf('ic-finance') !== -1; }

  /** The companies (legal entities) of the persona's business units, in the group's order (Admin: all). */
  function myCompanies(s) {
    var p = E.persona(s);
    var les = isAdmin(p) ? s.companies.map(function (c) { return c.id; }) : unique(p.bus.map(function (b) { return (L.bu(s, b) || {}).le; }));
    return s.companies.filter(function (c) { return les.indexOf(c.id) !== -1; });
  }
  /** The reports' scope: the whole group for IC finance and Admin, else the persona's companies (MC-BR-12). */
  function scope(s) {
    var p = E.persona(s);
    var all = wholeGroup(p);
    var les = all ? s.companies.map(function (c) { return c.id; }) : myCompanies(s).map(function (c) { return c.id; });
    return { all: all, les: les, has: function (le) { return les.indexOf(le) !== -1; },
      text: all ? 'The whole group (' + s.companies.map(function (c) { return c.short; }).join(', ') + ')' : les.map(function (le) { return L.leShort(s, le); }).join(', ') + ': the companies of your business units' };
  }

  /** The company switch: the persona's companies, and Group for IC finance and Admin. */
  function options(s, pick) {
    var p = E.persona(s);
    var out = myCompanies(s).map(function (c) { return { id: c.id, short: c.short, currency: c.currency, label: c.short, sub: c.currency, group: false }; });
    if (wholeGroup(p)) out.push({ id: GROUP, short: 'Group', currency: s.settings.groupCurrency, label: 'Group', sub: s.settings.groupCurrency + ' · consolidated', group: true });
    var cur = out.some(function (o) { return o.id === pick; }) ? pick : (out[0] ? out[0].id : '');
    out.forEach(function (o) { o.on = o.id === cur; });
    return { list: out, current: cur, groupAllowed: wholeGroup(p) };
  }

  // ── The links of a transaction: its requests, statement, projects ─────────────────────────────────────────────
  function chargeIdsOf(s, t) {
    var rf = t.refs || {};
    var ids = (rf.chargeIds || []).slice();
    (rf.costTxs || []).forEach(function (id) { var c = U.byId(s.tx, id); if (c) ids = ids.concat((c.refs || {}).chargeIds || []); });
    if (rf.invoiceTx) {
      var inv = U.byId(s.tx, rf.invoiceTx);
      if (inv) {
        ids = ids.concat((inv.refs || {}).chargeIds || []);
        ((inv.refs || {}).costTxs || []).forEach(function (id) { var c = U.byId(s.tx, id); if (c) ids = ids.concat((c.refs || {}).chargeIds || []); });
      }
    }
    if (!ids.length && rf.statementId) ids = s.charges.filter(function (c) { return c.statementId === rf.statementId; }).map(function (c) { return c.id; });
    return unique(ids);
  }
  function links(s, t, statementNav) {
    var p = E.persona(s);
    var rf = t.refs || {};
    var charges = chargeIdsOf(s, t).map(function (id) { return U.byId(s.charges, id); }).filter(Boolean);
    var reqIds = unique([rf.requestId].concat(charges.map(function (c) { return c.requestId; })));
    var requests = reqIds.map(function (id) { return L.request(s, id); }).filter(Boolean).map(function (r) {
      var visible = L.inBu(p, r.requestingBu) || r.lines.some(function (l) { return L.inBu(p, l.provider); });
      return { id: r.id, number: r.number, visible: visible };
    });
    var st = rf.statementId ? U.byId(s.statements, rf.statementId) : null;
    var prjIds = unique([rf.projectId].concat(charges.map(function (c) { return c.projectId; })));
    var projects = prjIds.map(function (id) { return L.project(s, id); }).filter(Boolean).map(function (x) { return { id: x.id, number: x.number, name: x.name, label: x.number + ' · ' + x.name }; });
    var cust = rf.customerId ? L.customer(s, rf.customerId) : null;
    var unit = rf.unitId ? L.unit(s, rf.unitId) : null;
    return {
      requests: requests, statement: st ? { id: st.id, number: st.number, nav: statementNav || 'charges' } : null, projects: projects,
      customer: cust ? cust.name : '', unit: unit ? unit.serial : '', any: !!(requests.length || st || projects.length || cust || unit)
    };
  }

  /** In which currency it was entered and at which rate it was booked (words). */
  function enteredText(s, t) {
    var st = (t.refs || {}).statementId ? U.byId(s.statements, t.refs.statementId) : null;
    if (t.kind === 'ACCRUAL_REVERSAL') return 'Reverses the accrual line for line, in ' + t.currency + ' (the same amounts, the next day).';
    var from = t.entered ? t.entered.currency : (st ? st.currency : t.currency);
    if (from && from !== t.currency) {
      var rt = t.rate || E.rate(s, from, t.currency, t.date);
      return (t.entered ? 'Entered ' + F.money(t.entered.amount, from) : 'Agreed in ' + from) + ', booked in ' + t.currency + ' at 1 ' + from + ' = ' + rate4(rt) + ' ' + t.currency
        + ' (' + F.date(t.date) + ')';
    }
    if (t.entered) return 'Entered and booked in ' + t.currency + ', the ledger currency (rate 1)';
    return 'In ' + t.currency + ', the ledger currency';
  }
  function statusText(t) {
    if (t.kind === 'CUSTOMER_AR' || t.kind === 'PROJECT_BILL') return t.open > 0 ? 'Open ' + F.money(t.open, t.currency) : 'Paid';
    return { CREATED: 'Created', SETTLED: 'Settled' }[t.status] || t.status || '';
  }

  /** One journal entry as the journal shows it. */
  function entry(s, t, tv, statementNav) {
    var lk = links(s, t, statementNav);
    var dr = U.sum(t.lines, function (l) { return l.dr; });
    var cr = U.sum(t.lines, function (l) { return l.cr; });
    return {
      id: t.id, number: t.number, kind: t.kind, kindText: tv.kindText, tone: TONE[t.kind] || 'na', date: F.date(t.date), dateIso: t.date, title: t.title, source: t.source || '',
      status: t.status, statusText: statusText(t), currency: t.currency, enteredText: enteredText(s, t),
      lines: t.lines.map(function (l) { return { account: l.account, name: l.name, dr: l.dr ? F.num(l.dr) : '', cr: l.cr ? F.num(l.cr) : '', memo: l.memo || '' }; }),
      drText: F.num(dr), crText: F.num(cr), balanced: r2(dr - cr) === 0, totalText: t.lines.length ? F.money(dr, t.currency) : (t.amount ? F.money(t.amount, t.currency) : ''),
      noAccounting: !t.lines.length, note: t.note || (t.lines.length ? '' : 'No accounting of its own.'),
      items: (t.items || []).map(function (i) { return { text: i.expType + (i.task ? ' · ' + i.task : ''), amount: F.money(i.amount, t.currency) }; }),
      requests: lk.requests, statement: lk.statement, projects: lk.projects, customer: lk.customer, unit: lk.unit, hasLinks: lk.any
    };
  }

  // ── Accounting (shown): one company ───────────────────────────────────────────────────────────────────────────
  function ledger(s, leId, kind, statementNav) {
    var lg = V.ledger(s, leId);
    var raw = {};
    s.tx.forEach(function (t) { if (t.le === leId) raw[t.id] = t; });
    var counts = {};
    var labels = {};
    lg.txs.forEach(function (t) { counts[t.kind] = (counts[t.kind] || 0) + 1; labels[t.kind] = t.kindText; });
    var kinds = [{ key: '', label: 'All', count: lg.txs.length }].concat(Object.keys(counts).sort(function (a, b) { return labels[a].localeCompare(labels[b]); })
      .map(function (k) { return { key: k, label: labels[k], count: counts[k] }; }));
    var k = counts[kind] ? kind : '';
    kinds.forEach(function (x) { x.on = x.key === k; });
    var txs = lg.txs.filter(function (t) { return !k || t.kind === k; }).map(function (t) { return entry(s, raw[t.id], t, statementNav); });
    // The trial balance: each account's net balance on its side (Dr or Cr), what moved, and the check.
    var drBal = 0;
    var crBal = 0;
    var trial = lg.trial.map(function (x) {
      if (x.bal > 0) drBal = r2(drBal + x.bal); else crBal = r2(crBal - x.bal);
      var moved = 'moved ' + [x.dr !== '0.00' ? 'Dr ' + x.dr : '', x.cr !== '0.00' ? 'Cr ' + x.cr : ''].filter(Boolean).join(' · ');
      return { account: x.account, name: x.name, dr: x.bal > 0 ? F.num(x.bal) : '', cr: x.bal < 0 ? F.num(-x.bal) : '', zero: x.bal === 0, moved: moved };
    });
    var cur = lg.currency;
    var balanced = lg.balanced && r2(drBal - crBal) === 0;
    var ic = s.tx.filter(function (t) { return t.le === leId; }).reduce(function (a, t) {
      t.lines.forEach(function (l) { if (['1210', '1220'].indexOf(l.account) !== -1) a.rec = r2(a.rec + l.dr - l.cr); if (['2110', '2120'].indexOf(l.account) !== -1) a.pay = r2(a.pay + l.cr - l.dr); });
      return a;
    }, { rec: 0, pay: 0 });
    return {
      le: leId, company: lg.company, name: lg.name, currency: cur, country: lg.country, count: lg.count, shown: txs.length, kind: k, kindLabel: k ? labels[k] : '',
      kinds: kinds, txs: txs, withAccounting: lg.txs.filter(function (t) { return !t.noAccounting; }).length, trial: trial, accounts: trial.length,
      drTotal: F.money(drBal, cur), crTotal: F.money(crBal, cur), moved: F.money(Number(String(lg.dr).replace(/,/g, '')) || 0, cur), balanced: balanced,
      balancedText: balanced ? 'Balanced: debits ' + F.money(drBal, cur) + ' = credits ' + F.money(crBal, cur) : 'Out of balance by ' + F.money(r2(drBal - crBal), cur),
      icReceivable: F.money(ic.rec, cur), icPayable: F.money(ic.pay, cur),
      empty: !lg.count, emptyText: lg.company + '’s Fusion has nothing from EquipRite yet: transactions come with the requests (shipping, invoices, accruals, netting).'
    };
  }

  // ── Accounting (shown): the group ─────────────────────────────────────────────────────────────────────────────
  function group(s) {
    var g = s.settings.groupCurrency;
    var drift = (s.fx && s.fx.drift) || 0;
    var acc = {};      // account → le → { local, group }
    var foreign = {};  // account → [entries in a currency other than the group's]
    var rates = {};    // le → [rates used]
    s.tx.forEach(function (t) {
      var fx = E.rate(s, t.currency, g, t.date);
      if (t.currency !== g && t.lines.length) (rates[t.le] = rates[t.le] || []).push(fx);
      t.lines.forEach(function (l) {
        var a = acc[l.account] = acc[l.account] || {};
        var x = a[t.le] = a[t.le] || { local: 0, group: 0 };
        x.local = r2(x.local + l.dr - l.cr);
        x.group = r2(x.group + (l.dr - l.cr) * fx);
        if (t.currency !== g && IC_ACCOUNTS.indexOf(l.account) !== -1) {
          (foreign[l.account] = foreign[l.account] || []).push({ company: L.leShort(s, t.le), number: t.number, date: F.date(t.date), account: l.account,
            local: F.money(l.dr - l.cr, t.currency), rate: '1 ' + g + ' = ' + rate4(1 / fx) + ' ' + t.currency, groupAmt: r2((l.dr - l.cr) * fx), group: F.money(r2((l.dr - l.cr) * fx), g) });
        }
      });
    });
    function side(accounts) {
      var rows = s.companies.map(function (c) {
        var local = 0;
        var grp = 0;
        var moved = false;
        accounts.forEach(function (k) { var x = (acc[k] || {})[c.id]; if (x) { moved = true; local = r2(local + x.local); grp = r2(grp + x.group); } });
        return { le: c.id, company: c.short, currency: c.currency, localAmt: local, groupAmt: grp, local: F.money(local, c.currency), group: F.money(grp, g), zero: local === 0 && grp === 0, moved: moved,
          note: local === 0 && grp === 0 ? 'nil now' : '' };
      }).filter(function (x) { return x.moved; });
      var total = r2(rows.reduce(function (a, x) { return a + x.groupAmt; }, 0));
      return { rows: rows, total: total, totalText: F.money(total, g), empty: !rows.length, nil: rows.every(function (x) { return x.zero; }) };
    }
    var elims = PAIRS.map(function (p) {
      var a = side(p.a);
      var b = side(p.b);
      var diff = r2(a.total + b.total);
      var fl = p.a.concat(p.b).reduce(function (x, k) { return x.concat(foreign[k] || []); }, []);
      var bound = r2(fl.reduce(function (x, e) { return x + abs(e.groupAmt); }, 0) * 2 * drift + 0.01 * fl.length);
      var state = diff === 0 ? 'zero' : (fl.length && abs(diff) <= bound ? 'fx' : 'bad');
      var cos = unique(fl.map(function (e) { return e.company; }));
      var moved = p.a.concat(p.b).some(function (k) { return !!acc[k]; });
      var why = state === 'zero' ? (a.nil && b.nil ? (moved ? 'Both sides are nil now: invoiced, reversed or settled in both ledgers.' : 'Nothing to eliminate yet.') : 'Both sides eliminate to the cent.')
        : state === 'fx' ? 'An exchange difference, not a mismatch: ' + cos.join(' and ') + '’s entries are in ' + unique(fl.map(function (e) { return e.local.split(' ')[0]; })).join(', ')
          + ' and each is translated to ' + g + ' at its own date’s rate (the rate moved ' + (Math.round(drift * 2 * 10000) / 100) + ' % at most between the dates). In a real consolidation it goes to the FX reserve.'
          : 'Not explained by exchange rates: the two companies’ documents do not match. Check the invoice pair in the Intercompany workbench.';
      return {
        key: p.key, label: p.label, sideA: p.sideA, sideB: p.sideB, a: a, b: b, diff: diff, diffText: F.money(diff, g), state: state, ok: state !== 'bad',
        stateText: state === 'zero' ? 'Eliminates' : state === 'fx' ? 'Exchange difference only' : 'Does not eliminate', tone: state === 'bad' ? 'bad' : (state === 'fx' ? 'todo' : 'ok'),
        why: why, foreign: fl, hasForeign: fl.length > 0, eliminated: F.money(Math.min(abs(a.total), abs(b.total)), g)
      };
    });
    var fxTotal = r2(elims.reduce(function (x, e) { return x + e.diff; }, 0));
    var after = Object.keys(acc).filter(function (k) { return IC_ACCOUNTS.indexOf(k) === -1; }).sort().map(function (k) {
      var amt = r2(Object.keys(acc[k]).reduce(function (x, le) { return x + acc[k][le].group; }, 0));
      var by = Object.keys(acc[k]).filter(function (le) { return acc[k][le].local !== 0; }).map(function (le) { return L.leShort(s, le); });
      return { account: k, name: Seed.ACCOUNTS[k], amount: amt, dr: amt > 0 ? F.num(amt) : '', cr: amt < 0 ? F.num(-amt) : '', companies: by.join(', ') };
    }).filter(function (x) { return x.amount !== 0; });
    if (fxTotal !== 0) after.push({ account: '', name: 'Exchange differences on elimination (to the FX reserve)', amount: fxTotal, dr: fxTotal > 0 ? F.num(fxTotal) : '', cr: fxTotal < 0 ? F.num(-fxTotal) : '', companies: 'Group', fx: true });
    var drSum = r2(after.reduce(function (x, a) { return x + (a.amount > 0 ? a.amount : 0); }, 0));
    var crSum = r2(after.reduce(function (x, a) { return x + (a.amount < 0 ? -a.amount : 0); }, 0));
    var off = r2(drSum - crSum);
    var companies = s.companies.map(function (c) {
      var lg = V.ledger(s, c.id);
      var rs = rates[c.id] || [];
      var lo = rs.length ? Math.min.apply(null, rs) : 1;
      var hi = rs.length ? Math.max.apply(null, rs) : 1;
      return { le: c.id, company: c.short, name: c.name, currency: c.currency, count: lg.count, balanced: lg.balanced,
        translation: c.currency === g ? 'In ' + g + ': no translation' : 'Each entry at its date’s rate: 1 ' + c.currency + ' = ' + rate4(lo) + (hi !== lo ? '–' + rate4(hi) : '') + ' ' + g };
    });
    return {
      currency: g, eliminations: elims, after: after, drTotal: F.money(drSum, g), crTotal: F.money(crSum, g), off: off,
      afterBalanced: abs(off) < 0.05, afterText: abs(off) === 0 ? 'Balanced after elimination: debits = credits = ' + F.money(drSum, g)
        : (abs(off) < 0.05 ? 'Balanced after elimination, but for ' + F.money(off, g) + ' of rounding in the translation' : 'Out of balance by ' + F.money(off, g)),
      fxTotal: fxTotal, fxText: F.money(fxTotal, g), companies: companies, ok: elims.every(function (e) { return e.ok; }),
      okCount: elims.filter(function (e) { return e.ok; }).length, note: 'Each company’s ledger translated to ' + g + ' at each transaction’s date (example rates, AED–SAR peg with a small daily drift).'
    };
  }

  /** Accounting (shown): the switch, then the company's journal and trial balance, or the group's consolidation. */
  function accounting(s, o) {
    var q = o || {};
    var opts = options(s, q.le);
    var p = E.persona(s);
    var out = { companies: opts.list, current: opts.current, groupAllowed: opts.groupAllowed, isGroup: opts.current === GROUP, none: !opts.list.length,
      noneText: p.name + ' has no company here: Accounting (shown) shows the companies of your business units.',
      banner: 'Each company\'s Fusion makes these entries from the transactions EquipRite creates. Shown here, never posted.', ledger: null, group: null };
    if (out.none) return Object.assign(out, { ledger: emptyLedger(), group: emptyGroup(), subtitle: '' });
    if (out.isGroup) {
      out.group = group(s);
      out.ledger = emptyLedger();
      out.subtitle = 'The group in ' + out.group.currency + ': the three companies\' ledgers translated, the intercompany balances eliminated, and what remains.';
    } else {
      out.ledger = ledger(s, opts.current, q.kind || '', q.statementNav);
      out.group = emptyGroup();
      out.subtitle = out.ledger.name + ' · ' + out.ledger.country + ' · ledger in ' + out.ledger.currency + ' · '
        + out.ledger.count + (out.ledger.count === 1 ? ' transaction' : ' transactions') + ' from EquipRite';
    }
    return out;
  }
  function emptyLedger() { return { le: '', company: '', name: '', currency: '', count: 0, shown: 0, kinds: [], txs: [], trial: [], balanced: true, balancedText: '', empty: true, emptyText: '' }; }
  function emptyGroup() { return { currency: '', eliminations: [], after: [], companies: [], ok: true, okCount: 0, fxText: '', afterText: '' }; }

  // ── Reports (MC-FR-32) ────────────────────────────────────────────────────────────────────────────────────────
  function daysTone(left) { return left < 0 ? 'bad' : left <= 14 ? 'bad' : left <= 30 ? 'todo' : 'ok'; }
  function daysText(left) { return left < 0 ? 'expired ' + (-left) + (left === -1 ? ' day ago' : ' days ago') : left === 0 ? 'today' : left + (left === 1 ? ' day left' : ' days left'); }

  function reports(s) {
    var p = E.persona(s);
    var sc = scope(s);
    var g = s.settings.groupCurrency;
    var view = V.reports(s);

    // Utilisation by owner company and the country the units are in now (the whole group's fleet).
    var util = {};
    s.units.forEach(function (u) {
      var k = L.leOf(s, u.owner).short + '|' + u.country;
      var x = util[k] = util[k] || { owner: L.leOf(s, u.owner).short, country: (L.country(s, u.country) || {}).name || u.country, code: u.country, units: 0, out: 0, yard: 0, repair: 0, lost: 0, outList: [] };
      x.units++;
      if (u.status === 'OUT') { x.out++; x.outList.push(u.serial); } else if (u.status === 'AVAILABLE') x.yard++; else if (u.status === 'LOST') x.lost++; else x.repair++;
    });
    var utilisation = Object.keys(util).sort().map(function (k) {
      var x = util[k];
      var pct = x.units ? Math.round(x.out / x.units * 100) : 0;
      return Object.assign(x, { key: x.owner + ' · ' + x.country, pct: pct, pctText: pct + ' %', text: x.out + ' of ' + x.units + ' out' + (x.outList.length ? ': ' + x.outList.join(', ') : ''),
        rest: [x.yard ? x.yard + ' in the yard' : '', x.repair ? x.repair + ' in inspection or repair' : '', x.lost ? x.lost + ' lost' : ''].filter(Boolean).join(' · '), outList: x.outList.join(', ') });
    });
    var outAll = s.units.filter(function (u) { return u.status === 'OUT'; }).length;

    // Intercompany charges by pair and month: charged, invoiced, open (and accrued).
    var pairs = {};
    s.charges.filter(function (c) { return c.relation.indexOf('IC_') === 0 && (sc.has(c.providerLe) || sc.has(c.receiverLe)); }).forEach(function (c) {
      var k = c.providerLe + '>' + c.receiverLe + '|' + c.period;
      var x = pairs[k] = pairs[k] || { provider: L.leShort(s, c.providerLe), receiver: L.leShort(s, c.receiverLe), period: c.period, currency: c.currency, relation: c.relation, charged: 0, invoiced: 0, statements: [] };
      x.charged = r2(x.charged + c.amount);
      if (c.arNumber) x.invoiced = r2(x.invoiced + c.amount);
      if (c.statementId && x.statements.indexOf(c.statementId) === -1) x.statements.push(c.statementId);
    });
    var icByPair = Object.keys(pairs).sort().map(function (k) {
      var x = pairs[k];
      var open = r2(x.charged - x.invoiced);
      var sts = x.statements.map(function (id) { return U.byId(s.statements, id); }).filter(Boolean);
      var accrued = sts.filter(function (st) { return st.accrued && !st.accrued.reversed; });
      return { pair: x.provider + ' → ' + x.receiver, provider: x.provider, receiver: x.receiver, period: x.period, periodText: F.period(x.period), currency: x.currency,
        charged: x.charged, invoiced: x.invoiced, open: open, chargedText: F.money(x.charged, x.currency), invoicedText: F.money(x.invoiced, x.currency), openText: F.money(open, x.currency),
        relation: (V.REL[x.relation] || {}).label || '', tone: (V.REL[x.relation] || {}).tone || 'ic',
        state: open === 0 ? 'Invoiced in full' : x.invoiced ? 'Invoiced in part' : 'Not invoiced yet', stateTone: open === 0 ? 'ok' : 'todo',
        statements: sts.map(function (st) { return st.number; }).join(', ') || 'no statement yet', accrued: accrued.length ? 'accrued ' + accrued.map(function (st) { return F.money(st.accrued.amount, st.currency); }).join(', ') : '' };
    });
    var icCharged = U.sum(icByPair, function (x) { return x.charged * E.rate(s, x.currency, g, s.today); });
    var icOpen = U.sum(icByPair, function (x) { return x.open * E.rate(s, x.currency, g, s.today); });

    // Reconciliation: charges = AR = AP for every invoice pair (fxViews.workbench recon), in scope.
    var stByNumber = {};
    s.statements.forEach(function (st) { stByNumber[st.number] = st; });
    var recon = V.workbench(s).recon.filter(function (x) { var st = stByNumber[x.number]; return st && (sc.has(st.providerLe) || sc.has(st.receiverLe)); }).map(function (x) {
      var st = stByNumber[x.number];
      var ap = String(x.ap).split(' (booked ');
      return Object.assign({}, x, { pairText: L.leShort(s, st.providerLe) + ' → ' + L.leShort(s, st.receiverLe), period: F.period(st.period), diffText: F.money(x.diff, st.currency), tone: x.ok ? 'ok' : 'bad',
        stateText: x.ok ? 'Reconciled' : 'Difference', apMain: ap[0], apBooked: ap[1] ? 'booked ' + ap[1].replace(/\)$/, '') + ' in ' + L.leShort(s, st.receiverLe) : 'booked as entered' });
    });

    // Margins by request: the user's cost, the customer's revenue, the user's margin and the group's.
    var margins = s.requests.filter(function (r) { return sc.has(r.requestingLe) || r.lines.some(function (l) { return sc.has(l.providerLe); }); }).map(function (r) { return margin(s, r, g); })
      .filter(function (x) { return x.any; });

    // The fleet by country, with customs: the persona's companies' units, and the units on hire to them.
    var inUse = {};
    s.requests.forEach(function (r) { r.lines.forEach(function (l) { if (l.unitId && ['SHIPPED', 'ON_HIRE', 'OFF_HIRED'].indexOf(l.status) !== -1) inUse[l.unitId] = r; }); });
    var units = s.units.filter(function (u) { return sc.has(L.leOf(s, u.owner).id) || (inUse[u.id] && sc.has(inUse[u.id].requestingLe)); });
    var countries = {};
    units.forEach(function (u) {
      var c = countries[u.country] = countries[u.country] || { code: u.country, country: (L.country(s, u.country) || {}).name || u.country, units: [] };
      var cu = s.customs.filter(function (x) { return x.unitId === u.id && x.status !== 'CLOSED'; })[0];
      var left = cu && cu.status === 'OPEN' ? U.diffDays(cu.reexportBy, s.today) : null;
      var r = inUse[u.id];
      c.units.push({ serial: u.serial, name: u.name, owner: L.leOf(s, u.owner).short, hold: u.hold === 'STOCK' ? 'Stock' : 'Asset',
        status: { AVAILABLE: 'In the yard', OUT: 'Out', INSPECTION: 'To inspect', IN_REPAIR: 'In repair', LOST: 'Lost' }[u.status] || u.status,
        where: u.custody.label || (U.byId(s.orgs, u.custody.org) || {}).name || '', request: r ? { id: r.id, number: r.number } : null,
        customs: cu ? cu.permit + ' · re-export by ' + F.date(cu.reexportBy) : '', customsLeft: left === null ? '' : daysText(left), customsTone: left === null ? 'na' : daysTone(left) });
    });
    var fleet = Object.keys(countries).sort().map(function (k) { var c = countries[k]; return Object.assign(c, { count: c.units.length, countText: c.units.length + (c.units.length === 1 ? ' unit' : ' units') }); });
    var customs = s.customs.filter(function (c) { var r = L.request(s, c.requestId); return sc.has(L.leOf(s, c.owner).id) || (r && sc.has(r.requestingLe)); }).map(function (c) {
      var left = c.status === 'OPEN' ? U.diffDays(c.reexportBy, s.today) : null;
      var r = L.request(s, c.requestId);
      var cur = L.leOf(s, c.owner).currency;
      return { permit: c.permit, serial: c.serial, owner: L.leOf(s, c.owner).short, route: (L.country(s, c.from) || {}).name + ' → ' + (L.country(s, c.to) || {}).name, routeShort: c.from + ' → ' + c.to,
        regime: c.regime, value: F.money(c.value, cur), entry: F.date(c.entry), reexportBy: F.date(c.reexportBy), daysLeft: left, daysText: left === null ? '' : daysText(left), tone: left === null ? (c.status === 'CLOSED' ? 'ok' : 'bad') : daysTone(left),
        status: c.status === 'OPEN' ? 'Open' : c.status === 'CLOSED' ? 'Closed: ' + (c.outcome || '') : 'Regularise: ' + (c.outcome || ''), docs: (c.docs || []).join(', '),
        request: r ? { id: r.id, number: r.number } : null };
    });
    var customsOpen = customs.filter(function (c) { return c.daysLeft !== null; });

    // Certificates by country: the same units' certificates, the soonest first, expiring soon highlighted.
    var certC = {};
    units.forEach(function (u) {
      (u.certs || []).forEach(function (ct) {
        var left = U.diffDays(ct.expiry, s.today);
        var c = certC[ct.country] = certC[ct.country] || { code: ct.country, country: (L.country(s, ct.country) || {}).name || ct.country, rows: [] };
        c.rows.push({ serial: u.serial, owner: L.leOf(s, u.owner).short, type: ct.type, expiry: F.date(ct.expiry), daysLeft: left, daysText: daysText(left), soon: left < 90,
          tone: left < 30 ? 'bad' : left < 90 ? 'todo' : 'ok', here: u.country === ct.country, hereText: u.country === ct.country ? 'In ' + c.country + ' now' : '' });
      });
    });
    var certs = Object.keys(certC).sort().map(function (k) {
      var c = certC[k];
      c.rows.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
      return Object.assign(c, { soon: c.rows.filter(function (x) { return x.soon; }).length, count: c.rows.length });
    });
    var certSoon = U.sum(certs, function (c) { return c.soon; });

    // Accruals at the IC cut-off (MC-FR-24): both ledgers, and whether reversed.
    var accruals = s.statements.filter(function (st) { return st.accrued && (sc.has(st.providerLe) || sc.has(st.receiverLe)); }).map(function (st) {
      var txs = (st.accrued.txs || []).map(function (id) { return U.byId(s.tx, id); }).filter(Boolean);
      var rev = s.tx.filter(function (t) { return t.kind === 'ACCRUAL_REVERSAL' && t.refs.statementId === st.id; });
      return { number: st.number, pair: L.leShort(s, st.providerLe) + ' → ' + L.leShort(s, st.receiverLe), period: F.period(st.period), amount: F.money(st.accrued.amount, st.currency),
        entries: txs.map(function (t) { return L.leShort(s, t.le) + ' ' + t.number + ' (' + F.money(t.total, t.currency) + ')'; }).join(' · '),
        reversal: rev.map(function (t) { return L.leShort(s, t.le) + ' ' + t.number + ' ' + F.short(t.date); }).join(' · '), reversed: !!st.accrued.reversed,
        stateText: st.accrued.reversed ? 'Reversed' : 'Open', tone: st.accrued.reversed ? 'ok' : 'todo', at: F.date(st.accrued.at) };
    });

    // Disputes by age.
    var disputes = [];
    s.statements.filter(function (st) { return sc.has(st.providerLe) || sc.has(st.receiverLe); }).forEach(function (st) {
      st.disputes.forEach(function (d) {
        var c = U.byId(s.charges, d.chargeId) || {};
        var age = U.diffDays(d.resolved ? d.resolvedAt : s.today, d.at);
        disputes.push({ statement: st.number, pair: L.leShort(s, st.providerLe) + ' → ' + L.leShort(s, st.receiverLe), charge: d.chargeId, serial: c.serial || '',
          kind: ({ RENTAL: 'Rental', STANDBY: 'Standby', TRANSPORT: 'Transport', DAMAGE: 'Damage', LOSS: 'Loss', MIN_HIRE: 'Minimum hire', BREAKDOWN_CREDIT: 'Breakdown credit' }[c.kind] || c.kind || ''),
          amount: c.amount != null ? F.money(c.amount, c.currency) : '', reason: d.reason, raised: F.date(d.at), by: d.by, age: age, ageText: age + (age === 1 ? ' day' : ' days'),
          open: !d.resolved, state: d.resolved ? d.resolution + ' (' + (d.resolvedBy || '') + ')' : 'Open', tone: d.resolved ? 'ok' : age > 7 ? 'bad' : 'todo',
          bucket: age <= 3 ? '0–3 days' : age <= 7 ? '4–7 days' : 'Over 7 days', requestId: c.requestId || '', requestNumber: c.requestNumber || '' });
      });
    });
    disputes.sort(function (a, b) { return (b.open - a.open) || (b.age - a.age); });
    var buckets = ['0–3 days', '4–7 days', 'Over 7 days'].map(function (b) { return { label: b, count: disputes.filter(function (d) { return d.open && d.bucket === b; }).length }; });

    return {
      scope: sc.text, wholeGroup: sc.all, groupCurrency: g, today: F.date(s.today), who: p.name,
      kpis: {
        out: outAll + ' of ' + s.units.length, outNote: 'group units out on hire now',
        icCharged: F.money(icCharged, g), icOpen: F.money(icOpen, g), icNote: 'charged between group companies' + (sc.all ? '' : ' (yours)') + ', ' + F.money(icOpen, g) + ' not invoiced',
        recon: recon.length ? (recon.every(function (x) { return x.ok; }) ? 'All reconciled' : recon.filter(function (x) { return !x.ok; }).length + ' with a difference') : 'Nothing invoiced yet',
        reconTone: recon.every(function (x) { return x.ok; }) ? 'onsite' : 'stopped', reconNote: recon.length + (recon.length === 1 ? ' invoice pair' : ' invoice pairs') + ': charges = AR = AP',
        customs: customsOpen.length, customsNote: customsOpen.length ? 'soonest re-export in ' + Math.min.apply(null, customsOpen.map(function (c) { return c.daysLeft; })) + ' days' : 'no temporary import open',
        certs: certSoon, certsNote: 'certificates expire within 90 days', disputes: disputes.filter(function (d) { return d.open; }).length, disputesNote: disputes.length + ' raised in all'
      },
      utilisation: utilisation, icByPair: icByPair, recon: recon, reconOk: recon.every(function (x) { return x.ok; }), margins: margins, fleet: fleet, customs: customs, certs: certs,
      accruals: accruals, disputes: disputes, buckets: buckets, viewCounts: { pairs: view.icByPair.length, customs: view.customs.length, certs: view.certs.length }
    };
  }

  function margin(s, r, g) {
    var cs = s.charges.filter(function (c) { return c.requestId === r.id; });
    var ids = cs.map(function (c) { return c.id; });
    var cur = L.le(s, r.requestingLe).currency;
    var prj = L.project(s, r.projectId);
    var costTx = s.tx.filter(function (t) { return ['PROJECT_COST', 'CROSS_CHARGE', 'OWN_COST'].indexOf(t.kind) !== -1 && (t.items || []).some(function (i) { return ids.indexOf(i.chargeId) !== -1; }); });
    var mine = function (t) { return U.sum((t.items || []).filter(function (i) { return ids.indexOf(i.chargeId) !== -1; }), function (i) { return i.amount; }); };
    var cost = U.sum(costTx, mine);
    var billedCost = U.sum(costTx.filter(function (t) { return !!t.billed; }), mine);
    var costed = {};
    costTx.forEach(function (t) { (t.items || []).forEach(function (i) { costed[i.chargeId] = true; }); });
    var userCharges = cs.filter(function (c) { return c.relation !== 'CUSTOMER'; });
    var pending = userCharges.filter(function (c) { return !costed[c.id]; });
    var pendingAmt = U.sum(pending, function (c) { return c.amount; });
    var pendingCur = (pending[0] || {}).currency || cur;
    var owner = unique(r.lines.map(function (l) { return L.leShort(s, l.providerLe); })).join(', ');
    var rel = unique(r.lines.map(function (l) { return l.relation; }))[0] || '';
    var revenue = 0;
    var revText = '';
    var revSub = '';
    var marginAmt = null;
    var groupAmt = 0;
    var groupSub = '';
    var note = '';
    if (r.type === 'CUSTOMER_RENTAL') {
      revenue = U.sum(cs, function (c) { return c.amount; });
      var invoiced = U.sum(cs.filter(function (c) { return c.status === 'INVOICED'; }), function (c) { return c.amount; });
      revText = F.money(revenue, cur);
      revSub = (invoiced === revenue ? 'invoiced' : F.money(invoiced, cur) + ' invoiced') + ' to ' + ((L.customer(s, r.customerId) || {}).name || 'the customer').split(' · ')[0];
      marginAmt = revenue;
      groupAmt = r2(revenue * E.rate(s, cur, g, s.today));
      groupSub = 'the owner\'s own fleet: no intercompany';
      note = 'Customer rental (S3): the owner\'s revenue; its depreciation is in its asset book';
    } else if (r.type === 'CUSTOMER_PROJECT') {
      var mk = prj ? prj.markupPct : 0;
      var billed = r2(billedCost * (1 + mk));
      var toBill = r2((cost - billedCost) * (1 + mk));
      revenue = r2(billed + toBill);
      revText = F.money(revenue, cur);
      revSub = (toBill ? (billed ? F.money(billed, cur) + ' billed, ' : '') + F.money(toBill, cur) + ' to bill' : 'billed') + ' at cost + ' + Math.round(mk * 100) + ' %';
      marginAmt = r2(revenue - cost);
      groupAmt = r2(revenue * E.rate(s, cur, g, s.today));
      groupSub = 'IC eliminated, the customer\'s revenue stays';
      note = 'Customer project (S2): billed to ' + ((L.customer(s, prj && prj.customer) || {}).name || 'the customer') + ' by ' + L.leShort(s, r.requestingLe);
    } else {
      revText = '';
      revSub = 'internal: no revenue';
      marginAmt = null;
      groupAmt = 0;
      groupSub = rel === 'SAME_LE' ? 'one company: nets to nil' : 'IC eliminated';
      note = (rel === 'SAME_LE' ? 'Same company cross-charge' : 'Internal project (S1)') + ': cost on ' + (prj ? prj.number : 'the project');
    }
    return {
      id: r.id, number: r.number, type: V.TYPE[r.type], company: L.leShort(s, r.requestingLe), owner: owner, relation: (V.REL[rel] || {}).label || '', tone: (V.REL[rel] || {}).tone || 'na',
      cost: cost, costText: cost ? F.money(cost, cur) : (r.type === 'CUSTOMER_RENTAL' ? '' : F.money(0, cur)), costSub: r.type === 'CUSTOMER_RENTAL' ? 'own fleet: no hire cost' : (pendingAmt ? F.money(pendingAmt, pendingCur) + ' charged, not yet on the project' : (cost ? 'on ' + (prj ? prj.number : 'the project') : 'nothing charged yet')),
      revenue: revenue, revenueText: revText, revenueSub: revSub, margin: marginAmt, marginText: marginAmt === null ? 'Cost only' : F.money(marginAmt, cur), marginTone: marginAmt === null ? 'na' : marginAmt >= 0 ? 'ok' : 'todo',
      group: groupAmt, groupText: F.money(groupAmt, g), groupSub: groupSub, note: note, currency: cur, any: cs.length > 0
    };
  }

  // ── Exports: every list as it is shown ────────────────────────────────────────────────────────────────────────
  function amount(text) {
    var t = String(text || '');
    var neg = t.indexOf('−') !== -1 || /^-/.test(t.replace(/^[A-Z]{3} /, ''));
    var v = Number(t.replace(/[^0-9.]/g, ''));
    return isFinite(v) ? (neg ? -v : v) : 0;
  }
  /** { name, title, subtitle, rows, columns } for exportKit.run, from the view model on the page (v). */
  function exportOf(list, v) {
    var x = v || {};
    var lg = x.ledger || {};
    var gp = x.group || {};
    var sub = function (t) { return [x.subtitle || x.scope || '', t || ''].filter(Boolean).join(' · '); };
    var specs = {
      journal: function () {
        var rows = [];
        (lg.txs || []).forEach(function (t) {
          var base = { number: t.number, date: t.date, kind: t.kindText, title: t.title, source: t.source, entered: t.enteredText, currency: t.currency,
            requests: (t.requests || []).map(function (r) { return r.number; }).join(', '), statement: t.statement ? t.statement.number : '', projects: (t.projects || []).map(function (p) { return p.number; }).join(', ') };
          if (!t.lines.length) rows.push(Object.assign({}, base, { account: '', name: t.note, dr: '', cr: '' }));
          t.lines.forEach(function (l) { rows.push(Object.assign({}, base, { account: l.account, name: l.name + (l.memo ? ' (' + l.memo + ')' : ''), dr: l.dr ? amount(l.dr) : '', cr: l.cr ? amount(l.cr) : '' })); });
        });
        return { name: 'journal-' + (lg.company || ''), title: 'Journal · ' + (lg.company || '') + (lg.kindLabel ? ' · ' + lg.kindLabel : ''), subtitle: sub('shown, never posted'), rows: rows, columns: [
          { key: 'number', label: 'Number' }, { key: 'date', label: 'Date' }, { key: 'kind', label: 'Kind' }, { key: 'title', label: 'Title' }, { key: 'source', label: 'Source (Fusion)' },
          { key: 'account', label: 'Account', type: 'text' }, { key: 'name', label: 'Account name' }, { key: 'dr', label: 'Debit' }, { key: 'cr', label: 'Credit' }, { key: 'currency', label: 'Currency' },
          { key: 'entered', label: 'Entered and rate' }, { key: 'requests', label: 'Requests' }, { key: 'statement', label: 'Statement' }, { key: 'projects', label: 'Projects' }] };
      },
      trial: function () {
        return { name: 'trial-balance-' + (lg.company || ''), title: 'Trial balance · ' + (lg.company || ''), subtitle: sub(lg.balancedText), columns: [
          { key: 'account', label: 'Account', type: 'text' }, { key: 'name', label: 'Account name' }, { key: 'dr', label: 'Debit' }, { key: 'cr', label: 'Credit' }, { key: 'currency', label: 'Currency' }],
          rows: (lg.trial || []).map(function (r) { return { account: r.account, name: r.name, dr: r.dr ? amount(r.dr) : '', cr: r.cr ? amount(r.cr) : '', currency: lg.currency }; }) };
      },
      elim: function () {
        var rows = [];
        (gp.eliminations || []).forEach(function (e) {
          [['A', e.sideA, e.a], ['B', e.sideB, e.b]].forEach(function (sd) {
            (sd[2].rows || []).forEach(function (r) { rows.push({ pair: e.label, side: sd[1], company: r.company, local: amount(r.local), currency: r.currency, group: amount(r.group), state: e.stateText }); });
          });
          rows.push({ pair: e.label, side: 'Difference', company: 'Group', local: '', currency: '', group: e.diff, state: e.stateText + ': ' + e.why });
        });
        return { name: 'eliminations', title: 'Group eliminations · ' + (gp.currency || ''), subtitle: sub(gp.note), rows: rows, columns: [
          { key: 'pair', label: 'Elimination' }, { key: 'side', label: 'Side' }, { key: 'company', label: 'Company' }, { key: 'local', label: 'In its currency' }, { key: 'currency', label: 'Currency' },
          { key: 'group', label: 'In ' + (gp.currency || 'the group currency') }, { key: 'state', label: 'State' }] };
      },
      after: function () {
        return { name: 'after-elimination', title: 'What remains after elimination · ' + (gp.currency || ''), subtitle: sub(gp.afterText), rows: (gp.after || []).map(function (a) {
          return { account: a.account, name: a.name, dr: a.dr ? amount(a.dr) : '', cr: a.cr ? amount(a.cr) : '', companies: a.companies };
        }), columns: [{ key: 'account', label: 'Account', type: 'text' }, { key: 'name', label: 'Account name' }, { key: 'dr', label: 'Debit (' + (gp.currency || '') + ')' }, { key: 'cr', label: 'Credit (' + (gp.currency || '') + ')' }, { key: 'companies', label: 'Companies' }] };
      },
      utilisation: function () {
        return { name: 'utilisation', title: 'Utilisation by owner company and country', subtitle: sub(), rows: x.utilisation || [], columns: [
          { key: 'owner', label: 'Owner' }, { key: 'country', label: 'Country (now)' }, { key: 'units', label: 'Units' }, { key: 'out', label: 'Out' }, { key: 'pct', label: 'Utilisation %' }, { key: 'outList', label: 'Out now' }, { key: 'rest', label: 'The rest' }] };
      },
      icByPair: function () {
        return { name: 'ic-charges-by-pair', title: 'Intercompany charges by pair and month', subtitle: sub(), rows: x.icByPair || [], columns: [
          { key: 'pair', label: 'Owner → user' }, { key: 'periodText', label: 'Month' }, { key: 'charged', label: 'Charged' }, { key: 'invoiced', label: 'Invoiced' }, { key: 'open', label: 'Open' },
          { key: 'currency', label: 'Currency' }, { key: 'state', label: 'State' }, { key: 'statements', label: 'Statements' }, { key: 'accrued', label: 'Accrued' }] };
      },
      recon: function () {
        return { name: 'ic-reconciliation', title: 'Intercompany reconciliation: charges = AR = AP', subtitle: sub(), rows: x.recon || [], columns: [
          { key: 'number', label: 'Statement' }, { key: 'pairText', label: 'Owner → user' }, { key: 'pair', label: 'Invoice pair' }, { key: 'charges', label: 'Charges' }, { key: 'ar', label: 'AR (owner)' },
          { key: 'ap', label: 'AP (user)' }, { key: 'diff', label: 'Difference' }, { key: 'stateText', label: 'State' }] };
      },
      margins: function () {
        return { name: 'margins', title: 'Margins by request', subtitle: sub(), rows: (x.margins || []).map(function (m) { return Object.assign({}, m, { cost: m.cost, revenue: m.revenue, margin: m.margin === null ? '' : m.margin }); }), columns: [
          { key: 'number', label: 'Request' }, { key: 'type', label: 'Type' }, { key: 'company', label: 'User company' }, { key: 'owner', label: 'Owner' }, { key: 'cost', label: 'Equipment cost' },
          { key: 'revenue', label: 'Customer revenue' }, { key: 'margin', label: 'Margin' }, { key: 'currency', label: 'Currency' }, { key: 'group', label: 'Group margin (' + (x.groupCurrency || '') + ')' }, { key: 'note', label: 'Note' }] };
      },
      fleet: function () {
        var rows = [];
        (x.fleet || []).forEach(function (c) { c.units.forEach(function (u) { rows.push(Object.assign({ country: c.country }, u, { request: u.request ? u.request.number : '' })); }); });
        return { name: 'fleet-by-country', title: 'Fleet by country, with customs', subtitle: sub(), rows: rows, columns: [
          { key: 'country', label: 'Country (now)' }, { key: 'serial', label: 'Unit' }, { key: 'name', label: 'Name' }, { key: 'owner', label: 'Owner' }, { key: 'hold', label: 'Held as' },
          { key: 'status', label: 'Status' }, { key: 'where', label: 'Where' }, { key: 'request', label: 'Request' }, { key: 'customs', label: 'Customs permit' }, { key: 'customsLeft', label: 'Days left' }] };
      },
      customs: function () {
        return { name: 'customs-permits', title: 'Customs: temporary imports', subtitle: sub(), rows: (x.customs || []).map(function (c) { return Object.assign({}, c, { request: c.request ? c.request.number : '', daysLeft: c.daysLeft === null ? '' : c.daysLeft }); }), columns: [
          { key: 'permit', label: 'Permit' }, { key: 'serial', label: 'Unit' }, { key: 'owner', label: 'Owner' }, { key: 'route', label: 'From → to' }, { key: 'regime', label: 'Regime' }, { key: 'value', label: 'Customs value' },
          { key: 'entry', label: 'Entry' }, { key: 'reexportBy', label: 'Re-export by' }, { key: 'daysLeft', label: 'Days left' }, { key: 'status', label: 'Status' }, { key: 'docs', label: 'Documents' }, { key: 'request', label: 'Request' }] };
      },
      certs: function () {
        var rows = [];
        (x.certs || []).forEach(function (c) { c.rows.forEach(function (r) { rows.push(Object.assign({ country: c.country }, r, { soon: r.soon ? 'Yes' : '' })); }); });
        return { name: 'certificates-by-country', title: 'Certificates by country', subtitle: sub(), rows: rows, columns: [
          { key: 'country', label: 'Country' }, { key: 'serial', label: 'Unit' }, { key: 'owner', label: 'Owner' }, { key: 'type', label: 'Certificate' }, { key: 'expiry', label: 'Expires' },
          { key: 'daysLeft', label: 'Days left' }, { key: 'soon', label: 'Expiring soon' }, { key: 'hereText', label: 'Where the unit is' }] };
      },
      accruals: function () {
        return { name: 'accruals', title: 'Accruals at the intercompany cut-off', subtitle: sub(), rows: x.accruals || [], columns: [
          { key: 'number', label: 'Statement' }, { key: 'pair', label: 'Owner → user' }, { key: 'period', label: 'Month' }, { key: 'amount', label: 'Accrued' }, { key: 'entries', label: 'Entries (both ledgers)' },
          { key: 'stateText', label: 'State' }, { key: 'reversal', label: 'Reversal' }] };
      },
      disputes: function () {
        return { name: 'disputes', title: 'Disputes by age', subtitle: sub(), rows: x.disputes || [], columns: [
          { key: 'statement', label: 'Statement' }, { key: 'pair', label: 'Owner → user' }, { key: 'charge', label: 'Charge' }, { key: 'serial', label: 'Unit' }, { key: 'kind', label: 'Kind' }, { key: 'amount', label: 'Amount' },
          { key: 'reason', label: 'Reason' }, { key: 'raised', label: 'Raised' }, { key: 'by', label: 'By' }, { key: 'age', label: 'Age (days)' }, { key: 'state', label: 'State' }] };
      }
    };
    var f = specs[list];
    return f ? f() : { name: list || 'export', title: list || 'Export', rows: [], columns: [] };
  }

  return { GROUP: GROUP, PAIRS: PAIRS, myCompanies: myCompanies, scope: scope, options: options, links: links, enteredText: enteredText, accounting: accounting, ledger: ledger,
    group: group, reports: reports, margin: margin, exportOf: exportOf, emptyLedger: emptyLedger, emptyGroup: emptyGroup, amount: amount };
});
