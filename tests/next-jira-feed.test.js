#!/usr/bin/env node
'use strict';
/**
 * The Jira updates bell (webApps/equiprite-next/resources/js/jiraFeed.js): what changed in Jira lately, from one search
 * with the changelog and comments — a new story, a status change, an assignment (to me: mine), priority, sprint, an
 * attachment, edits, a comment — newest first; the board's ordering and time tracking left out; nothing older than the
 * window; by day; the kind chips; how many came since the bell was last opened; the JQL.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
let F = null;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js', 'jiraFeed.js'), 'utf8'), { define: (deps, f) => { F = f(); } });

const NOW = Date.parse('2026-11-13T15:00:00Z');
const at = (h) => new Date(NOW - h * 3600000).toISOString();
const ana = { accountId: 'me-1', displayName: 'Ana' };
const ben = { accountId: 'u-2', displayName: 'Ben' };
const issues = [
  { key: 'EQP-41', fields: { summary: 'Rental rates by branch', issuetype: { name: 'Story' }, status: { name: 'In Progress' }, priority: { name: 'High' }, assignee: ana, reporter: ben, created: at(5),
    comment: { comments: [{ created: at(2), author: ben, body: 'Can we *also* show [the FDD|https://x] rates? [~accountid:me-1]' }, { created: at(80), author: ben, body: 'old' }] } },
    changelog: { histories: [
      { created: at(4), author: ben, items: [{ field: 'status', fromString: 'To Do', toString: 'In Progress' }, { field: 'Rank', fromString: '', toString: 'Ranked higher' }, { field: 'assignee', from: null, to: 'me-1', fromString: '', toString: 'Ana' }] },
      { created: at(3), author: ana, items: [{ field: 'priority', fromString: 'Medium', toString: 'High' }, { field: 'Sprint', fromString: 'Sprint 4', toString: 'Sprint 5' }, { field: 'timespent', fromString: '', toString: '3600' }] }] } },
  { key: 'EQP-12', fields: { summary: 'Old one', issuetype: { name: 'Bug' }, status: { name: 'Done' }, assignee: ben, created: at(400) },
    changelog: { histories: [{ created: at(30), author: ana, items: [{ field: 'resolution', fromString: '', toString: 'Done' }, { field: 'Attachment', fromString: '', toString: 'screen.png' }, { field: 'labels', fromString: '', toString: 'billing' }, { field: 'description', fromString: 'a', toString: 'b' }] },
      { created: at(100), author: ana, items: [{ field: 'status', fromString: 'To Do', toString: 'Done' }] }] } },
];
const ev = F.eventsOf(issues, NOW - 2 * 86400000, 'me-1');
T.eq('every change in the window, newest first, as words', ev.map((e) => e.key + ' ' + e.kind + ': ' + e.text).join(' | '),
  'EQP-41 comment: Can we also show the FDD rates? @someone | EQP-41 priority: Priority Medium → High | EQP-41 sprint: Sprint: Sprint 5 (was Sprint 4) | '
  + 'EQP-41 status: To Do → In Progress | EQP-41 assign: Assigned to Ana | EQP-41 new: New story · High · for Ana | '
  + 'EQP-12 status: Resolved: Done | EQP-12 attach: Attached screen.png | EQP-12 edit: Labels: billing | EQP-12 edit: Description changed');
T.check('…the board\'s ordering and time tracking left out; nothing older than two days', !ev.some((e) => /Rank|timespent|old|To Do → Done/.test(e.field + e.text)));
T.check('who did it, and when', ev[0].by === 'Ben' && ev[0].at === at(2) && ev.filter((e) => e.kind === 'priority')[0].by === 'Ana');
T.check('mine: what is assigned to me, or was just given to me', ev.filter((e) => e.key === 'EQP-41').every((e) => e.mine) && !ev.filter((e) => e.key === 'EQP-12').some((e) => e.mine));
const g = F.grouped(ev, 'all', NOW);
T.check('by day: Today, then Yesterday', g.length === 2 && g[0].label === 'Today' && g[0].items.length === 6 && g[1].label === 'Yesterday' && /^\d\d:\d\d$/.test(g[0].items[0].time), JSON.stringify(g.map((x) => x.label + ' ' + x.items.length)));
T.check('…one kind only, or mine', F.grouped(ev, 'status', NOW).reduce((n, x) => n + x.items.length, 0) === 2 && F.grouped(ev, 'mine', NOW).reduce((n, x) => n + x.items.length, 0) === 6);
const c = F.chips(ev);
T.eq('the kind chips, with how many (only kinds that have some)', c.map((x) => x.label + ' ' + x.n).join(', '), 'All 10, Mine 6, New 1, Status 2, Assigned 1, Comments 1, Priority 1, Sprint 1, Attachments 1, Edits 2');
T.check('new since the bell was last opened (never: all)', F.newSince(ev, '') === 10 && F.newSince(ev, at(3.5)) === 3 && F.newSince(ev, new Date(NOW).toISOString()) === 0);
T.eq('the search: the project, updated in the window, newest first', F.jql(2), 'project = EQP AND updated >= -2d ORDER BY updated DESC');
T.check('…days kept between 1 and 14', F.jql(0) === 'project = EQP AND updated >= -2d ORDER BY updated DESC' && /-14d/.test(F.jql(99)) && /-7d/.test(F.jql(7)));
T.eq('a comment in the Atlassian document format, plain', F.plain({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: ' there' }] }] }), 'Hello there');
T.report();
