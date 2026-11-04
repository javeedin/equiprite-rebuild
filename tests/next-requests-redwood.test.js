/*
 * EquipRite Next Requests, the Redwood look's Smart Search filters (resources/js/requestList.js columnOptions and
 * byColumns): one filter per column, as Redwood and Old show them (Request, Project or customer, Status, Equipment,
 * Dates, Next step) and Type and Requester; each offers what the requests hold, with how many; picking one keeps the
 * requests that have it; the search config, the page's search context and the Smart Search markup agree.
 *
 * Run:  node tests/next-requests-redwood.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
const JS = path.join(NEXT, 'resources', 'js');

function load(name, deps) {
  const sandbox = { console, Intl, Date, JSON };
  let mod;
  sandbox.define = (names, factory) => { mod = factory(...names.map((n) => (deps || {})[n])); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(JS, name + '.js'), 'utf8'), sandbox, { filename: name + '.js' });
  return mod;
}
const rules = load('rules');
const fmt = load('fmt');
const Progress = load('requestProgress');
const list = load('requestList', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt, 'resources/js/rules': rules });

const NOW = Date.UTC(2026, 10, 4, 10);
const rows = [
  { eqrEquipmentRequestId: 1, requestNumber: 'REQ-1', status: 'SUBMITTED', projectName: 'Pier B', requestorName: 'User Rite', startDate: '2026-11-07', endDate: '2026-11-24' },
  { eqrEquipmentRequestId: 2, requestNumber: 'REQ-2', status: 'IN_PROCESS', projectName: 'Plant C', requestorName: 'Dana Cole', startDate: '2026-11-01', endDate: '2026-11-08' },
  { eqrEquipmentRequestId: 3, requestNumber: 'REQ-3', status: 'IN_PROCESS', customerName: 'Lone Star Paving', requestOrigin: 'External', contactName: 'Maria Lopez',
    startDate: '2026-12-20', endDate: '2027-01-10' },
  { eqrEquipmentRequestId: 4, requestNumber: 'REQ-4', status: 'CLOSED', projectName: 'Pier B', requestorName: 'User Rite', startDate: '2026-09-01', endDate: '2026-10-01' },
];
const lines = {
  'REQ-1': [{ name: 'Komatsu D65EX-18 Dozer', lineStatus: 'SUBMITTED', qty: 1 }],
  'REQ-2': [{ name: 'CAT 320 Excavator', lineStatus: 'SHIP_TO_SITE', qty: 1 }, { name: 'CAT 320 Excavator', lineStatus: 'DEPLOYED', qty: 1 }],
  'REQ-3': [{ name: 'Roller 10t', lineStatus: 'IN_PROCESS', qty: 1 }],
  'REQ-4': [{ name: 'CAT 320 Excavator', lineStatus: 'RETURNED', qty: 1 }],
};
const items = list.decorate(rows, lines, NOW);
const opts = list.columnOptions(items, lines, NOW);
const vals = (a) => a.map((o) => o.label).join(' | ');

T.section('each filter offers what the requests hold, with how many');
T.eq('Request: newest first, with its project or customer', vals(opts.number), 'REQ-4 · Pier B | REQ-3 · Lone Star Paving | REQ-2 · Plant C | REQ-1 · Pier B');
T.eq('Project or customer', vals(opts.party), 'Lone Star Paving (1) | Pier B (2) | Plant C (1)');
T.eq('Equipment: a request counted once however many pieces of it', vals(opts.equipment), 'CAT 320 Excavator (2) | Komatsu D65EX-18 Dozer (1) | Roller 10t (1)');
T.eq('Dates: where today is in each rental', vals(opts.dates),
  'On rent now (1) | Starting in the next 7 days (1) | Starting later (1) | Ending in the next 7 days (1) | Ended (1)');
T.check('Next step: who acts next, and those with nothing to do', opts.next.some((o) => o.value === 'Nothing to do') && opts.next.length >= 2, vals(opts.next));
T.eq('Type', vals(opts.type), 'Project (3) | Customer (1)');
T.eq('Requester (a customer request: its contact)', vals(opts.requester), 'Dana Cole (1) | Maria Lopez (1) | User Rite (2)');

T.section('picking one keeps the requests that have it');
const pick = (f) => list.byColumns(items, f, lines, NOW).map((r) => r.requestNumber).join();
T.eq('nothing picked: all', pick({}), 'REQ-1,REQ-2,REQ-3,REQ-4');
T.eq('Request', pick({ number: 'REQ-3' }), 'REQ-3');
T.eq('Project or customer', pick({ party: 'Pier B' }), 'REQ-1,REQ-4');
T.eq('Equipment', pick({ equipment: 'CAT 320 Excavator' }), 'REQ-2,REQ-4');
T.eq('Dates: on rent now', pick({ dates: 'now' }), 'REQ-2');
T.eq('Dates: ended', pick({ dates: 'ended' }), 'REQ-4');
T.eq('Requester', pick({ requester: 'User Rite' }), 'REQ-1,REQ-4');
T.eq('two at once: both must hold', pick({ party: 'Pier B', equipment: 'CAT 320 Excavator' }), 'REQ-4');
T.eq('Next step: nothing to do', pick({ next: 'Nothing to do' }), items.filter((r) => !(r.p.next && r.p.next.who)).map((r) => r.requestNumber).join());

T.section('the config, the page and the markup agree');
const cfg = JSON.parse(fs.readFileSync(path.join(NEXT, 'resources', 'data', 'requestsSearchConfig.json'), 'utf8'));
const pj = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'requests', 'pages', 'requests-page.json'), 'utf8'));
const html = fs.readFileSync(path.join(NEXT, 'flows', 'requests', 'pages', 'requests-page.html'), 'utf8');
const ids = Object.keys(cfg.filters);
T.eq('the filters, in the columns\' order', ids.map((k) => cfg.filters[k].label).join(','), 'Request,Project or customer,Status,Equipment,Dates,Next step,Type,Requester');
const ctx = pj.variables.rwSearchContext.defaultValue.$search.filters;
T.eq('every filter has its search context (one without throws and blanks the table)', ids.filter((k) => !ctx[k]).join(), '');
T.check('every context reads an options list the page fills', ids.every((k) => {
  const m = /\$page\.variables\.(\w+)ADP/.exec(ctx[k].options.optionsData);
  return m && pj.variables[m[1]] && pj.variables[m[1] + 'ADP'];
}));
const sugg = /suggestion-filters='(\[[^']*\])'/.exec(html);
T.eq('Smart Search offers them all', sugg ? JSON.parse(sugg[1]).join() : '', ids.join());
T.eq('the fields the filter chain reads', ids.map((k) => cfg.filters[k].options.field).join(), 'number,party,stage,equipment,dates,next,source,requester');
const chain = fs.readFileSync(path.join(NEXT, 'flows', 'requests', 'pages', 'requests-page-chains', 'rwFilterChain.js'), 'utf8');
T.check('…each one read by the filter chain', ['number', 'party', 'equipment', 'dates', 'next', 'requester'].every((f) => chain.includes("'" + f + "'"))
  && /field === 'stage'/.test(chain) && /field === 'source'/.test(chain));
T.check('Mobile\'s copy of requestList.js is the same file', fs.readFileSync(path.join(JS, 'requestList.js'), 'utf8')
  === fs.readFileSync(path.join(__dirname, '..', 'webApps', 'equiprite-mobile', 'resources', 'js', 'requestList.js'), 'utf8'));
T.report();
