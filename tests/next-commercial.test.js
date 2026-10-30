/*
 * EquipRite Next, Commercial (Rates and Agreements): the rules (resources/js/rateRules.js, agreementRules.js, New
 * EquipRite's, unchanged), the bodies Save writes, the hand-off to New request, the record kind, and the page rules of
 * docs/redesign/BUILDING-NEXT-SCREENS.md. Loads the real modules.
 *
 * Run:  node tests/next-commercial.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const NEW = path.join(__dirname, '..', 'webApps', 'equiprite');
const JS = path.join(NEXT, 'resources', 'js');
const FLOW = path.join(NEXT, 'flows', 'commercial');

function load(name, deps) {
  const sandbox = { console, TextEncoder, URLSearchParams, Intl, Date, setTimeout, Number, Math, JSON, Object, Array, String, RegExp };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

const rules = load('rules');
const fmt = load('fmt');
const R = load('rateRules', { 'resources/js/rules': rules, 'resources/js/fmt': fmt });
const A = load('agreementRules', { 'resources/js/fmt': fmt });
const nav = load('nav', { 'resources/js/rules': rules });
const tabs = load('tabs', { 'resources/js/nav': nav });

// ── Rates ────────────────────────────────────────────────────────────────────────────────────────────────
T.section('rates: the period arithmetic (New\'s, unchanged)');
T.eq('days per period', ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'x'].map(R.periodUnits).join(), '1,1,7,30,90,365,1');
T.eq('the rate a period total makes (4 dp)', [R.deriveRate(3900, 'WEEKLY'), R.deriveRate(12800, 'MONTHLY'), R.deriveRate('', 'DAILY')].join('|'), '557.1429|426.6667|');
T.eq('the total a rate makes (2 dp)', [R.derivePeriodAmount(557.1429, 'WEEKLY'), R.derivePeriodAmount(120, 'HOURLY')].join(), '3900,120');
T.eq('an hourly-basis line carries only Hourly', ['HOURLY', 'DAILY'].map((p) => R.isPeriodAllowed(p, 'UTILIZED_DURATION', 'HOURLY')).join(), 'true,false');
T.eq('a complete-period line never Hourly', ['HOURLY', 'WEEKLY'].map((p) => R.isPeriodAllowed(p, 'COMPLETE_PERIOD', 'DAILY')).join(), 'false,true');
T.eq('a stranded period is coerced', [R.coercePeriod('WEEKLY', 'UTILIZED_DURATION', 'HOURLY'), R.coercePeriod('HOURLY', 'COMPLETE_PERIOD', 'DAILY')].join(), 'HOURLY,DAILY');

T.section('rates: one edit (the old grid\'s handleEditEnd)');
const wk = { id: 2, period: 'WEEKLY', calcMethod: 'COMPLETE_PERIOD', calcBasis: 'WEEKLY', threshold: 5, periodAmount: 3900, costRate: 557.1429, billRate: 4700 };
let e = R.applyLineEdit(wk, 'periodAmount', '4200');
T.eq('typing the total derives the rate', [e.ok, e.line.periodAmount, e.line.costRate].join('|'), 'true|4200|600');
e = R.applyLineEdit(wk, 'costRate', '600');
T.eq('typing the rate restates the total', [e.line.costRate, e.line.periodAmount].join('|'), '600|4200');
T.eq('a threshold is a whole number', R.applyLineEdit(wk, 'threshold', '6.8').line.threshold, 6);
T.eq('a negative or a word is refused', [R.applyLineEdit(wk, 'billRate', '-1').ok, R.applyLineEdit(wk, 'billRate', 'abc').ok].join(), 'false,false');
T.eq('a blank total means "none typed"', R.applyLineEdit(wk, 'periodAmount', '').line.periodAmount, null);
T.eq('a period the method cannot carry is refused', R.applyLineEdit(wk, 'period', 'HOURLY').ok, false);
e = R.applyLineEdit(Object.assign({}, wk, { calcMethod: 'UTILIZED_DURATION', calcBasis: 'DAILY' }), 'calcBasis', 'HOURLY');
T.eq('a basis that strands the period coerces it and restates the total', [e.line.period, e.line.periodAmount].join('|'), 'HOURLY|557.14');
T.check('the line given is not changed', wk.periodAmount === 3900 && wk.threshold === 5);

T.section('rates: the grid');
const EXC = { classId: 1, subclassId: 11, className: 'Excavators', subclassName: 'Crawler', equipmentName: 'CAT 320 Excavator', calcMethod: 'COMPLETE_PERIOD', rateType: 'USAGE' };
const lines = [
  Object.assign({ id: 1, period: 'DAILY', calcBasis: 'DAILY', threshold: 0, periodAmount: 880, costRate: 880, billRate: 1240, periodSeq: 1 }, EXC),
  Object.assign({ id: 2, period: 'WEEKLY', calcBasis: 'WEEKLY', threshold: 5, periodAmount: 3900, costRate: 557.1429, billRate: 4700, periodSeq: 2 }, EXC),
  Object.assign({ id: 3, period: 'MONTHLY', calcBasis: 'MONTHLY', threshold: 30, periodAmount: 12800, costRate: 426.6667, billRate: 12000, periodSeq: 3 }, EXC),
  { id: 4, classId: 2, className: 'Generators', equipmentName: 'Generator 100 kVA', period: 'HOURLY', calcMethod: 'UTILIZED_DURATION', calcBasis: 'HOURLY', rateType: 'USAGE',
    threshold: 0, periodAmount: 120, costRate: 120, billRate: 175, periodSeq: 7 },
];
const groups = R.groupLines(lines);
T.eq('a row per class / subclass / equipment / location / rate type', groups.map((g) => g.title).join(' | '), 'Excavators · Crawler · CAT 320 Excavator | Generators · Generator 100 kVA');
T.eq('the six periods, those the row can carry', groups[0].cells.map((c) => c.period + (c.allowed ? '+' : '-') + c.lines.length).join(), 'HOURLY-0,DAILY+1,WEEKLY+1,MONTHLY+1,QUARTERLY+0,YEARLY+0');
T.eq('an hourly row carries only Hourly', groups[1].cells.filter((c) => c.allowed).map((c) => c.period).join(), 'HOURLY');
T.eq('how a row is counted, in words', groups.map((g) => g.method).join(' | '), 'Complete period · calendar days | Utilized · logged hours');
T.eq('where each tier applies', JSON.stringify(plain(R.tierRanges(groups[0].lines))), '{"id:1":"1–4 days","id:2":"5–29 days","id:3":"30 days or more"}');
T.eq('a tier another shadows never applies (the longer period wins a tie)', R.tierRanges([
  Object.assign({}, lines[0]), Object.assign({}, lines[1], { threshold: 0 })])['id:1'], 'Never applies: Weekly starts at the same point');
T.eq('hours and days are read apart', JSON.stringify(plain(R.tierRanges([lines[3], Object.assign({}, lines[3], { id: 5, threshold: 8 })]))), '{"id:4":"1–7 h","id:5":"8 h or more"}');
T.eq('margins', lines.map((l) => R.margin(l).state + ' ' + R.margin(l).text).join(' | '), 'ok +29% | ok +17% | low -6.7% | ok +31.4%');
T.eq('no bill rate is not judged', R.margin(Object.assign({}, lines[0], { billRate: 0 })).state, 'none');
T.eq('the margin check, worded', R.marginIssues(lines).map((i) => i.text).join(), 'Excavators · Crawler · CAT 320 Excavator · Monthly: bill $12,000 is below cost $12,800.');
const nq = R.newLine(lines[0], 'QUARTERLY', 3, 'new:1');
T.eq('a new period: one period after the first, no total yet, the row\'s method', [nq.threshold, nq.periodAmount, nq.costRate, nq.calcMethod, nq.calcBasis, nq.equipmentName].join('|'),
  '90||0|COMPLETE_PERIOD|DAILY|CAT 320 Excavator');
T.eq('a first line starts at 0; a second hourly tier at 8', [R.newLine(lines[3], 'HOURLY', 0, 'k').threshold, R.newLine(lines[3], 'HOURLY', 1, 'k').threshold].join(), '0,8');
T.eq('lines sort class, subclass, equipment, blanks first', R.sortLines([{ className: 'B' }, { className: '' }, { className: 'A', subclassName: 'z' }, { className: 'A' }])
  .map((l) => (l.className || '-') + (l.subclassName || '')).join(), '-,A,Az,B');

T.section('rates: try a rate (the engine\'s rules)');
let sim = R.simulate(lines.slice(0, 3), { daysOnRent: 17, qty: 1 });
T.eq('17 days of a 320 excavator: the Weekly tier, 17 × the day rate', [sim.rows[0].periodLabel, sim.rows[0].units, sim.rows[0].rate, sim.rows[0].cost, sim.rows[0].periods, sim.rows[0].bill].join('|'),
  'Weekly|17|557.1429|9471.43|2.43|11414.29');
T.eq('New\'s words for it', sim.rows[0].text, '17 days on rent reach the Weekly tier (from 5 days) → 17 × $557.1429/day = $9,471.43 (2.43 weeks at $3,900)');
T.eq('below the first threshold nothing applies', R.simulate([Object.assign({}, lines[1])], { daysOnRent: 3 }).rows[0].text, 'No line applies: every threshold is above the duration.');
T.eq('quantity multiplies', R.simulate(lines.slice(0, 3), { daysOnRent: 17, qty: 2 }).rows[0].cost, 18942.86);
T.eq('above the last threshold the longest period applies', R.simulate(lines.slice(0, 3), { daysOnRent: 400 }).rows[0].periodLabel, 'Monthly');
sim = R.simulate(lines, { daysOnRent: 17, hours: 80, daysWorked: 10, qty: 1 });
T.eq('each row counts its own unit; the total', [sim.rows[1].unitWord, sim.rows[1].cost, sim.total].join('|'), 'logged hours|9600|19071.43');
T.eq('only Usage lines are priced', R.simulate([Object.assign({}, lines[0], { rateType: 'STANDBY' })], { daysOnRent: 5 }).rows.length, 0);
T.eq('the inputs a row needs', [R.simInputs(lines.slice(0, 3)).map((i) => i.key).join('+'), R.simInputs(lines).map((i) => i.key).join('+'),
  R.simInputs([Object.assign({}, lines[3], { calcBasis: 'DAILY' })]).map((i) => i.key).join('+')].join(' | '), 'daysOnRent | daysOnRent+hours | daysWorked');

T.section('rates: the list');
const yardNames = new Map([[300, 'Houston Yard'], [400, 'Odessa Yard']]);
const flags = { PROJECTS_MODULE_ENABLED: 'true' };
const sources = { 1: 'EQUIPRITE_RATES', 2: 'PPM_RATES' };
const yardBus = { 300: [1], 400: [2] };
const isPpmYard = (y) => !!yardBus[y] && yardBus[y].every((bu) => R.usesPpmRates(flags, true, sources, bu));
const rows = [
  { id: 9, scheduleName: 'US Excavators 2026', isActiveFlag: 'Y', yardOrgId: 300, currencyCode: 'USD', effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-11-19T00:00:00Z' },
  { id: 10, scheduleName: 'Default fallback', isActiveFlag: 'N' },
  { id: 11, scheduleName: 'Pipeline North', isActiveFlag: 'Y', projectName: 'Pipeline North', taskName: 'Phase 2', customerName: 'Lone Star Paving' },
  { id: 12, scheduleName: 'Odessa', isActiveFlag: 'Y', yardOrgId: 400 },
  { id: 13, scheduleName: 'Old yard id', isActiveFlag: 'Y', yardOrgId: 77 },
].map((r) => R.scheduleRow(r, yardNames, isPpmYard));
T.eq('a row: status, yard name, dates', [rows[0].status, rows[0].yard, rows[0].startDate, rows[0].endDate, rows[0].currency, rows[1].status, rows[1].yard].join('|'),
  'ACTIVE|Houston Yard|2026-01-01|2026-11-19|USD|INACTIVE|—');
T.eq('an unknown yard id shows, not a dash', rows[4].yard, '77');
T.eq('a yard whose business units all take PPM rates: not used', rows.map((r) => r.ppmUnused ? 1 : 0).join(''), '00010');
T.eq('PPM everywhere when the global flag is on', R.usesPpmRates({ PPM_RATES_ENABLED: 'true' }, true, {}, 1), true);
T.eq('who uses it', rows.map(R.tagText).join(' | '), 'Yard Houston Yard | No tags: the fallback rates | Customer Lone Star Paving · Project Pipeline North · Phase 2 | Yard Odessa Yard | Yard 77');
T.eq('ending within 30 days (active only)', [R.isExpiring(rows[0], '2026-10-30'), R.isExpiring(rows[0], '2026-10-01'), R.endText(rows[0], '2026-10-30')].join('|'), 'true|false|Ends in 20 days');
T.eq('chips', R.listChips(rows, '2026-10-30').map((c) => c.key + ':' + c.count).join(), 'all:5,ACTIVE:4,expiring:1,INACTIVE:1,tagged:4,untagged:1');
T.eq('chip and search (any word, in name, customer, project or yard)', [R.filterSchedules(rows, '', 'untagged').map((r) => r.id).join(), R.filterSchedules(rows, 'odessa houston', 'all').map((r) => r.id).join(),
  R.filterSchedules(rows, 'lone', 'ACTIVE').map((r) => r.id).join()].join(' | '), '10 | 9,12 | 11');
T.eq('the summary', R.summary(rows, '2026-10-30'), '5 schedules · 4 active · 1 ending within 30 days · 1 not used (Fusion PPM)');

T.section('rates: what Save writes (New\'s saveScheduleChain, body for body)');
const form = R.formFromSchedule({ scheduleName: 'US Excavators 2026', scheduleCode: '', currencyCode: 'USD', effectiveFrom: '2026-01-01T00:00:00Z', isActiveFlag: 'Y',
  yardOrgId: 300, projectRefId: 7001, taskRefId: null, customerRefId: 900 }, 'Pipeline North', null);
const head = R.scheduleBody(form);
T.eq('the header', [head.scheduleCode, head.effectiveFrom, head.effectiveTo, head.isActiveFlag, head.yardOrgId, head.projectRefId, head.projectName, head.taskRefId,
  head.taskName, head.customerRefId, head.rateType, head.equipmentClassId, head.agreementHeaderId].join('|'),
  'RS-US-EXCAVATORS-2026|2026-01-01T00:00:00Z||Y|300|7001|Pipeline North|||900|STANDARD||');
T.check('no calcBasis or calcMethod on the header', !('calcBasis' in head) && !('calcMethod' in head));
T.eq('a name never outlives its id', R.scheduleBody(Object.assign({}, form, { projectId: null })).projectName, null);
T.eq('the code is kept when it has one', R.autoCode({ scheduleCode: 'RS-X', scheduleName: 'y' }), 'RS-X');
T.eq('no start date: today', R.scheduleBody(Object.assign({}, form, { startDate: '' }), Date.UTC(2026, 9, 30)).effectiveFrom, '2026-10-30T00:00:00Z');
const lb = R.lineBody(lines[1], 9, 2);
T.eq('a line: the full body (PUT is a full merge)', [lb.rateScheduleId, lb.periodType, lb.rateUom, lb.costRate, lb.billRate, lb.rateAmount, lb.calcBasis, lb.calcMethod,
  lb.fromUnit, lb.toUnit, lb.periodAmount, lb.periodDivisor, lb.periodSeq, lb.createdBy, lb.equipmentClassId, lb.equipmentSubclassId, lb.equipmentName, lb.location].join('|'),
  '9|WEEKLY|WEEK|557.1429|4700|4700|WEEKLY|COMPLETE_PERIOD|5||3900||2|VBCS|1|11|CAT 320 Excavator|');
const stranded = R.lineBody({ period: 'WEEKLY', calcMethod: 'UTILIZED_DURATION', calcBasis: 'HOURLY', threshold: 7.9, costRate: 10, billRate: 12 }, 9, 5);
T.eq('a stranded period is coerced on the way out; the threshold floored', [stranded.periodType, stranded.rateUom, stranded.calcBasis, stranded.fromUnit].join('|'), 'HOURLY|HOUR|HOURLY|7');
T.eq('a utilized line only carries HOURLY or DAILY', R.lineBody({ period: 'DAILY', calcMethod: 'UTILIZED_DURATION', calcBasis: 'WEEKLY' }, 9, 1).calcBasis, 'DAILY');
T.eq('Quarterly: New\'s maps have no entry (HOUR, DAILY), kept as New sends them', [R.lineBody(nq, 9, 5).rateUom, R.lineBody(nq, 9, 5).calcBasis].join(), 'HOUR,DAILY');
T.eq('new lines numbered above the highest periodSeq', R.maxPeriodSeq(lines.concat([nq])), 7);
T.eq('what Save says before the click', [R.saveText(lines, false), R.saveText([nq], true)].join(' / '),
  'Writes the header and all 4 lines, one after another, as Old and New EquipRite do. / Creates the schedule and its line, one after another, as Old and New EquipRite do.');
T.eq('a saved line from the server', JSON.stringify(plain(R.lineFromRecord({ id: 5, periodSeq: 3, equipmentClassId: 1, periodType: null, rateUom: 'WEEKLY', fromUnit: null,
  periodAmount: '100', costRate: null, billRate: null, rateAmount: 90, effectiveFrom: '2026-02-01T00:00:00Z' }))),
  JSON.stringify({ id: 5, objectVersionNumber: 1, periodSeq: 3, classId: 1, subclassId: null, className: '', subclassName: '', equipmentName: '', calcBasis: 'DAILY',
    calcMethod: 'UTILIZED_DURATION', rateType: 'USAGE', period: 'WEEKLY', threshold: 0, periodAmount: 100, periodDivisor: null, costRate: 0, billRate: 90, location: '',
    startDate: '2026-02-01', endDate: '' }));

T.section('rates: what the lists export');
const lc = R.linesExportColumns();
const val = (cols, row) => cols.map((c) => (typeof c.value === 'function' ? c.value(row) : row[c.key]));
T.eq('a rate line, exported', JSON.stringify(val(lc, lines[2])), JSON.stringify(['Excavators', 'Crawler', 'CAT 320 Excavator', undefined, 'Usage', 'Complete period · calendar days',
  'Monthly', 30, 'days', 12800, 426.6667, 12000, '-6.7%']));
T.eq('a schedule, exported', JSON.stringify(val(R.listExportColumns(), rows[3]).slice(0, 7)), JSON.stringify(['Odessa', 'Active', '', '', '', 'Odessa Yard', 'Yard Odessa Yard']));

// ── Agreements ───────────────────────────────────────────────────────────────────────────────────────────
T.section('agreements: the list (New\'s rules)');
const TODAY = '2026-10-30';
const list = A.newestFirst([
  { id: 31, agreementNumber: 'RNT-0002', agreementName: 'Lone Star MSA', customerName: 'Lone Star Paving', agreementType: 'RENTAL', status: 'ACTIVE',
    effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: '2026-12-14T00:00:00Z', lines: 2 },
  { id: 30, agreementNumber: 'RNT-0001', agreementName: 'Gulf 2025', customerName: 'Gulf Midstream', agreementType: 'RENTAL', status: 'EXPIRED', effectiveTo: '2025-12-31T00:00:00Z', lines: 4 },
  { id: 32, agreementNumber: 'ST-0001', agreementName: 'Trench kit', customerName: 'Acme Utilities', agreementType: 'SHORT_TERM', status: 'DRAFT', lines: 0 },
  { agreementNumber: 'X-1', status: 'ON_HOLD' },
].map(A.listRow));
T.eq('newest first; no id last', list.map((r) => r.agreementNumber).join(), 'ST-0001,RNT-0002,RNT-0001,X-1');
T.eq('a row', [list[1].headerId, list[1].startDate, list[1].endDate, list[1].statusCode, list[1].lineCount, list[1].customer].join('|'), '31|2026-01-01|2026-12-14|ACTIVE|2|Lone Star Paving');
T.eq('chips: Ending soon first, then the statuses present, others last', A.chips(list, TODAY).map((c) => c.key + ':' + c.count).join(), 'all:4,expiring:1,DRAFT:1,ACTIVE:1,EXPIRED:1,ON_HOLD:1');
T.eq('an unknown status in words', A.statusLabel('ON_HOLD'), 'On_hold');
T.eq('ending soon: active, within 60 days', [A.isExpiring(list[1], TODAY), A.isExpiring(list[1], '2026-09-01'), A.expiryText(list[1], TODAY), A.expiryText(list[1], '2026-12-20')].join('|'),
  'true|false|Ends in 45 days|Past its end date');
T.eq('chip and search', [A.filterRows(list, '', 'expiring', TODAY).map((r) => r.agreementNumber).join(), A.filterRows(list, 'short', 'all').map((r) => r.agreementNumber).join(),
  A.filterRows(list, 'gulf', 'ACTIVE').length].join(' | '), 'RNT-0002 | ST-0001 | 0');
T.eq('sort by customer, by lines', [A.sort(list, 'customer', 'asc').map((r) => r.agreementNumber).join(), A.sort(list, 'lines', 'desc').map((r) => r.agreementNumber)[0]].join(' | '),
  'X-1,ST-0001,RNT-0001,RNT-0002 | RNT-0001');
T.eq('what each status allows', ['DRAFT', 'PENDING', 'APPROVED', 'ACTIVE', 'REJECTED', 'EXPIRED', 'CANCELLED'].map((s) => (A.canEdit(s) ? 'e' : '-') + (A.canDecide(s) ? 'd' : '-')
  + (A.canRequest(s) ? 'r' : '-')).join(), 'ed-,ed-,ed-,--r,---,---,ed-');
T.eq('what is next, and who', [A.nextStep('DRAFT', '', 2, TODAY), A.nextStep('DRAFT', '', 0, TODAY), A.nextStep('ACTIVE', '2026-12-14', 2, TODAY),
  A.nextStep('ACTIVE', '2027-12-31', 2, TODAY), A.nextStep('EXPIRED', '', 2, TODAY)].join(' | '),
  'Finance to approve it; then its lines can be requested | Add its lines, then Finance approves it | Ends in 45 days: renew it with the customer, or let it end | '
  + 'In use: request equipment from its lines | Ended: its lines can no longer be requested');
T.eq('the summary', A.summary(list, TODAY), '4 agreements · 1 active · 1 ending within 60 days · 1 waiting for approval');
T.eq('tones', ['DRAFT', 'PENDING', 'ACTIVE', 'EXPIRED', 'REJECTED', 'CANCELLED'].map(A.tone).join(), 'draft,approval,active,ended,stopped,stopped');

T.section('agreements: one agreement\'s lines (New\'s agreementLinesInitChain)');
const VIEW = [
  { lineNumber: 2, equipmentName: '', description: 'Any vibratory roller', className: 'Rollers', subClassName: 'Vibratory', qty: 1, billRate: 720, priceUom: 'DAY' },
  { lineNumber: 1, equipmentName: 'CAT 320 Excavator', className: 'Excavators', subClassName: 'Crawler', qty: 1, billRate: 1050, priceUom: 'DAY' },
  { lineNumber: 3, equipmentName: 'Old line', className: 'Pumps', billRate: 0 },
  null,
];
const RAW = [{ id: 11, lineNumber: 1, equipmentClassId: 1, equipmentMasterId: 101, unitPrice: 1050, priceUom: 'DAY' },
  { id: 12, lineNumber: 2, equipmentClassId: 4, equipmentMasterId: null, unitPrice: null, priceUom: null }];
const built = A.buildLines('RNT-0002', VIEW, RAW);
T.eq('joined by line number, sorted', built.lines.map((l) => l.compositeKey + '=' + l.equipment_name).join(), 'RNT-0002:1=CAT 320 Excavator,RNT-0002:2=Any vibratory roller,RNT-0002:3=Old line');
T.eq('the line ids (a line without one cannot be requested)', Object.keys(built.idMap).sort().join() + ' / ' + built.idMap['RNT-0002:1'].agreementLineId, 'RNT-0002:1,RNT-0002:2 / 11');
T.eq('rates in words', built.lines.map(A.rateText).join(' | '), '$1,050 / day | $720 / day | From the rate schedule');
T.eq('search: every word', [A.filterLines(built.lines, 'roller vibratory').length, A.filterLines(built.lines, 'roller excavator').length].join(), '1,0');
let sel = A.toggle({}, 'RNT-0002:3', true, built.idMap);
T.eq('a line with no agreement line id is not ticked', Object.keys(sel).length, 0);
sel = A.toggleShown({}, built.lines, '', true, built.idMap);
T.eq('tick all shown: only the ones with an id', Object.keys(sel).join(), 'RNT-0002:1,RNT-0002:2');
T.eq('all shown ticked', A.allShownSelected(sel, built.lines, '', built.idMap), true);
T.eq('what Create request will do', A.requestPreview(sel, built.lines, built.idMap),
  '2 lines go to New request at this agreement\'s rates. 1 line names only a class: it takes the first equipment of that class. You add the project, dates and delivery there.');
const step = A.pendingLines(built.lines, Object.assign({ 'RNT-0002:3': true }, sel), built.idMap);
T.eq('step 1: ticked, unresolved, duplicates', [step.selected, step.pending.length, step.unresolvedCount, step.dupCount].join(), '3,2,1,0');
T.eq('the rate: unitPrice, else the view bill rate; the unit, else DAY', step.pending.map((p) => p.billingRate + '/' + p.priceUom).join(), '1050/DAY,720/DAY');
const dupMap = Object.assign({}, built.idMap, { 'RNT-0002:3': built.idMap['RNT-0002:1'] });
T.eq('a duplicate agreement line is dropped', A.pendingLines(built.lines, { 'RNT-0002:1': true, 'RNT-0002:3': true }, dupMap).dupCount, 1);
T.eq('a cart item', JSON.stringify(A.cartItem(step.pending[1], 205, 'Vibratory roller CS56')), JSON.stringify({
  item: { id: 205, equipmentId: 205, name: 'Vibratory roller CS56', class: 'Rollers', classId: 4, quantity: 1, billingRate: 720, billingUnit: 'DAY' },
  rate: { billingRate: 720, billingUnit: 'DAY' } }));

T.section('agreements: the hand-off to New request (draftStorage, exactly as New writes it)');
const store = {};
const fakeStorage = { setItem: (k, v) => { store[k] = String(v); }, getItem: (k) => (k in store ? store[k] : null), removeItem: (k) => { delete store[k]; },
  key: (i) => Object.keys(store)[i], get length() { return Object.keys(store).length; } };
const sbox = { console, JSON, localStorage: fakeStorage };
let draftStorage;
sbox.define = (n, f) => { draftStorage = f(); };
vm.createContext(sbox);
vm.runInContext(fs.readFileSync(path.join(JS, 'draftStorage.js'), 'utf8'), sbox);
store['eqr.draft.oldKey'] = '"left over"';
store['eqr.next.tabs'] = '{}';
const session = {};
A.writeHandoff(draftStorage, { setItem: (k, v) => { session[k] = v; } },
  { headerId: '31', number: 'RNT-0002', customerName: 'Lone Star Paving', customerRefId: null, fusionCustomerId: 900, effectiveFrom: '2026-01-01T00:00:00Z',
    effectiveTo: '2026-12-14T00:00:00Z', notes: 'Minimum one week' },
  [{ id: 101 }], { 101: 11 }, { 101: { billingRate: 1050, billingUnit: 'DAY' } });
T.eq('the keys: the old draft cleared, the same keys as New (null ones not stored)', Object.keys(store).join(),
  'eqr.next.tabs,eqr.draft.CartItemsArray,eqr.draft.requestOrigin,eqr.draft.fromAgreementId,eqr.draft.fromAgreementNumber,eqr.draft.fromAgreementCustomer,'
  + 'eqr.draft.fromAgreementFusionCustomerId,eqr.draft.fromAgreementEffectiveFrom,eqr.draft.fromAgreementEffectiveTo,eqr.draft.fromAgreementNotes,'
  + 'eqr.draft.agreementLineIdByEquipmentId,eqr.draft.agreementRateByEquipmentId');
T.eq('the values', [store['eqr.draft.requestOrigin'], store['eqr.draft.fromAgreementId'], store['eqr.draft.agreementLineIdByEquipmentId'], session['eqr.agreement.active']].join(' | '),
  '"agreement" | 31 | {"101":11} | 1');

T.section('agreements: edit and Save (New\'s saveAgreementChain, body for body)');
const header = { id: 33, agreementNumber: 'RNT-0003', agreementName: 'Permian', agreementType: 'RENTAL', status: 'PENDING', fusionCustomerId: 903, projectRefId: 5,
  effectiveFrom: '2026-12-29T00:00:00Z', effectiveTo: '2027-12-31T00:00:00Z', currencyCode: 'USD', notes: 'n', objectVersionNumber: 2 };
const f2 = A.formFromHeader(A.emptyForm(), header);
T.eq('the form from the header', [f2.agreementName, f2.customerId, f2.startDate, f2.endDate, f2.notes].join('|'), 'Permian|903|2026-12-29|2027-12-31|n');
T.eq('every missing field at once', A.missingFields(A.emptyForm()).join(', '), 'Agreement Name, Agreement Type, Customer, Start Date, End Date');
T.eq('dates backwards are said', A.datesBackwards({ startDate: '2027-01-02', endDate: '2027-01-01' }), true);
const put = A.putHeaderBody(33, header, Object.assign({}, f2, { agreementName: 'Permian (revised)' }));
T.eq('PUT: the loaded number, status, version and project; the edits', [put.id, put.agreementNumber, put.agreementName, put.status, put.objectVersionNumber, put.projectRefId,
  put.customerRefId, put.fusionCustomerId, put.effectiveFrom, put.effectiveTo].join('|'), '33|RNT-0003|Permian (revised)|PENDING|2|5||903|2026-12-29T00:00:00Z|2027-12-31T00:00:00Z');
const created = A.createHeaderBody('ST-0002', Object.assign({}, f2, { agreementType: 'SHORT_TERM', startDate: '2027-01-01' }));
T.eq('POST: a draft', [created.agreementNumber, created.status, created.effectiveFrom, created.customerRefId].join('|'), 'ST-0002|DRAFT|2027-01-01T00:00:00Z|');
const edit = A.editLines([{ id: 51, lineNumber: 2, equipmentClassId: 7, equipmentMasterId: 701, unitPrice: 95 }, { id: 50, lineNumber: 1, equipmentClassId: 7, unitPrice: 80, priceUom: 'WEEK' }],
  [{ lineNumber: 2, equipmentName: 'Light tower', className: 'Lighting' }]);
T.eq('edit lines: joined, sorted, unit DAY when blank', edit.map((l) => l.lineNumber + ':' + l.equipmentName + ':' + l.priceUom).join(), '1:—:WEEK,2:Light tower:DAY');
T.eq('a draft line needs a class, a rate above 0, and not the same equipment twice', [A.lineProblem({}, edit), A.lineProblem({ classId: 4, unitPrice: 0 }, edit),
  A.lineProblem({ classId: 7, unitPrice: 5, equipmentMasterId: 701 }, edit), A.lineProblem({ classId: 7, unitPrice: 5 }, edit)].join(' | '),
  'Please select an Equipment Class before adding a line. | Rate must be greater than 0. | This equipment is already on the agreement. The same equipment cannot be added twice. | ');
T.eq('the next line number is max + 1 (gaps kept)', [A.nextLineNumber([{ lineNumber: 2 }, { lineNumber: 5 }]), A.nextLineNumber([])].join(), '6,1');
const added = A.lineFromDraft({ classId: 4, className: 'Rollers', equipmentMasterId: '206', equipmentName: 'CS44', unitPrice: 700 }, edit);
T.eq('a new line from the draft', [added.lineNumber, added.equipmentMasterId, added.priceUom].join('|'), '3|206|DAY');
T.eq('PATCH a kept line', JSON.stringify(A.patchLineBody(edit[1])), JSON.stringify({ equipmentClassId: 7, equipmentMasterId: 701, description: '', unitPrice: 95, priceUom: 'DAY' }));
T.eq('POST a new line: quantity 1 (MIN_COMMIT_DAYS)', JSON.stringify(A.createLineBody(33, added)), JSON.stringify({ agreementHeaderId: 33, lineNumber: 3, equipmentClassId: 4,
  equipmentMasterId: 206, description: '', unitPrice: 700, priceUom: 'DAY', quantity: 1 }));
const TYPES = [{ typeCode: 'RENTAL', typePrefix: 'rnt' }, { typeCode: 'SHORT_TERM', typePrefix: 'ST' }, { typeCode: 'NONE' }];
T.eq('the number prefix: the type\'s, else AGR', ['RENTAL', 'NONE', 'X'].map((t) => A.typePrefix(TYPES, t)).join(), 'RNT,AGR,AGR');
T.eq('PREFIX-####: the highest with that prefix + 1, anchored', [A.nextAgreementNumber('ST', [{ agreementNumber: 'ST-0001' }, { agreementNumber: 'STX-0009' },
  { agreementNumber: 'ST-0012' }, { agreementNumber: 'ST-12a' }]), A.nextAgreementNumber('AGR', [])].join(), 'ST-0013,AGR-0001');
T.eq('what Save says before the click', [A.saveText(true, edit.concat([added]), [9]), A.saveText(false, [added], [])].join(' / '),
  'Save updates the header, removes 1 line, updates 2 lines, adds 1 line. / Creates the agreement as a draft with 1 line; it is used once approved.');
T.eq('the lines export', JSON.stringify(val(A.linesExportColumns(), built.lines[2])), JSON.stringify([3, 'Old line', 'Pumps', '—', '', '', '', 'Rate schedule', 0, 0, '']));

// ── The record kind, the menu, the copied helpers, the page rules ───────────────────────────────────────
T.section('an agreement opens in a tab of its own');
const t1 = tabs.forRecord('agreement', { number: 'RNT-0002' });
T.eq('keyed by its number', [t1.id, t1.flow, t1.page, t1.title, t1.navId].join('|'), 'agreement:RNT-0002|commercial|agreement|RNT-0002|agreements');
T.eq('a new one', [tabs.forRecord('agreement', { id: 'new' }).id, tabs.forRecord('agreement', { id: 'new' }).title].join('|'), 'agreement:new|New agreement');
T.eq('a deep link', tabs.fromQuery('?open=agreement&number=RNT-0002').id, 'agreement:RNT-0002');
T.eq('Rates and Agreements are built', ['rates', 'agreements'].map((id) => JSON.stringify(nav.routeOf(nav.item(id)))).join(),
  '{"flow":"commercial","page":"rates","params":{}},{"flow":"commercial","page":"agreements","params":{}}');
T.check('Rates is withdrawn when Fusion PPM prices every business unit', !nav.itemVisible(nav.item('rates'), { EQR_RATE_SCHEDULE: 'FULL' }, true, {}, true, { 1: 'PPM_RATES' }));

T.section('helpers copied from New EquipRite unchanged');
['draftStorage', 'fetchAllPages'].forEach((n) => {
  T.eq(n + '.js is New\'s, byte for byte', fs.readFileSync(path.join(JS, n + '.js'), 'utf8') === fs.readFileSync(path.join(NEW, 'resources', 'js', n + '.js'), 'utf8'), true);
});

T.section('page rules (BUILDING-NEXT-SCREENS.md)');
const flowJson = JSON.parse(fs.readFileSync(path.join(FLOW, 'commercial-flow.json'), 'utf8'));
T.eq('the flow is embeddable', flowJson.navigation && flowJson.navigation.embeddable, 'enabled');
Object.keys(flowJson.pages).forEach((pg) => {
  const base = path.join(FLOW, 'pages', pg + '-page');
  const json = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
  T.eq(pg + ': embeddable', json.navigation && json.navigation.embeddable, 'enabled');
  const named = new Set();
  Object.values(json.eventListeners || {}).forEach((l) => (l.chains || []).forEach((c) => named.add(c.chain)));
  const dir = base + '-chains';
  const files = fs.readdirSync(dir).map((f) => f.replace(/\.js$/, ''));
  // chains a chain calls by name
  files.forEach((f) => {
    const src = fs.readFileSync(path.join(dir, f + '.js'), 'utf8');
    (src.match(/chain: '(\w+)'/g) || []).forEach((m) => named.add(m.slice(8, -1)));
    T.check(pg + ': ' + f + ' is a class named like its file', new RegExp('class ' + f + ' extends ActionChain').test(src));
  });
  const missing = [...named].filter((c) => files.indexOf(c) === -1);
  T.eq(pg + ': every chain named exists', missing.join(), '');
  const html = fs.readFileSync(base + '.html', 'utf8');
  const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
  T.eq(pg + ': no arrow functions or String()/Number()/Boolean() in bindings', bindings.filter((b) => /=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)).join(' '), '');
  T.check(pg + ': no for-each inside table, tbody or select', !/<(table|tbody|select)[\s\S]*?oj-bind-for-each[\s\S]*?<\/\1>/.test(html));
  T.check(pg + ': :style only in object form', !/:style="\[\[\s*'/.test(html));
  T.check(pg + ': an Export menu', /exportKit|formats\(\)/.test(html + fs.readFileSync(base + '.js', 'utf8')));
});
const css = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8')).imports.css;
T.check('the stylesheet is imported', css.indexOf('resources/css/next-commercial.css') !== -1);
T.check('the stylesheet restyles nothing shared', !/^\.nx-(?!cm-)[\w-]+\s*[,{]/m.test(fs.readFileSync(path.join(NEXT, 'resources', 'css', 'next-commercial.css'), 'utf8')));

T.report();
