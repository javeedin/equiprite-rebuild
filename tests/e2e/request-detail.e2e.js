'use strict';
/*
 * Request detail in a real browser: where the request is comes from its equipment, not from the request's own
 * status (which stays IN_PROCESS from approval to the end). Needs `npm run build`.
 * Run: node tests/e2e/request-detail.e2e.js
 */
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10) + 'T00:00:00Z';
const HEAD = (n) => ({ requestNumber: 'REQ-' + n, requestStatus: 'IN_PROCESS', projectName: 'EPC_MO_Operations', taskName: 'Process Design Package',
  requestorName: 'User Rite', deploymentLocation: 'Pier A' });
const LINE = (n, id, name, status, extra) => Object.assign({}, HEAD(n), { lineId: id, equipmentName: name, className: 'Earthmoving', quantity: 1,
  lineStatus: status, startDate: day(-22), endDate: day(0), requestedStartDate: day(-22), requestedEndDate: day(0) }, extra || {});
// The request in the screenshot: one piece back and closed, two approved with no unit assigned, the window ends today.
const R1764 = [
  LINE(1764, 1, 'Komatsu D65EX-18 Dozer', 'CLOSED', { allocStatus: 'ALLOCATED', allocatedSerial: 'KD-0018' }),
  LINE(1764, 2, 'Bobcat S76 Skid Steer Loader', 'IN_PROCESS', { allocStatus: 'PENDING' }),
  LINE(1764, 3, 'Mack Granite Mixer Truck', 'IN_PROCESS', { allocStatus: 'PENDING' }),
];
// One of three shipped, starting next week.
const later = (l) => Object.assign(l, { startDate: day(7), endDate: day(30), requestedStartDate: day(7), requestedEndDate: day(30) });
const R1765 = [
  later(LINE(1765, 4, 'CAT 320 Excavator', 'SHIP_TO_SITE', { allocStatus: 'ALLOCATED', allocatedSerial: 'EX-2201' })),
  later(LINE(1765, 5, 'Volvo A30 Dump Truck', 'SCHEDULED_FOR_PICKING', { allocStatus: 'ALLOCATED', allocatedSerial: 'DT-1108' })),
  later(LINE(1765, 6, 'Roller 10t', 'ALLOCATED', { allocStatus: 'ALLOCATED', allocatedSerial: 'RL-0301' })),
];

function handle(req, res) {
  const p = req.path;
  const m = /\/equipment-requests\/(\d+)$/.exec(p);
  if (m && req.method === 'GET') return res.json({ id: Number(m[1]), requestNumber: 'REQ-' + m[1], status: 'IN_PROCESS' });
  if (p.endsWith('/views/request-detail-lines')) {
    return res.json({ data: req.query.get('requestId') === '1764' ? R1764 : R1765 });
  }
  return undefined;
}

(async () => {
  const env = await E.start({ port: 19220, handle });
  const { page } = env;
  try {
    T.section('the request in the screenshot');
    await env.open('/vp/shell/request/request-detail?requestId=REQ-1764&requestNumericId=1764');
    await page.waitForSelector('.er-jstop', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.eq('the heading says where the equipment is', await env.text('.er-band .er-stagepill'), 'Partly returned · 1 of 3');
    T.check('the stored request status is one hover away', (await page.$eval('.er-band .er-stagepill', (e) => e.title)).includes('IN PROCESS'));
    const stops = await page.$$eval('.er-jstop', (s) => s.map((x) => x.dataset.stop + ':' + x.className.match(/er-jstop--(\w+)/)[1]));
    T.eq('the journey: two pieces getting ready, one done, the stops between passed by one', stops.join(' '),
      'approval:done ready:here out:passed onsite:passed back:passed done:here');
    T.check('how many at each stop', (await env.text('.er-jstop[data-stop="ready"]')).includes('2 of 3 here'));
    const journey = await env.text('.er-journey');
    T.check('what is next and who does it', journey.includes('Next: Equipment Manager to assign a unit (2 of 3)'));
    T.check('what is late, by how much', /2 not shipped, due \d+ \w{3} \(22 days late\)/.test(journey), journey);
    const grid = await env.text('.er-grid');
    T.check('each line says where it is, in words', grid.includes('Back at the yard, closed') && grid.includes('Approved, no unit assigned yet'));
    T.check('the serial column says when no unit is assigned yet', grid.includes('KD-0018') && grid.includes('No unit assigned yet'));
    T.check('IN PROCESS appears nowhere on the page', !(await env.text('.er-page')).includes('IN PROCESS') && !(await env.text('.er-band')).includes('IN PROCESS'));
    await env.shot('request-detail-journey.png');

    T.section('one of three shipped');
    await env.open('/vp/shell/request/request-detail?requestId=REQ-1765&requestNumericId=1765');
    await page.waitForSelector('.er-jstop', { timeout: 30000 });
    await page.waitForTimeout(500);
    T.eq('Partly shipped, not IN PROCESS', await env.text('.er-band .er-stagepill'), 'Partly shipped · 1 of 3');
    T.check('next: the earliest step holding it up', (await env.text('.er-journey')).includes('Next: Equipment Manager to confirm it for picking (1 of 3)'));
    T.check('nothing late before the start date', !(await page.$('.er-journey .er-mr-late')));
    T.check('no sideways scroll on the page', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await env.shot('request-detail-shipped.png');
    T.eq('reads only', env.writes.length, 0);
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning')).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('request-detail-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
