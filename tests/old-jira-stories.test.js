/*
 * Old EquipRite, Jira Stories (flows/setup/pages/jira-stories-page.*, Administrator menu): the EquipRite backlog read
 * from Jira through resources/js/jiraBacklog.js (identical to EquipRite Next's).
 *   - wired: the page registered in the setup flow; its menu item in the Administrator group, gated like Configuration
 *     Settings (EQR_CONFIGURATIONS: its page code, its nav id, its route, navigateChain), hidden when that code is
 *   - the page: every chain its json names exists, every listener and $functions call the html uses is defined, every
 *     component it uses is imported, VBCS's binding rules (no arrow functions, array or object literals, String(),
 *     Number() or Boolean() in a binding), the Smart Search config, search context and filters agree, a weight per
 *     column of the fixed-layout table, the collection container's content inside an element that is always there,
 *     the page-access guard byte-identical to Configuration Settings'
 *   - the page module: Smart Search's criterion read, the rows shown, the KPI tiles, what a click in the analysis
 *     applies, the subtitle, the export
 *   - the chains, against a fake Actions: a read (connected; 401 = not connected; 400 = Jira's words and a toast), a
 *     filter, a pick, a preset, a row into the drawer, Connect in the desktop app
 *
 * Run:  node tests/old-jira-stories.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const APP = H.APP;
const PAGES = path.join(APP, 'flows', 'setup', 'pages');
const CHAINS = path.join(PAGES, 'jira-stories-page-chains');
const read = (f) => fs.readFileSync(f, 'utf8');
const html = read(path.join(PAGES, 'jira-stories-page.html'));
const pageJson = JSON.parse(read(path.join(PAGES, 'jira-stories-page.json')));
const plain = (x) => JSON.parse(JSON.stringify(x));

// ── loading the real modules ──────────────────────────────────────────────────────────────────────────────
let fetchAnswer = null; // what the desktop app's /__jira answers (null: not there, as in VBCS)
const fetched = [];
function loadJira() {
  const sandbox = { console, Date, JSON, Math, Promise, setTimeout };
  sandbox.fetch = async (url, o) => {
    fetched.push({ url, method: o.method, body: o.body ? JSON.parse(o.body) : null });
    const a = fetchAnswer ? fetchAnswer(url, o) : null;
    if (!a) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => a };
  };
  let J;
  sandbox.define = (names, factory) => { J = factory(); };
  vm.createContext(sandbox);
  vm.runInContext(read(path.join(APP, 'resources', 'js', 'jiraBacklog.js')), sandbox, { filename: 'jiraBacklog.js' });
  return J;
}
const J = loadJira();
function loadPageModule() {
  let Mod;
  const define = (deps, factory) => { Mod = factory.apply(null, deps.map((d) => (d === 'resources/js/jiraBacklog' ? J : {}))); };
  new Function('define', read(path.join(PAGES, 'jira-stories-page.js')))(define);
  return Mod;
}
const PageModule = loadPageModule();
const F = new PageModule();
function loadChain(name, Actions) {
  let mod;
  const define = (deps, factory) => {
    mod = factory.apply(null, deps.map((d) => (d === 'vb/action/actionChain' ? class ActionChain {} : d === 'vb/action/actions' ? Actions
      : d === 'resources/js/jiraBacklog' ? J : {})));
  };
  new Function('define', read(path.join(CHAINS, name + '.js')))(define);
  return mod;
}
function loadAppFunctions() {
  let Mod;
  const define = (deps, factory) => { Mod = factory.apply(null, deps.map(() => ({}))); };
  const document = { querySelectorAll: () => [], body: {} };
  function MutationObserver() { this.observe = () => {}; }
  new Function('define', 'document', 'MutationObserver', 'setTimeout', read(path.join(APP, 'app-flow.js')))(define, document, MutationObserver, () => 0);
  return new Mod();
}

// ── wired: flow, menu, route, page code ───────────────────────────────────────────────────────────────────
T.section('wired: the setup flow, the Administrator menu, its route, gated like Configuration Settings');
const flow = JSON.parse(read(path.join(APP, 'flows', 'setup', 'setup-flow.json')));
T.eq('setup-flow.json registers jira-stories', flow.pages['jira-stories'] && flow.pages['jira-stories'].path, 'pages/jira-stories-page');
const app = loadAppFunctions();
const ALL = { EQR_CONFIGURATIONS: 'FULL', EQR_RBAC_ADMIN: 'FULL', EQR_DASHBOARD: 'FULL' };
const admin = app.visibleNavGroups(ALL, true, {}, true).filter((g) => g.key === 'admin')[0];
const item = admin && admin.items.filter((i) => i.id === 'setup-jira-stories')[0];
T.check('a menu item in the Administrator group, after Configuration Settings and Page Access', !!item && admin.items.map((i) => i.id).join() === 'setup-configurations,setup-rbac-admin,setup-jira-stories');
T.eq('…labelled Jira Stories, with Configuration Settings\' page code', item && item.label + ' / ' + item.pageCode, 'Jira Stories / EQR_CONFIGURATIONS');
const iconElsewhere = (() => {
  const files = [];
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (/\.(html|js|json)$/.test(e.name) && !/app-flow\.js$|schedulerpro|mapbox/.test(p)) files.push(p);
    });
  })(path.join(__dirname, '..', 'webApps'));
  return item && /^oj-ux-ico-[a-z0-9-]+$/.test(item.icon) && files.some((f) => read(f).includes(item.icon));
})();
T.check('…an oj-ux-ico icon the repo already uses', iconElsewhere, item && item.icon);
T.eq('page id -> page code: EQR_CONFIGURATIONS (its guard gates it)', app.getPageCodeForPage({ id: 'jira-stories' }), 'EQR_CONFIGURATIONS');
T.eq('page id -> nav id (the menu highlights it)', app.getNavIdForPage({ id: 'jira-stories' }), 'setup-jira-stories');
T.eq('nav id -> route', JSON.stringify(app.getNavRoute('setup-jira-stories')), JSON.stringify({ flow: 'setup', page: 'jira-stories' }));
T.check('in the setup flow (a redirect from it stays in the flow)', app.isSameFlow({ id: 'jira-stories' }, 'setup') && !app.isSameFlow({ id: 'jira-stories' }, 'main'));
const hidden = app.visibleNavGroups({ EQR_CONFIGURATIONS: 'HIDDEN', EQR_RBAC_ADMIN: 'FULL' }, true, {}, true).filter((g) => g.key === 'admin')[0];
T.check('without Configuration Settings: no Jira Stories either', !hidden.items.some((i) => i.id === 'setup-jira-stories')
  && !app.navIdVisible({ EQR_CONFIGURATIONS: 'HIDDEN' }, true, 'setup-jira-stories') && app.navIdVisible({ EQR_CONFIGURATIONS: 'READ_ONLY' }, true, 'setup-jira-stories'));
T.check('…and its guard sends that user away', !app.canEnterPage({ EQR_CONFIGURATIONS: 'HIDDEN' }, true, app.getPageCodeForPage({ id: 'jira-stories' })));

(async () => {
  const navTo = [];
  const navActions = { navigateToFlow: async (ctx, o) => { navTo.push(o); } };
  let navMod;
  new Function('define', read(path.join(APP, 'pages', 'shell-page-chains', 'navigateChain.js')))((deps, factory) => {
    navMod = factory.apply(null, deps.map((d) => (d === 'vb/action/actionChain' ? class ActionChain {} : navActions)));
  });
  const shellPage = { variables: { isDrawerOpen: true } };
  await new navMod().run({ $page: shellPage, $application: { functions: app, variables: { pageAccessMap: ALL, pageAccessLoaded: true } } }, { pageId: 'setup-jira-stories' });
  T.eq('the menu click (navigateChain) opens setup/jira-stories', JSON.stringify(navTo[0]), JSON.stringify({ flow: 'setup', page: 'jira-stories' }));

  // ── the page: chains, listeners, functions, imports, binding rules ─────────────────────────────────────────
  T.section('the page: its chains, listeners, functions and components all exist');
  const named = [];
  Object.keys(pageJson.eventListeners).forEach((k) => (pageJson.eventListeners[k].chains || []).forEach((c) => named.push(c.chain)));
  T.check('every chain the json names is a file in jira-stories-page-chains', named.length > 8 && named.every((c) => fs.existsSync(path.join(CHAINS, c + '.js'))),
    named.filter((c) => !fs.existsSync(path.join(CHAINS, c + '.js'))).join());
  const files = fs.readdirSync(CHAINS).map((f) => f.replace(/\.js$/, ''));
  const called = (read(path.join(CHAINS, 'queryChain.js')) + read(path.join(CHAINS, 'connectionChain.js'))).match(/chain: '(\w+)'/g).map((m) => m.slice(8, -1));
  T.check('…every chain file is used (by a listener or by another chain)', files.every((f) => named.indexOf(f) !== -1 || called.indexOf(f) !== -1), files.join());
  T.eq('vbBeforeEnter: the page-access guard; vbEnter: the read', (pageJson.eventListeners.vbBeforeEnter.chains[0].chain + ' / ' + pageJson.eventListeners.vbEnter.chains[0].chain),
    'enforcePageAccessChain / loadJiraChain');
  T.check('the guard is byte-identical to Configuration Settings\' (no policy in the copy)',
    read(path.join(CHAINS, 'enforcePageAccessChain.js')) === read(path.join(PAGES, 'configurations-page-chains', 'enforcePageAccessChain.js')));
  const listeners = [...new Set((html.match(/\$listeners\.(\w+)/g) || []).map((m) => m.split('.')[1]))];
  T.check('every $listeners.X in the html is a listener in the json', listeners.length > 10 && listeners.every((l) => pageJson.eventListeners[l]),
    listeners.filter((l) => !pageJson.eventListeners[l]).join());
  const fns = [...new Set((html.match(/\$functions\.(\w+)/g) || []).map((m) => m.split('.')[1]))];
  T.check('every $functions.X in the html is a page module function', fns.length > 10 && fns.every((f) => typeof F[f] === 'function'), fns.filter((f) => typeof F[f] !== 'function').join());
  const tags = [...new Set((html.match(/<oj-[a-z-]+/g) || []).map((t) => t.slice(1)))];
  T.check('every component used is imported', tags.every((t) => pageJson.imports.components[t]), tags.filter((t) => !pageJson.imports.components[t]).join());
  const vars = [...new Set((html.match(/\$variables\.(\w+)/g) || []).map((m) => m.split('.')[1]))];
  T.check('every $variables.X in the html is a page variable', vars.every((v) => pageJson.variables[v]), vars.filter((v) => !pageJson.variables[v]).join());

  T.section('VBCS binding rules');
  const BAD = /=>|\[\[\s*[[{]|[(,:?|&]\s*\[|\bString\(|\bNumber\(|\bBoolean\(|\bfunction\s*\(/;
  const binds = (html.replace(/<!--[\s\S]*?-->/g, '').match(/\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\}/g) || []);
  T.eq('no arrow functions, array or object literals, String(), Number() or Boolean() in a binding',
    binds.filter((b) => BAD.test(b)).join(' '), '');
  T.check('…the rule catches them', ['[[ a || [] ]]', '[[ x ? [1] : y ]]', '[[ { a: 1 } ]]', '[[ f(function (e) {}) ]]', '[[ String(x) ]]', '[[ (e) => e ]]'].every((b) => BAD.test(b))
    && !['[[ m[k.key] ]]', '[[ $functions.items(x) ]]', "[[ a ? 'b' : 'c' ]]"].some((b) => BAD.test(b)));
  const jsonBinds = JSON.stringify(pageJson).match(/(\[\[|\{\{)[^\]}]*(\]\]|\}\})/g) || [];
  T.eq('…nor in the json\'s', jsonBinds.filter((b) => /=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)).join(' '), '');

  T.section('Smart Search: the config, the search context and the filters agree; a filter per column');
  const cfg = JSON.parse(read(path.join(APP, 'resources', 'data', 'jiraStoriesSearchConfig.json')));
  const ctx = pageJson.variables.searchContext.defaultValue.$search.filters;
  const sugg = JSON.parse(/suggestion-filters='([^']*)'/.exec(html)[1]);
  const FIELDS = { StatusFilter: 'status', EpicFilter: 'epic', AssigneeFilter: 'assignee', ReleaseFilter: 'release', SprintFilter: 'sprint', PriorityFilter: 'priority', TypeFilter: 'type' };
  T.eq('the filters: Status, Epic, Assignee, Release, Sprint, Priority, Type', Object.keys(cfg.filters).map((k) => cfg.filters[k].label).join(), 'Status,Epic,Assignee,Release,Sprint,Priority,Type');
  T.check('each filters the field jiraBacklog.filter reads', Object.keys(FIELDS).every((k) => cfg.filters[k] && cfg.filters[k].options.field === FIELDS[k]));
  T.check('every filter has its search-context entry, with options from a page ADP', Object.keys(cfg.filters).every((k) => {
    const c = ctx[k];
    const adp = c && /\$page\.variables\.(\w+)/.exec(c.options.optionsData);
    return c && adp && pageJson.variables[adp[1]] && pageJson.variables[adp[1]].type === 'vb/ArrayDataProvider2';
  }) && Object.keys(ctx).every((k) => cfg.filters[k]));
  T.eq('…and is offered as a suggestion', sugg.join(), Object.keys(cfg.filters).join());
  T.check('the config is the one the page loads', /jiraStoriesSearchConfig\.json/.test(pageJson.variables.searchConfiguration.defaultValue.url));

  T.section('the table, the collection container, the drawer');
  const cols = JSON.parse(/columns='([\s\S]*?)'\s/.exec(html)[1]);
  T.eq('the columns', cols.map((c) => c.headerText).join(), 'Key,Summary,Status,Priority,Assignee,Release,Due,Quality,Gaps');
  T.check('layout="fixed": a weight per column (oj-table sizes them by it)', /layout="fixed"/.test(html) && cols.every((c) => typeof c.weight === 'number' && c.weight > 0));
  T.check('every column template is a slot of the table', cols.filter((c) => c.template).every((c) => html.includes('slot="' + c.template + '"')));
  T.check('a row opens the drawer (ojRowAction, by key)', /on-oj-row-action="\[\[ \$listeners\.onRowAction \]\]"/.test(html)
    && pageJson.eventListeners.onRowAction.chains[0].parameters.key === '{{ $event.detail.context.key }}' && pageJson.variables.tableADP.defaultValue.keyAttributes === 'key');
  const container = /<oj-sp-collection-container>\s*<(\S+)[^>]*>/.exec(html);
  T.check('the collection container holds one element that is always there (#jiraPage), not an oj-bind-if', container && container[1] === 'div' && /<oj-sp-collection-container>\s*<div class="jira-page" id="jiraPage">/.test(html));
  T.check('the drawer: oj-drawer-popup and Oracle\'s general drawer template, its close button and Close listener', /<oj-drawer-popup id="jiraDrawer" opened="\{\{ \$variables\.drawerOpen \}\}"/.test(html)
    && /<oj-sp-general-drawer-template[\s\S]*close-action="\[\[ \$functions\.closeAction\(\) \]\]"[\s\S]*on-sp-close="\[\[ \$listeners\.onCloseDrawer \]\]"/.test(html)
    && JSON.stringify(F.closeAction()) === JSON.stringify({ label: 'Close', display: 'on' }));
  T.check('Open in Jira and Create an API token open a new tab, rel noopener', /id="jiraOpenInJira"[^>]*target="_blank" rel="noopener"/.test(html)
    && /href="https:\/\/id\.atlassian\.com\/manage-profile\/security\/api-tokens" target="_blank" rel="noopener">Create an API token</.test(html));
  T.check('the API token is a password input', /<oj-input-password id="jiraToken"/.test(html));
  T.check('outside the desktop app: who sets the connection', html.includes('Jira is not connected. A VBCS administrator sets it: Services &gt; Backends &gt; jira &gt; Authentication &gt; Basic (a Jira email and an Atlassian API token).'));
  T.check('the header: title, Refresh as the primary action', /page-title="Jira Stories"/.test(html) && /primary-action\.label="Refresh"/.test(html)
    && pageJson.eventListeners.spPrimaryAction.chains[0].chain === 'loadJiraChain');

  // ── the page module ───────────────────────────────────────────────────────────────────────────────────────
  const TODAY = '2026-11-05';
  const status = (name, key) => ({ name, statusCategory: { key } });
  const EPIC = { key: 'EQP-1', fields: { summary: 'Equipment Registry' } };
  const ISSUES = [
    { key: 'EQP-12', fields: { summary: 'Equipment Master List View - Section 7.2', issuetype: { name: 'Story' }, status: status('DEVELOPMENT', 'indeterminate'), priority: { name: 'Medium' },
      parent: EPIC, fixVersions: [{ name: '26C', releaseDate: '2026-09-30' }], assignee: { displayName: 'Rahul Kanth Panganamamula' }, duedate: '2026-10-07', updated: '2026-10-26',
      description: 'Display master list.Acceptance Criteria: Grid displays all columns per FDD 7.2.4; smart search returns results with type-ahead; all filter fields functional.FDD Section: 7.2',
      comment: { comments: [{ author: { displayName: 'Sana Suhana Thehaseen' }, created: '2026-09-29', body: '1. Type Column is missing.\n2. Map view is missing.' }] } } },
    { key: 'EQP-14', fields: { summary: 'Equipment Units List - Section 7.3', issuetype: { name: 'Story' }, status: status('TEST', 'indeterminate'), priority: { name: 'High' }, parent: EPIC,
      fixVersions: [{ name: '27A', releaseDate: '2026-12-31' }], assignee: { displayName: 'Aditi Rao' }, duedate: '2026-11-20', updated: '2026-11-03',
      description: 'Units.\n\nAcceptance Criteria: Units listed.\n\nFDD Section: 7.3', comment: { comments: [] } } },
    { key: 'EQP-30', fields: { summary: 'Notification engine', issuetype: { name: 'Story' }, status: status('FUNC DESIGN', 'indeterminate'), priority: { name: 'Medium' },
      description: 'Send notifications.', comment: { comments: [] }, updated: '2026-08-01' } },
  ];
  const rows = ISSUES.map((i) => F.decorate(J.fromIssue(i, { today: TODAY })));
  const analysis = J.analyse(rows, TODAY);

  T.section('the page module: Smart Search\'s criterion, the rows shown, a click in the analysis');
  const crit = { $tag: '_root_', op: '$and', criteria: [{ text: 'grid', matchBy: 'phrase' }, { op: '$eq', value: { status: 'DEVELOPMENT' } }, { op: '$eq', attribute: 'assignee', value: 'Nobody' }] };
  T.eq('the criterion read in both its shapes, with the words', JSON.stringify(F.readCriterion(crit)),
    JSON.stringify({ text: 'grid', status: 'DEVELOPMENT', epic: '', assignee: 'Nobody', release: '', sprint: '', priority: '', type: '' }));
  T.eq('…nothing picked: no filter', JSON.stringify(F.readCriterion(null)), JSON.stringify({ text: '', status: '', epic: '', assignee: '', release: '', sprint: '', priority: '', type: '' }));
  T.eq('the rows shown: Smart Search, then the pick', [F.shown(rows, { status: 'TEST' }, {}), F.shown(rows, {}, { only: 'overdue' }), F.shown(rows, { epic: 'EQP-1' }, { fdd: '7.3' }),
    F.shown(rows, { text: 'map view' }, {})].map((l) => l.map((r) => r.key).join()).join(' / '), 'EQP-14 / EQP-12 / EQP-14 / EQP-12');
  T.eq('a row decorated for the table', [rows[0].badge, rows[0].quality, rows[0].gapCount, rows[0].epicLine, rows[2].epicLine].join(' | '),
    'oj-badge oj-badge-info oj-badge-subtle | 4 · 2 checks | 2 | EQP-1 Equipment Registry | No epic');
  T.eq('Oracle\'s badges by status', [F.badge('Done', 'done'), F.badge('TEST', 'indeterminate'), F.badge('Bugs', 'indeterminate'), F.badge('ONHOLD', 'indeterminate'), F.badge('NEW', 'new')].join(' | '),
    'oj-badge oj-badge-success oj-badge-subtle | oj-badge oj-badge-info | oj-badge oj-badge-danger oj-badge-subtle | oj-badge oj-badge-warning oj-badge-subtle | oj-badge oj-badge-subtle');
  const fIdx = analysis.findings.findIndex((f) => f.filter.only === 'overdue');
  T.eq('a finding applies its own filter, labelled with its sentence', JSON.stringify(plain(F.pickOf('finding', '' + fIdx, analysis))),
    JSON.stringify({ filter: { only: 'overdue' }, label: analysis.findings[fIdx].text }));
  T.eq('a quality check, an FDD section', JSON.stringify([F.pickOf('check', 'noAc', analysis), F.pickOf('fdd', '7.2', analysis)].map(plain)),
    JSON.stringify([{ filter: { check: 'noAc' }, label: 'Quality check: No acceptance criteria' }, { filter: { fdd: '7.2' }, label: 'FDD section 7.2' }]));
  T.check('"Everything here is done" (no filter) and nonsense: nothing picked', F.pickOf('finding', '99', analysis) === null && F.pickOf('check', '', analysis) === null);

  T.section('the page module: the KPI tiles, the subtitle, the drawer');
  T.eq('the tiles', F.tiles(analysis.kpis).map((t) => t.label + '=' + t.value).join(' | '),
    'Items=3 | Done=0 | In progress=3 | On hold=0 | Overdue=1 | No acceptance criteria=1 | Tester gaps=2 | Average quality=' + analysis.kpis.avgScore + ' / 5');
  const conn = { state: 'connected', site: 'https://equiprite.atlassian.net', name: 'Priya Raman' };
  T.eq('the subtitle: project, site, how many, when', F.subtitle(conn, false, '', 205, '10:42', false), 'EQP · EquipRite on equiprite.atlassian.net · 205 items read at 10:42');
  T.eq('…while reading, not connected, a problem', [F.subtitle(conn, true, '', 0, '', false), F.subtitle({ state: 'refused' }, false, '', 0, '', false),
    F.subtitle(conn, false, 'Jira did not accept the search: bad.', 0, '', false)].join(' | '),
  'EQP · EquipRite on equiprite.atlassian.net · reading Jira… | EQP · EquipRite on equiprite.atlassian.net · Jira is not connected | EQP · EquipRite on equiprite.atlassian.net · Jira did not accept the search: bad.');
  T.eq('"Connected as"', F.connText(conn) + ' | ' + F.connText({ site: 'https://acme.atlassian.net' }), 'Connected as Priya Raman | Connected to acme.atlassian.net');
  T.eq('the acceptance criteria as a list (split on ;)', F.acItems(rows[0].ac).join(' | '), 'Grid displays all columns per FDD 7.2.4 | smart search returns results with type-ahead | all filter fields functional.');
  T.eq('the drawer\'s title and subtitle', F.drawerTitle(rows[0]) + ' | ' + F.drawerSubtitle(rows[0]), 'EQP-12 Equipment Master List View - Section 7.2 | DEVELOPMENT · EQP-1 Equipment Registry');
  T.eq('its facts', F.facts(rows[0]).slice(0, 6).map((x) => x.label + ': ' + x.value).join(' | '),
    'Assignee: Rahul Kanth Panganamamula | Release: 26C (2026-09-30) | Sprint: — | Earlier sprints: None | Due: 2026-10-07 (overdue) | FDD sections: 7.2');
  T.eq('the count over the table', [F.countText(3, 3), F.countText(1, 3), F.countText(0, 0)].join(' | '), '3 items | Showing 1 of 3 items | No items');

  T.section('the page module: the export of the rows shown');
  const csv = F.exportFile(rows, 'csv', TODAY);
  const lines = csv.text.replace(/^\ufeff/, '').split('\r\n');
  T.eq('CSV: named for today, a header from jiraBacklog.exportColumns', csv.name + ' | ' + lines[0], 'Jira_Stories_2026-11-05.csv | ' + J.exportColumns().map((c) => c.label).join(','));
  T.check('…a row per item, what it found quoted when it must be', lines.length === 4 && lines[1].startsWith('EQP-12,Equipment Master List View - Section 7.2,Story,DEVELOPMENT')
    && lines[1].includes('Yes,7.2,4,Due after its release date; Its release date has passed,Type Column is missing.; Map view is missing.'));
  const xls = F.exportFile(rows, 'xls', TODAY);
  T.check('Excel: an HTML table Excel opens, escaped', xls.name === 'Jira_Stories_2026-11-05.xls' && xls.mime === 'application/vnd.ms-excel'
    && (xls.text.match(/<tr>/g) || []).length === 4 && xls.text.includes('<th') && !/<td[^>]*>[^<]*&(?!amp;|lt;|gt;|quot;)/.test(xls.text));

  // ── the chains ─────────────────────────────────────────────────────────────────────────────────────────────
  T.section('the read (loadJiraChain): connected, refused, Jira\'s words');
  const defaults = () => {
    const v = {};
    Object.keys(pageJson.variables).forEach((k) => { if ('defaultValue' in pageJson.variables[k]) v[k] = plain(pageJson.variables[k].defaultValue); });
    return v;
  };
  function fakeActions(answer) {
    const calls = [];
    const notes = [];
    const chains = [];
    return {
      calls, notes, chains,
      Actions: {
        callRest: async (ctx, o) => { calls.push(o); return answer(o); },
        fireNotificationEvent: async (ctx, n) => { notes.push(n); },
        callChain: async (ctx, c) => { chains.push(c.chain); }
      }
    };
  }
  const ok = (o) => (o.endpoint === 'jira/getJiraMyself' ? { ok: true, status: 200, body: { accountId: '712020:p', displayName: 'Priya Raman' } } : { ok: true, status: 200, body: { issues: ISSUES, isLast: true } });
  let A = fakeActions(ok);
  let page = { variables: defaults(), functions: F };
  await new (loadChain('loadJiraChain', A.Actions))().run({ $page: page });
  let v = page.variables;
  T.check('the first preset\'s JQL, every page of it, and who signs in', v.jql === J.PRESETS[0].jql && v.preset === 'stories'
    && A.calls.map((c) => c.endpoint).sort().join() === 'jira/getJiraMyself,jira/searchJiraIssues' && A.calls.filter((c) => c.uriParams)[0].uriParams.jql === J.PRESETS[0].jql);
  T.eq('connected, outside the desktop app (no /__jira)', JSON.stringify([v.conn.state, v.conn.desktop, v.conn.name]), JSON.stringify(['connected', false, 'Priya Raman']));
  T.check('the rows, the analysis, the filters\' options, the time read', v.rows.length === 3 && v.shownRows.length === 3 && v.analysis.kpis.total === 3
    && v.statusOptions.map((o) => o.label).join() === 'FUNC DESIGN (1),DEVELOPMENT (1),TEST (1)' && v.assigneeOptions.some((o) => o.value === 'Nobody')
    && /^\d\d:\d\d$/.test(v.readAt) && !v.loading && !v.problem && !A.notes.length);
  v.search = { status: 'TEST' };
  v.pick = {};
  await new (loadChain('loadJiraChain', A.Actions))().run({ $page: page });
  T.eq('a Refresh keeps the filters picked', v.shownRows.map((r) => r.key).join(), 'EQP-14');

  A = fakeActions(() => ({ ok: false, status: 401, body: { errorMessages: ['You are not authenticated.'] } }));
  page = { variables: defaults(), functions: F };
  await new (loadChain('loadJiraChain', A.Actions))().run({ $page: page });
  v = page.variables;
  T.check('a 401: not connected, nothing shown, no toast (the page says how to connect)', v.conn.state === 'refused' && v.rows.length === 0 && !v.problem && !A.notes.length
    && v.analysis.kpis.total === 0 && F.emptyText(v.conn, false, '', 0) === 'Connect Jira to read the stories.');

  A = fakeActions((o) => (o.endpoint === 'jira/getJiraMyself' ? ok(o) : { ok: false, status: 400, body: { errorMessages: ['Field \'foo\' does not exist.'] } }));
  page = { variables: Object.assign(defaults(), { jql: 'foo = bar', preset: '' }), functions: F };
  await new (loadChain('loadJiraChain', A.Actions))().run({ $page: page });
  v = page.variables;
  T.check('a JQL Jira refuses: still connected, Jira\'s words, a toast', v.conn.state === 'connected' && v.problem === 'Jira did not accept the search: Field \'foo\' does not exist..'
    && A.notes.length === 1 && A.notes[0].type === 'error');

  T.section('a filter, a pick, a preset, a row');
  page = { variables: Object.assign(defaults(), { rows: plain(rows), analysis: plain(analysis) }), functions: F };
  v = page.variables;
  await new (loadChain('filterChain', {}))().run({ $page: page }, { criterion: { $tag: '_root_', criteria: [{ op: '$eq', value: { epic: 'EQP-1' } }] } });
  T.eq('Smart Search narrows the table', v.shownRows.map((r) => r.key).join(), 'EQP-12,EQP-14');
  await new (loadChain('pickChain', {}))().run({ $page: page }, { what: 'fdd', value: '7.2' });
  T.eq('…a pick narrows it further, said in the chip', v.shownRows.map((r) => r.key).join() + ' | ' + v.pickLabel, 'EQP-12 | FDD section 7.2');
  await new (loadChain('pickChain', {}))().run({ $page: page }, { what: 'clear', value: '' });
  T.check('…removed: the Smart Search filter alone again', v.shownRows.map((r) => r.key).join() === 'EQP-12,EQP-14' && !v.pickLabel && !Object.keys(v.pick).length);
  A = fakeActions(ok);
  v.pick = { only: 'overdue' };
  v.pickLabel = 'x';
  await new (loadChain('queryChain', A.Actions))().run({ $page: page }, { key: 'bugs' });
  T.check('a preset: its JQL, its chip, the pick dropped, then the read', v.jql === 'project = EQP AND issuetype = Bug ORDER BY created DESC' && v.preset === 'bugs'
    && !v.pickLabel && A.chains.join() === 'loadJiraChain');
  v.jql = '  ' + J.PRESETS[1].jql + ' ';
  await new (loadChain('queryChain', A.Actions))().run({ $page: page }, { key: '' });
  T.eq('Run: a typed JQL that is a preset\'s lights its chip', v.preset, J.PRESETS[1].key);
  v.jql = 'project = EQP AND labels = demo';
  await new (loadChain('queryChain', A.Actions))().run({ $page: page }, { key: '' });
  T.eq('…one of your own lights none', v.preset, '');
  await new (loadChain('openStoryChain', {}))().run({ $page: page }, { key: 'EQP-12' });
  T.check('a row: a copy of the story, in the drawer', v.drawerOpen && v.selected.key === 'EQP-12' && v.selected !== v.rows[0] && v.selected.gaps.length === 2);
  await new (loadChain('closeDrawerChain', {}))().run({ $page: page });
  T.check('…closed', !v.drawerOpen);

  T.section('Connect Jira, in the desktop app');
  fetchAnswer = (url, o) => {
    if (url === '/__jira/settings' && o.method === 'POST') {
      const b = JSON.parse(o.body);
      return b.email === 'nobody' ? { error: 'Enter the email you sign in to Jira with.' } : { site: b.site, email: b.email, hasToken: true, connected: true };
    }
    if (url === '/__jira/settings') return { site: 'https://equiprite.atlassian.net', email: 'priya.raman@equiprite.com', hasToken: true, connected: true };
    if (url === '/__jira/forget') return { site: 'https://equiprite.atlassian.net', email: '', hasToken: false, connected: false };
    return null;
  };
  A = fakeActions(ok);
  page = { variables: Object.assign(defaults(), { emailInput: 'priya.raman@equiprite.com', tokenInput: 'ATATT-secret' }), functions: F };
  v = page.variables;
  A.Actions.callChain = async (ctx, c) => { A.chains.push(c.chain); await new (loadChain(c.chain, A.Actions))().run({ $page: page }); };
  await new (loadChain('connectionChain', A.Actions))().run({ $page: page }, { act: 'connect' });
  const save = fetched.filter((f) => f.method === 'POST' && f.url === '/__jira/settings')[0];
  T.check('the site, email and token handed to the desktop app (desktopSave), never kept by the page', save && save.body.token === 'ATATT-secret'
    && save.body.site === 'https://equiprite.atlassian.net' && v.tokenInput === '');
  T.check('…then the read: connected, in the desktop app, and a toast', A.chains.join() === 'loadJiraChain' && v.conn.state === 'connected' && v.conn.desktop
    && A.notes.some((n) => n.summary === 'Jira connected' && n.type === 'confirmation'));
  v.emailInput = 'nobody';
  v.tokenInput = 't';
  await new (loadChain('connectionChain', A.Actions))().run({ $page: page }, { act: 'connect' });
  T.eq('what the desktop app refuses is said', v.connError, 'Enter the email you sign in to Jira with.');
  v.emailInput = '';
  await new (loadChain('connectionChain', A.Actions))().run({ $page: page }, { act: 'connect' });
  T.check('no email: asked for, nothing sent', /Enter the email/.test(v.connError) && fetched.filter((f) => f.method === 'POST' && f.url === '/__jira/settings').length === 2);
  await new (loadChain('connectionChain', A.Actions))().run({ $page: page }, { act: 'disconnect' });
  T.check('Disconnect: the desktop app forgets, the page reads again', fetched.some((f) => f.url === '/__jira/forget') && A.chains.join() === 'loadJiraChain,loadJiraChain');

  T.section('Export (exportChain)');
  const downloads = [];
  page = { variables: Object.assign(defaults(), { shownRows: plain(rows.slice(0, 2)) }), functions: Object.assign(Object.create(F), { download: (f) => { downloads.push(f); return true; } }) };
  A = fakeActions(ok);
  await new (loadChain('exportChain', A.Actions))().run({ $page: page }, { format: 'xls' });
  T.check('the rows shown, to the file, and a toast', downloads.length === 1 && /\.xls$/.test(downloads[0].name) && (downloads[0].text.match(/<tr>/g) || []).length === 3
    && A.notes[0].message.startsWith('2 items to Jira_Stories_'));

  T.report();
})().catch((e) => { T.check('runs without throwing', false, e.stack); T.report(); });
