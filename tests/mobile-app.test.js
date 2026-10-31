/*
 * EquipRite Mobile (webApps/equiprite-mobile): the tabs each role gets (mobileTabs), the line from a tab to the shell
 * (mobileBus), My requests' cards (trackList), the copy kept on the phone (offlineSnapshot), installing it
 * (installPrompt, pwaSetup, the manifest), and guards: the modules shared with Next are the same files, every chain a
 * page names exists, bindings use only what VB's expression language allows. Loads the real modules.
 *
 * Run:  node tests/mobile-app.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const pending = []; // checks that wait on a promise: the report waits for them
const APP = path.join(__dirname, '..', 'webApps', 'equiprite-mobile');
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const JS = path.join(APP, 'resources', 'js');

function load(name, deps, extra) {
  const sandbox = Object.assign({ console, Intl, Date, setTimeout, JSON }, extra || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}

const rules = load('rules');
const fmt = load('fmt');
const Progress = load('requestProgress');
const tabs = load('mobileTabs', { 'resources/js/rules': rules });
const bus = load('mobileBus');
const list = load('requestList', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/rules': rules });
const queue = load('approvalQueue', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/rules': rules });
const drafts = load('cartDrafts', { 'resources/js/fmt': fmt, 'resources/js/rules': rules });
const recent = load('mobileRecent');
const track = load('trackList', { 'resources/js/requestList': list, 'resources/js/requestProgress': Progress, 'resources/js/cartDrafts': drafts,
  'resources/js/approvalQueue': queue, 'resources/js/mobileRecent': recent });

// ── Tabs by role ────────────────────────────────────────────────────────────────────────────────────────
T.section('the tabs each role gets');
const ids = (map, loaded) => tabs.visible(map, loaded === undefined ? true : loaded).map((t) => t.id).join(',');
const ALL = { EQR_WORKBENCH: 'FULL', EQR_INITIATE_PICKING: 'FULL', EQR_PROJ_CREATE_REQUEST: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL' };
T.eq('an Equipment Manager: every tab, in order', ids(ALL), 'approve,pick,request,track,me');
T.eq('an approver', ids({ EQR_WORKBENCH: 'FULL', EQR_EQUIPMENT_REQUESTS: 'READ_ONLY' }), 'approve,track,me');
T.eq('a picker (read-only can look)', ids({ EQR_INITIATE_PICKING: 'READ_ONLY' }), 'pick,me');
T.eq('a requester', ids({ EQR_PROJ_CREATE_REQUEST: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL' }), 'request,track,me');
T.eq('approving and raising need FULL', ids({ EQR_WORKBENCH: 'READ_ONLY', EQR_PROJ_CREATE_REQUEST: 'READ_ONLY' }), 'me');
T.eq('hidden is hidden', ids({ EQR_INITIATE_PICKING: 'HIDDEN' }), 'me');
T.eq('before access has loaded only Me (fail closed)', ids(ALL, false), 'me');
T.eq('opens on the first work tab', tabs.first({ EQR_PROJ_CREATE_REQUEST: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL' }, true), 'request');
T.eq('nothing to do: Me', tabs.first({}, true), 'me');
T.eq('what you can do, in words', tabs.summary({ EQR_WORKBENCH: 'FULL', EQR_INITIATE_PICKING: 'FULL' }, true), 'Approve requests · Pick and ship');
const item = tabs.item(tabs.tab('approve'));
T.eq('a switcher item', [item.id, item.name, item.flow, item.page].join(), 'approve,tab_approve,approve,approve');
T.eq('an unknown tab', tabs.tab('nope'), null);
T.eq('every tab has an icon the font has', tabs.TABS.filter((t) => !/^oj-ux-ico-[a-z-]+$/.test(t.icon)).length, 0);

// ── The bus ─────────────────────────────────────────────────────────────────────────────────────────────
T.section('a tab asks the shell (mobileBus)');
bus.toast('early', 'info');
const got = [];
bus.register((r) => got.push(r.action + ':' + (r.tab || r.message)));
T.eq('asked before the shell was there: delivered once it is', got.join(), 'toast:early');
bus.badge('pick', '4');
T.eq('a count', got[got.length - 1], 'badge:pick');
let woke = 0;
bus.onFocus('track', () => { woke++; });
bus.focus('track', { id: 7, number: 'REQ-7' });
T.eq('focus shows the tab', got[got.length - 1], 'go:track');
T.eq('and wakes the tab if it is open', woke, 1);
T.eq('the tab takes it once', JSON.stringify(bus.takeFocus('track')), '{"id":7,"number":"REQ-7"}');
T.eq('then it is gone', bus.takeFocus('track'), null);

// ── My requests ─────────────────────────────────────────────────────────────────────────────────────────
T.section('My requests (trackList)');
const now = Date.parse('2026-10-30T09:00:00Z');
const rows = [
  { eqrEquipmentRequestId: 1, requestNumber: 'REQ-1', status: 'SUBMITTED', projectName: 'Pier B', requestorUsername: 'priya.raman', requestorName: 'Priya Raman',
    startDate: '2026-11-04', endDate: '2026-12-01' },
  { eqrEquipmentRequestId: 2, requestNumber: 'REQ-2', status: 'IN_PROCESS', projectName: 'Plant C', requestorUsername: 'priya.raman', startDate: '2026-11-04', endDate: '2026-12-01' },
  { eqrEquipmentRequestId: 3, requestNumber: 'REQ-3', status: 'DRAFT', projectName: 'Gas Line', requestorUsername: 'priya.raman' },
  { eqrEquipmentRequestId: 4, requestNumber: 'REQ-4', status: 'SUBMITTED', projectName: 'Dock', requestorUsername: 'dana.cole', requestorName: 'Dana Cole' },
  { eqrEquipmentRequestId: 5, requestNumber: 'REQ-5', status: 'REJECTED', projectName: 'Yard', requestorUsername: 'priya.raman' },
  { eqrEquipmentRequestId: 6, requestNumber: 'REQ-6', status: 'IN_PROCESS', projectName: 'Mine', requestorUsername: 'priya.raman' },
];
const L = (n, name, status, extra) => Object.assign({ requestNumber: n, name, lineStatus: status, qty: 1, allocation: status === 'ALLOCATED' ? 'ALLOCATED' : '' }, extra || {});
const lines = {
  'REQ-1': [L('REQ-1', 'Dozer', 'SUBMITTED'), L('REQ-1', 'Light Tower', 'SUBMITTED')],
  'REQ-2': [L('REQ-2', 'Roller', 'ALLOCATED', { serial: 'RL-9' }), L('REQ-2', 'Generator', 'DEPLOYED')],
  'REQ-3': [L('REQ-3', 'Crane', 'DRAFT')],
  'REQ-4': [L('REQ-4', 'Pump', 'SUBMITTED')],
  'REQ-5': [L('REQ-5', 'Saw', 'REJECTED')],
  'REQ-6': [L('REQ-6', 'Truck', 'RETURNED')],
};
const who = ['priya.raman', 'Priya Raman'];
const can = { decide: true, pick: true, request: true };
const mine = track.cards(rows, lines, { who, scope: 'mine', can, now });
T.eq('mine: the requests I raised', mine.map((c) => c.number).join(), 'REQ-1,REQ-2,REQ-3,REQ-5,REQ-6');
T.eq('everyone\'s', track.cards(rows, lines, { who, scope: 'all', can, now }).length, 6);
const by = (n) => mine.filter((c) => c.number === n)[0];
T.eq('where it is', by('REQ-1').headline, 'Waiting for approval');
T.eq('what is next', by('REQ-1').next, 'Equipment Manager to approve it (2 of 2)');
T.eq('waiting for a decision: approve, for a decider', by('REQ-1').approve, true);
T.eq('not for someone who may not decide', track.cards(rows, lines, { who, scope: 'mine', can: { pick: true }, now })[0].approve, false);
T.eq('pieces ready at the yard: pick', by('REQ-2').pick, 1);
T.eq('a draft: carry on', by('REQ-3').carryOn, true);
T.eq('sent back: carry on (fix it)', [by('REQ-5').carryOn, by('REQ-5').sentBack].join(), 'true,true');
T.eq('only if you may raise requests', track.cards(rows, lines, { who, scope: 'mine', can: {}, now }).filter((c) => c.carryOn).length, 0);
T.eq('a journey bar segment per piece', by('REQ-2').segs.length, 2);
const chips = track.chips(mine);
const n = (k) => chips.filter((c) => c.key === k)[0].count;
T.eq('chips: needs you (draft, sent back)', n('action'), 2);
T.eq('open: everything not finished (sent back counts)', n('open'), 4);
T.eq('done', n('done'), 1);
T.eq('all', n('all'), 5);
T.eq('opens on what needs you', track.firstChip(mine), 'action');
T.eq('nothing needs you: open', track.firstChip(mine.filter((c) => !c.keys.includes('action'))), 'open');
T.eq('a chip', track.filter(mine, 'action', '').map((c) => c.number).join(), 'REQ-3,REQ-5');
T.eq('search reaches the equipment', track.filter(mine, 'all', 'light tower').map((c) => c.number).join(), 'REQ-1');
T.eq('every word must match', track.filter(mine, 'all', 'pier crane').length, 0);
const eq = track.equipment(lines['REQ-2'], false);
T.eq('a piece in words', [eq[0].name, eq[0].label, eq[0].stage, eq[0].serial].join(), 'Roller,Unit assigned,ready,Unit RL-9');
T.eq('no unit yet: nothing said twice', eq[1].serial, '');
T.eq('what is next for it', eq[0].next, 'Equipment Manager to confirm it for picking');
const kept = track.keep(mine, 2);
T.eq('the phone keeps a few cards, without the search text', [kept.length, 'text' in kept[0]].join(), '2,false');
const back = track.restore(kept);
T.eq('back from the phone: searchable, no steps (they need a connection)', [back[0].approve, back[0].carryOn, track.filter(back, 'all', 'pier').length].join(), 'false,false,1');

// ── Offline copy ────────────────────────────────────────────────────────────────────────────────────────
T.section('the copy kept on the phone (offlineSnapshot)');
const store = {};
const fakeWindow = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
const snap = load('offlineSnapshot', {}, { window: fakeWindow });
T.eq('kept', snap.save('track:mine', 'Priya.Raman', [{ number: 'REQ-1' }], now), true);
T.eq('per user, any case', snap.read('track:mine', 'priya.raman').data[0].number, 'REQ-1');
T.eq('another user sees nothing', snap.read('track:mine', 'dana.cole'), null);
snap.clear('track:mine', 'priya.raman');
T.eq('cleared', snap.read('track:mine', 'priya.raman'), null);
store['equiprite-mobile:bad:x'] = '{oops';
T.eq('a broken copy is no copy', snap.read('bad', 'x'), null);
const noStore = load('offlineSnapshot', {}, { window: { get localStorage() { throw new Error('denied'); } } });
T.eq('no storage (private mode): never throws', [noStore.save('a', 'b', 1), noStore.read('a', 'b')].join(), 'false,');
const at = new Date(2026, 9, 30, 14, 5).getTime();
T.eq('saved today', snap.savedText(at, new Date(2026, 9, 30, 18, 0).getTime()), 'Saved on this phone at 14:05');
T.eq('saved before', snap.savedText(at, new Date(2026, 10, 2, 9, 0).getTime()), 'Saved on this phone 30 Oct, 14:05');

// ── Installing ──────────────────────────────────────────────────────────────────────────────────────────
T.section('installing it (installPrompt, pwaSetup, the manifest)');
const listeners = {};
const ip = load('installPrompt', {}, { window: { addEventListener: (n, fn) => { listeners[n] = fn; } }, navigator: { userAgent: 'x' } });
T.eq('an iPhone', ip.platform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari'), 'ios');
T.eq('Android', ip.platform('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile'), 'android');
T.eq('a computer', ip.platform('Mozilla/5.0 (Windows NT 10.0) Chrome/120'), 'other');
T.check('the iPhone steps name Add to Home Screen', ip.howTo('ios').join(' ').indexOf('Add to Home Screen') !== -1);
T.eq('no prompt offered yet', ip.canPrompt(), false);
let prompted = 0;
let changed = 0;
ip.onChange(() => { changed++; });
listeners.beforeinstallprompt({ preventDefault() {}, prompt() { prompted++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
T.eq('the browser offered it: kept for the Install button', [ip.canPrompt(), changed].join(), 'true,1');
T.eq('standalone: installed', ip.installed({ matchMedia: () => ({ matches: true }) }), true);
T.eq('in a browser tab: not installed', ip.installed({ matchMedia: () => ({ matches: false }), navigator: {} }), false);
T.eq('an iPhone home-screen app: installed', ip.installed({ navigator: { standalone: true } }), true);

T.eq('a browser tab is not the Android app', ip.inApp({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile' } }), false);
const appWin = { navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile EquipRiteApp/1.0 (Android)' },
  EquipRiteApp: { info: () => '{"app":"android","version":"1.0","pc":"192.168.1.23:18898"}' } };
T.eq('EquipRite for Android: it says so', ip.inApp(appWin), true);
T.eq('…installed already (no offer to install)', ip.installed(appWin), true);
T.eq('…and which PC it is connected to', ip.appInfo(appWin).pc, '192.168.1.23:18898');
let asked = '';
pending.push(ip.androidApp((u) => { asked = u; return Promise.resolve({ ok: true, json: () => Promise.resolve({ android: { version: '1.0' } }) }); })
  .then((has) => T.eq('the desktop app\'s Wi-Fi link serves the Android app', [has, asked].join(), 'true,/__app/info')));
pending.push(ip.androidApp(() => Promise.resolve({ ok: false })).then((has) => T.eq('under VBCS there is none', has, false)));

T.section('the Android app\'s own scanner (appScan) and its updates');
const appScan = load('appScan', {}, { window: { addEventListener() {} } });
T.eq('a browser: no app scanner', appScan.available({}), false);
const scanWin = { EquipRiteApp: { scan: (prompt) => { scanWin.asked = prompt; setTimeout(() => appScan.onResult({ detail: { text: 'RL-1002' } }), 5); } } };
T.eq('the app (1.1): its scanner', appScan.available(scanWin), true);
pending.push(appScan.scan('Point at the tag', scanWin).then((text) => T.eq('it reads a tag and hands it back', [text, scanWin.asked].join(' | '), 'RL-1002 | Point at the tag')));
const cancelWin = { EquipRiteApp: { scan: () => setTimeout(() => appScan.onResult({ detail: { text: '' } }), 5) } };
pending.push(new Promise((r) => setTimeout(r, 20)).then(() => appScan.scan('', cancelWin)).then((text) => T.eq('cancelled: nothing', text, '')));
pending.push(new Promise((r) => setTimeout(r, 40)).then(() => appScan.scan('', { EquipRiteApp: { scan: () => { throw new Error('gone'); } } }))
  .then((text) => T.eq('a scanner that fails: nothing, never stuck', text, '')));
T.eq('newer versions', [appScan.newer('1.1', '1.0'), appScan.newer('1.10', '1.9'), appScan.newer('1.1', '1.1'), appScan.newer('1.0', '1.1'), appScan.newer('2', '1.9.9')].join(),
  'true,true,false,false,true');
pending.push(ip.androidAppVersion(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ android: { version: '1.1' } }) }))
  .then((v) => T.eq('the version the PC serves', v, '1.1')));
pending.push(ip.androidAppVersion(() => Promise.resolve({ ok: false })).then((v) => T.eq('none served (VBCS)', v, null)));

T.section('Pick scans through the app\'s scanner (scanOpenChain)');
pending.push((async () => {
  const src = fs.readFileSync(path.join(APP, 'flows', 'pick', 'pages', 'pick-page-chains', 'scanOpenChain.js'), 'utf8');
  const calls = [];
  const fakeScan = { available: () => true, scan: async (prompt) => { calls.push('scan:' + prompt); return 'RL-1002'; } };
  const Actions = { callChain: async (c, o) => { calls.push(o.chain + ':' + o.params.value + ':' + o.params.source); } };
  let C;
  const sandbox = { console, setTimeout, Promise, Object, String, document: { getElementById: () => null }, window: {} };
  sandbox.define = (names, factory) => { C = factory(...names.map((n) => ({ 'vb/action/actionChain': class {}, 'vb/action/actions': Actions,
    'resources/js/unitScanner': { isCameraAvailable: () => ({ ok: false, message: 'no camera on http' }) }, 'resources/js/appScan': fakeScan })[n])); };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'scanOpenChain.js' });
  const v = { busy: false, sheet: '', scan: { open: false, last: { title: '' } }, unitText: '' };
  await new C().run({ $page: { variables: v } }, {});
  T.eq('the app\'s scanner reads the tag, and it is ticked as a camera read', calls.join(' | '), 'scan:Point the camera at the unit’s tag | scanHitChain:RL-1002:camera');
  T.eq('the sheet offers the next scan (the page\'s own camera untouched)', [v.sheet, v.scan.native, v.scan.open, v.scan.status].join(' | '), 'scan | true | false | Read RL-1002.');
})().catch((e) => T.check('Pick through the app\'s scanner: run finished', false, e && e.stack)));

const pwa = load('pwaSetup');
function fakeDoc(existing) {
  const head = { kids: (existing || []).slice(), appendChild(n) { this.kids.push(n); },
    querySelector(sel) {
      const m = /^(link|meta)\[(rel|name)="([^"]+)"\]$/.exec(sel);
      return this.kids.filter((k) => k.tag === m[1] && k.attrs[m[2]] === m[3])[0] || null;
    } };
  return { head, createElement: (tag) => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }) };
}
const doc = fakeDoc();
const added = pwa.apply(doc, (p) => '/version_1/' + p);
T.check('the manifest, the icons, the bar colour', ['manifest', 'apple-touch-icon', 'icon', 'theme-color'].every((k) => added.includes(k)), added.join());
T.eq('at the version folder\'s address', doc.head.querySelector('link[rel="manifest"]').attrs.href, '/version_1/resources/pwa/manifest.json');
T.eq('VB\'s own PWA manifest is left alone', pwa.apply(fakeDoc([{ tag: 'link', attrs: { rel: 'manifest', href: 'vb.json' } }]), (p) => p).includes('manifest'), false);
T.eq('twice adds nothing more', pwa.apply(doc, (p) => p).length, 0);

const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'resources', 'pwa', 'manifest.json'), 'utf8'));
T.eq('the manifest: name, standalone', [manifest.name, manifest.display].join(), 'EquipRite Mobile,standalone');
T.eq('it starts at the app (three folders up from the manifest, past the version folder)',
  new URL(manifest.start_url, 'https://h/ic/webApps/equiprite-mobile/version_9/resources/pwa/manifest.json').href, 'https://h/ic/webApps/equiprite-mobile/');
T.eq('icons 192 and 512, and a maskable one', manifest.icons.map((i) => i.sizes + ':' + i.purpose).join(), '192x192:any,512x512:any,512x512:maskable');
T.eq('every icon is there', manifest.icons.concat([{ src: 'apple-touch-icon.png' }]).filter((i) => !fs.existsSync(path.join(APP, 'resources', 'pwa', i.src))).length, 0);
T.eq('shortcuts open a tab', manifest.shortcuts.map((s) => s.url.split('=')[1]).join(), 'approve,pick,request');

// ── Guards ──────────────────────────────────────────────────────────────────────────────────────────────
T.section('guards');
// Mobile's own modules; each tab's builder adds theirs (mobileApprove, mobilePick, mobileRequest).
const MOBILE_ONLY = ['mobileTabs', 'mobileBus', 'trackList', 'offlineSnapshot', 'installPrompt', 'pwaSetup', 'mobileApprove', 'mobilePick', 'mobileRequest', 'appScan',
  'mobileRecent'];
const shared = fs.readdirSync(JS).filter((f) => f.endsWith('.js') && !MOBILE_ONLY.includes(f.replace(/\.js$/, '')));
const differ = shared.filter((f) => !fs.existsSync(path.join(NEXT, 'resources', 'js', f))
  || fs.readFileSync(path.join(JS, f), 'utf8') !== fs.readFileSync(path.join(NEXT, 'resources', 'js', f), 'utf8'));
T.eq('the modules shared with Next are the same files (change them in both)', differ.join(), '');
T.check('Next\'s shell-only modules are not here', !['nav.js', 'shellBus.js', 'tabs.js', 'shellTabs.js'].some((f) => fs.existsSync(path.join(JS, f))));

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out); else out.push(p);
  });
  return out;
}
const files = walk(APP, []);
const pages = files.filter((f) => /-page\.json$/.test(f));
const missing = [];
pages.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  const dir = f.replace(/\.json$/, '-chains');
  (src.match(/"chain":\s*"([^"]+)"/g) || []).map((m) => m.split('"')[3]).forEach((c) => {
    if (!fs.existsSync(path.join(dir, c + '.js')) && !fs.existsSync(path.join(APP, 'chains', c + '.js'))) missing.push(path.basename(f) + ':' + c);
  });
  const own = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  own.forEach((c) => {
    const name = c.replace(/\.js$/, '');
    const used = src.indexOf('"' + name + '"') !== -1 || own.some((o) => fs.readFileSync(path.join(dir, o), 'utf8').indexOf("chain: '" + name + "'") !== -1);
    if (!used) missing.push('unused ' + c);
  });
});
T.eq('every chain a page names exists, and each is used', missing.join(), '');
T.eq('every tab\'s page can sit in the switcher (embeddable)', pages.filter((f) => !/shell-page/.test(f) && !/"embeddable":\s*"enabled"/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f)).join(), '');
const flows = fs.readdirSync(path.join(APP, 'flows'));
T.eq('every tab has its flow and page', tabs.TABS.filter((t) => !fs.existsSync(path.join(APP, 'flows', t.flow, 'pages', t.page + '-page.json'))).map((t) => t.id).join(), '');
T.eq('and every flow is a tab', flows.filter((f) => !tabs.TABS.some((t) => t.flow === f)).join(), '');

const bad = [];
files.filter((f) => f.endsWith('.html')).forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  (src.match(/\[\[[\s\S]*?\]\]|\{\{[\s\S]*?\}\}/g) || []).forEach((b) => {
    if (/=>|\b(String|Number|Boolean)\(|\[\s*[\w$'"]/.test(b.slice(2, -2).replace(/\$variables\.\w+\[/g, ''))) bad.push(path.basename(f) + ': ' + b.slice(0, 70));
  });
  if (/<(table|tbody|select)[^>]*>\s*<oj-bind-for-each/.test(src)) bad.push(path.basename(f) + ': for-each in a table or select');
});
T.eq('bindings: no arrow functions, String/Number/Boolean or array literals (VB expressions)', bad.join(' | '), '');
const icons = new Set();
files.filter((f) => /\.(html|js)$/.test(f) && !/mapbox-gl/.test(f)).forEach((f) => (fs.readFileSync(f, 'utf8').match(/oj-ux-ico-[a-z0-9-]+/g) || []).forEach((i) => icons.add(i)));
T.check('icons come from the Redwood icon font (oj-ux-ico-*)', icons.size > 5);
T.eq('index.html: the app\'s own title', /<title>EquipRite Mobile<\/title>/.test(fs.readFileSync(path.join(APP, 'index.html'), 'utf8')), true);

// The last 3 days (below) runs its chains, then reports.
// ── My requests on the last 3 days ──────────────────────────────────────────────────────────────────────
T.section('My requests open on the last 3 days (mobileRecent); search, All and a request handed over reach the older ones');
function loadFile(file, deps, extra) {
  const sandbox = Object.assign({ console, Intl, Date, setTimeout, JSON, Promise }, extra || {});
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
(async () => {
  // Dated from the clock: the chains read it.
  const rd = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const RROWS = [
    { eqrEquipmentRequestId: 21, requestNumber: 'REQ-21', status: 'SUBMITTED', projectName: 'Pier B', requestorUsername: 'priya.raman', startDate: rd(4), endDate: rd(30) },
    { eqrEquipmentRequestId: 22, requestNumber: 'REQ-22', status: 'DRAFT', projectName: 'Gas Line', requestorUsername: 'priya.raman', createdDate: rd(-1) + 'T09:00:00Z' },
    { eqrEquipmentRequestId: 23, requestNumber: 'REQ-23', status: 'IN_PROCESS', projectName: 'Old Quarry', requestorUsername: 'priya.raman', startDate: rd(-40), endDate: rd(-10),
      createdDate: rd(-45) + 'T08:00:00Z', lastUpdateDate: rd(-9) + 'T08:00:00Z' },
    { eqrEquipmentRequestId: 24, requestNumber: 'REQ-24', status: 'DRAFT', projectName: 'Old Dock', requestorUsername: 'priya.raman', createdDate: rd(-20) + 'T08:00:00Z',
      lastUpdatedDate: rd(-20) + 'T09:00:00Z' },
    { eqrEquipmentRequestId: 25, requestNumber: 'REQ-25', status: 'SUBMITTED', projectName: 'No dates', requestorUsername: 'priya.raman' },
  ];
  const RLINES = { 'REQ-21': [L('REQ-21', 'Dozer', 'SUBMITTED')], 'REQ-22': [L('REQ-22', 'Crane', 'DRAFT')], 'REQ-23': [L('REQ-23', 'Crusher', 'DEPLOYED')],
    'REQ-24': [L('REQ-24', 'Pump', 'DRAFT')], 'REQ-25': [L('REQ-25', 'Saw', 'SUBMITTED')] };
  const rc = track.cards(RROWS, RLINES, { who, scope: 'mine', can, now: Date.now() });
  const rby = (n) => rc.filter((c) => c.number === n)[0];
  T.eq('a card keeps its latest date: raised, changed, start, end', [rby('REQ-23').lastAt === recent.ms(rd(-9) + 'T08:00:00Z'), rby('REQ-21').lastAt === recent.ms(rd(30)),
    rby('REQ-25').lastAt].join(), 'true,true,');
  T.eq('…kept on the phone and back', track.restore(track.keep(rc)).filter((c) => !recent.isRecent(c, Date.now())).map((c) => c.number).join(), 'REQ-23,REQ-24');

  const TP = path.join(APP, 'flows', 'track', 'pages');
  const pj = JSON.parse(fs.readFileSync(path.join(TP, 'track-page.json'), 'utf8'));
  const pv = {};
  Object.keys(pj.variables).forEach((k) => { pv[k] = JSON.parse(JSON.stringify(pj.variables[k].defaultValue === undefined ? null : pj.variables[k].defaultValue)); });
  pv.all = rc;
  pv.isLoading = false;
  pv.chip = 'all';
  const asked = [];
  const tbus = load('mobileBus');
  const Actions = { async callChain(c, o) { asked.push(o.chain + (o.params && o.params.period ? ':' + o.params.period : '')); if (o.chain === 'applyChain' || o.chain === 'openChain') await chainRun(o.chain, o.params); } };
  const deps = { 'vb/action/actionChain': class {}, 'vb/action/actions': Actions, 'resources/js/trackList': track, 'resources/js/mobileRecent': recent, 'resources/js/mobileBus': tbus,
    'resources/js/requestData': { load: async () => ({ linesByRequest: RLINES }) }, 'resources/js/requestHistory': { load: async () => ({ milestones: [], note: '' }) } };
  const ctx = { $page: { variables: pv } };
  async function chainRun(name, params) {
    const C = loadFile(path.join(TP, 'track-page-chains', name + '.js'), deps, { window: { scrollTo() {} } });
    return new C().run(ctx, params || {});
  }
  const shownNow = () => pv.shown.map((c) => c.number).join();
  T.eq('a list opens on the last 3 days', pv.period, 'recent');
  await chainRun('applyChain', {});
  T.eq('the last 3 days: an old request is left out; no date at all, or raised yesterday, keeps one in', shownNow(), 'REQ-21,REQ-22,REQ-25');
  T.eq('the chips count the period', track.chips(pv.shown).filter((c) => c.key === 'all')[0].count + ':' + pv.chips.filter((c) => c.key === 'all')[0].count, '3:3');
  T.eq('under the list: what it leaves out', JSON.stringify([pv.dated.older, pv.dated.olderText, pv.dated.filtered, pv.dated.count]), '[2,"2 older requests",true,3]');
  await chainRun('applyChain', { chip: 'action' });
  T.eq('…under the chip (an old draft)', [shownNow(), pv.dated.olderText].join(' | '), 'REQ-22 | 1 older request');
  await chainRun('applyChain', { chip: 'all', text: 'quarry' });
  T.eq('a search looks through every date, saying so', [shownNow(), pv.dated.searching, pv.dated.older].join(' | '), 'REQ-23 | true | 0');
  await chainRun('applyChain', { text: '' });
  await chainRun('applyChain', { period: 'all' });
  T.eq('All: every date', [shownNow(), pv.dated.filtered, pv.dated.older].join(' | '), 'REQ-21,REQ-22,REQ-23,REQ-24,REQ-25 | false | 0');
  await chainRun('applyChain', { period: 'recent' });
  tbus.focus('track', { number: 'REQ-23' });
  await chainRun('focusChain', {});
  T.eq('an older request handed over (another tab, a deep link) still opens; the list behind it shows every date', [asked.join(), pv.view, pv.sel.number, pv.period].join(' | '),
    'applyChain:all,openChain | detail | REQ-23 | all');
  await chainRun('openChain', { number: '' });
  await chainRun('applyChain', { period: 'recent' });
  asked.length = 0;
  tbus.focus('track', { number: 'REQ-21' });
  await chainRun('focusChain', {});
  T.eq('a recent one leaves the period as it is', [asked.join(), pv.sel.number, pv.period].join(' | '), 'openChain | REQ-21 | recent');

  const TPage = loadFile(path.join(TP, 'track-page.js'), { 'resources/js/mobileBus': tbus, 'resources/js/requestData': { onChange() {} }, 'resources/js/mobileRecent': recent });
  const tp = new TPage();
  T.eq('the line under the title says so', [tp.summary(false, { count: 3, filtered: true }, 'mine'), tp.summary(false, { count: 1, filtered: false }, 'all'),
    tp.summary(true, {}, 'mine')].join(' | '), '3 requests in the last 3 days | 1 request, everyone’s | Loading…');
  T.eq('an empty period says what it leaves out', [tp.empty('action', '', 'mine', { filtered: true, older: 2 }), tp.empty('all', '', 'mine', { filtered: true, older: 2 }),
    tp.empty('ready', '', 'mine', { filtered: true, older: 1 }), tp.empty('action', '', 'mine', { filtered: true, older: 0 }), tp.empty('all', 'x', 'mine', { filtered: true, older: 2 })].join(' | '),
    'Nothing needs you in the last 3 days. | No requests in the last 3 days. | No request is at this stage in the last 3 days. | Nothing needs you now. | No request matches “x”.');
  T.eq('the period\'s name', tp.recentLabel(), 'Last 3 days');
})().catch((e) => T.check('the last 3 days: run finished', false, e && e.stack))
  .then(() => Promise.all(pending)).then(() => T.report());
