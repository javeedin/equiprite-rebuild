define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/expenditureTypes',
  'resources/js/prPassThrough',
], (ActionChain, Actions, expenditureTypes, prPassThrough) => {
  'use strict';

  /*
   * Post Cost Test — detail vbEnter (REAL DATA, LEDGER-AWARE).
   *
   * Reads the live view getEquipriteV1ViewsPostCostDetails (EQP_P_POST_COST_DETAILS,
   * V210) which is now LEDGER-AWARE: it emits real POST_STATUS values sourced from
   * the EQR_POSTED_WEEK ledger —
   *   POSTED    -> a posted-original week (frozen posted amount)
   *   REVERSED  -> a superseded week (frozen original amount, shown struck-through)
   *   DRAFT     -> a REPOST draft (the re-tiered amount, postable)
   * plus the lifecycle echo values (SUBMITTED/DEPLOYED/CLOSED/…) for un-posted CP
   * weeks and APPROVED for the utilization branch.
   *
   * The cost engine/view is AUTHORITATIVE. This chain does NO cost arithmetic
   * (anti-V190): every dollar is the view's COST_AMOUNT, and the re-tiered figure
   * used by the Reverse action is read from the read-only helper view
   * EQP_LINE_RETIER_WEEKS (V211) and frozen onto each week row (retierCost/Rate/
   * Period). The old client-side early-return reconstruction (round(cost/rate) day
   * math) has been REMOVED — the view already bills LEAST(planned_end, actual_return)
   * and tags status, so reconstructing it in JS was both redundant and an anti-V190
   * hazard.
   *
   * Still a SANDBOX page (separate from the live post-cost-detail).
   */
  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const requestNumber = $page.variables.requestNumber || '';
      if (!requestNumber) {
        console.warn('[post-cost-test detail] Missing requestNumber');
        return;
      }

      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsPostCostDetails',
        uriParams: { requestNumber: requestNumber }
      });

      if (!response || !response.ok || !response.body || !Array.isArray(response.body.data)) {
        console.warn('[post-cost-test detail] fetch failed:', response && response.status);
        $page.variables.rowsAll = [];
        $page.variables.rowsVisible = [];
        return;
      }

      const src = response.body.data;
      if (!src.length) {
        $page.variables.rowsAll = [];
        $page.variables.rowsVisible = [];
        $page.variables.totalCost = 0;
        $page.variables.postedCost = 0;
        $page.variables.incurredToDate = 0;
        $page.variables.netAdjustment = 0;
        $page.variables.lastPostedLabel = '—';
        return;
      }

      // ── companion read: re-tiered per-week amounts (EQP_LINE_RETIER_WEEKS, V211).
      // This is what a week WOULD cost at the current (early-return) tier, ignoring
      // posted-state — the number the Reverse action writes into REPOST drafts.
      // Sourced entirely from EQR_RESOLVE_RATE inside SQL (anti-V190). Keyed by the
      // bare fan ROW_KEY (lineId:0:weekYYYYMMDD) so it merges onto posted/reversed
      // rows whose stored ROW_KEY is that same bare key.
      const retierByKey = {};
      try {
        const retierResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsLineRetierWeeks',
          uriParams: { requestNumber: requestNumber }
        });
        var _rb = retierResp && retierResp.body;
        var _arr = (_rb && Array.isArray(_rb.data)) ? _rb.data
                 : (Array.isArray(_rb) ? _rb
                 : (_rb && Array.isArray(_rb.items) ? _rb.items : null));
        if (_arr) {
          _arr.forEach(function (m) {
            if (!m) return;
            var info = {
              cost: Number(m.retierCost || 0),
              rate: Number(m.retierRate || 0),
              period: String(m.retierPeriod || ''),
              lineId: (m.requestLineId != null ? m.requestLineId : null)
            };
            // Key two ways so the merge survives whichever field the DETAIL rows
            // actually carry (the detail-view DTO returns an EMPTY rowKey, so
            // requestLineId+weekStartDate is the reliable join).
            //
            // There is deliberately NO week-only key. A 'W|<week>' entry is
            // last-write-wins across every line in the request, so any row that
            // legitimately has no re-tier of its own — a one-time DIRECT charge, a
            // request-specific PR line, a line with no dates — would silently
            // inherit an arbitrary OTHER line's re-tier. That produced phantom
            // "Reverse (tier changed)" prompts on one-time charges, and could feed
            // a foreign lineId into the reversal call below. No re-tier must mean
            // null, not somebody else's.
            var wISO = String(m.weekStartDate || '').slice(0, 10);
            if (m.rowKey) retierByKey[String(m.rowKey).split(':').slice(0, 3).join(':')] = info;
            if (m.requestLineId != null && wISO) retierByKey['LW|' + m.requestLineId + '|' + wISO] = info;
          });
        }
      } catch (e) {
        // Helper view not yet registered — Reverse will fall back to no re-tier
        // preview; forward posting + display still work.
        console.warn('[post-cost-test detail] retier fetch failed (non-fatal):', e && e.message);
      }

      // ── companion read: blackout / exclusion days (EQP_P_BLACKOUT_WEEKS, V272).
      // Sparse — only weeks that actually carry an exception — and keyed
      // (requestLineId, weekStartDate), which is exactly how the week rows below are
      // keyed. The engine and both post-cost views already subtract these days, so
      // the COST on a week row is correct without this read; it exists so the day
      // rows can show WHICH days are excluded, and why.
      //
      // The view answers three things the page cannot work out for itself:
      //   blackoutDates  — marked AND inside the line's span, i.e. actually reducing cost
      //   ignoredDates   — marked but outside the span, subtracting nothing
      //   applicability  — EDITABLE / POSTED / NOT_APPLICABLE, decided server-side
      // A row carrying rateType USAGE (the un-mark) appears in neither list, so
      // "a row exists" never means "excluded".
      const blackoutByKey = {};
      try {
        const bwResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getBlackoutWeeks',
          uriParams: { requestNumber: requestNumber }
        });
        const bwBody = bwResp && bwResp.body;
        const bwArr = (bwBody && Array.isArray(bwBody.data)) ? bwBody.data
                    : (Array.isArray(bwBody) ? bwBody : []);
        bwArr.forEach(function (b) {
          if (b.requestLineId == null || !b.weekStartDate) return;
          blackoutByKey[b.requestLineId + '|' + String(b.weekStartDate).slice(0, 10)] = {
            dates:         Array.isArray(b.blackoutDates) ? b.blackoutDates.map(function (x) { return String(x).slice(0, 10); }) : [],
            ignored:       Array.isArray(b.ignoredDates)  ? b.ignoredDates.map(function (x) { return String(x).slice(0, 10); })  : [],
            days:          Number(b.blackoutDays || 0),
            applicability: String(b.applicability || 'EDITABLE').toUpperCase()
          };
        });
      } catch (e) {
        console.warn('[post-cost-test detail] blackout-weeks fetch failed (non-fatal):', e && e.message);
      }

      // ── companion read: miscellaneous charges (EQR_LINE_MISC_TXN).
      // Line-grain, and unlike every other read on this page these rows are not
      // derived from anything — a human typed them. They therefore render exactly
      // as stored: never date-filtered (the future-week filter hides projections,
      // and a charge is not a projection) and never re-costed.
      //
      // Posting one is LOCAL: /misc-transactions/post flips STATUS to POSTED in our
      // DB and calls no Fusion endpoint, matching what postSelectedChain does for
      // rental weeks. The status shown here is ours, not PPM's.
      const miscByLine = {};
      try {
        const mtResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getMiscTransactions',
          uriParams: { requestNumber: requestNumber }
        });
        const mtBody = mtResp && mtResp.body;
        const mtArr = (mtBody && Array.isArray(mtBody.data)) ? mtBody.data
                    : (Array.isArray(mtBody) ? mtBody
                    : (mtBody && Array.isArray(mtBody.items) ? mtBody.items : []));
        mtArr.forEach(function (m) {
          if (!m || m.requestLineId == null) return;
          (miscByLine[m.requestLineId] = miscByLine[m.requestLineId] || []).push(m);
        });
      } catch (e) {
        // Endpoint not deployed yet — the page must still render its rental cost.
        console.warn('[post-cost-test detail] misc-transactions fetch failed (non-fatal):', e && e.message);
      }

      // ── companion read: project splits (EQR_LINE_PROJECT_SPLIT).
      // How each equipment's cost is divided across Fusion projects. Line-grain
      // and authored, like the misc charges above, so it renders exactly as
      // stored — a split is not derived from anything and is never re-costed.
      //
      // AWAITED, unlike the expenditure-type resolver below which is
      // fire-and-forget: this feeds the badge in the table's FIRST PAINT, not a
      // dropdown that appears only once a drawer opens. Same non-fatal posture as
      // the misc read though — if the endpoint is not deployed the page must
      // still render its rental cost, it just shows no split.
      //
      // Note this carries the AUTHORED split (what future weeks will post as).
      // An already-posted week's own projects are frozen in EQR_POSTED_WEEK and
      // are deliberately not read back here: the page shows what WILL post, and
      // re-authoring a split must never appear to rewrite a posted week.
      // Keyed by LINE + WEEK, because a split is authored per week: 27 Jul-2 Aug
      // can be 60/40 while 3 Aug-9 Aug posts wholly to the request's own project.
      const splitsByLineWeek = {};
      const splitKey = function (lineId, weekISO) {
        return String(lineId) + '|' + String(weekISO || '').slice(0, 10);
      };
      try {
        const spResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getLineProjectSplits',
          uriParams: { requestNumber: requestNumber }
        });
        const spBody = spResp && spResp.body;
        const spArr = (spBody && Array.isArray(spBody.data)) ? spBody.data
                    : (Array.isArray(spBody) ? spBody
                    : (spBody && Array.isArray(spBody.items) ? spBody.items : []));
        spArr.forEach(function (s) {
          if (!s || s.requestLineId == null || !s.weekStartDate) return;
          const k = splitKey(s.requestLineId, s.weekStartDate);
          (splitsByLineWeek[k] = splitsByLineWeek[k] || []).push(s);
        });
      } catch (e) {
        console.warn('[post-cost-test detail] line-project-splits fetch failed (non-fatal):', e && e.message);
      }

      // -- which request lines are PR pass-through lines -----------------------
      //
      // The project split must be locked on these (base AND margin: see
      // prPassThrough.isSplitLocked). ROW_KEY would be the natural handle and is
      // what the code used to test -- but the detail DTO does not project it, so
      // that test matched nothing and the lock never fired. This endpoint really
      // does return `eqrRequestLineId`, so the lock is LINE-grain now.
      //
      // Safe at line grain, measured live rather than assumed: all 35 lines in
      // EQR_PURCHASE_REQUISITION emit only :B/:M post-cost rows and NOT ONE emits
      // a :0: row, so no row that bills through EquipRite can be caught by this.
      //
      // requestId is REQUIRED by the endpoint (400 without it) and arrives fromUrl
      // with `|| 0` fallbacks in both navigation chains, so fall back to the same
      // resolver the expenditure-type loader uses rather than giving up on 0.
      //
      // AWAITED, unlike the expenditure-type load. This one decides whether a
      // control renders, so it has to be settled before the rows are built -- and
      // it is one local round trip, not five to Fusion.
      //
      // FAILS OPEN on error, which puts the "Split cost" link back rather than
      // hiding it everywhere. Deliberate: a blip on this one endpoint must not
      // silently disable a working feature across the whole page, and the real
      // invariant is the server-side rejection (handoff Task 6b) -- a UI lock was
      // never going to be one.
      const prLineIds = {};
      // PO unit prices per line, for the row LABEL only (see
      // prPassThrough.isPrMarginRow). Separate from prLineIds on purpose: that one
      // drives the split lock and this one drives a caption.
      const prPoPrices = {};
      try {
        let prRequestId = Number($page.variables.internalRequestId) || 0;
        if (!prRequestId) {
          prRequestId = Number(await expenditureTypes.resolveRequestIdByNumber(
            function (opts) { return Actions.callRest(context, opts); }, requestNumber)) || 0;
        }
        if (prRequestId) {
          // size explicitly: this endpoint pages and defaults to 20. The worst live
          // case is 6 requisitions on one request, so one page is enough -- but
          // `hasMore` is checked rather than trusted, because a truncated page would
          // silently UNLOCK the lines it dropped.
          const prResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getPurchaseRequisitions',
            uriParams: { requestId: prRequestId, page: 0, size: 200 }
          });
          const prBody = prResp && prResp.body;
          Object.assign(prLineIds, prPassThrough.parsePrLineIds(prBody));
          Object.assign(prPoPrices, prPassThrough.parsePrPoPrices(prBody));
          if (prBody && prBody.hasMore) {
            console.warn('[post-cost-test detail] purchase-requisitions reported hasMore at '
              + 'size=200; some PR lines may not be locked. Raise the page size.');
          }
        } else {
          console.warn('[post-cost-test detail] no internal request id for ' + requestNumber
            + '; PR lines cannot be identified, so the split lock is OFF for this request.');
        }
      } catch (e) {
        console.warn('[post-cost-test detail] purchase-requisitions fetch failed; the split '
          + 'lock is OFF for this request (non-fatal):', e && e.message);
      }

      // -- INTERIM: restore the day quantity on PR rows -------------------------
      //
      // Applied HERE, to the fetched rows, BEFORE anything groups or sums them --
      // so the equipment rollup, the TOTAL / ALREADY POSTED chips and the amount
      // postSelectedChain freezes into the ledger all follow from one place. The
      // alternative (fixing it at render time) would have shown one number and
      // posted another, which is the exact divergence this page is built to avoid.
      //
      // See prPassThrough.prDayMultiplier for why the multiplier is known rather
      // than guessed, and for the self-disarming `qty > 1` guard that switches
      // this off the moment the backend stamps PO_QUANTITY.
      //
      // APPLICABLE_RATE is deliberately NOT scaled: it is the PO's per-day price,
      // which is correct as it stands and is what the user compares to Fusion.
      // Only the extended amount was wrong.
      // COPIES, never a mutation of `response.body`. An in-place rewrite of the
      // fetched rows compounds if the same body is ever handed back -- caught by
      // the test harness, where a second case inherited the first case's scaled
      // amounts and its prDays. Cheap to avoid, and it makes the step idempotent
      // by construction: the same input always produces the same output.
      let prScaled = 0;
      const rows = src.map(function (r) {
        const mult = prPassThrough.prDayMultiplier(
          r, !!prLineIds[String(Number(r.requestLineId))]);
        if (mult <= 1) return r;
        prScaled++;
        return Object.assign({}, r, {
          costAmount: Number(r.costAmount || 0) * mult,
          billAmount: Number(r.billAmount || 0) * mult,
          // Carried so the DAYS column can show the multiplier. Without it the row
          // reads "$1,000 rate, $21,000 cost" with nothing on screen explaining
          // the 21, which is its own kind of wrong.
          prDays: mult
        });
      });
      if (prScaled) {
        console.warn('[post-cost-test detail] INTERIM: scaled ' + prScaled + ' purchase-requisition '
          + 'row(s) by their day span because EQR_PURCHASE_REQUISITION.PO_QUANTITY is NULL. '
          + 'This disarms itself once the OIC trigger stamps that column -- see '
          + 'MD/Purchase Req/BACKEND_PROMPT_PO_QUANTITY_MISSING.md');
      }

      // -- expenditure types -----------------------------------------------------
      // One shared resolver, used identically by the timesheet grid: the tenant's
      // active types, not scoped by project. See resources/js/expenditureTypes.js
      // for why and for the failure behaviour.
      //
      // FIRE-AND-FORGET, deliberately. The first call pages the whole Fusion
      // catalogue (~6 round-trips at 500 a page) and
      // it was originally awaited here -- which left the whole cost table blank until
      // Fusion answered, and at worst until it timed out, to populate a dropdown that
      // is not on screen until someone opens a drawer. The money is what this page is
      // for; it must never wait on a picker.
      //
      // Safe to let it land late: both drawers build their provider from
      // $variables.expTypeList on open, so a list that arrives after the table has
      // rendered is still picked up. An empty result leaves the seeded
      // proven-accepted values, so no picker is ever blank.
      expenditureTypes.loadForRequest(
        function (opts) { return Actions.callRest(context, opts); },
        {
          projectIdHint: $page.variables.ppmProjectRefId,
          requestId:     $page.variables.internalRequestId,
          requestNumber: $page.variables.requestNumber
        }
      ).then(function (expTypes) {
        if (expTypes && expTypes.length) { $page.variables.expTypeList = expTypes; }
      }).catch(function (e) {
        console.warn('[EXPTYPE] resolve failed, keeping the seeded values:', e && e.message);
      });

      // Resolve the frozen re-tier for a detail row by rowKey (if present) else by
      // (requestLineId, weekStartDate). Robust to the empty rowKey the detail-view
      // DTO returns. Both keys are line-specific — see the note above on why there
      // is no week-only fallback. Returns null when this line has no re-tier.
      function retierFor(r) {
        var k = r && r.rowKey ? String(r.rowKey).split(':').slice(0, 3).join(':') : '';
        var wISO = r ? String(r.weekStartDate || '').slice(0, 10) : '';
        var lineId = (r && r.requestLineId != null) ? r.requestLineId : null;
        return (k && retierByKey[k])
            || (lineId != null && wISO ? retierByKey['LW|' + lineId + '|' + wISO] : null)
            || null;
      }

      // ── date helpers (UTC, whole days) ──────────────────────────────────
      const parseD = (s) => {
        if (!s) return null;
        const d = new Date(String(s).slice(0, 10) + 'T00:00:00Z');
        return isNaN(d.getTime()) ? null : d;
      };
      const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      // Request-level planned window — a FALLBACK only. V273 added the per-LINE
      // SPAN_START/SPAN_END to the detail view and that is what the day rows use;
      // the request window is wrong for any line whose own dates are narrower.
      const spanStartISO = String($page.variables.plannedStartDate || '').slice(0, 10) || null;
      const spanEndISO   = String($page.variables.plannedEndDate   || '').slice(0, 10) || null;
      const fmt = (d) => {
        if (!d) return '';
        const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
        return mo + ' ' + d.getUTCDate();
      };
      const today = (() => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); })();

      // The applicable rate is ALWAYS per-day; the tier name (Daily/Weekly/Monthly)
      // is surfaced separately in the Rate Tier column. P4: show the period-
      // equivalent in parentheses (WEEKLY -> rate×7 "/wk", MONTHLY -> rate×30 "/mo").
      const periodEquiv = (rate, period) => {
        const p = String(period || '').toUpperCase();
        if (rate > 0 && p === 'WEEKLY')  return '  ($' + (rate * 7).toLocaleString()  + '/wk)';
        if (rate > 0 && p === 'MONTHLY') return '  ($' + (rate * 30).toLocaleString() + '/mo)';
        return '';
      };

      // Cost-line STATUS from the view's POST_STATUS. The ledger/view is
      // authoritative; JS only maps a status string + (for un-posted lifecycle
      // rows) does a calendar past/current/future split. NO cost math here.
      const TERMINAL = { POSTED: 1, REVERSED: 1, DRAFT: 1, APPROVED: 1 };
      // A DIRECT row (consumable / request-specific PR) is a ONE-TIME charge: the
      // whole cost is incurred up front, so it is postable from its start date.
      // The week-elapsed rule below applies only to rentals, whose cost accrues
      // across the week and so can't be billed until the week is over. Without
      // this split a one-time charge sat at "In progress" for the rest of its
      // ISO week and could not be posted at all.
      const readyToPost = (ws, we, direct) => direct
        ? !!(ws && ws <= today)
        : !!(we && we < today);
      const classify = (postStatus, ws, we, direct) => {
        const s = String(postStatus || '').toUpperCase();
        if (s === 'POSTED')   return { posted: true,  reversed: false, postable: false, tag: 'Posted' };
        if (s === 'REVERSED') return { posted: false, reversed: true,  postable: false, tag: 'Reversed' };
        // IN_PROGRESS is emitted by EQP_P_POST_COST_DETAILS (V245) for a CONSUMABLE
        // that has no consumption row yet. Fusion costs a consumable on the material
        // issue, so Post Cost only mirrors it - it is never manually posted. It must
        // therefore never be postable, and must NOT fall through to the date-derived
        // branch below, which would hand it a Draft checkbox and let an EM post a
        // cost that Fusion is going to post again.
        // It still counts toward "Incurred to today" once its date has passed - the
        // charge is real and outstanding, it is simply not ours to post.
        //
        // Tagged "Pending", NOT "In progress": on this page "In progress" already means
        // "this week is currently in range" (see the date-derived branch below), so
        // reusing it would make a consumable awaiting its material issue look identical
        // to a mid-week rental. The requirements call ends on exactly this point -
        // "do you want to link the in progress to the date range? ...in that case put it
        // into pending" - so the two states get two labels.
        if (s === 'IN_PROGRESS') {
          return { posted: false, reversed: false, postable: false,
                   isConsumablePending: true, countsAsIncurred: readyToPost(ws, we, direct),
                   tag: 'Pending' };
        }
        if (s === 'DRAFT') {
          // a REPOST draft (re-tiered correction, or a consumable qty adjustment)
          const postable = readyToPost(ws, we, direct);
          const inProgress = !postable && !!(ws && we && ws <= today && we >= today);
          return { posted: false, reversed: false, postable: postable, isRepost: true,
                   tag: postable ? 'Draft' : (inProgress ? 'In progress' : 'Future') };
        }
        // APPROVED (utilization) or any lifecycle echo (SUBMITTED/DEPLOYED/CLOSED/…)
        // -> derive from dates. Cost still real; just not a ledger state.
        const postable = readyToPost(ws, we, direct);
        const inProgress = !postable && !!(ws && we && ws <= today && we >= today);
        return { posted: false, reversed: false, postable: postable,
                 tag: postable ? 'Draft' : (inProgress ? 'In progress' : 'Future') };
      };

      // ── group the real view rows by equipment (preserve first-seen order) ──
      const groups = [];
      const byName = {};
      rows.forEach(function (r) {
        const name = r.equipmentName || 'Equipment';
        if (!byName[name]) {
          byName[name] = { key: 'g' + groups.length, name: name, rows: [] };
          groups.push(byName[name]);
        }
        byName[name].rows.push(r);
      });

      const rowsAll = [];
      let totalCost = 0, postedCost = 0, incurred = 0, netAdjustment = 0;
      let lastPostedDate = null;
      let anyReversed = false;

      groups.forEach(function (g, gi) {
        const weekRows = g.rows.slice().sort(function (a, b) {
          return String(a.weekStartDate || '').localeCompare(String(b.weekStartDate || ''));
        });

        // Classify ONCE, up front. The tag decides both what renders and what
        // rolls up, so the two can never disagree.
        const weekInfo = weekRows.map(function (r) {
          const ws = parseD(r.weekStartDate);
          const we = parseD(r.weekEndDate);
          const direct = r.lineType === 'DIRECT';
          return { r: r, ws: ws, we: we, direct: direct, st: classify(r.postStatus, ws, we, direct) };
        });

        // ── FUTURE weeks are dropped here, before any rollup ──────────────────
        // The view fans every ISO week of the line's span, including weeks the
        // calendar has not reached. Those are a projection, not a charge: nothing
        // can be posted, excluded or reversed on them. Dropping them at source
        // (rather than hiding them in visibleRows) keeps the equipment total, the
        // week count and the header TOTAL equal to the rows on screen — a display
        // filter would leave a group reading "5 weeks / $19,080" above two rows.
        //
        // A ledger-backed row is NEVER dropped, whatever the calendar says. A
        // POSTED/REVERSED week or a REPOST draft is a recorded fact, and hiding a
        // repost would silently unbalance netAdjustment (Σ drafts − Σ reversals).
        // POSTED/REVERSED/Pending never classify as Future anyway; the isRepost
        // guard is the one that actually bites, the rest are belt and braces.
        const kept = weekInfo.filter(function (x) {
          return x.st.tag !== 'Future'
              || x.st.posted || x.st.reversed || x.st.isRepost || x.st.isConsumablePending;
        });
        const shown = kept.map(function (x) { return x.r; });
        // Every week of this equipment is still ahead of us. Keep the equipment
        // row — it IS on the request and hiding it makes the request look emptier
        // than it is — but carry no cost and no children, so expanding it shows
        // nothing rather than a projection nobody can act on.
        const notStarted = !shown.length;

        // Descriptive fields (name, rate, period, unit count) come from the full
        // week set, so a not-yet-started line still shows what it WILL bill at.
        // Money comes only from `shown`, which is empty in that case.
        const basis = shown.length ? shown : weekRows;

        const isConsumable = basis.every(function (r) { return r.lineType === 'DIRECT'; });
        // group cost EXCLUDES reversed rows (they are superseded history, not a live charge)
        const groupCost = shown.reduce(function (s, r) {
          return s + (String(r.postStatus || '').toUpperCase() === 'REVERSED' ? 0 : Number(r.costAmount || 0));
        }, 0);
        const groupHours = shown.reduce(function (s, r) { return s + Number(r.totalHours || 0); }, 0);

        // ── miscellaneous charges for this equipment ─────────────────────────
        // Groups are keyed by equipment NAME, so two request lines carrying the
        // same equipment merge into one group. Collect from EVERY line in the
        // group, not just the head — otherwise the second line's charges vanish.
        // Built from `weekRows` (not `shown`) so a not-yet-started line still
        // finds its charges: a mobilisation fee can be booked before day one.
        const groupLineIds = {};
        weekRows.forEach(function (r) { if (r.requestLineId != null) groupLineIds[r.requestLineId] = 1; });
        const miscRows = Object.keys(groupLineIds).reduce(function (acc, lid) {
          return acc.concat(miscByLine[lid] || []);
        }, []);
        const miscTotal = miscRows.reduce(function (s, m) { return s + Number(m.rawCost || 0); }, 0);

        const head = basis[0] || {};
        const headRate = Number(head.applicableRate || 0);
        const headQty = Number(head.qty || 1);
        const headPeriod = isConsumable ? 'Not Applicable' : (head.ratePeriod || '—');
        const qtySuffix = headQty > 1 ? ('  × ' + headQty + ' units') : '';
        const headRateText = (headRate > 0 && !isConsumable)
          ? ('$' + headRate.toLocaleString() + '/day' + periodEquiv(headRate, headPeriod) + qtySuffix)
          : (headRate > 0 ? ('$' + headRate.toLocaleString() + qtySuffix) : '—');

        // group Days = sum of each non-reversed week's billed days (cost ÷ per-day rate).
        const groupDays = isConsumable ? 0 : shown.reduce(function (s, r) {
          if (String(r.postStatus || '').toUpperCase() === 'REVERSED') return s;
          const rt = Number(r.applicableRate || 0) * Number(r.qty || 1);
          return s + (rt > 0 ? Math.round(Number(r.costAmount || 0) / rt) : 0);
        }, 0);

        // Equipment total is rental weeks PLUS its charges — the same sum
        // restampGroups() recomputes after any edit, so the two never disagree.
        totalCost += groupCost + miscTotal;

        // ── reversal rollup: does this group hold a live reversal, and what is
        // the net $ change? tierChanged drives the "Reverse" control (offered only
        // for a POSTED week whose current re-tier PERIOD differs from what it was
        // posted at). All numbers are view/helper-sourced.
        let groupHasReversal = false;
        let groupTierChanged = false;
        let groupReversalGroupId = null;
        shown.forEach(function (r) {
          const s = String(r.postStatus || '').toUpperCase();
          const rt = retierFor(r);
          if (s === 'REVERSED') { groupHasReversal = true; anyReversed = true; }
          // NEVER offer a reversal for a DIRECT row. A one-time charge (consumable,
          // or a request-specific PR billed as PO cost x markup) always carries
          // period 'EACH', while any rental re-tier carries DAILY/WEEKLY/MONTHLY.
          // Comparing the two is meaningless and ALWAYS differs, so a posted
          // one-time charge looked like a tier change and fired a reversal that
          // credited the real charge and drafted the full rental price instead.
          // EQP_LINE_RETIER_WEEKS also excludes these lines now, so rt should be
          // absent anyway -- this is the second line of defence.
          if (r.lineType === 'DIRECT') return;
          if (s === 'POSTED' && rt && rt.period && String(r.ratePeriod || '').toUpperCase() !== rt.period.toUpperCase()) {
            groupTierChanged = true;
          }
        });

        // The authored expenditure type across every line in this group. One value
        // if they agree, '' + mixed flag if they do not. Built from weekRows rather
        // than `shown` so a not-yet-started line still contributes its authored
        // choice -- the type is set on the line, not earned by billing.
        const expSet = {};
        weekRows.forEach(function (r) {
          const v = r.lineExpenditureType;
          if (v) { expSet[String(v)] = 1; }
        });
        const expNames = Object.keys(expSet);
        const groupExpType  = expNames.length === 1 ? expNames[0] : '';
        const groupExpMixed = expNames.length > 1;

        // Is this equipment made up ENTIRELY of PR pass-through BASE rows?
        //
        // V313 gives a request-specific PR line two rows per requisition: a BASE row
        // (ROW_KEY `<lineId>:B<prId>:<week>`) carrying the PO's own cost, and a MARGIN
        // row (`:M<prId>:`) carrying our markup. The base row is Fusion's -- its cost
        // reaches PPM through the PO's projectDFF distribution, and EquipRite never
        // posts it. So the expenditure type that classifies that cost is the one on
        // the FUSION PO, chosen when the requisition was raised; EQR_REQUEST_LINE's
        // own value is never read for it.
        //
        // Offering "Set type" there is worse than useless: it looks like the way to
        // fix a misclassified rental (and they ARE misclassified today -- live PO
        // distributions carry 'Finishing Materials' for a dozer, 'Fee' and 'Hardware'
        // for a Bobcat), but the write lands on a column nothing in that cost path
        // reads. The user corrects the classification, sees the new value on screen,
        // and Fusion still books it under the wrong type.
        //
        // EVERY week row, not any: a group is keyed by equipment NAME, so it can span
        // a PR line and an ordinary rentable line carrying the same equipment. If any
        // part of the group still posts through us, the type is live and editable for
        // that part -- only lock the cell when nothing in it is ours to classify.
        // isBaseRow, deliberately NOT isPrRow: a MARGIN row's cost posts through us,
        // so its expenditure type is ours to author and must stay editable. Only the
        // PROJECT is locked on a margin row (see the week row's splitLocked below).
        const groupExpLocked = weekRows.length > 0 && weekRows.every(function (r) {
          return prPassThrough.isBaseRow(r.rowKey);
        });

        // ── project split rollup ──────────────────────────────────
        // A split is authored per WEEK, so the equipment row carries only a COUNT
        // of how many of its weeks are split -- naming projects here would be
        // wrong the moment two weeks are split differently, which is exactly the
        // case week grain exists to allow. The count is stamped below by
        // $page.functions.splitRollup once every week row exists; the group row
        // itself has no split to lock or edit.

        rowsAll.push({
          rowKey: g.key,
          kind: 'group',
          groupKey: g.key,
          // Filled in by $page.functions.splitRollup after the week rows exist.
          splitWeekCount: 0,
          splitWeekLabels: [],
          // True when every row under this equipment is a PR pass-through base row,
          // whose expenditure type lives on the Fusion PO and not on our line. Drives
          // the read-only rendering of the Expenditure Type cell (see above).
          expenditureTypeLocked: groupExpLocked,
          requestLineId: head.requestLineId || (retierFor(head) && retierFor(head).lineId) || null,
          // EVERY line under this equipment, not just the head. Groups are keyed by
          // equipment NAME, so two request lines carrying the same equipment merge
          // into one row -- the same reason the misc collector above walks
          // groupLineIds rather than reading head. The expenditure-type save patches
          // all of them, or the promise this row makes on screen ("this equipment
          // posts as X") would be true of only part of its cost.
          requestLineIds: Object.keys(groupLineIds).map(Number),
          // The equipment's PPM expenditure type -- the AUTHORED value
          // (LINE_EXPENDITURE_TYPE), never the frozen one.
          //
          // Read off EVERY row of the group, not off `head`. Two reasons, both
          // verified against live data:
          //
          //  1. `head` is basis[0] and weekRows is sorted ASCENDING, so head is the
          //     EARLIEST week -- the one most likely already POSTED. Reading the
          //     effective column there would pin the equipment row to week 1's
          //     FROZEN value forever. Live proof: line 1000001918 is authored
          //     'Supplies' while its posted weeks read 'Equipment Rental',
          //     'Equipment Freight' and 'Equipment'.
          //  2. A group is keyed by equipment NAME and can span two request lines.
          //     If they disagree the row must say so rather than silently showing
          //     one of them -- the drawer patches every line, so opening it is the
          //     fix path.
          expenditureType:      groupExpType,
          expenditureTypeMixed: groupExpMixed,
          expanded: gi === 0,
          label: g.name,
          weekCount: shown.length,
          // "Not started" (no billable weeks yet) suppresses the cost figure — but
          // only while there is genuinely no money. A charge booked before day one
          // is real, so it re-arms the cost cell via the `cost > 0` test.
          notStarted: notStarted,
          rateType: '',
          rateText: headRateText,
          ratePeriod: headPeriod,
          whenTag: '',
          hours: groupHours,
          days: groupDays,
          cost: groupCost + miscTotal,
          hasReversal: groupHasReversal,
          tierChanged: groupTierChanged
        });

        kept.forEach(function (x, wi) {
          const r  = x.r;
          const ws = x.ws;
          const we = x.we;
          const st = x.st;
          const direct = x.direct;
          const cost = Number(r.costAmount || 0);
          const rateType = direct ? '' : 'USAGE';
          const rate = Number(r.applicableRate || 0);
          const wkQty = Number(r.qty || 1);
          const wkQtySuffix = wkQty > 1 ? ('  × ' + wkQty + ' units') : '';
          const ratePeriod = direct ? 'Not Applicable' : (r.ratePeriod || '—');
          const rateText = (rate > 0 && !direct)
            ? ('$' + rate.toLocaleString() + '/day' + periodEquiv(rate, ratePeriod) + wkQtySuffix)
            : (rate > 0 ? ('$' + rate.toLocaleString() + wkQtySuffix) : '—');
          const wkRateTot = rate * wkQty;
          const wkDays = (direct || wkRateTot <= 0) ? 0 : Math.round(cost / wkRateTot);

          // header money buckets (reversed weeks contribute to neither posted nor incurred;
          // their net effect is captured via netAdjustment below)
          if (st.posted) { postedCost += cost; if (we && (!lastPostedDate || we > lastPostedDate)) lastPostedDate = we; }
          else if ((st.postable || st.countsAsIncurred) && !st.reversed) { incurred += cost; }

          // net adjustment = Σ(repost drafts) − Σ(reversed originals) for the request.
          // Both are view-sourced; JS only sums/subtracts. Negative = credit.
          const s = String(r.postStatus || '').toUpperCase();
          if (s === 'REVERSED') netAdjustment -= cost;
          if (s === 'DRAFT' && st.isRepost) netAdjustment += cost;

          const rt = retierFor(r);

          // PR pass-through facts for this week, resolved ONCE. The lookup key was
          // being rebuilt five times per row, which is how the two halves of a
          // predicate drift apart.
          const wkLineKey  = String(Number(r.requestLineId));
          const wkIsPrLine = !!prLineIds[wkLineKey];
          // Is this DIRECT row our MARGIN on a purchase requisition? Needed by both
          // the label and its tooltip.
          const prMarginRow = prPassThrough.isPrMarginRow(
            {
              rowKey: r.rowKey,
              isPrLine: wkIsPrLine,
              applicableRate: r.applicableRate,
              postStatus: r.postStatus
            },
            prPoPrices[wkLineKey]
          );
          // One object, built once, for all three split-lock reads below -- so
          // splitLocked, its reason and the badge flag cannot disagree.
          const splitLockRow = {
            rowKey: r.rowKey, posted: st.posted, reversed: st.reversed,
            isPrLine: wkIsPrLine
          };

          // ── blackout lookups for this week ────────────────────────────────
          const wkLineId = r.requestLineId || (rt && rt.lineId) || null;
          const wkISOKey = String(r.weekStartDate || '').slice(0, 10);
          const bw = (wkLineId != null && wkISOKey) ? blackoutByKey[wkLineId + '|' + wkISOKey] : null;
          // The view is SPARSE — a clean week returns no row at all — so absence must
          // mean "no exceptions", never "not applicable". Applicability therefore falls
          // back to the row's own LINE_TYPE, which is the same rule the view encodes.
          const bwApplicability = bw ? bw.applicability : (direct ? 'NOT_APPLICABLE' : 'EDITABLE');
          const bwApplicable = bwApplicability !== 'NOT_APPLICABLE';
          // Per-line span, added to the detail view by V273. Falls back to the
          // request-level window only if the columns are missing.
          const lineSpanStart = String(r.spanStart || spanStartISO || '').slice(0, 10) || null;
          const lineSpanEnd   = String(r.spanEnd   || spanEndISO   || '').slice(0, 10) || null;

          rowsAll.push({
            rowKey: r.rowKey || (g.key + '_w' + wi),
            kind: 'week',
            groupKey: g.key,
            requestLineId: r.requestLineId || (rt && rt.lineId) || null,
            // The AUTHORED expenditure type of this week's own request line, carried
            // so postSelectedChain can freeze the right value without going via the
            // group row -- a group spans equipment NAME and can cover two lines with
            // different types. NOT r.expenditureType: that is the EFFECTIVE value
            // (frozen wins), which on an already-posted week is what was sent last
            // time, and freezing that forward would propagate a stale classification.
            lineExpenditureType: r.lineExpenditureType || '',
            // THIS line's own split, for the same reason lineExpenditureType is
            // carried per week: postSelectedChain iterates week rows, and a group
            // spanning two request lines can have two different splits, so reading
            // the group row could post this week against the other line's projects.
            // THIS week's own split. Keyed by line + week because that is the
            // grain it is authored at, and read here rather than off the group
            // row because postSelectedChain iterates week rows.
            splits: splitsByLineWeek[splitKey(r.requestLineId, r.weekStartDate)] || [],
            splitCount: (splitsByLineWeek[splitKey(r.requestLineId, r.weekStartDate)] || []).length,
            splitPcts: (splitsByLineWeek[splitKey(r.requestLineId, r.weekStartDate)] || [])
              .map(function (x) { return Number(x.splitPct); }),
            // A posted week keeps what it was sent with; a PR pass-through row --
            // BASE *or* MARGIN -- takes its project from the Fusion PO. Either way
            // the split is not editable here, and the row renders a read-only badge.
            //
            // MARGIN matters and used to be missed: the lock tested only `:B`, so
            // the margin row on every PR line offered "Split cost" (live: 9 rows
            // over 8 lines). Splitting it would move only the markup -- 10% of the
            // money at the live margin -- and leave the base whole on the original
            // project, while two requisitions on one line share a (line, week) key
            // and would collide on REVERSAL_REF. See prPassThrough.isSplitLocked
            // for the full argument; the expenditure-type lock above stays `:B`
            // only, because a margin row's TYPE genuinely is ours to author.
            // This week's line carries a purchase requisition. The LIVE PR handle
            // -- ROW_KEY is not projected by the detail DTO, so the `:B`/`:M`
            // predicates match nothing in the browser. Carried on the row itself
            // so openSplitDrawerChain and postSelectedChain, which both read rows
            // out of rowsAll rather than re-fetching, get the same answer.
            isPrLine: wkIsPrLine,
            splitLocked: prPassThrough.isSplitLocked(splitLockRow),
            splitLockReason: prPassThrough.splitLockReason(splitLockRow),
            // WHY it is locked, because the two reasons render differently.
            // A PR row shows a quiet read-only hint naming the purchase order --
            // the same courtesy the expenditure-type cell already extends, and
            // necessary here because the identical equipment one row up may well
            // BE splittable, so a control that simply vanishes reads as a bug.
            // A merely POSTED row stays silent: it has no split to display and
            // badging every posted week would be pure noise.
            splitLockedByPr: prPassThrough.isPrLineRow(splitLockRow),
            weekStartISO: r.weekStartDate ? String(r.weekStartDate).slice(0, 10) : '',
            // "Margin", not "One-time", when this DIRECT row is our markup on a
            // purchase requisition rather than the PO's own base cost. Both rows
            // of a PR line surface as DIRECT (Branch 4) and used to read
            // "One-time" alike, which said nothing about which was which -- the
            // $12 order and the $1.20 markup on it looked like two charges.
            //
            // isPrMarginRow is a HEURISTIC and the only one on this page: ROW_KEY
            // is the authoritative discriminator and the detail DTO does not send
            // it. It is 18/18 against ROW_KEY on live data and degrades to
            // "One-time" rather than mislabelling a base row. See the module.
            label: direct
              ? ((prMarginRow ? 'Margin' : 'One-time') + (wkQty > 1 ? (' · qty ' + wkQty) : ''))
              : ((ws && we) ? (fmt(ws) + ' – ' + fmt(we)) : (r.weekStartDate || '—')),
            // Hover text for the label. Empty on every ordinary row, so no tooltip
            // appears where there is nothing to explain.
            labelTitle: prMarginRow
              ? ('EquipRite markup on the purchase order. The order carries its own '
                 + 'cost on the other row for this equipment, and that cost reaches the '
                 + 'project through the PO distribution rather than through EquipRite.')
              : '',
            rateType: rateType,
            isException: false,
            isRepost: !!st.isRepost,
            direct: !!direct,   // DIRECT/consumable line — posts as ONE qty×price entry, not per-week
            rateText: rateText,
            ratePeriod: ratePeriod,
            // PR rows have no rental days of their own (they post once as
            // qty x price), but the INTERIM day scaling above gives them a real
            // day count and the column is where it belongs -- otherwise the row
            // shows a per-day rate and an extended cost with nothing between them.
            days: r.prDays ? Number(r.prDays) : wkDays,
            // >0 only on a PR row the INTERIM day scaling touched. The DAYS cell
            // keys on this rather than on `days` alone, so an ordinary DIRECT or
            // consumable row -- which has no rental days and must keep its dash --
            // is not caught by the same test.
            prDays: r.prDays ? Number(r.prDays) : 0,
            // Unit count for the line. Carried so posting can record a quantity for
            // a DIRECT/consumable row, whose "duration" is an item count rather than
            // a number of days — postSelectedChain picks between the two.
            qty: wkQty,
            postable: !!st.postable,
            posted: !!st.posted,
            reversed: !!st.reversed,
            inProgress: st.tag === 'In progress',
            // consumable awaiting its Fusion material issue - styled like an
            // in-progress week (amber = provisional, not postable), but labelled
            // "Pending" so it is not confused with a mid-week rental
            pending: !!st.isConsumablePending,
            selected: false,
            whenTag: st.tag,
            hours: Number(r.totalHours || 0),
            cost: cost,
            // frozen re-tier (for the Reverse action; anti-V190 — copied from the helper view)
            retierCost: rt ? rt.cost : null,
            retierRate: rt ? rt.rate : null,
            retierPeriod: rt ? rt.period : null,
            // the frozen posted rate/period (from this row when it is the POSTED original)
            postedRate: rate,
            postedPeriod: (r.ratePeriod || ''),
            // ── blackout day drill-down ──────────────────────────────────────
            // Third level: equipment → week → day. Collapsed by default so the
            // page carries no extra weight until someone opens a week.
            // applicability is decided by the view, not inferred here: DIRECT and
            // consumable lines post once as qty × price and have no days to exclude,
            // and PR lines surface as DIRECT too (Branch 4), which is not obvious
            // from the page's own data.
            weekExpanded: false,
            canBlackout: bwApplicable,
            blackoutDays: bwApplicable ? (bw ? bw.days : 0) : 0
          });

          // Day rows for this week. Built up front rather than on demand so the
          // expand toggle is a pure visibility filter, matching how the group
          // level already works.
          if (bwApplicable && ws) {
            for (let dOff = 0; dOff < 7; dOff++) {
              const dDate = new Date(ws.getTime());
              dDate.setUTCDate(dDate.getUTCDate() + dOff);
              const dISO = dDate.toISOString().slice(0, 10);
              // Per-LINE span, straight off the detail row (V273). Previously this
              // used the request's planned window, which is wrong for any line whose
              // own dates are narrower than its request's.
              const inSpan = (!lineSpanStart || dISO >= lineSpanStart) &&
                             (!lineSpanEnd   || dISO <= lineSpanEnd);
              // The view already split marked days into effective vs ignored using
              // the same clamp the engine applies, so the page never re-derives it.
              const marked  = bw ? bw.dates.indexOf(dISO)   >= 0 : false;
              const ignored = bw ? bw.ignored.indexOf(dISO) >= 0 : false;
              // A calendar week straddles the rental window at both ends: a 2-day
              // rental inside a 7-day week would otherwise render five "outside
              // window" rows to reach two real ones. Those days bill nothing and
              // cannot be excluded, so drop them entirely. The one exception is a
              // day already marked out there — keep it visible, or an exclusion
              // recorded on the wrong date becomes impossible to find and undo.
              if (!inSpan && !ignored) continue;
              rowsAll.push({
                rowKey: (r.rowKey || (g.key + '_w' + wi)) + '_d' + dOff,
                kind: 'day',
                groupKey: g.key,
                weekKey: r.rowKey || (g.key + '_w' + wi),
                requestLineId: wkLineId,
                dayISO: dISO,
                label: DAY_NAMES[dDate.getUTCDay()] + ' ' + fmt(dDate),
                blackout: marked || ignored,
                // Marked but outside the line's span: recorded, subtracting nothing.
                inert: ignored,
                inSpan: inSpan,
                // A posted week is served from the EQR_POSTED_WEEK ledger and replays
                // stored amounts verbatim, so marking a day would not move its cost.
                // Correcting a posted week is the reverse → credit → repost path.
                // POSTED comes from the view; st.posted/st.reversed are belt and braces.
                locked: bwApplicability === 'POSTED' || !!st.posted || !!st.reversed,
                // What this single day contributes at the week's rate. Zero once
                // excluded — that is the point of the control.
                dayCost: (marked || ignored || !inSpan) ? 0
                       : (wkDays > 0 ? Math.round((cost / wkDays) * 100) / 100 : 0)
              });
            }
          }
        });

        // ── misc charges: one collapsible sub-group, then a row per charge ────
        // Same shape as the week → Days drill-down, so charges never intermix
        // with the weeks. Collapsed by default; the header carries the count and
        // the total so an unopened group still tells the truth.
        if (miscRows.length) {
          const miscGroupKey = g.key + '_miscgrp';
          rowsAll.push({
            rowKey: miscGroupKey,
            kind: 'miscGroup',
            groupKey: g.key,
            label: 'Misc charges',
            miscCount: miscRows.length,
            miscExpanded: false,
            rateType: '',
            rateText: '',
            ratePeriod: '',
            whenTag: '',
            hours: 0,
            days: 0,
            cost: Math.round(miscTotal * 100) / 100
          });

          miscRows.forEach(function (m) {
            const mCost   = Number(m.rawCost || 0);
            const mQty    = Number(m.quantity || 1);
            const mStatus = String(m.status || 'DRAFT').toUpperCase();
            const mPosted = mStatus === 'POSTED';
            const mDate   = String(m.expenditureItemDate || '').slice(0, 10);
            // A charge has no rate. Echoing the amount into the Applicable Rate column
            // just printed the Cost column twice. A per-unit figure is the only thing
            // that column can honestly say here, and only when there IS more than one.
            const mUnit   = mQty > 1 ? Math.round((mCost / mQty) * 100) / 100 : null;

            // A posted charge is money already claimed; a draft is money incurred
            // and awaiting the post. Same split the week rows use.
            if (mPosted) {
              postedCost += mCost;
              const pd = parseD(mDate);
              if (pd && (!lastPostedDate || pd > lastPostedDate)) lastPostedDate = pd;
            } else {
              incurred += mCost;
            }

            rowsAll.push({
              rowKey: 'misc_' + m.eqrLineMiscTxnId,
              kind: 'misc',
              groupKey: g.key,
              miscGroupKey: miscGroupKey,
              // the DB id — every mutating call (delete, post) keys off this, so a
              // row without one is not actionable
              miscId: m.eqrLineMiscTxnId,
              requestLineId: m.requestLineId,

              // captured values, straight from the row. These are what the drawer
              // wrote and what the Fusion payload will read when it is wired.
              expenditureType: m.expenditureType || '',
              expenditureOrg:  m.expenditureOrg  || '',
              expItemDate:     mDate,
              quantity:        Number(m.quantity || 1),
              rawCost:         mCost,
              currency:        m.currencyCode || 'USD',
              comments:        m.comments || '',

              label:      $page.functions.miscLabel(m),
              rateType:   '',
              rateText:   mUnit != null ? ('$' + mUnit.toLocaleString() + ' each') : '—',
              ratePeriod: '—',
              days:       0,
              hours:      0,
              cost:       mCost,
              whenTag:    mPosted ? 'Posted' : 'Draft',
              status:     mPosted ? 'POSTED' : 'DRAFT',
              postable:   !mPosted,
              posted:     mPosted,
              reversed:   false,
              selected:   false
            });
          });
        }
      });

      // Header dates = the REQUEST's planned start/end (passed from the list).
      const plannedStart = parseD($page.variables.plannedStartDate);
      const plannedEndHdr = parseD($page.variables.plannedEndDate);
      const allStarts = rows.map(function (r) { return parseD(r.weekStartDate); }).filter(Boolean);
      const allEnds   = rows.map(function (r) { return parseD(r.weekEndDate); }).filter(Boolean);
      const spanStart = plannedStart || (allStarts.length ? new Date(Math.min.apply(null, allStarts.map(function (d) { return d.getTime(); }))) : null);
      const spanEnd   = plannedEndHdr || (allEnds.length   ? new Date(Math.max.apply(null, allEnds.map(function (d) { return d.getTime(); })))   : null);

      // stamp each group row with per-equipment selection state (drives its
      // "Select all / Clear" link). hasPostable = >=1 past, unposted, non-reversed week.
      const rowsAnnotated = rowsAll.map(function (r) {
        if (r.kind !== 'group') return r;
        const wk = rowsAll.filter(function (x) {
          return x.kind === 'week' && x.groupKey === r.groupKey && x.postable && !x.posted && !x.reversed;
        });
        const hasP = wk.length > 0;
        return Object.assign({}, r, { hasPostable: hasP, allSelected: hasP && wk.every(function (x) { return x.selected; }) });
      });

      $page.variables.startDate      = fmt(spanStart);
      $page.variables.endDate        = fmt(spanEnd);
      // Stamp each equipment's "N weeks split" rollup now that every week row
      // exists. Splits are authored per week, so this count is the only thing an
      // equipment row can honestly say about them -- and it earns its place
      // because an equipment collapses, which would otherwise hide the fact that
      // some of its weeks post somewhere else. Shared with saveSplitChain and
      // clearSplitChain so the three can never disagree.
      // Everything derived from splits, in one call: the per-slice rows, each
      // equipment's "N weeks split" rollup, and the Project/Task sort key.
      // Shared with saveSplitChain and clearSplitChain so the three cannot
      // disagree about the row tree.
      const rowsWithSplitRollup = $page.functions.applySplitDerived(rowsAnnotated, {
        projectNumber: $page.variables.ppmProjectNumber,
        projectName:   $page.variables.projectName,
        taskNumber:    $page.variables.ppmTaskNumber,
        taskName:      $page.variables.taskName,
      });

      $page.variables.rowsAll        = rowsWithSplitRollup;
      $page.variables.totalCost      = Math.round(totalCost * 100) / 100;
      $page.variables.postedCost     = Math.round(postedCost * 100) / 100;
      $page.variables.incurredToDate = Math.round(incurred * 100) / 100;
      $page.variables.netAdjustment  = Math.round(netAdjustment * 100) / 100;
      $page.variables.lastPostedLabel = lastPostedDate ? fmt(lastPostedDate) : '—';
      $page.variables.headerStatus   = (rows[0] && rows[0].postStatus) || 'APPROVED';
      $page.variables.selectedWeekKeys = [];
      // Early-return header note now driven by the presence of a live reversal.
      $page.variables.isEarlyReturn   = anyReversed;
      $page.variables.earlyReturnDate = '';

      // group → week (+ misc) → day. Shared with every mutating chain so a new
      // row kind can never be visible in one place and invisible in another.
      $page.variables.rowsVisible = $page.functions.visibleRows(rowsWithSplitRollup);
    }
  }

  return vbEnterChain;
});
