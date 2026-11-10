/*
 * The Follow-ups store (desktop/lib/followups.js): follow-ups drafted on the Jira pages, kept on this PC in DuckDB
 * (tables followups, followup_lines; a JSON file when DuckDB cannot load), each with a header and detail lines. No
 * desktop, no Electron: the store is exercised directly. Every method is async.
 *
 * Run:  node tests/followups-store.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const FS = require('../desktop/lib/followups');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-followups-'));
const file = path.join(dir, 'followups.duckdb');

const SAMPLE = {
  kind: 'sprint', title: 'Follow-up — Sprint 2026-07', subtitle: 'active · 2026-07-01 – 2026-07-31',
  subject: 'Please close these stories', to: 'rahul@company.com', message: 'Dear Rahul,\n\nAs we discussed...',
  signoff: 'Thanks,', sprintName: '2026-07', source: '', author: 'javeed.shaik',
  lines: [
    { storyKey: 'eqp-12', summary: 'Equipment Master List View', status: 'DEVELOPMENT', assignee: 'Rahul Kanth', sprint: '2026-07', due: '2026-10-07', overdue: true, customer: 'cianbro', url: 'https://j/EQP-12' },
    { key: 'EQP-31', summary: 'Rate Schedule Report', status: 'DEVELOPMENT', assignee: 'Rahul Kanth', sprint: '2026-07', due: '2026-07-31', overdue: true, labels: ['oceaneering'], url: 'https://j/EQP-31' },
  ],
};

(async () => {
  const store = await FS.open({ file });
  T.section('the store is backed by DuckDB (or a JSON file where DuckDB cannot load)');
  T.check('engine is duckdb or the json fallback', store.engine === 'duckdb' || store.engine === 'json');

  T.section('save: ids and timestamps filled, header + lines kept');
  const saved = await store.save(SAMPLE);
  T.check('save returns ok with an id and timestamps', saved.ok && /^f_/.test(saved.followup.id) && !!saved.followup.createdAt && !!saved.followup.updatedAt);
  const id = saved.followup.id;
  T.check('two lines saved, keys upper-cased, customer joined, overdue boolean', saved.followup.lines.length === 2
    && saved.followup.lines[0].storyKey === 'EQP-12' && saved.followup.lines[1].storyKey === 'EQP-31'
    && saved.followup.lines[1].customer === 'oceaneering' && saved.followup.lines[0].overdue === true);

  T.section('list: a summary per follow-up, with the item count, newest first');
  const ls = await store.list();
  T.check('one follow-up listed with its header and count', ls.ok && ls.followups.length === 1
    && ls.followups[0].id === id && ls.followups[0].title === SAMPLE.title && ls.followups[0].sprintName === '2026-07'
    && ls.followups[0].itemCount === 2);
  T.check('the list summary carries no line detail (only the count)', !('lines' in ls.followups[0]));

  T.section('get: the full header and lines');
  const got = await store.get(id);
  T.check('get returns the header fields', got.ok && got.followup.subject === SAMPLE.subject && got.followup.to === 'rahul@company.com'
    && got.followup.message.indexOf('Dear Rahul') === 0 && got.followup.kind === 'sprint');
  T.check('get returns the lines in order', got.followup.lines.length === 2 && got.followup.lines[0].storyKey === 'EQP-12' && got.followup.lines[1].storyKey === 'EQP-31');
  T.check('get of an unknown id is not ok', !(await store.get('nope')).ok);

  T.section('save again with the id: updates in place (no duplicate), lines replaced');
  const upd = await store.save(Object.assign({}, SAMPLE, { id, subject: 'Updated subject', lines: [SAMPLE.lines[0]] }));
  T.check('same id kept, createdAt preserved, updatedAt moved on', upd.followup.id === id && upd.followup.createdAt === saved.followup.createdAt);
  const ls2 = await store.list();
  T.check('still one follow-up, now one line, new subject', ls2.followups.length === 1 && ls2.followups[0].itemCount === 1 && ls2.followups[0].subject === 'Updated subject');

  T.section('remove: the follow-up and its lines are gone');
  const rm = await store.remove(id);
  T.check('remove ok and the list is empty', rm.ok && (await store.list()).followups.length === 0);
  T.check('its lines are gone too (get not ok)', !(await store.get(id)).ok);

  T.section('newest first');
  const a = await store.save(Object.assign({}, SAMPLE, { id: '', title: 'A' }));
  await new Promise((r) => setTimeout(r, 5));
  const b = await store.save(Object.assign({}, SAMPLE, { id: '', title: 'B' }));
  const order = (await store.list()).followups.map((f) => f.title);
  T.check('the most recently saved is first', order[0] === 'B' && order[1] === 'A' && a.ok && b.ok);

  if (store.close) await store.close();
  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
