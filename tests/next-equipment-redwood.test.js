/*
 * EquipRite Next, the Equipment screens' Redwood views (resources/js/equipmentRedwood.js and the five pages): Fleet and the
 * Equipment master as Oracle's Smart Search page, a filter per column, each offering what the rows hold with how many, and
 * picking one keeping the rows that have it (the page's own filters for those the current look has); Equipment 360, an
 * item and Availability under Oracle's general overview header; every header action routed to the current look's chain.
 * The search configs, the pages' search contexts and the Smart Search markup agree; the Redwood markup keeps the VB rules;
 * the stylesheets speak for the Redwood look only.
 *
 * Run:  node tests/next-equipment-redwood.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const JS = path.join(NEXT, 'resources', 'js');
const FLOWS = path.join(NEXT, 'flows');

function loadAmd(file, deps) {
  const sandbox = { console: { log() {}, warn() {}, error() {}, info() {} }, Intl, Date, JSON, Math, Promise, setTimeout };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps && n in deps ? deps[n] : {}))); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
  return mod;
}
const js = (name, deps) => loadAmd(path.join(JS, name + '.js'), deps);
const read = (...p) => fs.readFileSync(path.join(FLOWS, ...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));

const rw = js('equipmentRedwood');
const board = js('equipmentBoard');
const em = js('equipmentMaster');

(async () => {
  // ═══ Fleet ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Fleet: each filter offers what the units hold, with how many');
  const NOW = Date.UTC(2026, 10, 4, 10);
  const day = (n) => new Date(NOW + n * 86400000).toISOString().slice(0, 10);
  const units = board.build([
    { unitNumber: 'EX-2201', unitType: 'SERIAL', equipmentName: 'CAT 320 Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
    { unitNumber: 'EX-2202', unitType: 'SERIAL', equipmentName: 'CAT 320 Excavator', className: 'Excavators', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'RENTED' },
    { unitNumber: 'RL-0301', unitType: 'SERIAL', equipmentName: 'Roller 10t', className: 'Rollers', invOrgName: 'Odessa Yard', invOrgId: 2, unitStatus: 'AVAILABLE' },
    { unitNumber: 'LOT-77', unitType: 'LOT', equipmentName: 'Trench shoring panels', className: 'Safety', invOrgName: 'Houston Yard', invOrgId: 1, unitStatus: 'AVAILABLE' },
  ], [
    { serialNumber: 'EX-2201', requestId: 1, requestNumber: 'REQ-1', projectName: 'Pipeline North', lineStatus: 'DEPLOYED', startDate: day(-30), endDate: day(-4), overdue: true },
    { serialNumber: 'EX-2202', requestId: 2, requestNumber: 'REQ-2', customerName: 'Lone Star Paving', lineStatus: 'DEPLOYED', startDate: day(-10), endDate: day(3), overdue: false },
  ].map((r) => Object.assign({ partyName: r.projectName || r.customerName }, r)), [
    { requestNumber: 'REQ-9', startDate: day(4), endDate: day(20), projectName: 'Substation 4', allocatedSerial: 'EX-2202' },
  ], NOW);
  const fo = rw.fleetOptions(units, board.LANES);
  const vals = (o) => o.map((x) => x.label).join(' | ');
  T.eq('Unit: each unit, with its equipment', vals(fo.unit), 'EX-2201 · CAT 320 Excavator (1) | EX-2202 · CAT 320 Excavator (1) | LOT-77 · Trench shoring panels (1) | RL-0301 · Roller 10t (1)');
  T.eq('Equipment', vals(fo.name), 'CAT 320 Excavator (2) | Roller 10t (1) | Trench shoring panels (1)');
  T.eq('Class: the class chip\'s values (names)', fo.cls.map((o) => o.value + '=' + o.label).join(' | '), 'Excavators=Excavators (2) | Rollers=Rollers (1) | Safety=Safety (1)');
  T.eq('Status: the lane tiles, all and tight turnarounds too', fo.status.map((o) => o.value + '=' + o.label).join(' | '),
    'all=All (4) | yard=In the yard (2) | going=Going out this week (0) | out=Out on rent (0) | due=Due back this week (1) | overdue=Overdue (1) | maint=Maintenance (0) | tight=Tight turnaround (1)');
  T.eq('Request: and those on none, last', vals(fo.request), 'REQ-1 (1) | REQ-2 (1) | Not on a request (2)');
  T.eq('Project or customer', vals(fo.party), 'Lone Star Paving (1) | Pipeline North (1)');
  T.eq('Next booking: and those with nothing ahead, last', vals(fo.next), 'REQ-9 (1) | Nothing booked ahead (3)');
  T.eq('Yard: the yard chip\'s values (ids)', fo.yard.map((o) => o.value + '=' + o.label).join(' | '), '1=Houston Yard (3) | 2=Odessa Yard (1)');

  T.section('Fleet: picking one keeps the units that have it');
  const keys = (list) => list.map((u) => u.unit).sort().join();
  T.eq('nothing picked: all', keys(rw.fleetByColumns(units, {})), 'EX-2201,EX-2202,LOT-77,RL-0301');
  T.eq('Unit', keys(rw.fleetByColumns(units, { unit: 'RL-0301' })), 'RL-0301');
  T.eq('Equipment', keys(rw.fleetByColumns(units, { name: 'CAT 320 Excavator' })), 'EX-2201,EX-2202');
  T.eq('Request: not on one', keys(rw.fleetByColumns(units, { request: rw.NONE })), 'LOT-77,RL-0301');
  T.eq('Project or customer', keys(rw.fleetByColumns(units, { party: 'Lone Star Paving' })), 'EX-2202');
  T.eq('Next booking', keys(rw.fleetByColumns(units, { next: 'REQ-9' })) + ' / ' + keys(rw.fleetByColumns(units, { next: rw.NONE })), 'EX-2202 / EX-2201,LOT-77,RL-0301');
  T.eq('two at once: both must hold', keys(rw.fleetByColumns(units, { name: 'CAT 320 Excavator', request: 'REQ-1' })), 'EX-2201');

  T.section('Fleet: Smart Search\'s criterion, read both ways Oracle writes it');
  const crit = { op: '$and', criteria: [{ text: ' cat ' }, { op: '$eq', attribute: 'status', value: 'tight' }, { op: '$eq', value: { cls: 'Excavators' } },
    { op: '$eq', value: { yard: '1', next: 'REQ-9' } }] };
  T.eq('the page\'s own filters, and the Redwood-only ones', JSON.stringify(rw.fleetCriterion(crit)),
    '{"text":"cat","lane":"all","tight":true,"cls":"Excavators","yard":"1","cols":{"unit":"","name":"","request":"","party":"","next":"REQ-9"}}');
  T.eq('a lane', rw.fleetCriterion({ op: '$eq', attribute: 'status', value: 'overdue' }).lane + '/' + rw.fleetCriterion(null).lane, 'overdue/all');

  T.section('Fleet: a row, its badge and steps; what it opens');
  const fns = { laneLabel: (k) => (board.LANES.filter((l) => l.key === k)[0] || {}).label, place: (u) => u.party || u.yard, typeLabel: (t) => t, turnaroundText: () => '1-day turnaround', range: (s) => s };
  const row = rw.fleetRows(units.filter((u) => u.unit === 'EX-2202'), fns)[0];
  T.eq('what the cells say', [row.unit, row.name, row.cls, row.status, row.badge, row.when, row.tight, row.request, row.party, row.next, row.yard].join(' | '),
    'EX-2202 | CAT 320 Excavator | Excavators | Due back this week | oj-badge oj-badge-warning oj-badge-subtle | Back in 3 days | 1-day turnaround | REQ-2 | Lone Star Paving | REQ-9 · ' + day(4) + ' | Houston Yard');
  T.eq('its step: the unit panel\'s, as an oj-c button', JSON.stringify(row.steps), '[{"nav":"returns","label":"Receiving & returns","chroming":"callToAction"}]');
  T.eq('a serial unit opens as itself; a lot, its equipment', JSON.stringify([rw.fleetRecord(units[0]), rw.fleetRecord(units.filter((u) => u.unit === 'LOT-77')[0])]),
    '[{"record":"equipment-360","params":{"serial":"EX-2201"}},{"record":"equipment-360","params":{"name":"Trench shoring panels"}}]');

  // ═══ Equipment master ════════════════════════════════════════════════════════════════════════════════════════════
  T.section('Equipment master: each filter offers what the items hold, with how many');
  const REF = { classesById: { 1: 'Excavators', 2: 'Generators' }, subclassesById: { 11: 'Crawler' }, locationsById: { 501: 'Houston Yard' } };
  const items = em.decorate([
    { id: 101, equipmentNumber: 'EQ-2201', equipmentName: 'CAT 320 Excavator', equipmentClassId: 1, equipmentSubclassId: 11, catalogStatus: 'ACTIVE', createdBy: 'FUSION_IMPORT',
      isSerialControlled: 'Y', serialUnitCount: 3, currentLocationId: 501 },
    { id: 102, equipmentNumber: 'EQ-2202', equipmentName: 'Komatsu PC210', equipmentClassId: 1, catalogStatus: 'ACTIVE', createdBy: 'admin', isSerialControlled: 'Y' },
    { id: 103, equipmentNumber: 'EQ-3101', equipmentName: 'Generator 60 kVA', equipmentClassId: 2, catalogStatus: 'INACTIVE', createdBy: 'FUSION_IMPORT', isLotControlled: 'Y', onHandQty: 4 },
  ], REF);
  const mo = rw.masterOptions(items, REF, [{ label: 'Earthmoving', value: 7 }], { status: em.statusLabel, source: em.sourceWords });
  T.eq('Equipment: each item by name, with its number', vals(mo.item), 'CAT 320 Excavator · EQ-2201 | Generator 60 kVA · EQ-3101 | Komatsu PC210 · EQ-2202');
  T.eq('Class: the class chip\'s values (ids)', mo.cls.map((o) => o.value + '=' + o.label).join(' | '), '1=Excavators (2) | 2=Generators (1)');
  T.eq('Subclass', vals(mo.sub), 'Crawler (1) | No subclass (2)');
  T.eq('Tracked by', mo.tracking.map((o) => o.value + '=' + o.label).join(' | '), 'LOT=Lot (1) | SERIAL=Serial (2)');
  T.eq('Units', vals(mo.units), 'With units on record (2) | No units on record (1)');
  T.eq('Location: and none on record', mo.location.map((o) => o.value + '=' + o.label).join(' | '), '501=Houston Yard (1) | none=No location on record (2)');
  T.eq('Status', mo.status.map((o) => o.value + '=' + o.label).join(' | '), 'ACTIVE=Active (2) | INACTIVE=Inactive (1)');
  T.eq('Source', mo.source.map((o) => o.value + '=' + o.label).join(' | '), 'Manual=Added in EquipRite (1) | Fusion=From Fusion (2)');
  T.eq('Asset group: the server\'s groups', JSON.stringify(mo.group), '[{"value":"7","label":"Earthmoving"}]');
  T.eq('picking Equipment or Units keeps the items that have it', [rw.masterByColumns(items, { item: '103' }), rw.masterByColumns(items, { units: rw.NONE }),
    rw.masterByColumns(items, { units: 'some' })].map((l) => l.map((x) => x.num).join('+')).join(' / '), 'EQ-3101 / EQ-2202 / EQ-2201+EQ-3101');
  T.eq('the criterion: the page\'s own filters, and the Redwood-only ones', JSON.stringify(rw.masterCriterion({ op: '$and', criteria: [{ text: 'cat' },
    { op: '$eq', value: { cls: '1' } }, { op: '$eq', attribute: 'sub', value: 'none' }, { op: '$eq', value: { group: '7', units: 'some' } }] })),
  '{"text":"cat","classId":"1","subclassId":"none","tracking":"","location":"","status":"","source":"","assetGroupId":"7","cols":{"item":"","units":"some"}}');
  const mrow = rw.masterRows(items.slice(2), { itemSub: (it) => it.num, sourceWords: em.sourceWords })[0];
  T.eq('a row: its cells and its status as Oracle\'s badge', [mrow.title, mrow.sub, mrow.cls, mrow.tracking, mrow.units, mrow.where, mrow.status, mrow.badge, mrow.source].join(' | '),
    'Generator 60 kVA | EQ-3101 | Generators | Lot | 4 on hand | — | Inactive | oj-badge oj-badge-subtle | From Fusion');

  T.section('the headers\' badges, kept: the same object for the same content');
  T.eq('an item\'s status', JSON.stringify([rw.itemBadge('Active', 'ok'), rw.itemBadge('Inactive', 'off'), rw.itemBadge('', 'ok')]),
    '[{"text":"Active","status":"success"},{"text":"Inactive","status":"neutral"},null]');
  T.eq('a unit now (late is danger)', JSON.stringify([rw.nowBadge({ key: 'onsite', label: 'On site' }), rw.nowBadge({ key: 'back', label: 'Coming back', late: 2 })]),
    '[{"text":"On site","status":"info"},{"text":"Coming back","status":"danger"}]');
  T.check('the same object each time (Oracle\'s header redraws for a new one)', rw.itemBadge('Active', 'ok') === rw.itemBadge('Active', 'ok')
    && rw.kept([{ id: 'a' }]) === rw.kept([{ id: 'a' }]) && rw.kept([{ id: 'a' }]) !== rw.kept([{ id: 'b' }]));

  // ═══ The pages ═══════════════════════════════════════════════════════════════════════════════════════════════════
  T.section('the configs, the pages\' search contexts and the Smart Search markup agree');
  [['fleet', 'fleet-page', 'fleetSearchConfig.json', ['unit', 'name', 'cls', 'status', 'request', 'party', 'next', 'yard'], 'Unit,Equipment,Class,Status,Request,Project or customer,Next booking,Yard'],
    ['equipment', 'equipment-page', 'equipmentSearchConfig.json', ['item', 'cls', 'sub', 'tracking', 'units', 'location', 'status', 'source', 'group'],
      'Equipment,Class,Subclass,Tracked by,Units,Location,Status,Source,Asset group']].forEach(([flow, page, file, fields, labels]) => {
    const cfg = JSON.parse(fs.readFileSync(path.join(NEXT, 'resources', 'data', file), 'utf8'));
    const pj = json(flow, 'pages', page + '.json');
    const html = read(flow, 'pages', page + '.html');
    const ids = Object.keys(cfg.filters);
    const ctx = pj.variables.rwSearchContext.defaultValue.$search.filters;
    T.eq(flow + ': the filters, in the columns\' order', ids.map((k) => cfg.filters[k].label).join(','), labels);
    T.eq(flow + ': the fields the filter chain reads', ids.map((k) => cfg.filters[k].options.field).join(), fields.join());
    T.eq(flow + ': every filter has its search context (one without throws and blanks the table)', ids.filter((k) => !ctx[k] || ctx[k].label !== cfg.filters[k].label).join(), '');
    T.check(flow + ': every context reads an options list the page fills', ids.every((k) => {
      const m = /\$page\.variables\.(\w+)ADP/.exec(ctx[k].options.optionsData);
      return m && pj.variables[m[1]] && pj.variables[m[1] + 'ADP'] && pj.variables[m[1] + 'ADP'].defaultValue.keyAttributes === 'value';
    }));
    const sugg = /suggestion-filters='([^']+)'/.exec(html);
    T.eq(flow + ': Smart Search offers them all', sugg ? JSON.parse(sugg[1]).join() : '', ids.join());
    T.check(flow + ': the config is the page\'s', pj.variables.rwSearchConfig.defaultValue.url.includes("'resources/data/" + file + "'"));
  });

  T.section('the Redwood views keep the VB rules, and wire what they bind');
  const PAGES = [
    ['fleet', 'fleet-page', ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-table', 'oj-c-button']],
    ['fleet', 'equipment-page', ['oj-sp-general-overview-page']],
    ['equipment', 'equipment-page', ['oj-sp-smart-search-page', 'oj-sp-smart-search', 'oj-sp-collection-container', 'oj-sp-general-overview-page', 'oj-table', 'oj-c-button']],
    ['equipment', 'item-page', ['oj-sp-general-overview-page']],
    ['availability', 'availability-page', ['oj-sp-general-overview-page']],
  ];
  const modules = {
    'fleet/fleet-page': loadAmd(path.join(FLOWS, 'fleet', 'pages', 'fleet-page.js'), { 'resources/js/equipmentBoard': board }),
    'fleet/equipment-page': loadAmd(path.join(FLOWS, 'fleet', 'pages', 'equipment-page.js'), { 'resources/js/equipmentRedwood': rw }),
    'equipment/equipment-page': loadAmd(path.join(FLOWS, 'equipment', 'pages', 'equipment-page.js'), { 'resources/js/equipmentImport': js('equipmentImport'), 'resources/js/equipmentMaster': em }),
    'equipment/item-page': loadAmd(path.join(FLOWS, 'equipment', 'pages', 'item-page.js'), { 'resources/js/equipmentMaster': em, 'resources/js/equipmentRedwood': rw }),
    'availability/availability-page': loadAmd(path.join(FLOWS, 'availability', 'pages', 'availability-page.js'), { 'resources/js/shellBus': { onFocus() {} } }),
  };
  PAGES.forEach(([flow, page, tags]) => {
    const name = flow + '/' + page;
    const html = read(flow, 'pages', page + '.html');
    const pj = json(flow, 'pages', page + '.json');
    // The Redwood view: from where it is put on the page to where the current look starts.
    const start = html.indexOf('<oj-bind-if test="[[ $application.variables.lookSeen ]]">');
    const end = html.indexOf('<oj-bind-if test="[[ $application.variables.look !== \'redwood\' ]]">', start);
    const view = html.slice(start, end);
    T.check(name + ': a Redwood view, put on the page once Redwood is shown, hidden under Current', start > 0 && end > start && /:hidden="\[\[ \$application\.variables\.look !== 'redwood'/.test(view));
    const bindings = (view.match(/\[\[[\s\S]*?\]\]/g) || []).map((x) => x.slice(2, -2));
    T.eq(name + ': no arrow functions, String/Number/Boolean or array literals in its bindings', bindings.filter((x) => /=>|\bString\(|\bNumber\(|\bBoolean\(|\[\s*\]|\[\s*['"{\d]/.test(x)).join(' '), '');
    T.eq(name + ': every listener it binds is declared', (view.match(/\$listeners\.(\w+)/g) || []).map((l) => l.split('.')[1]).filter((l) => !pj.eventListeners[l]).join(), '');
    const PM = modules[name];
    T.eq(name + ': every page function it binds exists', (view.match(/\$functions\.(\w+)/g) || []).map((f) => f.split('.')[1])
      .filter((f) => typeof PM.prototype[f] !== 'function').join(), '');
    T.eq(name + ': Oracle\'s components it uses are imported', tags.filter((t) => view.includes('<' + t) && !pj.imports.components[t]).join() + '|'
      + tags.filter((t) => !view.includes('<' + t)).join(), '|');
    const ids = (view.match(/\sid="([^"]+)"/g) || []).map((x) => x.slice(5, -1));
    const rest = html.slice(0, start) + html.slice(end);
    T.eq(name + ': its ids are its own (the current look\'s may be on the page too)', ids.filter((id) => rest.includes('id="' + id + '"')).join(), '');
    const dir = path.join(FLOWS, flow, 'pages', page + '-chains');
    const named = new Set();
    Object.values(pj.eventListeners).forEach((l) => l.chains.forEach((c) => named.add(c.chain)));
    fs.readdirSync(dir).forEach((f) => (fs.readFileSync(path.join(dir, f), 'utf8').match(/chain: '([A-Za-z]+)'/g) || []).forEach((m) => named.add(m.slice(8, -1))));
    T.eq(name + ': every chain it names has its file', [...named].filter((c) => !fs.existsSync(path.join(dir, c + '.js'))).join(), '');
  });

  T.section('the header actions: each the current look\'s chain');
  async function routed(flow, page, id) {
    const calls = [];
    const Actions = { async callChain(_c, o) { calls.push(o.chain + (o.params ? ' ' + JSON.stringify(o.params) : '')); } };
    const C = loadAmd(path.join(FLOWS, flow, 'pages', page + '-chains', 'rwActionChain.js'), { 'vb/action/actionChain': class {}, 'vb/action/actions': Actions });
    await new C().run({}, { id });
    return calls.join(' > ');
  }
  T.eq('Equipment master: Sync, Import, Export', [await routed('equipment', 'equipment-page', 'sync'), await routed('equipment', 'equipment-page', 'import'),
    await routed('equipment', 'equipment-page', 'export')].join(' | '),
  'SyncFromFusionChain {} | setChain {"field":"view","value":"import"} | exportChain {"format":"xlsx"}');
  T.eq('an item: Refresh, Export the documents', [await routed('equipment', 'item-page', 'refresh'), await routed('equipment', 'item-page', 'docs')].join(' | '),
    'loadRecordChain | menuChain {"what":"docs"} > exportChain {"format":"xlsx"}');
  T.eq('Equipment 360: Refresh, Export the units', [await routed('fleet', 'equipment-page', 'refresh'), await routed('fleet', 'equipment-page', 'units')].join(' | '),
    'loadChain | exportChain {"what":"units","format":"xlsx"}');
  T.eq('Availability: Refresh, Export', [await routed('availability', 'availability-page', 'refresh'), await routed('availability', 'availability-page', 'export')].join(' | '),
    'loadChain {"refresh":true} | exportChain {"format":"xlsx"}');
  const fj = json('fleet', 'pages', 'equipment-page.json');
  T.eq('Equipment 360: Open in Availability and back, the current look\'s openChain', [fj.eventListeners.onRwAvailability.chains[0].parameters.kind, fj.eventListeners.onRwBack.chains[0].parameters.kind].join(),
    'availability,item');
  T.check('the headers\' actions are kept arrays (no new one on every change)', (() => {
    const e3 = new modules['fleet/equipment-page']();
    const it = new modules['equipment/item-page']();
    const eq = new modules['equipment/equipment-page']();
    const av = new modules['availability/availability-page']();
    return e3.rwActions() === e3.rwActions() && it.rwActions() === it.rwActions() && av.rwActions() === av.rwActions()
      && eq.rwActions(true, false, 2) === eq.rwActions(true, false, 2) && it.rwPrimary(true, true, false) === it.rwPrimary(true, true, false);
  })());

  T.section('the filter chains: both looks filter alike');
  async function filterChain(flow, page, vars, criterion) {
    const calls = [];
    const Actions = { async callChain(_c, o) { calls.push(o.chain + (o.params ? ' ' + JSON.stringify(o.params) : '')); } };
    const C = loadAmd(path.join(FLOWS, flow, 'pages', page + '-chains', 'rwFilterChain.js'), { 'vb/action/actionChain': class {}, 'vb/action/actions': Actions, 'resources/js/equipmentRedwood': rw });
    const v = Object.assign({ rwCriterion: criterion }, vars);
    await new C().run({ $page: { variables: v } });
    return { v, calls: calls.join(' > ') };
  }
  let r = await filterChain('fleet', 'fleet-page', { text: '', lane: 'all', tight: false, cls: '', yard: '' }, { op: '$eq', value: { status: 'overdue', name: 'Roller 10t' } });
  T.eq('Fleet: Status is the lane tiles; Equipment the Redwood table\'s', [r.v.lane, r.v.tight, r.v.rwCols.name, r.calls].join(' | '), 'overdue | false | Roller 10t | applyChain');
  r = await filterChain('equipment', 'equipment-page', { text: '', assetGroupId: '', classId: '' }, { op: '$eq', value: { cls: '1', units: '-' } });
  T.eq('Equipment master: Class is the class chip; Units the Redwood table\'s', [r.v.classId, r.v.rwCols.units, r.calls].join(' | '), '1 | - | applyChain');
  r = await filterChain('equipment', 'equipment-page', { text: '', assetGroupId: '' }, { op: '$and', criteria: [{ text: 'cat' }, { op: '$eq', value: { group: '7' } }] });
  T.eq('…the text and the asset group go through setChain, as the current look\'s search box and chip', r.calls,
    'setChain {"field":"group","value":"7"} > setChain {"field":"text","value":"cat"}');

  T.section('the stylesheets: Redwood rules speak for the Redwood look only');
  ['next-equipment.css', 'next-equipment-360.css', 'next-availability.css'].forEach((f) => {
    const css = fs.readFileSync(path.join(NEXT, 'resources', 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const sels = css.split('}').map((x) => x.split('{')[0].trim()).filter((x) => /redwood|-rw/.test(x));
    T.eq(f + ': every Redwood selector starts with html[data-nx-look="redwood"]', sels.filter((s) => s.split(',').some((one) => !/^html\[data-nx-look="redwood"\]/.test(one.trim()))).join(' || '), '');
  });

  T.report();
})().catch((e) => { console.error(e); process.exitCode = 1; });
