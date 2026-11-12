/*
 * EquipRite Next's Application pages (flows/insights app-pages), in a browser, against a throwaway copy of the project's
 * code that is a git repository with its own origin: every page listed, a page's facts read from its code, its technical
 * sheet built and pushed, a Jira story mapped, a screenshot captured (a stand-in for the desktop app's hidden window),
 * the page explained by AI (a stub LLM), the filters — then the same screen read only (as in VBCS).
 *
 * Run:  node tests/e2e/next-app-pages.e2e.js   (after npm run build)
 */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 300);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ID = 'vbredwoodapp/equipment-foundation/equipment-workbench';

(async () => {
  const shots = [];
  const pg = await E.pagesSandbox({ capture: async (app, url) => { shots.push(app + ' ' + url); return { ok: true, base64: PNG, mime: 'image/png' }; } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-pages-ai-'));
  const llm = [];
  const aiStore = await require('../../desktop/lib/aiSql').open({ file: path.join(dir, 'ai.json'), encrypt: (t) => Buffer.from(t), decrypt: (b) => String(b),
    fetch: async (url, init) => { llm.push(String((init && init.body) || '')); return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '## What this page is for\n- The equipment manager works the requests.\n## How people use it\n- Pick a request.\n## Business logic\n- `WorkbenchInitChain` reads the requests.\n## Integrations\n- GET /equiprite/v1/views/workbench-requests on EquipRite REST.\n## Things to watch\n- None.' } }] }) }; } });
  aiStore.save({ provider: 'openai', key: 'sk-test', model: 'gpt-4o' });
  const env = await E.start({ port: 19840, app: 'next', pagesStore: pg.store, aiStore });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('every VB page of the project');
    await env.open('/?open=app-pages');
    await page.waitForSelector('#pgRows .nx-pg-row', { timeout: 30000 });
    const nAll = (await page.$$('#pgRows .nx-pg-row')).length;
    T.check('every page listed, and counted in the subtitle', nAll >= 150 && new RegExp('^' + nAll + ' pages in the code · 0 with a technical sheet · 0 Jira stories mapped').test(await text(page, '#pgSub')), nAll + ' ' + await text(page, '#pgSub'));
    T.check('one chip per app, with its count', /Old EquipRite\s*50/.test(await text(page, '#pgApps')) && /EquipRite Next\s*\d+/.test(await text(page, '#pgApps')));
    T.check('kept in git: the branch, everything in git', /pages\/test → origin\/pages\/test · everything is in git/.test(await text(page, '#pgGitState')));
    await page.click('#pgApps [data-value="vbredwoodapp"]');
    await page.fill('#pgSearch', 'workbench');
    await page.dispatchEvent('#pgSearch', 'input');
    await settle(page, 300);
    T.check('filtered by app and by what is typed', (await page.$$('#pgRows .nx-pg-row')).length >= 1 && /Equipment Manager Workbench/.test(await text(page, '#pgRows')) && !/EquipRite Next ·/.test(await text(page, '#pgRows')));

    T.section('a page\'s facts, read from its code');
    await page.click('#pgRows .nx-pg-row[data-id="' + ID + '"]');
    await page.waitForSelector('#pgSheetTitle', { timeout: 10000 });
    T.check('its name, app, flow/page, where it opens; not saved yet', (await text(page, '#pgSheetTitle')) === 'Equipment Manager Workbench'
      && /No technical sheet saved yet/.test(await text(page, '#pgSheetState')) && /Opens at \/vp\/shell\/equipment-foundation\/equipment-workbench/.test(await text(page, '#pgSheet')));
    T.check('the page\'s tab: one sheet, Overview, Integrations, Business logic, Features, Links & files all shown (the maps are the other tabs)', (await page.$$('#pgTabs [role="tab"]')).length === 3
      && ['pgOverview', 'pgIntegrations', 'pgLogic', 'pgFeatures', 'pgLinks'].every((x) => !!x) && (await page.$$('#pgSheet .nx-pg-part')).length === 5
      && /Overview\s*Integrations\s*Business logic\s*Features\s*Links & files/.test((await page.$$eval('#pgSheet .nx-pg-part', (h) => h.map((x) => x.textContent).join(' ')))));
    T.check('Integrations: the REST call → GET, its path, EquipRite REST, the chain that makes it', /GET\s*\/equiprite\/v1\/views\/workbench-requests/.test(await text(page, '#pgRest')) && /EquipRite REST \(eqpt\)/.test(await text(page, '#pgRest')) && /WorkbenchInitChain/.test(await text(page, '#pgRest')));
    T.check('Business logic: each chain with what its comment says', /WorkbenchInitChain/.test(await text(page, '#pgLogic')) && /RowClickChain/.test(await text(page, '#pgLogic')) && /enforcePageAccessChain/.test(await text(page, '#pgLogic')));
    T.check('Features: what reacts and runs what, the table\'s columns, when it runs, its components', /first selected row changed/.test(await text(page, '#pgFeatures')) && /Request #/.test(await text(page, '#pgFeatures'))
      && /when the page opens/.test(await text(page, '#pgFeatures')) && /oj-table/.test(await text(page, '#pgFeatures')));

    T.section('build the sheet, map a story, capture, explain — each pushed to git');
    await page.click('#pgBuild');
    await page.waitForFunction(() => /Sheet built/.test((document.getElementById('pgSheetState') || {}).textContent || ''), null, { timeout: 20000 });
    T.check('the sheet is saved and pushed', /The technical sheet is saved\. Pushed to origin\/pages\/test/.test(await text(page, '#pgResult')) && pg.gitRemote('log', '-1', '--format=%s', 'pages/test') === 'Application pages: sheet of ' + ID, await text(page, '#pgResult'));
    await page.fill('#pgMapKey', 'eqp-93');
    await page.dispatchEvent('#pgMapKey', 'input');
    await page.click('#pgMapBtn');
    await page.waitForFunction(() => /EQP-93/.test((document.getElementById('pgMap') || {}).textContent || ''), null, { timeout: 20000 });
    T.check('a story mapped: its chip on the sheet, its number in the page table, the sheet reused, pushed', /its sheet was already there/.test(await text(page, '#pgResult'))
      && JSON.parse(fs.readFileSync(path.join(pg.root, 'webApps/equiprite-next/resources/pages/catalog.json'), 'utf8')).pages.filter((p) => p.id === ID)[0].stories.join() === 'EQP-93'
      && pg.gitRemote('log', '-1', '--format=%s', 'pages/test') === 'Application pages: map EQP-93 to ' + ID);
    T.check('no screenshot yet', /None yet/.test(await text(page, '#pgShots')));
    await page.click('#pgCapture');
    await page.waitForSelector('#pgShots .nx-pg-shotbtn', { timeout: 20000 });
    T.check('Capture screenshot: the page opened at its address; a numbered button, no thumbnail on the sheet', shots[0] === 'vbredwoodapp /vp/shell/equipment-foundation/equipment-workbench'
      && (await page.$$('#pgShots .nx-pg-shotbtn')).length === 1 && !(await page.$('#pgSheet img')) && !(await page.$eval('#pgViewer', (d) => d.open)));
    await page.setInputFiles('#pgShotFile', [{ name: 'Filters open.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') }, { name: 'Row picked.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') }]);
    await page.waitForFunction(() => document.querySelectorAll('#pgShots .nx-pg-shotbtn').length === 3, null, { timeout: 20000 }).catch(() => {});
    T.check('Upload several at once: added to the capture (3 now), one commit', (await page.$$('#pgShots .nx-pg-shotbtn')).length === 3 && /2 screenshots saved/.test(await text(page, '#pgResult'))
      && pg.gitRemote('log', '-1', '--format=%s', 'pages/test') === 'Application pages: a screenshot of ' + ID);
    await page.click('#pgShots .nx-pg-shotbtn[data-key="1"]');
    await page.waitForFunction(() => { const d = document.getElementById('pgViewer'); return d && d.open; }, null, { timeout: 10000 });
    await page.waitForFunction(() => { const i = document.getElementById('pgViewerImg'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => {});
    T.check('a button opens the viewer: that screenshot full size, its caption, who and when', /Screenshot 2 of 3/.test(await text(page, '#pgViewerTitle')) && /Filters open · Uploaded \d+ \w+ \d{4}/.test(await text(page, '#pgViewerText'))
      && await page.$eval('#pgViewerImg', (i) => i.naturalWidth > 0).catch(() => false));
    await page.click('#pgViewerNext');
    T.check('Next / Previous move through them', /Screenshot 3 of 3/.test(await text(page, '#pgViewerTitle')) && /Row picked/.test(await text(page, '#pgViewerText')) && await page.isDisabled('#pgViewerNext'));
    await page.click('#pgViewerPrev'); await page.click('#pgViewerPrev');
    T.check('…to the capture', /Screenshot 1 of 3/.test(await text(page, '#pgViewerTitle')) && /^Captured/.test(await text(page, '#pgViewerText')));
    await page.click('#pgViewerNext');
    page.once('dialog', (d) => d.accept());
    await page.click('#pgShotDelete');
    await page.waitForFunction(() => document.querySelectorAll('#pgShots .nx-pg-shotbtn').length === 2, null, { timeout: 20000 }).catch(() => {});
    T.check('Delete in the viewer removes that one (and is pushed)', (await page.$$('#pgShots .nx-pg-shotbtn')).length === 2 && !/Filters open/.test(await text(page, '#pgViewerText'))
      && pg.gitRemote('log', '-1', '--format=%s', 'pages/test') === 'Application pages: a screenshot of ' + ID + ' deleted');
    T.check('the viewer is a dialog in the top layer (modal), its Close button in view', await page.$eval('#pgViewer', (d) => d.open && d.matches(':modal')).catch(() => false)
      && await page.isVisible('#pgViewerClose') && await page.$eval('#pgViewerClose', (b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth; }));
    await page.click('#pgViewerClose');
    await settle(page, 200);
    T.check('× closes it', !(await page.$eval('#pgViewer', (d) => d.open)));
    await page.click('#pgShots .nx-pg-shotbtn[data-key="0"]');
    await page.waitForFunction(() => document.getElementById('pgViewer').open, null, { timeout: 5000 }).catch(() => {});
    await page.keyboard.press('Escape');
    await settle(page, 200);
    T.check('Escape closes it', !(await page.$eval('#pgViewer', (d) => d.open)));
    await page.click('#pgShots .nx-pg-shotbtn[data-key="0"]');
    await page.waitForFunction(() => document.getElementById('pgViewer').open, null, { timeout: 5000 }).catch(() => {});
    await page.mouse.click(5, 5);
    await settle(page, 200);
    T.check('a click outside the picture closes it', !(await page.$eval('#pgViewer', (d) => d.open)));
    await page.click('#pgShots .nx-pg-shotbtn[data-key="0"]');
    await page.waitForFunction(() => document.getElementById('pgViewer').open, null, { timeout: 5000 }).catch(() => {});
    await page.click('#pgViewerDone');
    await settle(page, 200);
    T.check('…and so does the Close button at the bottom', !(await page.$eval('#pgViewer', (d) => d.open)));
    await page.click('#pgExplain');
    await page.waitForFunction(() => { const f = document.getElementById('pgAi'); return f && /What this page is for/.test(f.getAttribute('srcdoc') || ''); }, null, { timeout: 20000 }).catch(() => {});
    await page.click('#pgOverview .nx-pg-facts [data-key="pgIntegrations"]');
    await settle(page, 600);
    T.check('a count in the Overview scrolls to its part', await page.$eval('#pgIntegrations', (e) => { const r = e.getBoundingClientRect(); return r.top < 200 && r.top > -50; }).catch(() => false));
    T.check('Explain with AI: from the code facts (the page, its chains and REST calls), saved with the sheet', /What this page is for/.test((await page.getAttribute('#pgAi', 'srcdoc')) || '')
      && llm.some((b) => /PAGE Equipment Manager Workbench/.test(b) && /GET \/equiprite\/v1\/views\/workbench-requests/.test(b)) && /Explained by ChatGPT/.test(await text(page, '#pgOverview')));
    await page.fill('#pgSearch', '');
    await page.dispatchEvent('#pgSearch', 'input');
    await page.click('#pgApps [data-value="all"]');
    await page.click('#pgOnlyMapped');
    await settle(page, 300);
    T.check('"Mapped to stories" shows the one page: its story, its screenshot count — no thumbnail', (await page.$$('#pgRows .nx-pg-row')).length === 1 && /EQP-93/.test(await text(page, '#pgRows'))
      && /Equipment Manager Workbench\s*●\s*2/.test(await text(page, '#pgRows .nx-pg-row')) && !(await page.$('#pgRows img')));
    T.check('…and the subtitle counts it', /1 with a technical sheet · 1 Jira stories mapped/.test(await text(page, '#pgSub')));
    await page.click('#pgOnlyMapped');
    await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTop = 0; });
    await env.shot('next-app-pages.png');

    T.section('tabs: the page, its map (where it is opened from, where it goes), the whole app\'s map');
    const DASH = 'vbredwoodapp/customer-portal/customer-dashboard';
    await page.fill('#pgSearch', '');
    await page.click('#pgApps [data-value="vbredwoodapp"]');
    await settle(page, 300);
    await page.click('#pgRows .nx-pg-row[data-id="' + DASH + '"]');
    await page.waitForFunction(() => /Customer Dashboard/.test((document.getElementById('pgSheetTitle') || {}).textContent || ''), null, { timeout: 10000 });
    T.check('three tabs: the page (by its name, open), Page map (with its link count), Global map · its app',
      /Customer Dashboard/.test(await text(page, '#pgTabPage')) && (await page.getAttribute('#pgTabPage', 'aria-selected')) === 'true'
      && /Page map\s*\d+/.test(await text(page, '#pgTabMap')) && /Global map · Old EquipRite/.test(await text(page, '#pgTabGlobal')) && await page.isVisible('#pgOverview'));
    await page.click('#pgTabMap');
    await page.waitForSelector('#pgPageMap .nx-pm-node--self', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('#pgPageMap svg path.nx-pm-edge').length > 3, null, { timeout: 5000 }).catch(() => {});
    const cols = await page.$$eval('#pgPageMap .nx-pm-col', (cs) => cs.map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
    T.check('Page map: Comes from (the menu, the pages that open it) → This page → Goes to → Then', cols.length === 4 && /^Comes from \d+ Menu/.test(cols[0]) && /^This page Customer Dashboard/.test(cols[1])
      && /^Goes to \d+/.test(cols[2]) && /My Billing/.test(cols[2]) && /^Then/.test(cols[3]) && !(await page.$('#pgOverview')), cols.join(' || ').slice(0, 400));
    T.check('…how it gets there (the chain), and lines drawn between the boxes, this page\'s highlighted', /by \w+Chain/.test(cols[2]) && (await page.$$('#pgPageMap svg path.nx-pm-edge')).length > 3
      && (await page.$$('#pgPageMap svg path.nx-pm-edge--hot')).length > 1);
    await env.shot('next-app-pages-map.png');
    await page.click('#pgPageMap .nx-pm-node--out[data-id="vbredwoodapp/customer-portal/customer-my-billing"]');
    await page.waitForFunction(() => /My Billing/.test((document.querySelector('#pgPageMap .nx-pm-node--self') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('a click walks on: that page is open, its map shown (Customer Dashboard now among where it comes from)', /My Billing/.test(await text(page, '#pgSheetTitle'))
      && /Customer Dashboard/.test(await text(page, '#pgPageMap div.nx-pm-col:first-of-type')) && (await page.getAttribute('#pgTabMap', 'aria-selected')) === 'true');
    await page.click('#pgTabGlobal');
    await page.waitForSelector('#pgGlobalMap .nx-pm-node', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll('#pgGlobalMap svg path.nx-pm-edge').length > 20, null, { timeout: 5000 }).catch(() => {});
    const gcols = await page.$$eval('#pgGlobalMap .nx-pm-colhead', (cs) => cs.map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
    T.check('Global map: the whole app — from the menu, one step on…, not reached; counted', /^Old EquipRite: 50 pages · \d+ in the menu · \d+ links between pages/.test(await text(page, '#pgGlobalText'))
      && /^From the menu \d+$/.test(gcols[0]) && /^One step on \d+$/.test(gcols[1]) && /^Not reached \d+$/.test(gcols[gcols.length - 1]) && (await page.$$('#pgGlobalMap .nx-pm-node')).length === 50, gcols.join(' | '));
    T.check('…the open page marked, its links highlighted', /My Billing/.test(await text(page, '#pgGlobalMap .nx-pm-node--self')) && (await page.$$('#pgGlobalMap svg path.nx-pm-edge--hot')).length >= 1
      && (await page.$$('#pgGlobalMap svg path.nx-pm-edge')).length > 20);
    await env.shot('next-app-pages-global.png');
    await page.click('#pgTabPage');
    await page.waitForSelector('#pgOverview', { timeout: 5000 }).catch(() => {});
    T.check('back to the page tab: its sheet', await page.isVisible('#pgOverview') && !(await page.$('#pgGlobalMap')));
    await page.click('#pgApps [data-value="all"]');

    T.section('delete a page from the catalog, and restore it');
    const DEL = 'vbredwoodapp//shell';
    await page.click('#pgRows .nx-pg-row[data-id="' + DEL + '"]');
    await page.waitForFunction((d) => /Shell/.test((document.getElementById('pgSheetTitle') || {}).textContent || ''), DEL, { timeout: 10000 });
    await page.click('#pgBuild');
    await page.waitForFunction(() => /Sheet built/.test((document.getElementById('pgSheetState') || {}).textContent || ''), null, { timeout: 20000 });
    page.once('dialog', (d) => d.accept());
    await page.click('#pgDelete');
    await page.waitForSelector('#pgDeletedNote', { timeout: 20000 }).catch(() => {});
    T.check('Delete (after a confirm): its sheet gone, said so, hidden from the list, pushed', await page.isVisible('#pgDeletedNote') && !(await page.$('#pgRows .nx-pg-row[data-id="' + DEL + '"]'))
      && /1 deleted/.test(await text(page, '#pgSub')) && pg.gitRemote('log', '-1', '--format=%s', 'pages/test') === 'Application pages: delete ' + DEL
      && !fs.existsSync(path.join(pg.root, 'webApps/equiprite-next/resources/pages/sheets/vbredwoodapp._root.shell.json')));
    await page.click('#pgShowDeleted');
    await settle(page, 300);
    T.check('"Show deleted" lists it, marked Deleted', /Shell\s*Deleted/.test(await text(page, '#pgRows .nx-pg-row[data-id="' + DEL + '"]')));
    await page.click('#pgRestore');
    await page.waitForFunction(() => !document.getElementById('pgDeletedNote'), null, { timeout: 20000 }).catch(() => {});
    await page.click('#pgShowDeleted');
    await settle(page, 300);
    T.check('Restore brings it back into the list', !!(await page.$('#pgRows .nx-pg-row[data-id="' + DEL + '"]')) && !/deleted/.test(await text(page, '#pgSub')));
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
  }

  // The data on its own git branch (desktop/lib/dataBranch.js): the header says which; and why not, when it could not be.
  for (const [port, info, ok] of [[19845, { separate: true, branch: 'claude/equiprite-data', dir: '.equiprite-data', reason: '' }, true],
    [19846, { separate: false, branch: 'claude/equiprite-data', dir: '.equiprite-data', reason: 'git is not installed on this PC.' }, false]]) {
    const env3 = await E.start({ port: port, app: 'next', pagesStore: Object.assign({}, pg.store, { dataInfo: () => info }) });
    try {
      T.section(ok ? 'the data on its own branch: the header names it' : 'no data branch: the header says why');
      await env3.open('/?open=app-pages');
      await env3.page.waitForSelector('#pgRows .nx-pg-row', { timeout: 30000 });
      await env3.page.waitForFunction(() => /Kept in git/.test((document.getElementById('pgGit') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
      if (ok) T.check('"Kept in git, on its own branch claude/equiprite-data (apart from the code)"', /Kept in git, on its own branch claude\/equiprite-data \(apart from the code\): every page/.test(await text(env3.page, '#pgGit')) && !(await env3.page.$('#pgDataReason')), await text(env3.page, '#pgGit'));
      else T.check('"No data branch, so saved in the project folder: <why>"', /No data branch, so saved in the project folder: git is not installed on this PC\./.test(await text(env3.page, '#pgDataReason')) && !(await env3.page.$('#pgDataBranch')));
    } catch (e) {
      T.check('no exception (data branch header): ' + (e && e.message), false);
    } finally {
      await env3.close();
    }
  }

  // Without the local server (as in VBCS): the catalog shipped with the app, read only.
  const env2 = await E.start({ port: 19850, app: 'next' });
  try {
    T.section('read only (as in VBCS): the shipped catalog, no Build or Map');
    await env2.open('/?open=app-pages');
    await env2.page.waitForSelector('#pgRows .nx-pg-row', { timeout: 30000 });
    T.check('the pages are listed; it says sheets are built in the desktop app', (await env2.page.$$('#pgRows .nx-pg-row')).length >= 150 && /Read only here/.test(await text(env2.page, '#pgGit')) && !(await env2.page.$('#pgRescan')));
    await env2.page.click('#pgRows .nx-pg-row[data-id="' + ID + '"]');
    await env2.page.waitForSelector('#pgSheetTitle, #pgResult', { timeout: 10000 }).catch(() => {});
    T.check('a page with a saved sheet (the one just built) opens read only', /Equipment Manager Workbench/.test(await text(env2.page, '#pgSheetTitle')) && !(await env2.page.$('#pgBuild')) && !(await env2.page.$('#pgMapBtn')));
  } catch (e) {
    T.check('no exception (read only): ' + (e && e.message), false);
  } finally {
    await env2.close();
    pg.restore();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
