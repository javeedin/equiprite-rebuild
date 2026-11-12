/*
 * Which FDD sections "Analyze with AI" reads for a story (webApps/equiprite-next/resources/js/fddIndex.js), and the
 * analysis/chat prompts with an FDD (storyAnalysis.js): the sections the story names (with their subsections, or the
 * closest one), ids by where they are mentioned, the best word matches, a budget, the selector's options, citations.
 * Pure — loaded straight, no page, no DOM.
 *
 * Run:  node tests/fdd-index.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
function load(file) {
  let out;
  const sandbox = { console, define: (deps, factory) => { out = factory(); } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js', file), 'utf8'), sandbox, { filename: file });
  return out;
}
const FI = load('fddIndex.js');
const SA = load('storyAnalysis.js');

const long = (w, n) => Array(n).fill(w).join(' ');
const DOC = { id: 'fdd-v1-7', name: 'EquipRite FDD', version: '1.7', sections: [
  { n: '', t: '(Front matter)', l: 0, x: 'Document control.' },
  { n: '7', t: 'Equipment registry', l: 1, x: 'The registry of equipment.' },
  { n: '7.2', t: 'Equipment master list', l: 2, x: 'The master list shows every equipment record in a grid with smart search and filters.' },
  { n: '7.2.1', t: 'Columns', l: 3, x: 'Columns: number, description, type, class, status, yard.' },
  { n: '7.2.5', t: 'Map view', l: 3, x: 'A map view shows where each unit is.' },
  { n: '7.2.5G', t: 'Map clustering', l: 3, x: 'Units close together cluster on the map.' },
  { n: '7.3', t: 'Equipment detail', l: 2, x: 'One unit: its history, inspections and costs.' },
  { n: '8', t: 'Rentals', l: 1, x: 'Rental agreements and rates.' },
  { n: '8.4', t: 'Hire extensions', l: 2, x: 'Rules for extending a hire.\nBR-012: an extension over 30 days needs the manager to approve.\nOther rules follow.' },
  { n: '9', t: 'Timesheets', l: 1, x: long('timesheet hours approval', 50) },
] };
const STORY = { key: 'EQP-12', summary: 'Equipment Master List View', fdd: ['7.2'],
  body: 'List of equipment records with smart search.', ac: 'Grid shows all columns; smart search works; filters functional.' };

T.section('the sections the story names, with their subsections');
let p = FI.pick(DOC, STORY);
T.check('7.2 first, "named by the story", then 7.2.1, 7.2.5, 7.2.5G as "part of 7.2"',
  p.picked[0].n === '7.2' && p.picked[0].why === 'named by the story' && ['7.2.1', '7.2.5', '7.2.5G'].every((n) => p.picked.some((x) => x.n === n && x.why === 'part of 7.2')), JSON.stringify(p.picked));
T.check('the text the AI reads: a heading per section, with its parent', /### FDD 7\.2 Equipment master list \(in 7 Equipment registry\)\nThe master list shows/.test(p.text) && /### FDD 7\.2\.5G Map clustering \(in 7\.2\.5 Map view\)/.test(p.text), p.text.slice(0, 300));
T.check('7.3, a sibling, is not a subsection of 7.2', !p.picked.some((x) => x.n === '7.3' && /part of/.test(x.why)));

T.section('the closest section when the exact number is not in the document');
p = FI.pick(DOC, { key: 'EQP-9', summary: 'Rate card', fdd: ['8.4.2B'] });
T.check('8.4.2B → 8.4, said so', p.picked[0].n === '8.4' && /closest to 8\.4\.2B/.test(p.picked[0].why), JSON.stringify(p.picked));
p = FI.pick(DOC, { key: 'EQP-9', summary: 'Nothing related', fdd: ['42.1'] });
T.check('no section at all for 42.1 → nothing named', !p.picked.some((x) => /named|closest/.test(x.why)));

T.section('an id (BR-012) by where the document mentions it');
p = FI.pick(DOC, { key: 'EQP-30', summary: 'Approve long extensions', fdd: ['BR-012'] });
T.check('8.4, "mentions BR-012"', p.picked[0].n === '8.4' && p.picked[0].why === 'mentions BR-012' && /BR-012: an extension over 30 days/.test(p.text), JSON.stringify(p.picked));

T.section('the best word matches, when the story names no section');
p = FI.pick(DOC, { key: 'EQP-40', summary: 'Timesheet approval', body: 'Approve timesheet hours.' });
T.check('9 Timesheets, "matches …" with the words that matched', p.picked.length >= 1 && p.picked[0].n === '9' && /^matches .*timesheet/.test(p.picked[0].why), JSON.stringify(p.picked));
p = FI.pick(DOC, { key: 'EQP-41', summary: 'Xylophone quartz' });
T.check('nothing matches → nothing read', p.picked.length === 0 && p.text === '');
p = FI.pick(DOC, STORY, { question: 'what about the map clustering?' });
T.check('a chat question adds its own matches (and still the named sections)', p.picked[0].n === '7.2' && p.picked.some((x) => x.n === '7.2.5G'));

T.section('a budget: what the AI reads stays within it, a long section is cut and says so');
p = FI.pick(DOC, { key: 'EQP-40', summary: 'Timesheet approval hours', fdd: ['9'] }, { budget: 600 });
T.check('within the budget, the long section cut', p.text.length <= 600 && p.picked[0].cut === true && /… \(cut\)/.test(p.text), p.text.length + ' ' + JSON.stringify(p.picked));
T.check('an empty document reads nothing', FI.pick({ sections: [] }, STORY).picked.length === 0 && FI.pick(null, STORY).text === '');

T.section('a section, the outline, labels and the selector');
const s = FI.section(DOC, '7.2.5G');
T.check('a section by number, with its parent', s && s.t === 'Map clustering' && s.parent === '7.2.5 Map view');
T.check('a section without a number, by its title', FI.section(DOC, '(Front matter)').x === 'Document control.');
T.check('the outline', FI.outline(DOC).length === DOC.sections.length && FI.outline(DOC)[2].chars === DOC.sections[2].x.length);
T.eq('label', FI.label({ name: 'EquipRite FDD', version: 'v1.7' }), 'EquipRite FDD · v1.7');
const opts = FI.options({ latest: 'b', docs: [{ id: 'a', name: 'EquipRite FDD', version: '1.8', uploadedAt: '2026-11-12' }, { id: 'b', name: 'EquipRite FDD', version: '1.7', uploadedAt: '2026-11-01' }] });
T.check('the selector lists the latest first, marked "(latest)" — the others after, newest first',
  opts[0].id === 'b' && opts[0].label === 'EquipRite FDD · v1.7 (latest)' && opts[0].latest === true && opts[1].id === 'a' && !opts[1].latest, JSON.stringify(opts));

T.section('the analysis prompt with an FDD');
const pk = FI.pick(DOC, STORY);
const pr = SA.prompt(STORY, [{ label: 'Equipment master' }], { name: FI.label(DOC), text: pk.text });
T.check('six headings, the FDD check before the page', SA.HEADINGS_FDD.every((h) => pr.system.indexOf('## ' + h) !== -1) && pr.system.indexOf('## FDD check') < pr.system.indexOf('## Suggested EquipRite page'));
T.check('cites sections as [FDD n], never one not given', /\[FDD 7\.2\.5\]/.test(pr.system) && /Never cite a section that is not in the excerpts/.test(pr.system));
T.check('the user turn names the FDD and carries the excerpts', /FDD excerpts from "EquipRite FDD · v1\.7"/.test(pr.user) && /### FDD 7\.2 Equipment master list/.test(pr.user));
const none = SA.prompt(STORY, [], '');
T.check('without an FDD: the five headings, no FDD check', none.system === SA.SYSTEM && none.system.indexOf('FDD check') === -1);
const ch = SA.chatPrompt(STORY, [], 'which columns?', { name: 'EquipRite FDD · v1.7', text: '### FDD 7.2.1 Columns\nColumns: number…' });
T.check('the chat prompt carries the excerpts for the question, and asks for citations', /FDD excerpts from "EquipRite FDD · v1\.7" for this question/.test(ch.user) && /\[FDD 7\.2\.5\]/.test(ch.system));
T.check('a citation renders as a badge; HTML stays escaped', /<span class="fdd">FDD 7\.2\.5G<\/span>/.test(SA.renderHtml('- map clusters [FDD 7.2.5G]')) && SA.renderHtml('- [FDD <b>]').indexOf('<b>') === -1);

T.report();
