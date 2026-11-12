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
  // Code Fix (desktop/lib/codeFix.js) on the sandbox project, with a stand-in AI that proposes one comment line
  const BILL = 'webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page';
  const billLines = fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const fixAsked = [];
  const fixStore = require('../../desktop/lib/codeFix').open({ root: pg.root, file: path.join(dir, 'code-fixes.json'), ai: {
    settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }),
    chat: async (req) => { fixAsked.push(req); return { ok: true, provider: 'Stand-in AI', model: 'test', text: ['## Summary', 'Add a note about overdue invoices to the header comment.', '## How it works today', '`BilledRequestInitChain` loads the billed requests.',
      '## What changes', 'One comment line.', '## The change', '- `' + BILL + '.html` — a comment line', '## After the change', 'The page looks the same.', '## Risks', 'None known', '## How to test', '1. Open My Billing.', '## Questions', 'None', '',
      'FILE: ' + BILL + '.html', '<<<<<<< SEARCH', billLines.slice(1, 3).join('\n'), '=======', billLines.slice(1, 3).join('\n') + '\n  Overdue invoices are shown first (code fix).', '>>>>>>> REPLACE'].join('\n') }; } } });
  const env = await E.start({ port: 19840, app: 'next', pagesStore: pg.store, aiStore, fixStore });
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
    T.check('the page\'s tab: one sheet, Overview, Integrations, Business logic, Features, Links & files all shown (the maps, Page code and Code fix are the other tabs)', (await page.$$('#pgTabs [role="tab"]')).length === 5
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
    await page.hover('#pgGlobalMap .nx-pm-node[data-id="vbredwoodapp/customer-portal/customer-dashboard"]');
    await settle(page, 200);
    const hov = await page.evaluate(() => { const m = document.getElementById('pgGlobalMap'); return { on: m.classList.contains('nx-pm--hover'), lit: m.querySelectorAll('path.is-hover').length, near: m.querySelectorAll('.nx-pm-node--near').length, all: m.querySelectorAll('path.nx-pm-edge').length }; });
    T.check('pointing at a page: only its lines bright, the pages at their other ends marked', hov.on && hov.lit >= 3 && hov.lit < hov.all && hov.near >= 3, JSON.stringify(hov));
    await env.shot('next-app-pages-global-hover.png');
    await page.mouse.move(5, 5);
    await settle(page, 150);
    T.check('…and moving away shows them all again', !(await page.$('#pgGlobalMap.nx-pm--hover')) && (await page.$$('#pgGlobalMap path.is-hover')).length === 0);
    await page.click('#pgTabPage');
    await page.waitForSelector('#pgOverview', { timeout: 5000 }).catch(() => {});
    T.check('back to the page tab: its sheet', await page.isVisible('#pgOverview') && !(await page.$('#pgGlobalMap')));

    T.section('Code fix: ask, the analysis and the exact change, approve (pull, write, test), commit & push');
    await page.click('#pgTabFix');
    await page.waitForSelector('#fxRequest', { timeout: 10000 });
    T.check('the tab: the code folder and its branch, the ask, "nothing is written until you approve"', /pages\/test → origin\/pages\/test/.test(await text(page, '#fxFolder')) && /Nothing is written until you approve it/.test(await text(page, '#fxAsk'))
      && !(await page.$('#fxProposal')) && !(await page.$('#fxNoAi')), await text(page, '#fxFolder'));
    await page.click('#fxAsk [data-value="enhance"]');
    T.check('the page being changed is named, with its app and path', /Page\s*My Billing\s*Old EquipRite · customer-portal\/customer-my-billing/.test(await text(page, '#fxPage')));
    await page.fill('#fxRequest', 'Show overdue invoices first');
    await page.click('#pgTabMap');
    await page.waitForSelector('#pgPageMap', { timeout: 5000 });
    await page.click('#pgTabFix');
    await page.waitForSelector('#fxRequest', { timeout: 5000 });
    T.check('what was typed is still there after another tab (the Code fix tab is kept, only hidden)', (await page.inputValue('#fxRequest')) === 'Show overdue invoices first' && (await page.getAttribute('#fxAsk [data-value="enhance"]', 'class')).indexOf('nx-chip--on') !== -1);
    // a screenshot pasted into the request (Ctrl+V): read from the clipboard, shown, sent with it
    await page.evaluate((b64) => {
      const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
      document.getElementById('fxRequest').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG);
    await page.waitForSelector('#fxImgs .nx-fx-img', { timeout: 5000 }).catch(() => {});
    T.check('a pasted screenshot: shown in the request (1), "the AI looks at them"', (await page.$$('#fxImgs .nx-fx-img')).length === 1 && /1 screenshot goes with the request/.test(await text(page, '#fxImgs'))
      && /Pasted image 1/.test((await page.getAttribute('#fxImgs .nx-fx-imgbtn', 'title')) || ''), await text(page, '#fxImgs'));
    await page.click('#fxImgs .nx-fx-imgbtn');
    await page.waitForFunction(() => { const d = document.getElementById('fxImgDlg'); return d && d.open; }, null, { timeout: 5000 }).catch(() => {});
    T.check('clicked: full size in a dialog, closed with Escape', await page.evaluate(() => document.getElementById('fxImgDlg').open) && !!(await page.$('#fxImgFull')));
    await page.keyboard.press('Escape');
    await page.click('#fxAnalyze');
    await page.waitForSelector('#fxProposal', { timeout: 20000 });
    T.check('the proposal: waiting for approval, the request, the AI\'s analysis in its headings', /Proposed — waiting for your approval/.test(await text(page, '#fxStatus')) && /Show overdue invoices first/.test(await text(page, '#fxReq'))
      && /Summary[\s\S]*How it works today[\s\S]*After the change[\s\S]*How to test/.test((await page.getAttribute('#fxAnalysis', 'srcdoc')) || ''));
    T.check('…the exact change: the file, +1 −0, the new line marked', /customer-my-billing-page\.html/.test(await text(page, '#fxDiff')) && /The change · 1 file · \+1 −0/.test(await text(page, '#fxDiffHead'))
      && /Overdue invoices are shown first \(code fix\)/.test(await text(page, '#fxDiff .nx-fx-l--add')) && (await page.$$('#fxDiff .nx-fx-l--ctx')).length >= 3);
    T.check('…the checks on the proposed code ✓, the AI asked once (an enhancement)', (await page.$$('#fxChecks .nx-fx-check--ok')).length >= 5 && !(await page.$('#fxChecks .nx-fx-check--bad')) && fixAsked.length === 1 && /REQUEST \(Enhance\)/.test(fixAsked[0].user));
    T.check('…nothing written yet', !/code fix/.test(fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8')) && /Approve and apply/.test(await text(page, '#fxApprove')));
    T.check('…the screenshot went to the AI, and is kept with the fix (shown as sent)', (fixAsked[0].images || []).length === 1 && fixAsked[0].images[0].mime === 'image/png' && /SCREENSHOTS: the person attached 1 image/.test(fixAsked[0].user)
      && (await page.$$('#fxFixImgs .nx-pg-shotbtn')).length === 1);
    await env.shot('next-app-pages-codefix.png');
    page.once('dialog', (d) => d.accept());
    await page.click('#fxApply');
    await page.waitForSelector('#fxApplied', { timeout: 30000 }).catch(() => {});
    T.check('approved: pulled first, written, tested — nothing broke, not committed yet', /Applied — not committed yet/.test(await text(page, '#fxStatus')) && /Pulled origin\/pages\/test: already up to date/.test(await text(page, '#fxApplied'))
      && /Nothing broke/.test(await text(page, '#fxTests')) && /Overdue invoices are shown first \(code fix\)/.test(fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8')), await text(page, '#fxApplied'));
    await env.shot('next-app-pages-codefix-applied.png');
    await page.click('#fxPush');
    await page.waitForSelector('#fxCommitted', { timeout: 20000 }).catch(() => {});
    T.check('Commit & push: committed with its request, pushed to the branch', /Committed [0-9a-f]+ on pages\/test, pushed to origin\/pages\/test/.test(await text(page, '#fxResult'))
      && /^Code fix: My Billing — Show overdue invoices first/.test(pg.gitRemote('log', '-1', '--format=%s', 'pages/test')) && /Committed/.test(await text(page, '#fxStatus')));
    T.check('the fixes asked for on the page are listed', /committed[\s\S]*Show overdue invoices first/.test(await text(page, '#fxList')) && /Code fix\s*1/.test(await text(page, '#pgTabFix')));
    await page.click('#fxScopeAll');
    await page.waitForSelector('#fxHistRows .nx-fx-hrow', { timeout: 10000 }).catch(() => {});
    T.check('Change history (all pages): the change, its page, who asked and who approved, the tests, its commit', /committed[\s\S]*My Billing[\s\S]*Show overdue invoices first/.test(await text(page, '#fxHistRows'))
      && /asked by priya\.raman · [\s\S]*approved by priya\.raman · [\s\S]*tests ✓ · committed [0-9a-f]+, pushed/.test(await text(page, '#fxHistRows .nx-fx-hrow')) && /1 change · on this PC/.test(await text(page, '#fxHistCount'))
      && !(await page.isVisible('#fxRequest')), await text(page, '#fxHistRows'));
    await page.fill('#fxHistQ', 'nothing like this');
    T.check('…searched: no match, said so', /No change yet/.test(await text(page, '#fxHist')) && /0 of 1 changes/.test(await text(page, '#fxHistCount')));
    await page.fill('#fxHistQ', 'overdue');
    await page.click('#fxHistRows .nx-fx-hrow');
    await page.waitForSelector('#fxTimeline', { timeout: 10000 }).catch(() => {});
    T.check('a change opened: its page, and its history step by step (asked, proposed, approved and applied, tested, committed, pushed)', await page.isVisible('#fxRequest') && /History of this change · \d+ steps · approved by priya\.raman/.test(await text(page, '#fxTimeline summary'))
      && /asked[\s\S]*proposed[\s\S]*approved and applied[\s\S]*tested[\s\S]*committed[\s\S]*pushed/.test(await page.$eval('#fxTimeline', (d) => d.textContent)), await text(page, '#fxTimeline summary'));
    await env.shot('next-app-pages-history.png');

    T.section('Page code: the page\'s files, read only');
    await page.click('#pgTabCode');
    await page.waitForFunction(() => /customer-my-billing-page\.html/.test((document.getElementById('pgCodePath') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('its files by group: the page, its action chains; the HTML shown first, with its line count', /The page \(3\)/.test(await text(page, '#pgCodeFiles')) && /Action chains \(\d+\)/.test(await text(page, '#pgCodeFiles'))
      && /customer-my-billing-page\.html/.test(await text(page, '#pgCodePath')) && /\d+ lines/.test(await text(page, '#pgCodeView .nx-cv-head')), await text(page, '#pgCodeFiles'));
    const src = (await page.getAttribute('#pgCodeFrame', 'srcdoc')) || '';
    T.check('…the code with line numbers and colours (tags, bindings), read only (the code fix just made is there)', /class="l" id="L1"/.test(src) && /class="g"/.test(src) && /class="b"/.test(src) && /Overdue invoices are shown first/.test(src)
      && /Read only/.test(await text(page, '#pgCodeView')) && (await page.getAttribute('#pgCodeFrame', 'sandbox')) === 'allow-same-origin');
    await page.fill('#pgCodeFind', 'oj-bind');
    await settle(page, 300);
    T.check('find: the matches counted and marked', /^\d+ match(es)?$/.test(await text(page, '#pgCodeHits')) && /<mark id="hit" class="first">/.test((await page.getAttribute('#pgCodeFrame', 'srcdoc')) || ''), await text(page, '#pgCodeHits'));
    await page.click('#pgCodeFiles .nx-cv-file:has-text("BilledRequestInitChain.js")');
    await page.waitForFunction(() => /BilledRequestInitChain\.js/.test((document.getElementById('pgCodePath') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('another file: an action chain, its JavaScript coloured', /BilledRequestInitChain\.js/.test(await text(page, '#pgCodePath')) && /class="k">define</.test((await page.getAttribute('#pgCodeFrame', 'srcdoc')) || ''));
    await env.shot('next-app-pages-code.png');
    await page.fill('#pgCodeFind', '');
    await page.click('#pgTabPage');
    await page.waitForSelector('#pgOverview', { timeout: 5000 }).catch(() => {});
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
