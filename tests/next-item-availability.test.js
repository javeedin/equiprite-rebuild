/*
 * EquipRite Next, New request: "where is it, and when can I have it?" for one equipment item (itemAvailability), with
 * the Availability screen's own rules (availability.js) on the item's units: free for the dates and where (inventory
 * org and yard), units out (where now, back when), other dates for the same length, the longest stretch inside the
 * dates, and free alternatives in its class. Loads the real modules.
 *
 * Run:  node tests/next-item-availability.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const JS = path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js');

function load(name, deps) {
  const sandbox = { console, Intl, Date, setTimeout, JSON };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}
const rules = load('rules');
const Progress = load('requestProgress');
const Av = load('availability', { 'resources/js/requestProgress': Progress, 'resources/js/rules': rules });
const IA = load('itemAvailability', { 'resources/js/availability': Av });

const TODAY = '2026-10-31';
const serials = [
  { serialNumber: 'EX-1', equipmentId: 25, equipmentName: 'CAT 320 Excavator', currentLocationId: 10 },
  { serialNumber: 'EX-2', equipmentId: 25, equipmentName: 'CAT 320 Excavator', currentLocationId: 10 },
  { serialNumber: 'EX-3', equipmentId: 25, equipmentName: 'CAT 320 Excavator', currentLocationId: 20 },
];
const line = (id, req, serial, s, e, status, project) => ({ eqrRequestLineId: id, requestNumber: req, lineNumber: 1, allocatedSerial: serial,
  requestedStartDate: s, requestedEndDate: e, allocationStatus: 'ALLOCATED', lineStatus: status, projectName: project, equipmentName: 'CAT 320 Excavator' });
const lines = [
  line(1, 'REQ-1', 'EX-2', '2026-10-25', '2026-11-10', 'DEPLOYED', 'Pier B'),
  line(2, 'REQ-2', 'EX-3', '2026-11-05', '2026-11-20', 'ALLOCATED', 'Gas Line'),
];
const locationsById = { 10: { locationName: 'Houston Yard', locationCode: 'HOU' }, 20: { locationName: 'Odessa Yard', locationCode: 'ODE', orgId: 300 } };
const invOrgs = [
  { invOrgId: 1, organizationId: 100, locationId: 10, locationCode: 'HOU', organizationCode: 'HOU1', organizationName: 'Houston Inventory' },
  { invOrgId: 3, organizationId: 300, locationId: 99, locationCode: 'X', organizationCode: 'ODE1', organizationName: 'Odessa Inventory' },
];
const model = Av.build({ serials, classes: [], lines, masterById: { 25: { id: 25, equipmentName: 'CAT 320 Excavator', className: 'Excavators' } }, locationsById }, TODAY);
const input = { serials, locationsById, invOrgs };
const catalogRows = [
  { eqrEquipmentMasterId: 25, equipmentName: 'CAT 320 Excavator', className: 'Excavators', availabilityStatus: 'PARTIAL QUANTITY', availableQty: 1 },
  { eqrEquipmentMasterId: 26, equipmentName: 'Mini Excavator 3.5t', className: 'Excavators', availabilityStatus: 'AVAILABLE', availableQty: 4 },
  { eqrEquipmentMasterId: 27, equipmentName: 'Long Reach Excavator', className: 'Excavators', availabilityStatus: 'NOT AVAILABLE', availableQty: 0 },
  { eqrEquipmentMasterId: 30, equipmentName: 'Dozer', className: 'Earthmoving', availabilityStatus: 'AVAILABLE', availableQty: 2 },
];

T.section('one unit wanted, 2 Nov to 13 Nov');
const one = IA.assess(model, input, { from: '2026-11-02', to: '2026-11-13', today: TODAY, need: 1, catalogRows, itemId: 25, cls: 'Excavators' });
T.eq('the answer', [one.headline, one.tone, one.window.days].join(' | '), '1 of 3 units free | ok | 12');
T.eq('where its units are, by inventory org and yard, most free first', one.places.map((p) => p.label + ' ' + p.free + '/' + p.total).join(' | '),
  'HOU1 · Houston Yard 1/2 | ODE1 · Odessa Yard 0/1');
T.eq('…the org found by location id, else by the location\'s org', [one.units.filter((u) => u.serial === 'EX-1')[0].org.code, one.units.filter((u) => u.serial === 'EX-3')[0].org.code].join(), 'HOU1,ODE1');
T.check('free at Houston', /Free at HOU1 · Houston Yard/.test(one.note), one.note);
T.eq('free first, then soonest back', one.units.map((u) => u.serial + ':' + u.state).join(), 'EX-1:free,EX-2:booked,EX-3:booked');
const ex2 = one.units.filter((u) => u.serial === 'EX-2')[0];
T.eq('a unit out: where it is now and when it is back', [ex2.now, ex2.backText].join(' | '), 'On site · Pier B (REQ-1) | Free again from 11 Nov');
const ex3 = one.units.filter((u) => u.serial === 'EX-3')[0];
T.eq('a unit booked later: at its yard now, free again after', [ex3.now, ex3.backText].join(' | '), 'At ODE · Odessa Yard | Free again from 21 Nov');
T.eq('enough free: no other dates needed', [one.slots.length, one.partial, one.alternatives.length].join(), '0,,0');

T.section('two units wanted: other dates, a shorter stretch, alternatives');
const two = IA.assess(model, input, { from: '2026-11-02', to: '2026-11-13', today: TODAY, need: 2, catalogRows, itemId: 25, cls: 'Excavators' });
T.eq('short', [two.tone, two.note].join(' | '), 'short | Only 1 unit free for these dates; 2 wanted.');
T.check('other dates for the same 12 days, nearest first, each with two units', two.slots.length > 0 && two.slots.every((s) => s.count >= 2 && s.text.indexOf('·') === -1), JSON.stringify(two.slots));
const first = two.slots[0];
T.eq('the nearest: after EX-2 is back, the turnaround left clear', [first.start, first.end, first.shiftText, first.count, first.tight].join(' | '),
  '2026-11-13 | 2026-11-24 | 11 days later | 2 | false');
T.check('…where they are', /HOU1 · Houston Yard/.test(first.places));
T.eq('the longest free stretch inside the dates (EX-3 before its booking)', two.partial && [two.partial.serial, two.partial.text].join(' | '), 'EX-3 | 2 – 4 Nov 2026 · 3 of 12 days');
T.eq('free instead, in its class, most free first', two.alternatives.map((a) => a.name + ' ' + a.label).join(' | '), 'Mini Excavator 3.5t 4 free');

T.section('none free');
const busy = Av.build({ serials: serials.slice(1), classes: [], lines, masterById: {}, locationsById }, TODAY);
const none = IA.assess(busy, { serials: serials.slice(1), locationsById, invOrgs }, { from: '2026-11-06', to: '2026-11-09', today: TODAY, need: 1, catalogRows, itemId: 25, cls: 'Excavators' });
T.eq('none', [none.headline, none.tone].join(' | '), '0 of 2 units free | none');
const later = none.slots.filter((x) => x.shift > 0)[0];
T.eq('later: EX-2 after its turnaround, clear', [later.text, later.shiftText, later.tight].join(' | '), '13 – 16 Nov 2026 | 7 days later | false');
const earlier = none.slots.filter((x) => x.shift < 0)[0];
T.eq('…or earlier (today on), before EX-3\'s booking, said to be tight', [earlier.text, earlier.shiftText, earlier.tight].join(' | '), '31 Oct – 3 Nov 2026 | 6 days earlier | true');
T.eq('in date order, at most three', [none.slots.length <= 3, none.slots.map((x) => x.start).join() === none.slots.map((x) => x.start).sort().join()].join(), 'true,true');

T.section('no units on record');
const empty = IA.assess(Av.build({ serials: [], lines: [], classes: [] }, TODAY), { serials: [] }, { from: '2026-11-02', to: '2026-11-13', today: TODAY });
T.eq('says so, without guessing', [empty.headline, empty.tone].join(' | '), 'No units recorded | unknown');

T.section('pieces');
const holds = [{ start: '2026-11-05', end: '2026-11-07' }, { start: '2026-11-08', end: '2026-11-09' }];
T.eq('free again after holds back to back', IA.freeFrom(holds, '2026-11-06'), '2026-11-10');
T.eq('the longest clear run', JSON.stringify(IA.longestRun(holds, '2026-11-01', '2026-11-12')), '{"start":"2026-11-01","end":"2026-11-04","days":4}');
T.eq('no org known: none', IA.orgOf(5, { locationCode: 'NOPE' }, invOrgs), null);

T.report();
