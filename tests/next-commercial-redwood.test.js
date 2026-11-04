/*
 * EquipRite Next, Commercial in the Redwood look (resources/js/commercialRedwood.js): Rates and Agreements as Oracle's
 * Smart Search page over an oj-table, as Old builds them. Each table's rows (Oracle's oj-badge for a status), one
 * filter per column offering what the rows hold with how many, picking one keeps the rows that have it, Smart Search's
 * criterion read in both of its forms, the record headers' badges and actions (each routed to Current's chain), and
 * the search config, the page's search context and the Smart Search markup agree.
 *
 * Run:  node tests/next-commercial-redwood.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const JS = path.join(NEXT, 'resources', 'js');
const PAGES = path.join(NEXT, 'flows', 'commercial', 'pages');

function load(file, deps) {
  const sandbox = { console, Intl, Date, JSON, Object, Array, String, Number, Math, RegExp };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const rules = load(path.join(JS, 'rules.js'));
const fmt = load(path.join(JS, 'fmt.js'));
const R = load(path.join(JS, 'rateRules.js'), { 'resources/js/rules': rules, 'resources/js/fmt': fmt });
const A = load(path.join(JS, 'agreementRules.js'), { 'resources/js/fmt': fmt });
const RW = load(path.join(JS, 'commercialRedwood.js'), { 'resources/js/rateRules': R, 'resources/js/agreementRules': A, 'resources/js/fmt': fmt });
const plain = (v) => JSON.parse(JSON.stringify(v));
const labels = (a) => a.map((o) => o.label).join(' | ');

const TODAY = '2026-11-04';

// ── Rates ────────────────────────────────────────────────────────────────────────────────────────────────
// Rows as loadSchedulesChain makes them (rateRules.scheduleRow).
const yards = new Map([[300, 'Houston Yard'], [400, 'Odessa Yard']]);
const schedules = [
  { id: 9, scheduleName: 'US Excavators 2026', description: 'Base rates for the Gulf coast', currencyCode: 'USD', effectiveFrom: '2026-01-01T00:00:00Z',
    effectiveTo: '2026-11-24T00:00:00Z', isActiveFlag: 'Y', yardOrgId: 300 },
  { id: 10, scheduleName: 'Default fallback', currencyCode: 'USD', effectiveFrom: '2026-01-01T00:00:00Z', isActiveFlag: 'N' },
  { id: 11, scheduleName: 'Pipeline North special', currencyCode: 'USD', effectiveFrom: '2026-03-01T00:00:00Z', effectiveTo: '2027-02-28T00:00:00Z',
    isActiveFlag: 'Y', projectName: 'Pipeline North', taskName: 'Phase 2', customerName: 'Lone Star Paving' },
  { id: 12, scheduleName: 'Odessa yard rates', currencyCode: 'CAD', effectiveFrom: '2027-01-01T00:00:00Z', effectiveTo: '2027-12-31T00:00:00Z',
    isActiveFlag: 'Y', yardOrgId: 400 },
  { id: 13, scheduleName: 'Old 2025', effectiveFrom: '2025-01-01T00:00:00Z', effectiveTo: '2025-12-31T00:00:00Z', isActiveFlag: 'N' },
].map((s) => R.scheduleRow(s, yards, (y) => y === 400));

T.section('Rates: the table\'s rows, a status as Oracle\'s badge');
const rrows = plain(RW.rateRows(schedules, TODAY));
T.eq('a row per schedule, keyed by its id', rrows.map((r) => r.key).join(), '9,10,11,12,13');
T.eq('a row in words', JSON.stringify(rrows[0]), JSON.stringify({ key: '9', name: 'US Excavators 2026', description: 'Base rates for the Gulf coast',
  usedBy: 'Yard Houston Yard', dates: '1 Jan – 24 Nov 2026', ends: 'Ends in 20 days', currency: 'USD', status: 'Active',
  badge: 'oj-badge oj-badge-success oj-badge-subtle', note: '' }));
T.eq('the fallback: no tags, no description, inactive (a neutral badge)', [rrows[1].usedBy, rrows[1].description, rrows[1].status, rrows[1].badge].join(' | '),
  'No tags: the fallback rates |  | Inactive | oj-badge oj-badge-subtle');
T.eq('a schedule whose yard takes Fusion PPM rates says so', rrows[3].note, 'Not used: its yard takes Fusion PPM rates');
T.eq('no currency: a dash', rrows[4].currency, '—');

T.section('Rates: a filter per column, with what the schedules hold and how many');
const ro = plain(RW.rateOptions(schedules, TODAY));
T.eq('Schedule', labels(ro.name), 'Default fallback (1) | Odessa yard rates (1) | Old 2025 (1) | Pipeline North special (1) | US Excavators 2026 (1)');
T.eq('Used by: each tag, and the fallbacks', labels(ro.usedBy),
  'Customer Lone Star Paving (1) | No tags: the fallback rates (2) | Project Pipeline North · Phase 2 (1) | Yard Houston Yard (1) | Yard Odessa Yard (1)');
T.eq('Effective: where today is in each schedule', labels(ro.dates), 'In effect now (3) | Starting later (1) | Ending within 30 days (1) | Ended (1) | No end date (1)');
T.eq('Currency', labels(ro.currency), 'CAD (1) | No currency (1) | USD (3)');
T.eq('Status: the list\'s chips that are a status (Tagged and No tags are Used by\'s)', labels(ro.chip), 'All (5) | Active (3) | Ending soon (1) | Inactive (2)');
T.eq('…their values are the list\'s chip keys', ro.chip.map((o) => o.value).join(), 'all,ACTIVE,expiring,INACTIVE');

T.section('Rates: picking one keeps the schedules that have it');
const rpick = (f) => RW.rateByColumns(schedules, f, TODAY).map((s) => s.id).join();
T.eq('nothing picked: all', rpick({}), '9,10,11,12,13');
T.eq('Schedule', rpick({ name: 'Old 2025' }), '13');
T.eq('Used by: a project', rpick({ usedBy: 'Project Pipeline North · Phase 2' }), '11');
T.eq('Used by: one of a schedule\'s several tags', rpick({ usedBy: 'Customer Lone Star Paving' }), '11');
T.eq('Used by: the fallbacks', rpick({ usedBy: 'No tags: the fallback rates' }), '10,13');
T.eq('Effective: in effect now', rpick({ dates: 'now' }), '9,10,11');
T.eq('Effective: ending within 30 days', rpick({ dates: 'ending' }), '9');
T.eq('Effective: starting later; ended; no end date', [rpick({ dates: 'later' }), rpick({ dates: 'ended' }), rpick({ dates: 'open' })].join(' / '), '12 / 13 / 10');
T.eq('Currency (no currency is one too)', [rpick({ currency: 'USD' }), rpick({ currency: 'No currency' })].join(' / '), '9,10,11 / 13');
T.eq('two at once: both must hold', rpick({ currency: 'USD', dates: 'now', usedBy: 'Yard Houston Yard' }), '9');

T.section('Rates: the record\'s header');
T.eq('its status as the header\'s badge', JSON.stringify([RW.rateBadge({ activeStatus: true }), RW.rateBadge({ activeStatus: false })]),
  JSON.stringify([{ text: 'Active', status: 'success' }, { text: 'Inactive', status: 'neutral' }]));
const RatesPage = load(path.join(PAGES, 'rates-page.js'), { 'resources/js/rateRules': R, 'resources/js/exportKit': { FORMATS: [] }, 'resources/js/fmt': fmt,
  'resources/js/commercialRedwood': RW });
const rp = new RatesPage();
const ids = (a) => plain(a).map((x) => x.id).join();
T.eq('its actions: Current\'s buttons on the schedule (full access, changed, with rates)', ids(rp.rwActions(true, '9', false, true, 3)),
  'details,add,export,compare,discard,delete,refresh');
T.eq('…a new one cannot be deleted, nor rates without any exported; read only: export and refresh', [ids(rp.rwActions(true, 'new', true, false, 0)),
  ids(rp.rwActions(false, '9', false, false, 3))].join(' / '), 'details,add,refresh / export,compare,refresh');
T.eq('Edit details says Done once the details are open', plain(rp.rwActions(true, '9', true, false, 0))[0].label, 'Done with the details');
T.eq('Save schedule on the band (off below full access, held while saving: its label steady, as Oracle\'s toolbar needs)', JSON.stringify([rp.rwPrimary(true, false).display, rp.rwPrimary(true, true).label,
  rp.rwPrimary(true, true).display, rp.rwPrimary(false, false).display]), JSON.stringify(['on', 'Save schedule', 'disabled', 'off']));
T.eq('the title: its name, the list\'s while it loads, New schedule', [rp.rwTitle({ scheduleName: 'X' }, '9', false, []),
  rp.rwTitle({ scheduleName: 'Old' }, '11', true, [{ id: 11, scheduleName: 'Pipeline North special' }]), rp.rwTitle({}, 'new', false, [])].join(' | '),
  'X | Pipeline North special | New schedule');
T.eq('the subtitle: the kicker, who uses it, when, the currency', rp.rwSubtitle({ yardOrgId: 300, yardOrgName: 'Houston Yard', startDate: '2026-01-01',
  endDate: '2026-11-24', currency: 'USD' }, '9'), 'Rate schedule · Used by Houston Yard · 1 Jan – 24 Nov 2026 · USD');
T.eq('…the fallback says so', rp.rwSubtitle({ startDate: '2026-01-01', currency: 'USD' }, '10'), 'Rate schedule · The fallback schedule (no tags) · From 1 Jan 2026 · USD');
T.eq('under Redwood the schedule\'s body shows with its record only', [rp.rwListShown('redwood', 'list'), rp.rwListShown('redwood', 'record'),
  rp.rwListShown('current', 'list')].join(), 'true,false,false');
const ratesRw = fs.readFileSync(path.join(PAGES, 'rates-page-chains', 'rwChain.js'), 'utf8');
T.check('every action the header offers is routed to Current\'s chain', ['details', 'add', 'export', 'discard', 'delete', 'refresh']
  .every((id) => ratesRw.includes("id === '" + id + "'")) && ['headerChain', 'addRowChain', 'exportChain', 'discardChain', 'deleteScheduleChain', 'refreshChain',
  'selectScheduleChain'].every((c) => ratesRw.includes("chain: '" + c + "'")));

// ── Agreements ───────────────────────────────────────────────────────────────────────────────────────────
const agreements = A.newestFirst([
  { id: 31, agreementNumber: 'RNT-0002', agreementName: 'Lone Star MSA', customerName: 'Lone Star Paving', agreementType: 'RENTAL', status: 'ACTIVE',
    effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-12-19T00:00:00Z', lines: 2 },
  { id: 30, agreementNumber: 'RNT-0001', agreementName: 'Gulf pipeline 2025', customerName: 'Gulf Midstream', agreementType: 'RENTAL', status: 'EXPIRED',
    effectiveFrom: '2025-01-01T00:00:00Z', effectiveTo: '2025-12-31T00:00:00Z', lines: 4 },
  { id: 32, agreementNumber: 'ST-0001', agreementName: 'Short term trench kit', customerName: 'Acme Utilities', agreementType: 'SHORT_TERM', status: 'DRAFT',
    effectiveFrom: '2026-11-06T00:00:00Z', effectiveTo: '2027-02-02T00:00:00Z', lines: 1 },
  { id: 33, agreementNumber: 'RNT-0003', agreementName: 'Permian 2027', customerName: 'Basin Energy', agreementType: 'RENTAL', status: 'PENDING',
    effectiveFrom: '2027-01-03T00:00:00Z', effectiveTo: '2027-12-31T00:00:00Z', lines: 10 },
  { id: 34, agreementNumber: 'RNT-0004', agreementName: '', customerName: 'Lone Star Paving', agreementType: 'RENTAL', status: 'DRAFT',
    effectiveFrom: '2026-11-01T00:00:00Z', effectiveTo: '2027-03-31T00:00:00Z', lines: 0 },
].map(A.listRow));

T.section('Agreements: the table\'s rows, a status as Oracle\'s badge');
const arows = plain(RW.agreementRows(agreements, TODAY));
T.eq('a row per agreement, keyed by its number, newest first', arows.map((r) => r.key).join(), 'RNT-0004,RNT-0003,ST-0001,RNT-0002,RNT-0001');
T.eq('a row in words', JSON.stringify(arows[3]), JSON.stringify({ key: 'RNT-0002', number: 'RNT-0002', name: 'Lone Star MSA', customer: 'Lone Star Paving',
  type: 'RENTAL', status: 'Active', badge: 'oj-badge oj-badge-success oj-badge-subtle', stored: 'ACTIVE', dates: '1 Jan – 19 Dec 2026', ends: 'Ends in 45 days',
  lines: '2 lines', next: 'Ends in 45 days: renew it with the customer, or let it end' }));
T.eq('each status\'s badge: draft neutral, pending info, active success, expired neutral', arows.map((r) => r.status + '=' + r.badge.replace('oj-badge ', '')).join(' | '),
  'Draft=oj-badge-subtle | Pending=oj-badge-info oj-badge-subtle | Draft=oj-badge-subtle | Active=oj-badge-success oj-badge-subtle | Expired=oj-badge-subtle');
T.eq('rejected and cancelled: danger', [RW.agreementRows([A.listRow({ agreementNumber: 'X', status: 'REJECTED' })])[0].badge,
  RW.agreementRows([A.listRow({ agreementNumber: 'Y', status: 'CANCELLED' })])[0].badge].join(' | '), 'oj-badge oj-badge-danger oj-badge-subtle | oj-badge oj-badge-danger oj-badge-subtle');
T.eq('a row without a number keeps a key of its own', RW.agreementRows([A.listRow({ id: 7, agreementNumber: '' })])[0].key, 'id:7');

T.section('Agreements: a filter per column, with what the agreements hold and how many');
const ao = plain(RW.agreementOptions(agreements, TODAY));
T.eq('Agreement: newest first, with its name', labels(ao.number), 'RNT-0004 | RNT-0003 · Permian 2027 | ST-0001 · Short term trench kit | RNT-0002 · Lone Star MSA | RNT-0001 · Gulf pipeline 2025');
T.eq('Customer', labels(ao.customer), 'Acme Utilities (1) | Basin Energy (1) | Gulf Midstream (1) | Lone Star Paving (2)');
T.eq('Type', labels(ao.type), 'RENTAL (4) | SHORT_TERM (1)');
T.eq('Status: the list\'s chips, with their counts', labels(ao.chip), 'All (5) | Ending soon (1) | Draft (2) | Pending (1) | Active (1) | Expired (1)');
T.eq('Valid: where today is in each agreement', labels(ao.dates), 'In effect now (2) | Starting later (2) | Ending within 60 days (1) | Ended (1)');
T.eq('Lines: in number order', labels(ao.lines), '0 lines (1) | 1 line (1) | 2 lines (1) | 4 lines (1) | 10 lines (1)');
T.eq('Next step, in short', labels(ao.next), 'Add its lines, then Finance approves it (1) | Ended (1) | Ending soon (1) | Finance to approve it (2)');

T.section('Agreements: picking one keeps the agreements that have it');
const apick = (f) => RW.agreementByColumns(agreements, f, TODAY).map((r) => r.agreementNumber).join();
T.eq('nothing picked: all', apick({}), 'RNT-0004,RNT-0003,ST-0001,RNT-0002,RNT-0001');
T.eq('Agreement', apick({ number: 'ST-0001' }), 'ST-0001');
T.eq('Customer', apick({ customer: 'Lone Star Paving' }), 'RNT-0004,RNT-0002');
T.eq('Type', apick({ type: 'SHORT_TERM' }), 'ST-0001');
T.eq('Valid: in effect now; starting later', [apick({ dates: 'now' }), apick({ dates: 'later' })].join(' / '), 'RNT-0004,RNT-0002 / RNT-0003,ST-0001');
T.eq('Lines', apick({ lines: '10 lines' }), 'RNT-0003');
T.eq('Next step', apick({ next: 'Finance to approve it' }), 'RNT-0003,ST-0001');
T.eq('two at once: both must hold', apick({ customer: 'Lone Star Paving', next: 'Ending soon' }), 'RNT-0002');

T.section('An agreement: the record\'s header');
const AgreementPage = load(path.join(PAGES, 'agreement-page.js'), { 'resources/js/agreementRules': A, 'resources/js/exportKit': { FORMATS: [] }, 'resources/js/fmt': fmt,
  'resources/js/commercialRedwood': RW });
const gp = new AgreementPage();
T.eq('its status as the header\'s badge (none on the form)', JSON.stringify([gp.rwBadge('view', 'PENDING'), gp.rwBadge('view', 'REJECTED'), gp.rwBadge('edit', 'DRAFT')]),
  JSON.stringify([{ text: 'Pending', status: 'info' }, { text: 'Rejected', status: 'danger' }, { text: '' }]));
T.eq('a draft: Approve on the band; Reject, Edit, Export, Refresh', [plain(gp.rwPrimary('view', true, 'DRAFT', false, 1, false, null)).display,
  ids(gp.rwActions('view', true, 'DRAFT', false, null))].join(' / '), 'on / reject,edit,export,refresh');
T.eq('…no lines yet: Approve held (as Current\'s)', plain(gp.rwPrimary('view', true, 'DRAFT', false, 0, false, null)).display, 'disabled');
T.eq('active, or read only: no Approve; export and refresh', [plain(gp.rwPrimary('view', true, 'ACTIVE', false, 2, false, null)).display, ids(gp.rwActions('view', true, 'ACTIVE', false, null)),
  plain(gp.rwPrimary('view', false, 'DRAFT', false, 2, false, null)).display, ids(gp.rwActions('view', false, 'DRAFT', false, null))].join(' / '),
  'off / export,refresh / off / export,refresh');
T.eq('the form: Save or Create on the band, Cancel or Close beside it', [gp.rwPrimary('edit', true, '', false, 0, false, { agreementNumber: 'X' }).label,
  gp.rwPrimary('edit', true, '', false, 0, false, null).label, gp.rwPrimary('edit', true, '', false, 0, true, null).display,
  plain(gp.rwActions('edit', true, '', false, null))[0].label, plain(gp.rwActions('edit', true, '', false, {}))[0].label].join(' | '),
  'Save agreement | Create agreement | disabled | Close | Cancel');
T.eq('the subtitle: the kicker and the line under Current\'s title', gp.rwSubtitle('view', 'RENTAL', 'RNT-0002', 'Lone Star Paving', '2026-01-01', '2099-12-19', 'ACTIVE', null),
  'Rental agreement · RENTAL · RNT-0002 · Lone Star Paving · 1 Jan 2026 – 19 Dec 2099');
T.eq('the header shows where Current\'s head shows', [gp.rwHidden('redwood', 'view', 31, '', ''), gp.rwHidden('redwood', 'view', null, '', ''),
  gp.rwHidden('redwood', 'view', 31, 'failed', ''), gp.rwHidden('redwood', 'edit', null, '', ''), gp.rwHidden('current', 'view', 31, '', ''),
  gp.rwHidden('redwood', 'view', 31, '', 'off')].join(), 'false,true,true,false,true,true');
const agrRw = fs.readFileSync(path.join(PAGES, 'agreement-page-chains', 'rwChain.js'), 'utf8');
T.check('every action the header offers is routed to Current\'s chain', ['reject', 'edit', 'export', 'refresh', 'cancel'].every((id) => agrRw.includes("id === '" + id + "'"))
  && ['approveChain', 'saveChain', 'rejectChain', 'uiChain', 'exportChain'].every((c) => agrRw.includes("'" + c + "'")));

T.section('Smart Search\'s criterion, read in both forms');
T.eq('text and a filter on the node', JSON.stringify(plain(RW.readCriterion({ op: '$and', criteria: [{ text: ' gulf ' }, { op: '$eq', attribute: 'chip', value: 'ACTIVE' }] }))),
  JSON.stringify({ text: 'gulf', fields: { chip: 'ACTIVE' } }));
T.eq('a filter inside an object', JSON.stringify(plain(RW.readCriterion({ op: '$eq', value: { usedBy: 'Yard Houston Yard' } }))),
  JSON.stringify({ text: '', fields: { usedBy: 'Yard Houston Yard' } }));
T.eq('nothing', JSON.stringify(plain(RW.readCriterion(undefined))), JSON.stringify({ text: '', fields: {} }));

// ── the config, the page and the markup agree ────────────────────────────────────────────────────────────
[['rates', 'ratesSearchConfig.json', 'Schedule,Used by,Effective,Currency,Status', 'name,usedBy,dates,currency,chip', "'name', 'usedBy', 'dates', 'currency'",
  "c.fields.chip || 'all'"],
 ['agreements', 'agreementsSearchConfig.json', 'Agreement,Customer,Type,Status,Valid,Lines,Next step', 'number,customer,type,chip,dates,lines,next',
   "'number', 'customer', 'type', 'dates', 'lines', 'next'", "c.fields.chip || 'all'"]].forEach(([pg, file, want, fields, cols, chip]) => {
  T.section(pg + ': the config, the page and the markup agree');
  const cfg = JSON.parse(fs.readFileSync(path.join(NEXT, 'resources', 'data', file), 'utf8'));
  const pj = JSON.parse(fs.readFileSync(path.join(PAGES, pg + '-page.json'), 'utf8'));
  const html = fs.readFileSync(path.join(PAGES, pg + '-page.html'), 'utf8');
  const ks = Object.keys(cfg.filters);
  T.eq('the filters, in the columns\' order', ks.map((k) => cfg.filters[k].label).join(), want);
  const columns = /columns='(\[[\s\S]*?\])'/.exec(html);
  T.eq('…are the table\'s columns', columns ? JSON.parse(columns[1]).map((c) => c.headerText).join() : '', want);
  T.check('…the table: fixed layout, every column a share of its width', /layout="fixed"/.test(html) && columns
    && JSON.parse(columns[1]).reduce((s, c) => s + Number((/width:(\d+)%/.exec(c.style) || [0, 0])[1]), 0) === 100);
  const ctx = pj.variables.rwSearchContext.defaultValue.$search.filters;
  T.eq('every filter has its search context (one without throws and blanks the table)', ks.filter((k) => !ctx[k]).join(), '');
  T.check('every context reads an options list the page fills', ks.every((k) => {
    const m = /\$page\.variables\.(\w+)ADP/.exec(ctx[k].options.optionsData);
    return m && pj.variables[m[1]] && pj.variables[m[1] + 'ADP'] && pj.variables[m[1] + 'ADP'].defaultValue.keyAttributes === 'value';
  }));
  const sugg = /suggestion-filters='(\[[^']*\])'/.exec(html);
  T.eq('Smart Search offers them all', sugg ? JSON.parse(sugg[1]).join() : '', ks.join());
  T.eq('the fields the filter chain reads', ks.map((k) => cfg.filters[k].options.field).join(), fields);
  const chain = fs.readFileSync(path.join(PAGES, pg + '-page-chains', 'rwFilterChain.js'), 'utf8');
  T.check('…each one read by the filter chain', chain.includes(cols) && chain.includes(chip));
  T.check('the search config is the page\'s', pj.variables.rwSearchConfig.defaultValue.url.includes('resources/data/' + file));
  T.check('Oracle\'s templates and components are imported', ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button']
    .every((c) => pj.imports.components[c]));
  T.check('the Redwood view goes on the page once Redwood is shown, hidden under Current', /<oj-bind-if test="\[\[ \$application\.variables\.lookSeen \]\]">/.test(html)
    && /class="nx-rw"[^>]*:hidden="\[\[ \$application\.variables\.look !== 'redwood'/.test(html));
  T.check('Current\'s head shows under Current only', /<oj-bind-if test="\[\[ \$application\.variables\.look !== 'redwood' \]\]">\s*<div class="nx-pagehead">/.test(html));
});
const aj = JSON.parse(fs.readFileSync(path.join(PAGES, 'agreement-page.json'), 'utf8'));
const ah = fs.readFileSync(path.join(PAGES, 'agreement-page.html'), 'utf8');
T.check('the agreement: Oracle\'s general overview page imported and on the page once Redwood is shown', !!aj.imports.components['oj-sp-general-overview-page']
  && /<oj-bind-if test="\[\[ \$application\.variables\.lookSeen \]\]">\s*<div class="nx-rw nx-rw--head" id="agrRwHead"/.test(ah));
T.eq('…both of Current\'s heads (the agreement, its form) under Current only', (ah.match(/<oj-bind-if test="\[\[ \$application\.variables\.look !== 'redwood' \]\]">\s*<div class="nx-pagehead">/g) || []).length, 2);
const rj = JSON.parse(fs.readFileSync(path.join(PAGES, 'rates-page.json'), 'utf8'));
const rh = fs.readFileSync(path.join(PAGES, 'rates-page.html'), 'utf8');
T.check('Rates: the record\'s header too, and the left-hand list under Current only', !!rj.imports.components['oj-sp-general-overview-page']
  && /id="ratesRwHead"/.test(rh) && /<oj-bind-if test="\[\[ \$application\.variables\.look !== 'redwood' \]\]">\s*<section class="nx-card nx-cm-list"/.test(rh));
const ids2 = (html) => (html.match(/\sid="([^"]+)"/g) || []).map((m) => m.slice(5, -1));
[['rates', rh], ['agreements', fs.readFileSync(path.join(PAGES, 'agreements-page.html'), 'utf8')], ['agreement', ah]].forEach(([pg, html]) => {
  const all = ids2(html);
  T.eq(pg + ': every id once', all.filter((x, i) => all.indexOf(x) !== i).join(), '');
});
const css = fs.readFileSync(path.join(NEXT, 'resources', 'css', 'next-commercial.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rwRules = css.split('}').map((r) => r.split('{')[0].trim()).filter((s) => /redwood|nx-rw/.test(s));
T.check('the Commercial stylesheet speaks for Redwood only with html[data-nx-look="redwood"]', rwRules.length > 0
  && rwRules.every((sel) => sel.split(',').every((one) => /^html\[data-nx-look="redwood"\]/.test(one.trim()))), rwRules.join(' || '));
T.report();
