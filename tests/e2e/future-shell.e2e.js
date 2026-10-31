'use strict';
/*
 * EquipRite Future's shell in a real browser: it opens on My work, the version list (Old, New, Next, Mobile, Future),
 * Playing as (the menu and its badges follow the persona), the demo clock, the bell, Reset the demo (asks first), the
 * Guide's "Play as … and open …", no sideways scroll, no browser errors, and no backend call at all (Future runs on
 * its simulated store). Needs `npm run build`.
 * Run: node tests/e2e/future-shell.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();

(async () => {
  const env = await E.start({ port: 19600, app: 'future' });
  const { page } = env;
  const menu = () => page.$$eval('.nx-nav-item', (b) => b.map((x) => x.dataset.navId).join(' '));
  const badges = () => page.$$eval('.nx-nav-item', (b) => b.filter((x) => x.querySelector('.fx-nav-badge'))
    .map((x) => x.dataset.navId + ':' + x.querySelector('.fx-nav-badge').innerText.trim()).join(' '));
  const currentTab = () => page.$eval('.nx-tab--on', (t) => t.dataset.tabId);
  const toast = async () => ((await page.$('#nxToast')) ? env.text('#nxToast') : '');
  const playAs = async (id) => {
    await page.click('#fxPersona');
    await page.waitForSelector('#fxPersonaPanel');
    await page.click(`#fxPersonaPanel .fx-person[data-id="${id}"]`);
    await page.waitForFunction((n) => { const e = document.getElementById('fxPersonaName'); return e && e.innerText.trim() === n; },
      { 'p-pm': 'Priya Raman', 'p-em': 'Ana Costa', 'p-fin': 'Sara Ahmed', 'p-site': 'Omar Haddad' }[id], { timeout: 10000 });
    await page.waitForTimeout(400);
  };
  // Stages data the way a screen would: through the store's act() (Future's screens are built by others).
  const act = (type, payload) => page.evaluate(([t, p]) => new Promise((resolve) => {
    window.require(['resources/js/future/fxStore'], (store) => resolve(store.act(t, p)));
  }), [type, payload]);
  try {
    T.section('it opens on My work');
    await env.open('/');
    await page.waitForSelector('#page-work .fx-next', { timeout: 30000 });
    T.eq('the window says EquipRite Future', await page.title(), 'EquipRite Future');
    T.eq('My work is the tab shown, pinned', [await currentTab(), await page.$$eval('.nx-tab', (t) => t.map((x) => x.innerText.trim() + (x.querySelector('.nx-tab-close') ? '' : '*')).join())].join(' | '), 'work | My work*');
    T.eq('the brand says Future', await env.text('.nx-brand .nx-badge'), 'FUTURE');
    T.eq('a thin banner says what this is', await env.text('#fxBanner'),
      'Prototype: simulated companies and Fusion. EquipRite creates the transactions; the accounting is shown, never posted.');
    T.check('the banner is thin', (await page.$eval('#fxBanner', (b) => b.getBoundingClientRect().height)) <= 32);
    T.eq('playing as Priya, the Project Manager, to start', [await env.text('#fxPersonaName'), await env.text('#fxPersonaTitle')].join(' | '), 'Priya Raman | Project Manager · ProjectCo');
    T.eq('the demo clock starts on 2 Nov 2026', await env.text('#fxToday'), 'Mon 2 Nov 2026');
    T.eq('Priya\'s menu: her requests, the site, money she reviews; no fleet owner screens',
      await menu(), 'work requests new-request site charges billing reports setup guide');
    T.eq('the menu\'s groups', await page.$$eval('.nx-nav-label', (l) => l.map((x) => x.innerText.trim()).join(', ')),
      'HOME, REQUESTS, ON SITE, MONEY, FINANCE, SETUP, HELP');
    T.check('no global search, Check availability, phone QR or cart (Next\'s, left out)',
      !(await page.$('#nxCommand')) && !(await page.$('#nxQa')) && !(await page.$('#nxPhone')) && !(await page.$('#nxCart')));
    T.check('New request in the toolbar, Help opens the Guide', (await env.text('#nxNewRequest')) === 'New request' && (await page.getAttribute('#nxHelp', 'data-nav-id')) === 'guide');
    T.eq('My work: the story\'s next step is Priya\'s own', await env.text('#workNextText'), 'Raise a request for ProjectCo\'s project');
    await env.shot('future-work.png');

    T.section('the version list: Old, New, Next, Mobile, Future (current)');
    await page.click('#nxProfile');
    await page.waitForSelector('#nxProfilePanel');
    T.eq('versions in your menu', await page.$$eval('.nx-versions .nx-version', (b) => b.map((x) => x.querySelector('.nx-version-name').innerText.trim()
      + (x.getAttribute('aria-current') ? ' (current)' : '')).join(', ')), 'Old, New, Next, Mobile, Future (current)');
    T.eq('each points at its app', [await page.getAttribute('#nxGoOld', 'href'), await page.getAttribute('#nxGoNew', 'href'), await page.getAttribute('#nxGoNext', 'href'),
      await page.getAttribute('#nxGoMobile', 'href')].join(' '), [env.oldUrl, env.newUrl, env.nextUrl, env.mobileUrl].map((u) => u + '/').join(' '));
    T.eq('Mobile in a window of its own', await page.getAttribute('#nxGoMobile', 'target'), '_blank');
    T.check('the themes are there', (await page.$$('#nxThemes .nx-theme')).length === 6);
    await env.shot('future-profile.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    T.check('Escape closes it', !(await page.$('#nxProfilePanel')));

    T.section('Playing as: the menu, the badges and the screens follow');
    await page.click('#fxPersona');
    await page.waitForSelector('#fxPersonaPanel');
    T.eq('everyone in the demo group, Priya current', await page.$$eval('#fxPersonaPanel .fx-person', (b) => b.map((x) => x.querySelector('.fx-person-name').innerText.trim()
      + (x.getAttribute('aria-current') === 'true' ? '*' : '')).join(', ')),
      'Priya Raman*, Omar Haddad, Yusuf Rahman, Mark Lee, Faisal Al-Qahtani, Huda Saleh, Ana Costa, Ravi Kumar, Lena Novak, Sara Ahmed, Admin');
    T.eq('each with their business units', await env.text('#fxPersonaPanel .fx-person[data-id="p-em"] .fx-person-bus'), 'FleetCo Fleet');
    await env.shot('future-persona-menu.png');
    await page.keyboard.press('Escape');
    // Priya raises a request on FleetCo's excavator (what New request will do), so FleetCo has something to approve.
    const raised = await act('createRequest', { requestingBu: 'BU-PC', projectId: 'P-INT', from: '2026-11-03', to: '2026-12-20', lines: [{ cls: 'EXC', unitId: 'U-EX1' }] });
    T.eq('a request raised (through the store)', [raised.ok, raised.result && raised.result.number].join(), 'true,FR-1001');
    await page.waitForSelector('#workRequests .nx-row--click', { timeout: 10000 });
    T.eq('My work lists it at once (the store\'s change refreshes the screen)', await env.text('#workRequests .nx-row--click .nx-link'), 'FR-1001');
    T.check('Priya does not see Approve & allocate', !(await menu()).includes('approvals'));
    await playAs('p-em');
    T.eq('Ana\'s menu: the fleet owner\'s screens', await menu(), 'work approvals yard reports setup guide');
    T.eq('…with a badge on what waits for her', await badges(), 'approvals:1');
    T.check('…no New request in the toolbar', !(await page.$('#nxNewRequest')));
    T.check('the toast says who is played', (await toast()).startsWith('Playing as Ana Costa, Equipment Manager · FleetCo.'), await toast());
    T.eq('My work follows: what waits for Ana', await env.text('#workItems'), '1 lines to approve and allocate from your fleet In Approve & allocate');
    await page.click('#workItems .fx-wait');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'approvals'; }, null, { timeout: 10000 });
    T.check('a queue opens its screen', true);
    await playAs('p-pm');
    T.eq('back to Priya: Approve & allocate closes (not hers), the menu is hers again', [await page.$$eval('.nx-tab', (t) => t.map((x) => x.dataset.tabId).join()), await menu()].join(' | '),
      'work | work requests new-request site charges billing reports setup guide');
    T.check('…and the toast says so', (await toast()).includes('Closed Approve & allocate: not open to Priya.'), await toast());
    await page.click('#workRequests .nx-row--click');
    await page.waitForSelector('.nx-tab[data-tab-id="request:R1001"]', { timeout: 10000 });
    T.eq('a request opens in its own tab, titled with its number', await page.$eval('.nx-tab--on', (t) => t.innerText.trim()), 'FR-1001');

    T.section('the bell: per persona, opens what it is about');
    await playAs('p-em');
    await page.waitForSelector('.nx-bell-count', { timeout: 10000 });
    T.eq('Ana has one unread', await env.text('.nx-bell-count'), '1');
    await page.click('#nxBell');
    await page.waitForSelector('#nxBellPanel .nx-alert');
    T.check('it says what to do', (await env.text('#nxBellPanel .fx-note-text')).includes('FR-1001'), await env.text('#nxBellPanel .fx-note-text'));
    await env.shot('future-bell.png');
    await page.click('#nxMarkRead');
    await page.waitForFunction(() => !document.querySelector('.nx-bell-count'), null, { timeout: 5000 });
    T.check('Mark all read: none unread for Ana', (await page.$$('#nxBellPanel .nx-alert--read')).length >= 1);
    await page.click('#nxBellPanel .nx-alert');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'approvals'; }, null, { timeout: 10000 });
    T.check('a notification opens its screen, and the bell closes', !(await page.$('#nxBellPanel')));

    T.section('the demo clock');
    await page.click('#fxDay');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Tue 3 Nov 2026', null, { timeout: 5000 });
    T.check('+1 day', true);
    T.check('…the toast says the new day', (await toast()).startsWith('Today is Tue 3 Nov 2026.'), await toast());
    await page.click('#fxWeek');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Tue 10 Nov 2026', null, { timeout: 5000 });
    T.check('+1 week', true);
    await page.click('#fxMonthEnd');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Mon 30 Nov 2026', null, { timeout: 5000 });
    T.eq('Month end lands on 30 Nov 2026', await env.text('#fxToday'), 'Mon 30 Nov 2026');
    await page.click('#fxClock');
    await page.waitForSelector('#fxClockPanel');
    T.check('the clock says what moving it does', (await env.text('#fxClockPanel')).includes('accepted by silence'));
    await page.keyboard.press('Escape');

    T.section('Reset the demo: asks first');
    await page.click('#nxProfile');
    await page.click('#fxResetAsk');
    await page.waitForSelector('#fxResetDialog');
    T.check('it asks first, saying what goes', (await env.text('#fxResetText')).includes('Every request, charge, statement, invoice and notification goes'));
    await page.click('#fxResetCancel');
    await page.waitForTimeout(300);
    T.eq('Keep the story: nothing changed', [!(await page.$('#fxResetDialog')), await env.text('#fxToday')].join(), 'true,Mon 30 Nov 2026');
    await page.click('#nxProfile');
    await page.click('#fxResetAsk');
    await page.click('#fxResetConfirm');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Mon 2 Nov 2026', null, { timeout: 5000 });
    T.eq('Reset: back to 2 Nov 2026, still Ana, the request\'s tab closed', [await env.text('#fxPersonaName'), await page.$$eval('.nx-tab', (t) => t.map((x) => x.dataset.tabId).join())].join(' | '),
      'Ana Costa | work,approvals');
    T.check('…and the toast says so', (await toast()).startsWith('The demo starts again'), await toast());
    T.eq('…no badges, nothing waiting', await badges(), '');

    T.section('the Guide: who plays each step, in one click');
    await page.click('.nx-nav-item[data-nav-id="guide"]');
    await page.waitForSelector('#guideSteps .fx-step', { timeout: 15000 });
    T.eq('thirteen steps, the first one next', [await page.$$eval('#guideSteps .fx-step', (s) => s.length), await page.getAttribute('#guideSteps .fx-step--next', 'data-step')].join(), '13,1');
    T.eq('five scenarios', await page.$$eval('#guideScenarios .fx-scenario', (s) => s.map((x) => x.dataset.scenario).join()), 'S1,S2,S3,XB,LE');
    T.eq('the FDD v2.0 rules in one card', await page.$$eval('#guideRules .fx-rule-id', (r) => r.map((x) => x.innerText.trim()).join()), 'GR-1,GR-2,GR-3,GR-4,GR-5,GR-6,GR-7');
    await env.shot('future-guide.png');
    T.eq('step 1 is Priya\'s: the button plays her', await env.text('#guideSteps .fx-step--next .fx-play'), 'Play as Priya and open New request');
    await page.click('#guideSteps .fx-step--next .fx-play');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'new-request'; }, null, { timeout: 10000 });
    T.eq('Play as … switches the persona and opens the screen', [await env.text('#fxPersonaName'), await currentTab()].join(' | '), 'Priya Raman | new-request');
    T.check('…Approve & allocate closed, Ana\'s not Priya\'s', !(await page.$('.nx-tab[data-tab-id="approvals"]')));

    T.section('fits the window');
    for (const w of [1440, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(300);
      for (const tab of ['work', 'guide']) {
        await page.click(`.nx-tab-btn[data-id="${tab}"]`);
        await page.waitForTimeout(250);
        T.check(`${w}px, ${tab}: no sideways scroll, the toolbar fits`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
          && document.querySelector('.nx-top').scrollWidth <= document.querySelector('.nx-top').clientWidth + 1));
      }
    }
    T.check('1024px: the clock\'s buttons and Priya\'s name still show', (await page.isVisible('#fxMonthEnd')) && (await page.isVisible('#fxPersonaName')));
    await env.shot('future-1024.png');
    await page.setViewportSize({ width: 1440, height: 1000 });

    T.section('runs on the store alone');
    T.eq('no call to any backend', env.calls.join('\n'), '');
    T.eq('no browser errors or warnings', env.errors.join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('future-shell-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
