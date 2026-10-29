define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/requestDetailLines',
], (ActionChain, Actions, _au, rdl) => {
  'use strict';

  // ── Phase-1 hardcoded constants ──────────────────────────────────────────
  // These are pod-verified defaults for the pass-through pilot. They are
  // hardcoded deliberately (see the PR integration audit): person mapping
  // (EQR_USER -> Fusion PersonId) and BU/org resolution from EQR_BU_ORG_MAPPING
  // are phase-2 items. When productionised, source RequisitioningBUId from the
  // request's BUSINESS_UNIT_ID, and Preparer/Requester from the logged-in user.
  const PR_DEFAULTS = {
    RequisitioningBUId:          300000046987012, // US1 Business Unit
    PreparerId:                  300000047625111, // John Dunbar (HCM PersonId)
    RequesterId:                 300000047625111,
    ExternallyManagedFlag:       false,           // enters Fusion approval chain
    InterfaceSourceCode:         'EQUIPRITE',
    CurrencyCode:                'USD',
    DestinationOrganizationId:   300000047274444, // Seattle 001 (a mapped yard org)
    // Deliver-to location is chosen in the dialog; if the picker yielded an
    // inventory-org id rather than a location id, fall back to this proven one.
    FallbackDeliverToLocationId: 300000047013200  // Seattle USLoc004
  };

  // ── Double-submit latch (one click = one requisition) ────────────────────
  // Keyed by request id, module scope, so it survives across chain instances
  // (VBCS builds a NEW instance per invocation, so an instance field is useless
  // here). Checked and set in the same synchronous turn as the click, which is
  // the only place the race can be closed: the footer button's :disabled binding
  // repaints on a microtask, so a fast double-click - or a held Enter on the
  // focused button - can dispatch two oj-action events before the DOM disables.
  // Released in a `finally` in run() so an early return or a throw can never
  // leave the drawer wedged (Cancel is disabled on prSubmitting too).
  const inFlight = Object.create(null);

  async function safeNotify(context, payload) {
    try {
      await Actions.fireNotificationEvent(context, payload);
    } catch (e) {
      console.warn('[CreatePurchaseRequisitionChain] toast failed — continuing:', e);
    }
  }

  const toIsoDate = (d) => {
    if (!d) return null;
    // line_end_date is already a yyyy-mm-dd (or ISO) string; keep the date part.
    const s = String(d);
    return s.length >= 10 ? s.slice(0, 10) : s;
  };

  // Today as yyyy-mm-dd in UTC. Fusion validates RequestedDeliveryDate against
  // its SERVER date, which is UTC on this pod — NOT the browser's local date.
  // Using local time here is a bug: in the evening, once local time is still
  // "today" but UTC has already rolled to "tomorrow", a local-today floor is one
  // day behind Fusion's today and the PR is rejected with POR-2010567 ("delivery
  // date must be on or after today"). Verified live: at PC-local 2026-07-23 21:11
  // (UTC 2026-07-24 02:11) Fusion rejected 2026-07-23 and accepted 2026-07-24.
  // Compute the floor in UTC so it always matches Fusion's notion of "today".
  const todayIso = () => {
    const n = new Date();
    const mm = String(n.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(n.getUTCDate()).padStart(2, '0');
    return n.getUTCFullYear() + '-' + mm + '-' + dd;
  };

  // Requested delivery date for the PR: the rental START date, but never in the
  // past — Fusion rejects a past delivery date (POR-2010567). Older requests
  // whose start date has already passed fall back to today.
  const deliveryDateIso = (startDate, endDate) => {
    const start = toIsoDate(startDate || endDate);
    const today = todayIso();
    if (!start) return today;
    return start < today ? today : start;
  };

  /**
   * Submit handler for the Purchase Requisition dialog. Builds ONE Fusion
   * purchase requisition containing all dialog lines and POSTs it directly
   * via the VBCS -> backends/fusion proxy (no OIC in phase 1). On success,
   * toasts the returned Requisition number and refreshes the page.
   */
  class CreatePurchaseRequisitionChain extends ActionChain {
    /**
     * Guard + dispatch. The real work is submitPr() below.
     *
     * WHY THIS WRAPPER EXISTS: this chain used to raise TWO Fusion requisitions
     * from one user. `prSubmitting` (which drives both the footer button's
     * :disabled and the drawer's progress bar) was set only just before the
     * purchaseRequisitions POST - i.e. AFTER up to two network round-trips (the
     * requisitionOneTimeLocations POST for a "Request Site" address, and one
     * projects/{id} owning-org lookup per distinct project). For that whole
     * window the button stayed enabled and NOTHING on screen said "working", so
     * a second click ran a second chain end-to-end and Fusion created a second
     * requisition (plus a duplicate one-time location). Two layers now:
     *   1. prSubmitting is set SYNCHRONOUSLY here, before the first await, so
     *      the button greys out and the progress bar appears on click #1.
     *   2. `inFlight` closes the microtask-repaint gap that (1) alone leaves.
     */
    async run(context) {
      const { $page } = context;
      const requestId = $page.variables.requestId;
      const lines     = $page.variables.prLines || [];

      if (!lines.length) {
        await safeNotify(context, {
          summary: 'No Lines', message: 'There are no lines to requisition.',
          type: 'error', displayMode: 'persist'
        });
        return;
      }

      const flightKey = String(requestId);
      if (inFlight[flightKey]) {
        // A submit for this request is already running. Swallow the click
        // silently - the user is looking at a disabled button and a progress
        // bar, so a toast here would only read as an error for a no-op.
        console.warn('[CreatePurchaseRequisitionChain] submit already in flight for request',
          flightKey, '- ignoring duplicate click.');
        return;
      }
      inFlight[flightKey] = true;
      $page.variables.prSubmitting = true;

      try {
        await this.submitPr(context);
      } catch (e) {
        // submitPr handles its own expected failures (Fusion 4xx, network) and
        // clears prSubmitting itself. This is the backstop for an UNEXPECTED
        // throw: without it the flag would stay true and the drawer would be
        // stuck with both buttons disabled and no way out but a page reload.
        console.error('[CreatePurchaseRequisitionChain] unexpected failure:', e);
        $page.variables.prSubmitting = false;
        await safeNotify(context, {
          summary: 'Requisition Failed',
          message: 'Unexpected error raising the requisition. Check Fusion for a '
            + 'requisition against this request before retrying, so you do not '
            + 'raise it twice.',
          type: 'error', displayMode: 'persist'
        });
      } finally {
        delete inFlight[flightKey];
      }
    }

    async submitPr(context) {
      const { $page } = context;
      const requestId     = $page.variables.requestId;
      const requestNumber = $page.variables.requestNumber || requestId;
      const header        = $page.variables.prHeader || {};
      const lines         = $page.variables.prLines || [];

      if (!lines.length) {
        await safeNotify(context, {
          summary: 'No Lines', message: 'There are no lines to requisition.',
          type: 'error', displayMode: 'persist'
        });
        return;
      }

      // Deliver-to location: the dialog picker lists inventory orgs, whose id
      // is not guaranteed to be a valid DeliverToLocationId. For the pilot we
      // send the proven Seattle location; the chosen value is captured for
      // phase-2 mapping. (Org/location are independent for EXPENSE lines.)
      const deliverToLocationId = PR_DEFAULTS.FallbackDeliverToLocationId;

      // Deliver-to Location Type (Fusion's Internal vs One Time toggle):
      //   INTERNAL  -> deliver to the registered deliverToLocationId (below).
      //   ONE_TIME  -> POST the structured address to requisitionOneTimeLocations
      //                to get a LocationId, then set it on each line as
      //                DeliverToCustomerLocationId with DeliverToLocationId null —
      //                the SAME flow Fusion's iProcurement Delivery panel uses
      //                (verified live: 201 create, id accepted inline on the PR
      //                POST, Fusion auto-sets OneTimeLocationFlag=true).
      // Default INTERNAL when the type is absent (keeps prior behavior). If a
      // ONE_TIME create fails we do NOT block the PR; we fall back to the
      // registered location and warn.
      const addr = $page.variables.prDeliveryAddress || {};
      const isOneTime = header.deliverToLocationType === 'ONE_TIME';
      const hasOneTimeAddress = isOneTime && !!(addr.address1 && String(addr.address1).trim());
      let oneTimeLocationId = null;
      if (hasOneTimeAddress) {
        try {
          const otlResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/postFscmRestApiResources11_13_18_05RequisitionOneTimeLocations',
            body: {
              Address1:    String(addr.address1).trim(),
              Address2:    addr.address2 ? String(addr.address2).trim() : null,
              City:        addr.city ? String(addr.city).trim() : null,
              State:       addr.state ? String(addr.state).trim() : null,
              PostalCode:  addr.postalCode ? String(addr.postalCode).trim() : null,
              County:      addr.county ? String(addr.county).trim() : null,
              CountryCode: addr.countryCode || 'US'
            }
          });
          if (otlResp && otlResp.ok && otlResp.body && otlResp.body.LocationId != null) {
            oneTimeLocationId = otlResp.body.LocationId;
          } else {
            console.warn('[CreatePurchaseRequisitionChain] one-time location create returned no LocationId; using registered location.', otlResp && otlResp.body);
          }
        } catch (e) {
          console.warn('[CreatePurchaseRequisitionChain] one-time location create failed; using registered location.', e);
        }
      }

      // Is this requisition specific to this equipment request? (post-demo,
      // Sandeep) This single switch forks the cost model:
      //   ON  -> attach the request's project + task so Fusion PO accounting
      //          posts the cost to the project natively. Post-cost SKIPS it.
      //   OFF -> an independent rental: send NO project distribution at all,
      //          even if the request has a project. EquipRite costs it later in
      //          post-cost, reading the eventual PO price and applying BU config.
      // Default ON when the flag is absent (keeps prior behavior for safety).
      const isRequestSpecific = header.isRequestSpecific !== false;

      // Customer-sourced request? A customer PR is raised with our supplier and
      // has NO project applicability, so it must NEVER carry a project
      // distribution — regardless of the request-specific switch or any stray
      // projectRefId left on a line. This is the authoritative gate (the drawer
      // hiding the project fields is cosmetic; this is what decides the payload).
      const isCustomer = $page.variables.isCustomerRequest === true;
      // Project fields apply ONLY to a request-specific, NON-customer request.
      const useProjectFields = isRequestSpecific && !isCustomer;

      // Is quoting enabled for THIS request's origin? Resolved once per page load
      // in vbEnterChain via $application.functions.isQuotingAllowed() (the
      // app-flow resolver owns the NONE/PROJECTS/CUSTOMER/BOTH matrix) and cached
      // on the page. Used ONLY to decide whether the line's UNDER_PROCUREMENT flip
      // happens now or is deferred to quote-accept — see the long note at the flip
      // itself. Not an authorisation check: the PR itself is unaffected.
      const quotingEnabledForOrigin = $page.variables.quotingAllowed === true;

      // Build the PPM project distribution for a line, or undefined when none
      // should be attached (then the PR line is created with default
      // distributions). Verified against the pod: context "POR_Requisition"
      // with the _* segment attributes; _PROJECT_ID/_TASK_ID are Fusion IDs
      // (not codes) and come straight from the request.
      //
      // GATE: attach a distribution only for request-specific requisitions.
      // This is the authoritative check — the switch may have been toggled off
      // after the dialog prefilled project/task onto the line, so we branch on
      // the header flag here, NOT merely on the presence of projectRefId.
      //
      // Resolve each distinct project's OwningOrganizationId (a project
      // expenditure org) for the projectDFF _ORGANIZATION_ID. Rental costs have no
      // person for Fusion to derive the org from, so we supply it. Best-effort: a
      // failed lookup leaves the org off that line (Fusion falls back to its own
      // derivation) rather than blocking the PR. Only needed for request-specific.
      const orgByProject = {};
      if (useProjectFields) {
        const projectIds = Array.from(new Set(
          lines.map(l => l.projectRefId).filter(p => p != null).map(String)
        ));
        await Promise.all(projectIds.map(async (pid) => {
          try {
            const projResp = await Actions.callRest(context, {
              endpoint:  'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsById',
              uriParams: { ProjectId: String(pid) }
            });
            const owningOrg = projResp && projResp.ok && projResp.body
              ? projResp.body.OwningOrganizationId : null;
            if (owningOrg != null) orgByProject[pid] = owningOrg;
          } catch (e) {
            console.warn('[CreatePurchaseRequisitionChain] owning-org lookup failed for project', pid, e);
          }
        }));
      }

      // projectDFF segments (context POR_Requisition):
      //   _PROJECT_ID / _TASK_ID  — Fusion ids from the request (always).
      //   _EXPENDITURE_ITEM_DATE  — line end date.
      //   _EXPENDITURE_TYPE_ID    — the user's per-line choice (l.expenditureTypeId),
      //                             from the expenditureTypes LOV. Only attached when
      //                             chosen. The demo project has no transaction
      //                             controls so any active type is chargeable; for
      //                             projects WITH inclusive controls a valid type
      //                             must be picked (production: project-scoped LOV).
      //   _ORGANIZATION_ID        — the project's OwningOrganizationId (a project
      //                             expenditure org), resolved once per project below
      //                             (orgByProject). Rental cost has no person, so we
      //                             must supply the org rather than let Fusion derive.
      const buildDistributions = (l) => {
        // EVERY requisition line needs at least ONE distribution, or Fusion
        // rejects the SUBMIT with POR-2010843 ("You can't call this operation for
        // a requisition without any distributions") — even though a
        // distribution-less line CREATES fine as a Draft. Verified live on the
        // pod: a bare distribution { DistributionNumber, Quantity } with no
        // projectDFF submits successfully (result SUCCESS) — Fusion derives the
        // expense charge account from the EXPENSE destination org at submit.
        //
        // So the fork is about the DISTRIBUTION CONTENT, not its presence:
        //   • Project, request-specific  -> distribution WITH a projectDFF
        //     (project/task/exp-type/exp-org) so cost posts to the project.
        //   • Customer PR, or a non-request-specific project PR -> a BARE
        //     distribution (no projectDFF): no project applies, but the line is
        //     still a real, submittable requisition to our supplier.
        const dist = { DistributionNumber: 1, Quantity: Number(l.quantity) || 1 };

        // Attach a project distribution ONLY for a request-specific PROJECT PR
        // that actually carries a project. Customer PRs and switch-off PRs skip
        // this and keep the bare distribution.
        if (useProjectFields && l.projectRefId != null) {
          const dff = { __FLEX_Context: 'POR_Requisition', _PROJECT_ID: Number(l.projectRefId) };
          if (l.taskId != null) dff._TASK_ID = Number(l.taskId);
          dff._EXPENDITURE_ITEM_DATE = toIsoDate(l.lineEndDate);
          if (l.expenditureTypeId != null) dff._EXPENDITURE_TYPE_ID = Number(l.expenditureTypeId);
          // Prefer the org already resolved + shown on the line (dialog open); fall
          // back to the per-project lookup below if the line didn't carry one.
          const orgId = (l.expenditureOrgId != null) ? l.expenditureOrgId : orgByProject[String(l.projectRefId)];
          if (orgId != null) dff._ORGANIZATION_ID = Number(orgId);
          dist.projectDFF = [dff];
        }

        return [dist];
      };

      // Assemble the Fusion payload — one header, N lines.
      const body = {
        RequisitioningBUId:    PR_DEFAULTS.RequisitioningBUId,
        PreparerId:            PR_DEFAULTS.PreparerId,
        ExternallyManagedFlag: PR_DEFAULTS.ExternallyManagedFlag,
        InterfaceSourceCode:   PR_DEFAULTS.InterfaceSourceCode,
        Description:           header.description || ('Third-party rental - ' + requestNumber),
        lines: lines.map((l, idx) => {
          const line = {
            LineNumber:                idx + 1,
            // Code, not label — "Rate Based Services" is coded
            // "ORA_Rate Based Services" on this pod (purchasingLineTypes).
            LineTypeCode:              header.lineTypeCode || 'ORA_Rate Based Services',
            CategoryName:              header.categoryName || 'Capital Equipment',
            ItemDescription:           l.itemDescription || l.equipmentName || 'Third-party rental',
            Quantity:                  Number(l.quantity) || 1,
            Price:                     Number(l.price) || 0,
            CurrencyCode:              PR_DEFAULTS.CurrencyCode,
            // Fusion accepts the UOM code here (verified: UOMCode "zzu" -> UOM "Ea").
            // UOM is a per-LINE choice now (defaulted to the pod's Day unit on
            // drawer open, since a Rate Based Services line bills days x rate).
            // header.uomCode is the legacy shared field, kept only as a fallback.
            UOMCode:                   l.uomCode || header.uomCode || 'zzu',
            RequesterId:               PR_DEFAULTS.RequesterId,
            DestinationTypeCode:       header.destinationTypeCode || 'EXPENSE',
            DestinationOrganizationId: PR_DEFAULTS.DestinationOrganizationId,
            // Delivery target: a one-time structured address if the manager entered
            // one (DeliverToCustomerLocationId + DeliverToLocationId null, verified
            // to auto-set OneTimeLocationFlag), else the registered location.
            DeliverToLocationId:         oneTimeLocationId != null ? null : deliverToLocationId,
            DeliverToCustomerLocationId: oneTimeLocationId != null ? oneTimeLocationId : undefined,
            // Requested delivery date = the rental START date (when the
            // equipment is needed on site), per Sandeep — but never a past date
            // (Fusion rejects it, POR-2010567), so older requests floor to today.
            RequestedDeliveryDate:     deliveryDateIso(l.lineStartDate, l.lineEndDate),
            // Per-line note. NOTE: the PR *line* resource has no `Justification`
            // attribute (that lives on the header only) — sending it returns
            // HTTP 400 "Invalid attribute Justification". Verified against the
            // pod's purchaseRequisitions/describe: valid line note fields are
            // NoteToBuyer / NoteToReceiver / NoteToSupplier. Use NoteToBuyer.
            NoteToBuyer:               'Request ' + requestNumber + ' Line ' + (l.lineNo != null ? l.lineNo : idx + 1)
          };
          const dists = buildDistributions(l);
          if (dists) line.distributions = dists;
          return line;
        })
      };

      // prSubmitting was already set in run(), before the first await, so the
      // button is disabled and the progress bar is up from the moment of the
      // click - not from here, which is two round-trips later. Do NOT move the
      // set back down: that window is exactly what produced duplicate
      // requisitions. The `= false` resets on the failure paths below stay.

      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/postFscmRestApiResources11_13_18_05PurchaseRequisitions',
          body:     body
        });
      } catch (e) {
        console.error('[CreatePurchaseRequisitionChain] POST failed:', e);
        $page.variables.prSubmitting = false;
        await safeNotify(context, {
          summary: 'Requisition Failed',
          message: 'Network error contacting Fusion.',
          type: 'error', displayMode: 'persist'
        });
        return;
      }

      if (!resp || !resp.ok) {
        $page.variables.prSubmitting = false;

        // Detect a project-distribution validation failure specifically. The
        // projectDFF segments (_PROJECT_ID/_TASK_ID/_EXPENDITURE_TYPE_ID) are
        // validated against project-scoped LOVs; a project that has no
        // chargeable tasks or whose expenditure types don't include the picked
        // one fails with FND_VS_VAL_NOT_IN_LIST naming the segment. Surface a
        // clear message instead of the raw Fusion error. No PR is created on a
        // 400, so there is no orphan requisition to clean up.
        const details = (resp && resp.body && resp.body['o:errorDetails']) || [];
        const dffErr = details.find(d =>
          /FND_VS_VAL_NOT_IN_LIST/.test(d && d['o:errorCode'] || '') ||
          /_TASK_ID|_PROJECT_ID|_EXPENDITURE_TYPE_ID/.test(d && d.detail || ''));
        if (dffErr) {
          await safeNotify(context, {
            summary: 'Project Not Set Up for Cost Distribution',
            message: 'This request’s project/task can’t receive this cost in Fusion '
              + '(' + (dffErr.detail || 'invalid project distribution') + '). '
              + 'Check the project has a chargeable task and a matching expenditure type, '
              + 'then try again.',
            type: 'error', displayMode: 'persist'
          });
          return;
        }

        const serverMsg = (resp && resp.body && (resp.body.title || resp.body.message))
          || (resp && resp.body && JSON.stringify(resp.body));
        await safeNotify(context, {
          summary: 'Requisition Rejected',
          message: serverMsg ? ('HTTP ' + resp.status + ': ' + serverMsg)
                             : ('Fusion rejected the requisition (HTTP ' + (resp && resp.status) + ').'),
          type: 'error', displayMode: 'persist'
        });
        return;
      }

      const reqNo        = (resp.body && (resp.body.Requisition || resp.body.RequisitionHeaderId)) || '(created)';
      const reqHeaderId  = resp.body && resp.body.RequisitionHeaderId;
      const reqNumberStr = resp.body && resp.body.Requisition;

      // Persist a mirror row per line so EquipRite can later resolve the PO the
      // buyer converts this requisition into (PR->PO link is async — read back on
      // page load). We map our line_id to the Fusion line Fusion echoes back:
      // resp.body.lines.items[] come back in the same order we sent them, keyed
      // by LineNumber (1-based). Best-effort — a failed mirror insert must NOT
      // block the success toast (the requisition already exists in Fusion).
      if (reqHeaderId != null) {
        const echoed = (resp.body.lines && resp.body.lines.items) || [];
        await Promise.all(lines.map(async (l, idx) => {
          const fusionLine = echoed[idx] || {};
          try {
            const mirrorResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createPurchaseRequisition',
              body: {
                eqrRequestLineId:      Number(l.lineId),
                requisitionHeaderId:   Number(reqHeaderId),
                requisitionNumber:     String(reqNumberStr != null ? reqNumberStr : reqNo),
                requisitionLineNumber: fusionLine.LineNumber != null ? Number(fusionLine.LineNumber) : (idx + 1),
                isRequestSpecific:     isRequestSpecific ? 'Y' : 'N',
                // Requisitioning BU — the SAME value sent to Fusion above. Post-cost
                // scopes the BU-level cost config (PASS_PROCUREMENT_COST / MARGIN)
                // to this BU (pass-through/markup is a procurement policy, so it
                // belongs to the procuring BU, not the equipment request's BU —
                // which is unpopulated anyway). Stored on the mirror so the
                // post-cost view can join config directly, no hardcode.
                requisitioningBuId:    Number(PR_DEFAULTS.RequisitioningBUId),
                createdBy:             'EQUIPRITE',
                lastUpdatedBy:         'EQUIPRITE'
              }
            });

            // Take the PR line out of the yard flow and make it postable.
            // A third-party rental never allocates / gets a TO / is picked, so it
            // would otherwise sit at IN_PROCESS forever and never reach post-cost.
            // Flip it to UNDER_PROCUREMENT — a dedicated status meaning "a purchase
            // requisition has been raised for this line". This is semantically
            // accurate (the equipment isn't deployed to site — it's being
            // procured) and replaces the earlier reuse of DEPLOYED.
            //
            // QUOTING EXCEPTION: when quoting is enabled for THIS request's origin
            // we do NOT flip here — raising a PR must leave the line where it is,
            // because the quote hasn't been accepted yet. The line only becomes
            // UNDER_PROCUREMENT at quote-accept, where both accept chains flip
            // PR-bearing lines (customer AcceptQuoteChain / project
            // ProjectAcceptQuoteChain, via their prLineIds lookup).
            //
            // This is keyed on QUOTING, not on origin. It used to be gated on
            // `!isCustomer` — correct when only customers could quote, but wrong
            // once ENABLE_QUOTES let project requests quote too: a quoted project
            // request would flip to UNDER_PROCUREMENT at PR-raise and pre-empt its
            // own quote. The rationale was always "the quote hasn't happened yet",
            // so the condition now matches that literally.
            //
            // With quoting OFF for the origin there is no accept step to defer to,
            // so the flip happens here as before.
            //
            // BACKEND CONTRACT (project flow) — must be deployed ALONGSIDE this,
            // or the flip silently no-ops and the line stays IN_PROCESS (the PATCH
            // below is wrapped in try/catch):
            //   1) CK_EQR_RL_LINE_STATUS must include 'UNDER_PROCUREMENT', else the
            //      PATCH 400s on the check constraint.
            //   2) EQP_POSTCOST view PR branch must match
            //      rl.line_status IN ('DEPLOYED','UNDER_PROCUREMENT') so the cost
            //      still posts (IN, not =, so legacy DEPLOYED PR lines keep posting).
            // UNDER_PROCUREMENT is intentionally kept OUT of the yard return flow
            // (unlike DEPLOYED, a directly-procured rental doesn't return through us)
            // and remains non-rejectable (see the request-detail reject gates).
            //
            // Gated on a successful mirror insert: a line with no mirror row would
            // have no PR/PO link and never reach the post-cost PR branch, so only
            // flip once the mirror row exists.
            if (!quotingEnabledForOrigin && mirrorResp && mirrorResp.ok) {
              try {
                await Actions.callRest(context, {
                  endpoint:  'eqp-v1/patchRequestLine',
                  uriParams: { requestId: Number(requestId), id: Number(l.lineId) },
                  body:      { lineStatus: 'UNDER_PROCUREMENT' }
                });
              } catch (e2) {
                console.warn('[CreatePurchaseRequisitionChain] line status flip failed for line', l.lineId, e2);
              }
            }
          } catch (e) {
            console.warn('[CreatePurchaseRequisitionChain] mirror persist failed for line', l.lineId, e);
          }
        }));
      }

      // Success — close the drawer, clear state, toast the Requisition number.
      // The PR UI is now an oj-drawer-popup bound to isPrDrawerOpen (was an
      // oj-dialog closed via DOM #prDialog.close()).
      $page.variables.prSubmitting = false;
      $page.variables.prLines = [];
      $page.variables.isPrDrawerOpen = false;

      await safeNotify(context, {
        summary: 'Requisition Created',
        message: 'Fusion Requisition ' + reqNo + ' created (Draft).',
        type: 'confirmation', displayMode: 'transient'
      });

      // Refresh the enriched lines so the page reflects current server state.
      try {
        const result = await rdl.fetchAndBuild(context, Actions, requestId, $page.variables.selectedYard);
        if (result && result.ok) rdl.applyLines($page, result.lines);
      } catch (e) {
        console.warn('[CreatePurchaseRequisitionChain] post-submit refresh failed:', e);
      }
    }
  }

  return CreatePurchaseRequisitionChain;
});
