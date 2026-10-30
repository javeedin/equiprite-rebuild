define([], () => {
  'use strict';

  /*
   * PR pass-through row identity, in ONE place.
   *
   * EQP_P_POST_COST_DETAILS.ROW_KEY has exactly three shapes (verified live on
   * paasdev, 628 rows: 610 / 9 / 9):
   *
   *   <lineId>:0:<YYYYMMDD>          ordinary week -- rentable CP, DIRECT, consumable
   *   <lineId>:B<prId>:<YYYYMMDD>    PR pass-through BASE   -- the purchase order's own cost
   *   <lineId>:M<prId>:<YYYYMMDD>    PR pass-through MARGIN -- our markup on that cost
   *
   * V313 emits the B/M pair once PER REQUISITION, so one request line with two
   * live POs emits four rows (live: line 1000001343 -> B47, B49, M47, M49, all in
   * week 2026-07-06).
   *
   * A request line is EITHER a PR line or it is not: measured across all 8 live PR
   * lines, every one emits only B and M rows and never a `:0:` row. So a per-ROW
   * test is equivalent to a per-LINE test, and no caller has to aggregate.
   *
   * These predicates are NOT interchangeable, which is why they are named
   * separately rather than collapsed into one "is this PR" helper:
   *
   *   isBaseRow   -- the cost belongs to Fusion. It reaches PPM through the PO's own
   *                  projectDFF distribution and EquipRite never posts it. Nothing
   *                  EquipRite stores about this row's PPM classification is read by
   *                  anything, so BOTH the expenditure type and the project are
   *                  read-only here.
   *
   *   isMarginRow -- the cost is ours. It posts through EQR_POSTED_WEEK -> the queue
   *                  -> OIC like any other week, so its EXPENDITURE TYPE is genuinely
   *                  ours to author (that is what V305 shipped). Its PROJECT is not:
   *                  see isSplitLocked.
   *
   *   isPrRow     -- either. Use this for anything that must treat the PR line as one
   *                  indivisible pass-through, the project split being the case that
   *                  exists today.
   */

  /*
   * ⚠️ These match the DETAIL view's keys only. `EQP_POSTCOST`, the LIST view,
   * keys its PR rows as `PR:<requestId>:<YYYYMMDD>` (e.g. `PR:1000001566:20260907`)
   * -- a fourth shape, at request x week grain, summing base + margin across every
   * line. So none of these predicates recognise a list row, and none should be
   * pointed at one.
   */
  const RE_BASE   = /^\d+:B\d+:\d{8}$/;
  const RE_MARGIN = /^\d+:M\d+:\d{8}$/;
  const RE_ANY_PR = /^\d+:[BM]\d+:\d{8}$/;

  /** The purchase order's own cost. Not ours to post, classify or re-project. */
  function isBaseRow(rowKey) {
    return RE_BASE.test(String(rowKey || ''));
  }

  /** Our markup on a PR line. Ours to post and to classify; NOT ours to re-project. */
  function isMarginRow(rowKey) {
    return RE_MARGIN.test(String(rowKey || ''));
  }

  /** Any PR pass-through row, base or margin. */
  function isPrRow(rowKey) {
    return RE_ANY_PR.test(String(rowKey || ''));
  }

  /*
   * ⚠️ THE ROW_KEY PREDICATES ABOVE ARE DORMANT IN THE BROWSER TODAY.
   *
   * `EQP_P_POST_COST_DETAILS` HAS a `ROW_KEY` column and `openapi3.json` DECLARES
   * `rowKey` on the response, but the Java DTO does not project it: the live
   * service returns 24 fields for `GET /views/post-cost-details` and `rowKey` is
   * not among them (probed 2026-09-10 against 132.145.153.37:8087,
   * REQ-1786556804636 -- all four rows, no key). vbEnterChain's own `retierFor`
   * already says so: "Robust to the empty rowKey the detail-view DTO returns."
   *
   * So anything keyed on ROW_KEY silently matches NOTHING. That is not only this
   * lock -- `groupExpLocked` and `postSelectedChain`'s `ledgerKey` are on the same
   * footing, and both are real live defects. Handed to the backend session; do not
   * assume a declared field arrives.
   *
   * They are kept, not deleted, because they are correct and become live the moment
   * the DTO projects the column -- and because they cost nothing as a second line
   * of defence.
   *
   * THE LIVE HANDLE is `isPrLine`, stamped onto every row by vbEnterChain from
   * `GET /purchase-requisitions?requestId=<internal id>`, which really does return
   * `eqrRequestLineId`. It is LINE-grain, and that is exactly right: measured live,
   * all 35 lines in `EQR_PURCHASE_REQUISITION` emit only `:B`/`:M` post-cost rows
   * and **not one emits a `:0:` row**, so a line-level test cannot over-block a row
   * that bills through us. It is also strictly wider in the useful direction: it
   * covers the 27 PR lines whose PO is not priced yet and which will start emitting
   * base/margin rows the moment it is.
   */

  /** The live PR test: the row's line has a purchase requisition. */
  function isPrLineRow(row) {
    if (!row) return false;
    return !!row.isPrLine || isPrRow(row.rowKey);
  }

  /*
   * Request-line ids carrying a purchase requisition, from a
   * `GET /purchase-requisitions?requestId=` body. Returns a plain lookup object
   * so callers can test with `!!set[lineId]` and never re-walk the array.
   *
   * Tolerant of the three envelope shapes the eqp-v1 views use ({data}, bare
   * array, {items}) because this endpoint is paged and the others are not, and a
   * wrong guess here fails OPEN -- i.e. it would put the "Split cost" link back.
   */
  function parsePrLineIds(body) {
    const rows = (body && Array.isArray(body.data)) ? body.data
               : (Array.isArray(body) ? body
               : ((body && Array.isArray(body.items)) ? body.items : []));
    const out = {};
    rows.forEach(function (r) {
      // Positive ids only. A row row-keyed "0" would collide with the "0" a caller
      // gets from String(Number(null)) on a week whose requestLineId is null --
      // which vbEnterChain can genuinely produce.
      const id = Number(r && r.eqrRequestLineId);
      if (isFinite(id) && id > 0) { out[String(id)] = true; }
    });
    return out;
  }

  /*
   * Can this week's cost be divided across projects?
   *
   * No, on ANY PR pass-through row -- base or margin. Three reasons, each on its
   * own sufficient:
   *
   *  1. The base cost cannot move. Its project comes from the PO's projectDFF
   *     distribution, which is authored in Fusion and which EquipRite does not
   *     write. Fusion's own way to spread one PO line over projects is multiple
   *     DISTRIBUTIONS, on the PO -- not anything on our side.
   *
   *  2. So a split offered on the margin alone would move only the markup. On the
   *     live 10% margin that is one tenth of the money: the user would author
   *     "60/40", see a split rendered, and 90% of the cost would still land whole
   *     on the original project. A half-split that looks complete is worse than
   *     no split, and it is the same trap that already made the expenditure-type
   *     base lock necessary -- a write that lands somewhere nothing reads.
   *
   *  3. The margin's own grain does not support it. Splits are keyed
   *     (requestLineId, weekStartDate); a two-requisition line emits TWO margin
   *     rows sharing one (line, week) -- live: 1000001343 M47 and M49 on
   *     2026-07-06. One authored split would attach to both, and both would build
   *     the same REVERSAL_REF ('EQR-' + lineId + '-' + week), which
   *     EQR_PW_REVREF_UX rejects. The second slice would land silently in
   *     failCount.
   *
   * Also no on a settled week: a POSTED or REVERSED week keeps the projects it was
   * sent to Fusion with, because the ledger froze them at post time. Corrected by
   * reversal, never by re-splitting.
   */
  function isSplitLocked(row) {
    if (!row) return false;
    return !!(row.posted || row.reversed) || isPrLineRow(row);
  }

  /** Why isSplitLocked said no, in the user's terms. '' when it did not. */
  function splitLockReason(row) {
    if (!row) return '';
    if (isPrLineRow(row)) {
      return 'This equipment is supplied on a Fusion purchase requisition, so its project '
           + 'comes from the purchase order distribution and not from EquipRite. The markup '
           + 'follows the same project as the order it marks up, so it cannot be split on '
           + 'its own. Split the cost on the purchase order instead.';
    }
    if (row.posted || row.reversed) {
      return 'This week is already posted. A posted week keeps the projects it was sent to '
           + 'Fusion with -- correct it with a reversal, not by re-splitting.';
    }
    return '';
  }

  /*
   * PO unit prices per request line, from the same
   * `GET /purchase-requisitions?requestId=` body. Deliberately a SECOND parser
   * rather than an extra field on parsePrLineIds: that one feeds the split LOCK,
   * which is a money-safety control, and this one feeds a LABEL. Keeping them
   * apart means a mistake in the cosmetic half cannot weaken the lock.
   *
   * Unpriced requisitions are skipped -- a line with no priced PO emits no
   * post-cost rows at all (verified: all 27 such lines produce none), so an empty
   * price list means "nothing to label" and every rule below falls back safely.
   */
  function parsePrPoPrices(body) {
    const rows = (body && Array.isArray(body.data)) ? body.data
               : (Array.isArray(body) ? body
               : ((body && Array.isArray(body.items)) ? body.items : []));
    const out = {};
    rows.forEach(function (r) {
      if (!r || r.poUnitPrice == null) return;
      const id = Number(r.eqrRequestLineId);
      if (!isFinite(id) || id <= 0) return;   // see parsePrLineIds
      (out[String(id)] = out[String(id)] || []).push(Number(r.poUnitPrice));
    });
    return out;
  }

  /*
   * Is this row OUR MARGIN on a purchase requisition (rather than the PO's own
   * base cost)? Drives the row label: a margin row reads "Margin", a base row
   * keeps "One-time".
   *
   * ⚠️ This is the one predicate here that is a HEURISTIC, and it is worth knowing
   * why. V313 distinguishes the two rows only by ROW_KEY (`:B<prId>:` vs
   * `:M<prId>:`) -- and the detail DTO does not project ROW_KEY (see the note
   * above). Of the 24 fields it does return, the base and margin rows of one
   * requisition differ in exactly four, and three of those are the same number:
   * applicableRate, billAmount, costAmount and postStatus. So there is no
   * authoritative field to read, only two facts to combine:
   *
   *   ARM 1 -- a base row's rate IS the PO unit price. So a rate that matches no
   *            PO price on this line cannot be a base row.
   *   ARM 2 -- V313 emits the base row's POST_STATUS as the literal 'POSTED'
   *            (a deliberate product decision, BACKEND_GOAHEAD_PR_SHOW_AS_POSTED
   *            §1). So anything not POSTED cannot be a base row either.
   *
   * ARM 1 alone is NOT enough, and live data proves it rather than theory: line
   * 1000001343 carries two requisitions at 1000 and 100, and its MARGIN row M47
   * has rate 100 -- which collides exactly with sibling base row B49's PO price.
   * ARM 2 is what rescues it.
   *
   * Measured against ROW_KEY as ground truth on all 18 live PR rows: 18/18 correct.
   *
   * WHERE IT DEGRADES, and it degrades SAFELY: once a margin row is actually
   * posted its status becomes a real 'POSTED', so ARM 2 stops firing. On a
   * single-requisition line that is harmless (ARM 1 still separates 10% from
   * 100%), but on a multi-requisition line whose rates collide -- 1000001343 is
   * the only live one -- the row falls back to "One-time". It never labels a BASE
   * row as "Margin", which is the direction that would matter: the user's own
   * framing was "the $12 one-time is fine".
   *
   * The real fix is ROW_KEY in the DTO (handoff Task 6a); this function becomes a
   * one-line delegation to isMarginRow the day it lands, and the first check below
   * already prefers it whenever it is present.
   */
  function isPrMarginRow(row, poPrices) {
    if (!row) return false;
    // Truth first, for the day the DTO projects it.
    if (isMarginRow(row.rowKey)) return true;
    if (isBaseRow(row.rowKey))   return false;

    if (!row.isPrLine) return false;
    const prices = Array.isArray(poPrices) ? poPrices.map(Number) : [];
    // No known PO price means no base row exists to be confused with, and no
    // grounds to relabel anything. Fall back to the plain label.
    if (!prices.length) return false;

    // ARM 1. Two guards that are not fussiness:
    //
    //  - `rate > 0`. Number(null) is 0 and isFinite(0) is true, so a row with a
    //    MISSING rate would otherwise "match no PO price" and be declared a
    //    margin on no evidence at all. A missing or sentinel rate (this engine
    //    clamps -995/-999 to $0) is not evidence either way, so it must fall
    //    through to ARM 2 rather than fire ARM 1. Not reachable on today's data
    //    (all 18 live PR rows have a positive rate) but one null away from
    //    mislabelling a base row, which is the direction that matters.
    //
    //  - cents, not floats. `indexOf` is exact equality on money. Every live PO
    //    price is a whole number and matches the view's rate exactly (checked all
    //    9 base rows), but the day one is 12.499 against a rounded 12.50, exact
    //    equality would fail and ARM 1 would fire on a BASE row. Rounding makes
    //    ARM 1 harder to fire, which is the safe direction.
    const rate = Number(row.applicableRate);
    const cents = function (n) { return Math.round(Number(n) * 100); };
    if (isFinite(rate) && rate > 0
        && prices.map(cents).indexOf(cents(rate)) < 0) return true;          // ARM 1
    if (String(row.postStatus || '').toUpperCase() !== 'POSTED') return true; // ARM 2
    return false;
  }

  /*
   * Inclusive day count between two ISO dates, or 0 if either is unusable.
   *
   * Deliberately the SAME arithmetic the PR is created with, so the number here
   * and the number Fusion was sent cannot drift:
   * request-detail-page-chains/ActionChain.js:1559 seeds the requisition line's
   * quantity as `durationDays(line_start_date, line_end_date)` =
   * `Math.round((end - start) / 86400000) + 1`.
   *
   * Parsed at local midnight, like durationDays does, so a DST boundary inside
   * the span cannot shave the count -- Math.round absorbs the 23- or 25-hour day.
   */
  function inclusiveDays(startISO, endISO) {
    const parse = function (v) {
      if (!v) return null;
      const d = new Date(String(v).slice(0, 10) + 'T00:00:00');
      return isNaN(d.getTime()) ? null : d;
    };
    const s = parse(startISO);
    const e = parse(endISO);
    if (!s || !e) return 0;
    const n = Math.round((e - s) / 86400000) + 1;
    return n > 0 ? n : 0;
  }

  /*
   * INTERIM WORKAROUND. How many days to multiply a PR row's amount by, or 1 to
   * leave it alone.
   *
   * THE DEFECT IT COVERS. `EQR_PURCHASE_REQUISITION.PO_QUANTITY` is NULL on every
   * row -- it has never been written -- so Branch 4 of the detail view computes
   * `NVL(PO_UNIT_PRICE,0) * NVL(PO_QUANTITY, NVL(rl.QUANTITY,1))` and lands on
   * `price x 1`, because `rl.QUANTITY` is a UNIT COUNT (1 on all 43 rows), not a
   * duration. So a rental priced at $1,000/day for 21 days shows as $1,000. The
   * real fix is one line in the OIC PO trigger, whose payload already carries
   * `PurchaseOrderLine/Quantity`: MD/Purchase Req/BACKEND_PROMPT_PO_QUANTITY_MISSING.md.
   *
   * WHY THE MULTIPLIER IS KNOWN AND NOT GUESSED. EquipRite raises the requisition
   * itself, with `UOMCode` = the pod's DAY unit and `Quantity` =
   * `durationDays(line dates)`. And the view's SPAN_START/SPAN_END are exactly
   * `rl.START_DATE`/`rl.END_DATE` -- checked on all 11 live PR rows, 11 matches --
   * so `inclusiveDays(span)` reproduces the quantity Fusion was sent. Validated
   * end to end: requisition 204546 is 18 days x $12 and Fusion shows $216.00.
   *
   * 🔴 SELF-DISARMING, AND THIS IS THE LOAD-BEARING PART. The guard is
   * `Number(row.qty) > 1 -> return 1`. `qty` is the view's own
   * `NVL(PO_QUANTITY, NVL(rl.QUANTITY,1))`, so the moment the backend stamps
   * PO_QUANTITY the view already multiplies and this stops. Without that guard
   * the workaround would turn into a 21x OVERSTATEMENT on the day the real fix
   * lands -- which is far worse than the understatement it is fixing, and would
   * look like the backend broke it.
   *
   * SCOPE. PR rows only (`isPrLine`), so ordinary DIRECT and consumable rows --
   * where `qty` genuinely IS a unit count and price x qty is already right -- are
   * untouched. A PR line emits exactly ONE week (verified: 1 week per line across
   * all 10), so there is no per-week division to double-count.
   *
   * KNOWN LIMIT. A PO raised BY HAND in Fusion need not carry days as its
   * quantity. One such row exists (line 1000000458 / US165441, hand-raised by
   * JOHN.DUNBAR) and is already documented as permanently wrong for an unrelated
   * reason -- empty projectDFF, accepted in
   * BACKEND_GOAHEAD_PR_SHOW_AS_POSTED.md §1. Nothing in the payload distinguishes
   * a hand-raised PO, so this cannot detect it. That is a reason to land the real
   * fix, not a reason to leave every row understated meanwhile.
   */
  function prDayMultiplier(row, isPrLine) {
    if (!row || !isPrLine) return 1;
    // The view already had a real PO_QUANTITY. Do not touch it.
    if (Number(row.qty) > 1) return 1;
    const days = inclusiveDays(row.spanStart, row.spanEnd);
    return days > 1 ? days : 1;
  }

  return {
    isBaseRow: isBaseRow,
    isMarginRow: isMarginRow,
    isPrRow: isPrRow,
    isPrLineRow: isPrLineRow,
    parsePrLineIds: parsePrLineIds,
    parsePrPoPrices: parsePrPoPrices,
    inclusiveDays: inclusiveDays,
    prDayMultiplier: prDayMultiplier,
    isPrMarginRow: isPrMarginRow,
    isSplitLocked: isSplitLocked,
    splitLockReason: splitLockReason,
  };
});
