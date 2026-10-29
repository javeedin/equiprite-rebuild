define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Module-level debounce — same row clicked within 1s is treated as duplicate.
  // ojButton inside ojDataGrid cell-template fires oj-action twice on a single
  // user click (synthetic + bubbling). Without this guard, two parallel
  // navigateToPage calls race to the same destination.
  let _lastClickKey = '';
  let _lastClickAt  = 0;

  class rowClickChain extends ActionChain {
    async run(context, { rowIndex }) {
      const { $page } = context;

      console.log('[rowClickChain] received rowIndex=', rowIndex, 'type=', typeof rowIndex);

      // Header gate: the line-detail (allocation) page is off-limits while
      // allocation isn't permitted yet — either the request is still awaiting
      // approval (SUBMITTED) or a quote is still owed (quoting enabled for this
      // origin and no quote produced yet; the manager must Generate Quote
      // first). Mirrors the disabled hamburger on the grid — this is the
      // matching programmatic guard so the ojButton double-fire or any other
      // caller can't slip past the disabled button. Keep in lockstep with
      // isRequestSubmitted / isQuoteOwed in request-detail-page.js.
      const headerStatus = String(
        ($page.variables.formData && $page.variables.formData.status) || ''
      ).toUpperCase();
      const quoteExists = ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED']
        .indexOf(headerStatus) !== -1;
      const quoteOwed   = !!$page.variables.quotingAllowed && !quoteExists;
      if (headerStatus === 'SUBMITTED' || quoteOwed) {
        // EXCEPTION: a CUSTOMER-sourced line at UNDER_PROCUREMENT is viewable
        // (read-only) even while the gate is closed. UNDER_PROCUREMENT is a LINE
        // status; the header sits at SUBMITTED or IN_PROCESS, so decide per row.
        // line-detail hides Assign/Release in that case (pickerReadOnly). All
        // other lines stay blocked.
        // Origin is 'EXTERNAL' | 'INTERNAL' (was 'CUSTOMER' | 'PROJECT').
        const isCustomer = context.$application.functions.isExternalSource(
          $page.variables.formData && $page.variables.formData.source
        );
        const linesForGate = $page.variables.linesArray;
        const gateLine = (Array.isArray(linesForGate) && rowIndex != null)
          ? linesForGate[Number(rowIndex)] : null;
        const gateLs = gateLine ? String(gateLine.line_status || '').toUpperCase() : '';
        if (!(isCustomer && gateLs === 'UNDER_PROCUREMENT')) {
          console.log('[rowClickChain] allocation gated (status=' + headerStatus +
                      ', quoteOwed=' + quoteOwed + ') — line-detail navigation blocked');
          return;
        }
        console.log('[rowClickChain] gated header but customer/UNDER_PROCUREMENT line — allowing read-only line-detail');
      }

      const dedupeKey = String($page.variables.requestId || '') + '|' + String(rowIndex);
      const now = Date.now();
      if (dedupeKey === _lastClickKey && now - _lastClickAt < 1000) {
        console.log('[rowClickChain] debounced duplicate click (within 1s) — ignoring');
        return;
      }
      _lastClickKey = dedupeKey;
      _lastClickAt  = now;

      // Suppress the initialization event (isTrusted: false, fires during grid render)
      if (rowIndex === undefined || rowIndex === null || rowIndex === '' || rowIndex === 'undefined') {
        console.warn('[rowClickChain] empty rowIndex — bailing out');
        return;
      }

      const idx = Number(rowIndex);
      if (isNaN(idx) || idx < 0) {
        console.warn('[rowClickChain] invalid rowIndex:', rowIndex);
        return;
      }

      const lines = $page.variables.linesArray;
      if (!lines || !lines.length || idx >= lines.length) {
        console.warn('[rowClickChain] linesArray empty or index out of bounds:', idx, 'lines=', lines?.length);
        return;
      }

      const line = lines[idx];
      if (!line) {
        console.warn('[rowClickChain] no line at index', idx);
        return;
      }

      // TERMINAL LINE — no action of any kind, including opening line-detail.
      // A rejected line is finished; nothing may be allocated, procured or
      // otherwise done to it. The row's hamburger is rendered disabled (see
      // isLineTerminal in request-detail-page.js); this is the matching
      // programmatic guard for the ojButton double-fire and any other caller.
      // Keep the list in lockstep with TERMINAL_LINE_STATUSES there.
      const terminalStatuses = ['REJECTED', 'CANCELLED'];
      const lineStatus = String(line.line_status || '').toUpperCase();
      if (terminalStatuses.indexOf(lineStatus) !== -1) {
        console.log('[rowClickChain] line is ' + lineStatus + ' — terminal, navigation blocked');
        return;
      }

      // Line-detail (the pick page) is meaningful only when a line needs a
      // per-unit, per-lot, or per-inventory-item assignment — OR when it is an
      // F&M line, which is assigned directly rather than picked.
      //
      // F&M (Fixed-asset / Maintenance tracked, isTransactable='N') is NOT
      // free-stock: it has no Fusion inventory item, but it is still allocated —
      // per serial unit when serial controlled (30 such masters with 60
      // EQR_SERIAL_REF units are seeded), by quantity otherwise. Excluding it
      // here was what made an F&M line unreachable, because is_inventory_tracked
      // is 'N' for every one of them.
      //
      // Genuine free-stock — no serial, no lot, no inventory AND not F&M —
      // stays blocked: that is the real "no allocation pathway" case.
      //
      // The class comes from requestDetailLines.classOfLine() via the
      // precomputed fulfilment_class field, so this guard and the grid's
      // disabled hamburger (isLinePickable) can never disagree about what F&M
      // means.
      const isFAndMLine = line.fulfilment_class === 'F_AND_M';
      if (!line.is_serial_controlled && !line.is_lot_controlled
          && !line.is_inventory_tracked && !isFAndMLine) {
        console.log('[rowClickChain] line is free-stock (no serial / lot / inventory tracking, not F&M) — skipping navigation');
        return;
      }

      console.log('[rowClickChain] navigating with line=', { line_id: line.line_id, equipment_master_id: line.equipment_master_id });

      const lineId            = line.line_id;
      const equipmentMasterId = line.equipment_master_id;
      const requestId         = $page.variables.requestId;
      const requestNumber     = $page.variables.requestNumber;

      if (!lineId || !requestId) {
        console.warn('[rowClickChain] missing lineId or requestId');
        return;
      }

      await Actions.navigateToPage(context, {
        page:   'line-detail',
        params: {
          requestId:         String(requestId),
          requestNumber:     String(requestNumber),
          lineId:            String(lineId),
          equipmentMasterId: equipmentMasterId != null ? String(equipmentMasterId) : ''
        }
      });
    }
  }

  return rowClickChain;
});
