'use strict';
/*
 * EquipRite Next, the Follow-ups page (flows/insights followups-page; store desktop/lib/followups.js), in a real
 * browser: a saved follow-up shows in the list; opening it shows its header (title, scope, recipients, when) and the
 * email that was composed (greeting + the stories table with the Key linking to Jira); Copy for email puts it on the
 * clipboard; Delete removes it. The store is the real DuckDB store (a JSON file where DuckDB cannot load).
 * Needs `npm run build`. Run: node tests/e2e/next-followups.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const texts = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.getClientRects().length).map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const settle = (page, ms) => page.waitForTimeout(ms);

const SAMPLE = {
  kind: 'sprint', title: 'Follow-up — Sprint 2026-07', subtitle: 'active · 2026-07-01 – 2026-07-31',
  subject: 'Please close these stories', to: 'rahul@company.com; nabil@company.com', message: 'Dear Rahul and Nabil,\n\nAs we discussed, kindly close the following stories.',
  signoff: 'Thanks,', sprintName: '2026-07', source: '', author: 'javeed.shaik',
  lines: [
    { storyKey: 'EQP-12', summary: 'Equipment Master List View - Section 7.2', status: 'DEVELOPMENT', assignee: 'Rahul Kanth Panganamamula', sprint: '2026-07', due: '2026-10-07', overdue: true, customer: 'cianbro', url: 'https://equiprite.atlassian.net/browse/EQP-12' },
    { storyKey: 'EQP-31', summary: 'Rate Schedule Report - Section 7.15.9', status: 'DEVELOPMENT', assignee: 'Rahul Kanth Panganamamula', sprint: '2026-07', due: '2026-07-31', overdue: true, customer: 'oceaneering', url: 'https://equiprite.atlassian.net/browse/EQP-31' },
  ],
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-followups-'));
  const fuStore = await require('../../desktop/lib/followups').open({ file: path.join(dir, 'followups.duckdb') });
  await fuStore.save(SAMPLE);

  const env = await E.start({ port: 19772, app: 'next', followupsStore: fuStore });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('the Follow-ups page lists what was saved');
    await env.open('/?open=followups');
    await page.waitForSelector('#flTitle', { timeout: 30000 });
    await settle(page, 600);
    T.eq('its menu item, under Insights', await text(page, '.nx-nav-item--on'), 'Follow-ups');
    T.eq('one saved follow-up, counted in the header', await text(page, '#flCount'), '1 saved follow-up');
    const rows = await texts(page, '.nx-fl-list .nx-fl-row');
    T.check('the row shows the title, the scope and the item count', rows.length === 1
      && rows[0].includes('Follow-up — Sprint 2026-07') && rows[0].includes('Sprint 2026-07') && rows[0].includes('2 stories'), rows.join(' | '));

    T.section('opening it shows the header and the composed email');
    await page.click('.nx-fl-list .nx-fl-row');
    await page.waitForSelector('#flDetailTitle', { timeout: 10000 });
    await settle(page, 400);
    T.eq('the detail title', await text(page, '#flDetailTitle'), 'Follow-up — Sprint 2026-07');
    const facts = await text(page, '.nx-fl-facts');
    T.check('the header facts: recipients, scope, items', facts.includes('rahul@company.com') && facts.includes('Sprint 2026-07') && facts.includes('2 stories'), facts);
    const srcdoc = await page.getAttribute('#flPreview', 'srcdoc');
    T.check('the preview is the composed email: greeting, the table with the linked Key, the Sprint column',
      srcdoc.includes('Dear Rahul and Nabil,') && srcdoc.includes('<table') && srcdoc.includes('href="https://equiprite.atlassian.net/browse/EQP-12"')
      && srcdoc.includes('>Sprint</th>'), srcdoc.slice(0, 160));
    await env.shot('next-followups.png');

    T.section('Copy for email puts the whole email on the clipboard');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.nextUrl });
    await page.click('#flCopy');
    await settle(page, 300);
    const clip = await page.evaluate(async () => {
      try { const items = await navigator.clipboard.read(); for (const it of items) { if (it.types.includes('text/html')) return await (await it.getType('text/html')).text(); } } catch (e) { /* ignore */ }
      return '';
    });
    T.check('the clipboard HTML has the message and the table', clip.includes('Dear Rahul and Nabil,') && clip.includes('<table') && clip.includes('EQP-31'), clip.slice(0, 120));

    T.section('Delete removes it');
    await page.click('#flDelete');
    await page.waitForSelector('#flEmpty', { timeout: 10000 });
    T.check('the list is empty and the store has none', (await page.$$('.nx-fl-list .nx-fl-row')).length === 0 && (await fuStore.list()).followups.length === 0);

    T.check('no console errors', errs().length === 0, errs().join(' | '));
  } finally {
    if (fuStore.close) await fuStore.close();
    await env.close();
  }
  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
