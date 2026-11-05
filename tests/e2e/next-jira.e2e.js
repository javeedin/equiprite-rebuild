'use strict';
/*
 * EquipRite Next, Jira stories (flows/insights jira-page; rules resources/js/jiraBacklog.js), in a real browser against a
 * fake Jira: Connect in the desktop app (the token goes to the desktop app, which adds it to the jira backend's calls),
 * every page of the search read, the numbers, what they say, a finding opening its items, by status, the breakdowns,
 * the filters, one item in the drawer (criteria, checks, gaps, comments, Open in Jira), a preset, export, Disconnect;
 * then the Redwood look: Oracle's header with Smart Search (a filter per column) and Oracle's table.
 * Needs `npm run build`. Run: node tests/e2e/next-jira.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const JA = require('../../desktop/lib/jiraAuth');

const T = H.makeAsserter();
const today = new Date().toISOString().slice(0, 10);
const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const status = (name, key) => ({ name, statusCategory: { key } });
const EPIC1 = { key: 'EQP-1', fields: { summary: 'Equipment Registry' } };
const EPIC2 = { key: 'EQP-62', fields: { summary: 'Rate & Pricing' } };
const issue = (key, f) => ({ id: key.slice(4), key, fields: Object.assign({ issuetype: { name: 'Story' }, priority: { name: 'Medium' }, comment: { comments: [] },
  created: '2026-07-16T10:00:00.000-0500', updated: days(-2) + 'T10:00:00.000-0500' }, f) });
const ISSUES = [
  issue('EQP-12', { summary: 'Equipment Master List View - Section 7.2', status: status('DEVELOPMENT', 'indeterminate'), parent: EPIC1,
    fixVersions: [{ name: '26C', releaseDate: days(-36) }], assignee: { displayName: 'Rahul Kanth Panganamamula' }, duedate: days(-29),
    description: 'Display master list of all equipment records with smart search.Acceptance Criteria: Grid displays all columns per FDD 7.2.4; smart search returns results with type-ahead; all filter fields functional.FDD Section: 7.2Only Smart search is available.',
    comment: { comments: [{ author: { displayName: 'Sana Suhana Thehaseen' }, created: '2026-09-29T04:37:34.383-0500',
      body: '**(FDD-7.2)**\n\n1. Only Class, Subclass search filters are present.\n\n2. Type Column is missing.\n\n3. Map view is missing.\n\n4. Edit option to be added.' }] },
    customfield_10020: [{ id: 4, name: '2026-06', state: 'closed', startDate: '2026-06-01T05:00:00.000Z', endDate: '2026-06-30T05:00:00.000Z' },
      { id: 5, name: '2026-07', state: 'active', startDate: '2026-07-01T05:00:00.000Z', endDate: '2026-07-31T05:00:00.000Z' }] }),
  issue('EQP-13', { summary: 'Equipment Master Create/Edit - Section 7.2, 7.2.5G', status: status('DEVELOPMENT', 'indeterminate'), priority: { name: 'High' }, parent: EPIC1,
    fixVersions: [{ name: '27A', releaseDate: days(56) }], assignee: { displayName: 'Rahul Kanth Panganamamula' }, duedate: days(20),
    description: 'Create and edit equipment.\n\nAcceptance Criteria: created; unique name; FA asset; fields save; one-to-many types; saved and read; LOV filter.\n\nFDD Section: 7.2, 7.2.5G',
    customfield_10020: [{ id: 9, name: 'Sprint now', state: 'active', startDate: days(-4) + 'T05:00:00.000Z', endDate: days(9) + 'T05:00:00.000Z', goal: 'Equipment master editable' }] }),
  issue('EQP-20', { summary: 'Rate schedule list', status: status('Done', 'done'), parent: EPIC2, fixVersions: [{ name: '26C', releaseDate: days(-36) }],
    assignee: { displayName: 'Aditi Rao' }, duedate: days(-60), description: 'List schedules. Acceptance Criteria: the list shows. FDD Section: 7.3' }),
  issue('EQP-30', { summary: 'Notification engine', status: status('FUNC DESIGN', 'indeterminate'), description: 'Send notifications.', updated: days(-45) + 'T10:00:00.000-0500' }),
  issue('EQP-40', { summary: 'Inspection checklist', status: status('ONHOLD', 'indeterminate'), parent: EPIC1, assignee: { displayName: 'Aditi Rao' },
    fixVersions: [{ name: '27A', releaseDate: days(56) }], duedate: days(10), description: 'Inspect. Acceptance Criteria: a checklist per class. FDD Section: 7.12',
    customfield_10020: [{ id: 7, name: '2026-10 B', state: 'future', startDate: days(-20) + 'T05:00:00.000Z', endDate: days(-5) + 'T05:00:00.000Z' }] }),
];
const BUG = issue('EQP-99', { summary: 'Grid scrolls badly', issuetype: { name: 'Bug' }, status: status('Bugs', 'new'), description: 'It jumps.' });
let searches = [];

function handle(req, res) {
  if (req.path === '/rest/api/2/myself') {
    return req.auth ? res.json({ displayName: 'Javeed Shaik', emailAddress: 'javeed@equiprite.com' }) : res.json({ errorMessages: ['Unauthorized'] }, 401);
  }
  if (req.path === '/rest/api/2/search/jql') {
    if (!req.auth) return res.json({ errorMessages: ['Unauthorized'] }, 401);
    const jql = req.query.get('jql') || '';
    const token = req.query.get('nextPageToken') || '';
    searches.push({ jql, token, fields: req.query.get('fields') || '' });
    if (/issuetype = Bug/.test(jql)) return res.json({ issues: [BUG], isLast: true });
    // two pages, as Jira pages: a token, then isLast
    return token ? res.json({ issues: ISSUES.slice(3), isLast: true }) : res.json({ issues: ISSUES.slice(0, 3), nextPageToken: 'page-2', isLast: false });
  }
  return undefined;
}

async function settle(page, ms) { await page.waitForTimeout(ms || 400); }
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
const texts = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.getClientRects().length).map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
const complete = (page, scope, tags) => page.evaluate((a) => a[1].map((t) => {
  const el = document.querySelector(a[0] + ' ' + t);
  return t + ':' + (el ? el.classList.contains('oj-complete') : 'missing');
}).join(' '), [scope, tags]);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-jira-'));
  const enc = (t) => Buffer.from('enc:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(String(b).replace(/^enc:/, ''), 'base64').toString();
  const jiraStore = JA.open({ file: path.join(dir, 'jira.json'), encrypt: enc, decrypt: dec });
  const env = await E.start({ port: 19760, handle, app: 'next', jiraStore });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('not connected: Connect, in the desktop app');
    await env.open('/?open=jira');
    await page.waitForSelector('#jiraConn', { timeout: 30000 });
    await settle(page, 600);
    T.eq('its menu item, under Insights', await text(page, '.nx-nav-item--on'), 'Jira stories');
    T.check('the form: site, email, API token (a password box), Connect; and where to make a token', await page.isVisible('#jiraEmail')
      && (await page.getAttribute('#jiraToken', 'type')) === 'password' && (await page.inputValue('#jiraSite')) === 'https://equiprite.atlassian.net'
      && (await text(page, '#jiraConn')).includes('Create an API token'));
    T.check('nothing searched yet', searches.length === 0);
    await page.fill('#jiraEmail', 'javeed@equiprite.com');
    await page.dispatchEvent('#jiraEmail', 'change');
    await page.fill('#jiraToken', 'ATATT-test-token');
    await page.dispatchEvent('#jiraToken', 'change');
    await page.click('#jiraConnect');
    await page.waitForSelector('#jiraTiles', { timeout: 20000 });
    await settle(page, 800);
    T.check('connected: the desktop app keeps the token (the page never shows it again)', jiraStore.settings().connected
      && (await text(page, '.nx-jira-conninfo')).includes('Connected as Javeed Shaik') && !(await page.$('#jiraToken')));
    T.eq('every page of the search read, with the fields the page uses', searches.map((x) => (x.token || '-')).join(','), '-,page-2');
    T.check('…the default search: all stories', searches[0].jql === 'project = EQP AND issuetype = Story ORDER BY key ASC' && searches[0].fields.includes('customfield_10020'));
    T.check('the header says what was read', /EquipRite backlog on equiprite\.atlassian\.net · 5 items read at \d\d:\d\d/.test(await text(page, '#jiraSub')), await text(page, '#jiraSub'));

    T.section('the numbers and what they say');
    T.eq('the tiles', (await texts(page, '#jiraTiles .nx-jira-tile')).join(' | '),
      '5 Items | 1 Done 20% | 3 In progress | 1 On hold | 1 Overdue | 1 No acceptance criteria | 4 Tester gaps 1 items | 3.5 / 5 Average quality');
    const finds = await texts(page, '#jiraFindings .nx-jira-find');
    T.check('the findings: overdue first, the passed release, the missing criteria, the gaps', finds[0] === '1 item is past its due date, most of them in DEVELOPMENT (1).'
      && finds.some((f) => /^Release 26C was due .* and still has 1 item not done\.$/.test(f)) && finds.some((f) => f.includes('no acceptance criteria'))
      && finds.some((f) => f.startsWith('Testers listed 4 gaps')), finds.join(' | '));
    T.eq('by status, in the workflow\'s order', (await texts(page, '#jiraStatuses .nx-jira-bar')).join(' | '),
      'FUNC DESIGN 1 · 20% | DEVELOPMENT 2 · 40% | ONHOLD 1 · 20% | Done 1 · 20%');
    await page.click('#jiraFindings .nx-jira-find >> nth=0');
    await settle(page, 500);
    T.eq('a finding opens its items, and says so', [(await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), await text(page, '#jiraShowing')].join(' / '),
      'EQP-12 / 1 item is past its due date, most of them in DEVELOPMENT (1). ×');
    await page.click('#jiraShowing .nx-jira-x');
    await settle(page, 400);
    T.eq('cleared: every item', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head)')).length, 5);
    await page.click('#jiraTiles .nx-jira-tile[data-key="noAc"]');
    await settle(page, 400);
    T.eq('a tile opens what it counts', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), 'EQP-30');
    await page.click('#jiraShowing .nx-jira-x');

    T.section('the breakdowns');
    T.eq('by sprint first: active, then future, then closed; what is wrong with each', (await texts(page, '#jiraSprints .nx-jira-tr--sprint:not(.nx-jira-tr--head) .nx-jira-sprintname')).join(' | '),
      '2026-07 active Still active, ended 2026-07-31 1 item due after it ends | Sprint now active Goal: Equipment master editable 1 item due after it ends | '
      + '2026-10 B future Future, but its end date (' + days(-5) + ') has passed 1 item due after it ends | No sprint');
    T.check('…its dates and days left, done of total', (await texts(page, '#jiraSprints .nx-jira-tr--sprint[data-value="Sprint now"]'))[0].includes(days(-4) + ' – ' + days(9) + ' · 9 days left'));
    const stillActive = (await texts(page, '#jiraFindings .nx-jira-find')).findIndex((f) => f.startsWith('Sprint 2026-07 is still active'));
    T.check('the sprint findings: one still active after its end, the running one\'s progress, a stale future one, the spill-over',
      stillActive !== -1 && (await text(page, '#jiraFindings')).includes('Sprint Sprint now: 0 of 1 done (0%), 9 days left.')
      && (await text(page, '#jiraFindings')).includes('1 future sprint has an end date already past (2026-10 B)') && (await text(page, '#jiraFindings')).includes('1 open item was carried over'));
    await page.click('#jiraSprints .nx-jira-tr--sprint[data-value="2026-07"]');
    await settle(page, 400);
    T.eq('a sprint opens its items', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), 'EQP-12');
    await page.click('#jiraShowing .nx-jira-x');
    await page.click('#jiraTabs .nx-jira-tab[data-value="epics"]');
    await settle(page, 300);
    T.eq('by epic, most open first', (await texts(page, '#jiraTabBody .nx-jira-tr--epic:not(.nx-jira-tr--head)')).map((t) => t.split(' ')[0]).join(','), 'EQP-1,No,EQP-62');
    await page.click('#jiraTabs .nx-jira-tab[data-value="releases"]');
    await settle(page, 300);
    T.check('by release: 26C\'s date has passed', (await texts(page, '#jiraTabBody .nx-jira-tr--rel:not(.nx-jira-tr--head)'))[0].startsWith('26C Date passed'));
    await page.click('#jiraTabs .nx-jira-tab[data-value="gaps"]');
    await settle(page, 300);
    T.check('the testers\' gaps, numbered', (await text(page, '#jiraGaps')).includes('EQP-12') && (await text(page, '#jiraGaps')).includes('Map view is missing.'));
    await page.click('#jiraTabs .nx-jira-tab[data-value="checks"]');
    await settle(page, 300);
    await page.click('#jiraTabBody .nx-jira-tr--chk[data-value="big"]');
    await settle(page, 400);
    T.eq('a check opens the items that fail it', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), 'EQP-13');
    await page.click('#jiraShowing .nx-jira-x');
    await page.click('#jiraTabs .nx-jira-tab[data-value="people"]');
    await settle(page, 300);
    await page.click('#jiraTabBody .nx-jira-tr--rel[data-value="Aditi Rao"]');
    await settle(page, 400);
    T.eq('a person, from By person', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), 'EQP-20,EQP-40');
    await page.click('#jiraShowing .nx-jira-x');
    await page.click('#jiraStatusChips .nx-chip[data-value="DEVELOPMENT"]');
    await settle(page, 400);
    T.eq('a status chip', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), 'EQP-12,EQP-13');
    await page.click('#jiraShowing .nx-jira-x');
    await settle(page, 300);
    await env.shot('next-jira.png');

    T.section('one item, in the drawer');
    await page.click('#jiraGrid .nx-jira-row[data-key="EQP-12"]');
    await page.waitForSelector('#jiraItem', { state: 'visible', timeout: 10000 });
    await settle(page, 500);
    const item = await text(page, '#jiraDrawer');
    T.check('its title, facts and quality', item.includes('EQP-12 Equipment Master List View - Section 7.2') && item.includes('Rahul Kanth Panganamamula')
      && item.includes('Due after its release date') && item.includes('2026-07 · active · ends 2026-07-31') && /earlier sprints 2026-06/i.test(item)
      && item.includes('Carried over from an earlier sprint'), item.slice(0, 400));
    T.eq('its criteria as a list', (await texts(page, '#jiraAc li')).join(' | '), 'Grid displays all columns per FDD 7.2.4 | smart search returns results with type-ahead | all filter fields functional.');
    T.eq('its tester gaps', (await texts(page, '#jiraItemGaps li')).length, 4);
    T.eq('Open in Jira', await page.getAttribute('#jiraOpenInJira', 'href'), 'https://equiprite.atlassian.net/browse/EQP-12');
    await env.shot('next-jira-drawer.png');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#jiraItem', { state: 'hidden', timeout: 5000 }).catch(() => {});
    T.check('Escape closes it', !(await page.isVisible('#jiraItem')));
    await page.click('#jiraGrid .nx-jira-row[data-key="EQP-12"]');
    await page.waitForSelector('#jiraItem', { state: 'visible', timeout: 10000 }).catch(() => {});
    T.check('…and the same item opens again', await page.isVisible('#jiraItem'));
    await page.locator('#jiraDrawer button[aria-label^="Close"]').first().click();
    await page.waitForSelector('#jiraItem', { state: 'hidden', timeout: 5000 }).catch(() => {});
    T.check('its Close (×) closes it too', !(await page.isVisible('#jiraItem')));

    T.section('a preset, export');
    await page.click('#jiraPresets .nx-chip[data-value="bugs"]');
    await page.waitForFunction(() => /EQP-99/.test((document.querySelector('#jiraGrid') || {}).innerText || ''), null, { timeout: 15000 });
    T.check('Bugs: its JQL asked, shown in the box', searches[searches.length - 1].jql.includes('issuetype = Bug') && (await page.inputValue('#jiraJql')).includes('issuetype = Bug'));
    await page.click('#jiraExport');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.nx-menu-item[data-format="csv"]')]);
    const file = path.join(dir, dl.suggestedFilename());
    await dl.saveAs(file);
    T.check('a CSV of the items with what was found', /^equiprite-jira-stories-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()) && fs.readFileSync(file, 'utf8').includes('EQP-99'));
    await page.click('#jiraPresets .nx-chip[data-value="stories"]');
    await page.waitForFunction(() => /EQP-12/.test((document.querySelector('#jiraGrid') || {}).innerText || ''), null, { timeout: 15000 });
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');

    T.section('Redwood: Oracle\'s header with Smart Search, and Oracle\'s table');
    await env.setLook('redwood');
    await page.waitForSelector('#jiraRwHead:not([hidden]) oj-sp-general-overview-page', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('#jiraRwTable .oj-table-body-row').length === 5, null, { timeout: 20000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#jiraRwSearch .oj-sp-filter-chip-container')).filter((x) => x.innerText.trim()).length === 7, null, { timeout: 15000 }).catch(() => {});
    await settle(page, 800);
    T.eq('Oracle\'s templates, upgraded', [await complete(page, '#jiraRwHead', ['oj-sp-general-overview-page', 'oj-sp-smart-search']), await complete(page, '.nx-jira-rw', ['oj-table'])].join(' '),
      'oj-sp-general-overview-page:true oj-sp-smart-search:true oj-table:true');
    T.eq('the filters are the table\'s columns', (await texts(page, '#jiraRwSearch .oj-sp-filter-chip-container')).join(','), 'Status,Epic,Assignee,Release,Sprint,Priority,Type');
    T.check('the table: key, summary and epic, status as Oracle\'s badge', ((await texts(page, '#jiraRwTable .oj-table-body-row'))[0] || '').includes('EQP-12')
      && (await page.$$eval('#jiraRwTable .oj-badge', (b) => b.length)) === 5);
    await page.click('#jiraRwSearch .oj-sp-filter-chip-container:has-text("Status")');
    await page.waitForSelector('text=DEVELOPMENT (2)', { timeout: 10000 }).catch(() => {});
    await page.click('text=DEVELOPMENT (2)').catch(() => {});
    await page.click('#jiraRwHead h1').catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('#jiraRwTable .oj-table-body-row').length === 2, null, { timeout: 15000 }).catch(() => {});
    T.eq('a Smart Search filter narrows the table', (await page.$$('#jiraRwTable .oj-table-body-row')).length, 2);
    await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTop = 0; });
    await env.shot('next-jira-redwood.png');
    await page.click('#jiraRwTable .oj-table-body-row >> nth=0');
    await page.waitForSelector('#jiraItem', { state: 'visible', timeout: 10000 }).catch(() => {});
    T.check('a row opens the drawer', await page.isVisible('#jiraItem'));
    await page.keyboard.press('Escape');
    T.eq('no browser errors in Redwood', errs().join(' | ').slice(0, 1500), '');
    await env.setLook('current');
    await page.waitForSelector('#jiraGrid', { timeout: 20000 });

    T.section('Disconnect');
    await page.click('#jiraDisconnect');
    await page.waitForSelector('#jiraConn', { timeout: 10000 });
    T.check('forgotten on this PC; Connect again', !jiraStore.settings().connected && await page.isVisible('#jiraEmail'));
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
  }
  T.report();
})();
