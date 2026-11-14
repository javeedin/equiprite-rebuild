#!/usr/bin/env node
'use strict';
/**
 * Capture screenshot and Run it, in your workspace (desktop/lib/pages.js capture()/run(); the desktop app opens the page
 * in your working folder's build, lib/workPreview.js):
 *   - the screenshot says it is of your working folder's code, and where the page sent the capture when it did not show
 *     itself (a guard: a module turned off) — kept with the screenshot, so the viewer says so too
 *   - Run it: the page's app and address handed to the desktop app; a page with no address of its own: said
 *   - without the desktop app: Run it is not offered
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');
const P = require('../desktop/lib/pages');

const T = H.makeAsserter();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-cap-ws-'));
  try {
    // a workspace's working folder: one app, a flow with a page
    const work = path.join(tmp, 'BuildRite', 'rebuild-app-dev-one', 'working');
    const app = path.join(work, 'webApps', 'vbredwoodapp');
    const pages = path.join(app, 'flows', 'customer-portal', 'pages');
    fs.mkdirSync(pages, { recursive: true });
    fs.writeFileSync(path.join(app, 'app-flow.json'), JSON.stringify({ id: 'vbredwoodapp', defaultPage: 'shell' }));
    fs.writeFileSync(path.join(app, 'flows', 'customer-portal', 'customer-portal-flow.json'), JSON.stringify({ id: 'customer-portal', defaultPage: 'customer-dashboard' }));
    fs.writeFileSync(path.join(pages, 'customer-dashboard-page.json'), JSON.stringify({ variables: {} }));
    fs.writeFileSync(path.join(pages, 'customer-dashboard-page.html'), '<div class="oj-flex"><h1>Customer Dashboard</h1></div>');
    fs.writeFileSync(path.join(pages, 'customer-dashboard-page.js'), 'define([], () => { class PageModule {} return PageModule; });');
    const dataDir = path.join(tmp, 'data');
    const fakeData = { ok: true, dir: dataDir, onMerged: () => {}, resolve: () => null, merged: () => {}, info: () => ({ separate: true, branch: 'data', reason: '' }) };
    const ID = 'vbredwoodapp/customer-portal/customer-dashboard';
    const asked = [], ran = [];
    let landed = '/vp/shell/main/main-equiprite';
    const st = P.open({ root: path.join(__dirname, '..'), data: fakeData, rootFn: () => work, rootLabel: () => 'Rebuild App ▸ Dev_One (dev-one)', spaceFn: () => 'acme-dev1_rebuild-app_100010',
      capture: async (a, url) => { asked.push(a + ' ' + url); return { ok: true, base64: PNG, mime: 'image/png', from: 'workspace', built: true, landed: landed }; },
      run: async (a, url) => { ran.push(a + ' ' + url); return { ok: true, url: 'http://127.0.0.1:4100' + url, from: 'workspace', built: false }; } });

    T.section('a screenshot of your working folder\'s code; where the page sent it');
    const c1 = await st.capture(ID, { by: 'priya.raman' });
    T.check('the page\'s app and address asked for; said: from your workspace, built just now', c1.ok && asked[0] === 'vbredwoodapp /vp/shell/customer-portal/customer-dashboard' && c1.from === 'workspace' && c1.built === true, JSON.stringify(c1).slice(0, 300));
    T.check('…the page sent it elsewhere (a guard): said, with where it asked and where it landed', c1.landed === '/vp/shell/main/main-equiprite' && c1.asked === '/vp/shell/customer-portal/customer-dashboard');
    const shot = st.sheet(ID).sheet.screenshots[0];
    T.check('…kept with the screenshot (the viewer says so)', shot.from === 'workspace' && shot.landed === '/vp/shell/main/main-equiprite' && shot.source === 'capture', JSON.stringify(shot));
    landed = '';
    const c2 = await st.capture(ID, { by: 'priya.raman' });
    const shot2 = st.sheet(ID).sheet.screenshots[1];
    T.check('the page showed itself: nothing said about where it went', c2.ok && c2.landed === '' && !shot2.landed && shot2.from === 'workspace');
    const up = st.saveShot(ID, { base64: PNG, mime: 'image/png', by: 'priya.raman', source: 'upload', from: 'workspace', landed: '/x' });
    T.check('an upload: neither (it is whatever was uploaded)', up.ok && !up.shot.from && !up.shot.landed);

    T.section('Run it');
    const r = await st.run(ID);
    T.check('the page\'s app and address handed to the desktop app; its answer passed on', r.ok && ran[0] === 'vbredwoodapp /vp/shell/customer-portal/customer-dashboard' && r.url === 'http://127.0.0.1:4100/vp/shell/customer-portal/customer-dashboard' && r.from === 'workspace' && st.canRun());
    const none = await st.run('vbredwoodapp/customer-portal/not-a-page');
    T.check('…a page not in the code: said', !none.ok && /no page/.test(none.error));
    const bare = P.open({ root: path.join(__dirname, '..'), rootFn: () => work });
    const b = await bare.run(ID);
    T.check('without the desktop app: not offered, and said if asked', !bare.canRun() && !b.ok && /desktop app/.test(b.error));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
