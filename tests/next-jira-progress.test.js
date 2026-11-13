#!/usr/bin/env node
'use strict';
/**
 * Jira · Daily progress (webApps/equiprite-next/resources/js/jiraProgress.js): day by day, from one search with the
 * changelog and comments — closed (into a done status: Jira's category, else by name), new, reopened, moved, touched,
 * comments, by story and by person; a story closed twice the same day counts once; the board's ordering and the
 * resolution field left out; nothing outside the window; so far (cumulative); the totals, the best day, closed a working
 * day; the stuck stories (open, quiet for days); the day and the window as text; the JQL; reading Jira (pages, the
 * stuck search, not connected).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
let P = null;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js', 'jiraProgress.js'), 'utf8'), { define: (deps, f) => { P = f(); } });

const DAY = 86400000;
const NOW = new Date(2026, 10, 13, 16, 30).getTime(); // Fri 13 Nov 2026, 16:30 on this PC
const m0 = new Date(NOW); m0.setHours(0, 0, 0, 0);
const on = (back, h, min) => new Date(new Date(m0.getTime() - back * DAY + 3 * 3600000).setHours(h, min || 0, 0, 0)).toISOString();
const ana = { displayName: 'Ana' }, ben = { displayName: 'Ben' }, dev = { displayName: 'Dev' };
const cat = (k) => ({ key: k });
const issues = [
  { key: 'EQP-1', fields: { summary: 'Rental rates by branch', issuetype: { name: 'Story' }, status: { name: 'Done', statusCategory: cat('done') }, priority: { name: 'High' }, assignee: ana, reporter: ben, created: on(3, 9),
    comment: { comments: [{ created: on(0, 10), author: ben, body: 'Looks *good* on [UAT|https://x]' }, { created: on(40, 10), author: ben, body: 'too old' }] } },
    changelog: { histories: [
      { created: on(2, 10), author: ana, items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }, { field: 'Rank', fromString: '', toString: 'Ranked higher' }] },
      { created: on(1, 15), author: ana, items: [{ field: 'status', fromString: 'In Progress', toString: 'Done' }, { field: 'resolution', fromString: '', toString: 'Done' }] }] } },
  { key: 'EQP-2', fields: { summary: 'Billing totals', issuetype: { name: 'Bug' }, status: { name: 'Closed', statusCategory: cat('done') }, assignee: dev, created: on(30, 9) },
    changelog: { histories: [
      { created: on(0, 9), author: dev, items: [{ field: 'status', fromString: 'In Review', toString: 'Closed' }] },
      { created: on(0, 11), author: ben, items: [{ field: 'status', fromString: 'Closed', toString: 'In Progress' }] },
      { created: on(0, 12), author: dev, items: [{ field: 'status', fromString: 'In Progress', toString: 'Closed' }] }] } },
  { key: 'EQP-3', fields: { summary: 'Sort the yard list', issuetype: { name: 'Story' }, status: { name: 'In Review', statusCategory: cat('indeterminate') }, created: on(50, 9) },
    changelog: { histories: [{ created: on(1, 11), author: ben, items: [{ field: 'assignee', toString: 'Cara' }, { field: 'Rank', toString: 'x' }, { field: 'summary', fromString: 'Sort yard', toString: 'Sort the yard list' }] }] } },
  { key: 'EQP-4', fields: { summary: 'Old one', issuetype: { name: 'Task' }, status: { name: 'In Progress', statusCategory: cat('indeterminate') }, created: on(20, 9) },
    changelog: { histories: [{ created: on(5, 14), author: ben, items: [{ field: 'status', fromString: 'Selected', toString: 'In Progress' }] }, { created: on(25, 9), author: ben, items: [{ field: 'status', fromString: 'To Do', toString: 'Selected' }] }] } },
  { key: 'EQP-5', fields: { summary: 'Shipped yesterday-ish', issuetype: { name: 'Story' }, status: { name: 'Released' }, created: on(40, 9) },
    changelog: { histories: [{ created: on(4, 16), author: ana, items: [{ field: 'status', fromString: 'Doing', toString: 'Released' }] }] } },
];

T.section('day by day');
const p = P.progressOf(issues, { days: 14, now: NOW });
const d = (back) => p.days[p.days.length - 1 - back];
T.check('14 days, oldest first, today last; weekends marked', p.days.length === 14 && d(0).today && d(0).key === '2026-11-13' && p.days[0].key === '2026-10-31' && d(0).label === 'Fri 13 Nov'
  && d(1).weekend === false && p.days.filter((x) => x.weekend).length === 4, JSON.stringify(p.days.map((x) => x.key + (x.weekend ? 'w' : ''))));
T.check('today: EQP-2 closed (closed, reopened, closed again: once), reopened counted; EQP-1 touched by a comment', d(0).closed === 1 && d(0).reopened === 1 && d(0).created === 0 && d(0).touched === 2 && d(0).comments === 1
  && d(0).stories.closed[0].key === 'EQP-2' && d(0).stories.closed[0].text === 'In Progress → Closed' && d(0).stories.closed[0].by === 'Dev' && d(0).stories.closed[0].time === '12:00'
  && d(0).stories.reopened.length === 0 && d(0).stories.updated[0].key === 'EQP-1' && /^Comment: Looks good on UAT$/.test(d(0).stories.updated[0].text), JSON.stringify(d(0).stories));
T.check('yesterday: EQP-1 closed by Ana (In Progress → Done; its resolution not counted again); EQP-3 updated (assigned, its title) — the board\'s ordering left out', d(1).closed === 1 && d(1).stories.closed[0].key === 'EQP-1'
  && d(1).stories.closed[0].text === 'In Progress → Done' && d(1).stories.closed[0].by === 'Ana' && d(1).stories.updated.length === 1 && d(1).stories.updated[0].text === 'Assigned to Cara · Summary: Sort yard → Sort the yard list'
  && d(1).assigned === 1 && d(1).touched === 2, JSON.stringify(d(1).stories));
T.check('2 days back: EQP-1 moved (To Do → In Progress); 3 days back: EQP-1 new, by Ben; 4 back: EQP-5 closed (Released: a done name, no category given); 5 back: EQP-4 moved',
  d(2).moved === 1 && d(2).stories.moved[0].text === 'To Do → In Progress' && d(3).created === 1 && d(3).stories.created[0].by === 'Ben' && /^New story · High$/.test(d(3).stories.created[0].text)
  && d(4).closed === 1 && d(4).stories.closed[0].key === 'EQP-5' && d(5).moved === 1 && d(5).stories.moved[0].key === 'EQP-4', JSON.stringify([d(2).stories.moved, d(3).stories.created, d(4).stories.closed]));
T.check('nothing outside the window (EQP-4\'s older move, the old comment, older creations)', p.days.reduce((n, x) => n + x.created, 0) === 1 && p.days.reduce((n, x) => n + x.comments, 0) === 1);
T.check('so far: 3 closed, 1 new by today (rising day by day)', d(0).closedSoFar === 3 && d(0).createdSoFar === 1 && d(1).closedSoFar === 2 && d(5).closedSoFar === 0 && p.maxSoFar === 3);

T.section('status movements: each change of status, counted by from → to, with its stories');
const mv0 = d(0).moves;
T.check('today: 3 changes of 1 story — closing (twice, from two statuses), reopening; who, when; into each status', d(0).changes === 3 && d(0).movedStories === 1 && mv0.length === 3
  && mv0.map((g) => g.id + ':' + g.kind + ':' + g.n).join('|') === 'Closed → In Progress:reopened:1|In Progress → Closed:closed:1|In Review → Closed:closed:1'
  && mv0[1].people[0].name === 'Dev' && mv0[1].stories[0].key === 'EQP-2' && mv0[1].stories[0].time === '12:00' && mv0[1].stories[0].summary === 'Billing totals' && mv0[1].stories[0].status === 'Closed'
  && d(0).into.map((x) => x.status + ' ' + x.n).join(', ') === 'Closed 2, In Progress 1', JSON.stringify([mv0, d(0).into]));
T.check('…the board\'s ordering is not a movement; an assignment is not either', d(1).changes === 1 && d(1).moves[0].id === 'In Progress → Done' && d(2).moves[0].id === 'To Do → In Progress');
T.check('the window: 7 changes of 4 stories; most first, then by name; into In Progress 3, Closed 2; each with its day', p.totals.changes === 7 && p.totals.movedStories === 4 && p.moves.length === 7
  && p.into[0].status === 'In Progress' && p.into[0].n === 3 && p.into[1].status === 'Closed' && p.into[1].n === 2
  && p.moves.filter((g) => g.id === 'Selected → In Progress')[0].stories[0].day === d(5).label, JSON.stringify([p.totals.changes, p.into]));
const many = P.movesOf([{ key: 'A', from: 'TEST', to: 'Done', kind: 'closed', by: 'Ana', at: 3 }, { key: 'B', from: 'TEST', to: 'Done', kind: 'closed', by: 'Ana', at: 2 }, { key: 'B', from: 'TEST', to: 'Done', kind: 'closed', by: 'Ben', at: 4 },
  { key: 'C', from: 'DEV', to: 'TEST', kind: 'moved', by: 'Ben', at: 1 }]);
T.check('counted: 3 changes of 2 stories for TEST → Done (most first), who moved most first, newest first', many[0].id === 'TEST → Done' && many[0].n === 3 && many[0].storyCount === 2
  && many[0].people.map((x) => x.name + ' ' + x.n).join(', ') === 'Ana 2, Ben 1' && many[0].stories.map((x) => x.at).join() === '4,3,2' && many[1].id === 'DEV → TEST', JSON.stringify(many));

T.section('the totals, the people, the best day');
T.check('3 closed, 1 new (net +2), 1 reopened, 5 stories touched; per working day (10 in 14 days)', p.totals.closed === 3 && p.totals.created === 1 && p.totals.net === 2 && p.totals.reopened === 1 && p.totals.touched === 5
  && p.totals.workdays === 10 && p.totals.perDay === 0.3 && p.max === 1 && p.maxTouched === 2, JSON.stringify(p.totals));
T.check('the best day: the latest with the most closed (today)', p.totals.best && p.totals.best.key === '2026-11-13' && p.totals.best.closed === 1);
T.check('people: Ana closed most (2), then Dev (1); Ben moved, created and commented', p.people[0].name === 'Ana' && p.people[0].closed === 2 && p.people[1].name === 'Dev' && p.people[1].closed === 1
  && p.people.filter((x) => x.name === 'Ben')[0].comments === 1 && p.people.filter((x) => x.name === 'Ben')[0].created === 1, JSON.stringify(p.people));
const p7 = P.progressOf(issues, { days: 7, now: NOW });
T.check('7 days: the same, narrower (EQP-4\'s move 5 days back still in)', p7.days.length === 7 && p7.totals.closed === 3 && p7.totals.touched === 5 && p7.days[0].key === '2026-11-07');
T.check('the window is 1 to 60 days', P.progressOf([], { days: 500, now: NOW }).days.length === 60 && P.progressOf([], { days: 0, now: NOW }).days.length === 14 && P.progressOf([], { days: -3, now: NOW }).days.length === 1);
T.check('no stories: all zero, no best day', (() => { const z = P.progressOf([], { days: 7, now: NOW }); return z.totals.closed === 0 && z.totals.best === null && z.max === 0; })());

T.section('stuck: open, no change for days');
const stuck = P.stuckOf([
  { key: 'EQP-7', fields: { summary: 'Waiting', status: { name: 'To Do', statusCategory: cat('new') }, assignee: null, updated: on(9, 10) } },
  { key: 'EQP-8', fields: { summary: 'Quiet longer', status: { name: 'In Progress', statusCategory: cat('indeterminate') }, assignee: ana, updated: on(20, 10) } },
  { key: 'EQP-9', fields: { summary: 'Done', status: { name: 'Done', statusCategory: cat('done') }, updated: on(30, 10) } },
  { key: 'EQP-10', fields: { summary: 'Recent', status: { name: 'To Do', statusCategory: cat('new') }, updated: on(2, 10) } }], NOW);
T.check('quietest first; done and recent ones left out; who has it (or not assigned)', stuck.length === 2 && stuck[0].key === 'EQP-8' && stuck[0].quiet === 20 && stuck[0].assignee === 'Ana' && stuck[1].assignee === 'Not assigned', JSON.stringify(stuck));

T.section('as text');
const dt = P.dayText(d(0), 'EQP');
T.check('a day: its numbers, its status changes counted by from → to, then the stories by what happened', /^Fri 13 Nov 2026 — Jira EQP: 1 closed · 0 new · 3 status changes · 2 stories touched · 1 comment\nStatus changes \(3\): Closed → In Progress 1, In Progress → Closed 1, In Review → Closed 1\nClosed \(1\):\n  EQP-2 Billing totals — In Progress → Closed \(Dev\)\nUpdated: EQP-1$/.test(dt), dt);
const pt = P.periodText(p, 'EQP', stuck);
T.check('the window: totals (net +2), best day, who closed most, stuck, then a line a day (newest first; empty weekends left out)', /^Jira EQP · the last 14 days \(Sat 31 Oct 2026 – Fri 13 Nov 2026\): 3 closed, 1 new \(net \+2\), 1 reopened, 5 stories touched; 0\.3 closed a working day\./.test(pt)
  && /Best day: Fri 13 Nov \(1 closed\)\.\nStatus changes: 7 \(4 stories\) — Closed → In Progress 1, Doing → Released 1, In Progress → Closed 1, In Progress → Done 1, In Review → Closed 1, Selected → In Progress 1…\./.test(pt) && /Closed most: Ana \(2\), Dev \(1\)\./.test(pt) && /Stuck \(open, no change for 5\+ days\): 2 — EQP-8 \(20 d\), EQP-7 \(9 d\)\./.test(pt)
  && /\n\nFri 13 Nov: 1 closed · 0 new · 3 status changes · 2 touched — EQP-2\nThu 12 Nov: 1 closed/.test(pt) && /Sun 8 Nov: 0 closed · 0 new · 1 status change · 1 touched/.test(pt) && !/Sat 7 Nov/.test(pt), pt);

T.section('a chosen window: From – To');
const key = (back) => P.dayKey(new Date(m0.getTime() - back * DAY + 3 * 3600000).getTime());
const pr = P.progressOf(issues, { from: key(6), to: key(2), now: NOW });
T.check('From 6 days back To 2 days back: 5 days, none of them today; what happened after To left out (yesterday\'s close, today\'s)', pr.custom && pr.n === 5 && pr.days[0].key === key(6) && pr.days[4].key === key(2)
  && !pr.days.some((x) => x.today) && !pr.endsToday && pr.totals.closed === 1 && pr.days[2].stories.closed[0].key === 'EQP-5' && pr.totals.created === 1 && pr.totals.touched === 3, JSON.stringify(pr.totals));
T.check('…said as dates: the window, and the summary', P.windowText(pr) === 'Sat 7 Nov 2026 – Wed 11 Nov 2026 (5 days)' && /^Jira EQP · Sat 7 Nov 2026 – Wed 11 Nov 2026 \(5 days\): 1 closed, 1 new/.test(P.periodText(pr, 'EQP', [])), P.windowText(pr));
T.check('…To before From: turned round; To in the future: today', P.progressOf(issues, { from: key(2), to: key(6), now: NOW }).days[0].key === key(6)
  && (() => { const f = P.progressOf(issues, { from: key(3), to: '2027-01-30', now: NOW }); return f.n === 4 && f.endsToday && f.custom && f.totals.closed === 2; })());
T.check('…at most ' + P.MAX_SPAN + ' days (ending at To); not dates: the last days instead', P.progressOf([], { from: '2025-01-01', to: key(0), now: NOW }).n === 92 && P.progressOf([], { from: '2025-01-01', to: key(0), now: NOW }).days[91].key === key(0)
  && !P.progressOf([], { from: 'soon', to: key(0), days: 7, now: NOW }).custom && P.progressOf([], { from: '2026-02-30', to: key(0), days: 7, now: NOW }).n === 7);
T.check('…the search: changed since From, created by To', P.jql(14, 'EQP', { from: '2026-11-07', to: '2026-11-11' }) === 'project = EQP AND updated >= "2026-11-07" AND created <= "2026-11-11 23:59" ORDER BY updated DESC'
  && P.jql(14, 'EQP', { from: '2026-11-11', to: '2026-11-07' }) === 'project = EQP AND updated >= "2026-11-07" AND created <= "2026-11-11 23:59" ORDER BY updated DESC');

T.section('reading Jira');
T.check('the JQL: the window (1 to 60 days); the stuck search', P.jql(14) === 'project = EQP AND updated >= -14d ORDER BY updated DESC' && P.jql(90, 'ABC') === 'project = ABC AND updated >= -60d ORDER BY updated DESC'
  && P.stuckJql() === 'project = EQP AND statusCategory != Done AND updated <= -5d ORDER BY updated ASC');
(async () => {
  const calls = [];
  const Actions = { callRest: async (ctx, req) => {
    calls.push(req.uriParams);
    if (/statusCategory != Done/.test(req.uriParams.jql)) return { ok: true, status: 200, body: { issues: [{ key: 'EQP-8', fields: { summary: 'Quiet', status: { name: 'To Do', statusCategory: cat('new') }, updated: on(8, 9) } }] } };
    if (!req.uriParams.nextPageToken) return { ok: true, status: 200, body: { issues: issues.slice(0, 2), nextPageToken: 'p2', isLast: false } };
    return { ok: true, status: 200, body: { issues: issues.slice(2), isLast: true } };
  } };
  const r = await P.load({}, Actions, { days: 14, now: NOW });
  T.check('two pages (the changelog asked for), then the stuck search: the progress and the stuck', r.ok && calls.length === 3 && calls[0].expand === 'changelog' && calls[1].nextPageToken === 'p2' && /statusCategory != Done/.test(calls[2].jql)
    && r.progress.totals.closed === 3 && r.progress.read === 5 && r.stuck.length === 1 && r.stuck[0].key === 'EQP-8', JSON.stringify(calls.map((c) => c.jql)));
  const no = await P.load({}, { callRest: async () => ({ ok: false, status: 401, body: {} }) }, { days: 7, now: NOW });
  T.check('Jira not connected: said so', !no.ok && no.notConnected && /Jira is not connected/.test(no.message));
  const half = await P.load({}, { callRest: async (c, req) => (/statusCategory/.test(req.uriParams.jql) ? { ok: false, status: 500, body: {} } : { ok: true, status: 200, body: { issues: issues, isLast: true } }) }, { days: 7, now: NOW });
  T.check('the stuck search failing: the progress still shown', half.ok && half.progress.totals.closed === 3 && half.stuck.length === 0 && half.stuckRead === false);
  const asked = [];
  const quiet = (i) => ({ key: 'EQP-' + (500 + i), fields: { summary: 'Quiet ' + i, status: { name: 'To Do', statusCategory: cat('new') }, updated: on(9 + (i % 5), 9) } });
  const many = await P.load({}, { callRest: async (c, req) => {
    asked.push(req.uriParams);
    if (/statusCategory/.test(req.uriParams.jql)) { const pg = Number(req.uriParams.nextPageToken || 0); return { ok: true, status: 200, body: { issues: [...Array(100).keys()].map((i) => quiet(pg * 100 + i)), nextPageToken: String(pg + 1), isLast: false } }; }
    return { ok: true, status: 200, body: { issues: issues, isLast: true } };
  } }, { from: key(6), to: key(2), now: NOW });
  T.check('From – To asked of Jira; the window\'s days', many.ok && asked[0].jql === P.jql(14, 'EQP', { from: key(6), to: key(2) }) && many.progress.custom && many.progress.n === 5, asked[0].jql);
  T.check('more than 300 stuck: 3 pages read, said as more (300+)', many.stuck.length === 300 && many.stuckMore && many.stuck.more && asked.filter((a) => /statusCategory/.test(a.jql)).length === 3
    && /Stuck \(open, no change for 5\+ days\): 300\+ — /.test(P.periodText(many.progress, 'EQP', many.stuck)));
  T.report();
})();
