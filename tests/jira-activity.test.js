/*
 * A Jira story's whole activity (webApps/equiprite-next/resources/js/jiraBacklog.js, the same file Old EquipRite uses):
 * mentions read as names, every comment / change / work log entry read page after page, screenshots and attachments
 * kept, the Activity tabs, and what "Analyze with AI" is given (storyAnalysis.js). Pure — loaded straight, a stand-in
 * for the REST calls.
 *
 * Run:  node tests/jira-activity.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
function load(app, file) {
  let out;
  const sandbox = { console, Promise, Date, Blob: undefined, URL: undefined, define: (d, f) => { out = f(); } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', app, 'resources', 'js', file), 'utf8'), sandbox, { filename: file });
  return out;
}
const J = load('equiprite-next', 'jiraBacklog.js');
const SA = load('equiprite-next', 'storyAnalysis.js');

const RAHUL = { accountId: 'r-1', displayName: 'Rahul Kanth Panganamamula' };
const GANGA = { accountId: 'g-1', displayName: 'GANGA DEVI KOTTI' };
const ATTS = [
  { id: '100', filename: 'image-20261103-091500.png', mimeType: 'image/png', size: 20480, author: GANGA, created: '2026-11-03T09:15:00.000+0000' },
  { id: '101', filename: 'test-results.xlsx', mimeType: 'application/vnd.ms-excel', size: 2097152, author: RAHUL, created: '2026-11-04T09:15:00.000+0000' },
];

(async () => {
  T.section('mentions read as names');
  J.peopleOf([{ fields: { assignee: GANGA, comment: { comments: [{ author: RAHUL }] } } }]);
  T.eq('a v2 mention of someone seen', J.mentions('[~accountid:r-1] Hard Reservation is not required'), '@Rahul Kanth Panganamamula Hard Reservation is not required');
  T.eq('someone nobody has seen yet', J.mentions('[~accountid:zzz] hi'), '@someone hi');
  T.eq('an ADF mention (REST v3) keeps its text', J.plain({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'x', text: '@Sandeep' } }, { type: 'text', text: ' please check' }] }] }), '@Sandeep please check');
  J.peopleOf([{ renderedFields: { comment: { comments: [{ body: '<p><a href="https://x/secure/ViewProfile.jspa?accountId=s-9" class="user-hover" rel="s-9">Sandeep Rao</a> check</p>' }] } } }]);
  T.eq('a name learned from a rendered comment', J.mentions('[~accountid:s-9]'), '@Sandeep Rao');
  const row = J.fromIssue({ key: 'EQP-77', fields: { summary: 'Rate Schedule', attachment: [], comment: { comments: [{ author: GANGA, created: '2026-10-01T10:00:00.000+0000', body: '[~accountid:r-1] check in dev' }] } } }, { today: '2026-11-12' });
  T.eq('the list\'s latest comment names the person, not "[~accountid:…]"', row.lastComment, '@Rahul Kanth Panganamamula check in dev');

  T.section('the whole activity: comments with screenshots, history with attachments, work log');
  const issue = {
    key: 'EQP-137',
    fields: {
      comment: { comments: [
        { id: '1', author: GANGA, created: '2026-09-10T10:00:00.000+0000', updated: '2026-09-10T10:00:00.000+0000', body: '[~accountid:r-1] no changes i have been seen' },
        { id: '2', author: GANGA, created: '2026-10-12T10:00:00.000+0000', updated: '2026-10-14T08:00:00.000+0000', body: '[~accountid:r-1] Hard Reservation is not required.\n!image-20261103-091500.png|width=800!' },
        { id: '3', author: RAHUL, created: '2026-11-05T09:00:00.000+0000', body: 'soft reservation is Developed please Validate.' },
      ] },
      worklog: { total: 2, worklogs: [
        { author: RAHUL, started: '2026-10-01T08:00:00.000+0000', timeSpent: '3h', timeSpentSeconds: 10800, comment: 'built the reservation' },
        { author: RAHUL, started: '2026-10-02T08:00:00.000+0000', timeSpentSeconds: 5400 },
      ] },
    },
    changelog: { total: 4, histories: [
      { author: RAHUL, created: '2026-10-01T07:00:00.000+0000', items: [{ field: 'status', fromString: 'NEW', toString: 'DEVELOPMENT' }, { field: 'assignee', fromString: null, toString: 'Rahul Kanth Panganamamula' }] },
      { author: GANGA, created: '2026-11-03T09:15:00.000+0000', items: [{ field: 'Attachment', from: null, fromString: null, to: '100', toString: 'image-20261103-091500.png' }] },
      { author: GANGA, created: '2026-11-06T12:00:00.000+0000', items: [{ field: 'status', fromString: 'TEST', toString: 'Done' }, { field: 'Rank', fromString: '', toString: 'Ranked higher' }] },
      { author: GANGA, created: '2026-11-06T12:01:00.000+0000', items: [{ field: 'description', fromString: 'old', toString: 'x'.repeat(400) }] },
    ] },
  };
  const atts = J.fromIssue({ key: 'EQP-137', fields: { attachment: ATTS } }, {}).attachments;
  const a = J.activityOf(issue, { attachments: atts, now: '2026-11-12T10:00:00Z' });
  T.check('counts: 3 comments, 4 changes, 2 work logs', a.counts.comments === 3 && a.counts.history === 4 && a.counts.worklog === 2, JSON.stringify(a.counts));
  T.check('All is newest first, all three kinds mixed', a.all[0].kind === 'history' && a.all[a.all.length - 1].kind === 'comment' && a.all.every((x, i) => i === 0 || a.all[i - 1].at >= x.at), a.all.map((x) => x.kind + ' ' + x.at).join(' | '));
  const c2 = a.comments.filter((c) => c.id === '2')[0];
  T.check('a comment: the mention named, the screenshot taken out of the text and linked to its attachment, marked edited',
    c2.text === '@Rahul Kanth Panganamamula Hard Reservation is not required.' && c2.images.length === 1 && c2.images[0].id === '100' && c2.edited === true, JSON.stringify(c2));
  T.check('…and when and how long ago, as Jira says it', c2.when === '2026-10-12 10:00' && c2.ago === '1 month ago' && a.comments[0].ago === '1 week ago');
  const h1 = a.history.filter((h) => h.at.indexOf('2026-10-01') === 0)[0];
  T.check('a change: friendly field names, from → to, every item of it', h1.items.length === 2 && h1.items[0].field === 'Status' && h1.items[0].from === 'NEW' && h1.items[0].to === 'DEVELOPMENT' && h1.items[1].field === 'Assignee' && h1.items[1].from === '');
  const att = a.history.filter((h) => h.items[0].field === 'Attachment')[0].items[0];
  T.check('an attachment added: its file, so the screenshot shows as a thumbnail', att.file && att.file.id === '100' && att.file.image === true && !att.file.removed && att.file.sizeText === '20 KB', JSON.stringify(att));
  T.check('Rank changes are left out (noise); a long description is cut', !a.history.some((h) => h.items.some((i) => i.field === 'Rank')) && a.history[0].items[0].field === 'Description' && a.history[0].items[0].to.length <= 140);
  T.check('work log: each entry with its time, the total', a.worklog[0].spent === '1h 30m' && a.worklog[1].spent === '3h' && a.worklog[1].text === 'built the reservation' && a.spent === '4h 30m');

  T.section('reading it from Jira: every page of every list');
  const comments = Array.from({ length: 230 }, (_, i) => ({ id: String(i), author: i % 2 ? RAHUL : GANGA, created: '2026-01-01T00:00:00.000+0000'.replace('01T00', String(10 + (i % 18)).padStart(2, '0') + 'T00'), body: 'comment ' + i, renderedBody: '<p>comment ' + i + '</p>' }));
  const changes = Array.from({ length: 150 }, (_, i) => ({ author: GANGA, created: '2026-02-01T00:00:00.000+0000', items: [{ field: 'status', fromString: 'A' + i, toString: 'B' + i }] }));
  const logs = Array.from({ length: 25 }, () => ({ author: RAHUL, started: '2026-03-01T00:00:00.000+0000', timeSpentSeconds: 3600 }));
  const calls = [];
  const page = (list, key, p, extra) => { const s = Number(p.startAt) || 0, n = Number(p.maxResults) || 50; return Object.assign({ startAt: s, maxResults: n, total: list.length, [key]: list.slice(s, s + n) }, extra ? extra(s + n >= list.length) : {}); };
  const Actions = { callRest: async (ctx, o) => {
    calls.push(o.endpoint + '@' + o.uriParams.startAt);
    const p = o.uriParams;
    if (o.endpoint === 'jira/getJiraIssueComments') return { ok: true, status: 200, body: page(comments, 'comments', p) };
    if (o.endpoint === 'jira/getJiraIssueChangelog') return { ok: true, status: 200, body: page(changes, 'values', p, (last) => ({ isLast: last })) };
    if (o.endpoint === 'jira/getJiraIssueWorklog') return { ok: true, status: 200, body: page(logs, 'worklogs', p) };
    return { ok: false, status: 404, body: {} };
  } };
  const got = await J.loadActivity({}, Actions, 'EQP-137', []);
  T.check('all 230 comments, 150 changes and 25 work logs (not the first page, not the issue call\'s 100 / 20)', got.ok && got.counts.comments === 230 && got.counts.history === 150 && got.counts.worklog === 25, JSON.stringify(got.counts));
  T.check('page after page: 3 of comments, 2 of changes, 1 of work log', calls.filter((c) => /Comments/.test(c)).length === 3 && calls.filter((c) => /Changelog/.test(c)).length === 2 && calls.filter((c) => /Worklog/.test(c)).length === 1, calls.join(' '));
  T.check('nothing said to be missing', got.missing.length === 0 && got.more.history === false && got.more.worklog === false && got.spent === '25h');
  const noHistory = await J.loadActivity({}, { callRest: async (c, o) => (o.endpoint === 'jira/getJiraIssueChangelog' ? { ok: false, status: 404, body: {} } : Actions.callRest(c, o)) }, 'EQP-137', []);
  T.check('a list Jira will not give is said, not shown as "nothing happened"', noHistory.ok && noHistory.missing.join() === 'history' && /did not give the history/.test(J.activityView(noHistory, {}, 'history').note));
  const refused = await J.loadActivity({}, { callRest: async () => ({ ok: false, status: 401, body: {} }) }, 'EQP-137', []);
  T.check('not connected: said why', !refused.ok && /refused the connection/.test(refused.message));

  T.section('the Activity tabs');
  const listRow = { key: 'EQP-137', comments: [{ author: 'A', when: '2026-01-01', text: 'first' }, { author: 'B', when: '2026-02-01', text: 'second' }] };
  let view = J.activityView({ loading: true }, listRow, 'all');
  T.check('while it loads: the list\'s comments stand in (newest first), counts not yet known', view.loading && view.items.length === 2 && view.items[0].text === 'second' && view.counts.history === null);
  view = J.activityView({ ok: false, message: 'Jira refused' }, listRow, 'comments');
  T.check('if it cannot be read: said, the list\'s comments still shown', view.error === 'Jira refused' && view.items.length === 2);
  view = J.activityView(Object.assign({ ok: true }, a), listRow, 'worklog');
  T.check('a tab shows its kind; the work log says the total', view.items.length === 2 && view.items.every((x) => x.kind === 'worklog') && /Logged in all: 4h 30m/.test(view.note));
  T.eq('an unknown tab is All', J.activityView(Object.assign({ ok: true }, a), listRow, 'nope').items.length, 9);

  T.section('every image, not the first 24');
  const many = { attachments: Array.from({ length: 30 }, (_, i) => ({ id: 'i' + i, name: 's' + i + '.png', image: true })).concat([{ id: 'x', name: 'a.pdf', image: false }]) };
  const asked = [];
  const imgs = await J.loadImages({}, { callRest: async (c, o) => { asked.push(o.uriParams.id); return { ok: true, body: 'data:image/png;base64,AAAA' }; } }, many);
  T.check('all 30 images read (the PDF is not an image)', Object.keys(imgs).length === 30 && asked.length === 30 && asked.indexOf('x') === -1);

  T.section('what Analyze with AI is given');
  const story = { key: 'EQP-137', summary: 'Soft Reservation on Submit', status: 'Done', attachments: atts,
    comments: a.comments.slice().reverse(), history: a.history, worklog: a.worklog, spent: a.spent };
  const st = SA.storyText(story);
  T.check('comments oldest first, with their dates and screenshots', /Comments \(3, oldest first\):\n- 2026-09-10 10:00 GANGA DEVI KOTTI: @Rahul Kanth Panganamamula no changes/.test(st) && /\[screenshot: image-20261103-091500\.png\]/.test(st), st);
  T.check('the history, oldest first: status moves and the attachment added', /History \(4 changes, oldest first\):\n- 2026-10-01 07:00 Rahul Kanth Panganamamula: Status NEW → DEVELOPMENT; Assignee None → Rahul/.test(st) && /Attachment added image-20261103-091500\.png/.test(st) && /Status TEST → Done/.test(st));
  T.check('the work log with its total, and every attachment', /Work log \(2 entries, 4h 30m in all\):/.test(st) && /logged 3h: built the reservation/.test(st) && /Attachments \(2\):\n- image-20261103-091500\.png \(20 KB\)[\s\S]*test-results\.xlsx \(2 MB\)/.test(st));
  T.check('the prompt tells the AI to use the history and the work log', /history \(who moved it where, and when\) and the work logged/.test(SA.prompt(story, [], '').system));

  T.section('Old EquipRite uses the same file');
  T.check('webApps/vbredwoodapp/resources/js/jiraBacklog.js is the same as Next\'s', fs.readFileSync(path.join(__dirname, '..', 'webApps', 'vbredwoodapp', 'resources', 'js', 'jiraBacklog.js'), 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js', 'jiraBacklog.js'), 'utf8'));
  T.report();
})().catch((e) => { console.error(e); process.exit(1); });
