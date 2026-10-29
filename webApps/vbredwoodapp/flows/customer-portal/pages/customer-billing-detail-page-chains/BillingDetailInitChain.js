define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Billing detail loader (accordion layout).
  // 1. Header banner from the customer-request-details view.
  // 2. Request lines from the enriched request-detail-lines view.
  // 3. ALL invoices for the request from customer-my-billing (materialized by
  //    EQR_BILLING_PKG), grouped per line and attached to each line so the
  //    accordion can expand instantly with no extra fetch.
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  class BillingDetailInitChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const requestId = params.requestId || $page.variables.requestId;
      var requestNumericId = params.requestNumericId || $page.variables.requestNumericId;

      if (!requestId) {
        console.error('[BillingDetailInitChain] No requestId found.');
        return;
      }

      // ── 1. Header ─────────────────────────────────────────────────────────
      const headerResult = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
        uriParams: { page: 0, size: 10000 }
      });

      var first = null;
      if (headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data)) {
        const matching = headerResult.body.data.filter(r => r.requestNumber === requestId);
        if (matching.length > 0) {
          first = matching[0];
          if (!requestNumericId && first.eqrEquipmentRequestId != null) {
            requestNumericId = first.eqrEquipmentRequestId;
          }
        }
      }
      if (requestNumericId) $page.variables.requestNumericId = Number(requestNumericId);

      $page.variables.formData = {
        requestNumber:   (first && first.requestNumber)   || requestId,
        customerName:    (first && first.customerName)     || '',
        customerContact: (first && first.customerContact)  || '',
        status:          (first && first.requestStatus)    || '',
        startDate:       (first && first.startDate)  ? first.startDate.substring(0, 10)  : '',
        endDate:         (first && first.endDate)    ? first.endDate.substring(0, 10)    : '',
        location:        (first && (first.deploymentLocation || first.location)) || '',
        contractNumber:  (first && first.contractNumber)   || ''
      };

      if (!requestNumericId) {
        console.error('[BillingDetailInitChain] No requestNumericId — cannot load lines.');
        $page.variables.lines = [];
        return;
      }

      // ── 2. Lines + 3. Invoices (in parallel) ──────────────────────────────
      const [linesResult, billingResult] = await Promise.all([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
          uriParams: { requestId: Number(requestNumericId), size: 10000 }
        }),
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerMyBilling',
          uriParams: { page: 0, size: 10000 }
        })
      ]);

      // Group invoices by request line id (only this request's rows).
      const today = _midnight(new Date());
      const invoicesByLine = {};
      if (billingResult.ok && billingResult.body && Array.isArray(billingResult.body.data)) {
        billingResult.body.data
          .filter(r => String(r.eqrEquipmentRequestId) === String(requestNumericId) && r.eqrRequestLineId != null)
          .forEach((r, i) => {
            const key = String(r.eqrRequestLineId);
            (invoicesByLine[key] = invoicesByLine[key] || []).push(_mapInvoice(r, key, i, today));
          });
        Object.keys(invoicesByLine).forEach(k => {
          invoicesByLine[k].sort((a, b) => a._sort - b._sort);
        });
      }

      // Map lines and attach their invoices + a small header summary.
      var lines = [];
      if (linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data)) {
        lines = linesResult.body.data.map(function (r, index) {
          const lineId = String(r.lineId != null ? r.lineId : (r.id != null ? r.id : index + 1));
          const invoices = invoicesByLine[lineId] || [];
          const totalValue = invoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
          return {
            lineId:         lineId,
            equipmentName:  r.equipmentName  || '',
            equipmentClass: r.className      || r.equipmentClass || '',
            serialNumber:   r.serialNumber   || '',
            quantity:       r.quantity       != null ? r.quantity : '',
            billRate:       r.billRate       != null ? r.billRate : '',
            billFrequency:  r.billFrequency  || '',
            lineStatus:     r.lineStatus     || '',
            invoices:       invoices,
            invoiceCount:   invoices.length,
            totalValue:     totalValue,
            totalValueText: _money(totalValue)
          };
        });
      }

      $page.variables.lines = lines;

      // ── 4. Banner summary chips (Total invoiced / Paid / Outstanding / Last invoice) ──
      var totalInvoiced = 0, paidAmount = 0, outstanding = 0, lastInvTime = 0, netAdjustment = 0;
      lines.forEach(function (ln) {
        ln.invoices.forEach(function (inv) {
          const amt = Number(inv.amount) || 0;
          if (inv.status === 'CANCELLED') return;   // cancelled invoices don't count toward totals
          // CREDIT/REPOST adjustment rows (V238 reversal) net naturally: CREDIT amount is
          // negative, REPOST positive. They still roll into the total (the total is the true
          // current bill) and are tracked separately for the "Net adjustments" chip.
          if (inv.isAdjustment) netAdjustment += amt;
          totalInvoiced += amt;
          if (inv.status === 'PAID') paidAmount += amt;
          else outstanding += amt;                   // OPEN / OVERDUE / SCHEDULED / CREDIT / REPOST
          if (inv._sort > lastInvTime) lastInvTime = inv._sort;
        });
      });
      $page.variables.totalInvoiced     = totalInvoiced;
      $page.variables.paidAmount        = paidAmount;
      $page.variables.outstandingAmount = outstanding;
      $page.variables.lastInvoiceLabel  = lastInvTime ? _fmt(new Date(lastInvTime)) : '—';
      $page.variables.netAdjustment     = Math.round(netAdjustment * 100) / 100;
      $page.variables.hasAdjustments    = netAdjustment !== 0;

      // ── 5. Flatten into expandable group/child rows (mirrors post-cost-test-detail).
      //   group row  = one request line (equipment) — chevron toggles its invoices.
      //   child row  = one invoice for that line.
      // rowsVisible = groups always shown; children only when their group is expanded.
      const rowsAll = [];
      lines.forEach(function (ln, gi) {
        const groupKey = 'g' + gi;
        rowsAll.push({
          rowKey:        groupKey,
          kind:          'group',
          groupKey:      groupKey,
          expanded:      gi === 0,                    // first line open by default
          label:         ln.equipmentName || '—',
          subLabel:      _lineSub(ln),
          lineStatus:    ln.lineStatus || '',
          invoiceCount:  ln.invoiceCount,
          totalValueText: ln.totalValueText,
          // blank cells for the child-aligned columns
          period: '', dueDate: '', amountText: '', when: '', status: ''
        });
        ln.invoices.forEach(function (inv, wi) {
          rowsAll.push({
            rowKey:        groupKey + '_i' + wi,
            kind:          'invoice',
            groupKey:      groupKey,
            label:         inv.invoiceNumber || '—',
            period:        inv.periodLabel,
            dueDate:       inv.dueDate,
            amountText:    inv.amountText,
            when:          inv.when,
            status:        inv.status,
            // V238 reversal display
            isAdjustment:  inv.isAdjustment,
            periodType:    inv.periodType
          });
        });
      });

      $page.variables.rowsAll = rowsAll;
      $page.variables.rowsVisible = rowsAll.filter(function (row) {
        if (row.kind === 'group') return true;
        const g = rowsAll.find(function (x) { return x.kind === 'group' && x.groupKey === row.groupKey; });
        return g && g.expanded;
      });
    }
  }

  // Build the group-row sub-line: class · S/N · Qty · rate.
  function _lineSub(ln) {
    const bits = [];
    if (ln.equipmentClass) bits.push(ln.equipmentClass);
    if (ln.serialNumber)   bits.push('S/N ' + ln.serialNumber);
    if (ln.quantity !== '' && ln.quantity != null) bits.push('Qty ' + ln.quantity);
    if (ln.billRate !== '' && ln.billRate != null) {
      bits.push('$' + ln.billRate + (ln.billFrequency ? ' / ' + ln.billFrequency : ''));
    }
    return bits.join('  ·  ');
  }

  // ── invoice mapping ────────────────────────────────────────────────────

  function _mapInvoice(r, lineKey, i, today) {
    const rawStatus = String(r.status || r.transactionStatus || '').toUpperCase();
    // V238: transactionType discriminates a plain invoice from a reversal adjustment.
    // EQP_C_MYBILLING suppresses REVERSED originals, so only INVOICE / CREDIT / REPOST reach us.
    const txnType = String(r.transactionType || 'INVOICE').toUpperCase();
    const isCredit = txnType === 'CREDIT';
    const isRepost = txnType === 'REPOST';
    const isAdjustment = isCredit || isRepost;
    const startD = _parseDate(r.billingPeriodStart);
    const endD   = _parseDate(r.billingPeriodEnd);
    const billD  = _parseDate(r.transactionDate);
    const dueD   = _parseDate(r.dueDate);
    const amount = (r.grossAmount != null ? r.grossAmount : (r.netAmount != null ? r.netAmount : 0));
    return {
      invId:         String(r.eqrBillingTransactionId != null ? r.eqrBillingTransactionId : (lineKey + '-' + i)),
      invoiceNumber: r.invoiceNumber || r.transactionNumber || '',
      periodLabel:   _periodLabel(startD, endD),
      billDate:      billD ? _fmt(billD) : '—',
      dueDate:       dueD ? _fmt(dueD) : '—',
      amount:        amount,                    // CREDIT rows already carry a negative amount from the view
      amountText:    _money(amount),
      status:        isAdjustment ? (isCredit ? 'CREDIT' : 'REPOST') : _displayStatus(rawStatus, dueD, today),
      when:          _whenBucket(startD, endD, today),
      // reversal metadata (V238) — drives the adjustment pill + "re-tiered to X" note
      txnType:       txnType,
      isAdjustment:  isAdjustment,
      periodType:    r.periodType || '',        // new tier label on a repost, e.g. WEEKLY
      adjustmentOf:  (r.adjustmentOf != null ? String(r.adjustmentOf) : ''),
      _sort:         startD ? startD.getTime() : (billD ? billD.getTime() : 0)
    };
  }

  // Map the raw transaction status to a display bucket the HTML chips render.
  // Schema (EQP_C_MYBILLING.status allowableValues, V237): SCHEDULED/POSTED/PAID/OVERDUE/VOID
  // — plus DRAFT/CANCELLED tolerated as legacy synonyms. OVERDUE is otherwise a *computed*
  // display state (a POSTED invoice past its DUE_DATE — see BILLING_ENGINE.md §8), so POSTED
  // deliberately falls through to the due-date test → OVERDUE-or-OPEN.
  function _displayStatus(rawStatus, dueD, today) {
    if (rawStatus === 'PAID') return 'PAID';
    if (rawStatus === 'VOID' || rawStatus === 'CANCELLED') return 'CANCELLED';
    if (rawStatus === 'SCHEDULED' || rawStatus === 'DRAFT') return 'SCHEDULED';
    if (rawStatus === 'OVERDUE') return 'OVERDUE';            // honour an explicit backend OVERDUE
    // POSTED (or any remaining status): compute overdue from the due date, else open.
    if (dueD && _midnight(dueD) < today) return 'OVERDUE';
    return 'OPEN';
  }

  function _whenBucket(startD, endD, today) {
    if (endD && _midnight(endD) < today) return 'past';
    if (startD && _midnight(startD) > today) return 'future';
    return 'current';
  }

  function _money(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function _parseDate(s) {
    if (!s) return null;
    const parts = String(s).substring(0, 10).split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m - 1, d);
  }

  function _midnight(dt) { return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()); }

  function _fmt(dt) {
    if (!dt || isNaN(dt.getTime())) return '—';
    return MONTHS[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear();
  }

  function _periodLabel(startD, endD) {
    if (!startD || isNaN(startD.getTime())) {
      return (endD && !isNaN(endD.getTime())) ? _fmt(endD) : '—';
    }
    const s = MONTHS[startD.getMonth()] + ' ' + startD.getDate();
    if (!endD || isNaN(endD.getTime())) return s;
    const e = MONTHS[endD.getMonth()] + ' ' + endD.getDate() + ', ' + endD.getFullYear();
    return s + ' → ' + e;
  }

  return BillingDetailInitChain;
});
