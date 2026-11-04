'use strict';
/*
 * EquipRite Next, Edit request on a request's record, in a real browser: until anyone decides it, a project request sent
 * for approval can take more equipment (from the catalog, for the request's dates, posted SUBMITTED) or lose a line
 * (asked first; the line is CANCELLED, so it stays in the history). Each change writes an audit-trail entry, and the
 * request's History shows it. Once a line is decided the request can no longer be edited. Both looks.
 * Needs `npm run build`. Run: node tests/e2e/next-request-edit.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const REQ = {
  4771: { requestNumber: 'REQ-4771', status: 'SUBMITTED', projectName: '09090909', taskName: 'New financial task' },
  4772: { requestNumber: 'REQ-4772', status: 'SUBMITTED', projectName: 'Pier B', taskName: 'Foundation' },
};
let nextId = 90;
let LINES = [];
let AUDIT = [];
const reset = () => {
  nextId = 90;
  LINES = [
    { id: 11, req: 4771, name: 'Komatsu D65EX-18 Dozer', cls: 'Earthmoving', qty: 1, status: 'SUBMITTED', billRate: 4550, priceUom: 'WEEK' },
    { id: 12, req: 4771, name: 'Bobcat S76 Skid Steer Loader', cls: 'Earthmoving', qty: 1, status: 'SUBMITTED', billRate: 700, priceUom: 'DAY' },
    // REQ-4772: one of its two lines already approved, so it can no longer be edited.
    { id: 21, req: 4772, name: 'CAT 320 Excavator', cls: 'Earthmoving', qty: 1, status: 'IN_PROCESS', billRate: 1400, priceUom: 'DAY' },
    { id: 22, req: 4772, name: 'Roller 10t', cls: 'Compaction', qty: 1, status: 'SUBMITTED', billRate: 300, priceUom: 'DAY' },
  ];
  AUDIT = [{ id: 1, entityName: 'EQR_CONF_GLOBAL_SETTING', entityId: 4, action: 'UPDATE', changedBy: 'admin', changedDate: '2026-10-01T10:00:00Z' }];
};
const CATALOG = [
  { eqrEquipmentMasterId: 501, equipmentName: 'Light tower LT-8', className: 'Lighting', eqrEquipmentClassId: 7, isRentable: true, rate: 60, availableQty: 4 },
  { eqrEquipmentMasterId: 502, equipmentName: 'Generator 60 kVA', className: 'Power', eqrEquipmentClassId: 8, isRentable: true, rate: 180, availableQty: 2 },
  { eqrEquipmentMasterId: 503, equipmentName: 'Light tower LT-12', className: 'Lighting', eqrEquipmentClassId: 7, isRentable: true, rate: 75, availableQty: 0 },
];
const viewRow = (l) => ({ requestNumber: REQ[l.req].requestNumber, requestId: l.req, lineId: l.id, lineNumber: l.id, equipmentName: l.name, className: l.cls,
  qty: l.qty, quantity: l.qty, lineStatus: l.status, requestStatus: REQ[l.req].status, projectName: REQ[l.req].projectName, taskName: REQ[l.req].taskName,
  requestedStartDate: day(3), requestedEndDate: day(12), requestorName: 'javeed.shaik', billRate: l.billRate, priceUom: l.priceUom,
  allocationStatus: 'PENDING' });

function handle(req, res) {
  const p = req.path.replace('/equiprite/v1', '');
  const q = req.query;
  let m;
  if (p === '/views/my-requests') {
    return res.json({ data: Object.keys(REQ).map((id) => Object.assign({ eqrEquipmentRequestId: Number(id), startDate: day(3), endDate: day(12), requestOrigin: 'Internal' }, REQ[id])) });
  }
  if (p === '/views/my-request-lines') return res.json({ data: LINES.map(viewRow) });
  if (p === '/views/request-detail-lines') return res.json({ data: LINES.filter((l) => l.req === Number(q.get('requestId'))).map(viewRow) });
  if (p === '/views/equipment-catalog') return res.json({ data: CATALOG });
  if (p === '/audit-trail' && req.method === 'GET') return res.json({ data: AUDIT, recordCount: AUDIT.length });
  if (p === '/audit-trail' && req.method === 'POST') {
    const b = req.json();
    AUDIT.push(Object.assign({ id: AUDIT.length + 1, changedDate: new Date().toISOString() }, b));
    return res.json(Object.assign({ id: AUDIT.length }, b), 201);
  }
  if ((m = /^\/equipment-requests\/(\d+)\/lines\/batch$/.exec(p))) {
    const reqId = Number(m[1]);
    const b = req.json();
    if (req.method === 'POST') {
      const made = (b.lines || []).map((l) => {
        const row = CATALOG.filter((c) => c.eqrEquipmentMasterId === l.eqrEquipmentMasterId)[0] || {};
        const line = { id: ++nextId, req: reqId, name: row.equipmentName || 'Equipment', cls: row.className || '', qty: l.quantity, status: l.lineStatus,
          billRate: l.billRate, priceUom: l.priceUom };
        LINES.push(line);
        return Object.assign({ id: line.id }, l);
      });
      return res.json({ data: made }, 201);
    }
    if (req.method === 'PATCH') {
      (b.lines || []).forEach((u) => { const l = LINES.filter((x) => x.id === u.id)[0]; if (l && u.lineStatus) l.status = u.lineStatus; });
      return res.json({ data: b.lines });
    }
  }
  if ((m = /^\/equipment-requests\/(\d+)$/.exec(p)) && req.method === 'GET') {
    const r = REQ[m[1]];
    return res.json({ id: Number(m[1]), requestNumber: r.requestNumber, status: r.status, requestType: 'INTERNAL', projectName: r.projectName, projectRefId: 300000123,
      requestorName: 'javeed.shaik', requestedStartDate: day(3), requestedEndDate: day(12), createdDate: day(-2) + 'T09:00:00Z' });
  }
  return undefined;
}

const settle = (page, ms) => page.waitForTimeout(ms || 400);
const writes = (env, from) => env.writes.slice(from).map((w) => w.method + ' ' + w.path.replace('/equiprite/v1', ''));
const vis = (sel) => sel + ' >> visible=true';

(async () => {
  reset();
  const env = await E.start({ port: 19690, handle, app: 'next', sessionRole: 'ADMIN' });
  const { page } = env;
  const errs = () => env.errors.filter((e) => !/404|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    await env.open('/?open=request&id=4771&number=REQ-4771');
    await page.waitForSelector(vis('#recEdit'), { timeout: 30000 });
    await settle(page, 600);

    T.section('a request nobody has decided yet: Edit request');
    T.eq('the button, beside Approve', await env.text(vis('#recEdit')), 'Edit request');
    await page.click(vis('#recEdit'));
    await page.waitForSelector(vis('#recEditPanel'), { timeout: 10000 });
    T.check('the panel: what it is for, Add equipment, and what is on the request', (await env.text(vis('#recEditPanel'))).includes('Until anyone decides it')
      && await page.isVisible('#recEditSearch')
      && (await page.$$eval('#recEditPanel .nx-rec-edit-line strong', (s) => s.map((x) => x.innerText).join())) === 'Komatsu D65EX-18 Dozer,Bobcat S76 Skid Steer Loader');
    T.eq('…and its button now says Done editing', await env.text(vis('#recEdit')), 'Done editing');

    T.section('add equipment: from the catalog for the request\'s dates');
    await page.fill(vis('#recEditSearch'), 'light');
    await page.dispatchEvent(vis('#recEditSearch'), 'input');
    await settle(page, 400);
    T.eq('what matches, with its class, list price and how many are free', await page.$$eval('#recEditPanel .nx-rec-edit-opt', (b) => b.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join(' | ')),
      'Light tower LT-8 Lighting · $60 a day · 4 free on these dates | Light tower LT-12 Lighting · $75 a day · None free on these dates');
    T.check('the catalog asked for the request\'s dates and project', env.calls.some((c) => /views\/equipment-catalog\?/.test(c) && c.includes('startDate=' + day(3))
      && c.includes('endDate=' + day(12)) && c.includes('projectRefId=300000123')), env.calls.filter((c) => /equipment-catalog/.test(c)).join(' '));
    T.check('nothing to add until one is picked', await page.isDisabled('#recEditAdd'));
    await page.click(vis('#recEditPanel .nx-rec-edit-opt[data-value="501"]'));
    await page.fill(vis('#recEditQty'), '2');
    await page.dispatchEvent(vis('#recEditQty'), 'change');
    await settle(page, 300);
    let from = env.writes.length;
    await page.click(vis('#recEditAdd'));
    await page.waitForFunction(() => /added to REQ-4771/.test((document.querySelector('#recEditNote') || {}).innerText || ''), null, { timeout: 15000 });
    await settle(page, 800);
    T.eq('the line, then its audit entry', writes(env, from).join(' > '), 'POST /equipment-requests/4771/lines/batch > POST /audit-trail');
    const added = env.writes[from].body.lines[0];
    T.eq('the line: that equipment, how many, for the request\'s dates, waiting for approval like the rest',
      [added.eqrEquipmentMasterId, added.quantity, added.lineStatus, added.startDate, added.endDate, added.billRate, added.priceUom].join(),
      ['501', '2', 'SUBMITTED', day(3) + 'T00:00:00Z', day(12) + 'T00:00:00Z', '60', 'DAY'].join());
    const a1 = env.writes[from + 1].body;
    T.eq('the audit entry: the request, what was done, who, and what', [a1.entityName, a1.entityId, a1.action, a1.changeSummary].join(' | '),
      'EQR_EQUIPMENT_REQUEST | 4771 | ADD_LINE | Added to REQ-4771 before approval: Light tower LT-8 × 2.');
    T.check('the request read again: three pieces of equipment, the new one waiting for approval', (await page.$$eval('#recEditPanel .nx-rec-edit-line strong', (s) => s.length)) === 3
      && (await env.text('#recLines')) === 'Equipment (3)');

    T.section('remove a line: asked first, then kept in the history as removed');
    await page.click(vis('#recEditPanel .nx-rec-edit-line[data-line="12"] button[data-act="ask"]'));
    await page.waitForSelector(vis('#recEditPanel .nx-rec-edit-ask'), { timeout: 5000 });
    T.check('asked first', (await env.text(vis('#recEditPanel .nx-rec-edit-ask'))).startsWith('Remove it? It stays in the History as removed.'));
    from = env.writes.length;
    await page.click(vis('#recEditPanel .nx-rec-edit-line[data-line="12"] button[data-act="keep"]'));
    await settle(page, 300);
    T.check('Keep: nothing written', env.writes.length === from && !(await page.isVisible('#recEditPanel .nx-rec-edit-ask')));
    await page.click(vis('#recEditPanel .nx-rec-edit-line[data-line="12"] button[data-act="ask"]'));
    await page.click(vis('#recEditPanel .nx-rec-edit-line[data-line="12"] button[data-act="remove"]'));
    await page.waitForFunction(() => /removed from REQ-4771/.test((document.querySelector('#recEditNote') || {}).innerText || ''), null, { timeout: 15000 });
    await settle(page, 800);
    T.eq('the line cancelled, then its audit entry', writes(env, from).join(' > '), 'PATCH /equipment-requests/4771/lines/batch > POST /audit-trail');
    T.eq('…only that line, cancelled', JSON.stringify(env.writes[from].body.lines), '[{"id":12,"lineStatus":"CANCELLED"}]');
    T.eq('…and said in the audit trail', env.writes[from + 1].body.changeSummary, 'Removed from REQ-4771 before approval: Bobcat S76 Skid Steer Loader × 1.');
    T.check('gone from the panel; in the equipment table as cancelled', !(await page.$('#recEditPanel .nx-rec-edit-line[data-line="12"]'))
      && (await env.text('.nx-grid--lines')).includes('Cancelled'));
    T.eq('…and the heading counts what is still on the request', await env.text('#recLines'), 'Equipment (2 · 1 removed)');
    await env.shot('next-request-edit.png');

    T.section('the History says what was changed, by whom');
    const hist = await env.text('.nx-record-history');
    T.check('Equipment added and Equipment removed, with what', hist.includes('Equipment added') && hist.includes('Light tower LT-8 × 2')
      && hist.includes('Equipment removed') && hist.includes('Bobcat S76 Skid Steer Loader × 1'), hist.slice(0, 800));
    T.check('the History read the audit trail with a page size (not the default 20)', env.calls.some((c) => /audit-trail\?size=2000/.test(c)));

    T.section('the last piece cannot be removed');
    await page.click(vis('#recEditPanel .nx-rec-edit-line[data-line="11"] button[data-act="ask"]'));
    await page.click(vis('#recEditPanel .nx-rec-edit-line[data-line="11"] button[data-act="remove"]'));
    await settle(page, 600);
    await page.click(vis('#recEditPanel .nx-rec-edit-line[data-line="91"] button[data-act="ask"]'));
    from = env.writes.length;
    await page.click(vis('#recEditPanel .nx-rec-edit-line[data-line="91"] button[data-act="remove"]'));
    await page.waitForFunction(() => /at least one piece/.test((document.querySelector('#recEditNote') || {}).innerText || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('a request keeps at least one piece of equipment: nothing written', env.writes.length === from
      && (await env.text('#recEditNote')).includes('needs at least one piece of equipment'));
    await page.click(vis('#recEdit'));
    await settle(page, 300);
    T.check('Done editing closes the panel', !(await page.isVisible('#recEditPanel')));

    T.section('once part of it is decided, it can no longer be edited');
    await env.open('/?open=request&id=4772&number=REQ-4772');
    await page.waitForFunction(() => /REQ-4772/.test((document.querySelector('.nx-tab--on') || {}).innerText || ''), null, { timeout: 30000 });
    await page.waitForSelector(vis('.nx-grid--lines .nx-row[data-line]'), { timeout: 20000 });
    await settle(page, 600);
    T.check('no Edit request on a request with an approved line', !(await page.isVisible('#recEdit')));

    T.section('Redwood: Edit request in Oracle\'s header');
    await env.open('/?open=request&id=4771&number=REQ-4771');
    await page.waitForSelector(vis('#recEdit'), { timeout: 30000 });
    await env.setLook('redwood');
    await page.waitForSelector('#recRedwood:not([hidden]) oj-sp-general-overview-page', { timeout: 20000 });
    await settle(page, 1500);
    const more = page.locator('#recRedwood button:visible', { hasText: '' }).filter({ has: page.locator('.oj-ux-ico-overflow-h, [class*="overflow"]') });
    const opened = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#recRedwood button')).filter((x) => x.offsetParent !== null && /more|actions/i.test(x.getAttribute('aria-label') || ''))[0];
      if (b) b.click();
      return !!b;
    });
    void more;
    await settle(page, 600);
    const item = page.locator('[role="menuitem"]:visible', { hasText: 'Edit request' }).first();
    T.check('Oracle\'s header offers Edit request', opened && await item.count() > 0);
    if (await item.count()) await item.click();
    await page.waitForSelector(vis('#recEditPanel'), { timeout: 10000 }).catch(() => {});
    T.check('…which opens the same panel', await page.isVisible('#recEditPanel'));
    await env.shot('next-request-edit-redwood.png');
    await env.setLook('current');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('run finished', false, String((e && e.stack) || e).slice(0, 1500));
  } finally {
    await env.close();
  }
  T.report();
})();
