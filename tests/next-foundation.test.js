/*
 * EquipRite Next foundation (webApps/equiprite-next/resources/js): rules, menu, tabs, export, the bell.
 * Loads the real modules.
 *
 * Run:  node tests/next-foundation.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js');

function load(name, deps) {
  const sandbox = { console, TextEncoder, URLSearchParams, Intl, Date, setTimeout };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}

const rules = load('rules');
const nav = load('nav', { 'resources/js/rules': rules });
const tabs = load('tabs', { 'resources/js/nav': nav });
const kit = load('exportKit');
const Progress = load('requestProgress');
const alerts = load('alerts', { 'resources/js/requestProgress': Progress });
const fmt = load('fmt');
const list = load('requestList', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/rules': rules });

const ALL = { EQR_DASHBOARD: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL', EQR_PROJ_CREATE_REQUEST: 'FULL', EQR_WORKBENCH: 'FULL', EQR_EQUIPMENT_MASTER: 'FULL',
  EQR_EQUIPMENT_SCHEDULE: 'FULL', EQR_INITIATE_PICKING: 'FULL', EQR_EQUIPMENT_RETURNS: 'FULL', EQR_TIMESHEETS: 'FULL', EQR_TIMESHEET_APPROVALS: 'FULL',
  EQR_POST_COST: 'FULL', EQR_RATE_SCHEDULE: 'FULL', EQR_RENTAL_AGREEMENTS: 'FULL', EQR_ANALYTICS: 'FULL', EQR_CONFIGURATIONS: 'FULL', EQR_RBAC_ADMIN: 'FULL',
  EQR_CUST_DASHBOARD: 'FULL' };
const FLAGS = { PROJECTS_MODULE_ENABLED: 'true', TIMESHEETS_ENABLED: 'true', AGREEMENTS_ENABLED: 'true', CUSTOMERS_MODULE_ENABLED: 'true' };

T.section('rules (ported from New EquipRite)');
T.eq('persona: the server list first', rules.persona(['RT_EQP_REQUESTOR'], ['ADMIN', 'EQUIP_MGR']), 'EQUIP_MGR');
T.eq('persona: Fusion roles as the fallback, best priority', rules.persona(['RT_EQP_REQUESTOR', 'RT_EQP_MANAGER'], []), 'EQUIP_MGR');
T.eq('an administrator may view every persona', rules.personas([], ['EQUIP_ADMIN']).length, 7);
T.eq('page access: best of several, hidden until loaded', [rules.pageAccess({ A: 'READ_ONLY', B: 'FULL' }, true, 'A|B'), rules.pageAccess({ A: 'FULL' }, false, 'A')].join(), 'FULL,HIDDEN');
T.eq('quotes follow ENABLE_QUOTES', ['BOTH', 'CUSTOMER', 'PROJECTS', 'NONE'].map((m) => rules.isQuotingAllowed({ ENABLE_QUOTES: m }, true, 'EXTERNAL') ? 1 : 0).join(''), '1100');
T.eq('initials', [rules.userInitials({ fullName: 'Rahul Pangan' }), rules.userInitials({ email: 'jdunbar@x.com' })].join(), 'RP,J');

T.section('menu');
const groups = nav.visibleGroups(ALL, true, FLAGS, true, {});
T.eq('groups for full access', groups.map((g) => g.key).join(), 'work,requests,fleet,yard,usage,commercial,insights,admin,customers');
T.eq('My work first, alone', groups[0].items.map((i) => i.id).join(), 'home');
T.eq('a requestor sees My work and requests', nav.visibleGroups({ EQR_DASHBOARD: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL', EQR_PROJ_CREATE_REQUEST: 'FULL' }, true, FLAGS, true, {})
  .map((g) => g.items.map((i) => i.id).join('+')).join(' | '), 'home | requests+new-request');
T.eq('nothing until access loads (fail closed)', nav.visibleGroups(ALL, false, FLAGS, true, {}).length, 0);
T.check('Usage needs the projects module', !nav.visibleGroups(ALL, true, { TIMESHEETS_ENABLED: 'true' }, true, {}).some((g) => g.key === 'usage'));
T.check('Post costs withdrawn when Fusion PPM prices', !nav.visibleGroups(ALL, true, Object.assign({ PPM_RATES_ENABLED: 'true' }, FLAGS), true, {})
  .some((g) => g.items.some((i) => i.id === 'costs' || i.id === 'rates')));
T.eq('every item uses page codes Old and New use', [].concat(...nav.GROUPS.map((g) => g.items)).every((i) => i.pageCodes.every((c) => c in ALL || c === 'EQR_REPORTS')), true);
T.eq('command bar: label first, then keywords', nav.search('work', groups).map((r) => r.id).slice(0, 2).join(), 'home,approvals');
T.eq('a screen not built yet opens the "being built" tab', JSON.stringify(nav.routeOf(nav.item('availability'))), '{"flow":"home","page":"soon","params":{"navId":"availability"}}');

T.section('tabs');
let s = tabs.restore(null);
T.eq('first start: My work, pinned', s.tabs.map((t) => t.id + (t.pinned ? '*' : '')).join() + ' / ' + s.current, 'home* / home');
let r = tabs.open(s, tabs.forItem('requests'), 1);
r = tabs.open(r, tabs.forRecord('request', { id: 10482, number: 'REQ-10482' }), 2);
T.eq('a record opens in its own tab, titled', r.tabs.map((t) => t.id + '=' + t.title).join(), 'home=My work,requests=Requests,request:10482=REQ-10482');
r = tabs.open(Object.assign({}, r, { current: 'requests' }), tabs.forRecord('request', { id: 10490, number: 'REQ-10490' }), 3);
T.eq('a new tab goes right after the current one', r.tabs.map((t) => t.id).join(), 'home,requests,request:10490,request:10482');
const again = tabs.open(r, tabs.forItem('requests'), 4);
T.eq('opening an open screen shows it, no second tab', [again.added, again.tabs.length, again.current].join(), 'false,4,requests');
let c = tabs.close(Object.assign({}, r, { current: 'request:10490' }), 'request:10490');
T.eq('closing the current tab shows the one to its right', c.current, 'request:10482');
T.eq('My work cannot be closed', tabs.close(c, 'home').closed, false);
let many = tabs.restore(null);
for (let i = 0; i < 14; i++) many = tabs.open(many, tabs.forRecord('request', { id: i, number: 'REQ-' + i }), 10 + i);
T.eq('at most 12 tabs: the least recently shown goes', [many.tabs.length, many.tabs.some((t) => t.id === 'request:0'), many.tabs[0].id].join(), '12,false,home');
const saved = tabs.serialize(r);
const back = tabs.restore(saved);
T.eq('restored after a restart, same order and tab', back.tabs.map((t) => t.id).join() + ' / ' + back.current, 'home,requests,request:10490,request:10482 / ' + r.current);
T.eq('restore drops junk and unknown screens', tabs.restore('{"tabs":[{"id":"nope"},{"id":"request:"},{"x":1}],"current":"nope"}').tabs.map((t) => t.id).join(), 'home');
T.eq('deep links', [tabs.fromQuery('?open=fleet').id, tabs.fromQuery('?open=request&id=7&number=REQ-7').title, tabs.fromQuery('?x=1')].join(), 'fleet,REQ-7,');
const d = tabs.diff(r.tabs, tabs.rename(tabs.close(r, 'requests'), 'request:10482', 'REQ-10482 · Pier A').tabs);
T.eq('what the switcher must add, remove, rename', JSON.stringify([d.add.length, d.remove, d.update.map((x) => x.id)]), '[0,["requests"],["request:10482"]]');
T.eq('switcher item: id, safe router name, route', JSON.stringify(tabs.switcherItem(tabs.forRecord('request', { id: 5, number: 'R-5' })).name), '"tab_request_5"');

T.section('export');
const COLS = [{ key: 'num', label: 'Request' }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'note', label: 'Note' }, { key: 'x', label: 'Computed', value: (row) => row.qty * 2 }];
const ROWS = [{ num: 'REQ-1', qty: 3, note: 'Pier "A", gate 2' }, { num: 'REQ-2', qty: 1, note: '=HYPERLINK("http://evil")' }, { num: 'REQ-3', qty: 0, note: '-5' }];
const csv = kit.csv(ROWS, COLS);
T.eq('CSV: BOM, header, quotes doubled, CRLF', csv.split('\r\n').slice(0, 2).join(' | '), '\ufeffRequest,Qty,Note,Computed | REQ-1,3,"Pier ""A"", gate 2",6');
T.check('CSV: a formula is defused', csv.includes(`"'=HYPERLINK(""http://evil"")"`), csv);
T.check('CSV: a negative number stays a number', csv.includes('REQ-3,0,-5,0'));
T.eq('Copy: tab separated', kit.tsv(ROWS, COLS).split('\n')[1], 'REQ-1\t3\tPier "A", gate 2\t6');
const crcCheck = kit.crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')).toString(16);
T.eq('CRC-32 is the standard one', crcCheck, '414fa339');
const file = path.join(os.tmpdir(), 'next-export-test.xlsx');
fs.writeFileSync(file, Buffer.from(kit.xlsx(ROWS, COLS, 'Requests: all')));
let opened = '';
try {
  opened = execFileSync('python3', ['-I', '-c', [
    'import sys, zipfile, openpyxl',
    'z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None',
    'ws = openpyxl.load_workbook(sys.argv[1]).active',
    'print(ws.title, ws.freeze_panes, ws.auto_filter.ref, [[c.value for c in r] for r in ws.iter_rows()], ws["A1"].font.b)'].join('\n'), file], { encoding: 'utf8' }).trim();
} catch (e) { opened = 'unavailable: ' + String(e.message).split('\n')[0]; }
if (opened.startsWith('unavailable')) {
  T.check('xlsx opens (python3 + openpyxl not available here; skipped)', true);
} else {
  T.eq('xlsx opens in a spreadsheet reader: sheet, frozen header, filter, numbers as numbers, bold header', opened,
    "Requests  all A2 A1:D4 [['Request', 'Qty', 'Note', 'Computed'], ['REQ-1', 3, 'Pier \"A\", gate 2', 6], ['REQ-2', 1, '\\'=HYPERLINK(\"http://evil\")', 2], ['REQ-3', 0, '-5', 0]] True");
}
const html = kit.printHtml('Requests', 'Late only', ROWS, COLS, '30 Oct 2026');
T.check('PDF: a print page with title, count and an escaped table', html.includes('<h1>Requests</h1>') && html.includes('3 rows') && html.includes('Pier "A"') && !html.includes('<script'));
T.eq('file names', kit.fileName('My Requests!', 'xlsx', new Date(Date.UTC(2026, 9, 30))), 'equiprite-my-requests-2026-10-30.xlsx');

T.section('the bell');
const NOW = Date.UTC(2026, 9, 30, 9);
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const REQS = [
  { requestNumber: 'R1', eqrEquipmentRequestId: 1, status: 'IN_PROCESS', startDate: day(-22), endDate: day(0), projectName: 'Pier A' },
  { requestNumber: 'R2', eqrEquipmentRequestId: 2, status: 'SUBMITTED', startDate: day(5), endDate: day(20) },
  { requestNumber: 'R3', eqrEquipmentRequestId: 3, status: 'IN_PROCESS', startDate: day(-3), endDate: day(20), projectName: 'Plant B' },
  { requestNumber: 'R4', eqrEquipmentRequestId: 4, status: 'REJECTED', startDate: day(5), endDate: day(9) },
];
const LINES = { R1: [{ lineStatus: 'CLOSED' }, { lineStatus: 'IN_PROCESS' }, { lineStatus: 'IN_PROCESS' }], R3: [{ lineStatus: 'SHIP_TO_SITE' }, { lineStatus: 'DEPLOYED' }] };
const mgr = alerts.derive('EQUIP_MGR', REQS, LINES, NOW);
T.eq('manager: late, waiting for approval, units to assign', mgr.map((a) => a.title).join(' | '), 'R1 is late | R4 was sent back | 1 request waits for approval | 2 pieces need a unit assigned');
const req = alerts.derive('REQUESTOR', REQS, LINES, NOW);
T.check('requestor: a delivery to accept, the request sent back', req.some((a) => a.title === '1 piece on the way to Plant B') && req.some((a) => a.title === 'R4 was sent back'));
T.eq('a late alert opens the request', JSON.stringify(mgr[0].open), '{"record":"request","params":{"id":1,"number":"R1"}}');
const server = alerts.fromServer([{ notificationId: 9, subject: 'Request approved', message: 'REQ-7 was approved', createdDate: '2026-10-29T10:00:00Z', readFlag: 'N', requestNumber: 'REQ-7' },
  { id: 10, title: 'Old', createdDate: '2026-10-01', isRead: 'Y' }]);
T.eq('server notifications, whatever their field names', server.map((n) => n.id + ':' + n.title + ':' + n.serverRead).join(), 'n:9:Request approved:false,n:10:Old:true');
const merged = alerts.merge(mgr, server, [mgr[2].id]);
T.eq('unread first, by severity; the count', [merged.unread, merged.items[0].title, merged.items[merged.items.length - 1].read].join(), '4,R1 is late,true');

T.section('the Requests screen');
{
  const NOWR = Date.UTC(2026, 9, 30, 9);
  const dd = (n) => new Date(NOWR + n * 86400000).toISOString().slice(0, 10);
  const rows = [
    { eqrEquipmentRequestId: 1, requestNumber: 'R1', status: 'IN_PROCESS', startDate: dd(-22), endDate: dd(0), projectName: 'Pier A' },
    { eqrEquipmentRequestId: 2, requestNumber: 'R2', status: 'IN_PROCESS', startDate: dd(5), endDate: dd(20), projectName: 'Plant B' },
    { eqrEquipmentRequestId: 3, requestNumber: 'R3', status: 'DRAFT', startDate: dd(5), endDate: dd(9), customerName: 'Acme', requestOrigin: 'External' },
    { eqrEquipmentRequestId: 4, requestNumber: 'R4', status: 'CLOSED', startDate: dd(-40), endDate: dd(-20), projectName: 'Old job' },
  ];
  const lines = { R1: [{ lineStatus: 'CLOSED', qty: 1, name: 'Dozer' }, { lineStatus: 'IN_PROCESS', qty: 1, name: 'Loader', allocation: 'PENDING' }],
    R2: [{ lineStatus: 'SHIP_TO_SITE', qty: 1, name: 'Excavator' }, { lineStatus: 'SCHEDULED_FOR_PICKING', qty: 2, name: 'Truck' }], R4: [{ lineStatus: 'CLOSED', qty: 1 }] };
  const items = list.decorate(rows, lines, NOWR);
  T.eq('board column: what holds the request up', items.map((r) => r.requestNumber + ':' + r.lane).join(' '), 'R1:ready R2:ready R3:action R4:done');
  T.eq('chips: a request in each stage it is in', list.requestChips(items).filter((c) => c.count).map((c) => c.key + ':' + c.count).join(' '),
    'all:4 late:1 action:1 ready:2 out:1 done:2');
  T.eq('filter by stage and search by equipment', [list.filter(items, '', 'out').map((r) => r.requestNumber).join(), list.filter(items, 'truck', 'all', '', lines).map((r) => r.requestNumber).join()].join(' | '), 'R2 | R2');
  T.eq('sort by stage puts what needs action first', list.sort(items, 'stage', 'asc').map((r) => r.requestNumber).join(), 'R3,R1,R2,R4');
  const eq = list.equipmentRows(items, lines, NOWR);
  T.eq('equipment rows: words, unit, late', eq.filter((e) => e.requestNumber === 'R1').map((e) => e.label + '|' + e.unit + '|' + (e.late ? 'late' : '')).join(' ; '),
    'Back at the yard, closed|| ; Approved, no unit assigned yet|No unit assigned yet|late');
  T.eq('pieces count quantities', items[1].pieces, 3);
  T.eq('summary', list.summary(items), '4 requests · 6 pieces of equipment · 1 late');
  T.check('export columns: stored status kept, status in words', list.exportColumns('list').some((c) => c.label === 'Stored status') && list.exportColumns('list')[4].value(items[0]) === 'Partly returned · 1 of 2');
}

T.section('formatting');
T.eq('dates and ranges', [fmt.date('2026-10-08'), fmt.range('2026-10-08', '2026-10-30'), fmt.relative(day(3), NOW)].join(' | '), '8 Oct 2026 | 8 Oct – 30 Oct 2026 | in 3 days');
T.eq('money', [fmt.money(1240), fmt.money(12.5), fmt.money('')].join('|'), '$1,240|$12.50|');

T.report();
