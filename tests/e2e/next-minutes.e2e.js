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
    description: 'List. Acceptance Criteria: grid shows. FDD Section: 7.2' }),
  issue('EQP-20', { summary: 'Rate schedule list', status: status('Done', 'done'), parent: EPIC2, labels: ['oceaneering'],
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
    await page.click('#minAddLine');
    await settle(page, 300);
    await setField(page, '.nx-min-line input[data-field="jiraKey"]', 'EQP-12');
    await settle(page, 300);
    T.check('the story key resolves from the backlog (summary + epic + customer)', /Equipment Master List/.test(await text(page, '.nx-min-hint')) && /Equipment Registry/.test(await text(page, '.nx-min-hint')));
    T.check('the story picker lists sprint-wise with status', await page.$eval('#minKeys', (dl) => { const o = Array.from(dl.querySelectorAll('option')).filter((x) => x.value === 'EQP-12')[0]; return !!o && /DEVELOPMENT/.test(o.textContent); }));
    await page.evaluate((v) => { const t = document.querySelector('oj-text-area.nx-min-ta'); if (t) t.value = v; }, 'map view still missing, type column added');
    await settle(page, 300);
    await setField(page, '.nx-min-line input[data-field="action"]', 'Add the map view');
    await setField(page, '.nx-min-line input[data-field="owner"]', 'Rahul');
    await setField(page, '.nx-min-line input[data-field="due"]', '2026-11-14');

    T.section('Format by AI rewrites the note (a stub LLM)');
    await page.click('.nx-min-line button[data-act="format"]');
    await page.waitForFunction(() => { const t = document.querySelector('oj-text-area.nx-min-ta'); return t && /agreed to add it/.test(t.value || ''); }, null, { timeout: 15000 }).catch(() => {});
    T.check('the note is replaced by the formatted text, via the shared Ask AI', /agreed to add it/.test(await page.$eval('oj-text-area.nx-min-ta', (t) => t.value || '')) && llmCalls.some((u) => /chat\/completions/.test(u)));

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
    const previewHasAction = await page.$eval('#minEmailPreview', (f) => (f.getAttribute('srcdoc') || '').indexOf('Add the map view') !== -1);
    T.check('the preview holds the discussion and the action item', previewHasAction);
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
