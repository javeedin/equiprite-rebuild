/*
 * EquipRite Next, the Redwood views of the customer, admin and insights screens:
 *   - the customer portal's Requests list (resources/js/portalRedwood.js): one plain oj-table row per request, a filter per
 *     column (Request, Dates, Where your equipment is, Next, Contract) then Show, each offering what the requests hold
 *     with how many; picking one keeps the requests that have it; Smart Search's criterion read in both its shapes; the
 *     search config, the page's search context and the Smart Search markup agree
 *   - every screen of the group: Oracle's general overview page put on the page once Redwood is seen and hidden under
 *     Current, the current head only under Current, its imports, its listeners and functions, no array literals in
 *     bindings, an action's display as oj-sp reads it, and Redwood rules only under html[data-nx-look="redwood"]
 *
 * Run:  node tests/next-redwood-admin.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const JS = path.join(NEXT, 'resources', 'js');

function load(file, deps) {
  const sandbox = { console, Intl, Date, JSON, Math, Object, Array, String, Number, Boolean, isNaN };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n] || {})); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const js = (name, deps) => load(path.join(JS, name + '.js'), deps);
const rules = js('rules');
const fmt = js('fmt');
const Progress = js('requestProgress');
const list = js('requestList', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/rules': rules });
const R = js('portalRedwood', { 'resources/js/fmt': fmt, 'resources/js/requestList': list });

const NOW = Date.UTC(2026, 10, 4, 10);
// Rows as the portal decorates them (portalView.decorate): what the Redwood rows are made from.
const rows = [
  { id: 905, requestNumber: 'EQR-000905', status: 'DRAFT', headline: 'Draft', p: { tone: 'draft' }, next: 'Check it and send it', mine: true, contractNumber: '',
    startDate: '2026-11-14', endDate: '2026-11-24', dates: '14 Nov – 24 Nov 2026', when: 'Starts in 10 days', createdDate: '2026-11-03', lines: 1, linesRead: true, detail: '', late: '' },
  { id: 700, requestNumber: 'EQR-000700', status: 'IN_PROCESS', headline: 'Partly shipped · 2 of 3', p: { tone: 'out' }, next: 'Accept the delivery when it arrives (2 pieces)', mine: true,
    contractNumber: 'K-2026-0700', startDate: '2026-11-05', endDate: '2026-12-01', dates: '5 Nov – 1 Dec 2026', when: 'Starts tomorrow', createdDate: '2026-10-30', lines: 3,
    linesRead: true, detail: '2 on the way · 1 getting ready', late: '' },
  { id: 520, requestNumber: 'EQR-000520', status: 'DEPLOYED', headline: 'On site', p: { tone: 'onsite' }, next: 'Return it: it was due back 2 Nov', mine: true,
    contractNumber: 'K-2026-0520', startDate: '2026-10-11', endDate: '2026-11-02', dates: '11 Oct – 2 Nov 2026', when: 'Ended 2 days ago', createdDate: '2026-10-05', lines: 2,
    linesRead: true, detail: '', late: '2 past their end date' },
  { id: 377, requestNumber: 'EQR-000377', status: 'CLOSED', headline: 'Completed', p: { tone: 'done' }, next: '', mine: false, contractNumber: 'K-2026-0377',
    startDate: '2026-09-05', endDate: '2026-09-30', dates: '5 Sep – 30 Sep 2026', when: 'Ended 35 days ago', createdDate: '2026-09-01', lines: 1, linesRead: false, detail: '', late: '' },
];
const chips = [{ key: 'needs', label: 'Needs you', count: 1 }, { key: 'open', label: 'Open', count: 3 }, { key: 'done', label: 'Finished', count: 1 }, { key: 'all', label: 'All', count: 4 }];

T.section('the customer portal\'s Redwood rows: one plain row per request, Oracle\'s badges');
const out = R.rows(rows, NOW);
T.eq('a row per request, keyed by its id', out.map((r) => r.key + ':' + r.number).join(), '905:EQR-000905,700:EQR-000700,520:EQR-000520,377:EQR-000377');
T.eq('the cells', JSON.stringify(Object.assign({}, out[1], { badge: undefined })), JSON.stringify({ key: '700', number: 'EQR-000700', raised: 'Raised ' + fmt.date('2026-10-30', false),
  dates: '5 Nov – 1 Dec 2026', when: 'Starts tomorrow', status: 'Partly shipped · 2 of 3', badge: undefined, detail: '2 on the way · 1 getting ready',
  next: 'Accept the delivery when it arrives (2 pieces)', mine: true, late: '', contract: 'K-2026-0700' }));
T.eq('statuses are Oracle\'s oj-badge classes, by stage', out.map((r) => r.badge).join(' | '),
  'oj-badge oj-badge-subtle | oj-badge oj-badge-info | oj-badge oj-badge-success oj-badge-subtle | oj-badge oj-badge-subtle');
T.eq('nothing next, no contract: a dash; equipment not read: its lines', [out[3].next, out[0].contract, out[3].detail].join(' | '), '— | — | 1 line');
T.eq('a record\'s header badge: { text, status } as oj-sp reads it', JSON.stringify([R.headerBadge('On site', 'onsite'), R.headerBadge('Turned down', 'stopped'), R.headerBadge('', 'x')]),
  JSON.stringify([{ text: 'On site', status: 'success' }, { text: 'Turned down', status: 'danger' }, { text: '', status: 'neutral' }]));

T.section('a filter per column, then Show; each offers what the requests hold, with how many');
const opts = R.options(rows, chips, NOW);
T.eq('Request: newest first, with where it stands', opts.number.map((o) => o.value + '=' + o.label).join(' | '),
  'EQR-000905=EQR-000905 · Draft | EQR-000700=EQR-000700 · Partly shipped · 2 of 3 | EQR-000520=EQR-000520 · On site | EQR-000377=EQR-000377 · Completed');
T.eq('Dates: the rental\'s window, as on Requests', opts.dates.map((o) => o.label).join(' | '),
  list.DATE_WINDOWS.map((w) => w.label + ' (' + rows.filter((r) => list.dateKeys(r, NOW).indexOf(w.key) !== -1).length + ')').join(' | '));
T.eq('Where your equipment is', opts.status.map((o) => o.label).join(' | '), 'Completed (1) | Draft (1) | On site (1) | Partly shipped · 2 of 3 (1)');
T.eq('Next (nothing: said so)', opts.next.map((o) => o.label).join(' | '),
  'Accept the delivery when it arrives (2 pieces) (1) | Check it and send it (1) | Nothing for now (1) | Return it: it was due back 2 Nov (1)');
T.eq('Contract (none yet: said so)', opts.contract.map((o) => o.label).join(' | '), 'K-2026-0377 (1) | K-2026-0520 (1) | K-2026-0700 (1) | No contract yet (1)');
T.eq('Show: the portal\'s own chips', opts.group.map((o) => o.value + '=' + o.label).join(' | '), 'needs=Needs you (1) | open=Open (3) | done=Finished (1) | all=All (4)');

T.section('picking a filter keeps the requests that have it');
const pick = (f) => R.byColumns(rows, Object.assign({ number: '', dates: '', status: '', next: '', contract: '' }, f), NOW).map((r) => r.requestNumber).join();
T.eq('nothing picked: every request', pick({}), 'EQR-000905,EQR-000700,EQR-000520,EQR-000377');
T.eq('Contract', pick({ contract: 'K-2026-0700' }), 'EQR-000700');
T.eq('No contract yet', pick({ contract: 'No contract yet' }), 'EQR-000905');
T.eq('Where your equipment is', pick({ status: 'On site' }), 'EQR-000520');
T.eq('Next: nothing for now', pick({ next: 'Nothing for now' }), 'EQR-000377');
T.eq('Dates: ended', pick({ dates: 'ended' }), 'EQR-000520,EQR-000377');
T.eq('two at once: both must hold', pick({ dates: 'ended', contract: 'K-2026-0377' }), 'EQR-000377');

T.section('Smart Search\'s criterion, in both its shapes, as the page\'s own search, chip and columns');
T.eq('nothing: all, no text, no column', JSON.stringify(R.readCriterion(null)), JSON.stringify({ text: '', group: 'all', cols: { number: '', dates: '', status: '', next: '', contract: '' } }));
T.eq('a picked filter (its value inside an object), text, and a flat one', JSON.stringify(R.readCriterion({ op: '$and', $tag: '_root_', criteria: [
  { op: '$eq', value: { group: 'open' }, $tag: 'GroupFilter' }, { op: '$eq', value: { contract: 'K-2026-0700' }, $tag: 'ContractFilter' },
  { text: ' dump ', $tag: '$keyword$', matchBy: 'phrase' }, { op: '$eq', attribute: 'status', value: 'On site' }] })),
JSON.stringify({ text: 'dump', group: 'open', cols: { number: '', dates: '', status: 'On site', next: '', contract: 'K-2026-0700' } }));

T.section('the portal\'s config, page and markup agree');
const PAGES = path.join(NEXT, 'flows', 'customer', 'pages');
const cfg = JSON.parse(fs.readFileSync(path.join(NEXT, 'resources', 'data', 'portalRequestsSearchConfig.json'), 'utf8'));
const pj = JSON.parse(fs.readFileSync(path.join(PAGES, 'portal-page.json'), 'utf8'));
const phtml = fs.readFileSync(path.join(PAGES, 'portal-page.html'), 'utf8');
const ids = Object.keys(cfg.filters);
T.eq('the filters, in the columns\' order, then Show', ids.map((k) => cfg.filters[k].label).join(','), 'Request,Dates,Where your equipment is,Next,Contract,Show');
const cols = (/columns='(\[[\s\S]*?\])'/.exec(phtml) || [])[1];
T.eq('… the table\'s columns', cols ? JSON.parse(cols).map((c) => c.headerText).join(',') : '', 'Request,Dates,Where your equipment is,Next,Contract');
T.eq('… their widths add up to the table', cols ? JSON.parse(cols).reduce((s, c) => s + parseFloat(/width:(\d+)%/.exec(c.style)[1]), 0) : 0, 100);
const ctx = pj.variables.rwSearchContext.defaultValue.$search.filters;
T.eq('every filter has its search context (one without throws and blanks the table)', ids.filter((k) => !ctx[k]).join(), '');
T.check('every context reads an options list the page fills', ids.every((k) => {
  const m = /\$page\.variables\.(\w+)ADP/.exec(ctx[k].options.optionsData);
  return m && pj.variables[m[1]] && pj.variables[m[1] + 'ADP'];
}));
const sugg = /suggestion-filters='(\[[^']*\])'/.exec(phtml);
T.eq('Smart Search offers them all', sugg ? JSON.parse(sugg[1]).join() : '', ids.join());
T.eq('the fields the criterion carries', ids.map((k) => cfg.filters[k].options.field).join(), R.COLUMNS.concat(['group']).join());
T.check('the Redwood list is kept once put on the page (Smart Search throws if taken off), hidden in the other views and under Current',
  /<oj-bind-if test="\[\[ \$application\.variables\.lookSeen \]\]">\s*<section class="nx-rw nx-cu-rwlist" id="cuRwRequests"[^>]*:hidden="\[\[ \$functions\.rwListHidden/.test(phtml));
T.check('the current Requests list shows under Current only', /\$variables\.view === 'requests' && \$application\.variables\.look !== 'redwood'/.test(phtml));
const setChain = fs.readFileSync(path.join(PAGES, 'portal-page-chains', 'setChain.js'), 'utf8');
T.check('opening the Requests view under Redwood applies Smart Search (rwShowChain), and so does choosing Redwood there',
  /chain: 'rwShowChain'/.test(setChain) && pj.eventListeners.lookChanged.chains[0].chain === 'rwShowChain');

T.section('every screen of the group: Oracle\'s general overview page as its header under Redwood');
const SCREENS = [
  ['customer', 'portal', 'cuRedwood'], ['customer', 'request', 'crRedwood'], ['customer', 'quote', 'cqRedwood'], ['customer', 'invoice', 'ciRedwood'],
  ['customer', 'order', 'coRedwood'], ['admin', 'settings', 'stRedwood'], ['admin', 'access', 'acRedwood'], ['admin', 'integrations', 'ihRedwood'],
  ['admin', 'sql', 'sqlRedwood'], ['insights', 'analytics', 'anRedwood'], ['fdd', 'fdd', 'fddRedwood'],
];
SCREENS.forEach(([flow, pg, id]) => {
  const dir = path.join(NEXT, 'flows', flow, 'pages');
  const html = fs.readFileSync(path.join(dir, pg + '-page.html'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(dir, pg + '-page.json'), 'utf8'));
  const Mod = load(path.join(dir, pg + '-page.js'));
  const view = new RegExp('<oj-bind-if test="\\[\\[ \\$application\\.variables\\.lookSeen[^"]*\\]\\]">\\s*<div class="nx-rw nx-rw--head" id="' + id
    + '" :hidden="\\[\\[ \\$application\\.variables\\.look !== \'redwood\' \\]\\]">\\s*<oj-sp-general-overview-page ');
  T.check(pg + ': its Redwood view, put on the page once Redwood is seen, hidden under Current', view.test(html));
  T.check(pg + ': the current head under Current only', /<oj-bind-if test="\[\[ \$application\.variables\.look !== 'redwood' \]\]">\s*<div class="nx-pagehead">/.test(html));
  T.eq(pg + ': imports Oracle\'s template', (json.imports.components['oj-sp-general-overview-page'] || {}).path, 'oj-sp/general-overview-page/loader');
  const listeners = [...new Set((html.match(/\$listeners\.(\w+)/g) || []).map((m) => m.split('.')[1]))];
  T.eq(pg + ': every listener declared', listeners.filter((l) => !json.eventListeners[l]).join(), '');
  const fns = [...new Set((html.match(/\$functions\.(\w+)/g) || []).map((m) => m.split('.')[1]))];
  T.eq(pg + ': every page function exists', fns.filter((f) => typeof Mod.prototype[f] !== 'function').join(), '');
  const head = (new RegExp('id="' + id + '"[\\s\\S]*?</oj-sp-general-overview-page>').exec(html) || [''])[0];
  const binds = head.match(/\[\[[\s\S]*?\]\]/g) || [];
  T.eq(pg + ': no array or object literals, arrows or String() in its bindings', binds.filter((b) => /=>|\[\[\s*[[{]|[(,:]\s*\[|\bString\(|\bNumber\(|\bBoolean\(/.test(b)).join(), '');
  T.eq(pg + ': its ids are its own (prefixed)', (html.match(/\bid="[^"]*Rw[^"]*"|\bid="[a-z]+Redwood"/g) || []).length > 0 && (html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1);
});

T.section('an action\'s display is what oj-sp reads (on, off or disabled; a disabled flag is overwritten)');
const mod = (flow, pg) => new (load(path.join(NEXT, 'flows', flow, 'pages', pg + '-page.js'), { 'resources/js/portalRedwood': R }))();
const settings = mod('admin', 'settings');
T.eq('Settings: Save disabled until a change is staged, Discard only then', JSON.stringify([settings.rwPrimary(0, false, false).display, settings.rwPrimary(2, false, false).label,
  settings.rwPrimary(2, false, true).display, settings.rwActions(0, false)[0].display, settings.rwActions(1, true)[0].display]), JSON.stringify(['disabled', 'Save 2 changes', 'disabled', 'off', 'disabled']));
const access = mod('admin', 'access');
T.eq('Access: Save for a role that may edit, Export once there are rows', JSON.stringify([access.rwPrimary(1, false, false).display, access.rwPrimary(1, false, true).display,
  access.rwActions(0, false, 0)[1].display]), JSON.stringify(['disabled', 'on', 'disabled']));
const portalMod = mod('customer', 'portal');
T.eq('Portal: New request for a sign-in that may raise one; Refresh off while it reads', JSON.stringify([portalMod.rwPrimary(false).display, portalMod.rwActions(true)[0].display,
  portalMod.rwListHidden('redwood', 'requests'), portalMod.rwListHidden('current', 'requests'), portalMod.rwListHidden('redwood', 'home')]), JSON.stringify(['off', 'disabled', false, true, true]));
const fdd = mod('fdd', 'fdd');
T.eq('FDD: Export says what it takes from the open tab', ['requirements', 'flows', 'mapping'].map((t) => fdd.rwActions(t, false)[0].label).concat([fdd.rwActions('mapping', true)[0].label]).join(' | '),
  'Export the requirements to Excel | Export this flow to Excel | Export the mapping to Excel | Export the drill to Excel');
const every = SCREENS.map(([flow, pg]) => {
  const src = fs.readFileSync(path.join(NEXT, 'flows', flow, 'pages', pg + '-page.js'), 'utf8');
  return /disabled: !!|disabled: !/.test(src) ? pg : '';
}).filter(Boolean);
T.eq('no action relies on a disabled flag', every.join(), '');

T.section('Redwood rules only under html[data-nx-look="redwood"], in each screen\'s own stylesheet');
['next-customer', 'next-insights-admin', 'next-sql', 'next-fdd'].forEach((name) => {
  const css = fs.readFileSync(path.join(NEXT, 'resources', 'css', name + '.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const sels = (css.match(/(^|\})\s*([^{}@]+)\{/g) || []).map((m) => m.replace(/^\}?\s*/, '').replace(/\{$/, '').trim());
  const rw = sels.filter((s) => /data-nx-look/.test(s));
  T.eq(name + ': every Redwood selector starts with html[data-nx-look="redwood"]', rw.filter((s) => s.split(',').some((one) => !/^html\[data-nx-look="redwood"\]/.test(one.trim()))).join(' | '), '');
});

T.report();
