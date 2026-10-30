/**
 * Request-detail lines — single source of truth for building the page's
 * linesArray from the enriched `views/request-detail-lines` endpoint.
 *
 * This endpoint (backed by EQR_AVAILABILITY_PKG) replaces the old 8-call
 * fan-out + serial-ref N+1 + transfer-order two-hop that vbEnterChain used
 * to assemble. One call returns one row per line with availability already
 * computed per the line's own date window. Pass yardId to scope availability
 * to a specific inventory org (Yard LOV); omit it to span all orgs.
 *
 * Shared by:
 *   - request-detail/vbEnterChain.js        (initial load, no yard)
 *   - request-detail/RescopeYardChain.js    (yard select → re-scope)
 *   - request-detail/ActionChain.js         (post-action refresh)
 *
 * The mapped row shape matches what the data-grid binds. Both Transfer Order
 * legs arrive on the SAME row from this one call and need no assembly here:
 * toNumber (outbound) and inboundToNumber (return leg, populated by the view
 * off EQR_TRANSFER_ORDER where ORDER_TYPE='INBOUND', joined through
 * EQR_TO_LINE.REQUEST_LINE_ID). Verified live 2026-08-13 on requests
 * 1000001398 / 1378 / 1347 / 1346 — e.g. line 1000001857 returns
 * toNumber '195094' + inboundToNumber '196073'. Null on a line that isn't on
 * that leg yet, which maps to ''.
 *
 * A stale version of this note claimed the view did not expose
 * inboundToNumber. It does. Probe the endpoint before believing either it or
 * openapi3.json.
 */
define([], function () {
  'use strict';

  function formatDate(iso) {
    return iso ? String(iso).slice(0, 10) : '';
  }

  function formatRateWithUom(amount, uom) {
    if (amount === '' || amount == null) return '';
    var num = Number(amount) || 0;
    var formatted = new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 2, maximumFractionDigits: 2
    }).format(num);
    var unit = (uom || '').toString().trim();
    return unit ? (formatted + ' / ' + unit.toUpperCase()) : formatted;
  }

  function toBoolY(v) {
    return (typeof v === 'boolean') ? v : (v || '').toString().toUpperCase() === 'Y';
  }

  // ── S&T vs F&M fulfilment class ──────────────────────────────────────────
  // THE single owner of "which pathway does this line take". Consumers must
  // call classOfLine()/isFAndM() and never re-derive the test inline — this
  // question is about to be asked in the allocation gates, the confirm/TO
  // grouping and the picking queue, and a drifting copy of the rule fails
  // silently (exactly how `source === 'CUSTOMER'` broke when the origin
  // vocabulary changed).
  //
  //   S&T — Stockable and Transactable. A Fusion inventory item: allocate,
  //         create a Transfer Order, pick, ship. Today's flow.
  //   F&M — Fixed-asset and/or Maintenance tracked, NOT an inventory item.
  //         No INVENTORY_ITEM_REF_ID, so Fusion holds no on-hand and a
  //         Transfer Order would have no inventory transaction to make.
  //
  // THE DISCRIMINATOR IS isTransactable, NOT isInventoryTracked. They are
  // Y/Y or N/N in all current data, but they answer different questions —
  // "does it live in inventory" vs "may it move right now". Gating the TO on
  // transactability is literally what a TO is, and it leaves room for a
  // future inv=Y/txn=N (stocked but frozen: quarantine, surplus, hold)
  // without another schema change.
  //
  // SERIAL CONTROL IS ORTHOGONAL. An F&M item may be serial controlled — 30
  // masters with 60 EQR_SERIAL_REF units are seeded that way — so nothing here
  // may assume "F&M ⇒ no physical units".
  var CLASS_S_AND_T = 'S_AND_T';
  var CLASS_F_AND_M = 'F_AND_M';

  /**
   * Fulfilment class for one enriched line row.
   *
   * FAILS TO S&T while the field is absent. views/request-detail-lines does
   * NOT yet return isTransactable (verified live 2026-08-18: the row carries
   * isSerialControlled / isLotControlled / isInventoryTracked only), so until
   * the backend adds it every line resolves S&T — i.e. exactly today's
   * behaviour, no change in the UI. The moment the field appears, F&M lines
   * start classifying with no further frontend change.
   *
   * Undefined must NOT be read as 'not transactable': that would flip every
   * line to F&M the instant this shipped and silently stop Transfer Orders
   * being created for real inventory. Only an explicit 'N' means F&M.
   *
   * @param {Object} row raw endpoint row (camelCase), or a mapped line
   * @returns {string} 'S_AND_T' | 'F_AND_M'
   */
  function classOfLine(row) {
    if (!row) return CLASS_S_AND_T;
    // THE DATABASE OWNS THE RULE (2026-10-09). EQR_REQUEST_LINE.FULFILMENT_CLASS
    // is S_AND_T only when the master AND the BU org mapping of both the source
    // and destination orgs are transactable. When the endpoint returns it, it is
    // the answer — never re-derived here. The isTransactable test below is only
    // the fallback until the backend exposes fulfilmentClass.
    // Raw endpoint rows carry it as fulfilmentClass; mapped grid rows (what the
    // allocation gates, confirm and RETURN pass in) carry it as fulfilment_class.
    // Reading only the camelCase name sent every mapped F&M row down the
    // isTransactable fallback — an F&M return then went to /returns/plan as S&T
    // and was blocked NO_YARD (request 1000001807, line 1000003555).
    var server = String(row.fulfilmentClass || row.fulfilment_class || '').toUpperCase();
    if (server === CLASS_S_AND_T || server === CLASS_F_AND_M) return server;
    var raw =(row.isTransactable !== undefined && row.isTransactable !== null)
      ? row.isTransactable
      : row.is_transactable;
    if (raw === undefined || raw === null || raw === '') return CLASS_S_AND_T;
    return toBoolY(raw) ? CLASS_S_AND_T : CLASS_F_AND_M;
  }

  /** True when this line is fulfilled WITHOUT a Transfer Order. */
  function isFAndM(row) {
    return classOfLine(row) === CLASS_F_AND_M;
  }

  /**
   * Push each PO number out of a (possibly comma-delimited) string into `acc`,
   * trimmed and de-duped. Used to union the mirror's stored PO with whatever the
   * live Fusion read returns, so neither source can produce a duplicate.
   */
  function pushPoNumbers(acc, csv) {
    if (!csv) return;
    String(csv).split(',').forEach(function (p) {
      p = p.trim();
      if (p && acc.indexOf(p) === -1) acc.push(p);
    });
  }

  // ── Fusion requisition deep link ─────────────────────────────────────────
  //
  // Clicking a "Purchase Req No." opens that requisition in Fusion Self Service
  // Procurement. VERIFIED LIVE 2026-09-09 against req 204544
  // (requisitionHeaderId 300000341518987, raised from EquipRite REQ-1786556804645):
  // the Redwood details route needs ONLY requisitionHeaderId. The five other
  // params Fusion puts on the URL when you navigate in-app (documentStatusCode,
  // hasPendingApprovalLines, isPreparerOrModifyingApproverForReq, navigateBackTo,
  // tabSelected) are display state the page derives for itself — dropped on
  // purpose. documentStatusCode especially: an EquipRite-raised requisition is
  // created INCOMPLETE/Draft (the POST carries no submit action) and moves to
  // PENDING_APPROVAL then APPROVED later, so any value we baked in would go
  // stale. Also verified to survive a cold Incognito load — Fusion bounces
  // through SSO and still lands on the requisition.
  //
  // This is an internal Redwood route, not a published contract: Oracle can
  // restructure it in a quarterly update, and the failure is silent (a blank or
  // generic page, nothing throws here). It is deliberately the ONLY place the
  // URL is spelled out, so that change is a one-line fix.
  var REQ_DETAILS_PATH =
    '/fscmUI/redwood/procurement/requisitions/tabbar/shopping/requisitiondetails';

  // Same story for Transfer Orders, with one useful difference: this route
  // keys off the transfer order NUMBER, not an internal header id. Every other
  // Redwood deep link (PO, sales order, work order) takes an id - transfer
  // orders are the exception. That matters here because EQR_TRANSFER_ORDER
  // stores ORDER_NUMBER and no Fusion header id at all, so the link is
  // buildable from what we already hold, with no extra REST hop.
  // Documented in Oracle SCM 26B readiness, "Enable Deep Links to Source Data
  // from Supplies and Demands Page". 'landing' is literal, not a placeholder.
  var TO_DETAILS_PATH =
    '/fscmUI/redwood/inventory-transfer-orders/view-transfer-order/landing';

  // Pod origin, learned at runtime rather than hardcoded. Fusion stamps absolute
  // self-hrefs into every REST payload, so the requisition read below tells us
  // its own host and the link follows the pod across environments with no config
  // change. Cached module-scope: one successful read serves every later link.
  var fusionOrigin = null;

  function rememberFusionOrigin(payload) {
    if (fusionOrigin || !payload) return;
    var links = payload.links || (payload.items && payload.items[0] && payload.items[0].links);
    if (!Array.isArray(links)) return;
    for (var i = 0; i < links.length; i++) {
      var href = links[i] && links[i].href;
      if (!href) continue;
      try {
        var origin = new URL(href).origin;
        if (origin) { fusionOrigin = origin; return; }
      } catch (e) { /* not an absolute URL — try the next link */ }
    }
  }

  /**
   * Absolute URL for a requisition in Fusion, or '' when we cannot build one
   * (no header id, or no Fusion read has succeeded yet this session so the pod
   * origin is still unknown). '' makes the cell render as plain text — the
   * number stays visible, it just isn't clickable.
   */
  function fusionRequisitionUrl(headerId) {
    if (headerId == null || !fusionOrigin) return '';
    return fusionOrigin + REQ_DETAILS_PATH +
      '?requisitionHeaderId=' + encodeURIComponent(String(headerId));
  }

  /**
   * Absolute URL for a transfer order in Fusion, or '' when the pod origin is
   * not known yet this session. Same fallback rule as the requisition link:
   * '' renders the number as plain text rather than hiding it.
   */
  function fusionTransferOrderUrl(orderNumber) {
    var n = (orderNumber == null) ? '' : String(orderNumber).trim();
    if (!n || !fusionOrigin) return '';
    return fusionOrigin + TO_DETAILS_PATH +
      '?transferOrderNumber=' + encodeURIComponent(n);
  }

  /**
   * A comma-or-space separated TO field -> [{ number, url }], one entry per
   * distinct order number. The columns can legitimately carry more than one
   * number (a line split across routes gets one TO per route), which is why
   * this mirrors pr_links rather than producing a single string.
   */
  function buildToLinks(raw) {
    var out = [];
    var seen = {};
    String(raw == null ? '' : raw).split(/[,;\s]+/).forEach(function (tok) {
      var n = tok.trim();
      if (!n || seen[n]) return;
      seen[n] = true;
      out.push({ number: n, url: fusionTransferOrderUrl(n) });
    });
    return out;
  }

  /**
   * Map one raw endpoint row → one grid row. idx is the zero-based position
   * (drives line_no). Mirrors the shape vbEnterChain produced previously.
   */
  function mapRow(r, idx) {
    var totalQty     = r.quantity || 1;
    var allocatedQty = Number(r.allocatedQty || 0);

    // Derive alloc_status by QTY (not row count): a lot/inventory line fills
    // its qty with a single allocation carrying allocatedQty=N.
    var allocStatus = 'PENDING';
    if (allocatedQty === 0)            allocStatus = 'PENDING';
    else if (allocatedQty >= totalQty) allocStatus = 'ALLOCATED';
    else                               allocStatus = 'PARTIAL';

    // The view can report allocatedQty > quantity (e.g. extra serials picked
    // for a 1-qty line). The "X of Y" label must never show X>Y, so clamp the
    // numerator to the requested qty for DISPLAY only — status above already
    // treats >= qty as fully ALLOCATED.
    var shownAllocated = Math.min(allocatedQty, totalQty);

    return {
      line_id:              r.lineId,
      line_no:              idx + 1,
      equipment_master_id:  r.equipmentMasterId,
      equipment_name:       r.equipmentName       || '',
      class:                r.className            || '',
      qty:                  r.quantity            || 0,
      line_start_date:      formatDate(r.startDate),
      line_end_date:        formatDate(r.endDate),
      // Raw values retained for the per-line edit dialog (rate/dates) — the
      // display fields above are formatted strings that can't round-trip to
      // patchRequestLine. ISO date = YYYY-MM-DD (oj-input-date value shape).
      line_start_date_raw:  r.startDate ? String(r.startDate).substring(0, 10) : '',
      line_end_date_raw:    r.endDate   ? String(r.endDate).substring(0, 10)   : '',
      bill_rate_raw:        r.billRate != null ? Number(r.billRate) : 0,
      price_uom:            r.priceUom || '',
      // Availability is computed server-side (EQR_AVAILABILITY_PKG). Tokens:
      // AVAILABLE | PARTIAL DURATION | PARTIAL QUANTITY | NOT AVAILABLE.
      availability:         r.availabilityStatus  || '',
      alloc_status:         allocStatus,
      line_status:          r.lineStatus          || '',
      allocated_serial:     shownAllocated + ' of ' + totalQty + ' allocated',
      bill_rate:            formatRateWithUom(r.billRate, r.priceUom),
      est_cost:             r.estimatedCost       || 0,
      util_pct:             r.targetUtilPercent   || 0,
      // Both TO legs come straight off this row — no client-side assembly, no
      // extra call. See the module-level comment.
      to_number:            r.toNumber            || '',
      inbound_to_number:    r.inboundToNumber      || '',
      // Deep links for the two Transfer Order columns, same shape as pr_links:
      // [{ number, url }] per distinct order number. Built here so the grid
      // cell stays a dumb renderer.
      to_links:             buildToLinks(r.toNumber),
      inbound_to_links:     buildToLinks(r.inboundToNumber),
      is_serial_controlled: toBoolY(r.isSerialControlled),
      is_lot_controlled:    toBoolY(r.isLotControlled),
      is_inventory_tracked: toBoolY(r.isInventoryTracked),
      // ── Fulfilment class (S&T / F&M) ──
      // is_transactable is the discriminator; the other two are carried for
      // DISPLAY only (badge / detail panel) and must not be used to decide the
      // pathway — an S&T item can also be FA-tracked (8 such masters exist),
      // and treating fa='Y' as F&M would wrongly strip its Transfer Order.
      //
      // Kept as the raw 'Y'/'N'/undefined rather than a boolean, so
      // classOfLine() can still tell "absent" from "explicitly N" — see its
      // fail-to-S&T note. undefined until the endpoint returns the field.
      is_transactable:        r.isTransactable,
      is_fixed_asset_tracked: toBoolY(r.isFixedAssetTracked),
      is_maintenance_tracked: toBoolY(r.isMaintenanceTracked),
      // 'S_AND_T' | 'F_AND_M'. Precomputed once here so the grid bindings and
      // the allocation gates read a field instead of each re-deriving the rule.
      fulfilment_class:       classOfLine(r),
      // Fusion Project/Task IDs (request-level, fanned out per line by the
      // endpoint). Carried through so the "Request Purchase Order" flow can
      // attach a PPM project distribution (projectDFF _PROJECT_ID/_TASK_ID)
      // to each PR line. Nullable when the request has no project/task.
      project_ref_id:       r.projectRefId != null ? Number(r.projectRefId) : null,
      task_id:              r.taskId       != null ? Number(r.taskId)       : null,
      // Purchase Requisition / Purchase Order numbers for third-party rental
      // lines. Empty on the base view; populated by enrichWithPr() from the
      // EQR_PURCHASE_REQUISITION mirror (REQUISITION_NUMBER + the OIC-stamped
      // PO_NUMBER) unioned with a live Fusion read-back, on page load and on
      // every Refresh.
      pr_number:            '',
      po_number:            '',
      // Deep-link payload for the "Purchase Req No." cell: one entry per
      // requisition on this line, [{ number, headerId, url }]. pr_number is a
      // display string (comma-joined, and a line can carry several
      // requisitions), so it cannot carry the id each link needs — the grid
      // cell renders from THIS array instead, falling back to the entry's bare
      // number as plain text whenever its url is ''.
      pr_links:             [],
    };
  }

  /**
   * Enrich the built lines with Purchase Requisition / Purchase Order numbers.
   *
   * Runs on page load AND on every Refresh (V2 §5.1 — no scheduler). GET-only,
   * no caching:
   *   1. GET the EQR_PURCHASE_REQUISITION mirror rows for the request. This is
   *      what gives us each line's requisition number, its requisition header
   *      id, and the PO_NUMBER the OIC PO→mirror trigger already stamped.
   *   2. Ask Fusion live whether each requisition has been converted
   *      (PurchaseOrder on the requisition line) + read the PO line price.
   *      Fusion can be ahead of the trigger, so this is unioned with step 1
   *      rather than replacing it — and a mirror PO still renders when this
   *      call fails.
   *   3. Stamp pr_number / po_number (comma-delimited) onto the matching lines.
   *
   * The PO is resolved fresh every load — we intentionally do NOT persist it
   * back to the mirror. Post-cost does the same live lookup when it runs (it
   * always has the header id), so caching would only add a fragile write path.
   *
   * Entirely best-effort: any failure leaves the lines as-is (PR/PO blank).
   * Mutates and returns the same `lines` array.
   */
  /**
   * Teach the module the Fusion pod origin, then rebuild any TO links that
   * were built before it was known.
   *
   * Cheap and best-effort: one tiny LOV read whose only purpose is the
   * absolute self-href Fusion stamps into it. Costs nothing when the origin is
   * already cached, or when this request has no transfer order to link to.
   */
  async function ensureFusionOrigin(context, Actions, lines) {
    if (fusionOrigin) return;
    var needsIt = (lines || []).some(function (l) {
      return (l.to_number && String(l.to_number).trim())
          || (l.inbound_to_number && String(l.inbound_to_number).trim());
    });
    if (!needsIt) return;
    try {
      var resp = await Actions.callRest(context, {
        endpoint:  'ProjectLOV/getFscmRestApiResources11_13_18_05UnitsOfMeasure',
        uriParams: { limit: 1, fields: 'UOMCode' }
      });
      if (resp && resp.ok) rememberFusionOrigin(resp.body);
    } catch (e) {
      console.warn('[requestDetailLines] could not learn the Fusion origin — '
                 + 'transfer order numbers will render as plain text:', e);
      return;
    }
    if (!fusionOrigin) return;
    // Rebuild: mapRow ran before the origin was known, so every url is ''.
    (lines || []).forEach(function (l) {
      l.to_links         = buildToLinks(l.to_number);
      l.inbound_to_links = buildToLinks(l.inbound_to_number);
    });
  }

  async function enrichWithPr(context, Actions, requestId, lines) {
    if (!lines || !lines.length) return lines;

    var mirrorRows;
    try {
      var prResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getPurchaseRequisitions',
        uriParams: { requestId: Number(requestId), size: 500 }
      });
      if (!prResp || !prResp.ok) return lines;
      mirrorRows = (prResp.body && Array.isArray(prResp.body.data)) ? prResp.body.data : [];
    } catch (e) {
      console.warn('[requestDetailLines] PR mirror fetch failed:', e);
      return lines;
    }
    if (!mirrorRows.length) return lines;

    // Group mirror rows by request line (a line can have >1 requisition).
    var byLine = {};
    mirrorRows.forEach(function (m) {
      var k = String(m.eqrRequestLineId);
      (byLine[k] = byLine[k] || []).push(m);
    });

    // GET-only: ask Fusion whether each requisition has converted yet (no
    // caching / PATCH-back). One requisition header id -> its current PO(s),
    // held in a local map keyed by header id so the merge below can read it.
    //
    // This runs IN ADDITION to the PO_NUMBER already on the mirror row, and
    // exists purely to cover the case where the OIC PO→mirror trigger did not
    // fire: Fusion is the system of record for conversion, so it can be ahead
    // of our copy. When the trigger has done its job this call confirms what
    // the mirror already told us.
    var poByHeaderId = {}; // headerId -> { poNumber }

    await Promise.all(mirrorRows.map(async function (m) {
      if (m.requisitionHeaderId == null) return;
      var key = String(m.requisitionHeaderId);
      if (poByHeaderId[key]) return; // already resolved this requisition
      try {
        // Query-param form (matches the working ProjectLOV ops). A /{id} path
        // op did NOT resolve through the VBCS Fusion proxy; q= does.
        var reqResp = await Actions.callRest(context, {
          endpoint:  'ProjectLOV/getFscmRestApiResources11_13_18_05PurchaseRequisitions',
          uriParams: { q: 'RequisitionHeaderId=' + m.requisitionHeaderId, expand: 'lines', limit: 1 }
        });
        if (!reqResp || !reqResp.ok) return;
        // Learn the pod origin off Fusion's own absolute self-href before any
        // early return below — the deep link needs it even for a requisition
        // that has no PO yet (which is most of them).
        rememberFusionOrigin(reqResp.body);
        var reqItems = (reqResp.body && reqResp.body.items) || [];
        var reqDoc = reqItems[0] || {};
        // With expand=lines, Fusion returns `lines` as a PLAIN ARRAY (not
        // {items:[...]}). Handle both shapes defensively.
        var reqLines = Array.isArray(reqDoc.lines)
          ? reqDoc.lines
          : ((reqDoc.lines && reqDoc.lines.items) || []);
        var poNums = [];
        reqLines.forEach(function (rl) {
          if (rl.PurchaseOrder && poNums.indexOf(rl.PurchaseOrder) === -1) poNums.push(rl.PurchaseOrder);
        });
        if (!poNums.length) return; // buyer hasn't converted yet — leave blank

        // NOTE: a second Fusion call used to follow here, reading the PO line's
        // Price/CurrencyCode off purchaseOrders/{POHeaderId}/child/lines. It was
        // removed because nothing ever read the result — it cost one Fusion
        // round-trip per PO on every page load and every Refresh and produced
        // no visible effect. This page shows PO NUMBERS only; the price that
        // drives the post-cost markup is EQR_PURCHASE_REQUISITION.PO_UNIT_PRICE,
        // written by the OIC trigger and read in SQL by the post-cost views —
        // it never came from here. If a write-back is ever built, the ids it
        // needs are rl.POHeaderId / rl.POLineId on the requisition line above.
        poByHeaderId[key] = { poNumber: poNums.join(', ') };
      } catch (e) {
        console.warn('[requestDetailLines] Fusion requisition read failed for', m.requisitionHeaderId, e);
      }
    }));

    // Merge PR/PO numbers onto the line rows (comma-delimit across a line's PRs).
    // Also collect any UNDER_PROCUREMENT line that JUST resolved a PO — once the
    // buyer converts the requisition into a purchase order, the third-party rental
    // is effectively procured, so the line advances UNDER_PROCUREMENT -> DEPLOYED
    // (matching V2 §5.2 "flip on PO receipt", instead of at PR-raise time). PR
    // lines never go through the yard allocate/TO/pick path, so DEPLOYED here just
    // makes the line post-costable and takes it out of the requisition-pending set.
    var toDeploy = [];
    lines.forEach(function (l) {
      var ms = byLine[String(l.line_id)];
      if (!ms || !ms.length) return;
      var prs = [], pos = [], prLinks = [];
      ms.forEach(function (m) {
        if (m.requisitionNumber && prs.indexOf(m.requisitionNumber) === -1) {
          prs.push(m.requisitionNumber);
          // Same de-dup as prs, so the links and the display string always
          // describe the same set in the same order.
          prLinks.push({
            number:   m.requisitionNumber,
            headerId: m.requisitionHeaderId != null ? m.requisitionHeaderId : null,
            url:      fusionRequisitionUrl(m.requisitionHeaderId)
          });
        }
        // TWO sources, unioned — the PR number has always come straight off the
        // mirror row, and the PO now does too:
        //
        // 1. EQR_PURCHASE_REQUISITION.PO_NUMBER, stamped by the OIC PO→mirror
        //    trigger and returned by this very same GET. Reading it makes the PO
        //    behave like the Transfer Order columns (a plain DB read that lands
        //    on page load and on every Refresh) instead of depending entirely on
        //    the Fusion hop below — a PO already in the DB used to render blank
        //    forever if that hop was unavailable or returned no PurchaseOrder.
        pushPoNumbers(pos, m.poNumber);
        // 2. The live Fusion requisition read — can be AHEAD of the trigger, so
        //    it may surface a PO the mirror has not caught up on yet. Unioned,
        //    not preferred: whichever source has it, we show it.
        var resolved = poByHeaderId[String(m.requisitionHeaderId)];
        if (resolved) pushPoNumbers(pos, resolved.poNumber);
      });
      l.pr_number = prs.join(', ');
      l.po_number = pos.join(', ');
      l.pr_links  = prLinks;

      // Auto-flip only a currently-UNDER_PROCUREMENT line that now has a PO.
      // Gating on the status keeps this idempotent: after the flip the line is
      // DEPLOYED, so it won't match on the next load. Any other status is left
      // untouched.
      if (pos.length && String(l.line_status || '').toUpperCase() === 'UNDER_PROCUREMENT') {
        toDeploy.push(l);
      }
    });

    // Best-effort DB flip to DEPLOYED for each line that just received a PO. A
    // failed PATCH leaves the line UNDER_PROCUREMENT (it retries next load) and
    // must never break the enrichment / page render — hence the per-line catch
    // and the in-memory line_status update ONLY on a successful PATCH so the grid
    // never shows DEPLOYED while the DB still says UNDER_PROCUREMENT.
    if (toDeploy.length) {
      await Promise.all(toDeploy.map(async function (l) {
        try {
          var patchResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchRequestLine',
            uriParams: { requestId: Number(requestId), id: Number(l.line_id) },
            body:      { lineStatus: 'DEPLOYED' }
          });
          if (patchResp && patchResp.ok) {
            l.line_status = 'DEPLOYED';
          } else {
            console.warn('[requestDetailLines] PO-detected DEPLOYED flip returned non-ok for line', l.line_id, patchResp && patchResp.status);
          }
        } catch (e) {
          console.warn('[requestDetailLines] PO-detected DEPLOYED flip failed for line', l.line_id, e);
        }
      }));
    }

    return lines;
  }

  /**
   * Fetch the enriched lines for a request and build the grid rows.
   * Returns { ok, lines } — ok=false on a failed/missing response so callers
   * can choose to leave existing state intact.
   *
   * @param context  the action-chain context (passed straight to callRest)
   * @param Actions  the vb/action/actions module
   * @param requestId  numeric or string request id
   * @param yardId     optional inventory-org id to scope availability; falsy → omitted
   */
  async function fetchAndBuild(context, Actions, requestId, yardId) {
    var uriParams = { requestId: Number(requestId), size: 10000 };
    // Only send yardId when a real value is selected; omitting it spans all
    // orgs (SQL NULL), which is NOT the same as yardId=0.
    if (yardId != null && yardId !== '' && Number(yardId) > 0) {
      uriParams.yardId = Number(yardId);
    }

    var resp = await Actions.callRest(context, {
      endpoint:  'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
      uriParams: uriParams
    });

    if (!resp || !resp.ok) {
      return { ok: false, lines: [] };
    }

    var rows  = (resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
    var lines = rows.map(mapRow);

    // Enrich with PR/PO numbers (best-effort; never fails the load).
    // Runs in PARALLEL with the failed-TO sweep — they touch different endpoints
    // and neither depends on the other, so the page pays one round-trip, not two.
    var enrichments = await Promise.allSettled([
      enrichWithPr(context, Actions, requestId, lines),
      enrichWithFailedTOs(context, Actions, requestId, lines),
      // Learn the pod origin so the Transfer Order deep links resolve. This
      // used to ride on the requisition read inside enrichWithPr, which meant
      // a request with TOs but NO purchase requisition never learned it and
      // both TO columns rendered as plain text permanently. The TO link must
      // not depend on an unrelated document existing, so it gets its own
      // best-effort read - skipped entirely once the origin is known, and
      // skipped when no line on this request carries a TO at all.
      ensureFusionOrigin(context, Actions, lines)
    ]);
    if (enrichments[0].status === 'rejected') {
      console.warn('[requestDetailLines] enrichWithPr failed — continuing without PR/PO:',
                   enrichments[0].reason);
    }
    if (enrichments[1].status === 'rejected') {
      console.warn('[requestDetailLines] failed-TO sweep failed — continuing without it:',
                   enrichments[1].reason);
    }

    return { ok: true, lines: lines };
  }

  /**
   * Mark lines whose Transfer Order failed or stalled in Fusion.
   *
   * WHY THIS EXISTS: createSupplyRequest returns 202 Accepted, not success.
   * Fusion decides 1-3 minutes later (our OIC poller runs every 2 min) and the
   * line's status was already promoted on the 202. A line whose TO failed
   * therefore sits at ALLOCATED or RETURN_IN_PROCESS looking completely healthy,
   * and the only way anyone found out was by querying the database. 28 lines were
   * stranded this way before anyone noticed.
   *
   * This is the client half of Oracle's own "Manage Supply Request Exceptions"
   * pattern: surface the failure, show the reason, let the user resubmit AFTER
   * fixing the cause. Oracle is explicit that the request itself is not editable
   * from the exception view — you fix the source data and resubmit — which is
   * why this only marks lines and never mutates them.
   *
   * Two codes, and they are NOT interchangeable:
   *   TO_FAILED  - every TO for that line+leg failed. Retryable once the cause is
   *                fixed.
   *   TO_STALLED - a TO is still sitting in SR_CREATED, which is the OIC poller's
   *                work queue. The poller re-reads it every 2 minutes and still
   *                owns the row, so a retry would RACE it. Investigate only.
   *
   * Best-effort by design: a failure here must never block the page. A line that
   * silently keeps its normal badge is the behaviour we had before this existed.
   */
  async function enrichWithFailedTOs(context, Actions, requestId, lines) {
    var resp = await Actions.callRest(context, {
      endpoint:  'eqp-v1/failedLines',
      uriParams: { requestId: Number(requestId) },
      body:      {}          // omitted lineIds => sweep every line on the request
    });
    if (!resp || !resp.ok) {
      console.warn('[requestDetailLines] failedLines not ok (HTTP ' +
                   (resp && resp.status) + ') — no failure badges this load');
      return;
    }

    var body   = resp.body || {};
    var byLine = new Map();
    (body.lines || []).forEach(function (f) {
      if (f && f.requestLineId != null) byLine.set(Number(f.requestLineId), f);
    });
    // Lines still sitting at RETURN_IN_PROCESS, which must be reset to DEPLOYED
    // before the return can be re-attempted. SERVER-TOLD, never inferred: a line
    // whose return was already reset still appears in `lines` (its TO did fail),
    // but no longer needs the reset. Deriving this from line_status here would
    // re-flag it and fire a pointless /returns/reset that answers 0.
    var needsReset = new Set((body.needsReturnResetLineIds || []).map(Number));
    if (!byLine.size) return;

    lines.forEach(function (l) {
      var f = byLine.get(Number(l.line_id));
      if (!f) return;
      l.to_failure_code   = f.reasonCode || null;
      l.to_failure_detail = f.reasonDetail || '';
      // Retryable only for TO_FAILED. TO_STALLED is still owned by the poller.
      l.to_retryable      = (f.reasonCode === 'TO_FAILED');
      l.to_needs_reset    = needsReset.has(Number(l.line_id));
    });

    console.log('[requestDetailLines] failed-TO sweep:', body.failedCount || 0,
                'failed,', body.stalledCount || 0, 'stalled,',
                (body.needsReturnResetLineIds || []).length, 'needing return reset');
  }

  /**
   * Apply a freshly-built lines array to $page.variables and recompute the
   * derived header/progress variables + PO-button gate. Shared so initial
   * load, yard re-scope and refresh stay in lock-step.
   */
  function applyLines($page, lines) {
    $page.variables.linesArray = lines.slice();

    if ($page.functions && typeof $page.functions.updatePoButtonEnabled === 'function') {
      $page.functions.updatePoButtonEnabled($page);
    }
    // Re-derive the Confirm / Reject enable flags against the fresh lines.
    // The selection (held on the page module) survives a refresh, so a line
    // that just gained a to_number drops out of the confirmable set here.
    if ($page.functions && typeof $page.functions.updateActionButtons === 'function') {
      $page.functions.updateActionButtons($page);
    }

    var totalLines     = lines.length;
    var allocatedLines = lines.filter(function (l) { return l.alloc_status === 'ALLOCATED'; }).length;
    $page.variables.allocationProgress = allocatedLines + '/' + totalLines + ' lines allocated';
    $page.variables.allocationPct      = totalLines > 0 ? Math.round((allocatedLines / totalLines) * 100) : 0;
    if ($page.functions && typeof $page.functions.computeTotalCost === 'function') {
      $page.variables.totalEstCost = $page.functions.computeTotalCost(lines);
    }
  }

  return {
    mapRow: mapRow,
    fetchAndBuild: fetchAndBuild,
    enrichWithPr: enrichWithPr,
    // Exported so any other surface that gains a requisition number links to
    // the same place without re-spelling the Redwood route.
    fusionRequisitionUrl: fusionRequisitionUrl,
    // Public so ANY Fusion read can teach the module the pod origin. The
    // requisition read used to be the only teacher, which meant a request with
    // Transfer Orders but NO purchase requisition never learned it - and both
    // TO columns rendered as plain text forever. Deep links must not depend on
    // an unrelated document existing.
    rememberFusionOrigin: rememberFusionOrigin,
    hasFusionOrigin: function () { return !!fusionOrigin; },
    // Same reasoning for transfer orders - one spelling of the Redwood route.
    fusionTransferOrderUrl: fusionTransferOrderUrl,
    buildToLinks: buildToLinks,
    applyLines: applyLines,
    // Fulfilment-class API — the ONLY sanctioned way to ask S&T vs F&M.
    // Exported for the allocation gates (request-detail-page.js,
    // rowClickChain.js), the confirm/TO grouping (ActionChain.js) and the
    // picking queue, so all of them share one implementation of the rule.
    classOfLine: classOfLine,
    isFAndM: isFAndM,
    CLASS_S_AND_T: CLASS_S_AND_T,
    CLASS_F_AND_M: CLASS_F_AND_M
  };
});
