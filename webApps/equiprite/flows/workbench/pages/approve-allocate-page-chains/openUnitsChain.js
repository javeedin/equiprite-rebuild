define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/lineDetailUnits',
  'resources/js/lineConfirmed',
  'resources/js/requestDetailLines',
], (ActionChain, Actions, lineDetailUnits, lineConfirmed, rdl) => {
  'use strict';

  // Opens (or closes, or reloads) the unit picker of one line. Carried over from the old line-detail page's load
  // (equipment-foundation line-detail-page-chains/vbEnterChain.js), which an old request-detail row opened:
  //   views/line-detail-units      every unit of the line's equipment with its availability over the line's dates,
  //                                and this line's allocations (the picker; same view, same params)
  //   transfer-orders (+ lines)    is THIS line confirmed (a live Transfer Order)? Then it is read only
  //                                (lineConfirmed, copied unchanged)
  //   views/line-detail-bookings   serial mode: other requests' bookings of these units (the schedule)
  // with the old gates: allocation is closed while the request is SUBMITTED or owes a quote, except a customer
  // line at UNDER_PROCUREMENT, which is shown read only; the mode is serial, lot or inventory from the unit rows'
  // control flags (serial first). Left out, as display-only: ship-to-sites (map pins), the allocations list (the
  // old scheduler's own bars; the unit rows carry the same allocationId) and serial-refs + Fusion work orders
  // (maintenance bars).
  const EMPTY = { loading: false, error: '', mode: '', confirmed: false, readOnly: false, title: '' };

  const toBoolY = (v) => (typeof v === 'boolean') ? v : (v || '').toString().toUpperCase() === 'Y';

  class openUnitsChain extends ActionChain {
    async run(context, { lineId, close, reload }) {
      const { $page, $application } = context;
      const fns = $application.functions;
      const vars = $application.variables;
      const v = $page.variables;

      if (close || (!reload && lineId != null && String(v.openLineId) === String(lineId))) {
        v.openLineId = '';
        v.allocLine = null;
        v.units = Object.assign({}, EMPTY);
        return;
      }
      const line = $page.functions.getAllLines().find((l) => String(l.line_id) === String(lineId));
      if (!line) {
        return;
      }
      const gate = $page.functions.lineAction(line, v.formData, v.quotingAllowed, v.isReadOnly);
      if (gate.kind === 'blocked' || gate.kind === 'none') {
        await Actions.fireNotificationEvent(context, {
          summary: 'Not open for allocation',
          message: gate.reason || 'This line takes no allocation.',
          displayMode: 'transient',
          type: 'info'
        });
        return;
      }

      const requestId = Number(v.requestNumericId);
      v.openLineId = String(lineId);
      v.units = Object.assign({}, EMPTY, { loading: true, title: line.equipment_name || ('Line ' + line.line_no), lineNo: line.line_no });

      const settled = await Promise.allSettled([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
          uriParams: { requestId: requestId, lineId: Number(lineId), size: 10000 }
        }),
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getTransferOrders',
          uriParams: { equipmentRequestId: requestId }
        })
      ]);
      if (String(v.openLineId) !== String(lineId)) {
        return; // another line was opened meanwhile
      }
      const detailResp = settled[0].status === 'fulfilled' ? settled[0].value : null;
      const toResp     = settled[1].status === 'fulfilled' ? settled[1].value : null;
      const detailRows = (detailResp && detailResp.ok && detailResp.body && Array.isArray(detailResp.body.data))
        ? detailResp.body.data : [];
      const detailRow = detailRows.find((r) => String(r.lineId) === String(lineId));
      if (!detailResp || !detailResp.ok) {
        v.units = Object.assign({}, v.units, { loading: false, error: 'The units of this line could not be loaded (HTTP ' + (detailResp && detailResp.status) + ').' });
        return;
      }
      if (!detailRow) {
        v.units = Object.assign({}, v.units, { loading: false,
          error: 'No serial numbers, lots or stock items are registered for ' + (line.equipment_name || 'this equipment') + '.' });
        return;
      }

      // Gates (old vbEnterChain): customer line at UNDER_PROCUREMENT is read only; SUBMITTED or quote owed is closed.
      const isCustomerSource = fns.isExternalSource(detailRow.source);
      const pickerReadOnly = isCustomerSource && String(detailRow.lineStatus || '').toUpperCase() === 'UNDER_PROCUREMENT';
      const gateStatus = String(detailRow.requestStatus || '').toUpperCase();
      const quoteExists = ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED'].indexOf(gateStatus) !== -1;
      const quotingOn = fns.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, detailRow.source);
      const quoteOwed = quotingOn && !quoteExists;
      if ((gateStatus === 'SUBMITTED' || quoteOwed) && !pickerReadOnly) {
        v.units = Object.assign({}, v.units, { loading: false,
          error: gateStatus === 'SUBMITTED' ? 'Allocation opens once the request is approved.' : 'Allocation opens once the quote is generated.' });
        return;
      }

      // Mode: serial, then lot, then inventory (old vbEnterChain; serial when the flag is missing).
      const isLotCtrl    = toBoolY(detailRow.isLotControlled);
      const isSerialCtrl = (detailRow.isSerialControlled != null) ? toBoolY(detailRow.isSerialControlled) : true;
      const isInvTracked = toBoolY(detailRow.isInventoryTracked);
      let mode;
      if (isSerialCtrl)      mode = 'serial';
      else if (isLotCtrl)    mode = 'lot';
      else if (isInvTracked) mode = 'inventory';
      else                   mode = 'serial';
      if (rdl.isFAndM(detailRow) && !isSerialCtrl && !isLotCtrl) {
        console.warn('[openUnitsChain] NON-SERIAL F&M line ' + lineId + ': no unit picker applies (as in Old EquipRite).');
      }

      const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
      const eqpMasterId = detailRow.equipmentMasterId || line.equipment_master_id;
      const eqpInfo = { equipmentName: detailRow.equipmentName || '', className: detailRow.className || '' };
      const allocLine = {
        line_id:             detailRow.lineId,
        line_no:             line.line_no,
        equipment_master_id: eqpMasterId,
        equipment_name:      eqpInfo.equipmentName,
        class:               eqpInfo.className,
        qty:                 detailRow.quantity || 1,
        alloc_status:        detailRow.allocStatus || 'PENDING',
        start_date:          day(detailRow.lineStartDate || detailRow.startDate),
        end_date:            day(detailRow.lineEndDate || detailRow.endDate),
        line_status:         detailRow.lineStatus || '',
        source:              detailRow.source || '',
        quoting_on:          quotingOn === true,
        request_number:      detailRow.requestNumber || (v.formData && v.formData.requestNumber) || ''
      };

      const confirmed = await lineConfirmed.lineIsConfirmed(context, Actions,
        (toResp && toResp.ok && toResp.body && toResp.body.data) || [], lineId);
      const built = lineDetailUnits.buildResources(detailRows, mode, eqpInfo, eqpMasterId);

      let bookingRows = [];
      if (mode === 'serial' && eqpMasterId) {
        try {
          const bookingsResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailBookings',
            uriParams: { equipmentMasterId: Number(eqpMasterId), size: 10000 }
          });
          if (bookingsResp && bookingsResp.ok && bookingsResp.body && Array.isArray(bookingsResp.body.data)) {
            bookingRows = bookingsResp.body.data;
          }
        } catch (e) {
          console.warn('[openUnitsChain] line-detail-bookings fetch failed:', e);
        }
      }
      if (String(v.openLineId) !== String(lineId)) {
        return;
      }

      const readOnly = pickerReadOnly || !!v.isReadOnly;
      $page.functions.initUnits(built.resources, built.allocated, allocLine, mode, confirmed, readOnly, bookingRows, allocLine.request_number);
      v.allocLine = allocLine;
      v.units = {
        loading: false,
        error: built.resources.length ? '' : 'No ' + (mode === 'lot' ? 'lots' : (mode === 'inventory' ? 'stock items' : 'serial numbers'))
          + ' are registered for ' + (eqpInfo.equipmentName || 'this equipment') + '.',
        mode: mode,
        confirmed: !!confirmed,
        readOnly: readOnly,
        readOnlyWhy: confirmed ? 'A Transfer Order is live for this line: its units can no longer change.'
          : (pickerReadOnly ? 'This customer line is being procured: view only.' : (v.isReadOnly ? 'Read only: allocating needs full Workbench access.' : '')),
        title: eqpInfo.equipmentName || line.equipment_name,
        lineNo: line.line_no,
        dates: $page.functions.dateRange(allocLine.start_date, allocLine.end_date)
      };
      v.stagingTick = (v.stagingTick || 0) + 1;
    }
  }

  return openUnitsChain;
});
