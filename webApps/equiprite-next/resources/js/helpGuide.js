define(['resources/js/requestProgress', 'resources/js/rules'], function (Progress, rules) {
  'use strict';

  // Help: how a request moves, from its creation to the equipment back at the yard. Pure: the steps, who takes each,
  // on which screen, the stored statuses each covers (worded by requestProgress, as on every screen, so the help
  // never disagrees with the screens), how many pieces sit at each step right now, and the flow diagram as SVG.
  //
  // The flow is the FDD's (5.3, 5.6, 7.8, 7.12, 7.16): create, send for approval, approve or send back, assign units,
  // pick (transfer order, reservation and pick release in Fusion), inspect when required, ship, on site (billing
  // starts), return, received back and inspected (billing stops, closed).

  var LANES = [
    { key: 'requester', label: 'Requester', sub: 'Project Manager' },
    { key: 'manager', label: 'Equipment', sub: 'Manager' },
    { key: 'yard', label: 'Yard', sub: 'Warehouse' },
    { key: 'site', label: 'Project site', sub: 'Requester, timekeeper' },
    { key: 'fusion', label: 'Oracle Fusion', sub: 'done by the system' }
  ];

  // Each step: its lane and column in the diagram, the stored line statuses that sit at it, the screen that takes it
  // in Next (navId) and the page codes that may act there.
  var STEPS = [
    { key: 'create', col: 0, lane: 'requester', label: ['Create the', 'request'], stage: 'draft', statuses: ['DRAFT'],
      navId: 'new-request', codes: ['EQR_PROJ_CREATE_REQUEST'], who: 'Requester or Project Manager',
      what: 'Picks equipment from the catalog, the dates and where it goes. Saved as a draft until it is sent.',
      next: 'Send it for approval.' },
    { key: 'submit', col: 1, lane: 'requester', label: ['Send for', 'approval'], stage: 'approval', statuses: ['QUOTE_GENERATED'],
      navId: 'new-request', codes: ['EQR_PROJ_CREATE_REQUEST'], who: 'Requester',
      what: 'Sends the request: it waits for the Equipment Manager. A customer request may first need a quote accepted by the customer.',
      next: 'The Equipment Manager approves it or sends it back.' },
    { key: 'approve', col: 2, lane: 'manager', label: ['Approve or', 'send back'], stage: 'approval', decision: true, statuses: ['SUBMITTED'],
      navId: 'approvals', codes: ['EQR_WORKBENCH'], who: 'Equipment Manager',
      what: 'Approves every piece still waiting, all together, or sends the request back with a reason the requester gets. '
        + 'An administrator can approve straight from Requests (the Approve button on its row).',
      next: 'Approved: units are assigned. Sent back: the requester fixes it and sends it again.' },
    { key: 'assign', col: 3, lane: 'manager', label: ['Assign', 'units'], stage: 'ready',
      statuses: ['IN_PROCESS', 'APPROVED', 'QUOTE_ACCEPTED', 'UNDER_PROCUREMENT', 'ALLOCATED'],
      navId: 'approvals', codes: ['EQR_WORKBENCH'], who: 'Equipment Manager',
      what: 'Chooses the serial numbers (or lets Auto allocate suggest them) and confirms them for picking. Equipment not in the fleet can be bought (purchase requisition).',
      next: 'The yard picks the assigned units.' },
    { key: 'pick', col: 4, lane: 'yard', label: ['Pick at', 'the yard'], stage: 'ready',
      statuses: ['SCHEDULED_FOR_PICKING', 'PICK_INITIATED', 'PICK_RELEASED'],
      navId: 'picking', codes: ['EQR_INITIATE_PICKING'], who: 'Yard (warehouse)',
      what: 'Initiate picking raises the transfer order, reserves the units and releases them for picking in Fusion; the yard picks them (Oracle mobile).',
      next: 'Inspected, when the class needs it, then shipped.' },
    { key: 'inspect', col: 5, lane: 'yard', label: ['Inspect', '(if required)'], stage: 'ready',
      statuses: ['EQP_INSPECTION_COMPLETE', 'INSPECTION_FAILED'],
      navId: 'inspection', codes: ['EQR_WORKBENCH'], who: 'Yard inspector',
      what: 'Checks the unit against its class checklist: pass, conditional or fail. A failed unit goes back to the Equipment Manager to swap, repair or cancel.',
      next: 'Passed: shipped to site.' },
    { key: 'ship', col: 6, lane: 'yard', label: ['Ship to', 'site'], stage: 'out', statuses: ['SHIP_TO_SITE', 'SHIPPED'],
      navId: 'picking', codes: ['EQR_INITIATE_PICKING'], who: 'Yard',
      what: 'Ship confirm: the units leave the yard and are on the way to the project site.',
      next: 'The site accepts the delivery.' },
    { key: 'onsite', col: 7, lane: 'site', label: ['On site,', 'in use'], stage: 'onsite', statuses: ['DELIVERED', 'DEPLOYED'],
      navId: 'timesheets', codes: ['EQR_TIMESHEETS', 'EQR_EQUIPMENT_REQUESTS'], who: 'Site: requester and timekeeper',
      what: 'Accepted on site: billing starts and time is entered against the units (timesheets, then approval and costs).',
      next: 'When the job is done, the requester asks for the return.' },
    { key: 'return', col: 8, lane: 'site', label: ['Return', 'it'], stage: 'back', statuses: ['RETURN_INITIATED', 'RETURN_IN_PROCESS', 'SHIPPED_TO_YARD'],
      navId: 'returns', codes: ['EQR_EQUIPMENT_RETURNS', 'EQR_EQUIPMENT_REQUESTS'], who: 'Requester asks; the yard collects',
      what: 'The return is asked for, a return transfer order is raised and the units travel back to the yard.',
      next: 'The yard receives and inspects them.' },
    { key: 'back', col: 9, lane: 'yard', label: ['Received', 'back, closed'], stage: 'done', statuses: ['RETURNED', 'CLOSED', 'CONSUMED'],
      navId: 'returns', codes: ['EQR_EQUIPMENT_RETURNS'], who: 'Yard',
      what: 'Received back and inspected (a work order if it needs repair). Billing stops, the request is settled and closed; the unit is available again.',
      next: 'Done.' }
  ];
  var BY_KEY = {};
  STEPS.forEach(function (s, i) { s.n = i + 1; BY_KEY[s.key] = s; });

  // What Fusion does under the steps (shown in its lane; not clickable).
  var FUSION = [
    { col: 4, label: ['Transfer order,', 'reserve, release'] },
    { col: 6, label: ['Ship confirm'] },
    { col: 7, label: ['Receipt on site'] },
    { col: 9, label: ['Return order,', 'receipt'] }
  ];

  var STOPPED = ['REJECTED', 'CANCELLED', 'DECLINED'];

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  /** The step a stored line status sits at ('' when stopped or unknown). A customer request's IN_PROCESS still waits for approval. */
  function stepOf(code, external) {
    var c = up(code);
    if (external && c === 'IN_PROCESS') return 'approve';
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i].statuses.indexOf(c) !== -1) return STEPS[i].key;
    }
    return '';
  }

  /**
   * How many pieces sit at each step now, and on how many requests, from the shared request list (requestData).
   * A request whose lines are not known counts once, at its own status. Sent back and cancelled are counted apart.
   */
  function counts(rows, linesByRequest) {
    var out = {};
    STEPS.forEach(function (s) { out[s.key] = { pieces: 0, requests: 0 }; });
    out.stopped = { pieces: 0, requests: 0 };
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!r || !r.requestNumber) return;
      var external = rules.isExternalSource(r.requestOrigin || r.source);
      var lines = (linesByRequest || {})[r.requestNumber] || [];
      var seen = {};
      var list = lines.length ? lines : [{ lineStatus: r.status || r.requestStatus, qty: 1 }];
      list.forEach(function (l) {
        var code = up(l.lineStatus || l.status || r.status);
        var key = STOPPED.indexOf(code) !== -1 ? 'stopped' : stepOf(code, external);
        if (!key) return;
        out[key].pieces += Number(l.qty) || 1;
        if (!seen[key]) { seen[key] = 1; out[key].requests += 1; }
      });
    });
    return out;
  }

  /** The steps this user takes: those whose screen they may act on (FULL). */
  function mine(map, loaded) {
    var out = {};
    STEPS.forEach(function (s) {
      out[s.key] = s.codes.some(function (c) { return rules.pageAccess(map, loaded, c) === 'FULL'; });
    });
    return out;
  }

  /** Every stored line status, in the order of the flow, with what the screens show for it and who is next. */
  function statusRows() {
    var rows = [];
    STEPS.forEach(function (s) {
      s.statuses.forEach(function (code) {
        var l = Progress.line(code, false);
        rows.push({ code: code, step: s.n + '. ' + s.label.join(' '), stepKey: s.key, stage: l.stage, stageLabel: Progress.stageLabel(l.stage),
          label: l.label, next: l.who ? l.who + ' to ' + l.what : 'Nothing: done' });
      });
    });
    STOPPED.forEach(function (code) {
      var l = Progress.line(code, false);
      rows.push({ code: code, step: 'Stopped', stepKey: '', stage: 'stopped', stageLabel: 'Stopped', label: l.label, next: l.who ? l.who + ' to ' + l.what : 'Nothing' });
    });
    var c = Progress.line('IN_PROCESS', true);
    rows.push({ code: 'IN_PROCESS (customer)', step: '3. Approve or send back', stepKey: 'approve', stage: c.stage, stageLabel: Progress.stageLabel(c.stage),
      label: c.label, next: c.who + ' to ' + c.what });
    return rows;
  }

  /** One step with everything the detail panel says. */
  function detail(key, cts) {
    var s = BY_KEY[key];
    if (!s) return null;
    var c = (cts || {})[key] || { pieces: 0, requests: 0 };
    return {
      key: s.key, n: s.n, title: s.label.join(' '), stage: s.stage, who: s.who, what: s.what, next: s.next, navId: s.navId,
      lane: LANES.filter(function (l) { return l.key === s.lane; })[0].label,
      statuses: s.statuses.map(function (code) { var l = Progress.line(code, false); return { code: code, label: l.label, stage: l.stage }; }),
      now: c.pieces ? c.pieces + (c.pieces === 1 ? ' piece' : ' pieces') + ' on ' + c.requests + (c.requests === 1 ? ' request' : ' requests') + ' are here now' : 'Nothing is here now.',
      pieces: c.pieces,
      chip: { create: 'action', submit: 'approval', approve: 'approval', assign: 'ready', pick: 'ready', inspect: 'ready', ship: 'out',
        onsite: 'onsite', 'return': 'back', back: 'done' }[s.key]
    };
  }

  // ── The diagram ────────────────────────────────────────────────────────────────────────────────────────
  var LEFT = 112;
  var TOP = 50;
  var COLW = 122;
  var NODE_W = 106;
  var NODE_H = 58;
  var LANE_H = 92;
  var FUSION_H = 74;

  function laneIndex(key) {
    for (var i = 0; i < LANES.length; i++) if (LANES[i].key === key) return i;
    return 0;
  }
  function laneTop(i) { return TOP + i * LANE_H; }
  function laneH(i) { return LANES[i].key === 'fusion' ? FUSION_H : LANE_H; }
  function box(s) {
    var li = laneIndex(s.lane);
    var x = LEFT + s.col * COLW + (COLW - NODE_W) / 2;
    var y = laneTop(li) + (laneH(li) - NODE_H) / 2;
    return { x: x, y: y, w: NODE_W, h: NODE_H, cx: x + NODE_W / 2, cy: y + NODE_H / 2 };
  }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function text(lines, cx, cy, cls) {
    var lh = 14;
    var y0 = cy - ((lines.length - 1) * lh) / 2 + 4;
    return lines.map(function (t, i) {
      return '<text class="' + cls + '" x="' + cx + '" y="' + (y0 + i * lh) + '" text-anchor="middle">' + esc(t) + '</text>';
    }).join('');
  }

  /**
   * The flow as SVG markup (static words only). o: { counts, mine, selected }. Each step is a <g data-step="key">, so a
   * click anywhere on the diagram is read with closest('[data-step]').
   */
  function svg(o) {
    var opts = o || {};
    var cts = opts.counts || {};
    var my = opts.mine || {};
    var width = LEFT + STEPS.length * COLW + 8;
    var height = TOP + (LANES.length - 1) * LANE_H + FUSION_H + 6;
    var out = [];
    out.push('<svg class="hs" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height
      + '" role="img" aria-label="The flow of a request, from creation to the equipment back at the yard" xmlns="http://www.w3.org/2000/svg">');
    out.push('<defs><marker id="hsArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
      + '<path d="M0 0 L10 5 L0 10 z" class="hs-arrowhead"/></marker>'
      + '<marker id="hsArrowBack" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
      + '<path d="M0 0 L10 5 L0 10 z" class="hs-arrowhead hs-arrowhead--back"/></marker></defs>');
    // Lanes
    LANES.forEach(function (l, i) {
      var y = laneTop(i);
      out.push('<rect class="hs-lane' + (i % 2 ? ' hs-lane--alt' : '') + (l.key === 'fusion' ? ' hs-lane--fusion' : '') + '" x="0" y="' + y + '" width="' + width + '" height="' + laneH(i) + '"/>');
      out.push('<text class="hs-lane-label" x="12" y="' + (y + laneH(i) / 2 - 2) + '">' + esc(l.label) + '</text>');
      out.push('<text class="hs-lane-sub" x="12" y="' + (y + laneH(i) / 2 + 13) + '">' + esc(l.sub) + '</text>');
    });
    // Step numbers
    STEPS.forEach(function (s) {
      out.push('<text class="hs-num" x="' + (LEFT + s.col * COLW + COLW / 2) + '" y="18" text-anchor="middle">' + s.n + '</text>');
    });
    // Arrows between consecutive steps (an elbow when the lane changes)
    for (var i = 0; i < STEPS.length - 1; i++) {
      var a = box(STEPS[i]);
      var b = box(STEPS[i + 1]);
      var x1 = a.x + a.w;
      var x2 = b.x - 2;
      var d = a.cy === b.cy ? 'M' + x1 + ' ' + a.cy + ' H' + x2
        : 'M' + x1 + ' ' + a.cy + ' H' + ((x1 + x2) / 2) + ' V' + b.cy + ' H' + x2;
      out.push('<path class="hs-flow" d="' + d + '" marker-end="url(#hsArrow)"/>');
    }
    // Loops: sent back (approve -> submit), failed inspection (inspect -> assign)
    var ap = box(BY_KEY.approve);
    var sb = box(BY_KEY.submit);
    out.push('<path class="hs-loop hs-loop--back" d="M' + ap.cx + ' ' + (ap.y + 4) + ' V' + (laneTop(0) + 8) + ' H' + sb.cx + ' V' + (sb.y - 2) + '" marker-end="url(#hsArrowBack)"/>');
    out.push('<text class="hs-loop-label hs-loop-label--back" x="' + ((ap.cx + sb.cx) / 2) + '" y="' + (laneTop(0) - 10) + '" text-anchor="middle">sent back: fix, send again</text>');
    var ins = box(BY_KEY.inspect);
    var as = box(BY_KEY.assign);
    var midY = laneTop(laneIndex('yard')) + 6;
    out.push('<path class="hs-loop hs-loop--fail" d="M' + ins.cx + ' ' + ins.y + ' V' + midY + ' H' + as.cx + ' V' + (as.y + as.h + 2) + '" marker-end="url(#hsArrowBack)"/>');
    out.push('<text class="hs-loop-label hs-loop-label--fail" x="' + ((ins.cx + as.cx) / 2) + '" y="' + (midY - 4) + '" text-anchor="middle">failed: swap the unit</text>');
    // Fusion boxes, joined to their step
    FUSION.forEach(function (f) {
      var step = STEPS.filter(function (s) { return s.col === f.col; })[0];
      var sbx = box(step);
      var fi = laneIndex('fusion');
      var fx = LEFT + f.col * COLW + (COLW - NODE_W) / 2;
      var fy = laneTop(fi) + (FUSION_H - 44) / 2;
      out.push('<path class="hs-sys-link" d="M' + sbx.cx + ' ' + (sbx.y + sbx.h) + ' V' + fy + '"/>');
      out.push('<rect class="hs-sys" x="' + fx + '" y="' + fy + '" width="' + NODE_W + '" height="44" rx="8"/>');
      out.push(text(f.label, fx + NODE_W / 2, fy + 22, 'hs-sys-text'));
    });
    // Steps
    STEPS.forEach(function (s) {
      var bx = box(s);
      var c = cts[s.key] || { pieces: 0 };
      var cls = 'hs-node nx-stage--' + s.stage + (my[s.key] ? ' hs-node--mine' : '') + (opts.selected === s.key ? ' hs-node--on' : '');
      out.push('<g class="' + cls + '" data-step="' + s.key + '" tabindex="0" role="button" aria-label="Step ' + s.n + ': ' + esc(s.label.join(' '))
        + (c.pieces ? ', ' + c.pieces + ' here now' : '') + '">');
      if (s.decision) {
        out.push('<polygon class="hs-shape" points="' + bx.cx + ',' + (bx.y - 6) + ' ' + (bx.x + bx.w + 4) + ',' + bx.cy + ' ' + bx.cx + ',' + (bx.y + bx.h + 6)
          + ' ' + (bx.x - 4) + ',' + bx.cy + '"/>');
      } else {
        out.push('<rect class="hs-shape" x="' + bx.x + '" y="' + bx.y + '" width="' + bx.w + '" height="' + bx.h + '" rx="10"/>');
      }
      out.push(text(s.label, bx.cx, bx.cy, 'hs-label'));
      if (c.pieces) {
        var t = c.pieces > 99 ? '99+' : String(c.pieces);
        out.push('<circle class="hs-badge" cx="' + (bx.x + bx.w - 2) + '" cy="' + (bx.y + 2) + '" r="' + (t.length > 2 ? 14 : 12) + '"/>');
        out.push('<text class="hs-badge-text" x="' + (bx.x + bx.w - 2) + '" y="' + (bx.y + 6) + '" text-anchor="middle">' + t + '</text>');
      }
      out.push('</g>');
    });
    out.push('</svg>');
    return out.join('');
  }

  return {
    LANES: LANES,
    STEPS: STEPS,
    stepOf: stepOf,
    counts: counts,
    mine: mine,
    statusRows: statusRows,
    detail: detail,
    svg: svg
  };
});
