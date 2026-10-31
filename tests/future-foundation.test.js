/*
 * EquipRite Future's foundation (webApps/equiprite-future): its own app, the menu and who sees what, the badges, the
 * tabs, the shell's rules (persona switch, demo clock), the page pattern (fxPage), the Guide (fxGuide), every page on
 * the pattern (embeddable, chains that exist, bindings VB accepts), no REST call anywhere, and the version switch in
 * Next, New, the desktop app and the e2e harness. Loads the real modules.
 *
 * Run:  node tests/future-foundation.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'webApps', 'equiprite-future');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

// AMD modules of the app, loaded with their real dependencies ('resources/js/x' → webApps/equiprite-future/resources/js/x.js).
const mods = {};
function load(id) {
  if (mods[id]) return mods[id];
  const file = path.join(APP, id + '.js');
  const sandbox = { console, JSON, Math, Date, Object, Array, String, Number, Boolean, Error, URLSearchParams, setTimeout };
  sandbox.define = (deps, factory) => { mods[id] = factory(...deps.map(load)); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return mods[id];
}
const nav = load('resources/js/nav');
const tabs = load('resources/js/tabs');
const bus = load('resources/js/shellBus');
const Seed = load('resources/js/future/fxSeed');
const E = load('resources/js/future/fxEngine');
const V = load('resources/js/future/fxViews');
const store = load('resources/js/future/fxStore');
const fx = load('resources/js/future/fxPage');
const fxShell = load('resources/js/future/fxShell');
const fxGuide = load('resources/js/future/fxGuide');
const persona = (id) => Seed.PERSONAS.find((p) => p.id === id);
const menuOf = (id) => nav.visibleGroups(persona(id).roles, {}).map((g) => g.items.map((i) => i.id).join(' ')).join(' ');

T.section('the menu');
T.eq('groups', nav.GROUPS.map((g) => g.label).join(', '), 'Home, Requests, Fleet owner, On site, Money, Finance, Setup, Help');
T.eq('items, in order', nav.GROUPS.map((g) => g.items.map((i) => i.id + '=' + i.label).join(' | ')).join(' || '),
  'work=My work || requests=My requests | new-request=New request || approvals=Approve & allocate | yard=Yard || site=Receive, hours, moves'
  + ' || charges=Charges & statements | ic-workbench=Intercompany workbench | billing=Customer billing || accounting=Accounting (shown) | reports=Reports'
  + ' || setup=Companies & agreements || guide=Guide: the end-to-end story');
T.eq('routes: flow and page (page = id)', nav.GROUPS.map((g) => g.items.map((i) => i.id + '>' + i.route.flow + '/' + i.route.page).join(' ')).join(' '),
  'work>work/work requests>requests/requests new-request>order/new-request approvals>owner/approvals yard>owner/yard site>site/site'
  + ' charges>money/charges ic-workbench>money/ic-workbench billing>money/billing accounting>finance/accounting reports>finance/reports setup>setup/setup guide>guide/guide');
T.eq('roles named in the brief', ['approvals', 'yard', 'site', 'ic-workbench'].map((id) => id + ':' + nav.item(id).roles.join('+')).join(' '),
  'approvals:owner-em yard:yard+owner-em site:site+requester+desk+receiver-review ic-workbench:ic-finance+finance');
T.check('every item lists roles, every role is one the personas have', [].concat(...nav.GROUPS.map((g) => g.items)).every((i) => i.roles.length
  && i.roles.every((r) => Seed.PERSONAS.some((p) => p.roles.indexOf(r) !== -1))));
T.eq('Priya (ProjectCo PM) sees her requests, the site and the money she reviews', menuOf('p-pm'), 'work requests new-request site charges billing reports setup guide');
T.eq('Ana (FleetCo Equipment Manager) sees the fleet owner\'s screens', menuOf('p-em'), 'work approvals yard reports setup guide');
T.eq('Ravi (yard)', menuOf('p-yard'), 'work yard reports setup guide');
T.eq('Sara (group IC finance) sees the workbench and the accounting', menuOf('p-fin'), 'work requests charges ic-workbench billing accounting reports setup guide');
T.eq('Admin sees everything', menuOf('p-admin').split(' ').length, 13);
T.check('My work and the Guide for everyone', Seed.PERSONAS.every((p) => /^work .* guide$/.test(menuOf(p.id))));
T.eq('a request is a record of its own tab', JSON.stringify([nav.RECORDS.request.flow, nav.RECORDS.request.page, nav.RECORDS.request.navId]), '["requests","request","requests"]');
T.eq('who could open a screen: its player first', ['approvals', 'yard', 'ic-workbench', 'new-request'].map((id) => nav.whoCanOpen(id, Seed.PERSONAS).name).join(', '),
  'Ana Costa, Ravi Kumar, Sara Ahmed, Priya Raman');

T.section('badges come from fxViews.work(): never on a screen the persona cannot open');
let s = Seed.seed();
const as = (id) => { s = E.apply(s, 'setPersona', { id }).state; };
const act = (type, payload) => { const r = E.apply(s, type, payload); if (r.ok) s = r.state; else T.check(type + ' worked', false, r.error); return r; };
const line = (rid) => s.requests.find((r) => r.id === rid).lines[0];
const badgesOf = (id) => { as(id); return nav.badges(V.work(s).items); };
const hidden = [];
const sweep = (when) => Seed.PERSONAS.forEach((p) => {
  as(p.id);
  V.work(s).items.forEach((i) => { if (!nav.itemVisible(nav.item(i.navId), p.roles)) hidden.push(when + ': ' + p.name + ' → ' + i.navId); });
});
sweep('start');
as('p-pm');
const r1 = act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-03', to: '2026-12-20', lines: [{ cls: 'EXC', unitId: 'U-EX1' }] }).result.id;
T.eq('a request raised: Ana\'s badge on Approve & allocate', JSON.stringify(badgesOf('p-em')), '{"approvals":1}');
T.eq('…in her menu', nav.visibleGroups(persona('p-em').roles, badgesOf('p-em')).find((g) => g.key === 'owner').items.map((i) => i.id + ':' + i.badge).join(' '), 'approvals:1 yard:0');
T.eq('…and none for Priya', JSON.stringify(badgesOf('p-pm')), '{}');
sweep('raised');
as('p-em'); act('approveLine', { requestId: r1, lineId: line(r1).id, unitId: 'U-EX1' });
T.eq('approved: the yard ships it', JSON.stringify(badgesOf('p-yard')), '{"yard":1}');
sweep('approved');
as('p-yard'); act('shipLine', { requestId: r1, lineId: line(r1).id });
act('advance', { days: 1 });
T.eq('shipped: the site receives it', JSON.stringify(badgesOf('p-site')), '{"site":1}');
as('p-site'); act('receiveLine', { requestId: r1, lineId: line(r1).id }); act('fillHours', { requestId: r1, lineId: line(r1).id });
T.check('hours to approve: on Receive, hours, moves for Priya and for Mark (finance)', badgesOf('p-pm').site > 0 && badgesOf('p-pcfin').site > 0);
sweep('on hire');
as('p-pm'); act('approveHours', { requestId: r1, lineId: line(r1).id });
act('toMonthEnd', {});
as('p-fin'); act('runCharges', {});
T.check('charges run: Sara releases the statement', badgesOf('p-fin').charges === 1);
sweep('charged');
as('p-fin'); act('releaseStatement', { statementId: s.statements[0].id });
T.check('released: Mark agrees it', badgesOf('p-pcfin').charges === 1);
sweep('released');
const beforeClock = s;
const notesBefore = (as('p-fin'), V.notifications(s));
act('advance', { days: 4 });
sweep('accepted by silence');
T.eq('no badge points at a screen its persona cannot open', hidden.join('; '), '');

T.section('the demo clock says what happened');
const news = fxShell.clockNews(beforeClock, s, notesBefore, V.notifications(s), V.me(s));
T.eq('the new day, then what happened by itself on the way', news.text.split('. ').slice(0, 2).join('. '),
  'Today is Fri 4 Dec 2026. Statement ICS-2026-11-001 accepted by silence');
T.check('…and how many new notifications for the persona played', /\d new notifications? for you\.$/.test(news.text), news.text);
T.eq('a quiet day', fxShell.clockNews(s, s, V.notifications(s), V.notifications(s), V.me(s)).text, 'Today is Fri 4 Dec 2026. Nothing happened by itself.');

T.section('playing someone else: the tabs they may not open close');
const tabList = [tabs.forItem('work'), tabs.forItem('new-request'), tabs.forRecord('request', { id: 'R1001', number: 'FR-1001' }), tabs.forItem('guide'), tabs.forItem('site')];
const pr = fxShell.prune(tabList, persona('p-em').roles);
T.eq('Ana keeps My work, the request, the Guide; New request and the site close', [pr.keep.map((t) => t.id).join(), pr.closed.map((t) => t.id).join()].join(' | '),
  'work,request:R1001,guide | new-request,site');
T.eq('the toast', fxShell.personaToast(V.me(Object.assign({}, s, { personaId: 'p-em' })), pr.closed),
  'Playing as Ana Costa, Equipment Manager · FleetCo. Closed New request and Receive, hours, moves: not open to Ana.');

T.section('tabs');
const t0 = tabs.restore(null);
T.eq('first start: My work, pinned; Future\'s own keys', [t0.tabs.map((t) => t.id + (t.pinned ? '*' : '')).join(), t0.current, tabs.STORE_KEY].join(' | '), 'work* | work | eqr.future.tabs');
T.eq('a request in its own tab, titled with its number', [tabs.forRecord('request', { id: 'R1001', number: 'FR-1001' }).id, tabs.forRecord('request', { id: 'R1001', number: 'FR-1001' }).title].join(), 'request:R1001,FR-1001');
T.eq('the Guide\'s tab has a short title', tabs.forItem('guide').title, 'Guide');
T.eq('deep links', [tabs.fromQuery('?open=approvals').id, tabs.fromQuery('?open=request&id=R1001&number=FR-1001').id].join(), 'approvals,request:R1001');
T.eq('kept and restored', tabs.restore(tabs.serialize(tabs.open(t0, tabs.forItem('guide')))).tabs.map((t) => t.id).join(), 'work,guide');

T.section('the page pattern (fxPage)');
const req = fx.request({ data: { act: 'approveLine', requestId: 'R1001', lineId: 'L1', unitId: 'U-EX1', days: '7', allowed: 'true', open: 'yard' } });
T.eq('data-act and data-… make the action; numbers and booleans as such; open is not payload', JSON.stringify(req),
  '{"type":"approveLine","payload":{"requestId":"R1001","lineId":"L1","unitId":"U-EX1","days":7,"allowed":true},"open":"yard","quiet":false,"confirm":""}');
T.eq('or a payload a page function built', JSON.stringify(fx.request({ type: 'logHours', payload: { usage: 8 } })), '{"type":"logHours","payload":{"usage":8},"open":"","quiet":false,"confirm":""}');
const sent = [];
bus.register((r) => sent.push(r));
store.reset();
let res = fx.act({ data: { act: 'approveLine', requestId: 'R1', lineId: 'L1', unitId: 'U-EX1' } });
T.eq('a refusal is toasted in plain words', JSON.stringify([res.ok, sent.pop()]),
  '[false,{"action":"toast","message":"Priya Raman (Project Manager · ProjectCo) cannot do this: approveLine.","tone":"error"}]');
res = fx.act({ type: 'createRequest', payload: { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-03', to: '2026-12-20', lines: [{ cls: 'EXC', unitId: 'U-EX1' }] } });
T.eq('success: what happened is toasted, the request the result names opens', JSON.stringify(sent.splice(0)),
  '[{"action":"toast","message":"Raised FR-1001 for ProjectCo Projects · PC-INT-014.","tone":"info"},{"action":"open","record":"request","params":{"id":"R1001","number":"FR-1001"}}]');
fx.act({ data: { act: 'setPersona', id: 'p-em', open: 'approvals' } });
T.eq('Play as …: no toast of its own (the shell says who is played), then its screen opens', JSON.stringify(sent.splice(0)), '[{"action":"open","navId":"approvals"}]');
T.eq('the store follows', store.view('me').name, 'Ana Costa');
fx.act({ data: { act: 'markRead' } });
T.eq('a quiet action toasts nothing', sent.splice(0).length, 0);
T.check('asking first: no answer, no action', fx.act({ data: { act: 'markRead', confirm: 'Sure?' } }, { confirm: () => false }).cancelled === true);
fx.open({ record: 'request', id: 'R1001' });
T.eq('openChain: a request named by id opens titled with its number', JSON.stringify(sent.splice(0)), '[{"action":"open","record":"request","params":{"id":"R1001","number":"FR-1001"}}]');
fx.open({ nav: 'yard' });
T.eq('openChain: a screen', JSON.stringify(sent.splice(0)), '[{"action":"open","navId":"yard"}]');
T.eq('a notification link as openChain takes it', JSON.stringify([fx.linkData({ navId: 'charges' }), fx.linkData({ record: 'request', id: 'R1001' })]), '[{"nav":"charges"},{"record":"request","id":"R1001","number":""}]');
T.eq('view(): ready, or the error in words, or missing', JSON.stringify([fx.view('approvals').ready, fx.view('nope').error, fx.view('request', 'R9').missing]), '[true,"No view nope",true]');
const fired = [];
const helper = { fireCustomEvent: (name, p) => { fired.push(name + ':' + p.type); return Promise.resolve(); } };
const w = fx.watch({ getEventHelper: () => helper });
store.act('advance', { days: 1 });
T.eq('watch(): every change fires fxRefresh on the page', fired.join(), 'fxRefresh:advance');
delete helper.fireCustomEvent; // what VB does when it disposes the page (its tab closed)
store.act('advance', { days: 1 });
T.eq('…and it stops by itself once VB disposed the page', [fired.length, w.active()].join(), '1,false');
T.eq('binding helpers: money, dates, journey colours, finance states', [fx.helpers.money(1234.5, 'AED'), fx.helpers.date('2026-11-30'), fx.helpers.stageTone('onhire'), fx.helpers.stateTone('failed')].join(' | '),
  'AED 1,234.50 | 30 Nov 2026 | onsite | bad');
T.eq('a page module extends fx.Base: the subscription and the helpers', typeof fx.Base.prototype.money + typeof fx.Base.prototype.dispose, 'functionfunction');
store.reset();

T.section('the Guide');
const story = fxGuide.story(V.guide(Seed.seed()), 'p-em');
T.eq('thirteen steps, the first next, Priya\'s', [story.steps.length, story.next.n, story.next.personaName].join(), '13,1,Priya Raman');
T.eq('one click plays a step: as someone else, or the persona\'s own', [story.steps[0].action, story.steps[1].action].join(' | '),
  'Play as Priya and open New request | Open Approve & allocate');
T.eq('five scenarios, each with its relationship', story.scenarios.map((c) => c.id + ':' + c.tone).join(' '), 'S1:ic S2:ic S3:cust XB:xb LE:info');
T.eq('…started by the right person', story.scenarios.map((c) => c.first).join(' '), 'Priya Priya Lena Faisal Priya');
T.eq('the seven rules of FDD v2.0', story.rules.map((r) => r.id).join(), 'GR-1,GR-2,GR-3,GR-4,GR-5,GR-6,GR-7');
T.check('every step\'s screen is in the menu and open to its player', story.steps.every((x) => nav.itemVisible(nav.item(x.navId), persona(x.persona).roles)));

T.section('its own app');
const app = json('webApps/equiprite-future/app-flow.json');
T.eq('id and title', [app.id, app.title].join(' | '), 'equiprite-future | EquipRite Future');
T.eq('only the versions variable, with Future', JSON.stringify(Object.keys(app.variables)) + ' ' + Object.keys(app.variables.appUrls.defaultValue).join(), '["appUrls"] old,new,next,mobile,future');
T.eq('on start: the versions only (no page access, flags, roles or lookups)', app.eventListeners.vbEnter.chains.map((c) => c.chain).join(), 'loadVersionsChain');
T.eq('app chains', fs.readdirSync(path.join(APP, 'chains')).join(), 'loadVersionsChain.js');
T.check('the version chain knows Future\'s address under VBCS and from /__versions', /equiprite-future\//.test(read('webApps/equiprite-future/chains/loadVersionsChain.js'))
  && /future: \(v && v\.future\)/.test(read('webApps/equiprite-future/chains/loadVersionsChain.js')));
T.check('every stylesheet it imports exists', app.imports.css.filter((c) => !/^https:/.test(c)).every((c) => fs.existsSync(path.join(APP, c))));
T.eq('Next\'s screens are gone: the flows are Future\'s', fs.readdirSync(path.join(APP, 'flows')).sort().join(), 'finance,guide,money,order,owner,requests,setup,site,work');
T.eq('the shared code kept', fs.readdirSync(path.join(APP, 'resources', 'js')).sort().join(), 'exportKit.js,fmt.js,future,nav.js,shellBus.js,shellTabs.js,tabs.js,theme.js');
T.eq('…and the stylesheets', fs.readdirSync(path.join(APP, 'resources', 'css')).sort().join(),
  'future-finance.css,future-guide.css,future-money.css,future-order.css,future-owner.css,future-requests.css,future-setup.css,future-site.css,future-work.css,future.css,next.css');
T.eq('index.html title', /<title>([^<]+)<\/title>/.exec(read('webApps/equiprite-future/index.html'))[1], 'EquipRite Future');

T.section('every page on the pattern');
const walk = (dir) => fs.readdirSync(dir).reduce((a, f) => { const p = path.join(dir, f); return a.concat(fs.statSync(p).isDirectory() ? walk(p) : [p]); }, []);
const files = walk(APP);
const rel = (p) => path.relative(APP, p);
const pageJsons = files.filter((f) => /-page\.json$/.test(f));
const flowJsons = files.filter((f) => /-flow\.json$/.test(f) && !/app-flow/.test(f));
T.check('every flow and page JSON is embeddable (the shell too)', flowJsons.concat(pageJsons).every((f) => (JSON.parse(fs.readFileSync(f, 'utf8')).navigation || {}).embeddable === 'enabled'),
  flowJsons.concat(pageJsons).filter((f) => (JSON.parse(fs.readFileSync(f, 'utf8')).navigation || {}).embeddable !== 'enabled').map(rel).join());
const missing = [];
const orphans = [];
pageJsons.forEach((f) => {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const dir = f.replace(/\.json$/, '-chains');
  const named = [];
  Object.values(d.eventListeners || {}).forEach((l) => (l.chains || []).forEach((c) => named.push(c.chain)));
  named.forEach((c) => { if (!fs.existsSync(path.join(dir, c + '.js'))) missing.push(rel(f) + ' → ' + c); });
  (fs.existsSync(dir) ? fs.readdirSync(dir) : []).forEach((c) => { if (named.indexOf(c.replace(/\.js$/, '')) === -1) orphans.push(rel(dir) + '/' + c); });
  // Chains call others by name too (Actions.callChain).
  (fs.existsSync(dir) ? fs.readdirSync(dir) : []).forEach((c) => {
    const called = fs.readFileSync(path.join(dir, c), 'utf8').match(/chain: '(\w+)'/g) || [];
    called.forEach((x) => { const n = /'(\w+)'/.exec(x)[1]; if (!fs.existsSync(path.join(dir, n + '.js'))) missing.push(rel(dir) + '/' + c + ' → ' + n); });
  });
});
T.eq('every chain a page (the shell too) names exists', missing.join('; '), '');
T.eq('…and every chain is named by its page', orphans.join('; '), '');
const shell = json('webApps/equiprite-future/pages/shell-page.json');
T.eq('the shell\'s chains', Object.values(shell.eventListeners).map((l) => l.chains.map((c) => c.chain).join('+')).filter((x, i, a) => a.indexOf(x) === i).sort().join(' '),
  'bellChain clockChain closeTabChain dismissChain markReadChain navChain noteChain openChain personaChain profileChain refreshChain resetChain shellRequestChain showTabChain tabMenuChain themeChain themeChain+shellEnterChain toastChain');
const flowsPages = {};
flowJsons.forEach((f) => { const d = JSON.parse(fs.readFileSync(f, 'utf8')); flowsPages[d.id] = Object.keys(d.pages); Object.values(d.pages).forEach((pg) => {
  ['.html', '.js', '.json'].forEach((ext) => { if (!fs.existsSync(path.join(path.dirname(f), pg.path + ext))) missing.push(rel(f) + ' → ' + pg.path + ext); });
}); });
T.eq('every menu route and the request record point at a page of their flow', [].concat(...nav.GROUPS.map((g) => g.items)).map((i) => i.route)
  .concat([nav.RECORDS.request]).filter((r) => (flowsPages[r.flow] || []).indexOf(r.page) === -1).map((r) => r.flow + '/' + r.page).join(), '');
T.eq('…and every page is reached', Object.keys(flowsPages).reduce((a, k) => a.concat(flowsPages[k].map((p) => k + '/' + p)), [])
  .filter((fp) => ![].concat(...nav.GROUPS.map((g) => g.items)).some((i) => i.route.flow + '/' + i.route.page === fp) && fp !== 'requests/request').join(), '');
T.eq('every page\'s files exist', missing.join('; '), '');
const pagesWithFx = pageJsons.filter((f) => !/shell-page/.test(f));
T.check('every screen refreshes on fxRefresh (declared, listened to, loadChain)', pagesWithFx.every((f) => {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  return d.events && d.events.fxRefresh && d.eventListeners.fxRefresh.chains[0].chain === 'loadChain' && d.eventListeners.vbEnter.chains[0].chain === 'loadChain'
    && d.variables.v && d.variables.v.type === 'any';
}));
T.check('every screen\'s module extends fx.Base (subscribed to the store)', pagesWithFx.every((f) => /extends fx\.Base/.test(fs.readFileSync(f.replace(/\.json$/, '.js'), 'utf8'))));
T.check('every screen acts through one actChain on fxPage.act', pagesWithFx.every((f) => /fx\.act\(/.test(fs.readFileSync(f.replace(/-page\.json$/, '-page-chains/actChain.js'), 'utf8'))));
const htmls = files.filter((f) => /\.html$/.test(f) && !/index\.html$/.test(f));
const badBindings = [];
htmls.forEach((f) => {
  const h = fs.readFileSync(f, 'utf8');
  (h.match(/\[\[[\s\S]*?\]\]/g) || []).forEach((b) => { if (/=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)) badBindings.push(rel(f) + ': ' + b.slice(0, 60)); });
  if (/<(table|tbody|select)[^>]*>[\s\S]*?<oj-bind-for-each[\s\S]*?<\/\1>/.test(h)) badBindings.push(rel(f) + ': oj-bind-for-each in a table, tbody or select');
  const pj = f.replace(/\.html$/, '.json');
  if (fs.existsSync(pj)) {
    const listeners = Object.keys(JSON.parse(fs.readFileSync(pj, 'utf8')).eventListeners || {});
    (h.match(/\$listeners\.(\w+)/g) || []).forEach((x) => { const n = x.split('.')[1]; if (listeners.indexOf(n) === -1) badBindings.push(rel(f) + ': no listener ' + n); });
    const js = fs.readFileSync(f.replace(/\.html$/, '.js'), 'utf8');
    const fns = (js.match(/^\s{4,6}(\w+)\(/gm) || []).map((x) => x.trim().replace('(', '')).concat(/extends fx\.Base/.test(js) ? Object.keys(fx.helpers) : []);
    (h.match(/\$functions\.(\w+)/g) || []).forEach((x) => { const n = x.split('.')[1]; if (fns.indexOf(n) === -1) badBindings.push(rel(f) + ': no function ' + n); });
  }
});
T.eq('bindings VB accepts: no arrow functions, String/Number/Boolean or for-each in tables; listeners and functions exist', badBindings.join('\n'), '');
const deps = [];
files.filter((f) => /\.js$/.test(f)).forEach((f) => {
  const m = /define\(\s*\[([^\]]*)\]/.exec(fs.readFileSync(f, 'utf8'));
  ((m && m[1].match(/'resources\/[^']+'/g)) || []).forEach((d) => { if (!fs.existsSync(path.join(APP, d.slice(1, -1) + '.js'))) deps.push(rel(f) + ' → ' + d); });
});
T.eq('every module a file loads is there (nothing left of Next\'s)', deps.join('; '), '');

T.section('no REST anywhere: the simulated store only');
const rest = files.filter((f) => /\.(js|json|html)$/.test(f)).filter((f) => /callRest|eqp-v1|getNotifications|\/services\/|"services": \{\s*"/.test(fs.readFileSync(f, 'utf8')));
T.eq('no callRest, no eqp-v1, no service', rest.map(rel).join(), '');
T.eq('the only fetch is the desktop app\'s /__versions', files.filter((f) => /\.js$/.test(f) && /\bfetch\(/.test(fs.readFileSync(f, 'utf8'))).map(rel).join(), 'chains/loadVersionsChain.js');

T.section('switching versions as usual');
const nextShell = read('webApps/equiprite-next/pages/shell-page.html');
T.check('Next: Future in the profile menu, after Mobile', nextShell.indexOf('id="nxGoFuture"') > nextShell.indexOf('id="nxGoMobile"')
  && /Many companies, intercompany \(prototype\)/.test(nextShell));
T.check('Next: its versions chain knows Future (VBCS and /__versions)', /future: m\[1\] \+ 'equiprite-future\/'/.test(read('webApps/equiprite-next/chains/loadVersionsChain.js'))
  && /future: \(v && v\.future\)/.test(read('webApps/equiprite-next/chains/loadVersionsChain.js'))
  && 'future' in json('webApps/equiprite-next/app-flow.json').variables.appUrls.defaultValue);
const newShell = read('webApps/equiprite/pages/shell-page.html');
T.check('New: Future in its header switch, after Next', newShell.indexOf('id="erGoFuture"') > newShell.indexOf('id="erGoNext"')
  && /futureAppUrl = m\[1\] \+ 'equiprite-future\/'/.test(read('webApps/equiprite/chains/loadVersionsChain.js'))
  && 'futureAppUrl' in json('webApps/equiprite/app-flow.json').variables);
T.check('Mobile: unchanged (no Future in it)', !/equiprite-future/.test(walk(path.join(ROOT, 'webApps', 'equiprite-mobile')).filter((f) => /\.(js|json|html)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('')));
const main = read('desktop/main.js');
T.check('desktop: EquipRite Future on PORT + 4', /future: \{ webApp: 'equiprite-future', label: 'EquipRite Future', port: PORT \+ 4 \}/.test(main));
T.check('desktop: File > Open EquipRite Future (Ctrl+Shift+5)', /\{ label: 'Open EquipRite Future', accelerator: 'CmdOrCtrl\+Shift\+5', click: \(\) => openVersion\('future'\) \}/.test(main));
T.check('desktop: /__versions lists it when built', /future: servers\.future \? urlOf\('future'\) : ''/.test(main));
T.check('desktop: no accelerator twice', (() => { const a = main.match(/accelerator: '[^']+'/g) || []; return a.length === new Set(a).size; })());
T.eq('desktop: Future is remembered as the app to open', require(path.join(ROOT, 'desktop', 'lib', 'identity.js')).versionOf('future'), 'future');
const harness = read('tests/e2e/harness.js');
T.check('e2e harness: Future on port + 4, served when built, futureUrl, app: future', /future: o\.port \+ 4/.test(harness) && /webApp: 'equiprite-future'/.test(harness)
  && /futureUrl:/.test(harness) && /future: '\.nx-nav-item'/.test(harness));

T.section('the guide for the next builders');
const doc = read('docs/redesign/BUILDING-FUTURE-SCREENS.md');
T.check('docs/redesign/BUILDING-FUTURE-SCREENS.md: the pattern and the routes', ['loadChain', 'fxRefresh', 'actChain', 'data-act', 'fxPage', 'embeddable', 'store.view', 'flows/money/pages/ic-workbench-page']
  .every((w) => doc.indexOf(w) !== -1));

T.report();
