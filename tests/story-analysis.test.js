/*
 * "Analyze with AI" for a Jira story (webApps/equiprite-next/resources/js/storyAnalysis.js): the prompt the shared Ask AI
 * is given (story + sub-tasks + comments + FDD + the page list), the follow-up chat prompt, and the Markdown→HTML render.
 * Pure — loaded straight, no page, no DOM.
 *
 * Run:  node tests/story-analysis.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const sandbox = { console };
let SA;
sandbox.define = (names, factory) => { SA = factory(); };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js', 'storyAnalysis.js'), 'utf8'), sandbox, { filename: 'storyAnalysis.js' });

const STORY = {
  key: 'EQP-12', summary: 'Equipment Master List View', status: 'DEVELOPMENT', assignee: 'Rahul Kanth Panganamamula',
  sprint: '2026-07', epicKey: 'EQP-1', epicName: 'Equipment Registry', labels: ['cianbro'],
  body: 'List of equipment records with smart search.', ac: 'Grid shows all columns; smart search works; filters functional.',
  subtaskList: [{ key: 'EQP-12-1', summary: 'Wire the grid to smart search', status: 'DEVELOPMENT', assignee: 'Sana' },
    { key: 'EQP-12-2', summary: 'Add the Type column', status: 'Done', assignee: '' }],
  comments: [{ author: 'Sana', text: 'Type column missing. Map view missing. Edit option to be added.' }],
};
const PAGES = [{ label: 'Equipment master', keywords: 'catalog items classes import' }, { label: 'Availability', keywords: 'schedule gantt' }];

T.section('storyText carries the story, its sub-tasks and comments');
const st = SA.storyText(STORY);
T.check('the header, status and epic', /EQP-12: Equipment Master List View/.test(st) && /Status: DEVELOPMENT/.test(st) && /Epic: EQP-1 Equipment Registry/.test(st));
T.check('acceptance criteria, sub-tasks and comments are included', /Acceptance criteria:/.test(st) && /EQP-12-1 Wire the grid/.test(st) && /Sana: Type column missing/.test(st));

T.section('the analysis prompt');
const p = SA.prompt(STORY, PAGES, 'FDD 7.2: the equipment master list shows all columns and smart search.');
T.check('the system prompt pins the five headings', /## Requirement/.test(p.system) && /## Current situation/.test(p.system) && /## What to do next/.test(p.system) && /## Risks & open questions/.test(p.system) && /## Suggested EquipRite page/.test(p.system));
T.check('invents nothing', /only on the information given|do not invent/i.test(p.system));
T.check('the user turn carries the story, the FDD section and the page list', /EQP-12/.test(p.user) && /FDD 7.2/.test(p.user) && /Equipment master \(catalog items/.test(p.user));

T.section('the follow-up chat prompt keeps the story + history');
const cp = SA.chatPrompt(STORY, [{ role: 'user', text: 'is the map view done?' }, { role: 'assistant', text: 'No, it is missing.' }], 'what about edit?');
T.check('context, prior turns and the new question', /CONTEXT/.test(cp.user) && /EQP-12/.test(cp.user) && /User: is the map view done\?/.test(cp.user) && /Assistant: No, it is missing\./.test(cp.user) && /User: what about edit\?/.test(cp.user));

T.section('Markdown → safe HTML');
const html = SA.renderHtml('## Requirement\n- show the **grid**\n- smart search\n\n## Current situation\nType column missing.');
T.check('headings become <h3>, bullets a <ul>, bold kept, paragraphs wrapped', /<h3>Requirement<\/h3>/.test(html) && /<ul><li>show the <strong>grid<\/strong><\/li><li>smart search<\/li><\/ul>/.test(html) && /<h3>Current situation<\/h3>/.test(html) && /<p>Type column missing.<\/p>/.test(html));
T.check('HTML in the markdown is escaped (no injection)', SA.renderHtml('- <img src=x onerror=alert(1)>').indexOf('<img') === -1 && SA.renderHtml('- <b>x</b>').indexOf('&lt;b&gt;') !== -1);

T.section('several stories analysed together');
const S2 = { key: 'EQP-13', summary: 'Equipment Master Create/Edit', status: 'DEVELOPMENT', fdd: ['7.2', '7.2.5G'], ac: 'created; unique name' };
const ps = SA.promptSet([STORY, S2], PAGES, '');
T.check('every story, one after another, numbered', /STORIES \(2\):/.test(ps.user) && /===== Story 1 of 2 =====\nSTORY EQP-12/.test(ps.user) && /===== Story 2 of 2 =====\nSTORY EQP-13/.test(ps.user));
T.check('the set\'s headings, story by story as "### KEY", the order of work numbered; no FDD check without an FDD',
  SA.HEADINGS_SET.every((h) => ps.system.indexOf('## ' + h) !== -1) && /### KEY summary/.test(ps.system) && /1\. KEY — why/.test(ps.system) && ps.system.indexOf('FDD check') === -1);
const psf = SA.promptSet([STORY, S2], PAGES, { name: 'EquipRite FDD · v1.7', text: '### FDD 7.2 Equipment master list\nThe list.' });
T.check('with an FDD: its excerpts and an FDD check, cited by key and [FDD n]', /FDD excerpts from "EquipRite FDD · v1\.7"/.test(psf.user) && /## FDD check/.test(psf.system) && /\[FDD n\]/.test(psf.system));
const big = Array.from({ length: 20 }, (_, i) => Object.assign({}, STORY, { key: 'EQP-' + (100 + i), body: 'x '.repeat(5000) }));
const pb = SA.promptSet(big, [], '');
T.check('twenty long stories: each cut to its share, so the whole stays bounded', pb.user.length < 80000 && (pb.user.match(/… \(cut to fit\)/g) || []).length === 20, String(pb.user.length));
const cs = SA.chatPromptSet([STORY, S2], [{ role: 'user', text: 'which first?' }, { role: 'assistant', text: 'EQP-12.' }], 'why?');
T.check('the chat about the set carries the stories and the conversation', /set of EquipRite Jira stories/.test(cs.system) && /STORY EQP-13/.test(cs.user) && /User: which first\?/.test(cs.user) && /User: why\?$/.test(cs.user));
T.check('a numbered list renders as <ol> (the order of work), bullets stay <ul>', SA.renderHtml('## Suggested order of work\n1. EQP-12 — first\n2. EQP-13 — then\n- note').replace(/\s/g, '') === '<h3>Suggestedorderofwork</h3><ol><li>EQP-12—first</li><li>EQP-13—then</li></ol><ul><li>note</li></ul>');

T.section('the FDD sections for a set: every section any story names, all their words');
let R;
const rs = { console, define: (deps, f) => { R = f(SA, {}, {}, {}); } };
vm.createContext(rs);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js', 'storyAnalysisRun.js'), 'utf8'), rs, { filename: 'storyAnalysisRun.js' });
const m = R.merged([Object.assign({}, STORY, { fdd: ['7.2'] }), S2]);
T.check('refs once each (7.2, 7.2.5G), summaries and criteria joined', JSON.stringify(m.fdd) === '["7.2","7.2.5G"]' && /Equipment Master List View\nEquipment Master Create\/Edit/.test(m.summary) && /unique name/.test(m.ac) && m.key === 'EQP-12,EQP-13');

T.report();
