'use strict';
/*
 * EquipRite Next · Standup minutes (flows/insights minutes page; store desktop/lib/minutes.js in DuckDB; rules
 * resources/js/minutes.js) in a real browser: the page is available in the desktop app, a new meeting with a header and a
 * line tied to a Jira story (resolved from the backlog read), Save (kept in DuckDB), reopened from the list, tracking by
 * epic / customer with the open action, Format by AI (a stub LLM), the formatted email, and Send to Teams (a stub webhook).
 * Needs `npm run build`. Run: node tests/e2e/next-minutes.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const JA = require('../../desktop/lib/jiraAuth');
const MIN = require('../../desktop/lib/minutes');
const AI = require('../../desktop/lib/aiSql');

const T = H.makeAsserter();
const enc = (t) => Buffer.from('enc:' + Buffer.from(t).toString('base64'));
const dec = (b) => Buffer.from(String(b).replace(/^enc:/, ''), 'base64').toString();

const status = (name, key) => ({ name, statusCategory: { key } });
const EPIC1 = { key: 'EQP-1', fields: { summary: 'Equipment Registry' } };
const EPIC2 = { key: 'EQP-62', fields: { summary: 'Rate & Pricing' } };
const issue = (key, f) => ({ id: key.slice(4), key, fields: Object.assign({ issuetype: { name: 'Story' }, priority: { name: 'Medium' }, comment: { comments: [] }, updated: '2026-11-01T10:00:00.000-0500' }, f) });
const ISSUES = [
  issue('EQP-12', { summary: 'Equipment Master List View', status: status('DEVELOPMENT', 'indeterminate'), parent: EPIC1, labels: ['cianbro'],
    assignee: { displayName: 'Rahul Kanth Panganamamula' }, duedate: '2026-10-07',
    customfield_10020: [{ id: 5, name: '2026-07', state: 'active', startDate: '2026-07-01T05:00:00.000Z', endDate: '2026-07-31T05:00:00.000Z' }],
    description: 'List. Acceptance Criteria: grid shows. FDD Section: 7.2' }),
  issue('EQP-20', { summary: 'Rate schedule list', status: status('Done', 'done'), parent: EPIC2, labels: ['oceaneering'],
    assignee: { displayName: 'Sana Suhana Thehaseen' }, duedate: '2026-06-30',
    customfield_10020: [{ id: 4, name: '2026-06', state: 'closed', startDate: '2026-06-01T05:00:00.000Z', endDate: '2026-06-30T05:00:00.000Z' }],
    description: 'Rates. Acceptance Criteria: list. FDD Section: 7.3' }),
];

function handle(req, res) {
  if (req.path === '/rest/api/2/myself') return req.auth ? res.json({ accountId: '1', displayName: 'Javeed Shaik', emailAddress: 'javeed@equiprite.com' }) : res.json({ errorMessages: ['x'] }, 401);
  if (req.path === '/rest/api/2/search/jql') { if (!req.auth) return res.json({ issues: [], isLast: true }); return res.json({ issues: ISSUES, isLast: true }); }
  return undefined;
}

const txStub = { transcribe: async () => ({ ok: true, engine: 'local', lang: 'en', segments: [{ start: 0, end: 2, text: 'Discussed the map view.' }] }) };
const teamsPosts = [];
const teamsFetch = async (url, init) => { teamsPosts.push({ url, body: init && init.body }); return { status: 200, text: async () => '1' }; };
const llmCalls = [];
const llmFetch = async (url, init) => {
  llmCalls.push(url);
  if (/chat\/completions/.test(url)) return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'The team discussed the missing map view and agreed to add it.' } }] }) };
  return { ok: false, status: 404, text: async () => '{}' };
};

const settle = (page, ms) => page.waitForTimeout(ms || 350);
const text = (page, sel) => page.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
async function setField(page, sel, val) { await page.fill(sel, val); await page.dispatchEvent(sel, 'change'); }

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-minutes-'));
  const jiraStore = JA.open({ file: path.join(dir, 'jira.json'), encrypt: enc, decrypt: dec });
  jiraStore.save({ site: 'https://equiprite.atlassian.net', email: 'javeed@equiprite.com', token: 'ATATT-test' });
  const contactsStub = async () => ({ ok: true, available: true, contacts: [{ name: 'Priya Raman', email: 'priya.raman@rite.digital' }, { name: 'Rahul Kanth', email: 'rahul@rite.digital' }] });
  const outlookOpened = [];
  const outlookStub = async (m) => { outlookOpened.push(m); return { ok: true, available: true }; };
  // A stubbed Microsoft 365 / Graph provider (the real OAuth is machine-verified; this exercises the wiring).
  const gState = { configured: false, signedIn: false, pending: false, account: '', userCode: '', verificationUri: '', tenantId: '', clientId: '' };
  const graphSent = [];
  const graphStub = {
    status: () => Object.assign({}, gState),
    saveConfig: (b) => { if (b.tenantId !== undefined) gState.tenantId = b.tenantId; if (b.clientId !== undefined) gState.clientId = b.clientId; gState.configured = !!(gState.tenantId && gState.clientId); return gState; },
    beginSignIn: async () => { gState.pending = true; gState.userCode = 'ABCD-1234'; gState.verificationUri = 'https://microsoft.com/devicelogin'; setTimeout(() => { gState.pending = false; gState.signedIn = true; gState.account = 'javeed@rite.digital'; }, 800); return { ok: true, userCode: gState.userCode, verificationUri: gState.verificationUri, message: 'enter the code' }; },
    signInInteractive: async () => { gState.pending = false; gState.signedIn = true; gState.account = 'javeed@rite.digital'; return { ok: true, status: Object.assign({}, gState) }; },
    signOut: () => { gState.signedIn = false; gState.account = ''; return gState; },
    people: async () => ({ ok: true, available: true, contacts: [{ name: 'Sandeep Reddy', email: 'sandeep.reddy@rite.digital' }, { name: 'HR India', email: 'hrindia@rite.digital' }] }),
    sendMail: async (b) => { graphSent.push(b); return { ok: true }; },
  };
  const minutesStore = await MIN.open({ file: path.join(dir, 'minutes.duckdb'), encrypt: enc, decrypt: dec, transcribe: txStub, fetch: teamsFetch, contacts: contactsStub, outlookSend: outlookStub, graph: graphStub });
  const aiStore = await AI.open({ file: path.join(dir, 'ai.json'), encrypt: enc, decrypt: dec, fetch: llmFetch });
  await aiStore.save({ provider: 'openai', key: 'sk-test', model: 'gpt-4o' });

  const env = await E.start({ port: 19800, handle, app: 'next', jiraStore, minutesStore, aiStore, transcribe: txStub });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('the page opens in the desktop app, backed by DuckDB');
    await env.open('/?open=minutes');
    await page.waitForSelector('#minSub', { timeout: 30000 });
    await settle(page, 600);
    T.check('the banner and the DuckDB subtitle', (await text(page, '.nx-pagehead h1')) === 'Standup minutes' && /DuckDB on this PC/.test(await text(page, '#minSub')));
    T.check('the Minutes / Tracking tabs and New meeting', await page.isVisible('#minTabEdit') && await page.isVisible('#minTabTrack') && await page.isVisible('#minNew'));

    T.section('a new meeting: header, a line tied to a Jira story, a next action');
    await page.click('#minNew');
    await settle(page, 300);
    await setField(page, '.nx-min-head input[data-field="date"]', '2026-11-10');
    await setField(page, '.nx-min-head input[data-field="title"]', 'Daily standup');
    await setField(page, '.nx-min-head input[data-field="customer"]', 'Cianbro');
    await page.fill('.nx-min-attadd', 'Priya');
    await settle(page, 300);
    await page.waitForSelector('.nx-min-suggest-item', { timeout: 5000 });
    await env.shot('next-minutes-suggest.png');
    T.check('typing shows an Outlook-style suggestions dropdown with name + email', /Priya Raman/.test(await text(page, '.nx-min-suggest')) && /priya\.raman@rite\.digital/.test(await text(page, '.nx-min-suggest')));
    await page.click('.nx-min-suggest-item');
    await settle(page, 300);
    T.check('clicking a suggestion adds a chip (name shown, email kept)', /Priya Raman/.test(await text(page, '.nx-min-att')));
    T.check('the typed text is wiped from the attendee box once the name becomes a chip', (await page.inputValue('.nx-min-attadd')) === '');

    T.section('the Discussion body: a rich-text editor — type notes, format, then Format with AI tidies them');
    const setBody = (html) => page.evaluate((h) => { const el = document.getElementById('minBody'); if (el) { el.innerHTML = h; el.dispatchEvent(new Event('input', { bubbles: true })); } }, html);
    const bodyText = () => page.$eval('#minBody', (el) => (el.textContent || '').trim());
    const bodyHtml = () => page.$eval('#minBody', (el) => el.innerHTML || '');
    T.check('the discussion is a rich-text editor with a toolbar and Format with AI', await page.isVisible('#minBody') && await page.isVisible('.nx-min-rtebar') && await page.isVisible('#minBodyFormat') && (await page.$eval('#minBody', (el) => el.getAttribute('contenteditable'))) === 'true');
    // Toolbar: type a line, select it, click the bullet-list button → the body becomes a <ul>.
    await setBody('discuss the map view');
    await settle(page, 200);
    await page.evaluate(() => { const el = document.getElementById('minBody'); el.focus(); const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); });
    await page.click('.nx-min-rtebtn[data-id="ul"]');
    await settle(page, 200);
    T.check('the bullet-list toolbar button turns the body into a list', /<li[\s>]/i.test(await bodyHtml()));
    await setBody('map view still missing\nrelease plan for 27a agreed');
    await settle(page, 300);
    await page.click('#minBodyFormat');
    await page.waitForFunction(() => { const t = document.querySelector('#minBody'); return t && /agreed to add it/.test(t.textContent || ''); }, null, { timeout: 15000 }).catch(() => {});
    T.check('the discussion body is rewritten by the shared Ask AI (and kept as HTML)', /agreed to add it/.test(await bodyText()) && /<(p|ul|li)[\s>]/i.test(await bodyHtml()) && llmCalls.some((u) => /chat\/completions/.test(u)));

    await page.click('#minAddLine');
    await settle(page, 300);

    T.section('the "Find a Jira story" picker: search by description, status, assignee or sprint');
    await page.click('.nx-min-line button[data-act="pickOpen"]');
    await page.waitForSelector('#minPickDlg', { timeout: 10000 });
    await settle(page, 300);
    const pickRow12 = () => page.$eval('#minPickList .nx-min-pickrow[data-id="EQP-12"]', (el) => el.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
    T.check('the dialog lists stories with key, summary, status and assignee', /EQP-12/.test(await pickRow12()) && /Equipment Master List/.test(await pickRow12()) && /DEVELOPMENT/.test(await pickRow12()) && /Rahul/.test(await pickRow12()));
    await page.fill('#minPickSearch', 'rahul master');
    await settle(page, 300);
    T.check('a free-text search across number/description/assignee narrows the list', (await page.$$('#minPickList .nx-min-pickrow:not(.nx-min-pickrow--head):not(.nx-min-pickrow--none)')).length >= 1 && /EQP-12/.test(await pickRow12()));
    await page.fill('#minPickSearch', 'zzz-nothing-matches');
    await settle(page, 300);
    T.check('a search with no match shows the empty note', await page.isVisible('.nx-min-pick-empty') && /0 stories/.test(await text(page, '#minPickCount')));
    await page.fill('#minPickSearch', '');
    await settle(page, 300);
    await page.click('.nx-min-pick-filters button[data-act="pickStatus"][data-id="Done"]');
    await settle(page, 300);
    T.check('a status filter chip narrows the list (Done only — the DEVELOPMENT story drops out)', !(await page.$('#minPickList .nx-min-pickrow[data-id="EQP-12"]')) && !!(await page.$('#minPickList .nx-min-pickrow[data-id="EQP-20"]')));
    await page.click('#minPickClear');
    await settle(page, 300);

    // Add manually: a key typed in by hand links even when it is not in the backlog read.
    await page.fill('#minPickManual', 'EQP-777');
    await page.click('#minPickManualBtn');
    await page.waitForSelector('#minPickDlg', { state: 'hidden', timeout: 10000 });
    T.check('a key typed in by hand links even when it is not in the backlog read', /EQP-777/.test(await text(page, '.nx-min-storycard')) && /not in the backlog read/i.test(await text(page, '.nx-min-storycard')));

    // Now pick a real backlog story: tick it, then Link. The card shows its number, description and current status.
    await page.click('.nx-min-line button[data-act="pickOpen"]');
    await page.waitForSelector('#minPickDlg', { timeout: 10000 });
    await settle(page, 300);
    await page.click('#minPickList .nx-min-pickrow[data-id="EQP-12"]');
    await settle(page, 200);
    T.check('ticking a story updates the selected count and enables Link', /1 selected/.test(await text(page, '#minPickSelCount')) && /Link 1 story/.test(await text(page, '#minPickLink')));
    await page.click('#minPickLink');
    await page.waitForSelector('#minPickDlg', { state: 'hidden', timeout: 10000 });
    const storyCard = () => text(page, '.nx-min-storycard');
    T.check('the linked story shows its number, description and current status on the action item', /EQP-12/.test(await storyCard()) && /Equipment Master List/.test(await storyCard()) && /DEVELOPMENT/.test(await storyCard()));
    T.check('the linked story has an "open in Jira" link to its browse URL', await page.$eval('.nx-min-storycard a.nx-min-jira', (a) => /\/browse\/EQP-12$/.test(a.getAttribute('href') || '')).catch(() => false));

    const optsOf = (id) => page.$eval(id, (dl) => Array.from(dl.querySelectorAll('option')).map((o) => o.value)).catch(() => []);
    const actOpts = await optsOf('#minActions');
    const ownerOpts = await optsOf('#minOwners');
    T.check('the Action item field suggests standard actions (Development, Testing, Bug fixing…)', actOpts.includes('Development') && actOpts.includes('Testing') && actOpts.includes('Bug fixing'));
    T.check('the Actioned by field suggests the attendees / directory contacts', ownerOpts.some((v) => /Priya Raman/.test(v)));
    await page.evaluate((v) => { const t = document.querySelector('oj-text-area.nx-min-ta'); if (t) t.value = v; }, 'map view still missing, type column added');
    await settle(page, 300);
    await setField(page, '.nx-min-line input[data-field="action"]', 'Add the map view');
    await setField(page, '.nx-min-line input[data-field="owner"]', 'Rahul');
    await setField(page, '.nx-min-line input[data-field="due"]', '2026-11-14');

    T.section('Format by AI rewrites the note (a stub LLM)');
    await page.click('.nx-min-line button[data-act="format"]');
    await page.waitForFunction(() => { const t = document.querySelector('oj-text-area.nx-min-ta'); return t && /agreed to add it/.test(t.value || ''); }, null, { timeout: 15000 }).catch(() => {});
    T.check('the note is replaced by the formatted text, via the shared Ask AI', /agreed to add it/.test(await page.$eval('oj-text-area.nx-min-ta', (t) => t.value || '')) && llmCalls.some((u) => /chat\/completions/.test(u)));

    T.section('Format all with AI (header button) tidies the whole minutes in one click');
    await setBody('rough body notes to clean up');
    await page.evaluate(() => { const t = document.querySelector('oj-text-area.nx-min-ta'); if (t) t.value = 'rough note to clean up'; });
    await settle(page, 300);
    T.check('the header has a "Format all with AI" button', await page.isVisible('#minFormatAll'));
    await page.click('#minFormatAll');
    await page.waitForFunction(() => {
      const b = document.querySelector('#minBody'); const n = document.querySelector('oj-text-area.nx-min-ta');
      return b && n && /agreed to add it/.test(b.textContent || '') && /agreed to add it/.test(n.value || '');
    }, null, { timeout: 15000 }).catch(() => {});
    T.check('one click formats both the discussion body and the action-item note', /agreed to add it/.test(await bodyText()) && /agreed to add it/.test(await page.$eval('oj-text-area.nx-min-ta', (t) => t.value || '')));

    T.section('AI setup: the Model field is a list of values, and Claude actually saves');
    await page.click('#minAi');
    await page.waitForSelector('#minAiDlg', { timeout: 10000 });
    await page.selectOption('#minAiDlg select[data-field="provider"]', 'anthropic');
    await settle(page, 300);
    let modelOpts = await optsOf('#minAiModels');
    T.check('Claude shows its models in the list of values', modelOpts.includes('claude-opus-5-5') && modelOpts.includes('claude-sonnet-5-5'));
    await page.selectOption('#minAiDlg select[data-field="provider"]', 'openai');
    await settle(page, 300);
    modelOpts = await optsOf('#minAiModels');
    T.check('switching the provider updates the model list of values', modelOpts.includes('gpt-5') && !modelOpts.includes('claude-opus-5-5'));
    // Save Claude: the dialog must send the store's provider id ("anthropic"), or Save fails with "Choose the LLM to use."
    await page.selectOption('#minAiDlg select[data-field="provider"]', 'anthropic');
    await settle(page, 200);
    await setField(page, '#minAiDlg input[data-field="key"]', 'sk-ant-test');
    await setField(page, '#minAiDlg input[data-field="model"]', 'claude-sonnet-5-5');
    await page.click('#minAiSave');
    await page.waitForSelector('#minAiDlg', { state: 'hidden', timeout: 10000 });
    const aiNow = await aiStore.settings();
    T.check('saving Claude persists it as the active provider (not a dead "claude" id)',
      aiNow.active === 'anthropic' && !!(aiNow.providers && aiNow.providers.anthropic && aiNow.providers.anthropic.model === 'claude-sonnet-5-5'));

    T.section('Save keeps it in DuckDB and lists it');
    await page.click('#minSave');
    await page.waitForFunction(() => document.querySelectorAll('#minList .nx-min-item').length === 1, null, { timeout: 15000 });
    T.check('the meeting is in the list with its customer and one open action', /Cianbro/.test(await text(page, '#minList')) && /1 open/.test(await text(page, '#minList')));
    const stored = await minutesStore.list();
    T.check('…and really in the DuckDB store', stored.ok && stored.meetings.length === 1 && stored.meetings[0].keys.join() === 'EQP-12' && stored.meetings[0].customer === 'Cianbro');
    await env.shot('next-minutes.png');

    T.section('tracking rolls up by epic and by customer');
    await page.click('#minTabTrack');
    await page.waitForSelector('#minTrackTbl', { timeout: 10000 });
    await settle(page, 400);
    T.check('By epic resolves the epic from the backlog', /EQP-1 Equipment Registry/.test(await text(page, '#minTrackTbl')));
    T.check('the open action is listed', /Add the map view/.test(await text(page, '#minOpenActions')) && /Rahul/.test(await text(page, '#minOpenActions')));
    await page.click('#minTrackBy button[data-id="customer"]');
    await settle(page, 300);
    T.check('By customer shows Cianbro', /Cianbro/.test(await text(page, '#minTrackTbl')));
    await env.shot('next-minutes-track.png');

    T.section('the formatted email');
    await page.click('#minTabEdit');
    await settle(page, 300);
    await page.click('#minList .nx-min-item');
    await page.waitForSelector('.nx-min-line', { timeout: 10000 });
    await page.click('#minEmail');
    await page.waitForSelector('#minEmailDlg', { timeout: 10000 });
    T.check('the email dialog: the subject and a preview', /\[Standup\] Daily standup — 2026-11-10 · Cianbro/.test(await page.$eval('#minEmailDlg input[readonly]', (i) => i.value))
      && await page.isVisible('#minEmailPreview'));
    const previewHtml = await page.$eval('#minEmailPreview', (f) => f.getAttribute('srcdoc') || '');
    T.check('the preview holds the Discussion body and the action item', /Discussion/.test(previewHtml) && previewHtml.indexOf('agreed to add it') !== -1 && previewHtml.indexOf('Add the map view') !== -1);
    T.check('the email action items show the story number, description and current status', /Story &amp; current status/.test(previewHtml) && previewHtml.indexOf('EQP-12') !== -1 && previewHtml.indexOf('Equipment Master List View') !== -1 && previewHtml.indexOf('DEVELOPMENT') !== -1);
    T.check('Send to is pre-filled with the attendee email', /priya\.raman@rite\.digital/.test(await page.$eval('#minEmailDlg input[data-field="to"]', (i) => i.value)));
    await page.click('#minEmailSend');
    await settle(page, 400);
    T.check('Send via Outlook opens a pre-filled Outlook message', outlookOpened.length === 1 && /priya\.raman@rite\.digital/.test(outlookOpened[0].to) && /Daily standup/.test(outlookOpened[0].subject) && /Add the map view/.test(outlookOpened[0].html));
    await page.click('#minEmailDlg button[data-act="dialog"]');
    await settle(page, 200);

    T.section('settings: a Teams webhook, then Send to Teams posts to it');
    await page.click('#minSettings');
    await page.waitForSelector('#minSetDlg', { timeout: 10000 });
    await setField(page, '#minSetDlg input[data-field="teamsWebhook"]', 'https://outlook.office.com/webhook/abc');
    await page.click('#minSetSave');
    await settle(page, 400);
    await page.click('#minTeams');
    await page.waitForFunction(() => true, null, { timeout: 5000 });
    await settle(page, 500);
    T.check('a message was posted to the Teams webhook with the minutes', teamsPosts.length === 1 && /outlook\.office\.com/.test(teamsPosts[0].url) && /Daily standup/.test(teamsPosts[0].body));

    T.section('Microsoft 365 (Graph) provider: sign in, directory, send');
    await page.click('#minSettings');
    await page.waitForSelector('#minSetDlg', { timeout: 10000 });
    await page.click('#minSetDlg button[data-act="setProvider"][data-id="o365"]');
    await settle(page, 300);
    T.check('the Microsoft 365 Tenant ID and Client ID are prefilled with the RITE app by default',
      (await page.inputValue('#minSetDlg input[data-field="tenantId"]')) === 'f4d4b2b3-ca12-4c29-8cff-136685f7f51d'
      && (await page.inputValue('#minSetDlg input[data-field="clientId"]')) === '3e139d37-6f21-4165-81ef-a2f126831839');
    await setField(page, '#minSetDlg input[data-field="tenantId"]', 'tenant-123');
    await setField(page, '#minSetDlg input[data-field="clientId"]', 'client-abc');
    await page.click('#minGraphIn');
    await page.waitForFunction(() => /Signed in/.test((document.querySelector('#minSetDlg') || {}).innerText || ''), null, { timeout: 15000 }).catch(() => {});
    T.check('the in-app popup sign-in signs the user in to Microsoft 365', /Signed in/.test(await text(page, '#minSetDlg')) && /javeed@rite\.digital/.test(await text(page, '#minSetDlg')));
    await page.click('#minGraphTest');
    await settle(page, 400);
    T.check('Send a test email to me sends via Microsoft 365 to the signed-in account', graphSent.some((m) => /javeed@rite\.digital/.test(m.to) && /Microsoft 365 test/.test(m.subject)));
    await page.click('#minSetSave');
    await settle(page, 400);
    T.check('the page header shows you are signed in to Microsoft 365 (with the account)', (await page.$('#minM365')) !== null
      && /javeed@rite\.digital/.test(await text(page, '#minM365')));
    await page.click('#minNew');
    await settle(page, 300);
    await page.fill('.nx-min-attadd', 'San');
    await settle(page, 300);
    await page.waitForSelector('.nx-min-suggest-item', { timeout: 5000 });
    T.check('attendee suggestions now come from the Microsoft 365 directory', /Sandeep Reddy/.test(await text(page, '.nx-min-suggest')));
    await page.click('.nx-min-suggest-item');
    await page.click('#minAddLine');
    await settle(page, 200);
    await page.evaluate((x) => { const t = document.querySelector('oj-text-area.nx-min-ta'); if (t) t.value = x; }, 'Office 365 send test note');
    await settle(page, 200);
    await page.click('#minEmail');
    await page.waitForSelector('#minEmailDlg', { timeout: 10000 });
    T.check('the email Send button reads "Send via Office 365"', /Send via Office 365/.test(await text(page, '#minEmailSend')));
    await page.click('#minEmailSend');
    await settle(page, 500);
    T.check('Send via Office 365 sends the minutes through Graph', graphSent.some((m) => /sandeep\.reddy@rite\.digital/.test(m.to) && /Office 365 send test note/.test(m.html)));

    T.section('the picker links several stories at once (multi-select → one action item each)');
    await page.click('#minNew');
    await settle(page, 300);
    await page.click('#minAddLine');
    await settle(page, 200);
    await page.click('.nx-min-line button[data-act="pickOpen"]');
    await page.waitForSelector('#minPickDlg', { timeout: 10000 });
    await settle(page, 300);
    await page.click('#minPickList .nx-min-pickrow[data-id="EQP-12"]');
    await page.click('#minPickList .nx-min-pickrow[data-id="EQP-20"]');
    await settle(page, 200);
    T.check('two stories can be ticked at once', /2 selected/.test(await text(page, '#minPickSelCount')) && /Link 2 stories/.test(await text(page, '#minPickLink')));
    await page.click('#minPickLink');
    await page.waitForSelector('#minPickDlg', { state: 'hidden', timeout: 10000 });
    await settle(page, 300);
    const multiKeys = await page.$$eval('.nx-min-line .nx-min-storycard .nx-min-pk-key', (els) => els.map((e) => e.textContent.trim()));
    T.check('linking 2 stories creates one action item per story', (await page.$$('.nx-min-line')).length === 2 && multiKeys.indexOf('EQP-12') !== -1 && multiKeys.indexOf('EQP-20') !== -1);

    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    if (minutesStore.close) await minutesStore.close();
    if (aiStore.close) await aiStore.close();
    await env.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
  }
  T.report();
})();
