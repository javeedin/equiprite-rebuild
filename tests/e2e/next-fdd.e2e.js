'use strict';
/*
 * EquipRite Next, the EquipRite FDD page, in a real browser: opened from the menu (Insights); the three tabs;
 * Requirements (grouped by module, search, the phase filter, a requirement opened); Flows (a swimlane diagram drawn,
 * another flow, a step clicked and its detail, the keyboard, the step's Next screen opened in its tab); Mapping to
 * development (the KPIs, the bars, pending and partly done, the table filtered and a row opened, the export checked);
 * no sideways scroll (wide and phone width), nothing written, no browser errors. Screenshots: next-fdd-*.png.
 * Needs `npm run build`. Run: node tests/e2e/next-fdd.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 400);
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);

(async () => {
  const env = await E.start({ port: 19500, app: 'next', sessionRole: 'ADMIN' });
  const { page } = env;
  try {
    T.section('opened from the menu');
    await env.open('/');
    await page.waitForSelector('.nx-nav-item[data-nav-id="fdd"]', { timeout: 30000 });
    T.eq('in the menu under Insights', await page.$eval('.nx-nav-item[data-nav-id="fdd"]', (b) => b.closest('.nx-nav-group').querySelector('.nx-nav-label').innerText.trim()
      + ' > ' + b.innerText.trim()), 'INSIGHTS > EquipRite FDD');
    await page.click('.nx-nav-item[data-nav-id="fdd"]');
    await page.waitForSelector('.nx-fdd .fdd-req', { timeout: 30000 });
    await settle(page, 600);
    T.eq('its own tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'fdd');
    T.eq('the Redwood band with its title', await page.$eval('.nx-fdd .nx-pagehead h1', (h) => h.innerText.trim() + ' ' + getComputedStyle(h.closest('.nx-pagehead')).backgroundColor),
      'EquipRite FDD rgb(46, 84, 104)');
    T.eq('three tabs, Requirements open', await page.$$eval('.fdd-tab', (t) => t.map((x) => x.innerText.replace(/\s+/g, ' ').trim() + (x.getAttribute('aria-selected') === 'true' ? '*' : '')).join(' | ')),
      'Requirements 34* | Flows 9 | Mapping to development 65%');

    T.section('Requirements');
    T.eq('every requirement, grouped by module', [await page.$$eval('.fdd-req', (r) => r.length), await page.$$eval('.fdd-group h2', (h) => h.map((x) => x.innerText.trim()).join(', '))].join(' | '),
      '34 | Equipment Foundation, Equipment for Projects, Equipment for Customers, Across modules');
    await page.fill('#fddReqSearch', 'inter-org transfer');
    await settle(page);
    T.eq('search', [await env.text('#fddReqSummary'), await page.$$eval('.fdd-req', (r) => r.map((x) => x.dataset.req).join())].join(' | '), '2 of 34 requirements match | BR-009,7.16A');
    await page.fill('#fddReqSearch', '');
    await settle(page);
    await page.click('[data-field="reqPhase"][data-value="3"]');
    await settle(page);
    T.eq('the phase filter: Pick, ship & receive', await page.$$eval('.fdd-req', (r) => r.map((x) => x.dataset.req).join()), 'BR-006,BR-007,7.12,7.16');
    await page.click('.fdd-req[data-req="BR-007"] .fdd-req-row');
    await page.waitForSelector('#fddReqDetail-BR-007');
    const det = (await env.text('#fddReqDetail-BR-007')).toLowerCase();
    T.check('opened: what it covers, roles, scenarios, the development, where the FDD is vague', ['what it covers', 'equipment manager', 's13', 'partly done', 'missing:',
      'where the fdd is vague', 'fdd 7.16'].every((s) => det.includes(s)), det.slice(0, 300));
    T.eq('… and says it is open', await page.getAttribute('.fdd-req[data-req="BR-007"] .fdd-req-row', 'aria-expanded'), 'true');
    T.eq('no sideways scroll', await sideways(page), false);
    await env.shot('next-fdd-requirements.png');
    await page.click('[data-field="reqPhase"][data-value="all"]');
    await settle(page);

    T.section('Flows');
    await page.click('#fddTab-flows');
    await page.waitForSelector('#fddDiagram .fdd-node', { timeout: 20000 });
    await settle(page, 500);
    T.eq('the end-to-end flow drawn first', [await env.text('#fddFlowTitle'), await page.$$eval('#fddDiagram .fdd-node', (n) => n.length)].join(' | '), 'End to end: the five phases | 14');
    await page.click('.fdd-flow-btn[data-value="picking"]');
    await page.waitForFunction(() => document.querySelectorAll('#fddDiagram [data-step="release"]').length === 1, null, { timeout: 10000 });
    await settle(page);
    T.eq('picking: its lanes and steps', [await page.$$eval('#fddDiagram .fdd-lane-label', (l) => l.map((x) => x.textContent).join(', ')), await page.$$eval('#fddDiagram .fdd-node', (n) => n.length)].join(' | '),
      'Scheduled job, Equipment, EquipRite, OIC, Fusion Inventory, Yard, Inspector, Fusion Maintenance | 14');
    T.check('integration hops labelled', await page.$$eval('#fddDiagram .fdd-tag--int text', (t) => t.map((x) => x.textContent).join()).then((s) => s.includes('INT-04') && s.includes('yes · INT-06')));
    T.check('a decision drawn as a diamond with its DP', await page.$eval('#fddDiagram [data-step="ok"]', (g) => !!g.querySelector('polygon') && g.textContent.includes('DP-02')));
    await page.click('#fddDiagram [data-step="pick"] .fdd-shape');
    await page.waitForSelector('#fddStep');
    T.eq('a step opens below', await env.text('#fddStepTitle'), 'Step 7 of 14: Pick (Oracle mobile) Done');
    T.check('… what happens, its section, the development', (await env.text('#fddStepWhat')).includes('Oracle mobile app') && (await env.text('#fddStepSection')) === '5.3'
      && (await env.text('#fddStepDev')).startsWith('S13 Initiate Picking (manual)'));
    T.check('… and it is marked in the diagram', await page.$eval('#fddDiagram [data-step="pick"]', (g) => g.classList.contains('fdd-node--on')));
    await page.click('#fddStep [data-act="prev"]');
    await page.waitForFunction(() => /Pick release/.test((document.getElementById('fddStepTitle') || {}).innerText || ''));
    T.eq('the step before: its integration and status', await page.$$eval('#fddStep .fdd-mini', (m) => m.map((x) => x.innerText.trim()).join()), 'INT-06 · Done');
    await page.focus('#fddDiagram [data-step="result"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Result\?/.test((document.getElementById('fddStepTitle') || {}).innerText || ''));
    T.check('the keyboard opens a step too', (await env.text('#fddStep')).includes('DP-03'));
    T.eq('the diagram scrolls in its box: no sideways scroll on the page', await sideways(page), false);
    await page.click('#fddDiagram [data-step="pick"] .fdd-shape');
    await page.waitForFunction(() => /Pick \(Oracle/.test((document.getElementById('fddStepTitle') || {}).innerText || ''));
    await page.$eval('#fddDiagram', (d) => { d.scrollLeft = 0; });
    await page.$eval('#fddFlowTitle', (h) => h.scrollIntoView({ block: 'start' }));
    await settle(page);
    await env.shot('next-fdd-flows.png');
    T.eq('the screen that implements it', await env.text('#fddStep .fdd-open'), 'Open Picking & shipping');
    await page.click('#fddStep .fdd-open');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'picking'; }, null, { timeout: 15000 });
    T.check('Picking & shipping opens in its tab', true);
    await page.click('.nx-tab[data-tab-id="fdd"] .nx-tab-btn');
    await page.waitForSelector('#fddStep', { timeout: 10000 });
    T.check('back on the FDD: the flow and the step are where they were', (await env.text('#fddFlowTitle')).startsWith('Picking, transfer order and shipping') && (await env.text('#fddStepTitle')).startsWith('Step 7'));
    await page.click('.fdd-flow-btn[data-value="integrations"]');
    await page.waitForFunction(() => document.querySelectorAll('#fddDiagram [data-step^="INT-"]').length === 20, null, { timeout: 10000 });
    T.check('the integrations map: all twenty, who calls whom', true);

    T.section('Mapping to development');
    await page.click('#fddTab-mapping');
    await page.waitForSelector('#fddKpis .nx-kpi', { timeout: 10000 });
    await settle(page);
    const kpi = async (k) => page.$eval(`[data-kpi="${k}"] .nx-kpi-value`, (v) => v.innerText.trim());
    T.eq('the KPIs: requirements, done, partly, not started, n/a, complete', [await kpi('total'), await kpi('done'), await kpi('partly'), await kpi('none'), await kpi('na'), await kpi('pct')].join(' '),
      '34 10 23 0 1 65%');
    T.eq('… by app, integrations, scenarios', [await kpi('next'), await kpi('ints'), await kpi('scen')].join(' | '), '33 of 34 | 7 + 6 of 20 | 7 + 24 of 34');
    T.check('the headline says it in words', (await env.text('#fddHeadline')).startsWith('65% of the FDD\'s requirements are built'));
    T.eq('bars by module and phase', [await page.$$eval('#fddByModule ~ .fdd-bars .fdd-bar-row', (r) => r.length), await page.$$eval('#fddByPhase ~ .fdd-bars .fdd-bar-row', (r) => r.length)].join(), '4,7');
    T.check('… each bar labelled for a screen reader', (await page.$eval('.fdd-bar-row[data-group="projects"] .fdd-bar', (b) => b.getAttribute('aria-label'))).startsWith('Equipment for Projects: 16 requirements'));
    T.eq('pending: not started', await page.$$eval('#fddPending .fdd-item', (r) => r.map((x) => x.dataset.id).join()), 'INT-10,INT-13,INT-14,INT-17,INT-18,INT-19,INT-20,S15,S22,S33,DP-01,DP-04,DP-06');
    T.eq('partly done, with what is missing', await page.$$eval('#fddPartly .fdd-item', (r) => r.length), 23);
    await env.shot('next-fdd-mapping.png');
    await page.click('[data-field="mapKind"][data-value="integrations"]');
    await settle(page);
    await page.click('[data-field="mapStatus"][data-value="none"]');
    await settle(page);
    T.eq('the table: integrations not started', await page.$$eval('.fdd-map-row', (r) => r.map((x) => x.dataset.id).join()), 'INT-10,INT-13,INT-14,INT-17,INT-18,INT-19,INT-20');
    await page.click('.fdd-map-row[data-id="INT-18"]');
    await page.waitForSelector('#fddMapDetail-INT-18');
    T.check('a row opened: what is missing and the evidence', (await env.text('#fddMapDetail-INT-18')).includes('No call in services/') && (await env.text('#fddMapDetail-INT-18')).includes('createTransferChain.js'));
    await page.click('[data-field="mapStatus"][data-value="all"]');
    await page.click('[data-field="mapKind"][data-value="all"]');
    await settle(page);
    T.eq('everything: 105 rows', await page.$$eval('.fdd-map-row', (r) => r.length), 105);
    await page.click('#fddExport');
    await page.waitForSelector('.nx-fdd .nx-menu');
    T.eq('the export says what it takes', await env.text('.nx-fdd .nx-menu-note'), '105 rows, as shown');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.nx-fdd .nx-menu [data-format="csv"]')]);
    const file = path.join(os.tmpdir(), 'next-fdd-' + dl.suggestedFilename());
    await dl.saveAs(file);
    const csv = fs.readFileSync(file, 'utf8');
    T.check('the mapping exports: its columns and every kind', /ID,Kind,Item,FDD,Status,EquipRite Next,New EquipRite,Old EquipRite/.test(csv) && ['BR-007', '§7.16A', 'INT-18', 'S35', 'DP-10', 'X-01'].every((s) => csv.includes(s)));
    T.eq('… one line per row', csv.trim().split(/\r?\n/).length, 106);
    T.eq('no sideways scroll', await sideways(page), false);

    T.section('a phone');
    await page.setViewportSize({ width: 390, height: 800 });
    await settle(page, 500);
    T.eq('Mapping: no sideways scroll (the table scrolls in its card)', await sideways(page), false);
    await page.click('#fddTab-flows');
    await page.waitForSelector('#fddDiagram .fdd-node', { timeout: 10000 });
    await settle(page, 500);
    T.eq('Flows: no sideways scroll (the diagram scrolls in its box)', await sideways(page), false);
    await page.click('#fddTab-requirements');
    await settle(page, 500);
    T.eq('Requirements: no sideways scroll', await sideways(page), false);
    await env.shot('next-fdd-phone.png');
    await page.setViewportSize({ width: 1440, height: 1000 });

    T.eq('nothing written', env.writes.map((w) => w.method + ' ' + w.path).join(), '');
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('next-fdd-failure.png').catch(() => {});
  } finally {
    await env.close();
  }
  T.report();
})();
