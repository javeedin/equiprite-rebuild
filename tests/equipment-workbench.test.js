/*
 * Equipment workbench (webApps/equiprite/flows/fleet, resources/js/equipmentBoard.js): joining the three views,
 * the lanes, turnaround risk, filters. Loads the real modules.
 *
 * Run:  node tests/equipment-workbench.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEW = path.join(__dirname, '..', 'webApps', 'equiprite');

function loadAmd(file, deps) {
  const sandbox = { console, setTimeout, MutationObserver: function () { this.observe = () => {}; }, window: { location: { href: '' } }, document: { querySelectorAll: () => [], body: {} } };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}

const B = loadAmd(path.join(NEW, 'resources', 'js', 'equipmentBoard.js'));
const directReturn = loadAmd(path.join(NEW, 'resources', 'js', 'directReturn.js'));
const AppModule = loadAmd(path.join(NEW, 'app-flow.js'), { 'ojs/ojarraydataprovider': function () {}, 'resources/js/lineStatusLabels': { formatLabel: (c) => c } });
const app = new AppModule();

const NOW = Date.UTC(2026, 9, 29, 9);
const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
const STOCK = [
  { unitNumber: 'EX-2201', unitType: 'SERIAL', assetNumber: 'FA-1001', equipmentName: 'CAT 320 Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
  { unitNumber: 'EX-2202', unitType: 'SERIAL', equipmentName: 'CAT 320 Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
  { unitNumber: 'DT-1108', unitType: 'SERIAL', equipmentName: 'Volvo A30 Dump Truck', className: 'Trucks', invOrgName: 'Odessa Yard', invOrgId: 2, unitStatus: 'RENTED' },
  { unitNumber: 'RL-0301', unitType: 'SERIAL', equipmentName: 'Roller 10t', className: 'Rollers', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE' },
  { unitNumber: 'RL-0302', unitType: 'SERIAL', equipmentName: 'Roller 10t', className: 'Rollers', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE' },
  { unitNumber: 'GN-0040', unitType: 'SERIAL', equipmentName: 'Generator 100kVA', className: 'Generators', invOrgName: 'Odessa Yard', invOrgId: 2, unitStatus: 'MAINTENANCE' },
  { unitNumber: 'LOT-77', unitType: 'LOT', equipmentName: 'Trench shoring panels', className: 'Safety', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE', onhandQty: 40 },
];
// Deployed units come through Direct Return's own mapper, as the chain gets them.
const DEPLOYED = [
  { serialNumber: 'EX-2201', unitType: 'SERIAL', requestId: 10482, requestNumber: 'REQ-10482', projectName: 'Pipeline North', lineStatus: 'DEPLOYED', startDate: day(-30), endDate: day(-4), overdue: true, equipmentName: 'CAT 320 Excavator', className: 'Excavators' },
  { serialNumber: 'EX-2202', unitType: 'SERIAL', requestId: 10490, requestNumber: 'REQ-10490', projectName: 'Plant B', lineStatus: 'DEPLOYED', startDate: day(-10), endDate: day(3), overdue: false },
  { serialNumber: 'dt-1108', unitType: 'SERIAL', requestId: 10498, requestNumber: 'REQ-10498', customerName: 'Lone Star Paving', lineStatus: 'DEPLOYED', startDate: day(-2), endDate: day(30), overdue: false },
  { serialNumber: 'LT-0999', unitType: 'SERIAL', requestId: 10501, requestNumber: 'REQ-10501', projectName: 'Substation 4', lineStatus: 'DEPLOYED', startDate: day(-1), endDate: day(20), overdue: false, equipmentName: 'Light Tower', className: 'Lighting', yardOrgName: 'Odessa Yard', yardOrgId: 2 },
].map((r) => Object.assign({ requestLineId: 1 }, r));
const DEP = DEPLOYED.map((r) => {
  // the helper's mapRow is private; reproduce its output through the public search with a fake backend instead
  return r;
});
const LINES = [
  { requestNumber: 'REQ-10510', requestStatus: 'IN_PROCESS', startDate: day(4), endDate: day(20), projectName: 'Substation 4', allocatedSerial: 'EX-2202' },  // EX-2202 back day 3, out day 4: 1-day turnaround
  { requestNumber: 'REQ-10511', requestStatus: 'ALLOCATED', startDate: day(2), endDate: day(9), projectName: 'Plant B', allocatedSerial: 'RL-0301' },        // going out in 2 days
  { requestNumber: 'REQ-10512', requestStatus: 'ALLOCATED', startDate: day(40), endDate: day(50), projectName: 'Plant B', allocatedSerial: 'RL-0302' },      // free until then
];

(async () => {
  // Run the deployed rows through Direct Return's real mapper (via its public search and a fake Actions).
  const res = await directReturn.findDeployedUnits({}, { callRest: async () => ({ ok: true, body: { data: DEP } }) }, { size: 2000 });
  T.check('deployed units come through Direct Return\'s mapper', res.ok && res.rows.length === 4);
  const units = B.build(STOCK, res.rows, LINES, NOW);
  const by = {};
  units.forEach((u) => { by[u.unit] = u; });

  T.section('joining the three views');
  T.eq('one unit per stock row, plus a deployed unit the stock view missed', units.length, 8);
  T.eq('the deployment joins case-insensitively', by['DT-1108'].requestNumber, 'REQ-10498');
  T.eq('a customer rental shows the customer', by['DT-1108'].party, 'Lone Star Paving');
  T.check('a unit only the deployed view knows still appears, with its yard', by['LT-0999'] && by['LT-0999'].yard === 'Odessa Yard' && by['LT-0999'].lane === 'out');
  T.eq('bookings attach by allocated serial', by['RL-0302'].bookings.length, 1);

  T.section('lanes');
  T.eq('lanes', ['EX-2201', 'EX-2202', 'DT-1108', 'RL-0301', 'RL-0302', 'GN-0040', 'LOT-77'].map((k) => k + ':' + by[k].lane).join(' '),
    'EX-2201:overdue EX-2202:due DT-1108:out RL-0301:going RL-0302:yard GN-0040:maint LOT-77:yard');
  T.eq('overdue follows the server\'s flag and says by how much', by['EX-2201'].when, '4 days overdue');
  T.eq('due back', by['EX-2202'].when, 'Back in 3 days');
  T.eq('going out', by['RL-0301'].when, 'Goes out in 2 days');
  T.check('free until its next booking', /^Free until \d+ \w{3}$/.test(by['RL-0302'].when), by['RL-0302'].when);
  T.eq('nothing booked', by['LOT-77'].when, 'Nothing booked');

  T.section('turnaround risk');
  T.eq('back on day 3, out on day 4: tight', JSON.stringify([by['EX-2202'].turnaround, by['EX-2202'].tight, by['EX-2202'].next.requestNumber]), '[1,true,"REQ-10510"]');
  T.eq('the current rental is never its own next booking', by['EX-2201'].next, null);
  const sum = B.summary(units);
  T.eq('summary', JSON.stringify([sum.total, sum.outNow, sum.overdue, sum.due, sum.yard, sum.going, sum.maint, sum.tight, sum.utilizationPct]), '[8,4,1,1,2,1,1,1,50]');

  T.section('board, filters, chips');
  const board = B.lanes(units, 30);
  T.eq('board lanes in order (Other only when used)', board.map((l) => l.key + ':' + l.count).join(' '), 'yard:2 going:1 out:2 due:1 overdue:1 maint:1');
  T.eq('a lane is capped and says how many more', B.lanes(units, 1).find((l) => l.key === 'out').more, 1);
  T.eq('search by project', B.filter(units, { text: 'plant b' }).map((u) => u.unit).join(), 'EX-2202');
  T.eq('search by the next booking\'s request', B.filter(units, { text: 'req-10511' }).map((u) => u.unit).join(), 'RL-0301');
  T.eq('class and yard', B.filter(units, { cls: 'Excavators', yard: '1' }).length, 2);
  T.eq('tight turnarounds only', B.filter(units, { tightOnly: true }).map((u) => u.unit).join(), 'EX-2202');
  T.eq('class chips, biggest first', B.options(units, 'cls').map((o) => o.label + ':' + o.count).slice(0, 2).join(), 'Excavators:2,Rollers:2');
  T.eq('yard chips by name', B.options(units, 'yard').map((o) => o.label).join(), 'Houston Yard,Odessa Yard');

  T.section('menu and page');
  T.eq('the menu opens the new page', JSON.stringify(app.getNavRoute('equipment-workbench')), '{"flow":"fleet","page":"equipment-workbench"}');
  T.eq('the request workbench keeps its place, renamed', app.getNavRoute('workbench').page + ' / ' + app.navItem('workbench').label, 'workbench / Request workbench');
  const chainSrc = fs.readFileSync(path.join(NEW, 'flows', 'fleet', 'pages', 'equipment-workbench-page-chains', 'loadFleetChain.js'), 'utf8');
  T.check('reads only (no write endpoint in the page chains)', !fs.readdirSync(path.join(NEW, 'flows', 'fleet', 'pages', 'equipment-workbench-page-chains'))
    .some((f) => /endpoint:\s*'eqp-v1\/(create|patch|put|delete|post)/i.test(fs.readFileSync(path.join(NEW, 'flows', 'fleet', 'pages', 'equipment-workbench-page-chains', f), 'utf8'))) && chainSrc.includes('getEquipriteV1ViewsYardStock'));

  T.report();
})();
