/*
 * EquipRite Next, Edit request (resources/js/requestEdit.js) and what it touches: when a request can be edited, what Add
 * equipment offers, the line it posts and the line it cancels, the audit entries, the History reading them back
 * (requestHistory.fromEdits), a removed line no longer counted (requestList) nor holding approval up (approveAllocate),
 * and Mobile's copies kept the same.
 *
 * Run:  node tests/next-request-edit.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'webApps', 'equiprite-next', 'resources', 'js');

function load(name, deps) {
  const sandbox = { console, Intl, Date, JSON, Promise, Math, Number, String, Array, Object, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
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
const history = load('requestHistory', { 'resources/js/requestProgress': Progress, 'resources/js/fmt': fmt });
const cart = load('catalogCart');
const lineBody = load('requestLineBody');
const cu = { auditHeaders: () => ({ 'X-User-Id': 'javeed.shaik' }), auditActor: () => 'javeed.shaik' };
const edit = load('requestEdit', { 'resources/js/catalogCart': cart, 'resources/js/requestLineBody': lineBody, 'resources/js/currentUser': cu, 'resources/js/fmt': fmt });

const head = { id: 4771, requestNumber: 'REQ-4771', status: 'SUBMITTED', external: false, start: '2026-11-04', end: '2026-11-13', projectRefId: 300000123 };
const waiting = [{ lineId: 11, name: 'Komatsu D65EX-18 Dozer', qty: 1, lineStatus: 'SUBMITTED' }, { lineId: 12, name: 'Bobcat S76', qty: 1, lineStatus: 'SUBMITTED' }];

T.section('when a request can be edited');
T.check('sent for approval, nothing decided, a user who may', edit.canEdit(head, waiting, true).ok);
T.check('…not for a user who may not', !edit.canEdit(head, waiting, false).ok);
T.eq('…not once a line is decided', edit.canEdit(head, [waiting[0], Object.assign({}, waiting[1], { lineStatus: 'IN_PROCESS' })], true).why,
  'Part of it has been decided, so it can no longer be changed.');
T.check('…a removed line does not count as decided', edit.canEdit(head, [waiting[0], Object.assign({}, waiting[1], { lineStatus: 'CANCELLED' })], true).ok);
T.check('…not a draft (Finish this draft), not approved', !edit.canEdit(Object.assign({}, head, { status: 'DRAFT' }), waiting, true).ok
  && !edit.canEdit(Object.assign({}, head, { status: 'IN_PROCESS' }), waiting, true).ok);
T.eq('…not a customer request', edit.canEdit(Object.assign({}, head, { external: true }), waiting, true).why, 'A customer request is changed by the customer.');

T.section('Add equipment offers what matches every typed word');
const CATALOG = [
  { eqrEquipmentMasterId: 501, equipmentName: 'Light tower LT-8', className: 'Lighting', isRentable: true, rate: 60, availableQty: 4 },
  { eqrEquipmentMasterId: 502, equipmentName: 'Generator 60 kVA', className: 'Power', isRentable: true, rate: 180, availableQty: 0 },
];
T.eq('by name or class', edit.matches(CATALOG, 'light tow').map((m) => m.name + ' / ' + m.price + ' / ' + m.free).join(), 'Light tower LT-8 / $60 a day / 4 free on these dates');
T.eq('none free, said', edit.matches(CATALOG, 'power')[0].free, 'None free on these dates');
T.eq('nothing typed: nothing offered', edit.matches(CATALOG, '  ').length, 0);

T.section('adding and removing: what is sent and recorded');
const calls = [];
const Actions = { callRest: async (ctx, o) => { calls.push(o); return { ok: true, status: 200, body: { data: [] } }; } };
(async () => {
  const added = await edit.addLine({}, Actions, { head, row: CATALOG[0], qty: 2 });
  T.check('added, and said', added.ok && added.message.startsWith('Light tower LT-8 × 2 added to REQ-4771'), added.message);
  T.eq('a SUBMITTED line for the request\'s dates, then the audit entry', calls.map((c) => c.endpoint).join(' > '), 'eqp-v1/createRequestLinesBatch > eqp-v1/createAuditTrailEntry');
  const line = calls[0].body.lines[0];
  T.eq('the line', [line.eqrEquipmentRequestId, line.eqrEquipmentMasterId, line.quantity, line.lineStatus, line.startDate, line.endDate].join(),
    '4771,501,2,SUBMITTED,2026-11-04T00:00:00Z,2026-11-13T00:00:00Z');
  T.eq('the audit entry', [calls[1].body.entityName, calls[1].body.entityId, calls[1].body.action, calls[1].body.changedBy].join(), 'EQR_EQUIPMENT_REQUEST,4771,ADD_LINE,javeed.shaik');
  calls.length = 0;
  const removed = await edit.removeLine({}, Actions, { head, line: waiting[1], lines: waiting });
  T.check('removed, and said', removed.ok && removed.message === 'Bobcat S76 × 1 removed from REQ-4771.', removed.message);
  T.eq('the line cancelled (there is no line delete), then the audit entry', calls.map((c) => c.endpoint + ' ' + JSON.stringify(c.body.lines || c.body.action)).join(' > '),
    'eqp-v1/patchRequestLinesBatch [{"id":12,"lineStatus":"CANCELLED"}] > eqp-v1/createAuditTrailEntry "REMOVE_LINE"');
  calls.length = 0;
  const last = await edit.removeLine({}, Actions, { head, line: waiting[0], lines: [waiting[0], Object.assign({}, waiting[1], { lineStatus: 'CANCELLED' })] });
  T.check('the last piece stays: nothing sent', !last.ok && calls.length === 0 && /at least one piece/.test(last.message));
  const failing = { callRest: async (ctx, o) => (o.endpoint === 'eqp-v1/createRequestLinesBatch' ? { ok: false, status: 400, body: { message: 'Line 1: bad' } } : { ok: true }) };
  const bad = await edit.addLine({}, failing, { head, row: CATALOG[0], qty: 1 });
  T.check('a refused line: said, nothing changed', !bad.ok && bad.message.endsWith('Nothing was changed.'), bad.message);

  T.section('the History reads the edits back');
  const rows = [
    { entityName: 'EQR_EQUIPMENT_REQUEST', entityId: 4771, action: 'ADD_LINE', changedBy: 'javeed.shaik', changedDate: '2026-11-04T10:00:00Z',
      changeSummary: 'Added to REQ-4771 before approval: Light tower LT-8 × 2.' },
    { entityName: 'EQR_EQUIPMENT_REQUEST', entityId: 4771, action: 'REMOVE_LINE', changedBy: 'javeed.shaik', changedDate: '2026-11-04T10:05:00Z',
      changeSummary: 'Removed from REQ-4771 before approval: Bobcat S76 × 1.' },
    { entityName: 'EQR_EQUIPMENT_REQUEST', entityId: 9999, action: 'ADD_LINE', changedDate: '2026-11-04T10:00:00Z' },
    { entityName: 'EQR_TIME_ENTRY', entityId: 4771, action: 'ADJUST_HOURS', changedDate: '2026-11-04T10:00:00Z' },
  ];
  const ev = history.fromEdits({ data: rows }, 4771);
  T.eq('this request\'s edits only, with who and what', ev.map((e) => e.title + ' / ' + e.who + ' / ' + e.text).join(' | '),
    'Equipment added / javeed.shaik / Added to REQ-4771 before approval: Light tower LT-8 × 2. | Equipment removed / javeed.shaik / Removed from REQ-4771 before approval: Bobcat S76 × 1.');
  const built = history.build({ head: { id: 4771, number: 'REQ-4771', status: 'SUBMITTED' }, lines: [{ lineStatus: 'SUBMITTED' }], edits: { data: rows } });
  T.check('…and they are among the request\'s events', JSON.stringify(built).includes('Equipment removed'));

  T.section('a removed line no longer counts, nor holds approval up');
  const items = list.decorate([{ eqrEquipmentRequestId: 4771, requestNumber: 'REQ-4771', status: 'SUBMITTED' }],
    { 'REQ-4771': [{ name: 'A', qty: 1, lineStatus: 'SUBMITTED' }, { name: 'B', qty: 3, lineStatus: 'CANCELLED' }] }, Date.UTC(2026, 10, 4));
  T.eq('pieces: only what is still on the request', items[0].pieces, 1);
  const aa = fs.readFileSync(path.join(JS, 'approveAllocate.js'), 'utf8');
  T.check('approving the rest moves the request on: a removed line is settled', /HEADER_READY_STATES = \['IN_PROCESS', 'ALLOCATED', 'REJECTED', 'CANCELLED'\]/.test(aa));

  T.section('Mobile keeps the same shared modules');
  ['requestList', 'requestHistory', 'approveAllocate'].forEach((n) => {
    T.check(n + '.js is the same file in Mobile', fs.readFileSync(path.join(JS, n + '.js'), 'utf8')
      === fs.readFileSync(path.join(ROOT, 'webApps', 'equiprite-mobile', 'resources', 'js', n + '.js'), 'utf8'));
  });
  const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'eqp-v1', 'openapi3.json'), 'utf8'));
  T.check('the audit trail\'s page size is declared (VB strips an undeclared one)', (api.paths['/equiprite/v1/audit-trail'].get.parameters || []).some((x) => x.name === 'size'));
  T.report();
})();
