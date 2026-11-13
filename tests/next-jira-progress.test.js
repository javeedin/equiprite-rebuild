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
T.check('a day: its numbers, then the stories by what happened', /^Fri 13 Nov 2026 — Jira EQP: 1 closed · 0 new · 0 moved · 2 stories touched · 1 comment\nClosed \(1\):\n  EQP-2 Billing totals — In Progress → Closed \(Dev\)\nUpdated: EQP-1$/.test(dt), dt);
const pt = P.periodText(p, 'EQP', stuck);
T.check('the window: totals (net +2), best day, who closed most, stuck, then a line a day (newest first; empty weekends left out)', /^Jira EQP · the last 14 days \(Sat 31 Oct 2026 – Fri 13 Nov 2026\): 3 closed, 1 new \(net \+2\), 1 reopened, 5 stories touched; 0\.3 closed a working day\./.test(pt)
  && /Best day: Fri 13 Nov \(1 closed\)\./.test(pt) && /Closed most: Ana \(2\), Dev \(1\)\./.test(pt) && /Stuck \(open, no change for 5\+ days\): 2 — EQP-8 \(20 d\), EQP-7 \(9 d\)\./.test(pt)
  && /\n\nFri 13 Nov: 1 closed · 0 new · 0 moved · 2 touched — EQP-2\nThu 12 Nov: 1 closed/.test(pt) && /Sun 8 Nov: 0 closed · 0 new · 1 moved/.test(pt) && !/Sat 7 Nov/.test(pt), pt);

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
  T.report();
})();
