define(['resources/js/availabilityData', 'resources/js/equipmentBoard'], function (avData, board) {
  'use strict';

  // What Fleet (and My work's fleet summary) reads, all of it read only, from three views at once:
  //   views/yard-stock        every unit and its status
  //   views/deployed-units    units out (on their way to site, on site, return started), the server's overdue flag
  //   views/workbench-lines   allocated lines: each unit's current and next booking
  // Each is read page by page (availabilityData.readAll: these endpoints cap the size asked for, silently, and one
  // huge page is the call most likely to time out), each on its own, so one failing leaves the others. Then joined
  // by equipmentBoard.build, where one odd row is left out and counted rather than emptying the board.
  //
  // `call` is (options) => Actions.callRest(context, options), so this is testable without VB.

  var PAGE = 500;
  var OUT_LINE_STATUSES = 'SHIP_TO_SITE,DEPLOYED,RETURN_INITIATED';
  var PARTS = [
    { key: 'stock', what: 'the unit list (yard stock)', endpoint: 'eqp-v1/getEquipriteV1ViewsYardStock', first: { page: 0, size: PAGE } },
    { key: 'deployed', what: 'units out on rent', endpoint: 'eqp-v1/searchDeployedUnits', first: { page: 0, size: PAGE, lineStatus: OUT_LINE_STATUSES } },
    { key: 'lines', what: 'bookings', endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchLines', first: { page: 0, size: PAGE } }
  ];

  /**
   * A deployed-units row in the shape equipmentBoard reads: the fields of directReturn's mapRow that the board uses,
   * mapped the same way (directReturn.js stays identical to New's and Old's copies, so it is not changed to export it).
   */
  function deployedRow(r) {
    return {
      serialNumber: r.serialNumber || null, unitIdentifier: r.unitIdentifier || null, unitType: r.unitType || null, unitStatus: r.unitStatus || null,
      lineStatus: r.lineStatus || null, requestId: Number(r.requestId), requestNumber: r.requestNumber || '',
      partyName: r.projectName || r.customerName || '', equipmentName: r.equipmentName || '', className: r.className || '',
      startDate: r.startDate || null, endDate: r.endDate || null, overdue: r.overdue === true,
      yardOrgId: r.yardOrgId != null ? Number(r.yardOrgId) : null, yardOrgName: r.yardOrgName || ''
    };
  }

  function http(r) {
    var st = r && r.status;
    return typeof st === 'number' || /^\d+$/.test(String(st || '')) ? 'HTTP ' + st : (st || 'no answer');
  }

  /**
   * The fleet, unit by unit, and what could not be read, in words.
   * @returns Promise<{ units, ok, error, notes: [string], failed: [{ part, status }], skipped }>
   *   error  only when nothing could be read: names each part and its HTTP status (or "no answer").
   *   notes  a part not read while others were, a part only partly read, rows left out.
   */
  function load(call, now) {
    var reads = PARTS.map(function (p) {
      return avData.readAll(call, p.endpoint, p.first).catch(function (e) { return { ok: false, rows: [], status: 'error: ' + ((e && e.message) || e), partial: false }; });
    });
    return Promise.all(reads).then(function (res) {
      var by = {};
      PARTS.forEach(function (p, i) { by[p.key] = res[i]; });
      var failed = PARTS.filter(function (p) { return !by[p.key].ok; }).map(function (p) { return { part: p.what, status: http(by[p.key]) }; });
      var notes = [];
      var out = {};
      var deployed = by.deployed.ok ? by.deployed.rows.filter(Boolean).map(deployedRow) : [];
      var units = board.build(by.stock.ok ? by.stock.rows : [], deployed, by.lines.ok ? by.lines.rows : [], now || Date.now(), out);
      var named = failed.map(function (f) { return f.part + ' (' + f.status + ')'; }).join(', ');
      var error = failed.length === PARTS.length ? 'The fleet could not be loaded: ' + named + '.' : '';
      if (failed.length && !error) notes.push('Not loaded: ' + named + '. The rest is shown.');
      PARTS.forEach(function (p) {
        if (by[p.key].ok && by[p.key].partial) notes.push('Only the first ' + by[p.key].rows.length + ' rows of ' + p.what + ' could be loaded.');
      });
      if (out.skipped) notes.push(out.skipped + (out.skipped === 1 ? ' row was' : ' rows were') + ' left out: it could not be read (' + out.firstError + ').');
      return { units: units, ok: !error, error: error, notes: notes, failed: failed, skipped: out.skipped };
    });
  }

  return { load: load, deployedRow: deployedRow, PARTS: PARTS, PAGE: PAGE, OUT_LINE_STATUSES: OUT_LINE_STATUSES };
});
