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
    await page.click('#pgTabs [data-value="integrations"]');
    await settle(page, 200);
    T.check('Integrations: the REST call → GET, its path, EquipRite REST, the chain that makes it', /GET\s*\/equiprite\/v1\/views\/workbench-requests/.test(await text(page, '#pgRest')) && /EquipRite REST \(eqpt\)/.test(await text(page, '#pgRest')) && /WorkbenchInitChain/.test(await text(page, '#pgRest')));
    await page.click('#pgTabs [data-value="logic"]');
    await settle(page, 200);
    T.check('Business logic: each chain with what its comment says', /WorkbenchInitChain/.test(await text(page, '#pgLogic')) && /RowClickChain/.test(await text(page, '#pgLogic')) && /enforcePageAccessChain/.test(await text(page, '#pgLogic')));
    await page.click('#pgTabs [data-value="features"]');
    await settle(page, 200);
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
    await page.click('#pgCapture');
    await page.waitForSelector('#pgShot img', { timeout: 20000 });
    await page.waitForFunction(() => { const i = document.querySelector('#pgShot img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => {});
    T.check('Capture screenshot: the page opened at its address, the image shown, said who and when', shots[0] === 'vbredwoodapp /vp/shell/equipment-foundation/equipment-workbench'
      && await page.$eval('#pgShot img', (i) => i.naturalWidth > 0).catch(() => false) && /Captured \d+ \w+ \d{4}/.test(await text(page, '#pgShot')));
    await page.click('#pgExplain');
    await page.waitForFunction(() => { const f = document.getElementById('pgAi'); return f && /What this page is for/.test(f.getAttribute('srcdoc') || ''); }, null, { timeout: 20000 }).catch(() => {});
    T.check('Explain with AI: from the code facts (the page, its chains and REST calls), saved with the sheet', /What this page is for/.test((await page.getAttribute('#pgAi', 'srcdoc')) || '')
      && llm.some((b) => /PAGE Equipment Manager Workbench/.test(b) && /GET \/equiprite\/v1\/views\/workbench-requests/.test(b)) && /Explained by ChatGPT/.test(await text(page, '#pgOverview')));
    await page.fill('#pgSearch', '');
    await page.dispatchEvent('#pgSearch', 'input');
    await page.click('#pgApps [data-value="all"]');
    await page.click('#pgOnlyMapped');
    await settle(page, 300);
    T.check('"Mapped to stories" shows the one page, with its story and screenshot', (await page.$$('#pgRows .nx-pg-row')).length === 1 && /EQP-93/.test(await text(page, '#pgRows')) && (await page.$('#pgRows .nx-pg-thumb img')) !== null);
    T.check('…and the subtitle counts it', /1 with a technical sheet · 1 Jira stories mapped/.test(await text(page, '#pgSub')));
    await page.click('#pgOnlyMapped');
    await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTop = 0; });
    await env.shot('next-app-pages.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
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
