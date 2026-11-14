#!/usr/bin/env node
'use strict';
/**
 * Application pages read your workspace's code (desktop/lib/pages.js rootFn): when Build.Rite has a workspace set up on
 * this PC, the pages are scanned in its working folder — the VB apps there, named as they are (vbredwoodapp), a page's
 * facts and code read from there — and the screen is told whose code it is; none set up: this project, as before.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const P = require('../desktop/lib/pages');

const T = H.makeAsserter();
const REPO = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-pages-ws-'));
try {
  // a VB Studio workspace's working folder: one app (vbredwoodapp), a flow with two pages
  const work = path.join(tmp, 'Projects', 'rebuild-app-dev_one', 'working');
  const app = path.join(work, 'webApps', 'vbredwoodapp');
  const pages = path.join(app, 'flows', 'customer-portal', 'pages');
  fs.mkdirSync(pages, { recursive: true });
  fs.writeFileSync(path.join(app, 'app-flow.json'), JSON.stringify({ id: 'vbredwoodapp', defaultPage: 'shell' }));
  fs.writeFileSync(path.join(app, 'flows', 'customer-portal', 'customer-portal-flow.json'), JSON.stringify({ id: 'customer-portal', defaultPage: 'customer-dashboard' }));
  ['customer-dashboard', 'customer-billing'].forEach((pg) => {
    fs.writeFileSync(path.join(pages, pg + '-page.json'), JSON.stringify({ variables: {} }));
    fs.writeFileSync(path.join(pages, pg + '-page.html'), '<div class="oj-flex"><h1>' + pg + ' (from the workspace)</h1></div>');
    fs.writeFileSync(path.join(pages, pg + '-page.js'), 'define([], () => { class PageModule {} return PageModule; });');
  });

  let current = '';
  const st = P.open({ root: REPO, rootFn: () => current, rootLabel: () => (current ? 'Rebuild_App ▸ Dev_One (dev-one)' : '') });

  T.section('no workspace set up: this project');
  const c0 = st.catalog(true);
  T.check('this project\'s pages (Old, New, Next…: its apps\' names); no other source said', c0.pages.length > 100 && c0.pages.some((p) => p.appName === 'EquipRite Next') && c0.source === '' && c0.root === path.resolve(REPO), c0.pages.length + ' ' + c0.source);

  T.section('a workspace set up: its working folder');
  current = work;
  const c1 = st.catalog(true);
  T.check('the workspace\'s pages, read from its working folder (not this project\'s)', c1.pages.filter((p) => !p.missing).map((p) => p.id).sort().join() === 'vbredwoodapp/customer-portal/customer-billing,vbredwoodapp/customer-portal/customer-dashboard', c1.pages.map((p) => p.id).slice(0, 5).join());
  T.check('…its app named as it is (vbredwoodapp — not "Old EquipRite"); whose code it is said (the workspace, its folder)', c1.pages.filter((p) => !p.missing).every((p) => p.appName === 'vbredwoodapp') && c1.source === 'Rebuild_App ▸ Dev_One (dev-one)' && c1.root === path.resolve(work), c1.source);
  const sh = st.sheet('vbredwoodapp/customer-portal/customer-dashboard');
  T.check('…a page\'s facts from the workspace\'s code', sh.ok && sh.sheet.facts && /from the workspace/.test(JSON.stringify(sh.sheet.facts)), JSON.stringify(sh).slice(0, 300));
  const code = st.code('vbredwoodapp/customer-portal/customer-dashboard');
  T.check('…its code (Page code): its files in the working folder', code.ok && code.folder === path.resolve(work) && code.files.some((f) => /customer-dashboard-page\.html$/.test(f.path)));
  const file = st.codeFile('vbredwoodapp/customer-portal/customer-dashboard', code.files.filter((f) => /\.html$/.test(f.path))[0].path);
  T.check('…a file of it read from there', file.ok && /from the workspace/.test(file.text) && file.abs.indexOf(work) === 0, file.abs);

  T.section('a VB Studio project\'s own sheets, screenshots and stories — never this project\'s (the same page name)');
  const dataDir = path.join(tmp, 'data');
  const fakeData = { ok: true, dir: dataDir, onMerged: () => {}, resolve: () => null, merged: () => {}, info: () => ({ separate: true, branch: 'data', reason: '' }) };
  let cur2 = '';
  const st2 = P.open({ root: REPO, data: fakeData, rootFn: () => cur2, rootLabel: () => (cur2 ? 'Rebuild_App ▸ Dev_One (dev-one)' : ''), spaceFn: () => (cur2 ? 'acme-dev1-demo-phx_rebuild-app_100010' : '') });
  const ID = 'vbredwoodapp/customer-portal/customer-dashboard';
  // this project's page of that name: its sheet and a screenshot
  const own = st2.build(ID, { by: 'priya.raman' });
  const ownShot = st2.saveShot(ID, { base64: Buffer.from('own-png').toString('base64'), mime: 'image/png', by: 'priya.raman' });
  T.check('this project\'s page: its sheet and screenshot where they always were', own.ok && ownShot.ok && ownShot.shot.file.indexOf('screens/') === 0 && fs.existsSync(path.join(dataDir, P.RES, 'sheets', P.fileOf(ID) + '.json')), JSON.stringify(ownShot.shot || ownShot));
  cur2 = work;
  const before = st2.sheet(ID);
  T.check('your workspace\'s page of the same name: no sheet, no screenshot of its own yet — this project\'s not lent to it', before.ok && !before.saved && (before.sheet.screenshots || []).length === 0 && st2.catalog().space === P.RES + '/projects/acme-dev1-demo-phx_rebuild-app_100010', JSON.stringify(before).slice(0, 200));
  const b2 = st2.build(ID, { by: 'javeed.shaik' });
  const shot2 = st2.saveShot(ID, { base64: Buffer.from('ws-png').toString('base64'), mime: 'image/png', by: 'javeed.shaik' });
  const spaceDir = path.join(dataDir, P.RES, 'projects', 'acme-dev1-demo-phx_rebuild-app_100010');
  T.check('…its sheet built and a screenshot added: in that project\'s own folder (projects/<org>_<project>/), its app named as it is', b2.ok && shot2.ok && shot2.shot.file === 'projects/acme-dev1-demo-phx_rebuild-app_100010/screens/' + P.fileOf(ID) + '.1.png'
      && fs.existsSync(path.join(spaceDir, 'sheets', P.fileOf(ID) + '.json')) && fs.readFileSync(path.join(dataDir, P.RES, shot2.shot.file), 'utf8') === 'ws-png' && st2.sheet(ID).sheet.facts.appName === 'vbredwoodapp', JSON.stringify(shot2.shot || shot2));
  const ws1 = st2.sheet(ID).sheet;
  cur2 = '';
  const own2 = st2.sheet(ID).sheet;
  T.check('…each keeps its own: the workspace\'s one screenshot (its own image), this project\'s one (its own) — never mixed', (ws1.screenshots || []).length === 1 && ws1.screenshots[0].file.indexOf('projects/') === 0 && (own2.screenshots || []).length === 1 && own2.screenshots[0].file.indexOf('screens/') === 0
      && own2.by === 'priya.raman' && ws1.by === 'javeed.shaik', JSON.stringify([ws1.screenshots, own2.screenshots]));

  T.section('the workspace gone (or removed): this project again');
  current = '';
  T.check('this project\'s pages again', st.catalog(true).pages.length > 100 && st.catalog().source === '');
} catch (e) {
  T.check('no exception: ' + (e && e.stack), false);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
T.report();
