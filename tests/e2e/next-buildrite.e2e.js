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
