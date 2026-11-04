/*
 * EquipRite Next, Compare rates (resources/js/rateCompare.js over rateRules.js): what can be picked, the base, each
 * tier's Rate / day side by side with the cheapest and dearest marked and each against the base, a schedule without
 * the equipment, only the differences, a rental priced by each schedule by the engine's rule, the summary and the export.
 *
 * Run:  node tests/next-rate-compare.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js');
function load(name, deps) {
  const sandbox = { console, Intl, Date, JSON, Math, Number, String, Array, Object, isNaN };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}
const fmt = load('fmt');
const R = load('rateRules', { 'resources/js/fmt': fmt });
const RC = load('rateCompare', { 'resources/js/rateRules': R });
const plain = (x) => JSON.parse(JSON.stringify(x));
const eq = (r) => r.title.split(' · ')[2].split(' ')[0];

const AV = { classId: 7, className: 'Audio Visual', subclassId: 71, subclassName: 'Audio', calcMethod: 'UTILIZED_DURATION', calcBasis: 'DAILY', rateType: 'USAGE', location: '' };
const L = (id, eq, period, threshold, periodAmount, costRate) => Object.assign({ id, equipmentName: eq, period, threshold, periodAmount, costRate, billRate: 0 }, AV);
const AVID = 'Avid VENUE S6L-32D Touring Mixing Console';
const SUB = 'd&b audiotechnik SL-SUB Cardioid Subwoofer';
const A = [L(1, AVID, 'DAILY', 0, 900, 900), L(2, AVID, 'WEEKLY', 5, 5040, 720), L(3, AVID, 'MONTHLY', 26, 17550, 585),
  L(4, SUB, 'DAILY', 0, 240, 240), L(5, SUB, 'WEEKLY', 5, 1344, 192)];
const B = [L(11, AVID, 'DAILY', 0, 950, 950), L(12, AVID, 'WEEKLY', 7, 4900, 700), L(13, AVID, 'MONTHLY', 26, 17550, 585),
  L(14, SUB, 'DAILY', 0, 240, 240)];
const C = [L(21, AVID, 'DAILY', 0, 850, 850)];
const S = [{ id: 1, name: 'Houston', currency: 'USD', lines: A }, { id: 2, name: 'Pipeline North', currency: 'USD', lines: B },
  { id: 3, name: 'Odessa', currency: 'USD', lines: C }];

T.section('what can be picked, and the base');
const rows = [{ id: 9, scheduleName: 'Zeta', status: 'ACTIVE', currency: 'USD', customer: '—', project: '—', yard: 'Houston', startDate: '2026-01-01', endDate: '—' },
  { id: 10, scheduleName: 'Alpha', status: 'INACTIVE', currency: 'USD', customer: '—', project: '—', yard: '—', startDate: '—', endDate: '—' },
  { id: 11, scheduleName: 'Beta', status: 'ACTIVE', currency: 'SAR', customer: 'Acme', project: '—', yard: '—', startDate: '—', endDate: '—' }];
T.eq('active first, then by name; who uses it, when, the currency', RC.pickable(rows).map((s) => s.name + ' / ' + s.sub).join(' | '),
  'Beta / Customer Acme · No dates · SAR | Zeta / Yard Houston · From 1 Jan 2026 · USD | Alpha / No tags: the fallback rates · No dates · USD');
T.eq('the default: the active ones', RC.defaultPick(rows, 3).join(), '11,9');
T.eq('pick, unpick', [RC.toggle(['1'], 2).join(), RC.toggle(['1', '2'], '1').join()].join(' / '), '1,2 / 2');
T.eq('at most six', RC.toggle(['1', '2', '3', '4', '5', '6'], 7).length, 6);
T.eq('made the base: to the front', RC.makeBase(['1', '2', '3'], 3).join(), '3,1,2');

T.section('each tier side by side');
const v = RC.compare(S, { mode: 'tiers' });
T.eq('a row per equipment and tier, in the periods\' order', v.rows.map((r) => eq(r) + ' ' + r.periodLabel).join(' | '),
  'Avid Daily | Avid Weekly | Avid Monthly | d&b Daily | d&b Weekly');
const day = v.rows[0];
T.eq('Avid daily: Rate / day in each schedule', ['1', '2', '3'].map((id) => day.cells[id].main).join(' | '), '$900 / day | $950 / day | $850 / day');
T.eq('…the cheapest and the dearest marked', ['1', '2', '3'].map((id) => day.cells[id].note || '-').join(','), '-,Dearest,Cheapest');
T.eq('…each against the base', ['1', '2', '3'].map((id) => day.cells[id].diff || '-').join(','), '-,+5.6%,−5.6%');
T.eq('…with its Period total and Threshold', day.cells['1'].lines.join(' · '), 'Period total $900 · Threshold 0 days');
const wk = v.rows[1];
T.eq('a tier starting elsewhere says so', wk.cells['2'].lines.join(' · '), 'Period total $4,900 · Threshold 7 days · Starts at 7, the base at 5');
T.eq('a schedule without it: not in it, and left out of the marks', [wk.cells['3'].main, wk.cells['3'].lines[0], wk.cells['1'].note, wk.cells['2'].note].join(' | '),
  '— | Not in this schedule | Dearest | Cheapest');
T.check('the same everywhere: no marks, not a difference', v.rows[3].differ === false || v.rows[3].cells['3'].has === false);
T.eq('the monthly rates agree where both have it, the third has none: a difference', [v.rows[2].differ, v.rows[2].cells['2'].diff].join(), 'true,Same');

T.section('narrowing');
T.eq('a tier', RC.compare(S, { period: 'WEEKLY' }).rows.map((r) => r.periodLabel).join(), 'Weekly,Weekly');
T.eq('a search (every word)', RC.compare(S, { text: 'subwoofer daily' }).rows.length + RC.compare(S, { text: 'sl-sub' }).rows.length, 0 + 2);
const two = RC.compare(S.slice(0, 2), { onlyDiff: true });
T.eq('only where they differ (two schedules)', two.rows.map((r) => eq(r) + ' ' + r.periodLabel).join(' | '), 'Avid Daily | Avid Weekly | d&b Weekly');
T.eq('…and how many', [two.total, two.differ, two.rows.length].join(), '5,3,3');

T.section('the columns and the summary');
T.eq('per schedule: cheapest and dearest counts, the average against the base', plain(v.cols).map((c) => c.name + ' ' + c.cheapest + '/' + c.dearest + ' ' + c.avg).join(' | '),
  'Houston 0/1 The base | Pipeline North 1/1 +0.7% against the base on average | Odessa 1/0 −5.6% against the base on average');
T.eq('the line over it', v.text, '5 of 5 rates differ · cheapest most often: Pipeline North (1), Odessa (1)');
T.eq('one schedule: asks for another', RC.compare(S.slice(0, 1), {}).text, 'Pick another schedule to compare it with.');
T.check('other currencies: said, not converted', RC.compare([S[0], Object.assign({}, S[1], { currency: 'SAR' })], {}).text.includes('in USD and SAR: compared as numbers, not converted'));

T.section('a rental priced by each schedule (the engine\'s rule)');
const r14 = RC.compare(S, { mode: 'rental', days: 14 });
T.eq('a row per equipment', r14.rows.map((r) => eq(r) + ' ' + r.periodLabel).join(' | '), 'Avid For 14 days | d&b For 14 days');
const avid = r14.rows[0];
T.eq('14 days: each schedule\'s cost', ['1', '2', '3'].map((id) => avid.cells[id].main).join(' | '), '$10,080 | $9,800 | $11,900');
T.eq('…and why', ['1', '2', '3'].map((id) => avid.cells[id].lines[0]).join(' | '),
  'Weekly tier · 14 × $720 a day | Weekly tier · 14 × $700 a day | Daily tier · 14 × $850 a day');
T.eq('…the marks and against the base', ['1', '2', '3'].map((id) => (avid.cells[id].note || '-') + ' ' + (avid.cells[id].diff || '-')).join(', '),
  '- -, Cheapest −2.8%, Dearest +18.1%');
const r3 = RC.compare(S, { mode: 'rental', days: 3, qty: 2 });
T.eq('3 days of two: the daily tier', r3.rows[0].cells['1'].lines[0] + ' = ' + r3.rows[0].cells['1'].main, 'Daily tier · 2 × 3 × $900 a day = $5,400');

T.section('the export');
const cols = RC.exportColumns(v.cols, v.mode);
T.eq('a value, against the base and a note per schedule', cols.map((c) => c.label).join(' | '),
  'Equipment | Location · rate type | Calc method | Tier | Houston rate / day (USD) | Houston note | Pipeline North rate / day (USD) | Pipeline North against the base | Pipeline North note'
  + ' | Odessa rate / day (USD) | Odessa against the base | Odessa note');
T.eq('…a row', JSON.stringify(cols.map((c) => (c.value ? c.value(wk) : wk[c.key]))),
  JSON.stringify([AVID.replace(/^/, 'Audio Visual · Audio · '), 'All locations · Usage', 'Utilized · worked days', 'Weekly', 720, 'Dearest', 700, '−2.8%', 'Cheapest', '', '', 'Not in this schedule']));
T.report();
