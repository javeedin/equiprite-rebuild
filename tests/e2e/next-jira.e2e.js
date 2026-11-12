'use strict';
/*
 * EquipRite Next, Jira stories (flows/insights jira-page; rules resources/js/jiraBacklog.js), in a real browser against a
 * fake Jira: Connect in the desktop app (the token goes to the desktop app, which adds it to the jira backend's calls),
 * every page of the search read, the numbers, what they say, a finding opening its items, by status, the breakdowns,
 * the filters, one item in the drawer (criteria, checks, gaps, comments, Open in Jira), Record a test of it (the picker,
 * the bar, a screenshot, Stop: the video and screenshots kept in its folder on this PC), a preset, export, Disconnect;
 * then the Redwood look: Oracle's header with Smart Search (a filter per column) and Oracle's table.
 * Needs `npm run build`. Run: node tests/e2e/next-jira.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const JA = require('../../desktop/lib/jiraAuth');
const TE = require('../../desktop/lib/testEvidence');


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
    labels: ['cianbro'],
    subtasks: [{ key: 'EQP-12-1', fields: { summary: 'Wire the grid to smart search', status: { name: 'DEVELOPMENT', statusCategory: { key: 'indeterminate' } }, assignee: { displayName: 'Sana Suhana Thehaseen' } } },
      { key: 'EQP-12-2', fields: { summary: 'Add the Type column', status: { name: 'Done', statusCategory: { key: 'done' } } } }],
    description: 'Display master list of all equipment records with smart search.Acceptance Criteria: Grid displays all columns per FDD 7.2.4; smart search returns results with type-ahead; all filter fields functional.FDD Section: 7.2Only Smart search is available.',
    comment: { comments: [{ author: { displayName: 'Sana Suhana Thehaseen' }, created: '2026-09-29T04:37:34.383-0500',
      body: '**(FDD-7.2)**\n\n1. Only Class, Subclass search filters are present.\n\n2. Type Column is missing.\n\n3. Map view is missing.\n\n4. Edit option to be added.\n\n!Screenshot 2026-11-04 135139.png|width=227,alt="Screenshot 2026-11-04 135139.png"!' }] },
    attachment: [{ id: 10502, filename: 'Screenshot 2026-11-04 135139.png', mimeType: 'image/png', size: 2400, created: '2026-11-04T13:51:39.000-0600', author: { displayName: 'Sana Suhana Thehaseen' } },
      { id: 10504, filename: 'mapping.xlsx', mimeType: 'application/vnd.ms-excel', size: 12000 }],
    customfield_10020: [{ id: 4, name: '2026-06', state: 'closed', startDate: '2026-06-01T05:00:00.000Z', endDate: '2026-06-30T05:00:00.000Z' },
      { id: 5, name: '2026-07', state: 'active', startDate: '2026-07-01T05:00:00.000Z', endDate: '2026-07-31T05:00:00.000Z' }] }),
  issue('EQP-13', { summary: 'Equipment Master Create/Edit - Section 7.2, 7.2.5G', status: status('DEVELOPMENT', 'indeterminate'), priority: { name: 'High' }, parent: EPIC1,
    fixVersions: [{ name: '27A', releaseDate: days(56) }], assignee: { displayName: 'Rahul Kanth Panganamamula' }, duedate: days(20), labels: ['cianbro', 'oceaneering'],
    description: 'Create and edit equipment.\n\nAcceptance Criteria: created; unique name; FA asset; fields save; one-to-many types; saved and read; LOV filter.\n\nFDD Section: 7.2, 7.2.5G',
    customfield_10020: [{ id: 9, name: 'Sprint now', state: 'active', startDate: days(-4) + 'T05:00:00.000Z', endDate: days(9) + 'T05:00:00.000Z', goal: 'Equipment master editable' }] }),
  issue('EQP-20', { summary: 'Rate schedule list', status: status('Done', 'done'), parent: EPIC2, fixVersions: [{ name: '26C', releaseDate: days(-36) }], labels: ['oceaneering'],
    assignee: { displayName: 'Aditi Rao' }, duedate: days(-60), description: 'List schedules. Acceptance Criteria: the list shows. FDD Section: 7.3' }),
  issue('EQP-30', { summary: 'Notification engine', status: status('FUNC DESIGN', 'indeterminate'), description: 'Send notifications.', updated: days(-45) + 'T10:00:00.000-0500' }),
  issue('EQP-40', { summary: 'Inspection checklist', status: status('ONHOLD', 'indeterminate'), parent: EPIC1, assignee: { displayName: 'Aditi Rao' },
    fixVersions: [{ name: '27A', releaseDate: days(56) }], duedate: days(10), description: 'Inspect. Acceptance Criteria: a checklist per class. FDD Section: 7.12',
    customfield_10020: [{ id: 7, name: '2026-10 B', state: 'future', startDate: days(-20) + 'T05:00:00.000Z', endDate: days(-5) + 'T05:00:00.000Z' }] }),
];
const BUG = issue('EQP-99', { summary: 'Grid scrolls badly', issuetype: { name: 'Bug' }, status: status('Bugs', 'new'), description: 'It jumps.' });
// A subtask of EQP-12, fetched by key when its row is expanded in the drawer (full detail: description + criteria).
const SUB1 = issue('EQP-12-1', { summary: 'Wire the grid to smart search', issuetype: { name: 'Sub-task' }, status: status('DEVELOPMENT', 'indeterminate'),
  assignee: { displayName: 'Sana Suhana Thehaseen' }, priority: { name: 'High' }, duedate: days(-10),
  description: 'Bind the equipment grid to the smart-search service.\n\nAcceptance Criteria: grid binds to the service; type-ahead returns results; empty state shown.\n\nFDD Section: 7.2' });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let searches = [];
let imageReads = [];
// EQP-12's whole activity, as Jira's issue/{key}/comment, /changelog and /worklog give it (a page at a time)
const SANA = { accountId: 'sana-1', displayName: 'Sana Suhana Thehaseen' };
const RAHUL = { accountId: 'rahul-1', displayName: 'Rahul Kanth Panganamamula' };
const ACTIVITY = { 'EQP-12': {
  comment: [Object.assign({}, ISSUES[0].fields.comment.comments[0], { id: '1', author: SANA }),
    { id: '2', author: RAHUL, created: days(-3) + 'T09:00:00.000-0500', body: '[~accountid:sana-1] the Type column is in, please validate',
      renderedBody: '<p><a class="user-hover" href="https://equiprite.atlassian.net/secure/ViewProfile.jspa?accountId=sana-1">Sana Suhana Thehaseen</a> the Type column is in, please validate</p>' }],
  changelog: [{ author: RAHUL, created: days(-20) + 'T10:00:00.000-0500', items: [{ field: 'status', fromString: 'FUNC DESIGN', toString: 'DEVELOPMENT' }] },
    { author: SANA, created: '2026-11-04T13:51:39.000-0600', items: [{ field: 'Attachment', to: '10502', toString: 'Screenshot 2026-11-04 135139.png' }] }],
  worklog: [{ author: RAHUL, started: days(-15) + 'T09:00:00.000-0500', timeSpent: '4h', timeSpentSeconds: 14400, comment: 'grid wiring' }],
} };
let activityReads = [];

function handle(req, res) {
  // A save that fails, as the technical trace of a recorded test should show it.
  if (req.method === 'POST' && req.path === '/equipmentRequests') return res.json({ error: 'ORA-01400: cannot insert NULL into ("EQP"."REQUESTS"."REQUEST_TYPE")' }, 500);
  if (req.path === '/rest/api/2/myself') {
    return req.auth ? res.json({ accountId: '712020:9b82', displayName: 'Javeed Shaik', emailAddress: 'javeed@equiprite.com' }) : res.json({ errorMessages: ['Unauthorized'] }, 401);
  }
  const act = /^\/rest\/api\/2\/issue\/([A-Z]+-\d+(?:-\d+)?)\/(comment|changelog|worklog)$/.exec(req.path);
  if (act) {
    activityReads.push(act[1] + ' ' + act[2] + '@' + req.query.get('startAt') + (req.query.get('expand') ? '?' + req.query.get('expand') : ''));
    const list = (ACTIVITY[act[1]] || {})[act[2]] || [];
    const st = Number(req.query.get('startAt') || 0), n = Number(req.query.get('maxResults') || 50);
    const listKey = { comment: 'comments', changelog: 'values', worklog: 'worklogs' }[act[2]];
    return res.json({ startAt: st, maxResults: n, total: list.length, isLast: st + n >= list.length, [listKey]: list.slice(st, st + n) });
  }
  const att = /^\/rest\/api\/2\/attachment\/content\/(\d+)$/.exec(req.path);
  if (att) {
    imageReads.push({ id: att[1], redirect: req.query.get('redirect'), signed: !!req.auth });
    return req.auth ? res.bytes(PNG, 'image/png') : res.json({ errorMessages: ['Unauthorized'] }, 401);
  }
  if (req.path === '/rest/api/2/search/jql') {
    // as Jira Cloud answers a call that is not signed in: OK, with nothing it may see
    if (!req.auth) { searches.push({ jql: 'anonymous', token: '', fields: '' }); return res.json({ issues: [], isLast: true }); }
    const jql = req.query.get('jql') || '';
    const token = req.query.get('nextPageToken') || '';
    searches.push({ jql, token, fields: req.query.get('fields') || '' });
    if (/issuetype = Bug/.test(jql)) return res.json({ issues: [BUG], isLast: true });
    const sprint = /sprint = (\d+)/.exec(jql);
    if (sprint) return res.json({ issues: ISSUES.filter((i) => (i.fields.customfield_10020 || []).some((x) => String(x.id) === sprint[1])), isLast: true });
    const keyin = /\bkey\s+in\s*\(([^)]*)\)/i.exec(jql); // Analyze N with AI reads its stories at once
    if (keyin) { const want = keyin[1].split(',').map((k) => k.trim().toUpperCase()); return res.json({ issues: [...ISSUES, BUG, SUB1].filter((i) => want.indexOf(i.key) !== -1), isLast: true }); }
    const keym = /\bkey\s*=\s*([A-Za-z]+-[\w-]+)/.exec(jql); // the drawer fetches a subtask by key when it is expanded
    if (keym) return res.json({ issues: [...ISSUES, BUG, SUB1].filter((i) => i.key === keym[1]), isLast: true });
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
  const fuStore = await require('../../desktop/lib/followups').open({ file: path.join(dir, 'followups.duckdb') });
  // A minutes store with Microsoft 365 already signed in (stub Graph), so the follow-up dialog offers "Send via Microsoft 365".
  const graphSent = [];
  const minutesStore = await require('../../desktop/lib/minutes').open({ file: path.join(dir, 'minutes.duckdb'), graph: {
    status: () => ({ configured: true, signedIn: true, account: 'javeed@rite.digital', tenantId: 't', clientId: 'c', pending: false, userCode: '', verificationUri: '', error: '' }),
    sendMail: async (b) => { graphSent.push(b); return { ok: true }; },
    people: async () => ({ ok: true, available: true, contacts: [{ name: 'Nabil Khan', email: 'nabil.khan@rite.digital' }] }), saveConfig: () => {}, beginSignIn: async () => ({ ok: true }), signOut: () => {},
  } });
  // A shared Ask AI store (for "Analyze with AI") with a stub LLM, pre-set to OpenAI so analysis/chat run.
  const llmCalls = [];
  const llmBodies = []; // what each call sent (the prompt), to see which FDD it carried
  const llmFetch = async (url, init) => {
    llmCalls.push(url);
    llmBodies.push(String((init && init.body) || ''));
    if (/chat\/completions/.test(url)) return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '## Requirement\n- Equipment master list with smart search.\n## Current situation\n- DEVELOPMENT; map view still missing per the comments.\n## What to do next\n- Add the map view and the Edit option.\n## Risks & open questions\n- None noted.\n## Suggested EquipRite page\n- Equipment master — this is the catalog list.' } }] }) };
    return { ok: false, status: 404, text: async () => '{}' };
  };
  const aiStore = await require('../../desktop/lib/aiSql').open({ file: path.join(dir, 'ai.json'), encrypt: enc, decrypt: dec, fetch: llmFetch });
  aiStore.save({ provider: 'openai', key: 'sk-test', model: 'gpt-4o' });
  const evidenceDir = path.join(dir, 'EquipRite Test Evidence');
  const recStore = TE.open({ dir: evidenceDir, reveal: (f) => { revealed.push(f); } });
  const revealed = [];
  // a stand-in Whisper engine (the real one needs ffmpeg + whisper.cpp, or an OpenAI key, on the person's PC).
  // It starts without a model (so "Set up transcription" shows); downloading one makes it ready, as on a real PC.
  const transcribed = [];
  const installed = [];
  let ffmpegReady = false;   // installed via the Install button below
  let modelReady = false;    // downloaded via Download model
  const transcribe = {
    info: () => ({ engines: (ffmpegReady && modelReady) ? ['local'] : [], local: { ready: ffmpegReady && modelReady, ffmpeg: ffmpegReady, whisper: true, models: modelReady ? ['ggml-base.bin'] : [] },
      openai: { ready: false }, platform: 'linux', install: { ffmpeg: 'sudo apt-get install -y ffmpeg', whisper: 'brew install whisper-cpp' }, installable: { ffmpeg: !ffmpegReady, whisper: false }, canDownload: true,
      catalog: [{ name: 'ggml-base.bin', label: 'Base — a good balance (recommended)', mb: 142, have: modelReady }] }),
    install: (what) => { if (what === 'ffmpeg') ffmpegReady = true; installed.push(what); return Promise.resolve({ ok: true, code: 0, output: 'installed ' + what, cmd: 'apt-get install ffmpeg' }); },
    downloadModel: (name) => { modelReady = true; return Promise.resolve({ ok: true, name, size: 142 * 1048576 }); },
    revealModels: () => ({ dir: '/models' }),
    transcribe: (file, opts) => { transcribed.push({ file, opts }); return Promise.resolve({ ok: true, engine: 'local', lang: 'en', model: 'ggml-base.bin',
      segments: [{ start: 0, end: 2.6, text: 'The map does not load on this story.' }, { start: 2.6, end: 5.2, text: 'I click Edit and nothing happens.' }], ms: 20 }); } };
  // The FDD library with two FDDs: v1.6, then v1.7 (the latest). The analysis starts on the latest; v1.6 can be picked.
  const fdd = await E.fddSandbox();
  await fdd.store.upload({ fileName: 'fdd-v16.md', base64: Buffer.from('# 7 Equipment registry\nThe registry.\n## 7.2 Equipment master list\nOLD-V16: the master list without smart search.').toString('base64'), name: 'EquipRite FDD', version: '1.6' });
  await fdd.store.upload({ fileName: 'fdd-v17.md', base64: Buffer.from('# 7 Equipment registry\nThe registry.\n## 7.2 Equipment master list\nNEW-V17: the master list shows every record in a grid with smart search and filters.\n### 7.2.5 Map view\nA map shows where each unit is.\n# 9 Timesheets\nHours.').toString('base64'), name: 'EquipRite FDD', version: '1.7' });
  // saved AI analyses, as the desktop app keeps them on this PC (desktop/lib/analyses.js)
  const analysisStore = require('../../desktop/lib/analyses').open({ file: path.join(dir, 'ai-analyses.json') });
  // the Application pages catalog, on a throwaway copy of the code (a git repository with its own origin)
  const pg = await E.pagesSandbox();
  const WB = 'vbredwoodapp/equipment-foundation/equipment-workbench';
  const env = await E.start({ port: 19760, handle, app: 'next', jiraStore, recStore, transcribe, followupsStore: fuStore, minutesStore, aiStore, fddStore: fdd.store, analysisStore, pagesStore: pg.store, init: E.recorderStub });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('opening Jira stories offers to set up Whisper when it is not installed');
    await env.open('/?open=jira');
    await page.waitForSelector('#eqrSetup', { timeout: 30000 });
    T.check('on the desktop app, with Whisper not set up, the setup helper opens by itself', await page.isVisible('#eqrSetup')
      && (await text(page, '#eqrSetup')).includes('Set up transcription') && await page.isVisible('#eqrSetSkip'));
    await env.shot('next-jira-whisper-prompt.png');
    T.check('ffmpeg is missing, with an Install button (not just a command to copy)', await page.isVisible('#eqrSetup button[data-install="ffmpeg"]'));
    await page.click('#eqrSetup button[data-install="ffmpeg"]');
    await page.waitForSelector('#eqrSetup button[data-install="ffmpeg"]', { state: 'detached', timeout: 10000 });
    T.check('Install runs the OS installer and the check updates in place (ffmpeg now found)', installed.indexOf('ffmpeg') !== -1
      && !(await page.$('#eqrSetup button[data-install="ffmpeg"]')));
    await page.click('#eqrSetClose');
    await page.waitForSelector('#eqrSetup', { state: 'detached', timeout: 5000 }).catch(() => {});
    T.check('it does not block the page: the Connect form is there behind it', await page.isVisible('#jiraConn'));

    T.section('not connected: Connect, in the desktop app');
    await page.waitForSelector('#jiraConn', { timeout: 30000 });
    await settle(page, 600);
    T.eq('its menu item, under Insights', await text(page, '.nx-nav-item--on'), 'Jira stories');
    T.check('the form: site, email, API token (a password box), Connect; and where to make a token', await page.isVisible('#jiraEmail')
      && (await page.getAttribute('#jiraToken', 'type')) === 'password' && (await page.inputValue('#jiraSite')) === 'https://equiprite.atlassian.net'
      && (await text(page, '#jiraConn')).includes('Create an API token'));
    T.check('nothing searched yet, and never "Connected" without a signed-in account', searches.length === 0 && !(await page.$('.nx-jira-conninfo')));
    await page.fill('#jiraEmail', 'javeed@equiprite.com');
    await page.dispatchEvent('#jiraEmail', 'change');
    await page.fill('#jiraToken', 'ATATT-test-token');
    await page.dispatchEvent('#jiraToken', 'change');
    await page.click('#jiraConnect');
    await page.waitForSelector('#jiraTiles', { timeout: 20000 });
    await settle(page, 800);
    T.check('connected: the desktop app keeps the token (the page never shows it again)', jiraStore.settings().connected
      && (await text(page, '.nx-jira-conninfo')).includes('Connected as Javeed Shaik (javeed@equiprite.com)') && !(await page.$('#jiraToken')));
    T.eq('every page of the search read, with the fields the page uses', searches.map((x) => (x.token || '-')).join(','), '-,page-2');
    T.check('…the default search: all stories', searches[0].jql === 'project = EQP AND issuetype = Story ORDER BY key ASC' && searches[0].fields.includes('customfield_10020'));
    T.check('the header says what was read', /EquipRite backlog on equiprite\.atlassian\.net · 5 items read at \d\d:\d\d/.test(await text(page, '#jiraSub')), await text(page, '#jiraSub'));

    T.section('Set up transcription from the page header (desktop app, Whisper not ready)');
    await page.waitForSelector('#jiraSetupTx', { timeout: 10000 });
    T.check('a "Set up transcription" button sits in the header, by Refresh', await page.isVisible('#jiraSetupTx'));
    await page.click('#jiraSetupTx');
    await page.waitForSelector('#eqrSetup', { timeout: 10000 });
    T.check('…it opens the setup helper straight from the page', await page.isVisible('#eqrSetup'));
    await page.click('#eqrSetClose');
    await page.waitForSelector('#eqrSetup', { state: 'detached', timeout: 5000 }).catch(() => {});

    T.section('the numbers and what they say');
    T.eq('the tiles', (await texts(page, '#jiraTiles .nx-jira-tile')).join(' | '),
      '5 Items | 1 Done 20% | 3 In progress | 1 On hold | 1 Overdue | 1 No acceptance criteria | 4 Tester gaps 1 items | 3.5 / 5 Average quality');
    // "What it says" and "By status" are the last two breakdown tabs now
    T.eq('the last two tabs are What it says and By status', (await texts(page, '#jiraTabs .nx-jira-tab')).slice(-2).map((t) => t.replace(/\s*\(\d+\)\s*$/, '')).join(' | '), 'What it says | By status');
    await page.click('#jiraTabs .nx-jira-tab[data-value="findings"]');
    await settle(page, 300);
    const finds = await texts(page, '#jiraFindings .nx-jira-find');
    T.check('the findings: overdue first, the passed release, the missing criteria, the gaps', finds[0] === '1 item is past its due date, most of them in DEVELOPMENT (1).'
      && finds.some((f) => /^Release 26C was due .* and still has 1 item not done\.$/.test(f)) && finds.some((f) => f.includes('no acceptance criteria'))
      && finds.some((f) => f.startsWith('Testers listed 4 gaps')), finds.join(' | '));
    const stillActive = finds.findIndex((f) => f.startsWith('Sprint 2026-07 is still active'));
    T.check('the sprint findings: one still active after its end, the running one\'s progress, a stale future one, the spill-over',
      stillActive !== -1 && (await text(page, '#jiraFindings')).includes('Sprint Sprint now: 0 of 1 done (0%), 9 days left.')
      && (await text(page, '#jiraFindings')).includes('1 future sprint has an end date already past (2026-10 B)') && (await text(page, '#jiraFindings')).includes('1 open item was carried over'));
    await page.click('#jiraFindings .nx-jira-find >> nth=0');
    await settle(page, 500);
    T.eq('a finding opens its items, and says so', [(await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), await text(page, '#jiraShowing')].join(' / '),
      'EQP-12 / 1 item is past its due date, most of them in DEVELOPMENT (1). ×');
    await page.click('#jiraShowing .nx-jira-x');
    await settle(page, 400);
    T.eq('cleared: every item', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head)')).length, 5);
    await page.click('#jiraTabs .nx-jira-tab[data-value="status"]');
    await settle(page, 300);
    T.eq('by status, in the workflow\'s order', (await texts(page, '#jiraStatuses .nx-jira-bar')).join(' | '),
      'FUNC DESIGN 1 · 20% | DEVELOPMENT 2 · 40% | ONHOLD 1 · 20% | Done 1 · 20%');
    await page.click('#jiraTiles .nx-jira-tile[data-key="noAc"]');
    await settle(page, 400);
    T.eq('a tile opens what it counts', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), 'EQP-30');
    await page.click('#jiraShowing .nx-jira-x');

    T.section('the breakdowns');
    await page.click('#jiraTabs .nx-jira-tab[data-value="sprints"]');
    await settle(page, 300);
    T.eq('by sprint first: active, then future, then closed; what is wrong with each', (await texts(page, '#jiraSprints .nx-jira-tr--sprint:not(.nx-jira-tr--head) .nx-jira-sprintname')).join(' | '),
      '2026-07 active Still active, ended 2026-07-31 1 item due after it ends | Sprint now active Goal: Equipment master editable 1 item due after it ends | '
      + '2026-10 B future Future, but its end date (' + days(-5) + ') has passed 1 item due after it ends | No sprint');
    T.check('…its dates and days left, done of total', (await texts(page, '#jiraSprints .nx-jira-tr--sprint[data-value="Sprint now"]'))[0].includes(days(-4) + ' – ' + days(9) + ' · 9 days left'));
    await page.click('#jiraSprints .nx-jira-tr--sprint[data-value="2026-07"] span[role="cell"]:nth-child(2)');
    await settle(page, 400);
    T.eq('a sprint row filters the items below', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), 'EQP-12');
    T.check('…the chosen sprint marked, and said over the items', (await page.getAttribute('#jiraSprints .nx-jira-tr--sprint[data-value="2026-07"]', 'aria-selected')) === 'true'
      && (await text(page, '#jiraShowing')).startsWith('Sprint: 2026-07'));
    T.check('the items show their sprint, and the sprints before it', (await text(page, '#jiraGrid .nx-jira-row[data-key="EQP-12"] .nx-jira-sprintcell')) === '2026-07 after 2026-06'
      && (await texts(page, '#jiraGrid .nx-jira-row--head [role="columnheader"]')).some((h) => /^sprint$/i.test(h)));
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

    T.section('by customer (the story labels)');
    await page.click('#jiraTabs .nx-jira-tab[data-value="customers"]');
    await settle(page, 400);
    T.eq('by customer, most open first, No label last', (await texts(page, '#jiraTabBody .nx-jira-tr--rel:not(.nx-jira-tr--head)')).map((t) => t.split(' ')[0]).join(','), 'cianbro,oceaneering,No');
    await env.shot('next-jira-by-customer.png');
    await page.click('#jiraTabBody .nx-jira-tr--rel[data-value="cianbro"]');
    await settle(page, 400);
    T.eq('a customer row filters the items, and says so', [(await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), (await text(page, '#jiraShowing')).replace(' ×', '')].join(' / '),
      'EQP-12,EQP-13 / Customer: cianbro');
    T.check('the items carry a Customer column with the labels', (await texts(page, '#jiraGrid .nx-jira-row--head [role="columnheader"]')).some((h) => /^customer$/i.test(h))
      && (await text(page, '#jiraGrid .nx-jira-row[data-key="EQP-13"] .nx-jira-custcell')).includes('oceaneering'));
    await page.click('#jiraShowing .nx-jira-x');
    await settle(page, 300);

    T.section('a sprint\'s name: its report in a tab of its own');
    await page.click('#jiraTabs .nx-jira-tab[data-value="sprints"]');
    await page.waitForSelector('#jiraSprints', { timeout: 10000 });
    T.check('sprint names are links (No sprint is not)', (await page.$$eval('#jiraSprints .nx-jira-sprintlink', (b) => b.map((x) => x.textContent.trim()))).join() === '2026-07,Sprint now,2026-10 B');
    await page.click('#jiraSprints .nx-jira-sprintlink[data-name="2026-07"]');
    await page.waitForFunction(() => /Sprint 2026-07/.test((document.querySelector('#jspTitle') || {}).textContent || ''), null, { timeout: 20000 });
    await page.waitForSelector('#jspTiles', { timeout: 20000 });
    await settle(page, 600);
    T.check('a new tab, named for the sprint', (await page.$$eval('[role="tab"]', (t) => t.map((x) => x.textContent))).some((t) => t.includes('Sprint 2026-07')));
    T.check('…it asked Jira for everything ever in the sprint', searches.some((x) => x.jql === 'project = EQP AND sprint = 5 ORDER BY status ASC, key ASC'));
    T.eq('its header: state, dates, how long ago it ended', await text(page, '#jspSub'), 'Active · 2026-07-01 – 2026-07-31 · Ended ' + Math.round((Date.parse(today) - Date.parse('2026-07-31')) / 86400000) + ' days ago');
    T.check('what is wrong with it', (await text(page, '#jspFlags')).includes('Still active, ended 2026-07-31: close it in Jira and move what is open to the next sprint.'));
    T.eq('its numbers', (await texts(page, '#jspTiles .nx-jira-tile')).join(' | '),
      '1 Items 31 days long | 0 Done 0% | 1 Open | 1 Overdue | 0 Carried on to a later sprint | 1 Came in from an earlier sprint | 0 Nobody assigned open items');
    T.check('the three breakdowns stand side by side: By status, By customer, By person (no burn-up, no "What it says")',
      (await page.$$('.nx-jira-three > .nx-card')).length === 3 && (await page.$('#jspStatuses')) !== null && (await page.$('#jspCustomers')) !== null
      && (await page.$('#jspPeople')) !== null && (await page.$('#jspBurn')) === null && (await page.$('#jspFindings')) === null);
    T.check('its items, each with where it stands, the key opening it in Jira', (await text(page, '#jspGrid .nx-jsp-row[data-key="EQP-12"]')).includes('Still in this sprint')
      && (await page.getAttribute('#jspGrid .nx-jsp-row[data-key="EQP-12"] a', 'href')) === 'https://equiprite.atlassian.net/browse/EQP-12');
    T.check('the latest comment shows under the summary (who last commented), full comment on hover', (await page.$('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jira-lastc')) !== null
      && /Sana Suhana Thehaseen/.test(await text(page, '#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jira-lastc'))
      && /Type Column is missing/.test(await page.getAttribute('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jira-lastc', 'title')));
    T.eq('Open in Jira: the sprint\'s items in Jira', await page.getAttribute('#jspOpenJira', 'href'), 'https://equiprite.atlassian.net/issues/?jql=' + encodeURIComponent('project = EQP AND sprint = 5 ORDER BY status ASC, key ASC'));
    await env.shot('next-jira-sprint.png');
    T.check('beside each key, an icon that opens it in Jira (a new tab)', (await page.getAttribute('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jsp-tojira', 'target')) === '_blank'
      && (await page.getAttribute('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jsp-tojira', 'aria-label')) === 'Open EQP-12 in Jira');

    T.section('Items table: Sprint column, a filter box on every column, sort on the Key (story number)');
    T.check('the table leads with a Sprint column (header + each row names its sprint)',
      (await page.$('#jspGrid .nx-jira-row--head [data-col="sprint"]')) !== null
      && (await page.$('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jsp-sprintc')) !== null
      && /2026-07/.test(await text(page, '#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jsp-sprintc')));
    T.check('every column has its own filter box', (await page.$$('#jspGrid .nx-jsp-filterrow .nx-jsp-filter')).length === 9);
    const dataRows = () => page.$$eval('#jspGrid .nx-jsp-row:not(.nx-jira-row--head):not(.nx-jsp-filterrow)', (r) => r.length);
    await page.fill('#jspGrid .nx-jsp-filterrow input[data-field="key"]', 'ZZZ-999');
    await settle(page, 200);
    T.check('a filter that matches nothing empties the table and shows the hint', (await dataRows()) === 0
      && (await page.$('#jspNoMatch')) !== null);
    await page.fill('#jspGrid .nx-jsp-filterrow input[data-field="key"]', 'EQP-12');
    await settle(page, 200);
    T.check('a matching filter brings the row back, hint gone', (await dataRows()) === 1 && (await page.$('#jspNoMatch')) === null);
    await page.fill('#jspGrid .nx-jsp-filterrow input[data-field="key"]', '');
    await settle(page, 150);
    await page.click('#jspGrid .nx-jira-row--head [data-col="key"]');
    await settle(page, 150);
    T.check('clicking the Key header turns on its sort (ascending by story number)',
      (await page.getAttribute('#jspGrid .nx-jira-row--head [data-col="key"]', 'class')).includes('nx-jsp-sortbtn--on')
      && /▴/.test(await text(page, '#jspGrid .nx-jira-row--head [data-col="key"]')));
    T.check('a "Clear filters" button appears once anything is sorted or filtered', (await page.$('#jspClear')) !== null);
    await page.click('#jspClear');
    await settle(page, 150);
    T.check('Clear filters resets the sort and the boxes, then hides itself', (await page.$('#jspClear')) === null
      && !(await page.getAttribute('#jspGrid .nx-jira-row--head [data-col="key"]', 'class')).includes('nx-jsp-sortbtn--on'));

    T.section('Items table: a Customer column, and the By status / By person / By customer rows filter it');
    T.check('a Customer column shows each item\'s labels', (await page.$('#jspGrid .nx-jira-row--head [data-col="customer"]')) !== null
      && (await text(page, '#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jira-custcell')).includes('cianbro'));
    T.check('an item with subtasks shows a subtask count under its summary', (await page.$('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jira-subcount')) !== null
      && /2 subtasks/.test(await text(page, '#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jira-subcount')));
    await page.click('#jspStatuses .nx-jsp-pickbar[data-value="DEVELOPMENT"]');
    await settle(page, 200);
    T.check('clicking a By status row filters the items by it (row marked, filter set, Clear shown)',
      (await page.getAttribute('#jspStatuses .nx-jsp-pickbar[data-value="DEVELOPMENT"]', 'class')).includes('nx-jsp-pick--on')
      && (await page.inputValue('#jspGrid input[data-field="status"]')) === 'DEVELOPMENT' && (await page.$('#jspClear')) !== null);
    await page.click('#jspPeople .nx-jsp-pickrow[data-value="Rahul Kanth Panganamamula"]');
    await settle(page, 200);
    T.check('clicking a By person row filters the items by assignee', (await page.inputValue('#jspGrid input[data-field="assignee"]')) === 'Rahul Kanth Panganamamula');
    await page.click('#jspCustomers .nx-jsp-pickrow[data-value="cianbro"]');
    await settle(page, 200);
    T.check('clicking a By customer row filters the items by that label', (await page.inputValue('#jspGrid input[data-field="customer"]')) === 'cianbro'
      && (await page.$$('#jspGrid .nx-jsp-row:not(.nx-jira-row--head):not(.nx-jsp-filterrow)')).length === 1);
    await page.click('#jspCustomers .nx-jsp-pickrow[data-value="cianbro"]');
    await settle(page, 200);
    T.check('clicking the same By customer row again clears that filter', (await page.inputValue('#jspGrid input[data-field="customer"]')) === '');
    await page.click('#jspClear');
    await settle(page, 200);

    T.section('Copy to follow-up: tick items, a formatted table lands on the clipboard for an email');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.nextUrl });
    const readClipHtml = () => page.evaluate(async () => {
      try { const items = await navigator.clipboard.read();
        for (const it of items) { if (it.types.includes('text/html')) return await (await it.getType('text/html')).text(); }
      } catch (e) { /* ignore */ }
      return '';
    });
    const sprintItems = (await page.$$('#jspGrid .nx-jsp-row:not(.nx-jira-row--head):not(.nx-jsp-filterrow)')).length;
    T.check('each item has a follow-up checkbox, none ticked', (await page.$$('#jspGrid .nx-jsp-row:not(.nx-jira-row--head):not(.nx-jsp-filterrow) .nx-pick')).length === sprintItems
      && (await page.$$('#jspGrid .nx-pick--on')).length === 0);
    await page.click('#jspGrid .nx-jira-row--head .nx-pick');
    await settle(page, 150);
    T.check('the header checkbox selects all shown', (await page.$$('#jspGrid .nx-jsp-row:not(.nx-jira-row--head):not(.nx-jsp-filterrow) .nx-pick--on')).length === sprintItems && sprintItems >= 1);
    await page.click('#jspGrid .nx-jira-row--head .nx-pick');
    await settle(page, 150);
    T.check('…clicking it again clears them', (await page.$$('#jspGrid .nx-pick--on')).length === 0);
    await page.click('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-pick');
    await settle(page, 150);
    T.check('ticking a row marks it and names the count on the button', (await page.getAttribute('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-pick', 'aria-checked')) === 'true'
      && (await page.$$('#jspGrid .nx-jsp-row--sel')).length === 1 && (await text(page, '#jspFollowup')).includes('Copy 1 to follow-up'));
    await page.click('#jspFollowup');
    await page.waitForSelector('#jspFuModal', { state: 'visible', timeout: 10000 });
    await settle(page, 300);
    T.check('the compose dialog opens with message templates and a greeting that names the assignee',
      (await page.$$('#jspFuModal .nx-fu-tpl')).length >= 6 && (await page.getAttribute('#jspFuPreview', 'srcdoc')).includes('Dear Rahul,'));
    T.check('the preview shows the drafted email: the message and the stories table with the Key linking to Jira',
      (await page.getAttribute('#jspFuPreview', 'srcdoc')).includes('kindly close') && (await page.getAttribute('#jspFuPreview', 'srcdoc')).includes('<table')
      && (await page.getAttribute('#jspFuPreview', 'srcdoc')).includes('href="https://equiprite.atlassian.net/browse/EQP-12"'));
    T.check('the body carries the sprint header: name, state · dates, and the count with a timestamp',
      (await page.getAttribute('#jspFuPreview', 'srcdoc')).includes('Follow-up — Sprint 2026-07')
      && / item(s)? · /.test(await page.getAttribute('#jspFuPreview', 'srcdoc')));
    T.check('a gear beside Open in Outlook jumps to Windows default-apps settings', (await page.$('#jspFuDefault')) !== null);
    T.check('the table leads with a Sprint column and has no "In this sprint" column',
      (await page.getAttribute('#jspFuPreview', 'srcdoc')).includes('>Sprint</th>') && !(await page.getAttribute('#jspFuPreview', 'srcdoc')).includes('In this sprint'));
    await page.click('#jspFuModal .nx-fu-tpl >> text=Status update');
    await settle(page, 200);
    T.check('picking a template rewrites the message, greeting kept', (await page.getAttribute('#jspFuPreview', 'srcdoc')).includes('latest status')
      && (await page.getAttribute('#jspFuPreview', 'srcdoc')).includes('Dear Rahul,'));
    await env.shot('next-jira-sprint-followup.png');
    await page.click('#jspFuCopy');
    await settle(page, 300);
    const sprintFollow = await readClipHtml();
    T.check('Copy for email puts the whole email on the clipboard: greeting, the chosen message, the table, the linked Key',
      sprintFollow.includes('Dear Rahul,') && sprintFollow.includes('latest status') && sprintFollow.includes('<table')
      && sprintFollow.includes('href="https://equiprite.atlassian.net/browse/EQP-12"'), sprintFollow.slice(0, 160));
    await page.click('#jspFuOutlook');
    await settle(page, 300);
    T.check('Open in Outlook closes the dialog (a new mail opens; the table waits on the clipboard)', !(await page.isVisible('#jspFuModal')));
    // Save it to the follow-ups DuckDB on this PC, then confirm it landed in the store (header + line).
    await page.click('#jspFollowup');
    await page.waitForSelector('#jspFuModal', { state: 'visible', timeout: 10000 });
    await page.click('#jspFuSave');
    await page.waitForSelector('#jspFuModal', { state: 'hidden', timeout: 10000 });
    const savedList = await fuStore.list();
    T.check('Save stores the follow-up (header + the ticked story) in DuckDB', savedList.ok && savedList.followups.length === 1
      && savedList.followups[0].title === 'Follow-up — Sprint 2026-07' && savedList.followups[0].itemCount === 1);
    const savedOne = await fuStore.get(savedList.followups[0].id);
    T.check('the stored line is the ticked story, with its sprint and link', savedOne.ok && savedOne.followup.lines.length === 1
      && savedOne.followup.lines[0].storyKey === 'EQP-12' && savedOne.followup.lines[0].url.indexOf('EQP-12') !== -1);
    // Send via Microsoft 365 (M365 signed in via the stub minutes store): the whole email, table included, sent through Graph.
    await page.click('#jspFollowup');
    await page.waitForSelector('#jspFuModal', { state: 'visible', timeout: 10000 });
    T.check('with Microsoft 365 signed in, the dialog offers "Send via Microsoft 365"', await page.isVisible('#jspFuSend'));
    // Contacts autocomplete in To (from the M365 directory), then pick one.
    await page.locator('#jspFuTo input').fill('nab');
    await settle(page, 400);
    T.check('typing a name shows directory contact suggestions', await page.isVisible('#jspFuSugTo .nx-fu-sugitem'));
    await page.click('#jspFuSugTo .nx-fu-sugitem');
    await settle(page, 200);
    T.check('picking a contact adds it to To as a removable chip', (await page.$$('#jspFuTo .nx-fu-chip')).length === 1
      && (await text(page, '#jspFuTo')).includes('nabil.khan@rite.digital'));
    T.check('the typed text is wiped from the To box once the contact becomes a chip', (await page.inputValue('#jspFuTo input')) === '');
    // CC a second recipient by typing an email and pressing Enter (like an email client), then send.
    const ccInput = page.locator('#jspFuCc input');
    await ccInput.fill('rahul@company.com');
    await ccInput.press('Enter');
    await settle(page, 200);
    T.check('typing an email and Enter adds a Cc chip', (await page.$$('#jspFuCc .nx-fu-chip')).length === 1
      && (await text(page, '#jspFuCc')).includes('rahul@company.com'));
    T.check('the typed email is wiped from the Cc box once it becomes a chip', (await page.inputValue('#jspFuCc input')) === '');
    await page.click('#jspFuSend');
    await page.waitForSelector('#jspFuModal', { state: 'hidden', timeout: 10000 });
    T.check('Send via Microsoft 365 sends To + Cc with the whole email (table included) through Graph', graphSent.some((m) =>
      /nabil\.khan@rite\.digital/.test(m.to) && /rahul@company\.com/.test(m.cc || '') && /<table/.test(m.html) && /EQP-12/.test(m.html)),
      JSON.stringify(graphSent[graphSent.length - 1] || {}).slice(0, 180));

    const tabsBefore = page.context().pages().length;
    await page.click('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jsp-keybtn');
    await page.waitForSelector('#jspItem', { state: 'visible', timeout: 10000 });
    await settle(page, 500);
    T.check('the key opens the story in the drawer, here (not Jira)', page.context().pages().length === tabsBefore
      && (await text(page, '#jspDrawer')).includes('EQP-12 Equipment Master List View - Section 7.2') && (await texts(page, '#jspAc li')).length === 3
      && (await texts(page, '#jspItemGaps li')).length === 4, (await text(page, '#jspDrawer')).slice(0, 200));
    T.eq('…its Open in Jira', await page.getAttribute('#jspOpenInJira', 'href'), 'https://equiprite.atlassian.net/browse/EQP-12');
    T.check('…its subtasks, each with its key, status and summary', (await page.$$('#jspSubtasks .nx-jira-sub')).length === 2
      && /EQP-12-1/.test(await text(page, '#jspSubtasks')) && /Wire the grid to smart search/.test(await text(page, '#jspSubtasks')) && /Done/.test(await text(page, '#jspSubtasks')));
    T.check('each subtask has an icon that opens it in Jira (a new tab)', (await page.getAttribute('#jspSubtasks .nx-jira-subjira', 'target')) === '_blank'
      && (await page.getAttribute('#jspSubtasks .nx-jira-subjira', 'href')) === 'https://equiprite.atlassian.net/browse/EQP-12-1');
    await page.locator('#jspSubtasks .nx-jira-subrow').first().click();
    await settle(page, 700);
    T.check('clicking a subtask expands it and loads its details (description + criteria) from Jira',
      (await page.$('#jspSubtasks .nx-jira-subdetail')) !== null && /Bind the equipment grid/.test(await text(page, '#jspSubtasks .nx-jira-subdetail'))
      && (await page.$$('#jspSubtasks .nx-jira-subdetail .nx-jira-list li')).length >= 1);
    await page.locator('#jspSubtasks .nx-jira-subrow').first().click();
    await settle(page, 300);
    T.check('clicking it again collapses the detail', (await page.$('#jspSubtasks .nx-jira-subdetail')) === null);
    await page.waitForFunction(() => { const i = document.querySelector('#jspActivity .nx-jira-act--comment img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => {});
    T.check('…the tester\'s screenshot, its attachments, and its test evidence (Record) as on Jira stories', await page.$eval('#jspActivity .nx-jira-act--comment img', (i) => i.naturalWidth > 0).catch(() => false) && /Work log 1/.test(await text(page, '#jspActTabs'))
      && (await page.$$('#jspAttachments img')).length === 1 && await page.isVisible('#jspRecord'));
    await env.shot('next-jira-sprint-drawer.png');
    T.check('an AI icon beside each key on a sprint\'s tab (faint: not analysed yet)', (await page.$('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-ai-ico--none')) !== null
      && /Analyze EQP-12 with AI/.test(await page.getAttribute('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-ai-ico', 'title')));
    const ticked = (await page.$$('#jspGrid .nx-jsp-row--sel')).length;
    const aiLabel = await text(page, '#jspAnalyze');
    T.check('Analyze with AI on a sprint\'s tab follows the ticks (none: waits; one: that story; more: "Analyze N with AI")',
      (await page.isDisabled('#jspAnalyze')) === (ticked === 0) && (ticked > 1 ? aiLabel.indexOf('Analyze ' + ticked + ' with AI') !== -1 : /Analyze with AI$/.test(aiLabel)), ticked + ' ' + aiLabel);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#jspItem', { state: 'hidden', timeout: 5000 }).catch(() => {});
    T.check('Escape closes it', !(await page.isVisible('#jspItem')));
    await page.click('#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jsp-sumbtn');
    await page.waitForSelector('#jspItem', { state: 'visible', timeout: 10000 }).catch(() => {});
    T.check('the summary opens it too', await page.isVisible('#jspItem'));
    await page.locator('#jspDrawer button[aria-label^="Close"]').first().click();
    await page.waitForSelector('#jspItem', { state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.locator('[role="tab"]', { hasText: 'Jira stories' }).first().click();
    await page.waitForSelector('#jiraGrid', { state: 'visible', timeout: 10000 });
    await settle(page, 400);
    T.eq('…and back on Jira stories, the items are that sprint\'s', (await texts(page, '#jiraGrid .nx-jira-row:not(.nx-jira-row--head) .nx-jira-key')).join(','), 'EQP-12');
    await page.click('#jiraFollowup');
    await page.waitForSelector('#jiraFuModal', { state: 'visible', timeout: 10000 });
    await settle(page, 300);
    T.check('Jira stories: the compose dialog opens with templates and a drafted message',
      (await page.$$('#jiraFuModal .nx-fu-tpl')).length >= 6 && (await page.getAttribute('#jiraFuPreview', 'srcdoc')).includes('Dear '));
    await page.click('#jiraFuCopy');
    await settle(page, 300);
    const storiesFollow = await readClipHtml();
    T.check('Copy for email: the message, the items as a table with a Customer column and the Key linking to Jira',
      storiesFollow.includes('Dear ') && storiesFollow.includes('>Customer</th>')
      && storiesFollow.includes('href="https://equiprite.atlassian.net/browse/EQP-12"'), storiesFollow.slice(0, 160));
    await page.click('#jiraFuCancel');
    await page.waitForSelector('#jiraFuModal', { state: 'hidden', timeout: 10000 });
    await settle(page, 200);
    await page.click('#jiraShowing .nx-jira-x');
    await settle(page, 300);

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
    T.check('its subtasks, each with key, status and summary', (await page.$$('#jiraSubtasks .nx-jira-sub')).length === 2
      && /EQP-12-2/.test(await text(page, '#jiraSubtasks')) && /Add the Type column/.test(await text(page, '#jiraSubtasks')));
    await page.locator('#jiraSubtasks .nx-jira-subrow').first().click();
    await settle(page, 700);
    T.check('a subtask expands inline with its fetched details, and an icon opens it in Jira',
      (await page.$('#jiraSubtasks .nx-jira-subdetail')) !== null && /Bind the equipment grid/.test(await text(page, '#jiraSubtasks .nx-jira-subdetail'))
      && (await page.getAttribute('#jiraSubtasks .nx-jira-subjira', 'href')) === 'https://equiprite.atlassian.net/browse/EQP-12-1');
    await page.locator('#jiraSubtasks .nx-jira-subrow').first().click();
    await settle(page, 300);
    T.eq('Open in Jira', await page.getAttribute('#jiraOpenInJira', 'href'), 'https://equiprite.atlassian.net/browse/EQP-12');
    await page.waitForFunction(() => /Work log 1/.test((document.getElementById('jiraActTabs') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    const tabs = await text(page, '#jiraActTabs');
    T.check('its whole activity is read from Jira: every comment, change and work log entry', /All 5/.test(tabs) && /Comments 2/.test(tabs) && /History 2/.test(tabs) && /Work log 1/.test(tabs)
      && ['comment', 'changelog', 'worklog'].every((k) => activityReads.some((r) => r.indexOf('EQP-12 ' + k + '@0') === 0)) && activityReads.some((r) => /comment@0\?renderedBody/.test(r)), tabs + ' | ' + activityReads.join(' '));
    const actAll = await text(page, '#jiraActivity');
    T.check('All, newest first: the latest comment (the mention named, not [~accountid:...]) above the older entries', actAll.indexOf('@Sana Suhana Thehaseen the Type column is in') !== -1
      && !actAll.includes('accountid') && actAll.indexOf('the Type column is in') < actAll.indexOf('Only Class, Subclass'), actAll.slice(0, 300));
    T.check('a change: who moved it, from -> to; the screenshot added shows in the history', /changed Status/.test(actAll) && /FUNC DESIGN\s*→\s*DEVELOPMENT/.test(actAll) && /added Screenshot 2026-11-04 135139\.png/.test(actAll), actAll);
    T.check('a work log entry: who, how long, what for', /logged 4h/.test(actAll) && /grid wiring/.test(actAll));
    await page.waitForFunction(() => { const i = document.querySelector('#jiraActivity .nx-jira-act--comment img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => {});
    T.check('the screenshot in the tester\'s comment shows, read through the signed-in connection (redirect=false)', await page.$eval('#jiraActivity .nx-jira-act--comment img',
      (i) => i.complete && i.naturalWidth > 0 && i.alt === 'Screenshot 2026-11-04 135139.png' && i.src.startsWith('blob:')).catch(() => false)
      && imageReads.some((x) => x.id === '10502' && x.redirect === 'false' && x.signed), JSON.stringify(imageReads));
    T.check('...the comment\'s text without the image markup', !actAll.includes('!Screenshot'));
    await page.$eval('#jiraActHead', (el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
    await settle(page, 300);
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'equiprite-e2e', 'next-jira-activity.png') });
    await page.click('#jiraActTabs [data-tab="history"]');
    await settle(page, 200);
    T.check('the History tab shows only the changes', (await page.$$('#jiraActivity .nx-jira-act--history')).length === 2 && (await page.$$('#jiraActivity .nx-jira-act--comment')).length === 0);
    await page.click('#jiraActTabs [data-tab="worklog"]');
    await settle(page, 200);
    T.check('the Work log tab: the entry and the total', (await page.$$('#jiraActivity .nx-jira-act--worklog')).length === 1 && /Logged in all: 4h/.test(await text(page, '#jiraActivity')));
    await page.click('#jiraActTabs [data-tab="all"]');
    T.check('the attachments: the image as a thumbnail, the other file by name and size, to open', (await page.$$('#jiraAttachments img')).length === 1
      && /mapping\.xlsx\s*12 KB/.test(await text(page, '#jiraFiles')) && (await page.$$('#jiraFiles .nx-jira-filebtn')).length === 1, await text(page, '#jiraFiles'));
    const readsBefore = imageReads.length;
    const [fileDl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }).catch(() => null), page.click('#jiraFiles .nx-jira-filebtn')]);
    T.check('a file that is not an image is read through the connection and saved under its name', !!fileDl && fileDl.suggestedFilename() === 'mapping.xlsx' && imageReads.slice(readsBefore).some((x) => x.id === '10504' && x.signed), (fileDl ? fileDl.suggestedFilename() : 'no download') + ' ' + JSON.stringify(imageReads.slice(readsBefore)));
    await env.shot('next-jira-drawer.png');

    T.section('Application pages on the story: assign the VB page (its technical sheet built once)');
    await page.waitForSelector('#jiraPagesNone', { timeout: 10000 }).catch(() => {});
    T.check('none mapped yet; Assign page offered', await page.isVisible('#jiraPagesNone') && !(await page.isDisabled('#jiraAssignPage')));
    await page.click('#jiraAssignPage');
    await page.waitForSelector('#jiraPagePicker', { timeout: 10000 });
    T.check('the picker lists the pages from git', (await page.$$('#jiraPageList .nx-sp-choice')).length >= 50);
    await page.fill('#jiraPageQ', 'manager workbench');
    await page.dispatchEvent('#jiraPageQ', 'input');
    await settle(page, 300);
    T.check('…and finds one by its words', /Equipment Manager Workbench/.test(await text(page, '#jiraPageList')) && (await page.$$('#jiraPageList .nx-sp-choice')).length <= 6, await text(page, '#jiraPageList'));
    await page.click('#jiraPageList .nx-sp-choice[data-id="' + WB + '"]');
    await page.waitForSelector('#jiraPages .nx-sp-row[data-id="' + WB + '"]', { timeout: 20000 }).catch(() => {});
    await settle(page, 300);
    T.check('assigned: the page shows on the story with its counts (its sheet was built), saved in git with EQP-12 in its page table',
      /Equipment Manager Workbench/.test(await text(page, '#jiraPages')) && /\d+ REST · \d+ chains/.test(await text(page, '#jiraPages .nx-sp-row'))
      && pg.store.forStory('EQP-12').map((x) => x.id).join() === WB && pg.gitRemote('log', '-1', '--format=%s', 'pages/test') === 'Application pages: map EQP-12 to ' + WB, await text(page, '#jiraPages'));

    T.section('Record a test of it: the screen, screenshots, kept in its folder on this PC');
    await page.waitForSelector('#jiraRecord', { timeout: 10000 });
    T.check('Test evidence: Record, Screenshot, Open folder; nothing recorded yet', await page.isVisible('#jiraShot') && await page.isVisible('#jiraEvFolder')
      && (await text(page, '#jiraEvidence')).includes('Nothing recorded for this story yet'));
    await page.click('#jiraRecord');
    await page.waitForSelector('#eqrRecPicker', { timeout: 10000 });
    T.eq('the picker: screens first, then windows; the screen chosen; minimise EquipRite ticked', [(await texts(page, '#eqrRecPicker .eqr-rec-src')).join(' | '),
      await page.getAttribute('#eqrRecPicker .eqr-rec-src[aria-pressed="true"]', 'data-id'), await page.isChecked('#eqrRecMinimize')].join(' / '),
    'Screen · Entire screen | Fusion - Oracle Applications / screen:1:0 / true');
    T.check('…and the technical trace ticked (web service calls, JSON, errors)', await page.isChecked('#eqrRecTrace'));
    T.check('…and "Record my voice" ticked, for a transcript later', await page.isVisible('#eqrRecMic') && await page.isChecked('#eqrRecMic'));
    await env.shot('next-jira-record-picker.png');
    await page.click('#eqrRecPicker .eqr-rec-src[data-id="window:42:0"]');
    await page.click('#eqrRecGo');
    await page.waitForSelector('#eqrRecBar', { timeout: 10000 });
    await page.waitForSelector('#jiraRecStop', { timeout: 10000 });
    T.eq('recording the window chosen; the shortcuts on; EquipRite minimised', (await page.evaluate(() => window.__rec)).join(', '), 'use window:42:0, state true, window minimize');
    T.check('the bar: the time, Screenshot, Stop, the shortcuts; the panel says Stop recording', (await text(page, '#eqrRecBar')).includes('EQP-12')
      && (await text(page, '#eqrRecBar')).includes('Ctrl+Alt+S · Ctrl+Alt+X') && !(await page.$('#jiraRecord')));
    // the app at work while it records: a list read, then a save the server refuses
    await page.evaluate(async () => {
      await fetch('/__backend/eqpt/equipment?limit=5');
      await fetch('/__backend/eqpt/equipmentRequests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestNumber: 'R-9', requestType: null }) });
    });
    await page.waitForFunction(() => /2 calls · ⚠ 1 failed/.test((document.querySelector('#eqrRecCalls') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.eq('the bar counts the calls as they happen, and the failure', await text(page, '#eqrRecCalls'), '2 calls · ⚠ 1 failed');
    await page.waitForFunction(() => /00:0[2-9]/.test((document.querySelector('#eqrRecTime') || {}).textContent || ''), null, { timeout: 10000 });
    await page.click('#eqrRecShot');
    await page.waitForFunction(() => /Screenshot 1 saved/.test((document.querySelector('#eqrRecBar') || {}).textContent || ''), null, { timeout: 10000 });
    await page.evaluate(() => window.__recKey('shot'));
    await page.waitForFunction(() => /Screenshot 2 saved/.test((document.querySelector('#eqrRecBar') || {}).textContent || ''), null, { timeout: 10000 });
    T.check('a screenshot from the bar, and one from the shortcut (from any app)', true);
    await page.waitForTimeout(3500);
    const folder = path.join(evidenceDir, 'EQP-12');
    const writing = fs.readdirSync(folder).find((f) => / recording\.(webm|mp4)$/.test(f));
    T.check('the video goes to this PC as it is made (every 3 seconds), not held in memory', !!writing && fs.statSync(path.join(folder, writing)).size > 0, String(writing));
    await env.shot('next-jira-recording.png');
    await page.click('#eqrRecStop');
    await page.waitForSelector('#eqrRecBar', { state: 'detached', timeout: 15000 });
    await page.waitForSelector('#jiraEvidence video', { timeout: 10000 });
    await settle(page, 600);
    T.eq('stopped: shortcuts off, EquipRite back', (await page.evaluate(() => window.__rec)).slice(3).join(', '), 'state false, window restore');
    const files = fs.readdirSync(folder).sort();
    T.check('in the story\'s folder: the recording, its technical trace and the two screenshots', files.length === 4 && files.filter((f) => / screenshot( \(2\))?\.png$/.test(f)).length === 2
      && files.some((f) => / recording\.(webm|mp4)$/.test(f)) && files.some((f) => / recording\.trace\.jsonl$/.test(f)), files.join(' | '));
    T.check('…the screenshots are pictures of the screen', files.filter((f) => f.endsWith('.png')).every((f) => fs.readFileSync(path.join(folder, f)).subarray(1, 4).toString() === 'PNG'));
    T.check('the panel lists them: the recording to play, the screenshots as thumbnails, where they are kept', (await page.$$('#jiraEvidence video')).length === 1
      && (await page.$$('#jiraEvidence .nx-jira-img img')).length === 2 && (await text(page, '#jiraEvidence')).includes('Kept in ' + folder)
      && /Recording · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · \d+ KB/.test(await text(page, '#jiraEvidence')), await text(page, '#jiraEvidence'));
    await page.waitForFunction(() => { const v = document.querySelector('#jiraEvidence video'); return v && v.readyState >= 1; }, null, { timeout: 10000 }).catch(() => {});
    T.check('…the recording plays (from this PC, through the desktop app)', await page.$eval('#jiraEvidence video', (v) => v.readyState >= 1 && v.src.includes('/__rec/file/EQP-12/')));
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#jiraEvidence .nx-jira-img img')).every((i) => i.complete && i.naturalWidth === 640), null, { timeout: 10000 }).catch(() => {});
    T.check('…the screenshots show', await page.$$eval('#jiraEvidence .nx-jira-img img', (im) => im.length === 2 && im.every((i) => i.complete && i.naturalWidth === 640)));
    await page.click('#jiraEvFolder');
    await page.waitForFunction(() => true);
    await settle(page, 300);
    T.eq('Open folder: the story\'s folder, in the file manager', revealed.join(), folder);
    await page.click('#jiraShot');
    await page.waitForSelector('#eqrRecPicker', { timeout: 10000 });
    T.check('Screenshot alone: the picker, without Minimise', await page.isVisible('#eqrRecGo') && !(await page.$('#eqrRecMinimize')));
    await page.click('#eqrRecGo');
    await page.waitForFunction(() => document.querySelectorAll('#jiraEvidence .nx-jira-img img').length === 3, null, { timeout: 10000 }).catch(() => {});
    T.check('…saved and listed, the screen let go', (await page.$$('#jiraEvidence .nx-jira-img img')).length === 3 && fs.readdirSync(folder).length === 5);
    await env.shot('next-jira-evidence.png');

    T.section('the recording\'s technical trace: what happened underneath, in step with the video');
    T.check('under the recording: its trace, where it broke, in red', /^🔍 Technical trace · 2 calls · 1 failed · broke at 00:0\d$/.test(await text(page, '#jiraEvidence .nx-jira-tracebtn'))
      && (await page.getAttribute('#jiraEvidence .nx-jira-tracebtn', 'class')).includes('nx-jira-tracebtn--bad'), await text(page, '#jiraEvidence .nx-jira-tracebtn'));
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.nextUrl });
    await page.click('#jiraEvidence .nx-jira-tracebtn');
    await page.waitForSelector('#eqrTrace', { timeout: 10000 });
    T.check('the viewer: the video beside the timeline, what it holds', await page.isVisible('#eqrTrVideo') && (await text(page, '#eqrTrSum')).startsWith('2 web service calls · 1 failed')
      && (await text(page, '#eqrTrSum')).includes('2 screenshots'), await text(page, '#eqrTrSum'));
    T.eq('the timeline, in order: the list read, the save, the two screenshots taken while recording', (await page.$$eval('#eqrTrList .eqr-tr-row', (r) => r.map((x) => x.getAttribute('data-kind')))).join(),
      'call,call,shot,shot');
    T.check('…each call: its moment, method, service and path, status, time', /^00:0\d GET eqpt \/equipment\?limit=5 200 \d+ ms$/.test((await texts(page, '#eqrTrList .eqr-tr-row'))[0]),
      (await texts(page, '#eqrTrList .eqr-tr-row'))[0]);
    T.check('where it broke, said at the top', /^⚠ Where it broke · 00:0\d · POST eqpt \/equipmentRequests → 500$/.test(await text(page, '#eqrTrBroke')), await text(page, '#eqrTrBroke'));
    await page.waitForFunction(() => document.querySelector('#eqrTrVideo').readyState >= 1, null, { timeout: 10000 }).catch(() => {});
    await page.click('#eqrTrBroke');
    await settle(page, 400);
    T.check('…it opens the failed call: the URL, the JSON sent, the server\'s answer', (await text(page, '#eqrTrDHead')).startsWith('POST http://127.0.0.1:')
      && (await text(page, '#eqrTrDHead')).includes('/equipmentRequests → 500') && (await text(page, '#eqrTrDetail')).includes('"requestNumber": "R-9"')
      && (await text(page, '#eqrTrAnswer')).includes('ORA-01400'), await text(page, '#eqrTrDetail'));
    T.check('…and the video moves to that moment', await page.$eval('#eqrTrVideo', (v) => v.currentTime > 0 || v.duration === Infinity));
    T.check('…the failed call shows its login: none was sent (that is the bug), no password in the trace', (await text(page, '#eqrTrAuth')).includes('Login sent: none')
      && !(await text(page, '#eqrTrDetail')).includes('ATATT'));
    await page.click('.eqr-tr-chip[data-filter="failed"]');
    T.eq('Failed: only the failed call', (await page.$$eval('#eqrTrList .eqr-tr-row', (r) => r.filter((x) => !x.hidden).length)), 1);
    await page.click('.eqr-tr-chip[data-filter="all"]');

    T.section('the APIs the test used, grouped (what web services and endpoints ran)');
    await page.click('#eqrTrApisBtn');
    await page.waitForSelector('#eqrTrApiList:not([hidden])', { timeout: 10000 });
    T.eq('one row per service + method + endpoint, ids collapsed', (await texts(page, '#eqrTrApiList .eqr-tr-apiep')).join(' | '), 'eqpt /equipmentRequests | eqpt /equipment');
    T.check('…each says how often, the statuses and the login used (no secret)', /^1 call · 1 failed · 500 · no login · up to \d+ ms$/.test((await texts(page, '#eqrTrApiList .eqr-tr-apimeta'))[0])
      && !(await text(page, '#eqrTrApiList')).includes('ATATT'), (await texts(page, '#eqrTrApiList .eqr-tr-apimeta'))[0]);
    await page.fill('#eqrTrSearch', 'equipment');
    T.check('find narrows the APIs too', (await page.$$eval('#eqrTrApiList .eqr-tr-apirow', (r) => r.filter((x) => !x.hidden).length)) >= 1);
    await page.fill('#eqrTrSearch', '');
    await env.shot('next-jira-trace-apis.png');
    await page.click('#eqrTrApiList .eqr-tr-apirow >> nth=1');
    await page.waitForSelector('#eqrTrApiList[hidden]', { timeout: 10000 }).catch(() => {});
    T.check('an API row opens its first call on the timeline', await page.isVisible('#eqrTrList') && (await text(page, '#eqrTrDHead')).includes('/equipment'));
    await page.fill('#eqrTrSearch', 'limit=5');
    T.eq('find: in URLs and JSON', (await page.$$eval('#eqrTrList .eqr-tr-row', (r) => r.filter((x) => !x.hidden).map((x) => x.getAttribute('data-kind')))).join(), 'call');
    await page.fill('#eqrTrSearch', '');
    T.check('the HAR file, to download', (await page.getAttribute('#eqrTrHar', 'href')).startsWith('/__rec/har/EQP-12/'));
    const [harDl] = await Promise.all([page.waitForEvent('download'), page.click('#eqrTrHar')]);
    const harFile = path.join(dir, harDl.suggestedFilename());
    await harDl.saveAs(harFile);
    T.check('…opens in Chrome DevTools (HAR 1.2, the two calls)', /^EQP-12 .* recording\.har$/.test(harDl.suggestedFilename()) && JSON.parse(fs.readFileSync(harFile, 'utf8')).log.entries.length === 2);
    await page.click('#eqrTrCopy');
    await page.waitForFunction(() => /Copied/.test((document.querySelector('#eqrTrCopy') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const report = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    T.check('Copy bug report: what failed, what was sent and answered, ready for Jira', report.startsWith('Tested EQP-12') && report.includes('What failed')
      && report.includes('POST http://127.0.0.1:') && report.includes('ORA-01400') && report.includes('Calls: 2 (1 failed)'), report.slice(0, 300));
    await page.click('#eqrTrBroke');
    await env.shot('next-jira-trace.png');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#eqrTrace', { state: 'detached', timeout: 5000 }).catch(() => {});
    T.check('Escape closes the trace, not the story', !(await page.$('#eqrTrace')) && await page.isVisible('#jiraItem'));

    T.section('the recording\'s voice, turned to text with Whisper');
    T.check('the microphone was recorded with the screen (Record my voice)', (await page.evaluate(() => window.__micCalls || 0)) >= 1);

    T.section('set up transcription from the panel when Whisper is not ready');
    await page.waitForSelector('#jiraTxSetup', { timeout: 10000 });
    T.check('no engine yet: a "Set up transcription" button, and no Transcribe button', await page.isVisible('#jiraTxSetup')
      && !(await page.$('#jiraEvidence .nx-jira-txbtn[data-act="transcribe"]')));
    await page.click('#jiraTxSetup');
    await page.waitForSelector('#eqrSetup', { timeout: 10000 });
    T.check('the setup helper: ffmpeg and whisper found, no model yet, a model to download', (await text(page, '#eqrSetup')).includes('ffmpeg')
      && (await text(page, '#eqrSetup')).includes('whisper.cpp') && await page.isVisible('#eqrSetDownload') && (await text(page, '#eqrSetup')).includes('Not ready yet'));
    await env.shot('next-jira-transcribe-setup.png');
    await page.click('#eqrSetDownload');
    await page.waitForFunction(() => /Ready to transcribe/.test((document.querySelector('#eqrSetup') || {}).textContent || ''), null, { timeout: 10000 });
    T.check('downloading a model makes it ready, in place', (await text(page, '#eqrSetup')).includes('Ready to transcribe'));
    await page.click('#eqrSetClose');
    await page.waitForSelector('#eqrSetup', { state: 'detached', timeout: 5000 }).catch(() => {});
    await page.waitForSelector('#jiraEvidence .nx-jira-txbtn[data-act="transcribe"]', { timeout: 10000 });
    T.check('back on the panel: now "Transcribe the voice" appears, and the setup button is gone', await page.isVisible('#jiraEvidence .nx-jira-txbtn[data-act="transcribe"]')
      && !(await page.$('#jiraTxSetup')));
    await page.click('#jiraEvidence .nx-jira-txbtn[data-act="transcribe"]');
    await page.waitForSelector('#jiraEvidence .nx-jira-txbtn[data-act="transcript"]', { timeout: 10000 });
    T.check('Whisper ran on the recording, and the button becomes Transcript · N lines', transcribed.length === 1 && /recording\.(webm|mp4)$/.test(transcribed[0].file)
      && /Transcript · 2 lines/.test(await text(page, '#jiraEvidence .nx-jira-txbtn[data-act="transcript"]')), await text(page, '#jiraEvidence .nx-jira-txbtn[data-act="transcript"]'));
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: env.nextUrl });
    await page.click('#jiraEvidence .nx-jira-txbtn[data-act="transcript"]');
    await page.waitForSelector('#eqrTx', { timeout: 10000 });
    T.check('the viewer: the video beside the words', await page.isVisible('#eqrTxVideo') && (await texts(page, '#eqrTxList .eqr-tx-text')).join(' ') === 'The map does not load on this story. I click Edit and nothing happens.');
    await page.waitForFunction(() => document.querySelector('#eqrTxVideo').readyState >= 1, null, { timeout: 10000 }).catch(() => {});
    await page.click('#eqrTxList .eqr-tx-row >> nth=1');
    await settle(page, 300);
    T.check('a line seeks the video to that moment', await page.$eval('#eqrTxVideo', (v) => v.currentTime >= 2.5 || v.duration === Infinity));
    await page.fill('#eqrTxSearch', 'edit');
    T.eq('find narrows the lines', (await page.$$eval('#eqrTxList .eqr-tx-row', (r) => r.filter((x) => !x.hidden).length)), 1);
    await page.fill('#eqrTxSearch', '');
    await env.shot('next-jira-transcript.png');
    await page.click('#eqrTxCopy');
    await page.waitForFunction(() => /Copied/.test((document.querySelector('#eqrTxCopy') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const transcript = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    T.check('Copy transcript: the words, ready to paste', transcript.includes('The map does not load') && transcript.includes('I click Edit'));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#eqrTx', { state: 'detached', timeout: 5000 }).catch(() => {});
    T.check('Escape closes the transcript, not the story', !(await page.$('#eqrTx')) && await page.isVisible('#jiraItem'));
    T.eq('no browser errors while recording', errs().join(' | ').slice(0, 1500), '');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#jiraItem', { state: 'hidden', timeout: 5000 }).catch(() => {});
    T.check('Escape closes it', !(await page.isVisible('#jiraItem')));
    await page.click('#jiraGrid .nx-jira-row[data-key="EQP-12"]');
    await page.waitForSelector('#jiraItem', { state: 'visible', timeout: 10000 }).catch(() => {});
    T.check('…and the same item opens again', await page.isVisible('#jiraItem'));
    await page.locator('#jiraDrawer button[aria-label^="Close"]').first().click();
    await page.waitForSelector('#jiraItem', { state: 'hidden', timeout: 5000 }).catch(() => {});
    T.check('its Close (×) closes it too', !(await page.isVisible('#jiraItem')));

    T.section('a story with a recording: an icon after its summary');
    const mark = '#jiraGrid .nx-jira-row[data-key="EQP-12"] .nx-jira-recmark';
    await page.waitForSelector(mark, { timeout: 10000 }).catch(() => {});
    T.check('in the list: the icon, red (its trace caught a failure), saying what there is', await page.isVisible(mark) && (await page.getAttribute(mark, 'class')).includes('nx-jira-recmark--bad')
      && /^1 recording · 3 screenshots · the trace caught 1 failure · latest \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(await page.getAttribute(mark, 'title')), await page.getAttribute(mark, 'title').catch(() => 'no icon'));
    T.check('…only on stories that have one', (await page.$$('#jiraGrid .nx-jira-recmark')).length === 1);
    await page.locator('[role="tab"]', { hasText: 'Sprint 2026-07' }).first().click();
    const sprintMark = '#jspGrid .nx-jsp-row[data-key="EQP-12"] .nx-jira-recmark';
    await page.waitForSelector(sprintMark, { state: 'visible', timeout: 10000 }).catch(() => {});
    T.check('on the sprint\'s tab too, after the summary', await page.isVisible(sprintMark) && (await page.getAttribute(sprintMark, 'title')).endsWith(': open the story'));
    await env.shot('next-jira-sprint-recmark.png');
    await page.click(sprintMark);
    await page.waitForSelector('#jspItem', { state: 'visible', timeout: 10000 }).catch(() => {});
    await page.waitForSelector('#jspEvidence video', { timeout: 10000 }).catch(() => {});
    T.check('…it opens the story, with its recording', await page.isVisible('#jspItem') && (await page.$$('#jspEvidence video')).length === 1,
      (await page.isVisible('#jspItem')) + ' ' + (await text(page, '#jspEvidence')).slice(0, 200));
    await page.locator('#jspDrawer button[aria-label^="Close"]').first().click();
    await page.waitForSelector('#jspItem', { state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.locator('[role="tab"]', { hasText: 'Jira stories' }).first().click();
    await page.waitForSelector('#jiraGrid', { state: 'visible', timeout: 10000 });

    T.section('delete a recording from the panel');
    await page.click('#jiraGrid .nx-jira-row[data-key="EQP-12"]');
    await page.waitForSelector('#jiraEvidence .nx-jira-evvid .nx-jira-delbtn', { timeout: 10000 });
    T.check('a Delete button sits under the recording', await page.isVisible('#jiraEvidence .nx-jira-evvid .nx-jira-delbtn'));
    page.once('dialog', (d) => d.accept());          // the "Delete …?" confirm
    await page.click('#jiraEvidence .nx-jira-evvid .nx-jira-delbtn');
    await page.waitForFunction(() => document.querySelectorAll('#jiraEvidence video').length === 0, null, { timeout: 10000 }).catch(() => {});
    T.check('the recording is gone from the panel, and off this PC (with its trace and transcript)', (await page.$$('#jiraEvidence video')).length === 0
      && !fs.readdirSync(folder).some((f) => / recording\.(webm|mp4)$/.test(f)) && !fs.readdirSync(folder).some((f) => /\.trace\.jsonl$|\.transcript\.json$/.test(f)), fs.readdirSync(folder).join(' | '));
    await page.locator('#jiraDrawer button[aria-label^="Close"]').first().click();
    await page.waitForSelector('#jiraItem', { state: 'hidden', timeout: 5000 }).catch(() => {});

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
    T.check('the table has a Sprint column', (await texts(page, '#jiraRwTable .oj-table-column-header-text')).includes('Sprint'));
    T.check('Oracle\'s table shows the recording icon too', (await page.$$('#jiraRwTable .nx-jira-recmark')).length === 1);
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

    T.section('Analyze with AI: a new tab with the story, an AI analysis and a chatbot');
    await page.click('#jiraAnalyze');
    await page.waitForSelector('#anStory', { timeout: 20000 });
    await settle(page, 700);
    T.check('the analysis tab shows the story, its sub-tasks and comments',
      /EQP-12/.test(await text(page, '#anStory')) && /Equipment Master List View/.test(await text(page, '#anStory'))
      && /EQP-12-2/.test(await text(page, '#anSubs')) && /missing/i.test(await text(page, '#anActivity')));
    await page.waitForFunction(() => /Work log 1/.test((document.getElementById('anActTabs') || {}).textContent || ''), null, { timeout: 15000 }).catch(() => {});
    T.check('...its whole activity (comments, history, work log) and its attachments', /All 5/.test(await text(page, '#anActTabs')) && /logged 4h/.test(await text(page, '#anActivity'))
      && (await page.$$('#anAttachments img')).length === 1 && /mapping\.xlsx/.test(await text(page, '#anFiles')), await text(page, '#anActTabs'));
    await page.waitForFunction(() => { const f = document.getElementById('anAnalysis'); return f && /What to do next/.test(f.getAttribute('srcdoc') || ''); }, null, { timeout: 20000 }).catch(() => {});
    const anDoc = (await page.getAttribute('#anAnalysis', 'srcdoc')) || '';
    T.check('the AI analysis is broken into the fixed headings and suggests the page, via the shared Ask AI',
      /Requirement/.test(anDoc) && /What to do next/.test(anDoc) && /Suggested EquipRite page/.test(anDoc) && /Equipment master/i.test(anDoc) && llmCalls.some((u) => /chat\/completions/.test(u)));

    T.section('Analyze with AI reads the FDD: the latest first, the sections the story names, another FDD on demand');
    const lastPrompt = () => llmBodies[llmBodies.length - 1] || '';
    T.check('the FDD picker shows the latest FDD', /EquipRite FDD · v1\.7 \(latest\)/.test(await text(page, '#anFddName')), await text(page, '#anFddBar'));
    const firstPrompt = llmBodies.filter((b) => /## Requirement/.test(b))[0] || '';
    T.check('the AI was given the mapped page\'s technical sheet (its chains and REST calls) and told to name them',
      /EQUIPRITE PAGES MAPPED TO THIS/.test(firstPrompt) && /PAGE Equipment Manager Workbench \(Old EquipRite/.test(firstPrompt) && /GET \/equiprite\/v1\/views\/workbench-requests/.test(firstPrompt)
      && /name the chains and endpoints/.test(firstPrompt), firstPrompt.slice(0, 200));
    T.check('the analysis tab lists the story\'s application page', /Equipment Manager Workbench/.test(await text(page, '#anPages')));
    T.check('the AI was given the whole activity: the history, the work log, the attachments, the mention named',
      /History \(2 changes, oldest first\)/.test(firstPrompt) && /Status FUNC DESIGN → DEVELOPMENT/.test(firstPrompt) && /logged 4h: grid wiring/.test(firstPrompt)
      && /Attachments \(2\)/.test(firstPrompt) && /@Sana Suhana Thehaseen the Type column/.test(firstPrompt), firstPrompt.slice(0, 300));
    T.check('the AI was given the latest FDD\'s section 7.2 (the story\'s "FDD Section: 7.2"), with its subsection, and asked for an FDD check',
      /NEW-V17/.test(lastPrompt()) && /FDD 7\.2\.5 Map view/.test(lastPrompt()) && /## FDD check/.test(lastPrompt()) && !/OLD-V16/.test(lastPrompt()), lastPrompt().slice(0, 300));
    T.check('the chips say what was read: 7.2 named by the story, 7.2.5 a part of it',
      /7\.2 Equipment master list/.test(await text(page, '#anFddRead')) && /7\.2\.5 Map view/.test(await text(page, '#anFddRead')));
    await page.click('#anFddRead .nx-an-fddchip >> nth=0');
    await page.waitForSelector('#anFddView', { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => { const b = document.getElementById('anFddBar'); if (b) b.scrollIntoView({ block: 'start' }); });
    await settle(page, 300);
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'equiprite-e2e', 'next-jira-analysis-fdd.png') });
    T.check('a chip opens the section\'s text, and why it was read', /NEW-V17: the master list shows every record/.test(await text(page, '#anFddView')) && /named by the story/.test(await text(page, '#anFddView')));
    await page.evaluate(() => { const i = document.getElementById('anChatInput'); i.value = 'what should I test first?'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('anChatSend').click(); });
    await page.waitForFunction(() => { const f = document.getElementById('anChat'); return f && /class="b a"/.test(f.getAttribute('srcdoc') || ''); }, null, { timeout: 20000 }).catch(() => {});
    const chDoc = (await page.getAttribute('#anChat', 'srcdoc')) || '';
    T.check('the chatbot answers a follow-up question, grounded in the story', /what should I test first/i.test(chDoc) && chDoc.indexOf('class="b a"') !== -1, 'chatDoc=' + chDoc.slice(0, 200) + ' | llm=' + llmCalls.length);
    T.check('…and in the FDD: the chat turn carried the FDD excerpts for the question', /FDD excerpts from \\"EquipRite FDD · v1\.7\\" for this question/.test(lastPrompt()) && /NEW-V17/.test(lastPrompt()), lastPrompt().slice(0, 200));
    await env.shot('next-jira-analysis.png');
    const calls = llmBodies.length;
    await page.click('#anFddBtn');
    await page.waitForSelector('#anFddMenu', { timeout: 10000 });
    T.check('the menu lists every FDD (latest first), "No FDD", and the FDD library', /v1\.7 \(latest\)[\s\S]*v1\.6[\s\S]*No FDD[\s\S]*FDD library/.test(await text(page, '#anFddMenu')), await text(page, '#anFddMenu'));
    await page.click('#anFddMenu .nx-an-fddopt:has-text("v1.6")');
    await page.waitForFunction((n) => !document.getElementById('anBusy') && /v1\.6/.test((document.getElementById('anFddName') || {}).textContent || ''), calls, { timeout: 20000 }).catch(() => {});
    await settle(page, 400);
    T.check('the analysis says which FDD it read', /against EquipRite FDD · v1\.6/.test(await text(page, '#anBy')), await text(page, '#anBy'));
    T.check('picking v1.6 re-runs the analysis on v1.6', llmBodies.length === calls + 1 && /OLD-V16/.test(lastPrompt()) && !/NEW-V17/.test(lastPrompt()) && /v1\.6/.test(await text(page, '#anFddName')), llmBodies.length + ' ' + lastPrompt().slice(0, 200));
    await page.click('#anFddBtn');
    await page.click('#anFddMenu .nx-an-fddopt--none');
    await page.waitForFunction(() => /No FDD/.test((document.getElementById('anFddName') || {}).textContent || '') && !document.getElementById('anBusy'), null, { timeout: 20000 }).catch(() => {});
    await settle(page, 400);
    T.check('"No FDD" re-runs it on the story alone: no excerpts, no FDD check, no chips', llmBodies.length === calls + 2 && !/FDD excerpts/.test(lastPrompt()) && !/## FDD check/.test(lastPrompt()) && !(await page.$('#anFddRead')));
    await page.click('#anPages .nx-sp-row[data-id="' + WB + '"] [data-act="open"]');
    await page.waitForFunction(() => /Equipment Manager Workbench/.test((document.getElementById('pgSheetTitle') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    T.check('"Technical sheet" opens Application pages on that page, with the story mapped on it', /Equipment Manager Workbench/.test(await text(page, '#pgSheetTitle')) && /EQP-12/.test(await text(page, '#pgMap'))
      && (await page.$$eval('[role="tab"]', (t) => t.map((x) => x.textContent))).some((t) => t.includes('Application pages')));
    await page.locator('[role="tab"]').filter({ hasText: 'AI · EQP-12' }).first().click().catch(() => {});
    // back to the Jira stories tab for the remaining steps
    await page.locator('[role="tab"]').filter({ hasText: 'Jira' }).first().click().catch(() => {});
    await page.waitForSelector('#jiraGrid', { timeout: 20000 }).catch(() => {});

    await page.keyboard.press('Escape');
    T.eq('no browser errors in Redwood', errs().join(' | ').slice(0, 1500), '');
    await env.setLook('current');
    await page.waitForSelector('#jiraGrid', { timeout: 20000 });

    T.section('Saved analyses: the list marks them, the tab opens on the last run, Re-run asks again');
    // several Analyze tabs live in the page: read the one that is showing
    const vis = (sel, attr) => page.evaluate(([q, at]) => { const all = Array.prototype.slice.call(document.querySelectorAll(q)); const e = all.filter((x) => x.offsetParent !== null)[0] || all[0];
      return e ? (at ? e.getAttribute(at) || '' : e.textContent.replace(/\s+/g, ' ').trim()) : ''; }, [sel, attr || '']);
    const saved = async (key, after) => { for (let i = 0; i < 40; i++) { const g = analysisStore.get(key); if (g.ok && (!after || g.item.at > after)) return g.item; await settle(page, 250); } return null; };
    await page.waitForSelector('#jiraGrid .nx-jira-row[data-key="EQP-12"] .nx-ai-ico--done', { timeout: 10000 }).catch(() => {});
    T.check('the list marks the analysed story with a filled AI icon (when it ran, on hover); the others stay faint',
      (await page.$('#jiraGrid .nx-jira-row[data-key="EQP-12"] .nx-ai-ico--done')) !== null && /last run/.test(await page.getAttribute('#jiraGrid .nx-jira-row[data-key="EQP-12"] .nx-ai-ico', 'title'))
      && (await page.$('#jiraGrid .nx-jira-row[data-key="EQP-13"] .nx-ai-ico--none')) !== null && !!analysisStore.get('EQP-12').ok);
    await page.click('.nx-tab[data-tab-id="jira-analysis:EQP-12"] .nx-tab-close').catch(() => {});
    await settle(page, 400);
    await page.locator('[role="tab"]').filter({ hasText: 'Jira stories' }).first().click().catch(() => {});
    await page.waitForSelector('#jiraGrid', { timeout: 10000 });
    const llmSaved = llmBodies.length;
    await page.click('#jiraGrid .nx-jira-row[data-key="EQP-12"] .nx-ai-ico');
    await page.waitForSelector('#anLastRun', { timeout: 20000 }).catch(() => {});
    await settle(page, 500);
    T.check('the AI icon opens the analysis without opening the story (no drawer)', !(await page.isVisible('#jiraItem')) && /EQP-12/.test(await vis('#anStory')));
    T.check('…on the last run, saved: no AI call, "Last run … (when) by …", the FDD it read, and the chat kept', llmBodies.length === llmSaved
      && /Last run \d+ \w+ \d{4}, \d\d:\d\d/.test(await text(page, '#anLastRun')) && /What to do next/.test((await page.getAttribute('#anAnalysis', 'srcdoc')) || '')
      && /No FDD/.test(await vis('#anFddName')) && /what should I test first/.test(await vis('#anChat', 'srcdoc')), llmBodies.length + ' vs ' + llmSaved + ' | ' + await vis('#anLastRun'));
    await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTop = 0; });
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'equiprite-e2e', 'next-jira-analysis-saved.png') });
    const before = analysisStore.get('EQP-12').item.at;
    await page.locator('#anReanalyze:visible').click();
    const rerun = await saved('EQP-12', before);
    await page.waitForFunction(() => Array.prototype.some.call(document.querySelectorAll('#anLastRun'), (e) => e.offsetParent !== null && /just now/.test(e.textContent)), null, { timeout: 10000 }).catch(() => {});
    T.check('Re-run asks the AI again and saves it ("just now")', llmBodies.length === llmSaved + 1 && !!rerun && /just now/.test(await vis('#anLastRun')), llmBodies.length + ' ' + await vis('#anLastRun'));
    await page.locator('[role="tab"]').filter({ hasText: 'Jira stories' }).first().click().catch(() => {});
    await page.waitForSelector('#jiraGrid', { timeout: 10000 });
    const llmNew = llmBodies.length;
    await page.click('#jiraGrid .nx-jira-row[data-key="EQP-13"] .nx-ai-ico');
    const first13 = await saved('EQP-13');
    T.check('a story not analysed yet: its AI icon runs the analysis there and then, and saves it', llmBodies.length === llmNew + 1 && !!first13 && /EQP-13/.test(await vis('#anStory')), llmBodies.length + ' vs ' + llmNew);
    await page.locator('[role="tab"]').filter({ hasText: 'Jira stories' }).first().click().catch(() => {});
    await page.waitForSelector('#jiraGrid .nx-jira-row[data-key="EQP-13"] .nx-ai-ico--done', { timeout: 10000 }).catch(() => {});
    T.check('…and the list marks it at once', (await page.$('#jiraGrid .nx-jira-row[data-key="EQP-13"] .nx-ai-ico--done')) !== null);
    await page.$eval('#jiraGrid', (g) => g.scrollIntoView({ block: 'start' })).catch(() => {});
    await settle(page, 300);
    await page.screenshot({ path: require('path').join(require('os').tmpdir(), 'equiprite-e2e', 'next-jira-ai-icons.png') });

    T.section('Analyze several stories with AI: the stories shown, together, in a new tab');
    const setLabel = await text(page, '#jiraAnalyzeSet');
    const nShown = Number((/Analyze (\d+) with AI/.exec(setLabel) || [])[1] || 0);
    T.check('the button counts the stories shown', nShown >= 2, setLabel);
    const llmBefore = llmBodies.length;
    await page.click('#jiraAnalyzeSet');
    await page.waitForSelector('#asStories .nx-as-story', { timeout: 30000 }).catch(() => {});
    await page.waitForFunction((n) => document.querySelectorAll('#asStories .nx-as-story').length === n && /Requirement/.test((document.getElementById('asAnalysis') || { getAttribute: () => '' }).getAttribute('srcdoc') || '')
      && !!document.getElementById('asFddRead'), nShown, { timeout: 30000 }).catch(() => {});
    await settle(page, 500);
    T.check('a new tab, "AI · N stories", listing each story with its status and counts', (await page.$$eval('[role="tab"]', (t) => t.map((x) => x.textContent))).some((t) => t.includes(nShown > 2 ? 'AI · ' + nShown + ' stories' : 'AI · EQP-12, EQP-13'))
      && (await page.$$('#asStories .nx-as-story')).length === nShown && /EQP-12[\s\S]*Equipment Master List View/.test(await text(page, '#asStories'))
      && /2 comments · 2 changes · 4h logged · 2 files/.test(await text(page, '#asStories .nx-as-story[data-key="EQP-12"]')), (await text(page, '#asStories')).slice(0, 300));
    T.check('…it read them in one search, and each one\'s whole activity', searches.some((x) => /^key in \(EQP-/.test(x.jql)) && activityReads.filter((r) => / comment@0/.test(r)).length >= nShown);
    const setPrompt = llmBodies.slice(llmBefore).filter((b) => /STORIES \(/.test(b))[0] || '';
    T.check('one AI analysis across them: every story, overview → story by story → overlaps → risks → FDD check → order of work',
      new RegExp('STORIES \\(' + nShown + '\\)').test(setPrompt) && /===== Story 1 of /.test(setPrompt) && /## Overview/.test(setPrompt) && /## Story by story/.test(setPrompt)
      && /## Overlaps & dependencies/.test(setPrompt) && /## FDD check/.test(setPrompt) && /## Suggested order of work/.test(setPrompt), setPrompt.slice(0, 300));
    T.check('…with the FDD sections the stories name (7.2 and its parts, from the latest FDD) and each story\'s history and work log',
      /FDD 7\.2 Equipment master list/.test(setPrompt) && /NEW-V17/.test(setPrompt) && /logged 4h: grid wiring/.test(setPrompt) && /Status FUNC DESIGN → DEVELOPMENT/.test(setPrompt));
    T.check('the analysis shows, with the FDD picker on the latest and the sections read', /What to do next|Requirement/.test((await page.getAttribute('#asAnalysis', 'srcdoc')) || '')
      && /v1\.7 \(latest\)/.test(await text(page, '#asFddName')) && /7\.2 Equipment master list/.test(await text(page, '#asFddRead')));
    await page.click('#asStories .nx-as-story[data-key="EQP-12"] .nx-as-toggle');
    await page.waitForSelector('#asDetail', { timeout: 10000 }).catch(() => {});
    await settle(page, 400);
    T.check('a story opens to its details: description, criteria, sub-tasks, its whole activity and attachments', /Display master list/.test(await text(page, '#asDetail'))
      && /All 5/.test(await text(page, '#asActTabs')) && /logged 4h/.test(await text(page, '#asActivity')) && (await page.$$('#asAttachments img')).length === 1 && /mapping\.xlsx/.test(await text(page, '#asFiles')));
    const chatFrom = llmBodies.length;
    await page.evaluate(() => { const i = document.getElementById('asChatInput'); i.value = 'which story first?'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('asChatSend').click(); });
    await page.waitForFunction(() => { const f = document.getElementById('asChat'); return f && /class="b a"/.test(f.getAttribute('srcdoc') || ''); }, null, { timeout: 20000 }).catch(() => {});
    T.check('the chatbot answers about the set', /which story first/.test((await page.getAttribute('#asChat', 'srcdoc')) || '') && llmBodies.slice(chatFrom).some((b) => /set of EquipRite Jira stories/.test(b) && /which story first/.test(b)), llmBodies.slice(chatFrom).map((b) => b.slice(0, 120)).join(' || '));
    await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTop = 0; });
    await env.shot('next-jira-analysis-set.png');
    const setTab = await page.$eval('.nx-tab[data-tab-id^="jira-analysis-set:"]', (t) => t.getAttribute('data-tab-id')).catch(() => '');
    await page.click('.nx-tab[data-tab-id^="jira-analysis-set:"] .nx-tab-close').catch(() => {});
    await settle(page, 400);
    await page.locator('[role="tab"]').filter({ hasText: 'Jira stories' }).first().click().catch(() => {});
    await page.waitForSelector('#jiraGrid', { timeout: 10000 });
    const llmSet = llmBodies.length;
    await page.click('#jiraAnalyzeSet');
    await page.waitForSelector('#asLastRun', { timeout: 30000 }).catch(() => {});
    await settle(page, 400);
    T.check('the same set again: its saved analysis, with when it ran and its chat — no AI call', !!setTab && llmBodies.length === llmSet && /Last run/.test(await text(page, '#asLastRun'))
      && /which story first/.test((await page.getAttribute('#asChat', 'srcdoc')) || '') && !!analysisStore.get('SET:EQP-12,EQP-13').ok, setTab + ' ' + llmBodies.length + ' vs ' + llmSet);
    await page.click('#asStories .nx-as-story[data-key="EQP-13"] [data-act="alone"]');
    await page.waitForFunction(() => /EQP-13/.test((document.querySelector('#anStory') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    T.check('"Analyze alone" opens that story\'s own analysis', (await page.$$eval('[role="tab"]', (t) => t.map((x) => x.textContent))).some((t) => t.includes('AI · EQP-13')));
    await page.locator('[role="tab"]').filter({ hasText: 'Jira stories' }).first().click().catch(() => {});
    await page.waitForSelector('#jiraGrid', { timeout: 20000 });

    T.section('Disconnect');
    await page.click('#jiraDisconnect');
    await page.waitForSelector('#jiraConn', { timeout: 10000 });
    T.check('forgotten on this PC; Connect again', !jiraStore.settings().connected && await page.isVisible('#jiraEmail'));
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
    fdd.restore();
    pg.restore();
  }
  T.report();
})();
