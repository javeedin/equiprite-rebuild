'use strict';
/*
 * EquipRite Next's shell in a real browser: toolbar (Old/New/Next, bell, user), a light menu that collapses, tabs that
 * keep their pages alive, the command bar, deep links, notifications. Needs `npm run build`.
 * Run: node tests/e2e/next-shell.e2e.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();

// A screen not built in Next yet, looked up in the menu (areas are built side by side, so none is named here).
function amd(name, deps) {
  let mod;
  const sandbox = { define: (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(E.ROOT, 'webApps', 'equiprite-next', 'resources', 'js', name + '.js'), 'utf8'), sandbox);
  return mod;
}
const nav = amd('nav', { 'resources/js/rules': amd('rules') });
const SOON = [].concat(...nav.visibleGroups(Object.fromEntries(E.ALL_CODES.map((c) => [c, 'FULL'])), true,
  Object.fromEntries(E.ALL_FLAGS.map((f) => [f, 'true'])), true, {}).map((g) => g.items)).find((i) => !i.built && i.id !== 'requests');
// The second tab of these checks: a screen still being built when there is one (its "being built" page is checked
// too), else Fleet, once every screen is built.
const TAB2 = SOON || nav.item('fleet');
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const REQS = [
  { eqrEquipmentRequestId: 1764, requestNumber: 'REQ-1764', status: 'IN_PROCESS', startDate: day(-22), endDate: day(0), projectName: 'EPC_MO_Operations', requestOrigin: 'Internal' },
  { eqrEquipmentRequestId: 1765, requestNumber: 'REQ-1765', status: 'SUBMITTED', startDate: day(6), endDate: day(30), projectName: 'Plant B', requestOrigin: 'Internal' },
];
const LINES = [
  { requestNumber: 'REQ-1764', lineNumber: 1, equipmentName: 'Komatsu D65EX-18 Dozer', lineStatus: 'CLOSED' },
  { requestNumber: 'REQ-1764', lineNumber: 2, equipmentName: 'Bobcat S76', lineStatus: 'IN_PROCESS', allocationStatus: 'PENDING' },
  { requestNumber: 'REQ-1765', lineNumber: 1, equipmentName: 'Roller 10t', lineStatus: 'SUBMITTED' },
];

function handle(req, res) {
  const p = req.path;
  if (p.endsWith('/views/my-requests')) return res.json({ data: REQS });
  if (p.endsWith('/views/my-request-lines')) return res.json({ data: LINES });
  if (p.endsWith('/notifications')) return res.json({ data: [{ notificationId: 5, subject: 'Request approved', message: 'REQ-1700 was approved', createdDate: '2026-10-29T08:00:00Z', readFlag: 'N' }] });
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19230, handle, app: 'next' });
  const { page } = env;
  try {
    T.section('the shell');
    await env.open('/');
    await page.waitForSelector('#page-home', { timeout: 30000 });
    T.check('a light toolbar and menu, no black bar', await page.$eval('.nx-nav', (n) => getComputedStyle(n).backgroundColor) === 'rgb(255, 255, 255)'
      && await page.$eval('.nx-top', (n) => getComputedStyle(n).backgroundColor) === 'rgb(255, 255, 255)');
    T.eq('Old / New / Next in the toolbar, Next current', await page.$$eval('.nx-switch .nx-switch-btn', (b) => b.map((x) => x.innerText.trim() + (x.getAttribute('aria-current') ? '*' : '')).join(' ')), 'Old New Next*');
    T.check('Old and New point at those apps', (await page.getAttribute('#nxGoOld', 'href')) === env.oldUrl + '/' && (await page.getAttribute('#nxGoNew', 'href')) === env.newUrl + '/');
    T.eq('My work opens first, pinned (no close button)', await page.$$eval('.nx-tab', (t) => t.map((x) => x.innerText.trim() + (x.querySelector('.nx-tab-close') ? '' : '*')).join()), 'My work*');
    T.eq('the menu, by area', await page.$$eval('.nx-nav-label', (l) => l.map((x) => x.innerText.trim()).join(', ')),
      'REQUESTS, EQUIPMENT, YARD & LOGISTICS, USAGE & BILLING, COMMERCIAL, INSIGHTS, ADMIN, CUSTOMERS');

    T.section('tabs keep their pages');
    await page.fill('#workFind', 'half-typed note');
    await page.click(`.nx-nav-item[data-nav-id="${TAB2.id}"]`);
    if (SOON) {
      await page.waitForSelector('.nx-soon-card');
      T.check('a screen not built yet says so and opens New EquipRite\'s screen', (await page.getAttribute('#soonOpenNew', 'href')) === nav.newUrl(env.newUrl, SOON.id));
    } else {
      await page.waitForSelector(`.nx-tab--on[data-tab-id="${TAB2.id}"]`);
      T.check('every screen is built: none opens the "being built" page', !(await page.$('.nx-soon-card')));
    }
    T.eq('it opened in a second tab, current', await page.$eval('.nx-tab--on', (t) => t.innerText.trim()), TAB2.label);
    T.eq('the menu highlights it', await page.$eval('.nx-nav-item--on', (b) => b.dataset.navId), TAB2.id);
    await page.click('.nx-tab-btn[data-id="home"]');
    await page.waitForTimeout(400);
    T.eq('back on My work, what was typed is still there', await page.inputValue('#workFind'), 'half-typed note');
    await page.click('.nx-nav-item[data-nav-id="requests"]');
    await page.click(`.nx-nav-item[data-nav-id="${TAB2.id}"]`);
    await page.waitForTimeout(300);
    T.eq('opening an open screen shows its tab, no duplicate', await page.$$eval('.nx-tab', (t) => t.length), 3);
    await page.click('.nx-tab-btn[data-id="requests"]', { button: 'middle' });
    await page.waitForTimeout(300);
    T.eq('middle-click closes a tab', await page.$$eval('.nx-tab', (t) => t.map((x) => x.dataset.tabId).join()), 'home,' + TAB2.id);

    T.section('the menu collapses, and both are remembered');
    await page.click('#nxNavToggle');
    await page.waitForTimeout(300);
    const railWidth = await page.$eval('.nx-nav', (n) => n.getBoundingClientRect().width);
    T.check('collapsed to icons', railWidth < 80 && !(await page.isVisible('.nx-nav-item[data-nav-id="fleet"] .nx-nav-text')), String(railWidth));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`.nx-tab[data-tab-id="${TAB2.id}"]`, { timeout: 60000 });
    await page.waitForTimeout(800);
    T.check('after a restart: tabs back, menu still collapsed', (await page.$$eval('.nx-tab', (t) => t.map((x) => x.dataset.tabId).join())) === 'home,' + TAB2.id
      && (await page.$eval('.nx-app', (a) => a.className)).includes('nx-app--rail'));
    await page.click('#nxNavToggle');

    T.section('command bar');
    await page.keyboard.press('Control+k');
    T.check('Ctrl+K goes to the command bar', await page.evaluate(() => document.activeElement && document.activeElement.id === 'nxCommand'));
    await page.keyboard.type('rates');
    await page.waitForSelector('.nx-result');
    T.eq('matches screens', await page.$eval('.nx-result--on .nx-result-label', (e) => e.innerText), 'Rates');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    T.eq('Enter opens it', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'rates');
    await page.fill('#nxCommand', '1764');
    await page.waitForSelector('.nx-result');
    T.eq('a number offers the request first', await page.$eval('.nx-result--on .nx-result-label', (e) => e.innerText), 'Open request REQ-1764');
    await page.keyboard.press('Escape');

    T.section('the bell');
    await page.waitForSelector('.nx-bell-count', { timeout: 15000 });
    T.eq('unread count', await env.text('.nx-bell-count'), '4');
    await page.click('#nxBell');
    await page.waitForSelector('.nx-alert');
    const titles = await page.$$eval('.nx-alert-title', (t) => t.map((x) => x.innerText));
    T.eq('late first, then what waits on this persona, then updates', titles.join(' | '),
      'REQ-1764 is late | 1 request waits for approval | 1 piece needs a unit assigned | Request approved');
    await env.shot('next-shell-bell.png');
    await page.click('.nx-linkbtn');
    await page.waitForTimeout(200);
    T.check('mark all read', !(await page.$('.nx-bell-count')) && (await page.$$('.nx-alert--read')).length === 4);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    T.check('Escape closes it', !(await page.$('.nx-bell-panel')));

    T.section('deep link, narrow window');
    await env.open('/?open=agreements');
    await page.waitForSelector('.nx-tab[data-tab-id="agreements"]', { timeout: 30000 });
    T.eq('?open= opens that screen in a tab', await page.$eval('.nx-tab--on', (t) => t.dataset.tabId), 'agreements');
    await page.setViewportSize({ width: 760, height: 900 });
    await page.waitForTimeout(300);
    T.check('narrow: the menu is out of the way', (await page.$eval('.nx-nav', (n) => n.getBoundingClientRect().right)) <= 1);
    await page.click('#nxNavToggle');
    await page.waitForTimeout(400);
    T.check('...and slides over when asked', (await page.$eval('.nx-nav', (n) => n.getBoundingClientRect().left)) >= 0);
    T.check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    for (const w of [900, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(250);
      T.check(`${w}px: the toolbar fits`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        && document.querySelector('.nx-top').scrollWidth <= document.querySelector('.nx-top').clientWidth + 1));
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    T.check('phone width: the toolbar fits, nothing sideways', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      && document.querySelector('.nx-top').scrollWidth <= document.querySelector('.nx-top').clientWidth + 1));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await env.shot('next-shell.png');

    T.section('New EquipRite has the same switch');
    await page.goto(env.newUrl + '/vp/shell/home/home', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.er-switch #erGoNext', { timeout: 60000 });
    T.eq('Old / New / Next in New\'s header, New current', await page.$$eval('.er-switch .er-switch-btn', (b) => b.map((x) => x.innerText.trim() + (x.getAttribute('aria-current') ? '*' : '')).join(' ')), 'Old New* Next');
    T.eq('Next points at EquipRite Next', await page.getAttribute('#erGoNext', 'href'), env.nextUrl + '/');
    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('next-shell-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
