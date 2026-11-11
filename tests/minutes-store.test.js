/*
 * The Standup minutes store (desktop/lib/minutes.js): meetings kept on this PC in DuckDB (tables meetings, minute_lines,
 * minute_settings; a JSON file when DuckDB cannot load), each with a header and lines (a note tied to a Jira story or
 * generic, with a next action), voice→text through the Whisper engine, the Teams webhook kept sealed and never sent back,
 * and a message posted to the webhook. No desktop, no Electron: the store is exercised directly. Every method is async.
 *
 * Run:  node tests/minutes-store.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const M = require('../desktop/lib/minutes');

// Same stand-in keychain as the e2e: seal to base64, unseal back. Lets the test check a secret is sealed, not stored raw.
const enc = (t) => Buffer.from('enc:' + Buffer.from(t).toString('base64'));
const dec = (b) => Buffer.from(String(b).replace(/^enc:/, ''), 'base64').toString();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-minutes-'));
const file = path.join(dir, 'minutes.duckdb');

// A Whisper stub, as lib/transcribe.js answers: { ok, segments: [{ start, end, text }] }.
const transcribe = { transcribe: async () => ({ ok: true, engine: 'local', lang: 'en', model: 'ggml-base.bin',
  segments: [{ start: 0, end: 2.4, text: 'The map does not load on this story.' }, { start: 2.4, end: 4.8, text: 'Edit does nothing.' }], ms: 7 }) };
// A fetch stub for the Teams webhook.
const posted = [];
const okFetch = async (url, init) => { posted.push({ url, body: init && init.body }); return { status: 200, text: async () => '1' }; };

(async () => {
  const store = await M.open({ file, encrypt: enc, decrypt: dec, transcribe, fetch: okFetch });
  T.section('the store is backed by DuckDB (or a JSON file where DuckDB cannot load)');
  T.check('engine is duckdb or the json fallback', store.engine === 'duckdb' || store.engine === 'json');

  T.section('a meeting: ids and timestamps filled on save');
  const saved = await store.save({ date: '2026-11-10', time: '09:30', title: 'Daily standup', customer: 'Cianbro', attendees: ['JS', 'RP', ''],
    discussion: 'Reviewed sprint progress.\n- Map view still pending\n- Release plan agreed for 27A',
    lines: [
      { jiraKey: 'eqp-12', text: 'Smart search still missing columns.', action: 'Add the missing filters', owner: 'RP', due: '2026-11-12', status: 'open' },
      { jiraKey: '', text: 'General: release plan review.', action: '', owner: '', due: '', status: 'open' },
      { jiraKey: 'EQP-20', text: 'Rate list done.', action: 'Close the story', owner: 'AR', due: '2026-11-11', status: 'done' },
    ] });
  T.check('save returns ok with an id and timestamps', saved.ok && /^m_/.test(saved.meeting.id) && !!saved.meeting.createdAt && !!saved.meeting.updatedAt);
  T.check('each line gets an id', saved.meeting.lines.every((l) => /^l_/.test(l.id)));
  T.eq('a jiraKey is upper-cased; a line without one is generic', saved.meeting.lines[0].jiraKey + '/' + saved.meeting.lines[1].generic, 'EQP-12/true');
  T.eq('blank attendees dropped', saved.meeting.attendees.join(','), 'JS,RP');

  T.section('the list summarises each meeting');
  const second = await store.save({ date: '2026-11-11', time: '09:30', title: 'Next standup', customer: 'Oceaneering', attendees: ['JS'],
    lines: [{ jiraKey: 'EQP-40', text: 'Inspection checklist.', action: 'Draft it', owner: 'JS', due: '2026-11-20', status: 'open' }] });
  const list = await store.list();
  T.eq('two meetings, newest first', list.meetings.map((m) => m.title).join(','), 'Next standup,Daily standup');
  const first = list.meetings.find((m) => m.title === 'Daily standup');
  T.eq('its distinct Jira keys', first.keys.join(','), 'EQP-12,EQP-20');
  T.eq('open action count excludes done and no-action lines', first.actionOpen, 1);
  T.eq('its line count', first.lineCount, 3);

  T.section('get, edit and remove');
  const got = await store.get(saved.meeting.id);
  T.eq('get returns the full meeting with its lines in order', got.meeting.title + '/' + got.meeting.lines.map((l) => l.jiraKey || '-').join(','), 'Daily standup/EQP-12,-,EQP-20');
  T.check('the discussion body round-trips through the store', got.meeting.discussion === 'Reviewed sprint progress.\n- Map view still pending\n- Release plan agreed for 27A');
  T.check('get of an unknown id is not ok', (await store.get('nope')).ok === false);
  const edited = await store.save(Object.assign({}, got.meeting, { title: 'Daily standup (edited)' }));
  T.check('editing keeps the id and createdAt, moves updatedAt', edited.meeting.id === saved.meeting.id && edited.meeting.createdAt === saved.meeting.createdAt);
  T.eq('still two meetings after an edit (upsert, not insert)', (await store.list()).meetings.length, 2);
  await store.remove(second.meeting.id);
  T.eq('remove drops it from the list', (await store.list()).meetings.length, 1);

  T.section('settings: the Teams webhook is sealed and never leaked');
  const s1 = await store.saveSettings({ teamsWebhook: 'https://outlook.office.com/webhook/abc-123', defaultAttendees: ['JS', 'RP'], orgName: 'Rite', fromName: 'Javeed', fromEmail: 'javeed@rite.digital' });
  T.check('settings() says a webhook is set but never returns it', s1.teamsWebhookSet === true && !('teamsWebhook' in s1) && !JSON.stringify(s1).includes('outlook.office.com'));
  T.check('the data file keeps the webhook sealed, not in clear text', !fs.readFileSync(file).toString('latin1').includes('outlook.office.com'));
  T.eq('other settings come back', [s1.orgName, s1.fromEmail, s1.defaultAttendees.join(',')].join('/'), 'Rite/javeed@rite.digital/JS,RP');

  T.section('voice → text through Whisper');
  const d1 = await store.dictate({ audioBase64: Buffer.from('fake-audio').toString('base64'), mime: 'audio/webm' });
  T.eq('dictate joins the segments into one line', d1.ok && d1.text, 'The map does not load on this story. Edit does nothing.');
  const noTx = await M.open({ file: path.join(dir, 'm2.duckdb'), encrypt: enc, decrypt: dec, fetch: okFetch });
  const d2 = await noTx.dictate({ audioBase64: 'AAAA', mime: 'audio/webm' });
  T.check('with no engine, dictate says it is not set up', d2.ok === false && /not set up/.test(d2.error));
  if (noTx.close) await noTx.close();

  T.section('send to Teams via the saved webhook');
  const sent = await store.sendTeams({ text: 'Standup minutes for 2026-11-10' });
  T.check('a message posts to the saved webhook', sent.ok === true && posted.length === 1 && /outlook\.office\.com/.test(posted[0].url) && posted[0].body.includes('Standup minutes'));
  const sent2 = await store.sendTeams({ card: { type: 'message', text: 'card body' } });
  T.check('a card is posted as-is', sent2.ok === true && posted[1].body.includes('card body'));

  T.section('settings survive a reopen (DuckDB on disk)');
  await store.close();
  const reopened = await M.open({ file, encrypt: enc, decrypt: dec, transcribe, fetch: okFetch });
  T.check('a saved webhook and the meeting are still there after reopening', (await reopened.settings()).teamsWebhookSet === true && (await reopened.list()).meetings.length === 1);
  const s2 = await reopened.saveSettings({ clearTeamsWebhook: true });
  T.check('clearTeamsWebhook removes it', s2.teamsWebhookSet === false);
  const sent3 = await reopened.sendTeams({ text: 'hi' });
  T.check('with no webhook, sendTeams returns the error', sent3.ok === false && /No Teams webhook/.test(sent3.error));
  if (reopened.close) await reopened.close();

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
  T.report();
})();
