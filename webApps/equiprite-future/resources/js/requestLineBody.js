define([], function () {
  'use strict';

  // ONE builder for the createRequestLine body, shared by the cart's Submit
  // (SubmitRequestChain) and Save as Draft (SecondaryActionChain), so a draft
  // line stores exactly what a submitted line stores. Only lineStatus differs:
  //
  //   Save as Draft            → DRAFT       (INTERNAL and EXTERNAL)
  //   Submit, INTERNAL project → SUBMITTED   (an approver still has to confirm)
  //   Submit, EXTERNAL customer→ IN_PROCESS  (no customer-side approver)
  //
  // lineStatus is set ON CREATE. Submit used to create lines with no status and
  // then PATCH every line to the header's status, one call per line; the create
  // DTO has always accepted lineStatus and EQR_REQUEST_LINE has no default or
  // insert trigger on it, so the follow-up PATCHes were pure round trips.
  //
  // createLines() sends the whole cart as these bodies in ONE call to
  // POST /equipment-requests/{id}/lines/batch, live since 2026-10-11
  // (docs/REQUEST_LINES_BATCH_CREATE_BACKEND_ASK_2026-10-11.md).

  function toISODate(val) {
    if (!val) return null;
    return val.includes('T') ? val : val + 'T00:00:00Z';
  }

  // Inclusive rental days between two dates — the same count the cart's
  // Subtotal column uses, so a stored estimatedCost matches what the user was
  // shown. 0 when either date is missing, read by the caller as "no total yet"
  // rather than $0.
  function rentalDays(startStr, endStr) {
    if (!startStr || !endStr) return 0;
    var s = new Date(startStr);
    var e = new Date(endStr);
    if (isNaN(s) || isNaN(e)) return 0;
    return Math.max(0, Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1);
  }

  // ESTIMATED_COST is NUMBER(14,2) and BILL_RATE NUMBER(12,2): round to cents
  // rather than let the DB truncate silently.
  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  // PERIOD_TYPE (DAILY|WEEKLY|MONTHLY) → the noun PRICE_UOM carries
  // (DAY|WEEK|MONTH), matching the nouns already in that column ('DAY' on
  // legacy lines, 'EACH' for consumables). Unrecognised values pass through
  // upper-cased so a new period type still stores something truthful.
  function periodNoun(periodType) {
    var t = (periodType || '').toString().trim().toUpperCase();
    if (!t) return null;
    var NOUNS = { DAILY: 'DAY', WEEKLY: 'WEEK', MONTHLY: 'MONTH', HOURLY: 'HOUR', YEARLY: 'YEAR' };
    return NOUNS[t] || t;
  }

  /**
   * createRequestLine body for one cart item.
   *
   * @param {Object} item - a CartItemsArray entry
   * @param {Object} ctx
   * @param {number} ctx.requestId        - the header just created
   * @param {string} ctx.lineStatus       - DRAFT | SUBMITTED | IN_PROCESS
   * @param {Object} ctx.detail           - $flow.variables.ActiveRequestDetail (header dates)
   * @param {?number} ctx.headerHours     - header default hours, or null
   * @param {Object} ctx.agreementLineMap - { masterId: agreementLineId }
   * @param {boolean} ctx.quotePending    - a quote will set the price: post none
   */
  function build(item, ctx) {
    var detail = ctx.detail || {};
    // Fall back to id if equipmentId wasn't set on the cart item (some entry
    // paths only set id). Both hold the master id.
    var masterId = item.equipmentId != null ? item.equipmentId : item.id;

    // Per-line hours: explicit line value wins, else header default.
    var lineHoursRaw = (item.hours != null && item.hours !== '') ? item.hours : ctx.headerHours;
    var lineHours = (lineHoursRaw != null && lineHoursRaw !== '') ? Number(lineHoursRaw) : null;

    var agreementLineMap = ctx.agreementLineMap || {};
    var agreementLineId = (masterId != null && agreementLineMap[masterId] != null)
      ? Number(agreementLineMap[masterId]) : null;

    // ── Price as quoted ──────────────────────────────────────────────────
    // A consumable is priced per unit; a rentable per PERIOD (periodAmount +
    // periodType, e.g. $3,200 / WEEK) — the figure the catalog card and cart
    // showed. periodAmount/periodType are stamped at add-time by catalogCart.js
    // and are null for consumables, agreement-priced lines and legacy rate
    // lines; each falls back to the daily rate with its own billingUnit, so the
    // amount and its uom always agree.
    var isConsumableLine = item.isConsumable === true ||
      String(item.billingUnit || '').toUpperCase() === 'EACH';
    var periodPrice;
    if (ctx.quotePending) {
      // Quote pending: post no price at all. The cart showed "Rate on request";
      // a list price in BILL_RATE would read as an agreed one.
      periodPrice = { amount: null, uom: null };
    } else if (!isConsumableLine && item.periodAmount != null && item.periodUom) {
      periodPrice = { amount: Number(item.periodAmount), uom: periodNoun(item.periodUom) };
    } else {
      periodPrice = {
        amount: item.billingRate != null ? Number(item.billingRate) : null,
        uom:    item.billingUnit || null
      };
    }

    // Line total over its OWN window, exactly as the cart's Subtotal shows it:
    // qty × DAILY rate × days for a rentable, qty × unit price for a consumable.
    // Uses billingRate (per-day), NOT periodPrice.amount — a weekly amount ×
    // days would overstate the line by the length of the period. Null while a
    // quote is pending, because the cart showed "—".
    var lineQty  = Number(item.quantity) || 1;
    var lineRate = Number(item.billingRate) || 0;
    var lineDays = rentalDays(item.startDate || detail.requestedStartDate,
                              item.endDate   || detail.requestedEndDate);
    var lineEstimatedCost = ctx.quotePending
      ? null
      : (isConsumableLine
          ? round2(lineQty * lineRate)
          : (lineDays > 0 ? round2(lineQty * lineRate * lineDays) : null));

    return {
      eqrEquipmentRequestId: ctx.requestId,
      eqrEquipmentMasterId:  masterId != null ? Number(masterId) : null,
      eqrEquipmentClassId:   item.classId ? Number(item.classId) : null,
      quantity:              lineQty,
      lineStatus:            ctx.lineStatus,
      // BILL_RATE / PRICE_UOM carry the price AS QUOTED ($3,200 / WEEK,
      // $12.50 / EACH), not the derived per-day figure: the per-day rate is
      // recoverable from the period amount, the reverse is not. Any consumer
      // multiplying BILL_RATE must honour PRICE_UOM; estimatedCost is the
      // pre-computed total for exactly that reason.
      billRate:              periodPrice.amount,
      priceUom:              periodPrice.uom,
      estimatedCost:         lineEstimatedCost,
      startDate:             toISODate(item.startDate || detail.requestedStartDate),
      endDate:               toISODate(item.endDate   || detail.requestedEndDate),
      defaultHours:          lineHours,
      lineNotes:             item.notes || null,
      eqrAgreementLineId:    agreementLineId
    };
  }

  // Text for a rejected batch. The 400 names the first bad line by one-based
  // position in `message` and lists every bad field in errors[] (zero-based
  // index); the cart item's name is added so the user knows which row.
  function batchErrorText(body, items) {
    body = body || {};
    var errs = Array.isArray(body.errors) ? body.errors : [];
    if (errs.length && errs[0] && errs[0].index != null) {
      var e = errs[0];
      var it = (items || [])[e.index] || {};
      var more = errs.length > 1 ? ' (' + (errs.length - 1) + ' more problem(s) in the cart)' : '';
      return 'Line ' + (Number(e.index) + 1) + (it.name ? ' (' + it.name + ')' : '') + ': '
        + (e.message || 'invalid') + (e.field ? ' [' + e.field + ']' : '') + more;
    }
    return body.message || body.detail || body.title || '';
  }

  /**
   * Create every cart line in ONE call (POST .../lines/batch: one transaction,
   * all or nothing, order kept, at most 2000 lines). On failure the header just
   * created is deleted, so no empty request is left behind and the user can
   * retry from the cart, which is untouched.
   *
   * The header must still be DRAFT when this runs: DELETE refuses anything
   * else (409). Submit therefore creates the header as DRAFT and only PATCHes
   * it to SUBMITTED / IN_PROCESS after this succeeds.
   *
   * @returns {Promise<{ok: boolean, message: string, deleted: boolean}>}
   */
  async function createLines(context, Actions, opts) {
    var items = opts.items || [];
    var res;
    try {
      res = await Actions.callRest(context, {
        endpoint:  'eqp-v1/createRequestLinesBatch',
        uriParams: { requestId: opts.ctx.requestId },
        headers:   opts.headers || {},
        body:      { lines: items.map(function (it) { return build(it, opts.ctx); }) }
      });
    } catch (e) {
      res = { ok: false, status: 0, body: { message: String(e && e.message || e) } };
    }
    if (res && res.ok) {
      return { ok: true, message: '', deleted: false };
    }

    console.warn('[requestLineBody] lines batch failed', res && res.status, JSON.stringify(res && res.body));
    var message = batchErrorText(res && res.body, items)
      || ('The lines could not be saved (HTTP ' + (res && res.status) + ').');

    // Remove the empty DRAFT header. callerUserId is the owner id stamped on
    // the header when there is one; isAdmin covers INTERNAL requests, whose
    // requestor is the logged-in user and carries no user id to match.
    var deleted = false;
    try {
      var del = await Actions.callRest(context, {
        endpoint:  'eqp-v1/deleteEquipmentRequest',
        uriParams: Object.assign({ id: opts.ctx.requestId, isAdmin: true },
          opts.ownerUserId != null ? { callerUserId: opts.ownerUserId } : {})
      });
      deleted = !!(del && del.ok);
      if (!deleted) {
        console.warn('[requestLineBody] could not delete empty request', opts.ctx.requestId,
          del && del.status, JSON.stringify(del && del.body));
      }
    } catch (e) {
      console.warn('[requestLineBody] delete of empty request failed', opts.ctx.requestId, e);
    }
    return { ok: false, message: message, deleted: deleted };
  }

  /**
   * Replace EVERY line of a resumed DRAFT request in one call
   * (PUT .../lines/batch: one transaction — the old lines are deleted and the
   * cart's lines inserted in order; 409 unless the request is DRAFT). Used
   * when a reopened draft is saved again or submitted, so the request keeps
   * its number and a line the user removed really goes.
   *
   * Unlike createLines(), a failure deletes NOTHING: this is the user's
   * existing draft, so it stays exactly as it was and the cart is kept.
   *
   * @returns {Promise<{ok: boolean, message: string, deleted: false}>}
   */
  async function replaceLines(context, Actions, opts) {
    var items = opts.items || [];
    var res;
    try {
      res = await Actions.callRest(context, {
        endpoint:  'eqp-v1/replaceRequestLinesBatch',
        uriParams: { requestId: opts.ctx.requestId },
        headers:   opts.headers || {},
        body:      { lines: items.map(function (it) { return build(it, opts.ctx); }) }
      });
    } catch (e) {
      res = { ok: false, status: 0, body: { message: String(e && e.message || e) } };
    }
    if (res && res.ok) {
      return { ok: true, message: '', deleted: false };
    }
    console.warn('[requestLineBody] lines replace failed', res && res.status, JSON.stringify(res && res.body));
    var message = batchErrorText(res && res.body, items)
      || (res && res.status === 409
          ? 'This draft is no longer in Draft status, so its lines were not changed.'
          : 'The lines could not be saved (HTTP ' + (res && res.status) + ').');
    return { ok: false, message: message, deleted: false };
  }

  /**
   * The one entry point both cart buttons use: a resumed draft replaces its
   * lines in place; a new request creates them (and deletes its own empty
   * header if that fails).
   */
  function saveLines(context, Actions, opts) {
    return opts.resume ? replaceLines(context, Actions, opts) : createLines(context, Actions, opts);
  }

  /**
   * Apply a partial update to many of ONE request's lines in a single call
   * (PATCH .../lines/batch: one transaction, all or nothing, applied in array
   * order, at most 2000). Each update is { id, ...only the fields to change };
   * absent fields are left alone, exactly as PATCH .../lines/{id}, with the
   * same validation and triggers. Replaces the Promise.all-of-PATCHes loops:
   * 368 of those took 8.6 s, queued in the browser; the batch takes ~0.7 s.
   *
   * Never touches the request header — callers PATCH it after this succeeds.
   *
   * @param {Object} opts
   * @param {number} opts.requestId
   * @param {Array}  opts.updates  - [{ id, lineStatus?, ... }]
   * @param {Object} [opts.headers] - cu.auditHeaders(context)
   * @param {Array}  [opts.labels]  - display name per update, same order, for errors
   * @returns {Promise<{ok: boolean, message: string, lines: Array}>}
   *          lines: the updated rows, in the order sent (empty on failure)
   */
  async function updateLines(context, Actions, opts) {
    var updates = opts.updates || [];
    if (!updates.length) {
      return { ok: true, message: '', lines: [] };
    }
    var res;
    try {
      res = await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchRequestLinesBatch',
        uriParams: { requestId: opts.requestId },
        headers:   opts.headers || {},
        body:      { lines: updates }
      });
    } catch (e) {
      res = { ok: false, status: 0, body: { message: String(e && e.message || e) } };
    }
    if (res && res.ok) {
      return { ok: true, message: '', lines: (res.body && res.body.data) || [] };
    }
    console.warn('[requestLineBody] lines batch update failed', res && res.status, JSON.stringify(res && res.body));
    var named = (opts.labels || []).map(function (l) { return { name: l }; });
    return {
      ok: false,
      message: batchErrorText(res && res.body, named)
        || ('The lines could not be updated (HTTP ' + (res && res.status) + ').'),
      lines: []
    };
  }

  return {
    build: build,
    createLines: createLines,
    replaceLines: replaceLines,
    saveLines: saveLines,
    updateLines: updateLines,
    batchErrorText: batchErrorText,
    toISODate: toISODate,
    rentalDays: rentalDays,
    round2: round2,
    periodNoun: periodNoun
  };
});
