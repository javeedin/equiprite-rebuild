define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class initChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.requestId        request NUMBER (e.g. "EQR-00042"), from the URL
     * @param {number} params.requestNumericId numeric request id — required by the enriched endpoint
     */
    async run(context, params) {
      const { $page } = context;
      const requestId = params.requestId || $page.variables.requestId;
      const requestNumericId = params.requestNumericId || $page.variables.requestNumericId;

      // ── 1. Numeric id is required — no client-side resolution ────────────
      // views/request-detail-lines is keyed by the numeric requestId. The
      // my-requests view now returns eqrEquipmentRequestId, so navigation
      // carries it directly and it survives refresh via fromUrl. There is no
      // requestNumber→id fallback: resolving via a fetch-all-then-find over
      // getEquipriteV1EquipmentRequests was unreliable (page cap dropped the
      // newest requests) and is bad design. If the id is missing, stop.
      if (!requestNumericId) {
        console.error('[initChain] No requestNumericId provided; cannot load lines for', requestId);
        return;
      }
      $page.variables.requestNumericId = requestNumericId;
      $page.variables.isLoading = true;
      $page.variables.fetchError = '';
      // New EquipRite: the request header too (customer, contact, requestor id for Delete draft), alongside the lines
      // the old page read. A failed header call leaves those empty; the lines still load.
      const headerTask = Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestById',
        uriParams: { id: Number(requestNumericId) }
      }).catch(() => null);

      // ── 2. Single enriched fetch ────────────────────────────────────────
      // views/request-detail-lines (EQR_AVAILABILITY_PKG) returns one row per
      // line, fully enriched: equipment name/class, qty, dates, lineStatus,
      // billRate + priceUom, plus request-level header fields repeated on every
      // row. This REPLACES the former 5-call fan-out (workbench-lines +
      // getRatePeriodLines + getEquipmentClasses + EquipmentRequestById + lines2).
      // yardId is omitted → availability spans all orgs (not relevant to this
      // grid's columns, but harmless to leave server-side).
      const linesResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
        uriParams: { requestId: Number(requestNumericId), size: 10000 }
      });

      const headerRes = await headerTask;
      const header = (headerRes && headerRes.ok && headerRes.body) ? headerRes.body : {};
      $page.variables.isLoading = false;

      if (!linesResult.ok || !linesResult.body || !Array.isArray(linesResult.body.data)) {
        console.warn('[initChain] No lines returned for requestId:', requestNumericId);
        $page.variables.fetchError = 'This request could not be loaded (HTTP ' + linesResult.status + ').';
        return;
      }

      const rows = linesResult.body.data;
      if (rows.length === 0) {
        console.warn('[initChain] No lines for requestId:', requestNumericId);
        $page.variables.fetchError = 'This request has no lines.';
        return;
      }

      // ── 3. Header from row 0 (request-level fields repeat on every row) ──
      // deploymentLocation carries the typed free-text delivery address
      // (persisted to the request header), so no separate header GET is needed.
      const first = rows[0];
      $page.variables.formData = {
        requestNumber:     first.requestNumber  || requestId || '',
        project:           first.projectName    || '',
        task:              first.taskName       || '',
        requestor:         first.requestorName  || '',
        status:            first.requestStatus  || '',
        startDate:         first.requestedStartDate ? first.requestedStartDate.substring(0, 10) : '',
        endDate:           first.requestedEndDate   ? first.requestedEndDate.substring(0, 10)   : '',
        location:          first.deploymentLocation || '',
        customerName:      header.customerName || '',
        contactName:       header.contactName || '',
        contractNumber:    header.contractNumber || '',
        requestorUserId:   header.requestorUserId != null ? header.requestorUserId : null,
        isCustomer:        !!header.eqrCustomerRefId,
        hasDeployedLine:   false,
        hasShipToSiteLine: false
      };

      // ── 4. Build grid rows in the shape this page's data-grid expects ───
      const formatDate = (v) => {
        if (!v) return '';
        const s = String(v).substring(0, 10);
        const parts = s.split('-');
        if (parts.length !== 3) return s;
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (isNaN(m) || isNaN(d)) return s;
        return m + '/' + d + '/' + parts[0];
      };

      const formatRateWithUom = (amount, uom) => {
        if (amount === '' || amount == null) return '';
        const num = Number(amount) || 0;
        const formatted = new Intl.NumberFormat('en-US', {
          style: 'currency', currency: 'USD',
          minimumFractionDigits: 0, maximumFractionDigits: 2
        }).format(num);
        const unit = (uom || '').toString().trim();
        return unit ? (formatted + ' / ' + unit.toUpperCase()) : formatted;
      };

      // Map each enriched row straight off the request-detail-lines response.
      // Every field the grid binds comes off the row directly — equipmentName/
      // className/lineStatus/billRate/priceUom are all present (verified), so
      // there's no rate fan-out or lineNotes parsing to do.
      const mappedLines = rows.map((r, index) => {
        const rawRate = r.billRate !== undefined && r.billRate !== null ? r.billRate : '';
        // priceUom is the rate the line was actually priced at (agreement
        // PRICE_UOM for agreement-sourced requests, else rate-schedule RATE_UOM
        // at submit) — stored on the line and returned by this endpoint.
        const rateUom = (r.priceUom != null && String(r.priceUom).trim() !== '')
          ? String(r.priceUom).trim() : '';

        // Agreement provenance — the spec declares these on request-detail-lines
        // (isFromAgreement Y/N + agreementNumber/Name), but the live backend
        // doesn't return them yet (verified). Read defensively: the Agreement
        // grid column stays blank until the backend ships the fields, then
        // populates automatically with no further change here.
        const isFromAgreement = r.isFromAgreement === 'Y';
        const agreementNumber = r.agreementNumber || '';
        const agreementName   = r.agreementName   || '';

        return {
          lineId:                String(r.lineId !== undefined && r.lineId !== null ? r.lineId : index + 1),
          equipmentName:         r.equipmentName || '',
          equipmentClass:        r.className     || '',
          quantity:              r.quantity !== undefined && r.quantity !== null ? r.quantity : '',
          crew:                  '',
          utilizationPct:        r.targetUtilPercent !== undefined && r.targetUtilPercent !== null ? r.targetUtilPercent : '',
          lineStatus:            r.lineStatus || '',
          // Consumable identity + the V243 quantity counters. consumableFlag comes
          // off the SUBCLASS server-side - never infer it from className, which is a
          // taxonomy accident (a Traffic Safety Cone sits under Consumables while a
          // Hard Hat sits under Safety and PPE), nor from the master's own
          // IS_CONSUMABLE_FLAG, which has drifted on 12 of 92 masters.
          // These drive the DEPLOYED-vs-DELIVERED fork and the CONSUMED trigger.
          consumableFlag:        r.consumableFlag || 'N',
          // Per-subclass auto-consume (V312), resolved server-side off the SUBCLASS
          // like consumableFlag. acceptDeliveryChain gates the material-issue POST on
          // this per line; absent => 'N' => manual issue, which is the safe default.
          autoConsumeFlag:       r.autoConsumeFlag || 'N',
          deliveredQuantity:     r.deliveredQuantity != null ? Number(r.deliveredQuantity) : null,
          consumedQuantity:      r.consumedQuantity  != null ? Number(r.consumedQuantity)  : null,
          returnedQuantity:      r.returnedQuantity  != null ? Number(r.returnedQuantity)  : null,
          startDate:             formatDate(r.startDate),
          endDate:               formatDate(r.endDate),
          allocatedSerialNumber: r.allocatedSerial || '',
          billRate:              formatRateWithUom(rawRate, rateUom),
          isFromAgreement:       isFromAgreement,
          agreementNumber:       agreementNumber,
          agreementName:         agreementName,
          // Grid badge label — agreement number only, blank when not from an agreement
          agreementLabel:        isFromAgreement ? agreementNumber : ''
        };
      });

      // Per-line returnability, kept in sync with InitiateReturnChain's own filter
      // so the Initiate Return button and the chain never disagree — change one,
      // change the other.
      // DEPLOYED ONLY. DELIVERED was previously also returnable (to cover
      // consumables settling at DELIVERED), but returns are now restricted to
      // DEPLOYED lines.
      mappedLines.forEach(l => {
        l.isReturnable = l.lineStatus === 'DEPLOYED';
      });

      $page.variables.dataGridProvider = await $page.functions.initGridData(mappedLines);

      // Line picker for the Material Issue drawer. A material issue is recorded
      // against ONE request line (that is what sets consumed quantity), so the
      // drawer cannot be request-scoped. Built from the same mappedLines the grid
      // uses so the label matches exactly what the user sees in the table.
      // Write the ARRAY, never the provider. requestLinesADP.data is bound to
      // this variable via "{{ $page.variables.requestLinesArray }}" - the pattern
      // every other ArrayDataProvider2 in this app uses (141 of them).
      //
      // REJECTED/CANCELLED lines are excluded: submitTransactionChain PATCHes
      // consumedQuantity onto whichever line is picked here and flips it to
      // CONSUMED once fully consumed, which would silently overwrite a rejected
      // line's terminal status. Nothing should be issued against a line that was
      // turned down, so it must not be offerable in the first place.
      const ISSUABLE_EXCLUDED = ['REJECTED', 'CANCELLED'];
      $page.variables.requestLinesArray = mappedLines
        .filter(l => ISSUABLE_EXCLUDED.indexOf(String(l.lineStatus || '').toUpperCase()) === -1)
        .map(l => ({
          value: l.lineId,
          label: l.equipmentName + '  (qty ' + (l.quantity !== '' ? l.quantity : '-') + ')',
          lineStatus: l.lineStatus,
          quantity: l.quantity,
          // carried so the material-issue chain can decide DELIVERED -> CONSUMED
          // without re-fetching the line
          consumableFlag: l.consumableFlag,
          autoConsumeFlag: l.autoConsumeFlag,
          deliveredQuantity: l.deliveredQuantity,
          consumedQuantity: l.consumedQuantity
        }));

      // "On site" = DEPLOYED for a rental, DELIVERED or CONSUMED for a consumable.
      // NOTE: hasDeployedLine/hasShipToSiteLine are currently written here and read
      // nowhere in the app - kept in sync with the other rollups anyway so they are
      // not a trap for whoever wires them up.
      const ON_SITE = ['DEPLOYED', 'DELIVERED', 'CONSUMED'];
      $page.variables.formData = Object.assign({}, $page.variables.formData, {
        hasDeployedLine:   mappedLines.some(l => ON_SITE.indexOf(l.lineStatus) !== -1),
        hasShipToSiteLine: mappedLines.some(l => l.lineStatus === 'SHIP_TO_SITE')
      });
    }
  }

  return initChain;
});
