#!/usr/bin/env node
'use strict';
/**
 * Build.Rite: EquipRite Next's build shown as the team's own tools, a product apart from the business one.
 *   - as the desktop app serves it (its own server, window.EQP_PRODUCT): its name, only the Insights screens (Jira
 *     stories first and pinned), none of the business actions (New request, availability, cart, Help)
 *   - from Next's version switch (?product=buildrite on Next's address), and back to Next (?product=next)
 * Needs npm run build.
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const BUILD_SCREENS = ['issues', 'jira', 'analytics', 'minutes', 'followups', 'fdd', 'app-pages', 'fdd-library', 'flows'];

(async () => {
  // 1. As the desktop app serves Build.Rite: a server of its own, which tells the page
  const env = await E.start({ port: 19880, app: 'next', product: 'buildrite' });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('Build.Rite, as the desktop app serves it');
    await env.open('/');
    await page.waitForSelector('#nxNav [data-nav-id]', { timeout: 30000 });
    await page.waitForSelector('.nx-tab-btn', { timeout: 30000 }).catch(() => {});
    T.check('its name: Build.Rite, "for the team" (the window\'s title too)', /Build\.Rite\s*for the team/.test(await text(page, '#nxBrandBuild')) && (await page.title()) === 'Build.Rite'
      && (await page.evaluate(() => document.documentElement.getAttribute('data-nx-product'))) === 'buildrite');
    const items = await page.$$eval('#nxNav [data-nav-id]', (b) => b.map((x) => x.getAttribute('data-nav-id')));
    T.check('no "Help & the flow" (EquipRite\'s request flow) at the foot of the menu', !(await page.$('#nxNavHelp')));
    T.check('only the Insights screens in the menu: Issues, Jira stories, Analytics, Standup minutes, Follow-ups, EquipRite FDD, Application pages, FDD library', items.length >= 5 && items.every((id) => BUILD_SCREENS.indexOf(id) !== -1)
      && ['issues', 'jira', 'app-pages', 'fdd-library'].every((id) => items.indexOf(id) !== -1) && items.indexOf('requests') === -1 && items.indexOf('home') === -1, items.join(','));
    const tabs = await page.$$eval('.nx-tab', (t) => t.map((x) => x.getAttribute('data-tab-id') + (x.classList.contains('nx-tab--pinned') ? '*' : '')));
    T.check('Issues is the first tab, pinned (no My work)', tabs[0] === 'issues*' && tabs.indexOf('home') === -1 && tabs.indexOf('home*') === -1, tabs.join(','));
    T.check('none of the business actions: New request, Check availability, the cart, Help, the phone QR code, the bell', !(await page.$('#nxNewRequest')) && !(await page.$('#nxQa')) && !(await page.$('#nxCart')) && !(await page.$('#nxHelp')) && !(await page.$('#nxPhone')) && !(await page.$('#nxBell')));
    T.check('the search finds Build.Rite\'s screens', (await page.getAttribute('#nxCommand', 'placeholder')) === 'Search Build.Rite screens…');
    await page.click('#nxUser');
    await page.waitForSelector('#nxProfilePanel', { timeout: 5000 });
    T.check('the profile: Build.Rite is this one; Next is a link', /For the team building EquipRite\s*Build\.Rite/.test(await text(page, '#nxProfilePanel')) && !(await page.$('#nxGoBuild')) && !!(await page.$('#nxGoNext')));
    await page.keyboard.press('Escape');
    await page.click('.nx-backdrop').catch(() => {});
    await page.waitForSelector('#nxProfilePanel', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.click('#nxNav [data-nav-id="app-pages"]');
    await page.waitForSelector('#pgRows .nx-pg-row', { timeout: 30000 }).catch(() => {});
    T.check('its screens work as in Next (Application pages opens)', (await page.$$('#pgRows .nx-pg-row')).length > 100);
    const look = await page.evaluate(() => {
      const head = document.querySelector('.nx-pagehead');
      const after = head ? getComputedStyle(head, '::after') : null;
      return { strip: after ? after.backgroundImage : '', band: head ? getComputedStyle(head).backgroundColor : '', nav: getComputedStyle(document.getElementById('nxNav')).backgroundColor };
    });
    T.check('every page\'s header: Redwood\'s teal with Oracle\'s colour strip (no five-colour line); the menu the same teal', /colorstrip_redwood/.test(look.strip) && !/linear-gradient/.test(look.strip)
      && look.band === 'rgb(44, 82, 102)' && look.nav === look.band, JSON.stringify(look));
    for (const id of ['jira', 'fdd', 'minutes']) {
      await page.click('#nxNav [data-nav-id="' + id + '"]');
      await page.waitForTimeout(1500);
    }
    const heads = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.nx-pagehead'), (h) => getComputedStyle(h, '::after').backgroundImage));
    T.check('…on the other pages too (Jira stories, the FDD, standup minutes)', heads.length >= 3 && heads.every((b) => /colorstrip_redwood/.test(b)), heads.length + ' ' + heads.map((b) => b.slice(0, 40)).join(' | '));
    await page.click('#nxNav [data-nav-id="jira"]');
    await page.waitForTimeout(800);
    await env.shot('buildrite-jira.png');

    // Flows explained: every flow of the team's tools, step by step
    await page.click('#nxNav [data-nav-id="flows"]');
    await page.waitForSelector('.nx-hw-flow', { timeout: 15000 });
    const flows = await page.$$eval('.nx-hw-flow', (s) => s.map((x) => x.id + ':' + x.querySelectorAll(':scope > .nx-hw-steps > .nx-hw-step').length));
    T.check('Flows explained: the nine flows, each step by step (Issues: 8 steps, its side paths)', flows.length === 9 && flows[0] === 'hw-issues:8'
      && (await page.$$('#hw-issues .nx-hw-branch')).length === 4 && /Log it[\s\S]*Write it up[\s\S]*Analyze[\s\S]*Send for approval[\s\S]*Approve[\s\S]*Apply change[\s\S]*Pull request[\s\S]*Close/.test(await text(page, '#hw-issues .nx-hw-steps')), flows.join(','));
    T.check('…who does each step (You, AI, Agent, The app, Git, Jira), where it is kept, what Build.Rite works with', (await page.$$('#hwLegend .nx-hw-key')).length === 6 && /Agent/.test(await text(page, '#hw-issues .nx-hw-step--agent'))
      && /Where it is kept[\s\S]*issues\.json/.test(await text(page, '#hw-issues')) && /Jira[\s\S]*The AI[\s\S]*Microsoft 365[\s\S]*Git/.test(await text(page, '#hwLinks')));
    await env.shot('buildrite-flows.png');

    // Watch the flow: a tile plays it, animated
    await page.click('#hwIndex .nx-hw-tile[data-key="issues"]');
    await page.waitForFunction(() => { const d = document.getElementById('hwPlay'); return d && d.open && !!document.getElementById('hwPlayCard'); }, null, { timeout: 10000 });
    const p0 = await page.evaluate(() => ({ card: document.getElementById('hwPlayCard').textContent.replace(/\s+/g, ' ').trim(), prog: document.getElementById('hwPlayProgress').textContent.trim(),
      made: document.querySelectorAll('#hwPlayMade .nx-play-made').length, now: document.querySelectorAll('.nx-play-node--now').length, nodes: document.querySelectorAll('.nx-play-node').length, dot: getComputedStyle(document.getElementById('hwPlayDot')).left }));
    T.check('a tile plays its flow: a dialog, step 1 of 8 on show (who, what), the path of 8 with the first lit, the first thing it makes', p0.prog === 'Step 1 of 8' && /^You Step 1 Log it/.test(p0.card) && /Makes The issue, with its key/.test(p0.card)
      && p0.nodes === 8 && p0.now === 1 && p0.made === 1 && /Pause/.test(await text(page, '#hwPlayToggle')), JSON.stringify(p0));
    await page.waitForFunction(() => /Step 2 of 8/.test((document.getElementById('hwPlayProgress') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const p1 = await page.evaluate(() => ({ prog: document.getElementById('hwPlayProgress').textContent.trim(), card: document.getElementById('hwPlayCard').textContent, done: document.querySelectorAll('.nx-play-node--done').length,
      made: Array.prototype.map.call(document.querySelectorAll('#hwPlayMade .nx-play-made'), (m) => m.textContent.trim() + (m.classList.contains('nx-play-made--fresh') ? '*' : '')), dot: getComputedStyle(document.getElementById('hwPlayDot')).left }));
    T.check('…it moves on by itself: step 2 (the AI writes it up), the dot further along, what it made so far (the newest marked)', p1.prog === 'Step 2 of 8' && /Write it up/.test(p1.card) && p1.done === 1
      && p1.made.join('|') === 'The issue, with its key|Its write-up*' && parseFloat(p1.dot) > parseFloat(p0.dot), JSON.stringify([p1, p0.dot]));
    await page.click('#hwPlayToggle');
    await page.click('#hwPlayNext');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    T.check('paused; Next and → move on by hand (step 4: Send for approval)', /Play/.test(await text(page, '#hwPlayToggle')) && (await text(page, '#hwPlayProgress')) === 'Step 4 of 8' && /Send for approval/.test(await text(page, '#hwPlayCard')));
    for (let k = 0; k < 5; k++) await page.click('#hwPlayNext');
    await page.waitForSelector('#hwPlayEnd', { timeout: 5000 }).catch(() => {});
    T.check('its end: done, the other ways it can go, where it is kept; all 8 things it made', /That is the flow: Issues/.test(await text(page, '#hwPlayEnd')) && (await page.$$('#hwPlayEnd .nx-play-branch')).length === 4
      && /Where it is kept[\s\S]*issues\.json/.test(await text(page, '#hwPlayEnd')) && (await page.$$('#hwPlayMade .nx-play-made')).length === 8 && (await text(page, '#hwPlayProgress')) === 'Done · 8 steps' && await page.isDisabled('#hwPlayNext'));
    await page.waitForTimeout(1500); // its end slides in, and the dot finishes its run, before the picture
    await env.shot('buildrite-watch-end.png');
    await page.click('#hwPlayRestart');
    await page.waitForTimeout(300);
    T.check('from the start again, playing', (await text(page, '#hwPlayProgress')) === 'Step 1 of 8' && /Pause/.test(await text(page, '#hwPlayToggle')));
    await page.waitForTimeout(3300);
    await env.shot('buildrite-watch.png');
    await page.click('#hwPlayDetails');
    await page.waitForTimeout(600);
    T.check('"See the details" closes it, at the flow\'s section on the page', !(await page.evaluate(() => document.getElementById('hwPlay').open)) && await page.isVisible('#hw-issues'));
    await page.click('#hw-codefix .nx-hw-watchbtn');
    // its text changes as soon as the flow is chosen; the dialog opens a moment later (showModal, once drawn): wait for both
    await page.waitForFunction(() => document.getElementById('hwPlay').open && /Step 1 of 5/.test((document.getElementById('hwPlayProgress') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('each flow\'s "Watch the flow" plays it (Code fix: 5 steps)', /Code fix/.test(await text(page, '#hwPlayTitle')) && (await text(page, '#hwPlayProgress')) === 'Step 1 of 5');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    T.check('Escape closes it (and it stops)', !(await page.evaluate(() => document.getElementById('hwPlay').open)));
    await page.click('#hw-codefix [data-act="open"]');
    await page.waitForSelector('#pgRows .nx-pg-row', { timeout: 20000 }).catch(() => {});
    T.check('…and each one opens its screen (Code fix → Application pages)', (await page.$$('#pgRows .nx-pg-row')).length > 100);
    await env.shot('buildrite.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
  }

  // 2. Next: the business app, with Build.Rite in its version switch (here on Next's own address)
  const env2 = await E.start({ port: 19890, app: 'next' });
  const p2 = env2.page;
  try {
    T.section('Next: Build.Rite in its version switch, and back');
    await env2.open('/');
    await p2.waitForSelector('#nxNav [data-nav-id]', { timeout: 30000 });
    const nextItems = await p2.$$eval('#nxNav [data-nav-id]', (b) => b.map((x) => x.getAttribute('data-nav-id')));
    T.check('Next keeps everything: the business screens and the Insights ones; its own name', nextItems.indexOf('requests') !== -1 && nextItems.indexOf('jira') !== -1 && nextItems.indexOf('app-pages') !== -1
      && !(await p2.$('#nxBrandBuild')) && /EquipRite\s*Next/.test(await text(p2, '.nx-brand')));
    await p2.click('#nxUser');
    await p2.waitForSelector('#nxGoBuild', { timeout: 10000 });
    T.check('the profile lists Build.Rite, for the team', /For the team building EquipRite\s*Build\.Rite\s*Jira stories, standups/.test(await text(p2, '#nxProfilePanel')) && /product=buildrite/.test((await p2.getAttribute('#nxGoBuild', 'href')) || ''));
    await p2.click('#nxGoBuild');
    await p2.waitForSelector('#nxBrandBuild', { timeout: 30000 }).catch(() => {});
    await p2.waitForSelector('#nxNav [data-nav-id]', { timeout: 30000 });
    const bItems = await p2.$$eval('#nxNav [data-nav-id]', (b) => b.map((x) => x.getAttribute('data-nav-id')));
    T.check('chosen: Build.Rite (only the Insights screens)', !!(await p2.$('#nxBrandBuild')) && bItems.every((id) => BUILD_SCREENS.indexOf(id) !== -1), bItems.join(','));
    await p2.click('#nxUser');
    await p2.waitForSelector('#nxGoNext', { timeout: 10000 });
    T.check('…and its way back to Next says so (?product=next)', /product=next/.test((await p2.getAttribute('#nxGoNext', 'href')) || ''));
    await p2.click('#nxGoNext');
    await p2.waitForSelector('#nxNav [data-nav-id="requests"]', { timeout: 30000 }).catch(() => {});
    T.check('back in Next: its business screens again', !!(await p2.$('#nxNav [data-nav-id="requests"]')) && !(await p2.$('#nxBrandBuild')));
  } catch (e) {
    T.check('no exception (switch): ' + (e && e.message), false);
  } finally {
    await env2.close();
  }
  T.report();
})();
