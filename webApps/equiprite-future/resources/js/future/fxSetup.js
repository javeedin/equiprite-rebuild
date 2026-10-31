define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine', 'resources/js/future/fxViews'], function (Seed, E, V) {
  'use strict';

  /**
   * EquipRite Future · Setup (flows/setup): FDD v2.0's companies and agreements around fxViews.setup(): who may change
   * them and why not, the people to play with their roles in words, who may source from whom and what stopping it
   * does, the agreements with their version history and what a new rate does before it is saved, and the decisions
   * (OD-…) with what each one changes in EquipRite and in Fusion. Pure functions; the drafts are the page's.
   */
  var U = E.util;
  var L = E.lookups;
  var F = V.fmt;

  var ROLE = {
    requester: 'raises requests', site: 'receives and records on site', 'receiver-review': 'agrees hours and statements', finance: 'company finance',
    'owner-em': 'approves and allocates its fleet', yard: 'ships, collects, inspects', desk: 'rental desk', 'owner-finance': 'releases the owner\'s statements',
    'ic-finance': 'group intercompany finance', admin: 'sees and does everything (demo)'
  };

  // Each decision that can be switched here: what it does, and what Fusion does because of it.
  var INFO = {
    requesterApproval: { does: 'The requesting BU approves its own requests above the threshold before the owner sees them.', on: 'Turning it on: requests above the threshold wait for the requesting BU\'s approval first.',
      off: 'Turning it off: only the sourcing BU (the owner) approves, as the user chose.', fusion: 'Fusion: nothing; approvals stay in EquipRite.' },
    requesterThreshold: { does: 'Above this, a request waits for the requesting BU\'s approval (only while the switch above is on).', fusion: 'Fusion: nothing.', min: 0, unit: 'in the requester\'s currency' },
    onHire: { does: 'When the hire starts, and so the first day charged.', fusion: 'Fusion: the days charged change, so the next invoice pair\'s amounts (INT-10).',
      choice: { RECEIPT: 'On hire when the site confirms receipt (recommended).', DISPATCH: 'On hire from the day the yard ships it.' } },
    disputeDays: { does: 'Days the user has to agree or dispute a released statement; silence agrees it (MC-FR-23).', fusion: 'Fusion: nothing until the invoice pair.', min: 1, max: 30, int: true, unit: 'days' },
    cutoffDay: { does: 'Day of the next month by which the invoice pair must exist; whatever is not invoiced then is accrued in both ledgers.', fusion: 'Fusion GL: mirrored accrual journals on that day in both companies, reversed once invoiced (INT-24).', min: 1, max: 28, int: true, unit: 'day of the month' },
    s2Billing: { does: 'Who bills Customer X in scenario 2, never both (MC-FR-27).', fusion: 'Fusion: PPM Billing invoices from the contract, or Receivables gets EquipRite\'s invoice and the IC cost lines turn non-billable.',
      choice: { PPM: 'ProjectCo\'s project contract bills it in PPM (recommended).', EQUIPRITE: 'EquipRite sends a Receivables invoice from ProjectCo; the contract does not bill the IC cost.' } },
    netting: { does: 'Settle intercompany invoices by monthly netting instead of payments (MC-FR-28).', on: 'Turning it on: the next settlement nets through the clearing account (1150).',
      off: 'Turning it off: the next settlement is a payment and a receipt through the bank (1100).', fusion: 'Fusion Payables / Receivables: a netting settlement (INT-25), or a payment and a receipt.' },
    damageThreshold: { does: 'Damage above this on an intercompany line needs the user\'s acceptance before it is invoiced.', fusion: 'Fusion: nothing until the damage is invoiced.', min: 0, unit: 'in the agreement\'s currency' },
    lossMarkupPct: { does: 'A lost unit is charged at its net book value plus this share (0.1 = 10 %).', fusion: 'Fusion Assets: the retirement at that value; the charge goes on the next invoice pair.', min: 0, max: 1, unit: 'share (0 to 1)' },
    simulateFailure: { does: 'The next invoice pair fails once, as if Fusion Payables refused it, to show the failure and the retry.', on: 'Turning it on: the next Create invoice pair fails once, in words.',
      off: 'Turning it off: invoice pairs go through.', fusion: 'Fusion: as if Payables rejected the AP invoice (nothing is created).' }
  };

  // FDD v2.0's other decisions: settled here as recommended (read-only in the prototype).
  var FIXED = [
    ['OD-01', 'How FleetCo bills ProjectCo', 'A: the invoice pair from EquipRite (FleetCo\'s AR, ProjectCo\'s AP coded to the project)'],
    ['OD-02', 'Stock at another company\'s site', 'In the owner\'s own deployment orgs, never a transfer into the user\'s org (GR-6)'],
    ['OD-03', 'Depreciation of the fleet', 'The rental fleet held as assets; stock only for low-value or bulk items'],
    ['OD-04', 'Transfer price basis', 'Market rate card (arm\'s length), reviewed yearly; cost plus where no market rate exists'],
    ['OD-06', 'Billing frequency', 'Monthly, the calendar month; statements on day 1, invoices by the cut-off day (above)'],
    ['OD-08', 'Agreement currency and exchange', 'The owner\'s ledger currency; the user bears the exchange difference'],
    ['OD-09', 'Tax per country pair', 'Confirmed by the tax team, set in Fusion Tax: domestic VAT, or reverse charge and withholding across the border'],
    ['OD-13', 'Sub-lending', 'Not allowed: only the owner bills, every leg has its own intercompany agreement'],
    ['OD-14', 'Same legal entity, two BUs', 'A PPM cross-charge, no invoices, no tax'],
    ['OD-15', 'Operators and fuel', 'Separate charge types on the same statement']
  ];

  function unique(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
  function agreementFor(s, provider, receiver) {
    return (s.agreements || []).filter(function (a) { return a.status === 'ACTIVE' && a.provider === provider && a.receiver === receiver; })[0] || null;
  }

  function setup(s) {
    var v = V.setup(s);
    var p = E.persona(s);
    var editors = Seed.PERSONAS.filter(function (x) { return x.roles.indexOf('ic-finance') !== -1; });
    var editorText = editors.map(function (x) { return x.name; }).join(', ');
    var companies = s.companies.map(function (c, i) {
      var k = L.country(s, c.country);
      return Object.assign({}, v.companies[i], { tz: k.tz, bus: s.bus.filter(function (b) { return b.le === c.id; }).map(function (b) { return b.name; }).join(', '), countryCode: c.country });
    });
    var bus = s.bus.map(function (b, i) {
      return Object.assign({}, v.bus[i], { le: b.le, units: s.units.filter(function (u) { return u.owner === b.id; }).length, roleList: b.roles.map(function (r) { return { fleet: 'Owns fleet', rental: 'Rents to customers', projects: 'Runs projects' }[r]; }),
        projects: s.projects.filter(function (x) { return x.bu === b.id; }).map(function (x) { return x.number; }).join(', ') || 'none',
        people: Seed.PERSONAS.filter(function (x) { return x.roles.indexOf('admin') === -1 && x.bus.indexOf(b.id) !== -1; }).map(function (x) { return x.name.split(' ')[0]; }).join(', ') });
    });
    var orgs = s.orgs.map(function (o, i) {
      var here = s.units.filter(function (u) { return u.custody.org === o.id && (u.custody.kind !== 'yard' || u.home === o.id); });
      return Object.assign({}, v.orgs[i], { id: o.id, bu: L.buName(s, o.bu), kindKey: o.kind, countryName: (L.country(s, o.country) || {}).name || o.country,
        why: { yard: 'Home yard: where the owner\'s units rest, on hand in its own org.', deploy: 'The owner\'s own org at other companies\' sites: a stock unit on site is on hand here, the locator is the project (MC-FR-03).',
          customer: 'The owner\'s own org for units at its rental customers\' sites.', site: 'A store of the projects BU at its own site.' }[o.kind] || '',
        units: here.map(function (u) { return u.serial; }).join(', '), count: here.length });
    });
    var people = Seed.PERSONAS.map(function (x) {
      return { id: x.id, name: x.name, initials: x.initials, title: x.title, on: x.id === s.personaId, bus: x.bus.map(function (b) { return L.buName(s, b); }).join(', '),
        roles: x.roles.map(function (r) { return ROLE[r] || r; }), rolesText: x.roles.map(function (r) { return ROLE[r] || r; }).join(', '),
        changes: x.roles.indexOf('ic-finance') !== -1 || x.roles.indexOf('admin') !== -1, first: x.name.split(' ')[0] };
    });
    var relations = s.icRelations.map(function (r, i) {
      var vr = v.relations[i];
      var rel = E.relationType(s, r.provider, r.receiver);
      var ag = agreementFor(s, r.provider, r.receiver);
      var units = s.units.filter(function (u) { return u.owner === r.provider && u.status !== 'LOST'; }).length;
      var pv = L.buName(s, r.provider);
      var rc = L.buName(s, r.receiver);
      return Object.assign({}, vr, { providerBu: r.provider, receiverBu: r.receiver, priority: r.priority, crossBorder: r.crossBorder, tone: (V.REL[rel] || {}).tone || 'ic', relation: rel,
        agreement: ag ? ag.number + ' v' + ag.version : 'no agreement', units: units, lead: r.leadDays + (r.leadDays === 1 ? ' day' : ' days'), state: r.allowed ? 'Allowed' : 'Stopped', stateTone: r.allowed ? 'ok' : 'bad',
        stopText: 'Stop: New request no longer offers ' + rc + ' ' + (units === 1 ? 'the one unit' : 'the ' + units + ' units') + ' of ' + pv + ' (MC-FR-04); lines already approved go on and are billed as before. Fusion: nothing, the matrix lives in EquipRite.',
        allowText: 'Allow: ' + rc + ' may request ' + pv + '\'s units again, priced on ' + (ag ? ag.number : 'its agreement') + '. Fusion: nothing.' });
    });
    var agreements = s.agreements.map(function (a, i) {
      var va = v.agreements[i];
      var hist = (a.versions || []).slice();
      if (!hist.some(function (h) { return h.version === 1; })) hist.unshift({ version: 1, from: s.startDate, approvedBy: 'As the demo group was set up', note: 'The rates below, before any change' });
      var cur = a.currency;
      return Object.assign({}, va, { kindKey: a.kind, status: a.status, provider: L.buName(s, a.provider), receiver: a.customer ? (L.customer(s, a.customer) || {}).name : L.buName(s, a.receiver),
        tone: a.kind === 'CUSTOMER' ? 'cust' : a.kind === 'CROSS_CHARGE' ? 'info' : (E.relationType(s, a.provider, a.receiver) === 'IC_CROSS_BORDER' ? 'xb' : 'ic'),
        transportText: a.transport ? F.money(a.transport, cur) + ' a trip' : 'none', minText: a.minDays ? a.minDays + (a.minDays === 1 ? ' day' : ' days') : 'none', standbyText: va.standby,
        breakdownText: a.breakdownCredit ? 'Credited' : 'Not credited', depositText: a.depositPct ? Math.round(a.depositPct * 100) + ' % of a month' : 'none', whtText: a.wht ? Math.round(a.wht * 100) + ' %' : 'none',
        rates: va.rates.map(function (r) { return Object.assign({}, r, { agreementId: a.id, key: 'rate|' + a.id + '|' + r.cls + '|', dayText: F.money(r.day, cur), weekText: F.money(r.week, cur), currency: cur }); }),
        history: hist.map(function (h) { return { version: h.version, from: F.date(h.from), by: h.approvedBy || '', note: h.note || '', current: h.version === a.version }; }).reverse(),
        nextVersion: a.version + 1, today: F.date(s.today) });
    });
    var settings = v.settings.map(function (x) {
      var info = INFO[x.key] || {};
      var text = x.kind === 'bool' ? (x.value ? 'On' : 'Off') : x.kind === 'choice' ? ((x.choices.filter(function (c) { return c.on; })[0] || {}).label || x.valueText) : F.num(x.value).replace(/\.00$/, '');
      return Object.assign({}, x, { does: info.does || '', fusion: info.fusion || '', unit: info.unit || '', min: info.min, max: info.max, valueShown: text, draftKey: 'setting|' + x.key + '|',
        flipText: x.kind === 'bool' ? (x.value ? info.off : info.on) || '' : '', flipLabel: x.value ? 'Turn off' : 'Turn on', flipTo: x.value ? 'false' : 'true',
        choices: (x.choices || []).map(function (c) { return Object.assign({}, c, { why: ((info.choice || {})[c.value]) || '' }); }) });
    });
    var fixed = FIXED.map(function (f) { return { ref: f[0], label: f[1], text: f[2] }; });
    return Object.assign({}, v, {
      me: V.me(s), canEdit: v.canEdit, today: F.date(s.today), editors: editorText,
      whyNot: v.canEdit ? '' : p.name + ' sees the setup but does not change it: rates, relationships and decisions are approved for both companies by group intercompany finance (' + editorText + ') or Admin (MC-FR-05).',
      companies: companies, bus: bus, orgs: orgs, people: people, relations: relations, agreements: agreements, settings: settings, fixed: fixed,
      counts: { companies: companies.length, bus: bus.length, orgs: orgs.length, people: people.length, relations: relations.length, stopped: relations.filter(function (r) { return !r.allowed; }).length,
        agreements: agreements.length, decisions: settings.length + fixed.length },
      gr6: 'Stock moves stay inside the owner. Transfer orders run only between orgs of one legal entity, FleetCo\'s yard to FleetCo\'s deployment org at the site, never into a ProjectCo org (that would be an intercompany sale).'
    });
  }

  // ── Drafts (the page keeps them; nothing changes until saved) ─────────────────────────────────────────────────
  function draftOf(drafts, key, current) {
    var d = drafts || {};
    return Object.prototype.hasOwnProperty.call(d, key) ? d[key] : (current === undefined || current === null ? '' : String(current));
  }
  function numberOk(x, info) {
    var n = Number(x);
    if (String(x).trim() === '' || !isFinite(n)) return 'Give a number.';
    if (info && info.int && Math.round(n) !== n) return 'Give a whole number.';
    if (info && info.min !== undefined && n < info.min) return 'At least ' + info.min + '.';
    if (info && info.max !== undefined && n > info.max) return 'At most ' + info.max + '.';
    return '';
  }

  /** A rate being edited: what saving it does (a new version) and what Fusion does, before it is saved. */
  function rateChange(drafts, a, r) {
    var ag = a || {};
    var rt = r || {};
    var key = rt.key || '';
    var day = draftOf(drafts, key + 'day', rt.day);
    var week = draftOf(drafts, key + 'week', rt.week);
    var changed = Number(day) !== Number(rt.day) || Number(week) !== Number(rt.week);
    var bad = numberOk(day, { min: 0.01 }) || numberOk(week, { min: 0.01 });
    if (!bad && (Number(day) <= 0 || Number(week) <= 0)) bad = 'Rates above zero.';
    var cur = rt.currency || ag.currency || '';
    var text = !changed ? '' : bad ? bad : 'Saving makes ' + ag.number + ' version ' + ag.nextVersion + ' from ' + (ag.today || 'today') + ': ' + (rt.clsName || rt.cls) + ' '
      + F.money(rt.day, cur) + '/day, ' + F.num(rt.week) + '/week → ' + F.num(Number(day)) + '/day, ' + F.num(Number(week)) + '/week. Lines already requested keep the price they were raised at; new requests are priced on version ' + ag.nextVersion + ' (MC-FR-05).';
    return { day: day, week: week, changed: changed, valid: changed && !bad, error: changed ? bad : '', text: text,
      fusion: changed && !bad ? 'Fusion: nothing now. The invoice pairs of the hires priced on it carry the new rate (INT-10).' : '',
      warn: changed && !bad && Number(week) > Number(day) * 7 ? 'The week costs more than seven days at the day rate.' : '' };
  }
  function ratePayload(drafts, data) {
    var d = data || {};
    var key = 'rate|' + d.agreementId + '|' + d.cls + '|';
    return { agreementId: d.agreementId, cls: d.cls, day: Number(draftOf(drafts, key + 'day', d.day)), week: Number(draftOf(drafts, key + 'week', d.week)) };
  }

  /** A number decision being edited: what saving it changes. */
  function settingChange(drafts, st) {
    var x = st || {};
    var info = INFO[x.key] || {};
    var val = draftOf(drafts, x.draftKey || ('setting|' + x.key + '|'), x.value);
    var changed = String(val) !== String(x.value) && Number(val) !== Number(x.value);
    var bad = changed ? numberOk(val, info) : '';
    return { value: val, changed: changed, valid: changed && !bad, error: bad,
      text: changed && !bad ? 'Saving changes “' + x.label + '” from ' + x.valueShown + ' to ' + F.num(Number(val)).replace(/\.00$/, '') + '. ' + (info.does || '') : '' };
  }
  function settingPayload(drafts, data) {
    var d = data || {};
    return { key: d.key, value: draftOf(drafts, 'setting|' + d.key + '|', d.value) };
  }

  /** Drafts without the ones under a prefix (once saved). */
  function dropDrafts(drafts, prefix) {
    var out = {};
    Object.keys(drafts || {}).forEach(function (k) { if (!prefix || k.indexOf(prefix) !== 0) out[k] = drafts[k]; });
    return out;
  }

  // ── Exports ───────────────────────────────────────────────────────────────────────────────────────────────────
  function exportOf(list, v) {
    var x = v || {};
    var specs = {
      companies: { name: 'companies', title: 'Companies', rows: x.companies, columns: [['name', 'Company'], ['short', 'Short'], ['role', 'Role'], ['country', 'Country'], ['currency', 'Currency'], ['taxReg', 'Tax registration'],
        ['vat', 'VAT'], ['wht', 'Withholding'], ['eInvoicing', 'E-invoicing'], ['weekend', 'Weekend'], ['tz', 'Time zone'], ['icOrg', 'IC organization'], ['bus', 'Business units']] },
      bus: { name: 'business-units', title: 'Business units', rows: x.bus, columns: [['name', 'Business unit'], ['company', 'Company'], ['roles', 'Roles'], ['units', 'Units owned'], ['projects', 'Projects'], ['people', 'People']] },
      orgs: { name: 'inventory-orgs', title: 'Inventory orgs (GR-6)', rows: x.orgs, columns: [['name', 'Org'], ['owner', 'Owner company'], ['bu', 'Business unit'], ['countryName', 'Country'], ['kind', 'Kind'], ['units', 'Units here'], ['why', 'What it is for']] },
      people: { name: 'people', title: 'People in the demo', rows: (x.people || []).map(function (p) { return Object.assign({}, p, { on: p.on ? 'Playing now' : '' }); }),
        columns: [['name', 'Name'], ['title', 'Title'], ['bus', 'Business units'], ['rolesText', 'Roles'], ['on', 'Played']] },
      relations: { name: 'ic-relationships', title: 'Intercompany relationships (MC-FR-04)', rows: x.relations, columns: [['provider', 'Provider (owner)'], ['receiver', 'Receiver (user)'], ['type', 'Type'],
        ['mechanism', 'Mechanism'], ['lead', 'Lead time'], ['netting', 'Netting'], ['priority', 'Priority'], ['agreement', 'Agreement'], ['state', 'State']] },
      agreements: { name: 'agreements', title: 'Agreements and rates', rows: [].concat.apply([], (x.agreements || []).map(function (a) {
        return a.rates.map(function (r) { return { number: a.number, kind: a.kind, between: a.between, currency: a.currency, version: a.version, tax: a.tax, cls: r.clsName, day: r.day, week: r.week, terms: a.terms }; });
      })), columns: [['number', 'Agreement'], ['kind', 'Kind'], ['between', 'Between'], ['currency', 'Currency'], ['version', 'Version'], ['tax', 'Tax'], ['cls', 'Class'], ['day', 'Day rate'], ['week', 'Week rate'], ['terms', 'Terms']] },
      decisions: { name: 'decisions', title: 'Decisions (FDD v2.0)', rows: (x.settings || []).map(function (st) { return { ref: st.ref, label: st.label, value: st.valueShown, does: st.does, fusion: st.fusion, switchable: 'Here' }; })
        .concat((x.fixed || []).map(function (f) { return { ref: f.ref, label: f.label, value: f.text, does: '', fusion: '', switchable: 'Decided (recommendation)' }; })),
        columns: [['ref', 'Ref'], ['label', 'Decision'], ['value', 'Now'], ['does', 'What it does'], ['fusion', 'In Fusion'], ['switchable', 'Changed']] }
    };
    var sp = specs[list];
    if (!sp) return { name: list || 'export', title: list || 'Export', rows: [], columns: [] };
    return { name: sp.name, title: sp.title, subtitle: 'EquipRite Future setup · ' + (x.today || ''), rows: sp.rows || [],
      columns: sp.columns.map(function (c) { return { key: c[0], label: c[1], type: c[0] === 'version' || c[0] === 'day' || c[0] === 'week' || c[0] === 'units' || c[0] === 'priority' ? undefined : 'text' }; }) };
  }

  return { ROLE: ROLE, INFO: INFO, FIXED: FIXED, setup: setup, draftOf: draftOf, rateChange: rateChange, ratePayload: ratePayload, settingChange: settingChange,
    settingPayload: settingPayload, dropDrafts: dropDrafts, exportOf: exportOf };
});
