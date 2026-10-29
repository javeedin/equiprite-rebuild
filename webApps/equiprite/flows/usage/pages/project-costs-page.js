define([], () => {
  'use strict';

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

  class PageModule {
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

  return PageModule;
});
