define(['resources/js/requestProgress'], (Progress) => {
  'use strict';

  // EquipRite Next, Direct cost & inventory: what an active request has used and what it has cost.
  //
  // DirectCostRules below is New EquipRite's Direct cost & inventory page module (webApps/equiprite/flows/usage/pages/
  // project-costs-page.js) COPIED UNCHANGED: which requests count as active, which lines can take a consumption, the
  // consumed total, the direct-cost summary and the cost total. tests/next-usage.test.js holds every method to New's
  // source text. Recording a material issue or a direct cost is a posting to Fusion (FDD 7.9.1A, 7.9.2A: an expenditure
  // item, a miscellaneous issue), so EquipRite Next only shows them (the DirectCost class at the end) and the recording
  // stays in New EquipRite.
  //
  // ── New's header, as it stands ──
  // Direct cost & inventory use (wireframe: Project costs; FDD 7.9.1A, 7.9.2A, S25). Old EquipRite has no real
  // screen for it: equipment-record-cost is a mock that posts nothing (recordCostMock.js), and the only real write
  // is the Material Issue drawer on the old request detail (submitTransactionChain), which this page carries.
  //
  //   Inventory consumption   POST /inventory-consumptions, then the line's consumed quantity, as the old drawer
  //   Direct cost             read-only: /direct-cost-txns publishes no request fields in services/eqp-v1, so a
  //                           cost cannot be recorded without inventing its body (see the page)
  //   Cost history            views/project-cost-detail for the request

  // Requests whose equipment is approved, on its way, on site or coming back: what a fuel bill or a consumable can be
  // charged against (FDD S25, "an active request").
  const ACTIVE = ['APPROVED', 'ALLOCATED', 'PICK_INITIATED', 'PICK_RELEASED', 'EQP_INSPECTION_COMPLETE', 'SHIPPED', 'SHIP_TO_SITE',
    'DEPLOYED', 'DELIVERED', 'RETURN_INITIATED'];
  // A consumption PATCHes the line's consumed quantity and can close it, so a turned-down line is never offered
  // (old initChain ISSUABLE_EXCLUDED).
  const NOT_ISSUABLE = ['REJECTED', 'CANCELLED'];

  function money(n) {
    if (n == null || n === '' || isNaN(Number(n))) return '—';
    const v = Number(n);
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  class DirectCostRules {
    money(n) {
      return money(n);
    }

    activeRequests(rows) {
      return (Array.isArray(rows) ? rows : [])
        .filter((r) => r && r.eqrEquipmentRequestId && ACTIVE.indexOf(String(r.status || r.requestStatus || '').toUpperCase()) >= 0)
        .map((r) => ({
          id: Number(r.eqrEquipmentRequestId),
          requestNumber: r.requestNumber || '',
          projectName: r.projectName || '',
          taskName: r.taskName || '',
          status: String(r.status || r.requestStatus || '').toUpperCase(),
        }))
        .sort((a, b) => b.id - a.id);
    }

    filterRequests(list, text) {
      const q = String(text || '').trim().toLowerCase();
      return (Array.isArray(list) ? list : []).filter((r) => !q
        || [r.requestNumber, r.projectName, r.taskName].some((v) => v && String(v).toLowerCase().includes(q))).slice(0, 60);
    }

    /** Lines of views/request-detail-lines a consumption can be recorded against (old initChain requestLinesArray). */
    issuableLines(rows) {
      return (Array.isArray(rows) ? rows : [])
        .filter((l) => l && l.lineId != null && NOT_ISSUABLE.indexOf(String(l.lineStatus || '').toUpperCase()) === -1)
        .map((l) => ({
          lineId: Number(l.lineId),
          equipmentName: l.equipmentName || 'Equipment',
          quantity: l.quantity != null ? Number(l.quantity) : null,
          lineStatus: String(l.lineStatus || '').toUpperCase(),
          consumableFlag: l.consumableFlag || 'N',
          deliveredQuantity: l.deliveredQuantity != null ? Number(l.deliveredQuantity) : null,
          consumedQuantity: l.consumedQuantity != null ? Number(l.consumedQuantity) : null,
        }));
    }

    /** Units of a line (views/line-detail-units), as the old loadMaterialIssueLineChain lists them. */
    unitOptions(rows) {
      return (Array.isArray(rows) ? rows : []).filter((u) => u && u.unitNumber).map((u) => ({
        value: String(u.unitNumber),
        label: u.unitNumber + (u.availableToReserve != null ? '  (on hand ' + u.availableToReserve + ')' : '') + (u.invOrgName ? '  - ' + u.invOrgName : ''),
        uomCode: u.uomCode || '',
        invOrgName: u.invOrgName || '',
        invOrgId: u.invOrgId,
        unitType: u.unitType || '',
        availableToReserve: u.availableToReserve,
      }));
    }

    /** What stops a material issue (old submitTransactionChain), as one list. */
    issueProblems(requestId, form, units) {
      const f = form || {};
      const out = [];
      const qty = Number(f.quantity);
      const item = String(f.itemNumber || '').trim();
      if (!requestId) out.push('the request id is missing');
      if (!f.lineId) out.push('no request line is selected');
      if (!item) out.push('the item / lot / serial number is empty');
      if (!(qty > 0)) out.push('quantity consumed must be greater than zero');
      if (qty > 0 && item) {
        const unit = (units || []).find((u) => u.value === item);
        const onHand = unit ? Number(unit.availableToReserve) : NaN;
        if (unit && unit.availableToReserve != null && Number.isFinite(onHand) && qty > onHand) {
          out.push('quantity consumed (' + qty + ') exceeds the ' + onHand + ' on hand for ' + item);
        }
      }
      return out;
    }

    /** The consumption row (old submitTransactionChain body). Subinventory has no column, so it rides in notes. */
    consumptionBody(requestId, form, unit, today) {
      const f = form || {};
      const sub = String(f.subinventory || '').trim();
      return {
        equipmentRequestId: Number(requestId),
        requestLineId: Number(f.lineId),
        itemNumber: String(f.itemNumber || '').trim(),
        quantityConsumed: Number(f.quantity),
        uomCode: String(f.uom || 'EA').trim() || 'EA',
        invOrgId: unit && unit.invOrgId != null ? Number(unit.invOrgId) : null,
        consumptionType: 'USAGE',
        transactionDate: String(today || new Date().toISOString()).slice(0, 10) + 'T00:00:00Z',
        notes: sub ? 'Subinventory: ' + sub : null,
      };
    }

    /**
     * After a consumption: the line's consumed total from every consumption row, and whether the line is now used
     * up (a consumable, against the DELIVERED quantity, else the requested one). Old submitTransactionChain.
     */
    consumedState(rows, line) {
      const lineId = Number(line && line.lineId);
      const total = (Array.isArray(rows) ? rows : []).filter((r) => Number(r.requestLineId) === lineId)
        .reduce((s, r) => s + Number(r.quantityConsumed || 0), 0);
      const delivered = Number(line && line.deliveredQuantity);
      const requested = Number(line && line.quantity);
      const denominator = Number.isFinite(delivered) && delivered > 0 ? delivered : (Number.isFinite(requested) && requested > 0 ? requested : null);
      const fullyConsumed = !!line && line.consumableFlag === 'Y' && denominator != null && total >= denominator;
      return { total, fullyConsumed };
    }

    /** True when every line is done once this one is CONSUMED (CLOSED, REJECTED or CONSUMED). */
    allTerminal(lines, lineId) {
      const DONE = ['CLOSED', 'REJECTED', 'CONSUMED'];
      const list = Array.isArray(lines) ? lines : [];
      return list.length > 0 && list.every((l) => (Number(l.lineId) === Number(lineId) ? true : DONE.indexOf(String(l.lineStatus || '').toUpperCase()) >= 0));
    }

    lineLabel(line) {
      if (!line) return '';
      return line.equipmentName + (line.quantity != null ? ' (qty ' + line.quantity + ')' : '') + ' · ' + this.statusText(line.lineStatus);
    }

    statusText(s) {
      const v = String(s || '');
      return v ? (v.charAt(0) + v.slice(1).toLowerCase()).replace(/_/g, ' ') : '—';
    }

    statusClass(s) {
      return 'er-status er-status--' + (String(s || '') || 'DRAFT');
    }

    /** A direct-cost row as text, from the fields such a row is likely to carry; the API declares none. */
    directSummary(r) {
      if (!r) return { date: '', what: '', amount: '', status: '' };
      const pick = (keys) => { for (const k of keys) { if (r[k] != null && r[k] !== '') return r[k]; } return ''; };
      return {
        date: String(pick(['transactionDate', 'expenditureItemDate', 'costDate', 'createdDate'])).slice(0, 10),
        what: [pick(['expenditureType', 'costType']), pick(['description', 'comments', 'notes', 'reference'])].filter(Boolean).join(' · ') || ('Direct cost ' + (r.id || '')),
        amount: pick(['rawCost', 'amount', 'burdenedCost', 'totalCost']),
        status: String(pick(['status', 'postStatus'])).toUpperCase(),
      };
    }

    costTotal(rows) {
      return Math.round((Array.isArray(rows) ? rows : []).reduce((s, r) => s + Number(r.totalCost != null ? r.totalCost : (r.cost || 0)), 0) * 100) / 100;
    }

    consumedTotal(rows, lineId) {
      return (Array.isArray(rows) ? rows : []).filter((r) => !lineId || Number(r.requestLineId) === Number(lineId))
        .reduce((s, r) => s + Number(r.quantityConsumed || 0), 0);
    }

    day(v) {
      return v ? String(v).slice(0, 10) : '';
    }
  }

  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // EquipRite Next's own layer. Reads only: what each line has used and what is left, in words.
  // ════════════════════════════════════════════════════════════════════════════════════════════════════════════

  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const numOrNull = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));

  class DirectCost extends DirectCostRules {
    /** A request's or a line's stored status in words, and its journey colour (requestProgress). */
    statusWord(status) {
      return Progress.line(status).label || '—';
    }

    statusTone(status) {
      return Progress.line(status).stage || 'draft';
    }

    /** New's activeRequests, filtered by New's filterRequests (search), with the status in words. */
    requestRows(list, text) {
      return this.filterRequests(list, text).map((r) => Object.assign({}, r, { word: this.statusWord(r.status), tone: this.statusTone(r.status) }));
    }

    /**
     * New's issuableLines with what each has used (New's consumedTotal over the consumption rows) and, for a
     * consumable, what is left of the quantity it is measured against: the delivered quantity, else the requested one
     * (New's consumedState rule). Consumables first.
     */
    lineRows(lines, consumptions) {
      const out = (Array.isArray(lines) ? lines : []).map((l) => {
        const consumable = l.consumableFlag === 'Y';
        const used = r2(this.consumedTotal(consumptions, l.lineId));
        const delivered = numOrNull(l.deliveredQuantity);
        const requested = numOrNull(l.quantity);
        const base = delivered != null && delivered > 0 ? delivered : (requested != null && requested > 0 ? requested : null);
        return {
          lineId: l.lineId,
          equipmentName: l.equipmentName,
          kind: consumable ? 'Consumable' : 'Equipment',
          consumable,
          requested,
          delivered,
          used,
          left: consumable && base != null ? r2(Math.max(0, base - used)) : null,
          word: this.statusWord(l.lineStatus),
          tone: this.statusTone(l.lineStatus),
          lineStatus: l.lineStatus,
        };
      });
      return out.sort((a, b) => (b.consumable ? 1 : 0) - (a.consumable ? 1 : 0));
    }

    /** The material issues recorded, newest first, each with the equipment line it was used on. */
    issueRows(consumptions, lines) {
      const names = {};
      (Array.isArray(lines) ? lines : []).forEach((l) => { names[Number(l.lineId)] = l.equipmentName; });
      return (Array.isArray(consumptions) ? consumptions : []).map((c, i) => ({
        key: 'c' + (c.id || c.eqrInventoryConsumptionId || i),
        date: this.day(c.transactionDate),
        item: c.itemNumber || '',
        quantity: numOrNull(c.quantityConsumed),
        uom: c.uomCode || '',
        type: this.statusText(c.consumptionType),
        line: names[Number(c.requestLineId)] || (c.requestLineId != null ? 'Line ' + c.requestLineId : ''),
        notes: c.notes || '',
      })).sort((a, b) => b.date.localeCompare(a.date));
    }

    /** Direct costs with New's directSummary. */
    directRows(rows) {
      return (Array.isArray(rows) ? rows : []).map((r, i) => {
        const s = this.directSummary(r);
        return { key: 'd' + (r.id || i), date: s.date, what: s.what, amount: numOrNull(s.amount), status: s.status, word: this.statusText(s.status) };
      });
    }

    directTotal(rows) {
      return r2(this.directRows(rows).reduce((s, r) => s + (r.amount || 0), 0));
    }

    /** Cost history rows (views/project-cost-detail), as the reports page reads them. */
    historyRows(rows) {
      return (Array.isArray(rows) ? rows : []).map((c, i) => ({
        key: 'h' + (c.rowKey || i),
        date: this.day(c.postedDate || c.costDate),
        equipment: (c.equipmentName || '') + (c.equipmentNumber ? ' · ' + c.equipmentNumber : ''),
        quantity: numOrNull(c.quantity),
        cost: numOrNull(c.totalCost != null ? c.totalCost : c.cost),
        status: this.statusText(c.postedStatus),
      }));
    }

    /** The request in figures: consumables, what they used and have left, direct cost, cost to date. */
    facts(lines, consumptions, directCosts, costRows) {
      const rows = this.lineRows(lines, consumptions);
      const cons = rows.filter((r) => r.consumable);
      return {
        lines: rows.length,
        consumables: cons.length,
        used: r2(cons.reduce((s, r) => s + r.used, 0)),
        left: r2(cons.reduce((s, r) => s + (r.left || 0), 0)),
        issues: Array.isArray(consumptions) ? consumptions.length : 0,
        direct: this.directTotal(directCosts),
        directCount: Array.isArray(directCosts) ? directCosts.length : 0,
        cost: this.costTotal(costRows),
      };
    }

    exportColumns(kind) {
      if (kind === 'lines') {
        return [
          { key: 'equipmentName', label: 'Equipment' }, { key: 'kind', label: 'Kind' },
          { key: 'requested', label: 'Requested', type: 'number' }, { key: 'delivered', label: 'Delivered', type: 'number' },
          { key: 'used', label: 'Used', type: 'number' }, { key: 'left', label: 'Left', type: 'number' },
          { key: 'word', label: 'Where it is' }, { key: 'lineStatus', label: 'Stored line status' },
        ];
      }
      if (kind === 'issues') {
        return [
          { key: 'date', label: 'Date' }, { key: 'item', label: 'Item, lot or serial' }, { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'uom', label: 'Unit' }, { key: 'line', label: 'Used on' }, { key: 'type', label: 'Type' }, { key: 'notes', label: 'Notes' },
        ];
      }
      if (kind === 'direct') {
        return [{ key: 'date', label: 'Date' }, { key: 'what', label: 'What' }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'word', label: 'Status' }];
      }
      if (kind === 'history') {
        return [{ key: 'date', label: 'Date' }, { key: 'equipment', label: 'Equipment' }, { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'cost', label: 'Cost', type: 'number' }, { key: 'status', label: 'Status' }];
      }
      return [
        { key: 'requestNumber', label: 'Request' }, { key: 'projectName', label: 'Project' }, { key: 'taskName', label: 'Task' },
        { key: 'word', label: 'Where it is' }, { key: 'status', label: 'Stored status' },
      ];
    }
  }

  return { DirectCostRules, DirectCost };
});

