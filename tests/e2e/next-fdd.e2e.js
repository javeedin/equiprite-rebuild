'use strict';
/*
 * EquipRite Next, the EquipRite FDD page, in a real browser: opened from the menu (Insights); the three tabs;
 * Requirements (grouped by module, search, the phase filter, a requirement opened); Flows (a swimlane diagram drawn,
 * another flow, a step clicked and its detail, the keyboard, the step's Next screen opened in its tab); Mapping to
 * development, judged on EquipRite Next only (the KPIs, no New or Old card; every tile is a button and opens the items
 * behind its number, as many rows as it says; the keyboard and the focus ring; status and module chips, search, the
 * breadcrumb; a screen chip opens that Next screen's tab; the link to an item's entry on Requirements; Complete % and To
 * reach 100%; a bar and a bar segment drill; the drill's export; the table and the page's export); no sideways scroll
 * (wide and phone width, a drill open), nothing written, no browser errors. Screenshots: next-fdd-*.png.
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
  const shots = [];
  const shot = async (name) => { shots.push(await env.shot(name)); };
  // The drill shows `source`, and (when given) its last crumb reads `here`.
  const waitDrill = async (source, here) => {
    await page.waitForFunction(([s, h]) => {
      const d = document.getElementById('fddDrill');
      const c = document.querySelector('#fddDrill .fdd-crumb--here');
      return d && d.dataset.source === s && (!h || (c && c.innerText.trim() === h));
    }, [source, here || ''], { timeout: 10000 });
    await settle(page, 250);
  };
  const drillIds = () => page.$$eval('#fddDrillRows .fdd-drow', (r) => r.map((x) => x.dataset.id).join());
  const drillCount = () => page.$$eval('#fddDrillRows .fdd-drow', (r) => r.length);
  const crumbs = () => page.$$eval('#fddDrill .fdd-crumbs li', (l) => l.map((x) => x.innerText.trim()).join(' › '));
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
    T.check('the head says it is EquipRite Next\'s', /how much of it EquipRite Next has built \(with its phone app\)/.test(await env.text('#fddSub')));
    T.eq('three tabs, Requirements open', await page.$$eval('.fdd-tab', (t) => t.map((x) => x.innerText.replace(/\s+/g, ' ').trim() + (x.getAttribute('aria-selected') === 'true' ? '*' : '')).join(' | ')),
      'Requirements 34* | Flows 9 | Mapping to development 62%');

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
    T.check('opened: what it covers, roles, scenarios, EquipRite Next, where the FDD is vague', ['what it covers', 'equipment manager', 's13', 'in equiprite next', 'partly done', 'missing:', 'on the phone: pick, android app', 'where the fdd is vague', 'fdd 7.16'].every((s) => det.includes(s)), det.slice(0, 400));
    T.eq('… and says it is open', await page.getAttribute('.fdd-req[data-req="BR-007"] .fdd-req-row', 'aria-expanded'), 'true');
    T.eq('no sideways scroll', await sideways(page), false);
    await shot('next-fdd-requirements.png');
    await page.click('[data-field="reqPhase"][data-value="all"]');
    await page.click('.fdd-req[data-req="BR-007"] .fdd-req-row');
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
    T.eq('a step opens below, with its status in Next', await env.text('#fddStepTitle'), 'Step 7 of 14: Pick (Oracle mobile) Partly done');
    T.check('… what happens, its section, Next, the phone', (await env.text('#fddStepWhat')).includes('Oracle mobile app') && (await env.text('#fddStepSection')) === '5.3'
      && (await env.text('#fddStepDev')).startsWith('S13 Initiate Picking (manual)') && (await env.text('#fddStepPhone')) === 'Pick, Android app');
    T.check('… no "Other apps"', !(await env.text('#fddStep')).includes('Other apps'));
    T.check('… and it is marked in the diagram', await page.$eval('#fddDiagram [data-step="pick"]', (g) => g.classList.contains('fdd-node--on')));
    await page.click('#fddStep [data-act="prev"]');
    await page.waitForFunction(() => /Pick release/.test((document.getElementById('fddStepTitle') || {}).innerText || ''));
    T.eq('the step before: its integration, not started in Next', await page.$$eval('#fddStep .fdd-mini', (m) => m.map((x) => x.innerText.trim()).join()), 'INT-06 · Not started');
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
    await shot('next-fdd-flows.png');
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

    T.section('Mapping: the numbers, for EquipRite Next only');
    await page.click('#fddTab-mapping');
    await page.waitForSelector('#fddKpis .nx-kpi', { timeout: 10000 });
    await settle(page);
    const kpi = async (k) => page.$eval(`[data-kpi="${k}"] .nx-kpi-value`, (v) => v.innerText.trim());
    T.eq('the KPIs: requirements, done, partly, not started, n/a, complete, to reach 100%', [await kpi('total'), await kpi('done'), await kpi('partly'), await kpi('none'), await kpi('na'),
      await kpi('pct'), await kpi('reach')].join(' '), '34 8 25 0 1 62% +37.9');
    T.eq('… in Next, on the phone, integrations, scenarios, decision points', [await kpi('next'), await kpi('phone'), await kpi('ints'), await kpi('scen'), await kpi('dps')].join(' | '),
      '33 of 34 | 6 of 34 | 5 + 4 of 20 | 5 + 24 of 34 | 0 + 7 of 10');
    T.eq('no New or Old card', [await page.$$eval('[data-kpi="newApp"], [data-kpi="oldApp"], [data-kpi="mobile"]', (x) => x.length),
      /\b(New|Old)\b/.test(await env.text('#fddKpis2'))].join(), '0,false');
    T.check('the headline says it in words', (await env.text('#fddHeadline')).startsWith('EquipRite Next (with its phone app) has built 62% of the FDD\'s requirements'));
    T.check('it says, once, that it is judged on Next with its phone app, as checked on 31 Oct 2026', /Judged on EquipRite Next only, as its code stood on 31 Oct 2026/.test(await env.text('#fddJudged'))
      && /EquipRite Mobile and EquipRite for Android count as Next's phone app/.test(await env.text('#fddJudged')));
    T.eq('bars by module and phase', [await page.$$eval('#fddByModule ~ .fdd-bars .fdd-bar-row', (r) => r.length), await page.$$eval('#fddByPhase ~ .fdd-bars .fdd-bar-row', (r) => r.length)].join(), '4,7');
    T.check('… each bar labelled for a screen reader', (await page.$eval('.fdd-bar-row[data-group="projects"] .fdd-bar-label', (b) => b.getAttribute('aria-label'))).startsWith('Equipment for Projects: 16 requirements'));
    T.eq('pending: not started', await page.$$eval('#fddPending .fdd-item', (r) => r.map((x) => x.dataset.id).join()),
      'INT-04,INT-05,INT-06,INT-09,INT-10,INT-13,INT-14,INT-16,INT-18,INT-19,INT-20,S05,S08,S15,S22,S33,DP-01,DP-04,DP-06');
    T.eq('partly done, with what is missing', await page.$$eval('#fddPartly .fdd-item', (r) => r.length), 25);
    T.eq('the table: Next and the phone, no New or Old column', await page.$$eval('.fdd-grid-map .nx-row--head [role="columnheader"]', (h) => h.map((x) => x.textContent.trim()).filter(Boolean).join()),
      'ID,Item,Status,EquipRite Next,On the phone,Tests');
    await page.$eval('#fddHeadline', (h) => h.scrollIntoView({ block: 'start' }));
    await shot('next-fdd-mapping.png');

    T.section('every tile is a button and opens the items behind its number');
    T.eq('every tile is a button', await page.$$eval('[data-kpi]', (t) => t.filter((x) => x.tagName !== 'BUTTON').length + '/' + t.length), '0/12');
    const tiles = await page.$$eval('[data-kpi]', (t) => t.map((x) => ({ key: x.dataset.kpi, source: x.dataset.value, count: Number(x.dataset.count), label: x.querySelector('.nx-kpi-label').innerText.trim() })));
    const off = [];
    for (const t of tiles) {
      await page.click(`[data-kpi="${t.key}"]`);
      await waitDrill(t.source);
      const n = await drillCount();
      const base = await page.$eval('#fddDrill [data-crumb="base"]', (c) => c.innerText.trim());
      const pressed = await page.getAttribute(`[data-kpi="${t.key}"]`, 'aria-expanded');
      if (n !== t.count || base !== t.label + ' · ' + t.count || pressed !== 'true') off.push(t.key + ': ' + n + ' rows, "' + base + '", ' + pressed);
    }
    T.eq('every tile: its drill lists as many rows as its count, and the breadcrumb says it', off.join(' | '), '');
    T.check('… the drill takes the focus', await page.evaluate(() => document.activeElement && document.activeElement.id === 'fddDrillTitle'));
    await page.click('[data-kpi="none"]');
    await waitDrill('req:none');
    T.eq('Not started: none, and it says so', [await drillCount(), await env.text('#fddDrillEmpty')].join(' | '), '0 | None: nothing is behind this number.');

    T.section('the keyboard and the focus ring');
    await page.focus('[data-kpi="none"]');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => { const a = document.activeElement; const s = getComputedStyle(a); return a.dataset.kpi + ' ' + a.matches(':focus-visible') + ' ' + s.outlineStyle + ' ' + s.outlineWidth; });
    T.eq('Tab moves to the next tile, with a focus ring', ring, 'na true solid 2px');
    await page.keyboard.press('Enter');
    await waitDrill('req:na');
    T.eq('… Enter opens it', await drillIds(), 'BR-010');

    T.section('a drill: chips, search, the breadcrumb');
    await page.click('[data-kpi="ints"]');
    await waitDrill('ints');
    T.eq('Integrations: the status chips with counts', await page.$$eval('#fddDrillChips .nx-chip', (c) => c.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'All 20 | Done 5 | Partly done 4 | Not started 11');
    await page.click('#fddDrillChips [data-value="partly"]');
    await waitDrill('ints', 'Partly done · 4');
    T.eq('a status chip narrows the list', await drillIds(), 'INT-03,INT-07,INT-11,INT-17');
    T.check('… every row: a status pill, what Next has, what is missing, its tests', await page.$$eval('#fddDrillRows .fdd-drow', (r) => r.every((x) => x.querySelector('.fdd-st--partly')
      && /What Next has/.test(x.textContent) && /What is missing/.test(x.textContent) && x.querySelectorAll('.fdd-code').length > 0)));
    await page.click('[data-kpi="partly"]');
    await waitDrill('req:partly');
    await page.click('#fddDrillModules [data-value="projects"]');
    await waitDrill('req:partly', 'Equipment for Projects · 14');
    T.eq('a module chip narrows it: the breadcrumb', await crumbs(), 'Mapping › Partly done · 25 › Equipment for Projects · 14');
    T.eq('… 14 rows, all partly done', await page.$$eval('#fddDrillRows .fdd-drow', (r) => r.length + ' ' + r.every((x) => x.dataset.status === 'partly')), '14 true');
    await shot('next-fdd-drill.png');
    await page.click('#fddDrill [data-crumb="base"] button');
    await waitDrill('req:partly', 'Partly done · 25');
    T.eq('the breadcrumb goes back a step', await drillCount(), 25);
    await page.click('[data-kpi="total"]');
    await waitDrill('req');
    await page.fill('#fddDrillSearch', 'transfer order');
    await page.waitForFunction(() => /4 of 34/.test((document.getElementById('fddDrillSummary') || {}).innerText || ''), null, { timeout: 5000 });
    T.eq('search', [await env.text('#fddDrillSummary'), await drillIds()].join(' | '), '4 of 34 requirements | BR-007,BR-009,BR-013,7.16');
    await page.click('#fddDrillModules [data-value="projects"]');
    await waitDrill('req', 'Equipment for Projects · 16');
    T.eq('… and the chips narrow the search', await drillIds(), 'BR-007,BR-009,7.16');

    T.section('a screen chip, and the entry on Requirements');
    const chip = '#fddDrillRows .fdd-drow[data-id="BR-007"] .fdd-screen[data-value="picking"]';
    T.eq('a row\'s Next screens are chips', await env.text(chip), 'Picking & shipping');
    await page.click(chip);
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'picking'; }, null, { timeout: 15000 });
    T.check('the chip opens that Next screen in its tab', true);
    await page.click('.nx-tab[data-tab-id="fdd"] .nx-tab-btn');
    await page.waitForSelector('#fddDrill', { timeout: 10000 });
    T.eq('back on the FDD: the drill is where it was', [await crumbs(), await drillIds()].join(' | '), 'Mapping › Requirements · 34 › Equipment for Projects · 16 | BR-007,BR-009,7.16');
    await page.click('#fddDrillRows .fdd-drow[data-id="7.16"] .fdd-reqlink');
    await page.waitForSelector('#fddReqDetail-7\\.16', { timeout: 10000 });
    await settle(page, 300);
    T.eq('its full entry: the Requirements tab, the requirement open', [await page.getAttribute('#fddTab-requirements', 'aria-selected'),
      await page.getAttribute('.fdd-req[data-req="7.16"] .fdd-req-row', 'aria-expanded')].join(), 'true,true');
    T.check('… scrolled to and focused', await page.evaluate(() => { const el = document.querySelector('.fdd-req[data-req="7.16"]'); const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight && document.activeElement === el.querySelector('.fdd-req-row'); }));
    T.check('… what Next has and lacks, there too', /In EquipRite Next[\s\S]*creates, reserves and releases no transfer order/i.test(await env.text('#fddReqDetail-7\\.16')));
    await page.click('#fddTab-mapping');
    await page.waitForSelector('#fddDrill', { timeout: 10000 });
    T.check('Mapping again: the drill is kept', (await crumbs()).startsWith('Mapping › Requirements · 34'));

    T.section('Complete % and To reach 100%');
    await page.click('[data-kpi="pct"]');
    await waitDrill('pct');
    T.check('Complete %: the rule, and each requirement\'s share', /\(8 \+ ½ × 25\) ÷ 33 × 100 = 62\.1%, shown as 62%/.test(await env.text('#fddDrillRule'))
      && (await page.$eval('#fddDrillRows .fdd-drow[data-id="BR-001"] .fdd-fig', (x) => x.innerText.trim())) === '3.03%'
      && (await page.$eval('#fddDrillRows .fdd-drow[data-id="BR-005"] .fdd-fig', (x) => x.innerText.trim())) === '1.52%');
    const shares = await page.$$eval('#fddDrillRows .fdd-fig', (f) => f.reduce((a, x) => a + parseFloat(x.innerText), 0));
    T.check('… the shares shown add up to it, within their rounding', Math.abs(shares - 62.12) < 0.17, String(shares));
    await page.click('#fddToReach');
    await waitDrill('reach');
    T.check('To reach 100%, from the Complete drill: the rule on the page', /A partly done one that is finished adds ½ × 1\/33 × 100 = 1\.52 points; a not started one adds 1\/33 × 100 = 3\.03 points/.test(await env.text('#fddDrillRule'))
      && /add up to the 37\.9 points still to go/.test(await env.text('#fddDrillRule')));
    T.eq('… every partly or not started requirement, biggest gain first', [await drillCount(), (await drillIds()).split(',').slice(0, 5).join()].join(' | '), '25 | BR-011,BR-007,7.16,BR-006,BR-012');
    T.eq('… each with its gain', await page.$eval('#fddDrillRows .fdd-drow[data-id="BR-007"] .fdd-fig', (x) => x.innerText.trim()), '+1.52 pts');
    T.eq('… and what it touches that is not done', await page.$eval('#fddDrillRows .fdd-drow[data-id="7.16"] .fdd-drow-touch', (x) => Array.from(x.querySelectorAll('.fdd-mini')).map((m) => m.textContent.trim()).join(' | ')),
      'S13, partly done | S14, partly done | S15, not started | INT-04, not started | INT-05, not started | INT-06, not started');
    T.eq('then the integrations and decision points not done, with what each needs', [await page.$$eval('#fddReachExtra .fdd-drow', (r) => r.length),
      await page.$eval('#fddReachExtra .fdd-drow[data-id="INT-04"] .fdd-drow-needs', (x) => x.innerText.replace(/\s+/g, ' ').trim().slice(0, 37))].join(' | '), '25 | Needs: Next creates no transfer order');
    T.eq('the page itself does not grow: the drill scrolls inside the shell', await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), true);
    await page.$eval('#fddDrill', (d) => d.scrollIntoView({ block: 'start' }));
    await shot('next-fdd-reach.png');

    T.section('a bar, and a bar segment');
    await page.click('#fddDrillClose');
    await page.waitForSelector('.fdd-bar-row[data-group="projects"]', { timeout: 10000 });
    T.check('back to Mapping: the focus returns to the tile', await page.evaluate(() => document.activeElement && document.activeElement.dataset.kpi === 'reach'));
    const segCount = Number(await page.getAttribute('.fdd-bar-row[data-group="projects"] .fdd-seg--partly', 'data-count'));
    await page.click('.fdd-bar-row[data-group="projects"] .fdd-seg--partly');
    await waitDrill('module:projects', 'Partly done · ' + segCount);
    T.eq('a segment: just its items', [await crumbs(), await page.$$eval('#fddDrillRows .fdd-drow', (r) => r.length + ' ' + r.every((x) => x.dataset.status === 'partly'))].join(' | '),
      'Mapping › Equipment for Projects · 16 › Partly done · 14 | 14 true');
    T.eq('… as many as the segment says', await drillCount(), segCount);
    await page.click('#fddDrill [data-crumb="mapping"] button');
    await page.waitForSelector('.fdd-bar-row[data-group="projects"]', { timeout: 10000 });
    await settle(page, 300);
    T.check('the breadcrumb\'s Mapping closes it; the focus returns to the segment', await page.evaluate(() => document.activeElement && document.activeElement.matches('.fdd-bar-row[data-group="projects"] .fdd-seg--partly')));
    const segOff = [];
    for (const g of await page.$$eval('.fdd-bar-row', (r) => r.map((x) => x.dataset.group))) {
      const sel = `.fdd-bar-row[data-group="${g}"]`;
      const want = Number(await page.getAttribute(sel + ' .fdd-bar-label', 'data-count'));
      await page.click(sel + ' .fdd-bar-label');
      await page.waitForSelector('#fddDrill', { timeout: 10000 });
      await settle(page, 250);
      const got = await drillCount();
      if (got !== want) segOff.push(g + ' ' + got + '/' + want);
      await page.click('#fddDrillClose');
      await page.waitForSelector(sel, { timeout: 10000 });
    }
    T.eq('every bar: its drill lists as many rows as its count', segOff.join(), '');
    await page.click('.fdd-bar-row[data-group="3"] .fdd-bar-label');
    await waitDrill('phase:3');
    T.eq('a phase bar: its requirements', await drillIds(), 'BR-006,BR-007,7.12,7.16');

    T.section('the drill\'s export');
    await page.click('[data-kpi="partly"]');
    await waitDrill('req:partly');
    await page.click('#fddDrillModules [data-value="projects"]');
    await waitDrill('req:partly', 'Equipment for Projects · 14');
    await page.click('#fddDrillExport');
    await page.waitForSelector('.fdd-drill-menu');
    T.eq('the export says what it takes', await env.text('.fdd-drill-menu .nx-menu-note'), '14 rows of Partly done, as shown');
    const [dl1] = await Promise.all([page.waitForEvent('download'), page.click('.fdd-drill-menu [data-format="csv"]')]);
    const f1 = path.join(os.tmpdir(), 'next-fdd-' + dl1.suggestedFilename());
    await dl1.saveAs(f1);
    const csv1 = fs.readFileSync(f1, 'utf8');
    T.check('exactly what it shows: its columns, its rows only', /ID,Kind,Item,Status,What Next has,What is missing,Next screens,On the phone,Tests,Evidence/.test(csv1)
      && csv1.includes('BR-007') && !csv1.includes('BR-012') && !csv1.includes('BR-001,'));
    T.eq('… one line per row', csv1.trim().split(/\r?\n/).length, 15);
    T.check('… named for what it is', /equiprite-fdd-req-partly-projects/.test(dl1.suggestedFilename()), dl1.suggestedFilename());
    await page.click('#fddExport');
    await page.waitForSelector('.nx-pagehead .nx-menu');
    T.eq('the page\'s Export takes the drill too, while it is open', await env.text('.nx-pagehead .nx-menu-note'), '14 rows of Partly done, as shown');
    await page.click('#fddExport');
    T.eq('no sideways scroll with a drill open', await sideways(page), false);

    T.section('the table and its export');
    await page.click('#fddDrillClose');
    await page.waitForSelector('[data-field="mapKind"][data-value="integrations"]', { timeout: 10000 });
    await page.click('[data-field="mapKind"][data-value="integrations"]');
    await settle(page);
    await page.click('[data-field="mapStatus"][data-value="none"]');
    await settle(page);
    T.eq('the table: integrations not started', await page.$$eval('.fdd-map-row', (r) => r.map((x) => x.dataset.id).join()), 'INT-04,INT-05,INT-06,INT-09,INT-10,INT-13,INT-14,INT-16,INT-18,INT-19,INT-20');
    await page.click('.fdd-map-row[data-id="INT-18"]');
    await page.waitForSelector('#fddMapDetail-INT-18');
    T.check('a row opened: what is missing and Next\'s evidence', (await env.text('#fddMapDetail-INT-18')).includes('No call in services/') && (await env.text('#fddMapDetail-INT-18')).includes('equiprite-next/flows/checks/pages/transfer-page.html'));
    await page.click('[data-field="mapStatus"][data-value="all"]');
    await page.click('[data-field="mapKind"][data-value="all"]');
    await settle(page);
    T.eq('everything: 105 rows', await page.$$eval('.fdd-map-row', (r) => r.length), 105);
    await page.click('#fddExport');
    await page.waitForSelector('.nx-fdd .nx-pagehead .nx-menu');
    T.eq('the export says what it takes', await env.text('.nx-fdd .nx-pagehead .nx-menu-note'), '105 rows, as shown');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.nx-fdd .nx-pagehead .nx-menu [data-format="csv"]')]);
    const file = path.join(os.tmpdir(), 'next-fdd-' + dl.suggestedFilename());
    await dl.saveAs(file);
    const csv = fs.readFileSync(file, 'utf8');
    T.check('the mapping exports: Next\'s columns and every kind', /ID,Kind,Item,FDD,Status,EquipRite Next,On the phone,Desktop client,Tests,Evidence/.test(csv) && !/New|Old/.test(csv.split(/\r?\n/)[0])
      && ['BR-007', '§7.16A', 'INT-18', 'S35', 'DP-10', 'X-01'].every((s) => csv.includes(s)));
    T.eq('… one line per row', csv.trim().split(/\r?\n/).length, 106);
    T.eq('no sideways scroll', await sideways(page), false);

    T.section('a phone');
    await page.setViewportSize({ width: 390, height: 800 });
    await settle(page, 500);
    T.eq('Mapping: no sideways scroll (the table scrolls in its card)', await sideways(page), false);
    await page.click('[data-kpi="partly"]');
    await waitDrill('req:partly');
    await settle(page, 400);
    T.eq('a drill on the phone: no sideways scroll', await sideways(page), false);
    T.check('… its rows fit the screen', await page.$$eval('#fddDrillRows .fdd-drow', (r) => r.every((x) => x.getBoundingClientRect().right <= window.innerWidth + 1)));
    await page.$eval('#fddDrill', (d) => d.scrollIntoView({ block: 'start' }));
    await shot('next-fdd-phone-drill.png');
    await page.click('#fddDrillExport');
    await page.waitForSelector('.fdd-drill-menu');
    T.check('… its export menu fits the screen', await page.$eval('.fdd-drill-menu', (m) => { const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; }));
    await page.click('#fddDrillExport');
    await page.click('[data-kpi="reach"]');
    await waitDrill('reach');
    T.eq('To reach 100% on the phone: no sideways scroll', await sideways(page), false);
    await page.click('#fddDrillClose');
    await settle(page, 300);
    await page.click('#fddTab-flows');
    await page.waitForSelector('#fddDiagram .fdd-node', { timeout: 10000 });
    await settle(page, 500);
    T.eq('Flows: no sideways scroll (the diagram scrolls in its box)', await sideways(page), false);
    await page.click('#fddTab-requirements');
    await settle(page, 500);
    T.eq('Requirements: no sideways scroll', await sideways(page), false);
    await shot('next-fdd-phone.png');
    await page.setViewportSize({ width: 1440, height: 1000 });

    T.eq('nothing written', env.writes.map((w) => w.method + ' ' + w.path).join(), '');
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('next-fdd-failure.png').catch(() => {});
  } finally {
    await env.close();
  }
  console.log('Screenshots:\n  ' + shots.join('\n  '));
  T.report();
})();
