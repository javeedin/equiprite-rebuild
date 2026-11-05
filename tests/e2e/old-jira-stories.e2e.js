'use strict';
/*
 * Old EquipRite, Jira Stories (Administrator menu, setup/jira-stories), in a real browser against a stand-in Jira
 * (the jira backend's calls arrive at the fake server at Jira's own paths: /rest/api/2/search/jql, /rest/api/2/myself).
 * The fake answers only a call that carries the email and API token Connect Jira saved, as Jira Cloud does.
 *
 *   In the desktop app (Connect Jira, desktop/lib/jiraAuth.js on Old's server):
 *     - not connected (Jira answers 401): the Connect form (site prefilled, email, API token, the link to make one)
 *     - Connect: the desktop app keeps the token and adds it to the calls; the stories load; "Connected as …"
 *     - the subtitle, the KPI tiles and the findings; a finding filters the table ("Showing: …", removable); a quality
 *       check and an FDD section do too
 *     - a row opens the drawer: facts, the acceptance criteria as a list, the checks, the tester's gaps, the comments,
 *       Open in Jira; Escape closes it
 *     - Record a test of the story: the picker, the bar, a screenshot, Stop; the video and screenshot kept in its folder
 *       on this PC and listed on the panel (in VBCS, without the desktop app: said so)
 *     - Export to CSV and to Excel: the rows shown
 *     - a preset reads its JQL; Smart Search's Status filter narrows the table
 *     - Disconnect: not connected again
 *   Deployed in VBCS (no desktop app): a 401 says the administrator sets the backend's Basic authentication.
 *
 * Needs `npm run build`. Run: node tests/e2e/old-jira-stories.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const JiraAuth = require('../../desktop/lib/jiraAuth');
const TestEvidence = require('../../desktop/lib/testEvidence');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const stamp = (n) => day(n) + 'T09:30:00.000-0500';
const EMAIL = 'priya.raman@equiprite.com';
const TOKEN = 'ATATT3x-test-api-token';
const AUTH = 'Basic ' + Buffer.from(EMAIL + ':' + TOKEN).toString('base64');

// ── EQP as Jira sends it (REST v2: descriptions and comments as text) ─────────────────────────────────────────
const status = (name, key) => ({ name, statusCategory: { key } });
const EPIC1 = { key: 'EQP-1', fields: { summary: 'Equipment Registry' } };
const EPIC62 = { key: 'EQP-62', fields: { summary: 'Rate & Pricing' } };
const EPIC70 = { key: 'EQP-70', fields: { summary: 'Equipment Requests' } };
const R26C = { name: '26C', releaseDate: day(-36) };
const R27A = { name: '27A', releaseDate: day(56) };
const RAHUL = { displayName: 'Rahul Kanth Panganamamula' };
const ADITI = { displayName: 'Aditi Rao' };
const PRIYA = { displayName: 'Priya Raman' };
const SANA = { displayName: 'Sana Suhana Thehaseen' };
const story = (key, f) => ({ key, fields: Object.assign({ issuetype: { name: 'Story' }, comment: { comments: [] }, created: stamp(-120) }, f) });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const imageReads = [];
const STORIES = [
  story('EQP-12', {
    summary: 'Equipment Master List View - Section 7.2', status: status('DEVELOPMENT', 'indeterminate'), priority: { name: 'Medium' }, parent: EPIC1,
    fixVersions: [R26C], assignee: RAHUL, duedate: day(-29), customfield_10020: [{ name: '2026-07', state: 'active' }], updated: stamp(-10),
    description: 'Display master list of all equipment records with smart search, advanced filtering (Class, Subclass, Name, Maintenance Asset No., Location, Status, Type), and data grid with all specified columns.'
      + 'Acceptance Criteria: Grid displays all columns per FDD 7.2.4; smart search returns results with type-ahead; all filter fields functional.'
      + 'FDD Section: 7.2Only Smart search is available by two columns, Class and Sub-Class. Advanced Search is not there.',
    comment: { comments: [{ author: SANA, created: stamp(-12),
      body: '**(FDD-7.2)**\n\n1. Only Class, Subclass search filters are present, remaining needs to be added. (FDD-7.2.3)\n\n2. Type Column is missing.\n\n3. Map view is missing.\n\n4. Edit option to be added.\n\n!Screenshot 2026-11-04 135139.png|width=227,alt="Screenshot 2026-11-04 135139.png"!' }] },
    attachment: [{ id: 10502, filename: 'Screenshot 2026-11-04 135139.png', mimeType: 'image/png', size: 2400, created: '2026-11-04T13:51:39.000-0600', author: SANA },
      { id: 10504, filename: 'mapping.xlsx', mimeType: 'application/vnd.ms-excel', size: 12000 }]
  }),
  story('EQP-13', {
    summary: 'Equipment Master Create/Edit - Section 7.2, 7.2.5G', status: status('DEVELOPMENT', 'indeterminate'), priority: { name: 'High' }, parent: EPIC1,
    fixVersions: [R27A], assignee: RAHUL, duedate: day(-5), customfield_10020: [{ name: '2026-10 B', state: 'active' }], updated: stamp(-9),
    description: 'Create new equipment records and edit existing ones.\n\nAcceptance Criteria: Equipment created/edited successfully; unique name validation fires; FA Asset required for Company-Owned type; all fields save correctly; Non-Labor Resource Type and Expenditure Type fields support multiple values per equipment (one-to-many); values saved and retrieved correctly; expenditure types linked to equipment are used to filter LOV on timesheet and post cost pages.\n\nFDD Section: 7.2, 7.2.5G'
  }),
  story('EQP-14', {
    summary: 'Equipment Units List - Section 7.3', status: status('TEST', 'indeterminate'), priority: { name: 'Medium' }, parent: EPIC1,
    fixVersions: [R27A], assignee: ADITI, duedate: day(10), customfield_10020: [{ name: '2026-10 B', state: 'active' }], updated: stamp(-2),
    description: 'List the serialized units of an equipment item with their status and location.\n\nAcceptance Criteria: Units listed per equipment; status and location shown; a unit opens its detail.\n\nFDD Section: 7.3',
    comment: { comments: [{ author: SANA, created: stamp(-3), body: 'Tested on DEV.\n\n1. Location column is empty for transferred units.\n2. Unit detail does not open from the list.' }] }
  }),
  story('EQP-20', {
    summary: 'Rate Schedule List - Section 8.1', status: status('Done', 'done'), priority: { name: 'Low' }, parent: EPIC62, fixVersions: [R26C], assignee: ADITI,
    duedate: day(-60), updated: stamp(-58), resolutiondate: stamp(-58),
    description: 'List every rate schedule.\n\nAcceptance Criteria: Schedules listed with name, currency and dates; search by name.\n\nFDD Section: 8.1'
  }),
  story('EQP-21', {
    summary: 'Rate Schedule Create - Section 8.2', status: status('ONHOLD', 'indeterminate'), priority: { name: 'Medium' }, parent: EPIC62, fixVersions: [R27A],
    assignee: PRIYA, duedate: day(20), updated: stamp(-3),
    description: 'Create a rate schedule with its lines.\n\nAcceptance Criteria: Schedule saved with lines; overlapping dates refused.\n\nFDD Section: 8.2'
  }),
  story('EQP-30', {
    summary: 'Notification engine', status: status('FUNC DESIGN', 'indeterminate'), priority: { name: 'Medium' }, updated: stamp(-40),
    description: 'Send notifications.'
  }),
  story('EQP-31', {
    summary: 'Equipment Request Approval - Section 9.1', status: status('NEW', 'new'), priority: { name: 'High' }, parent: EPIC70, fixVersions: [R27A],
    assignee: RAHUL, duedate: day(30), updated: stamp(-1),
    description: 'Approve or reject a submitted equipment request.\n\nAcceptance Criteria: Approver sees submitted requests; approve and reject with a reason.\n\nFDD Section: 9.1'
  }),
  story('EQP-40', {
    summary: 'Return Inspection Checklist - Section 10.2', status: status('Done', 'done'), priority: { name: 'Medium' }, parent: EPIC70, fixVersions: [R26C],
    assignee: PRIYA, duedate: day(-40), updated: stamp(-41), resolutiondate: stamp(-41),
    description: 'Inspect returned equipment against a checklist.\n\nAcceptance Criteria: Checklist per class; findings recorded.\n\nFDD Section: 10.2'
  }),
];
const BUGS = [{ key: 'EQP-88', fields: { summary: 'Units list crashes on an empty yard', issuetype: { name: 'Bug' }, status: status('Bugs', 'indeterminate'),
  priority: { name: 'Highest' }, parent: EPIC1, assignee: ADITI, duedate: day(3), fixVersions: [R27A], updated: stamp(-1), comment: { comments: [] },
  description: 'Opening the units of an equipment item with no yard shows an error.' } }];

const seen = { jql: [], auth: [] };
let vbcsAuth = false; // env 2: as if the VBCS administrator had set the backend's Basic authentication
function handle(req, res) {
  if (!req.path.startsWith('/rest/api/2/')) return undefined;
  seen.auth.push(req.headers.authorization || '');
  if (!vbcsAuth && req.headers.authorization !== AUTH) {
    return res.json({ errorMessages: ['You are not authenticated. Authentication required to perform this operation.'] }, 401);
  }
  const att = /^\/rest\/api\/2\/attachment\/content\/(\d+)$/.exec(req.path);
  if (att) { imageReads.push({ id: att[1], redirect: req.query.get('redirect') }); return res.bytes(PNG, 'image/png'); }
  if (req.path === '/rest/api/2/myself') return res.json({ accountId: '712020:1', displayName: 'Priya Raman', emailAddress: EMAIL, active: true });
  if (req.path === '/rest/api/2/search/jql') {
    const jql = req.query.get('jql') || '';
    seen.jql.push(jql);
    if (/foo =/.test(jql)) return res.json({ errorMessages: ['Field \'foo\' does not exist or you do not have permission to view it.'] }, 400);
    return res.json({ issues: /issuetype = Bug/.test(jql) ? BUGS : STORIES, isLast: true });
  }
  return res.json({ errorMessages: ['Not found'] }, 404);
}

const settle = (page, ms) => page.waitForTimeout(ms || 400);
const keys = (page) => page.$$eval('#jiraStoriesTable .jira-key', (n) => n.map((x) => x.innerText.trim()));
async function waitKeys(page, n) {
  await page.waitForFunction((c) => document.querySelectorAll('#jiraStoriesTable .jira-key').length === c, n, { timeout: 15000 }).catch(() => {});
  await settle(page, 300);
  return keys(page);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-old-jira-'));
  const store = JiraAuth.open({ file: path.join(dir, 'jira-connection.json') }); // no keychain: the token kept for this run only
  const evidenceDir = path.join(dir, 'EquipRite Test Evidence');
  const env = await E.start({ port: 19750, app: 'old', handle, jiraStore: store, recStore: TestEvidence.open({ dir: evidenceDir, reveal: () => {} }), init: E.recorderStub });
  const { page } = env;
  const errs = () => env.errors.filter((e) => !/Failed to load resource/.test(e));
  try {
    // ════ Not connected, in the desktop app ═══════════════════════════════════════════════════════════════════
    await env.open('/vp/shell/setup/jira-stories');
    await page.waitForSelector('#jiraConnectForm', { timeout: 30000 });
    await settle(page, 600);
    T.section('in the desktop app, not connected: Jira answers 401, the page offers Connect Jira');
    T.eq('Oracle\'s Smart Search page, titled', (await env.text('#jiraStoriesPage h1')), 'Jira Stories');
    T.check('the subtitle says Jira is not connected', (await env.text('#jiraStoriesPage')).includes('EQP · EquipRite on equiprite.atlassian.net · Jira is not connected'));
    T.eq('the site prefilled', await page.inputValue('#jiraSite input'), 'https://equiprite.atlassian.net');
    T.check('email, an API token as a password, Connect, and where to make a token',
      await page.isVisible('#jiraEmail input') && (await page.getAttribute('#jiraToken input', 'type')) === 'password' && await page.isVisible('#jiraConnect')
      && (await page.getAttribute('#jiraTokenLink', 'href')) === 'https://id.atlassian.com/manage-profile/security/api-tokens'
      && (await page.getAttribute('#jiraTokenLink', 'target')) === '_blank' && (await env.text('#jiraTokenLink')) === 'Create an API token');
    T.check('no administrator text in the desktop app, no stories, no analysis', !(await page.$('#jiraNotConnected')) && !(await page.$('#jiraAnalysis'))
      && (await keys(page)).length === 0 && (await env.text('#jiraEmpty')) === 'Connect Jira to read the stories.');
    T.check('…the calls went out without a credential', seen.auth.length > 0 && seen.auth.every((a) => !a));

    // ════ Connect ═════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Connect: the desktop app keeps the token and adds it to the calls; the stories load');
    await page.fill('#jiraEmail input', EMAIL);
    await page.fill('#jiraToken input', TOKEN);
    await page.click('#jiraConnect');
    await page.waitForSelector('#jiraConnected', { timeout: 20000 });
    const all = await waitKeys(page, STORIES.length);
    T.eq('"Connected as" the user Jira names', await env.text('#jiraConnectedText'), 'Connected as Priya Raman');
    T.check('…Disconnect offered (desktop app)', await page.isVisible('#jiraDisconnect'));
    T.check('the saved connection: the email, a token, never sent back to the page', store.settings().connected && store.settings().email === EMAIL
      && !env.calls.some((c) => c.includes(TOKEN)));
    T.check('the calls carry the email and token as Basic authentication', seen.auth[seen.auth.length - 1] === AUTH);
    T.eq('every story, in Jira\'s order', all.join(), STORIES.map((s) => s.key).join());
    T.eq('the default search: All stories', seen.jql[seen.jql.length - 1], 'project = EQP AND issuetype = Story ORDER BY key ASC');
    T.check('…its chip on, its JQL in the box', (await page.getAttribute('#jiraPreset-stories', 'aria-pressed')) === 'true'
      && (await page.inputValue('#jiraJql input')) === 'project = EQP AND issuetype = Story ORDER BY key ASC');
    const sub = await page.evaluate(() => document.querySelector('#jiraStoriesPage').innerText);
    T.check('the subtitle: project, site, how many, when', /EQP · EquipRite on equiprite\.atlassian\.net · 8 items read at \d\d:\d\d/.test(sub), sub.slice(0, 200));

    T.section('the analysis: KPI tiles, the findings, the compact tables');
    const tiles = await page.$$eval('#jiraKpis [data-kpi]', (t) => t.map((x) => x.querySelector('.jira-tile-label').innerText.trim() + '=' + x.querySelector('.jira-tile-value').innerText.trim()));
    T.eq('the tiles', tiles.join(' | '),
      'Items=8 | Done=2 | In progress=4 | On hold=1 | Overdue=2 | No acceptance criteria=1 | Tester gaps=6 | Average quality=' + tiles[7].split('=')[1]);
    T.check('…average quality out of 5', / \/ 5$/.test(tiles[7]));
    const findings = await page.$$eval('#jiraFindings .jira-finding', (f) => f.map((x) => x.className.replace(/.*jira-finding--/, '') + ': ' + x.innerText.trim()));
    T.check('the findings, each in its tone', findings.length >= 6 && findings[0] === 'bad: 2 items are past their due date, most of them in DEVELOPMENT (2).'
      && findings.some((f) => /^bad: Release 26C was due .* still has 1 item not done\.$/.test(f))
      && findings.some((f) => f === 'warn: Testers listed 6 gaps on 2 items: each is unfinished work the status may not show.')
      && findings.some((f) => f === 'warn: 1 open item has nobody assigned.'), findings.join(' | '));
    T.eq('by status, in the workflow\'s order', (await page.$$eval('#jiraByStatus .jira-mini-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()))).join(' | '),
      'NEW 1 | FUNC DESIGN 1 | DEVELOPMENT 2 | TEST 1 | ONHOLD 1 | Done 2');
    T.check('by status: each bar sized by its share', await page.$$eval('#jiraByStatus .jira-bar-fill', (f) => new Set(f.map((x) => Math.round(x.getBoundingClientRect().width))).size > 1));
    T.check('by epic: key, name, open, overdue, done %, gaps', (await env.text('#jiraByEpic')).includes('EQP-1 Equipment Registry 3 2 0% 6'), await env.text('#jiraByEpic'));
    T.check('by release: a passed date marked', /26C .* 1 open of 3 date passed/.test(await env.text('#jiraByRelease')), await env.text('#jiraByRelease'));
    T.check('by assignee: open, overdue', (await env.text('#jiraByPerson')).includes('Rahul Kanth Panganamamula 3 2'), await env.text('#jiraByPerson'));
    T.check('quality checks and FDD sections listed', (await env.text('#jiraChecks')).includes('No acceptance criteria 1') && (await env.text('#jiraFdd')).includes('7.2 2 2'));
    await env.shot('old-jira-stories.png');

    T.section('a finding filters the table, shown as a removable "Showing: …" chip');
    await page.click('#jiraFindings li:first-child .jira-finding');
    T.eq('the overdue items', (await waitKeys(page, 2)).join(), 'EQP-12,EQP-13');
    T.eq('…said over the table', await env.text('#jiraShowing'), 'Showing: 2 items are past their due date, most of them in DEVELOPMENT (2).');
    T.eq('…the count', await env.text('#jiraCount'), 'Showing 2 of 8 items');
    await page.click('#jiraShowingClear');
    T.check('removed: every story again', (await waitKeys(page, 8)).length === 8 && !(await page.$('#jiraShowing')));
    await page.click('#jiraChecks button[data-key="noAc"]');
    T.check('a quality check: the story without criteria', (await waitKeys(page, 1)).join() === 'EQP-30' && (await env.text('#jiraShowing')).startsWith('Showing: Quality check: No acceptance criteria'));
    await page.click('#jiraFdd button[data-section="7.2"]');
    T.check('an FDD section: its stories (7.2 and 7.2.5G)', (await waitKeys(page, 2)).join() === 'EQP-12,EQP-13' && (await env.text('#jiraShowing')) === 'Showing: FDD section 7.2');
    await page.click('#jiraShowingClear');
    await waitKeys(page, 8);
    T.check('by sprint: each sprint with its state, done of total, open', /2026-10 B active .*0 of 2 2/.test(await env.text('#jiraBySprint'))
      && /2026-07 active .*0 of 1 1/.test(await env.text('#jiraBySprint')) && (await env.text('#jiraBySprint')).includes('No sprint'), await env.text('#jiraBySprint'));
    await page.click('#jiraBySprint .jira-sprint-row[data-sprint="2026-10 B"] .jira-muted');
    await settle(page, 800);
    T.check('…the chosen sprint marked; the table has a Sprint column', !!(await page.$('#jiraBySprint .jira-sprint-row--on[data-sprint="2026-10 B"]'))
      && (await page.$$eval('#jiraStoriesTable .oj-table-column-header-text', (h) => h.map((x) => x.textContent.trim()))).includes('Sprint'));
    T.check('a sprint: its stories', (await waitKeys(page, 2)).join() === 'EQP-13,EQP-14' && (await env.text('#jiraShowing')) === 'Showing: Sprint: 2026-10 B', await env.text('#jiraShowing'));
    await page.click('#jiraShowingClear');
    await waitKeys(page, 8);
    T.section('a sprint\'s name: its own page, with in-flow back');
    T.check('sprint names are links (No sprint is not)', (await page.$$eval('#jiraBySprint .jira-sprint-link', (a) => a.map((x) => x.textContent.trim()))).join() === '2026-07,2026-10 B');
    await page.click('#jiraBySprint .jira-sprint-link[data-name="2026-10 B"]');
    await page.waitForSelector('#jspTiles', { timeout: 20000 });
    await settle(page, 800);
    T.check('Sprint 2026-10 B: Oracle\'s header, its numbers and its items', (await env.text('#jspHead')).includes('Sprint 2026-10 B')
      && (await page.$$('#jspTiles .jsp-tile')).length === 7 && (await page.$$('#jspItems .jsp-row--item[data-key]')).length > 0, (await env.text('#jspHead')).slice(0, 200));
    T.check('its bars sized by their share (not all full)', await page.$$eval('#jspStatuses .jsp-fill', (f) => new Set(f.map((x) => Math.round(x.getBoundingClientRect().width))).size > 1));
    await env.shot('old-jira-sprint.png');
    await page.click('#jspHead button[aria-label="Back"]');
    await page.waitForSelector('#jiraBySprint', { timeout: 20000 });
    await settle(page, 600);
    T.check('Back: Jira Stories again', await page.isVisible('#jiraBySprint'));
    await waitKeys(page, 8);

    T.section('the table\'s columns');
    const row12 = await page.$$eval('#jiraStoriesTable tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t.startsWith('EQP-12'))[0] || '');
    T.check('Key, Summary (epic under it), Status, Priority, Assignee, Release, Sprint, Due, Quality, Gaps',
      row12.startsWith('EQP-12 Equipment Master List View - Section 7.2 EQP-1 Equipment Registry DEVELOPMENT Medium Rahul Kanth Panganamamula 26C 2026-07 ' + day(-29) + ' 4 · 2 checks 4'), row12);
    T.check('the overdue due date in red, status as Oracle\'s badge', await page.$eval('#jiraStoriesTable tbody tr:first-child .jira-due', (e) => e.classList.contains('jira-due--late'))
      && await page.$eval('#jiraStoriesTable tbody tr:first-child .oj-badge', (e) => e.innerText.trim() === 'DEVELOPMENT'));
    T.eq('the column headers', (await page.$$eval('#jiraStoriesTable .oj-table-column-header-text', (h) => h.map((x) => x.innerText.trim()))).join(','),
      'Key,Summary,Status,Priority,Assignee,Release,Sprint,Due,Quality,Gaps');

    // ════ The drawer ══════════════════════════════════════════════════════════════════════════════════════════
    T.section('a row opens the story in the drawer');
    await page.click('#jiraStoriesTable tbody tr:first-child .jira-key');
    await page.waitForSelector('#jiraDrawerBody', { state: 'visible', timeout: 10000 });
    await settle(page, 600);
    const drawer = await env.text('#jiraDrawer');
    T.check('titled "<key> <summary>", status · epic under it', drawer.includes('EQP-12 Equipment Master List View - Section 7.2') && drawer.includes('DEVELOPMENT · EQP-1 Equipment Registry'), drawer.slice(0, 200));
    const facts = await page.$$eval('#jiraFacts [data-fact]', (f) => f.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    T.check('facts: assignee, release, sprint, due (overdue), FDD sections', facts.includes('Assignee Rahul Kanth Panganamamula') && facts.includes('Release 26C (' + day(-36) + ')')
      && facts.includes('Sprint 2026-07 (active)') && facts.includes('Due ' + day(-29) + ' (overdue)') && facts.includes('FDD sections 7.2'), facts.join(' | '));
    await page.waitForFunction(() => { const i = document.querySelector('#jiraComments img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => {});
    T.check('the screenshot in the tester\'s comment shows, read through the jira connection (redirect=false)', await page.$eval('#jiraComments img',
      (i) => i.complete && i.naturalWidth > 0 && i.src.startsWith('blob:')).catch(() => false) && imageReads.some((x) => x.id === '10502' && x.redirect === 'false'), JSON.stringify(imageReads));
    T.check('the attachments: the image as a thumbnail, the other file by name and size', (await page.$$('#jiraAttachments img')).length === 1
      && (await env.text('#jiraFiles')).includes('mapping.xlsx · 12 KB'));
    T.check('the description, with the note added after the FDD line', (await env.text('#jiraBody')).startsWith('Display master list') && (await env.text('#jiraBody')).includes('Advanced Search is not there.'));
    T.eq('the acceptance criteria as a list', (await page.$$eval('#jiraAc li', (l) => l.map((x) => x.innerText.trim()))).join(' | '),
      'Grid displays all columns per FDD 7.2.4 | smart search returns results with type-ahead | all filter fields functional.');
    T.eq('the checks it fails', (await page.$$eval('#jiraChecksFailed li', (l) => l.map((x) => x.innerText.trim()))).join(' | '), 'Due after its release date | Its release date has passed');
    T.eq('the tester\'s gaps', (await page.$$eval('#jiraGaps li', (l) => l.map((x) => x.innerText.trim()))).join(' | '),
      'Only Class, Subclass search filters are present, remaining needs to be added. | Type Column is missing. | Map view is missing. | Edit option to be added.');
    T.check('the comments: author, date, text', (await env.text('#jiraComments')).startsWith('Sana Suhana Thehaseen · ' + day(-12)) && (await env.text('#jiraComments')).includes('2. Type Column is missing.'));
    T.check('Open in Jira: the issue, in a new tab', (await page.getAttribute('#jiraOpenInJira', 'href')) === 'https://equiprite.atlassian.net/browse/EQP-12'
      && (await page.getAttribute('#jiraOpenInJira', 'target')) === '_blank' && (await page.getAttribute('#jiraOpenInJira', 'rel')) === 'noopener');
    await env.shot('old-jira-stories-drawer.png');

    T.section('Record a test of the story: kept in its folder on this PC, listed on the panel');
    await page.waitForSelector('#jiraRecord', { timeout: 10000 });
    T.check('Test evidence: Record, Screenshot, Open folder; nothing recorded yet', await page.isVisible('#jiraShot') && await page.isVisible('#jiraEvFolder')
      && (await env.text('#jiraEvidence')).includes('Nothing recorded for this story yet'));
    await page.click('#jiraRecord');
    await page.waitForSelector('#eqrRecPicker', { timeout: 10000 });
    await page.click('#eqrRecGo');
    await page.waitForSelector('#eqrRecBar', { timeout: 10000 });
    await page.waitForSelector('#jiraRecStop', { timeout: 10000 });
    T.eq('recording the screen; the shortcuts on; EquipRite minimised', (await page.evaluate(() => window.__rec)).join(', '), 'use screen:1:0, state true, window minimize');
    await page.waitForFunction(() => /00:0[2-9]/.test((document.querySelector('#eqrRecTime') || {}).textContent || ''), null, { timeout: 10000 });
    await page.click('#eqrRecShot');
    await page.waitForFunction(() => /Screenshot 1 saved/.test((document.querySelector('#eqrRecBar') || {}).textContent || ''), null, { timeout: 10000 });
    await page.waitForTimeout(1500);
    await page.click('#jiraRecStop');
    await page.waitForSelector('#eqrRecBar', { state: 'detached', timeout: 15000 });
    await page.waitForSelector('#jiraEvidence video', { timeout: 10000 });
    await settle(page, 600);
    const folder = path.join(evidenceDir, 'EQP-12');
    const files = fs.existsSync(folder) ? fs.readdirSync(folder).sort() : [];
    T.check('Stop recording on the panel: the recording, its technical trace and the screenshot in the story\'s folder', files.length === 3 && files.some((f) => / recording\.(webm|mp4)$/.test(f))
      && files.some((f) => / recording\.trace\.jsonl$/.test(f))
      && files.some((f) => / screenshot\.png$/.test(f)), files.join(' | '));
    T.check('the panel lists them, and where they are kept', (await page.$$('#jiraEvidence video')).length === 1 && (await page.$$('#jiraEvidence .jira-img img')).length === 1
      && (await env.text('#jiraEvidence')).includes('Kept in ' + folder) && (await page.evaluate(() => window.__rec)).slice(3).join(', ') === 'state false, window restore',
    await env.text('#jiraEvidence'));
    await page.waitForFunction(() => { const v = document.querySelector('#jiraEvidence video'); return v && v.readyState >= 1; }, null, { timeout: 10000 }).catch(() => {});
    T.check('…the recording plays', await page.$eval('#jiraEvidence video', (v) => v.readyState >= 1 && v.src.includes('/__rec/file/EQP-12/')));
    await env.shot('old-jira-stories-evidence.png');
    T.check('under the recording: its technical trace', /Technical trace · 0 calls/.test(await env.text('#jiraEvidence .jira-tracebtn')), await env.text('#jiraEvidence .jira-tracebtn'));
    await page.click('#jiraEvidence .jira-tracebtn');
    await page.waitForSelector('#eqrTrace', { timeout: 10000 });
    T.check('…the viewer, the same as Next\'s: nothing failed, the screenshot on the timeline', (await env.text('#eqrTrOk')).startsWith('Nothing failed')
      && (await page.$$eval('#eqrTrList .eqr-tr-row', (r) => r.map((x) => x.getAttribute('data-kind')))).join() === 'shot');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#eqrTrace', { state: 'detached', timeout: 5000 }).catch(() => {});
    T.check('…Escape closes it, the story stays open', !(await page.$('#eqrTrace')) && await page.isVisible('#jiraDrawerBody'));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#jiraDrawerBody', { state: 'hidden', timeout: 5000 }).catch(() => {});
    T.check('Escape closes it', !(await page.isVisible('#jiraDrawerBody')));
    await page.click('#jiraStoriesTable tbody tr:nth-child(6) .jira-key');
    await page.waitForSelector('#jiraDrawerBody', { state: 'visible', timeout: 10000 });
    await settle(page, 500);
    T.check('a story with nothing written: said so', (await env.text('#jiraDrawer')).includes('EQP-30 Notification engine')
      && (await env.text('#jiraDrawerBody')).includes('None written: the story cannot be tested as written.') && (await env.text('#jiraDrawerBody')).includes('No gaps listed by a tester.')
      && (await page.$$eval('#jiraChecksFailed li', (l) => l.length)) === 6);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#jiraDrawerBody', { state: 'hidden', timeout: 5000 }).catch(() => {});

    // ════ Export ═════════════════════════════════════════════════════════════════════════════════════════════
    T.section('Export to CSV and to Excel: the rows shown');
    const [csvDl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#jiraExportCsv')]);
    const csv = fs.readFileSync(await csvDl.path(), 'utf8');
    T.check('CSV: a header and a row per item, with what the page found', csvDl.suggestedFilename() === 'Jira_Stories_' + day(0) + '.csv'
      && csv.replace(/^\ufeff/, '').startsWith('Key,Summary,Type,Status,Priority,Epic,Epic name,Assignee,Release,Release date,Sprint,Sprint ends,Earlier sprints,Due,Overdue,FDD sections,Quality (1-5),Checks failed,Tester gaps')
      && STORIES.every((s) => csv.includes('\r\n' + s.key + ',')) && csv.includes('Type Column is missing.'), csv.slice(0, 200));
    const [xlsDl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#jiraExportXls')]);
    const xls = fs.readFileSync(await xlsDl.path(), 'utf8');
    T.check('Excel: a table Excel opens', xlsDl.suggestedFilename().endsWith('.xls') && xls.includes('<th') && xls.includes('EQP-40') && xls.includes('Rate &amp; Pricing'));

    // ════ Query: a preset, a JQL of your own ═════════════════════════════════════════════════════════════════
    T.section('a preset reads its JQL; a JQL Jira refuses is said in Jira\'s words');
    await page.click('#jiraPreset-bugs');
    T.eq('Bugs: its issues', (await waitKeys(page, 1)).join(), 'EQP-88');
    T.check('…its JQL sent and in the box, its chip on', seen.jql[seen.jql.length - 1] === 'project = EQP AND issuetype = Bug ORDER BY created DESC'
      && (await page.inputValue('#jiraJql input')) === 'project = EQP AND issuetype = Bug ORDER BY created DESC' && (await page.getAttribute('#jiraPreset-bugs', 'aria-pressed')) === 'true');
    await page.fill('#jiraJql input', 'project = EQP AND foo = bar');
    await page.click('#jiraRun');
    await page.waitForSelector('#jiraProblem', { timeout: 10000 }).catch(() => {});
    T.check('a JQL Jira refuses: Jira\'s words, still connected, no chip on', (await env.text('#jiraProblem')).startsWith('Jira did not accept the search: Field \'foo\' does not exist')
      && await page.isVisible('#jiraConnected') && (await page.$$eval('.jira-chip--on', (c) => c.length)) === 0);
    await page.click('#jiraPreset-stories');
    await waitKeys(page, 8);
    T.check('All stories again', !(await page.$('#jiraProblem')));

    // ════ Smart Search ═══════════════════════════════════════════════════════════════════════════════════════
    T.section('Smart Search: a filter per column, each offering what the stories hold');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#jiraSearch .oj-sp-filter-chip-container')).filter((x) => x.innerText.trim()).length === 7,
      null, { timeout: 15000 }).catch(() => {});
    await settle(page, 500);
    T.eq('the filters', (await page.$$eval('#jiraSearch .oj-sp-filter-chip-container', (b) => b.map((x) => x.innerText.trim()))).join(','),
      'Status,Epic,Assignee,Release,Sprint,Priority,Type');
    await page.click('#jiraSearch .oj-sp-filter-chip-container:has-text("Status")');
    await page.waitForSelector('text=TEST (1)', { timeout: 10000 }).catch(() => {});
    await settle(page, 300);
    const statusOpts = await page.$$eval('[role=option], li', (o) => o.filter((x) => x.offsetParent !== null).map((x) => x.innerText.trim()).filter((t) => /\(\d+\)$/.test(t)));
    T.eq('Status: in the workflow\'s order, with how many', statusOpts.join(', '), 'NEW (1), FUNC DESIGN (1), DEVELOPMENT (2), TEST (1), ONHOLD (1), Done (2)');
    await page.click('text=TEST (1)');
    await settle(page, 600);
    await page.click('#jiraStoriesPage h1'); // Smart Search applies a pick as its list closes
    T.eq('picked: the table narrows to it', (await waitKeys(page, 1)).join(), 'EQP-14');
    T.eq('…and says how many', await env.text('#jiraCount'), 'Showing 1 of 8 items');
    await env.shot('old-jira-stories-filtered.png');

    // ════ Disconnect ═════════════════════════════════════════════════════════════════════════════════════════
    T.section('Disconnect: the email and token removed from this PC; not connected again');
    await page.click('#jiraDisconnect');
    await page.waitForSelector('#jiraConnectForm', { timeout: 15000 });
    T.check('the Connect form again, no stories', !store.settings().connected && (await keys(page)).length === 0 && !(await page.$('#jiraAnalysis')));

    T.section('no browser errors');
    T.eq('none', errs().join('\n'), '');
  } catch (e) {
    T.check('runs without throwing', false, e.stack);
    await env.shot('old-jira-stories-fail.png').catch(() => {});
  } finally {
    await env.close();
  }

  // ════ Deployed in VBCS: no desktop app ═══════════════════════════════════════════════════════════════════════
  const vb = await E.start({ port: 19760, app: 'old', handle });
  try {
    T.section('the menu: Jira Stories in the Administrator group, after Page Access; it opens the page');
    await vb.open('/vp/shell/setup/rbac-admin');
    await settle(vb.page, 1500);
    await vb.page.click('oj-button[title="Menu"]');
    await vb.page.click('[data-group-key="admin"]');
    await vb.page.waitForSelector('#setup-jira-stories', { state: 'visible', timeout: 10000 });
    T.eq('the Administrator items', (await vb.page.$$eval('oj-navigation-list li', (l) => l.filter((x) => x.offsetParent !== null).map((x) => x.innerText.trim()))).join(','),
      'Configuration Settings,Page Access,Jira Stories');
    await vb.page.click('#setup-jira-stories a');
    T.section('deployed in VBCS, not connected: the administrator sets the backend\'s Basic authentication');
    await vb.page.waitForSelector('#jiraNotConnected', { timeout: 30000 });
    await settle(vb.page, 500);
    T.check('…the menu opened it', vb.page.url().endsWith('/vp/shell/setup/jira-stories'), vb.page.url());
    T.eq('what to do, and who does it', await vb.text('#jiraNotConnected'),
      'Jira is not connected. A VBCS administrator sets it: Services > Backends > jira > Authentication > Basic (a Jira email and an Atlassian API token).');
    T.check('no Connect form, no Disconnect, no stories', !(await vb.page.$('#jiraConnectForm')) && !(await vb.page.$('#jiraDisconnect')) && (await keys(vb.page)).length === 0);
    vbcsAuth = true;
    await vb.page.click('#jiraStoriesPage button:has-text("Refresh")');
    await vb.page.waitForSelector('#jiraConnected', { timeout: 15000 });
    T.check('once the administrator has set it: Refresh reads the stories, no Disconnect', (await waitKeys(vb.page, 8)).length === 8 && !(await vb.page.$('#jiraDisconnect'))
      && (await vb.text('#jiraConnectedText')) === 'Connected as Priya Raman');
    await vb.page.click('#jiraStoriesTable tbody tr:first-child .jira-key');
    await vb.page.waitForSelector('#jiraEvidence', { state: 'visible', timeout: 10000 });
    await settle(vb.page, 500);
    T.check('Record, in VBCS: it says recording works in the desktop app (no buttons)', (await vb.text('#jiraEvidence')).includes('Recording a test works in the EquipRite desktop app')
      && !(await vb.page.$('#jiraRecord')));
    await vb.page.keyboard.press('Escape');
    T.eq('no browser errors', vb.errors.filter((e) => !/Failed to load resource/.test(e)).join('\n'), '');
  } catch (e) {
    T.check('VBCS: runs without throwing', false, e.stack);
    await vb.shot('old-jira-stories-vbcs-fail.png').catch(() => {});
  } finally {
    await vb.close();
  }
  T.report();
})();
