define([], () => {
  'use strict';

  // Inter-project transfer (FDD 7.16A, S28): deployed equipment on one request moves straight to another
  // request that is approved and waiting for the same equipment, without going back to the yard.
  // Checks (S28): the same equipment (master, or class and name), the transfer date inside both rental periods,
  // no submitted timesheet still open on the unit, serial units one to one.
  const DEPLOYED = ['DEPLOYED'];
  // A destination line still waiting for equipment: approved or allocated, not yet in the yard's picking.
  const WAITING = ['IN_PROCESS', 'APPROVED', 'ALLOCATED', 'PARTIALLY_ALLOCATED', 'UNALLOCATED', 'QUOTE_ACCEPTED'];
  // planConfirm blocks that also stop a transfer. NO_YARD and NEEDS_ALLOCATION are about shipping from a yard,
  // which a transfer does not do, so they are not reasons here.
  const HARD_BLOCKS = {
    NEEDS_QUOTE: 'must be quoted and the quote accepted first',
    NO_ITEM_NUMBER: 'has no item number on its equipment master, so it cannot be transferred',
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const up = (v) => String(v == null ? '' : v).trim().toUpperCase();
  const low = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const iso = (v) => (v ? String(v).substring(0, 10) : '');
  const has = (v) => v !== null && v !== undefined && v !== '';

  class PageModule {
    // ── Requests ────────────────────────────────────────────────────────────────────────────────────────────

    /** workbench-requests rows (one per line) -> one entry per request, in the order first seen. */
    requests(rows) {
      const byId = {};
      const out = [];
      (Array.isArray(rows) ? rows : []).forEach((r) => {
        if (!r || r.eqrEquipmentRequestId == null) {
          return;
        }
        const id = Number(r.eqrEquipmentRequestId);
        let e = byId[id];
        if (!e) {
          e = {
            id,
            number: r.requestNumber || String(id),
            party: r.projectName || r.customerName || r.projectOrCustomer || '',
            task: r.taskName || '',
            location: r.location || '',
            status: r.requestStatus || '',
            start: iso(r.requestedStartDate),
            end: iso(r.requestedEndDate),
            equipment: [],
            units: 0,
          };
          byId[id] = e;
          out.push(e);
        }
        e.units++;
        const name = [r.equipmentName, r.className].filter(Boolean).join('|');
        if (name && e.equipment.indexOf(name) === -1) {
          e.equipment.push(name);
        }
      });
      return out;
    }

    findRequest(rows, id) {
      return this.requests(rows).find((r) => has(id) && r.id === Number(id)) || null;
    }

    requestText(r) {
      if (!r) {
        return '';
      }
      return r.number + (r.party ? ' · ' + r.party : '') + (r.task ? ' · ' + r.task : '');
    }

    /** "Dump Truck 30t, Excavator +2" from a request's equipment. */
    equipmentText(r) {
      const names = (r && r.equipment ? r.equipment : []).map((e) => e.split('|')[0]);
      return names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) : '');
    }

    /** Requests matching a search (number, project, task, location, equipment), at most `limit`. */
    searchRequests(list, q, limit) {
      const s = low(q);
      return (Array.isArray(list) ? list : [])
        .filter((r) => !s || [r.number, r.party, r.task, r.location].concat(r.equipment).some((v) => low(v).indexOf(s) !== -1))
        .slice(0, limit || 8);
    }

    /** Requests the equipment can be on: every request with a deployed line (workbench stage DEPLOYED). */
    sources(sourceRows, q) {
      return this.searchRequests(this.requests(sourceRows), q, 8);
    }

    /**
     * Requests it can go to: approved and on the way out (workbench stage OUTBOUND), not the source, with a line for
     * the same equipment as a ticked unit (all deployed units when none is ticked yet). The workbench row carries
     * names only, so this matches on name and class; the destination's own lines are checked exactly once picked.
     */
    destinations(destRows, sourceId, sourceLines, selected, q) {
      const units = this.selectedLines(sourceLines, selected);
      const want = (units.length ? units : this.deployed(sourceLines)).map((l) => low(l.equipmentName) + '|' + low(l.className));
      const ok = (r) => r.id !== Number(sourceId) && r.equipment.some((e) => {
        const [name, cls] = e.split('|');
        return want.some((w) => {
          const [wn, wc] = w.split('|');
          return wn === low(name) && (!wc || !cls || wc === low(cls));
        });
      });
      return this.searchRequests(this.requests(destRows).filter(ok), q, 8);
    }

    // ── Lines ───────────────────────────────────────────────────────────────────────────────────────────────

    deployed(lines) {
      return (Array.isArray(lines) ? lines : []).filter((l) => DEPLOYED.indexOf(up(l.lineStatus)) !== -1);
    }

    waiting(lines) {
      return (Array.isArray(lines) ? lines : []).filter((l) => WAITING.indexOf(up(l.lineStatus)) !== -1);
    }

    selectedLines(lines, selected) {
      const sel = selected || {};
      return this.deployed(lines).filter((l) => sel[String(l.lineId)]);
    }

    selectedCount(lines, selected) {
      return this.selectedLines(lines, selected).length;
    }

    isSelected(selected, lineId) {
      return !!(selected && selected[String(lineId)]);
    }

    /** The same equipment: the same master when both say, else the same name (and class, when both have one). */
    sameEquipment(a, b) {
      if (!a || !b) {
        return false;
      }
      if (has(a.equipmentMasterId) && has(b.equipmentMasterId)) {
        return Number(a.equipmentMasterId) === Number(b.equipmentMasterId);
      }
      const cls = !has(a.equipmentClassId) || !has(b.equipmentClassId) || Number(a.equipmentClassId) === Number(b.equipmentClassId);
      return cls && low(a.equipmentName) !== '' && low(a.equipmentName) === low(b.equipmentName);
    }

    /**
     * Ticked units -> destination lines, one to one: each unit takes the first waiting line for the same
     * equipment that still has room (a line for 2 takes two units). { pairs: [{ source, dest }], unmatched }.
     */
    pair(sourceSel, destLines) {
      const room = {};
      const dests = this.waiting(destLines);
      dests.forEach((d) => { room[d.lineId] = Math.max(1, Number(d.quantity) || 1); });
      const pairs = [];
      const unmatched = [];
      (Array.isArray(sourceSel) ? sourceSel : []).forEach((s) => {
        const need = Math.max(1, Number(s.quantity) || 1);
        const d = dests.find((x) => this.sameEquipment(s, x) && room[x.lineId] >= need);
        if (d) {
          room[d.lineId] -= need;
          pairs.push({ source: s, dest: d });
        } else {
          unmatched.push(s);
        }
      });
      return { pairs, unmatched };
    }

    unitText(l) {
      if (!l) {
        return '';
      }
      return (l.equipmentName || 'Equipment') + (l.allocatedSerial ? ' · ' + l.allocatedSerial : '');
    }

    windowOf(l) {
      return { start: iso(l && (l.startDate || l.requestedStartDate)), end: iso(l && (l.endDate || l.requestedEndDate)) };
    }

    /** "3 Nov – 20 Dec 2026". */
    windowText(w) {
      const f = (v, y) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || '');
        return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + (y ? ' ' + m[1] : '') : '';
      };
      if (!w || (!w.start && !w.end)) {
        return '';
      }
      if (w.start && w.end) {
        return f(w.start, w.start.substring(0, 4) !== w.end.substring(0, 4)) + ' – ' + f(w.end, true);
      }
      return w.start ? 'from ' + f(w.start, true) : 'until ' + f(w.end, true);
    }

    day(v) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
      return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : '';
    }

    inWindow(date, w) {
      const d = iso(date);
      return !!d && (!w.start || d >= w.start) && (!w.end || d <= w.end);
    }

    // ── Checks ──────────────────────────────────────────────────────────────────────────────────────────────

    /** Timesheet rows (views/timesheet-details) for these lines in a status: SUBMITTED blocks, DRAFT is a warning. */
    timesheetsFor(rows, lineIds, status) {
      const ids = (lineIds || []).map(String);
      return (Array.isArray(rows) ? rows : []).filter((r) => r && ids.indexOf(String(r.requestLineId)) !== -1
        && up(r.timesheetStatus || r.entryStatus) === status);
    }

    /** A transfer still PENDING for this source line in its history (it cannot be moved twice). */
    pendingFor(history, lineId) {
      return (Array.isArray(history) ? history : []).find((h) => h && String(h.sourceRequestLineId) === String(lineId)
        && up(h.transferStatus || h.status) === 'PENDING') || null;
    }

    /** True only when the flag is loaded and explicitly off (FDD default for ENABLE_INTER_PROJECT_TRANSFER is Yes). */
    switchedOff(flags, loaded) {
      return !!(loaded && flags && String(flags.ENABLE_INTER_PROJECT_TRANSFER || '').toLowerCase() === 'false');
    }

    /**
     * Everything that stops the transfer, in words, from what is on screen:
     *   s = { switchedOff, source, dest, sourceLines, destLines, selected, date, timesheets, history, sites }
     */
    problems(s) {
      const out = [];
      if (s.switchedOff) {
        out.push('Inter-project transfer is switched off in Configuration (ENABLE_INTER_PROJECT_TRANSFER).');
      }
      if (!s.source) {
        out.push('Choose the request the equipment is on.');
        return out;
      }
      const units = this.selectedLines(s.sourceLines, s.selected);
      if (!units.length) {
        out.push('Tick the units that move.');
      }
      if (!s.dest) {
        out.push('Choose the request the equipment moves to.');
      } else if (Number(s.dest.id) === Number(s.source.id)) {
        out.push('The equipment is already on ' + s.source.number + '.');
      }
      if (!iso(s.date)) {
        out.push('Enter the transfer date.');
      }
      units.forEach((u) => {
        const w = this.windowOf(u);
        if (iso(s.date) && !this.inWindow(s.date, w)) {
          out.push(this.unitText(u) + ' is on ' + s.source.number + ' ' + this.windowText(w) + '; the transfer date must fall in that period.');
        }
        const p = this.pendingFor(s.history, u.lineId);
        if (p) {
          out.push(this.unitText(u) + ' already has a transfer pending' + (p.orderNumber ? ' (' + p.orderNumber + ')' : '') + '.');
        }
      });
      const open = this.timesheetsFor(s.timesheets, units.map((u) => u.lineId), 'SUBMITTED');
      units.forEach((u) => {
        const mine = open.filter((t) => String(t.requestLineId) === String(u.lineId));
        if (mine.length) {
          const weeks = mine.map((t) => this.day(t.weekEndDate)).filter(Boolean);
          out.push(this.unitText(u) + ' has ' + (mine.length === 1 ? '1 submitted timesheet' : mine.length + ' submitted timesheets') + ' on '
            + s.source.number + (weeks.length ? ' for the week ending ' + weeks.join(', ') : '')
            + '. It must be approved before this transfer can go through.');
        }
      });
      const sites = units.map((u) => (s.sites || {})[String(u.lineId)]).filter(has);
      if (sites.some((x) => Number(x) !== Number(sites[0]))) {
        out.push('The ticked units are at different sites; move them in separate transfers.');
      }
      if (s.dest && units.length && Number(s.dest.id) !== Number(s.source.id)) {
        const { pairs, unmatched } = this.pair(units, s.destLines);
        if (!this.waiting(s.destLines).length) {
          out.push(s.dest.number + ' has no line waiting for equipment.');
        } else {
          unmatched.forEach((u) => out.push(s.dest.number + ' has no waiting line left for ' + this.unitText(u) + '.'));
        }
        pairs.forEach((p) => {
          const w = this.windowOf(p.dest);
          if (iso(s.date) && !this.inWindow(s.date, w)) {
            out.push(s.dest.number + ' needs ' + (p.dest.equipmentName || 'it') + ' ' + this.windowText(w) + '; the transfer date must fall in that period.');
          }
        });
      }
      return out;
    }

    /** Worth knowing, does not stop it. */
    warnings(s) {
      const out = [];
      if (!s.source) {
        return out;
      }
      const units = this.selectedLines(s.sourceLines, s.selected);
      this.timesheetsFor(s.timesheets, units.map((u) => u.lineId), 'DRAFT').forEach((t) => {
        const u = units.find((x) => String(x.lineId) === String(t.requestLineId));
        out.push(this.unitText(u) + ' has a draft timesheet on ' + s.source.number + (t.weekEndDate ? ' for the week ending ' + this.day(t.weekEndDate) : '') + '; it stays on that request.');
      });
      units.forEach((u) => {
        if (!has((s.sites || {})[String(u.lineId)])) {
          out.push('No transfer order brought ' + this.unitText(u) + ' to its site, so the transfer order is recorded without a source site.');
        }
      });
      return out;
    }

    moveText(n) {
      return n === 1 ? 'Transfer 1 item' : 'Transfer ' + (n || 0) + ' items';
    }

    // ── The same, from page variables (bindings pass plain arguments) ─────────────────────────────────────

    state(flags, flagsLoaded, sourceRows, sourceId, destRows, destId, sourceLines, destLines, selected, date, timesheets, history, sites) {
      return {
        switchedOff: this.switchedOff(flags, flagsLoaded),
        source: this.findRequest(sourceRows, sourceId),
        dest: this.findRequest(destRows, destId),
        sourceLines, destLines, selected, date, timesheets, history, sites,
      };
    }

    problemsOf(flags, flagsLoaded, sourceRows, sourceId, destRows, destId, sourceLines, destLines, selected, date, timesheets, history, sites) {
      return this.problems(this.state(flags, flagsLoaded, sourceRows, sourceId, destRows, destId, sourceLines, destLines, selected, date, timesheets, history, sites));
    }

    warningsOf(sourceRows, sourceId, sourceLines, selected, timesheets, sites) {
      return this.warnings({ source: this.findRequest(sourceRows, sourceId), sourceLines, selected, timesheets, sites });
    }

    pairsOf(sourceLines, selected, destLines) {
      return this.pair(this.selectedLines(sourceLines, selected), destLines).pairs;
    }

    requestNumber(rows, id) {
      const r = this.findRequest(rows, id);
      return r ? r.number : '';
    }

    requestLocation(rows, id) {
      const r = this.findRequest(rows, id);
      return r ? r.location : '';
    }

    hasSubmittedTimesheet(timesheets, lineId) {
      return this.timesheetsFor(timesheets, [lineId], 'SUBMITTED').length > 0;
    }

    /** Where a unit is, as text. */
    unitSite(invOrgs, sites, lineId) {
      return this.siteText(invOrgs, (sites || {})[String(lineId)]);
    }

    /** "Site TEXAS → the site of REQ-10527" for the move, from the first ticked unit. */
    routeText(invOrgs, sites, sourceLines, selected, destRows, destId) {
      const first = this.selectedLines(sourceLines, selected)[0];
      const from = first ? this.unitSite(invOrgs, sites, first.lineId) : 'the units’ site';
      return 'From ' + from + ' to the site of ' + (this.requestNumber(destRows, destId) || 'the destination');
    }

    doneText(done) {
      if (!done) {
        return '';
      }
      if (done.replayed) {
        return 'This transfer was already recorded.';
      }
      return 'Recorded: ' + (done.count === 1 ? '1 item' : done.count + ' items') + ' from ' + done.from + ' to ' + done.to
        + (done.orderNumber ? ' (' + done.orderNumber + ')' : '') + '.';
    }

    historyTitle(rows, id) {
      return 'Transfers of ' + (this.requestNumber(rows, id) || 'this request');
    }

    // ── Plan, reserve and the bodies ────────────────────────────────────────────────────────────────────────

    /** The destination site from planConfirm: the bucket holding the destination lines, or null. */
    destSite(plan, lineIds) {
      const ids = (lineIds || []).map(Number);
      const b = ((plan && plan.buckets) || []).find((x) => (x.lines || []).some((l) => ids.indexOf(Number(l.requestLineId)) !== -1));
      return b ? { orgId: b.destOrgId, code: b.destOrgCode || '', name: b.destOrgName || '' } : null;
    }

    /** planConfirm blocks that stop a transfer, in words. */
    planBlocks(plan, lineIds) {
      const ids = (lineIds || []).map(Number);
      return ((plan && plan.blocks) || [])
        .filter((b) => ids.indexOf(Number(b.requestLineId)) !== -1 && HARD_BLOCKS[b.reasonCode])
        .map((b) => (b.equipmentName || 'Line ' + b.requestLineId) + ' ' + HARD_BLOCKS[b.reasonCode] + (b.reasonDetail ? ' (' + b.reasonDetail + ')' : '') + '.');
    }

    /** The item number planConfirm resolved for a destination line, or null. */
    itemNumber(plan, lineId) {
      let found = null;
      ((plan && plan.buckets) || []).forEach((b) => (b.lines || []).forEach((l) => {
        if (Number(l.requestLineId) === Number(lineId) && l.itemNumber) {
          found = l.itemNumber;
        }
      }));
      return found;
    }

    /**
     * Deterministic key over the transfer intent, the old confirm's buildIdempotencyKey (request-detail
     * ActionChain.js) unchanged: same request + line set + leg + source + attempt -> same key, so /reserve
     * recognises a repeat fire. FNV-1a 32-bit twice, 16 hex characters.
     */
    idempotencyKey(intent) {
      const ids = (intent.lineIds || [])
        .map(Number)
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b)
        .join(',');
      const canonical = [
        'v1',
        String(intent.requestId || ''),
        ids,
        String(intent.leg || ''),
        String(intent.sourceCode || ''),
      ].join('|') + (Number(intent.attempt) > 0 ? '|a' + Number(intent.attempt) : '');
      const fnv = (str, seed) => {
        let h = seed >>> 0;
        for (let i = 0; i < str.length; i++) {
          h ^= str.charCodeAt(i);
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        return ('00000000' + h.toString(16)).slice(-8);
      };
      return fnv(canonical, 0x811c9dc5) + fnv(canonical, 0x9dc5811c);
    }

    /** Who and what a transfer reserves: the destination lines' outbound leg, sourced from these units. */
    intent(source, dest, pairs, attempt) {
      const destIds = [];
      pairs.forEach((p) => { if (destIds.indexOf(Number(p.dest.lineId)) === -1) { destIds.push(Number(p.dest.lineId)); } });
      const srcIds = pairs.map((p) => Number(p.source.lineId)).sort((a, b) => a - b);
      return {
        requestId: Number(dest.id),
        lineIds: destIds,
        leg: 'OUTBOUND',
        sourceCode: 'TRF' + source.id + ':' + srcIds.join('.'),
        attempt: Number(attempt) || 0,
      };
    }

    batchNumber(destNumber, stamp) {
      return 'EQR-TRF-' + (destNumber || '') + '-' + stamp;
    }

    /** POST /transfer-orders: one order for the move, on the destination request, PENDING until it is done. */
    orderBody(f) {
      return {
        equipmentRequestId: Number(f.dest.id),
        orderNumber: f.batchNumber,
        orderType: 'INTER_PROJECT',
        orderStatus: 'PENDING',
        sourceOrgId: has(f.sourceOrgId) ? Number(f.sourceOrgId) : null,
        destinationOrgId: f.destSite && has(f.destSite.orgId) ? Number(f.destSite.orgId) : null,
        requestedDate: iso(f.date) + 'T00:00:00Z',
        needByDate: iso(f.date) + 'T00:00:00Z',
        shippingNotes: String(f.comments || '').trim() || null,
      };
    }

    /** POST /transfer-order-lines: one per unit, on the destination line it fills. */
    orderLineBody(orderId, p, i, itemNumber) {
      return {
        transferOrderId: Number(orderId),
        requestLineId: Number(p.dest.lineId),
        lineNumber: i + 1,
        itemNumber: itemNumber || null,
        quantity: Math.max(1, Number(p.source.quantity) || 1),
        lineStatus: 'PENDING',
        serialNumber: p.source.allocatedSerial || null,
        notes: 'From ' + (p.source.requestNumber || '') + ' line ' + p.source.lineId,
      };
    }

    /** POST /transfer-history: one per unit, readable on both requests without a join. */
    historyBody(f, p, orderId) {
      return {
        transferOrderId: Number(orderId),
        orderNumber: f.batchNumber,
        sourceRequestId: Number(f.source.id),
        sourceRequestNumber: f.source.number,
        sourceProjectName: f.source.party || null,
        sourceRequestLineId: Number(p.source.lineId),
        destinationRequestId: Number(f.dest.id),
        destinationRequestNumber: f.dest.number,
        destinationProjectName: f.dest.party || null,
        destinationRequestLineId: Number(p.dest.lineId),
        equipmentMasterId: has(p.source.equipmentMasterId) ? Number(p.source.equipmentMasterId) : null,
        equipmentName: p.source.equipmentName || null,
        serialNumber: p.source.allocatedSerial || null,
        quantity: Math.max(1, Number(p.source.quantity) || 1),
        sourceOrgId: has(f.sourceOrgId) ? Number(f.sourceOrgId) : null,
        destinationOrgId: f.destSite && has(f.destSite.orgId) ? Number(f.destSite.orgId) : null,
        destinationSubinventory: String(f.subinventory || '').trim() || null,
        destinationLocator: String(f.locator || '').trim() || null,
        transferDate: iso(f.date) + 'T00:00:00Z',
        transferStatus: 'PENDING',
        comments: String(f.comments || '').trim() || null,
        transferredBy: f.actor || null,
      };
    }

    // ── Sites and history ───────────────────────────────────────────────────────────────────────────────────

    /** Org id -> "TEXAS · Texas project sites" from inv-orgs rows, or 'Org 300…' when unknown. */
    siteText(invOrgs, orgId) {
      if (!has(orgId)) {
        return 'not known';
      }
      const o = (Array.isArray(invOrgs) ? invOrgs : []).find((x) => Number(x.organizationId) === Number(orgId) || Number(x.invOrgId) === Number(orgId));
      return o ? [o.organizationCode, o.organizationName].filter(Boolean).join(' · ') : 'Org ' + orgId;
    }

    /** Transfer-history rows for display, newest first: [{ id, date, equipment, from, to, ref, status, by }]. */
    historyRows(rows, limit) {
      const list = (Array.isArray(rows) ? rows : []).filter(Boolean).map((h) => ({
        id: h.id,
        sort: String(h.transferDate || h.createdDate || ''),
        date: this.day(h.transferDate || h.createdDate),
        equipment: (h.equipmentName || '') + (h.serialNumber ? ' · ' + h.serialNumber : ''),
        from: (h.sourceRequestNumber || (has(h.sourceRequestId) ? 'Request ' + h.sourceRequestId : '')) + (h.sourceProjectName ? ' ' + h.sourceProjectName : ''),
        to: (h.destinationRequestNumber || (has(h.destinationRequestId) ? 'Request ' + h.destinationRequestId : '')) + (h.destinationProjectName ? ' ' + h.destinationProjectName : ''),
        ref: h.orderNumber || h.fusionTransferNumber || (has(h.transferOrderId) ? 'TO ' + h.transferOrderId : ''),
        status: up(h.transferStatus || h.status) || 'PENDING',
        by: h.transferredBy || h.createdBy || '',
      }));
      list.sort((a, b) => b.sort.localeCompare(a.sort) || (Number(b.id) - Number(a.id)));
      return limit ? list.slice(0, limit) : list;
    }

    statusText(s) {
      return { PENDING: 'Pending', COMPLETED: 'Completed', POSTED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled' }[up(s)] || (s ? String(s) : '');
    }
  }

  return PageModule;
});
