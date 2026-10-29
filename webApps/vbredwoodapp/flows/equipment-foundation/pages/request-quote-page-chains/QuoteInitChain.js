define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // PERIOD_TYPE (DAILY|WEEKLY|MONTHLY) → the noun a price reads with
  // (DAY|WEEK|MONTH), matching what SubmitRequestChain writes to PRICE_UOM and
  // what the catalog card renders. Unrecognised values pass through
  // upper-cased rather than being blanked.
  function periodNoun(periodType) {
    var t = (periodType || '').toString().trim().toUpperCase();
    if (!t) return null;
    var NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };
    return NOUNS[t] || t;
  }

  // Load the quote for the request: header from workbench-requests, lines from
  // the enriched request-detail-lines view (same source + math as the customer
  // quote page). Lines carry a _selected flag for the editable line checkboxes.
  class QuoteInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const requestId     = $page.variables.requestId;
      const requestNumber = $page.variables.requestNumber;

      if (!requestId) {
        console.warn('[request-quote QuoteInitChain] No requestId — cannot load quote.');
        $page.variables.isLoading = false;
        return;
      }

      // BU used app-wide for the single US1 Business Unit (see invOrgs/BU Settings).
      const BUSINESS_UNIT_ID = 300000046987012;

      const [headerResp, linesResp, settingsResp, prResp] = await Promise.all([
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
          uriParams: { eqrEquipmentRequestId: Number(requestId) }
        }),
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
          uriParams: { requestId: Number(requestId), size: 10000 }
        }),
        // BU margin — default for procurement lines (those with a purchase
        // requisition raised, identified via the PR mirror below); the manager can
        // override or zero it per line in edit mode.
        // pageSize/limit override: this endpoint defaults to pageSize=20 and
        // silently truncates (same reason loadEsSettingsChain passes them).
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getConfEquipmentSettings',
          uriParams: { businessUnitId: BUSINESS_UNIT_ID, pageSize: 10000, limit: 10000 }
        }),
        // PR mirror rows — which lines have a purchase requisition raised.
        // This is the IDENTIFIER for applying procurement markup; see the margin
        // seed below for why line status can't be used. One line can have >1 PR
        // row, so this is keyed by eqrRequestLineId into a Set.
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getPurchaseRequisitions',
          uriParams: { requestId: Number(requestId), size: 500 }
        })
      ]);

      let header = {};
      if (headerResp && headerResp.ok && headerResp.body &&
          Array.isArray(headerResp.body.data) && headerResp.body.data.length) {
        header = headerResp.body.data[0];
      }

      // Active BU margin percentage (e.g. 20 → 20%); default 0 if unavailable.
      // EQR_CONF_EQUIPMENT_SETTING is columnar — one row per BU with a typed
      // marginPercentage column (see the BU Settings tab's esColumnMap). Scope to
      // THIS BU before picking a row: the endpoint's businessUnitId filter is a
      // query param, so a spec/backend drift that ignores it would otherwise let
      // another BU's margin through. Prefer an active row, but fall back to any
      // row for this BU that actually carries a margin — a row can be flagged
      // inactive while still holding the only configured value.
      var buMargin = 0;
      var settingRows = (settingsResp && settingsResp.ok && settingsResp.body &&
                         Array.isArray(settingsResp.body.data)) ? settingsResp.body.data : [];
      var buRows = settingRows.filter(function (s) {
        return s && Number(s.businessUnitId) === BUSINESS_UNIT_ID;
      });
      var hasMargin = function (s) {
        return s && s.marginPercentage !== null && s.marginPercentage !== undefined &&
               s.marginPercentage !== '' && !isNaN(Number(s.marginPercentage));
      };
      var isActive = function (s) {
        return String(s.isActiveFlag || '').toUpperCase() === 'Y';
      };
      var chosen = buRows.filter(function (s) { return isActive(s) && hasMargin(s); })[0] ||
                   buRows.filter(hasMargin)[0] ||
                   buRows.filter(isActive)[0] ||
                   buRows[0];
      if (chosen) {
        buMargin = Number(chosen.marginPercentage) || 0;
      }
      if (!buRows.length) {
        console.warn('[request-quote QuoteInitChain] No conf-equipment-settings row for BU',
                     BUSINESS_UNIT_ID, '— markup defaults to 0.');
      }

      // Lines with a purchase requisition raised. A PR mirror row carries a
      // requisitionNumber, so its presence is the definitive "this line is being
      // externally procured" signal — independent of line status.
      // Best-effort: on a failed fetch the set is empty and markup falls back to
      // 0, which under-prices rather than over-prices the quote.
      var prLineIds = new Set();
      if (prResp && prResp.ok && prResp.body && Array.isArray(prResp.body.data)) {
        prResp.body.data.forEach(function (m) {
          if (m && m.eqrRequestLineId != null && m.requisitionNumber) {
            prLineIds.add(Number(m.eqrRequestLineId));
          }
        });
      } else {
        console.warn('[request-quote QuoteInitChain] PR mirror fetch not ok — ' +
                     'procurement markup will default to 0 for all lines.');
      }

      // ── List prices for lines submitted WITHOUT one ────────────────────
      // When ENABLE_QUOTES covers a request's origin, the cart shows "Rate on
      // request" and SubmitRequestChain deliberately posts NO price — BILL_RATE,
      // PRICE_UOM and ESTIMATED_COST are all null, because a figure the customer
      // never saw should not sit on the line looking agreed.
      //
      // This page is where the price is decided, so it needs a starting figure.
      // Re-resolve it from the catalog: the same endpoint, dates and rate-scoping
      // id the cart used, so the manager opens on the current list price rather
      // than $0 (which would also zero every netRate through the margin).
      //
      // One call for the whole request, keyed by equipmentMasterId. Only made
      // when at least one line is actually missing a rate, so an already-priced
      // request costs nothing extra.
      var catalogRateByMasterId = new Map();
      try {
        var rowsNeedingRate = (linesResp && linesResp.ok && linesResp.body &&
          Array.isArray(linesResp.body.data)) ? linesResp.body.data : [];
        var unpriced = rowsNeedingRate.filter(function (r) { return r.billRate == null; });
        if (unpriced.length) {
          var sample     = unpriced[0];
          var catStart   = sample.startDate ? String(sample.startDate).substring(0, 10) : null;
          var catEnd     = sample.endDate   ? String(sample.endDate).substring(0, 10)   : null;
          var catParams  = { size: 10000 };
          // Dates must be sent as a PAIR or the endpoint 400s; without them it
          // still prices, just with no availability — which is all we need here.
          if (catStart && catEnd) { catParams.startDate = catStart; catParams.endDate = catEnd; }
          // Same rate scoping the catalog used at add-to-cart time, so the
          // manager sees the price the customer would have been shown.
          if (sample.projectRefId != null)     catParams.projectRefId  = Number(sample.projectRefId);
          if (sample.eqrCustomerRefId != null) catParams.customerRefId = Number(sample.eqrCustomerRefId);

          var catResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsEquipmentCatalog',
            uriParams: catParams
          });
          if (catResp && catResp.ok && catResp.body && Array.isArray(catResp.body.data)) {
            catResp.body.data.forEach(function (c) {
              if (c.eqrEquipmentMasterId == null) return;
              // Mirrors catalogCart.js: a consumable is priced per unit, a
              // rentable per period, and the period amount is what BILL_RATE
              // carries — so seed the same figure submit would have posted.
              var amt, uom;
              if (c.isRentable === false) {
                amt = c.unitPrice != null ? Number(c.unitPrice) : null;
                uom = 'EACH';
              } else if (c.periodAmount != null) {
                amt = Number(c.periodAmount);
                uom = periodNoun(c.periodType);
              } else {
                amt = c.rate != null ? Number(c.rate) : null;
                uom = c.rateUom || null;
              }
              if (amt != null) {
                catalogRateByMasterId.set(Number(c.eqrEquipmentMasterId), { amount: amt, uom: uom });
              }
            });
          }
        }
      } catch (e) {
        console.warn('[request-quote QuoteInitChain] catalog list-price lookup failed — ' +
                     'unpriced lines will open at 0:', e);
      }

      let lines = [];
      if (linesResp && linesResp.ok && linesResp.body && Array.isArray(linesResp.body.data)) {
        lines = linesResp.body.data.map(function (r) {
          var startStr = r.startDate ? String(r.startDate).substring(0, 10) : '';
          var endStr   = r.endDate   ? String(r.endDate).substring(0, 10)   : '';
          var days = 0;
          if (startStr && endStr) {
            var s = new Date(startStr);
            var e = new Date(endStr);
            if (!isNaN(s) && !isNaN(e)) {
              days = Math.max(0, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
            }
          }
          var qty  = r.quantity != null ? r.quantity : 1;
          // Stored price wins; otherwise the catalog list price resolved above
          // (a quoted request posts no rate at submit). 0 only when neither is
          // available — the manager then types it.
          var catalogFallback = (r.billRate == null)
            ? catalogRateByMasterId.get(Number(r.equipmentMasterId))
            : null;
          var rate = r.billRate != null
            ? r.billRate
            : (catalogFallback ? catalogFallback.amount : 0);
          // Whatever uom the rate above is quoted in — 'DAY'/'DAILY' or absent
          // means per-day (including the legacy shape); anything else (WEEK,
          // MONTH, EACH) means the amount already covers its own period and
          // must NOT be multiplied by days. Mirrors the customer-portal
          // QuoteInitChain's uom guard — a $3,200/WEEK line over 5 days must
          // price as $3,200 (or its own stored estimatedCost), never $16,000.
          var priceUom = r.billRate != null
            ? String(r.priceUom || '').toUpperCase()
            : String((catalogFallback && catalogFallback.uom) || '').toUpperCase();
          var isPerDay = !priceUom || priceUom === 'DAY' || priceUom === 'DAILY';
          var lineStatus = String(r.lineStatus || '').toUpperCase();
          // Margin seeds from the BU default on PROCUREMENT lines only — the ones
          // with a purchase requisition raised. All other lines start at 0. The
          // manager can still override or zero any line in edit mode; this is
          // only the default.
          //
          // KEYED ON THE PR MIRROR, NOT LINE STATUS. It used to test
          // lineStatus === 'UNDER_PROCUREMENT', which broke once the
          // UNDER_PROCUREMENT flip was deferred to quote-accept: at quote-BUILD
          // time a PR-bearing line is still SUBMITTED / IN_PROCESS, so the test
          // never matched and the quote went out with NO markup — silently, since
          // an unmarked-up quote still renders and sends fine.
          // A PR mirror row exists from the moment the requisition is raised, so
          // it's true at quote time AND after accept — it doesn't depend on where
          // in the status lifecycle the line happens to be.
          var margin  = prLineIds.has(Number(r.lineId)) ? buMargin : 0;
          var netRate = rate * (1 + margin / 100);
          // Margin applies to the RATE, so the total must be built from netRate
          // the same uom-aware way rate itself is applied — never a flat
          // netRate * qty * days regardless of what netRate is quoted in.
          var lineTotal = isPerDay ? (netRate * qty * days) : (netRate * qty);
          return {
            lineId:           r.lineId != null ? r.lineId : null,
            _selected:        false,
            equipmentName:    r.equipmentName || '',
            equipmentClass:   r.className     || r.equipmentClass || '',
            quantity:         qty,
            startDate:        startStr,
            endDate:          endStr,
            billRate:         rate,
            // Baseline schedule/loaded rate + override toggle. Rate/Day is only
            // editable when _rateOverride is checked; unchecking restores this.
            // Seeded from the persisted RATE_OVERRIDDEN_FLAG so a reopened quote
            // restores the checkbox (and keeps its rate editable) as saved.
            originalBillRate: rate,
            _rateOverride:    String(r.rateOverriddenFlag || 'N').toUpperCase() === 'Y',
            marginPercentage: margin,
            netRate:          netRate,
            lineStatus:       lineStatus,
            rateTier:         r.rateTier || null,
            rateFrequency:    r.billFrequency || 'WEEKLY',
            // The unit the rate is quoted in (DAY | WEEK | MONTH | EACH),
            // resolved above from the line or the catalog fallback. Carried so
            // SendQuoteChain can record it as QUOTED_UOM on the quote line —
            // without it the quote would store an amount with no unit, and a
            // weekly rate would be indistinguishable from a daily one.
            priceUom:         priceUom || null,
            lineTotal:        lineTotal
          };
        });
      }

      var grandTotal = lines.reduce(function (sum, l) { return sum + (l.lineTotal || 0); }, 0);
      var fmtDate = function (iso) { return iso ? String(iso).substring(0, 10) : ''; };

      $page.variables.quoteData = {
        requestNumber:   header.requestNumber       || requestNumber || '',
        customerName:    header.projectOrCustomer   || header.customerName || header.projectName || '',
        customerContact: header.requestor           || header.contactName || '',
        status:          header.requestStatus       || '',
        startDate:       fmtDate(header.requestedStartDate),
        endDate:         fmtDate(header.requestedEndDate),
        location:        header.location            || '',
        marginPercentage: buMargin,
        grandTotal:      grandTotal,
        lines:           lines
      };

      $page.variables.editMode  = false;
      $page.variables.isLoading = false;
    }
  }

  return QuoteInitChain;
});
