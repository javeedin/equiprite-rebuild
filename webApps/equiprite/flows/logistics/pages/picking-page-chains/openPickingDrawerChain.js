define([
  'require',
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestDetailLines',
], (localRequire, ActionChain, Actions, rdl) => {
  'use strict';

  // NEW EQUIPRITE: copied from the old initiate-picking-page openPickingDrawerChain, unchanged except one thing:
  // resources/js/pickSlip is loaded where it is used (below, only when SHIPPING_DOCUMENTS_ENABLED is on)
  // instead of up front. It pulls jsPDF from a CDN, and as a static dependency an unreachable CDN stopped this
  // chain, so the request never opened. Same calls, same order.
  const loadPickSlip = () => new Promise((resolve, reject) => localRequire(['resources/js/pickSlip'], resolve, reject));

  // LOV option label: the order number plus its release state, so the dropdown
  // itself says which orders are done and which still need releasing. Kept
  // identical to ReleaseTransferOrderChain's copy so the label doesn't change
  // between an in-session release and a reopen.
  function statusLabel(orderNumber, fallback, released) {
    const base = orderNumber ? String(orderNumber) : (fallback || 'TO pending');
    return base + (released ? ' — Released' : ' — Awaiting release');
  }

  // Derived UI status for a line:
  //   PENDING     = no allocations yet
  //   IN_PROGRESS = some allocations but not full qty, OR full qty without a TO
  //   ALLOCATED   = full qty allocated AND a non-cancelled TO exists on the request
  //   EXCEPTION   = serial flagged DAMAGED / EXPIRED / RETIRED (best-effort)
  function derivePickingStatus(allocCount, qty) {
    if (allocCount === 0) return 'PENDING';
    if (allocCount >= (qty || 1)) return 'ALLOCATED';
    return 'IN_PROGRESS';
  }

  // ── Subinventory / locator lookup ──────────────────────────────────────
  // Neither column is on views/line-detail-units (EQR_V_LINE_DETAIL_UNITS
  // stops at inv org / location). They live on EQR_SERIAL_REF as
  // CURRENT_SUBINVENTORY / CURRENT_LOCATOR and reach the frontend through
  // eqp-v1/getSerialRefs as currentSubinventory / currentLocator.
  //
  // Fetched by equipmentId, one call per DISTINCT equipment master rather than
  // one per allocated unit — a request with eight units of one machine is one
  // call, not eight. The filter is real, not silently ignored: verified against
  // the live service, equipmentId=1000000013 returns 5 rows all carrying that
  // equipmentId.
  //
  // uriParams, never parameters: a query param passed under `parameters` is
  // SILENTLY DROPPED, which here would return page 0 of all serial refs and
  // quietly mis-join every locator.
  //
  // A failed lookup costs that equipment's locator cells and nothing else —
  // blank is the honest answer, the same rule this chain already applies to
  // the Yard column.
  async function fetchUnitRefs(context, masterIds) {
    const byId = {};
    if (!masterIds.length) return byId;
    const results = await Promise.all(
      masterIds.map(id =>
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getSerialRefs',
          uriParams: { equipmentId: Number(id), page: 0, size: 500 },
        }).catch(e => ({ ok: false, _err: e }))
      )
    );
    results.forEach((r, idx) => {
      if (!r || !r.ok) {
        console.warn('[openPickingDrawer] unit-refs fetch failed for equipment',
          masterIds[idx], r && r._err);
        return;
      }
      ((r.body && r.body.data) || []).forEach(ref => {
        if (ref && ref.id != null) byId[String(ref.id)] = ref;
      });
    });
    return byId;
  }

  // Distinct comma-joined values of one unit-ref field across a line's
  // allocated units. A line whose units sit in different bays shows all of
  // them — collapsing to the first would send the picker to one bay for a
  // two-bay pick.
  //
  // The map is keyed by serial-ref id, and views/line-detail-units emits
  // serial-ref ids in unitRefId (verified against EQR_V_LINE_DETAIL_UNITS —
  // every unitRefId resolves into EQR_SERIAL_REF). The two must stay in the
  // same id space: the serial / lot / item id spaces are disjoint, so a
  // mismatch here misses on every row and blanks both the subinventory and
  // locator columns without raising anything.
  //
  // Still SERIAL-only: the lot/item rows carry no subinventory or locator.
  function distinctRefValues(units, unitRefsById, pick) {
    const seen = [];
    (units || []).forEach(u => {
      if (String(u.unitType || '').toUpperCase() !== 'SERIAL') return;
      const ref = u.unitRefId != null ? unitRefsById[String(u.unitRefId)] : null;
      const val = ref ? String(pick(ref) == null ? '' : pick(ref)).trim() : '';
      if (val && seen.indexOf(val) === -1) seen.push(val);
    });
    return seen.join(', ');
  }

  function deriveCondition(currentStatus) {
    const s = (currentStatus || '').toUpperCase();
    if (s === 'DAMAGED' || s === 'BROKEN') return 'DAMAGED';
    if (s === 'EXPIRED' || s === 'OBSOLETE') return 'EXPIRED';
    if (s === 'RETIRED' || s === 'SCRAPPED') return 'RETIRED';
    return 'GOOD';
  }

  class openPickingDrawerChain extends ActionChain {
    async run(context, { rowData }) {
      const { $page } = context;
      if (!rowData) return;

      // Show the modal with whatever header info we already have, then
      // enrich with lines fetched from the API.
      $page.variables.selectedRequest = {
        ...rowData,
        lines: [],
        pickingExceptions: [],
      };
      $page.variables.isDrawerOpen = true;
      $page.variables.isLoadingDrawer = true;

      const dialog = document.getElementById('pickingDetailDialog');
      if (dialog && typeof dialog.open === 'function') dialog.open();

      // Reset TO dropdown state for the new request
      $page.variables.selectedRequestTOs = [];
      $page.variables.selectedTOId = '';
      // Clear the release banner so a result from the PREVIOUS request can't
      // appear against this one. The dialog now stays open across releases, so
      // this is the only point at which it is guaranteed to be stale.
      $page.variables.releaseMessage = '';
      $page.variables.releaseMessageType = 'confirmation';

      const requestId = rowData.eqrEquipmentRequestId || rowData.id;
      if (!requestId) {
        $page.variables.isLoadingDrawer = false;
        return;
      }

      // ── Load Transfer Orders for this request (drives the dropdown) ─────
      // A line can only show ALLOCATED if at least one non-cancelled TO
      // exists on this request — that's the "TO has been created/released"
      // gate. We track the flag here so the line-build step can read it.
      let hasActiveTO = false;
      let requestTOs = [];
      try {
        const toResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getTransferOrders',
          uriParams: { equipmentRequestId: Number(requestId) }
        });
        if (toResp && toResp.ok) {
          requestTOs = toResp.body.data || [];
          // Sort by createdDate desc so most-recent TO is first / auto-selected.
          requestTOs.sort((a, b) => {
            const da = a.createdDate ? new Date(a.createdDate).getTime() : 0;
            const db = b.createdDate ? new Date(b.createdDate).getTime() : 0;
            return db - da;
          });
          // Statuses that mean the TO is no longer release-eligible. CANCELLED
          // / CANCELED have been excluded since day one; CLOSED / RELEASED /
          // SHIPPED are added so that once Fusion (or the local mirror) flips
          // a TO post-release, it disappears from the dropdown. Until the
          // backend reflects the released status, the in-session splice in
          // ReleaseTransferOrderChain handles the just-released case.
          const POST_RELEASE_STATUSES = ['CANCELLED', 'CANCELED', 'CLOSED', 'RELEASED', 'SHIPPED'];
          const isReleasable = (t) => {
            const s = (t.orderStatus || '').toUpperCase();
            return POST_RELEASE_STATUSES.indexOf(s) === -1;
          };
          hasActiveTO = requestTOs.some(isReleasable);
          const options = requestTOs.filter(isReleasable).map(t => {
            const num = t.orderNumber || '';
            const status = t.orderStatus || '';
            const label = num ? String(num) : 'TO pending';
            return {
              value: String(t.id),
              label: label,
              orderNumber: num,
              orderStatus: status,
            };
          });
          // Provisional: every option here is release-eligible by orderStatus, so
          // none is flagged released yet and the labels carry no status. The
          // line-derived pass after the lines load re-flags any TO already
          // released in an earlier session and applies the status labels.
          $page.variables.selectedRequestTOs = options;
          if (options.length) $page.variables.selectedTOId = options[0].value;
          else $page.variables.selectedTOId = '';
        }
      } catch (e) {
        console.warn('[openPickingDrawer] TO fetch failed:', e);
      }

      // ── Fetch TO lines for every TO on this request and build a
      //    requestLineId -> { orderNumber, orderStatus } map. orderNumber
      //    drives the TO Number column; orderStatus is kept for the
      //    hasActiveTO gate that downgrades ALLOCATED → IN_PROGRESS. ─────
      const requestLineToTOMap = new Map();
      if (requestTOs.length > 0) {
        const toLineResults = await Promise.all(
          requestTOs.map(t =>
            Actions.callRest(context, {
              endpoint: 'eqp-v1/getTransferOrderLines',
              uriParams: { transferOrderId: Number(t.id) }
            }).catch(e => ({ ok: false, _err: e }))
          )
        );
        requestTOs.forEach((t, idx) => {
          const r = toLineResults[idx];
          if (!r || !r.ok) return;
          const orderNumber = t.orderNumber || '';
          const orderStatus = t.orderStatus || '';
          (r.body.data || []).forEach(toLine => {
            if (toLine.requestLineId != null && orderNumber) {
              // First TO covering a given request-line wins (most recent due to sort).
              if (!requestLineToTOMap.has(toLine.requestLineId)) {
                requestLineToTOMap.set(toLine.requestLineId, { orderNumber, orderStatus });
              }
            }
          });
        });
      }

      // ── Canonical line list — the lines to iterate, source of quantity /
      //    lineStatus / eqrEquipmentMasterId ────────────────────────────────
      const linesResp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
        uriParams: { requestId: Number(requestId), size: 2000 }
      }).catch(e => { console.warn('[openPickingDrawer] lines fetch failed:', e); return null; });

      const allLines = (linesResp && linesResp.ok) ? (linesResp.body.data || []) : [];

      // ── Only lines that belong on THIS page ────────────────────────────────
      // The drawer is the picking workspace: a line is relevant once it has been
      // confirmed and scheduled, and stops being relevant once it has shipped.
      //
      //   SCHEDULED_FOR_PICKING → confirmed, awaiting release
      //   PICK_INITIATED        → released, awaiting Pick and Ship
      //   SHIP_TO_SITE          → shipped; kept so the drawer still shows what
      //                           went out rather than emptying on the last step
      //
      // Everything else is deliberately hidden: DRAFT/SUBMITTED/IN_PROCESS and
      // ALLOCATED have not been confirmed yet, UNDER_PROCUREMENT is on the
      // PR/PO track, and DEPLOYED/CLOSED/REJECTED are done with. Those rows
      // were previously listed with a blank Line Status column, which read as
      // "something is missing" rather than "not applicable here".
      //
      // Filtered BEFORE the per-line units fan-out below, so a hidden line
      // costs no line-detail-units call.
      const PICKING_VISIBLE_LINE_STATUSES = [
        'SCHEDULED_FOR_PICKING', 'PICK_INITIATED', 'SHIP_TO_SITE'
      ];
      const canonicalLines = allLines.filter(l =>
        PICKING_VISIBLE_LINE_STATUSES.indexOf(
          String((l && l.lineStatus) || '').toUpperCase()) !== -1);

      if (allLines.length !== canonicalLines.length) {
        console.log('[openPickingDrawer] lines filtered for picking:',
          canonicalLines.length, 'of', allLines.length);
      }

      // ── One views/line-detail-units call per line (parallel). Each returns
      //    one row per physical unit of the line's master, carrying
      //    equipmentName + className + per-unit unitNumber/unitStatus AND this
      //    line's live allocation join (allocationId/allocatedQty/
      //    allocationStatus). Replaces the old equipment-catalog lookup +
      //    global getAllocations + per-master serial-refs fan-out.
      //    No yardId (the drawer has no yard scope — and yardId drops
      //    allocationId on this view); no dates (uses the line's saved window,
      //    so no required-param 400 like the old equipment-catalog call). ───
      //
      //    Fired in the SAME wave as the serial-ref lookups below, so the
      //    locator data costs no extra wall-clock on drawer open.
      const [unitResults, unitRefsById] = await Promise.all([
        Promise.all(
          canonicalLines.map(line =>
            Actions.callRest(context, {
              endpoint: 'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
              uriParams: { requestId: Number(requestId), lineId: Number(line.id), size: 10000 }
            }).catch(e => ({ ok: false, _err: e }))
          )
        ),
        fetchUnitRefs(context, [...new Set(
          canonicalLines.map(l => l.eqrEquipmentMasterId).filter(id => id != null)
        )]),
      ]);
      // lineId -> raw unit rows for that line
      const unitsByLine = new Map();
      canonicalLines.forEach((line, idx) => {
        const r = unitResults[idx];
        if (!r || !r.ok) {
          if (r && r._err) console.warn('[openPickingDrawer] line-detail-units fetch failed for line', line.id, r._err);
          unitsByLine.set(line.id, []);
          return;
        }
        unitsByLine.set(line.id, r.body.data || []);
      });

      // ── Build the drawer's line + exception arrays ──────────────────────
      const exceptions = [];
      const lines = canonicalLines.map(line => {
        const unitRows = unitsByLine.get(line.id) || [];
        // Name + class repeat on every unit row — first row wins.
        const eqInfo = unitRows.length
          ? { equipmentName: unitRows[0].equipmentName || '', className: unitRows[0].className || '' }
          : {};
        // Rows allocated to THIS line carry a non-null allocationId. Each such
        // row is one allocation (serial: 1 unit; lot/inventory: one alloc
        // record w/ allocatedQty) — matches the old allocs.length semantics.
        const allocRows = unitRows.filter(u => u.allocationId != null);
        const allocs = allocRows;  // alias: status derivation reads allocs.length
        const allocSerials = allocRows.map(u => ({
          serialNumber: u.unitNumber || '',
          // line-detail-units exposes the unit's status column as unitStatus;
          // deriveCondition()/exception checks read .currentStatus, so map it.
          currentStatus: u.unitStatus || '',
          // Join key to eqp-v1/getSerialRefs, which is where the pick slip's
          // subinventory + locator live (EQR_SERIAL_REF.CURRENT_SUBINVENTORY /
          // CURRENT_LOCATOR — NOT on this view). unitRefId is the serial-ref id
          // for a SERIAL unit and the lot-ref id for a LOT one, so the type has
          // to ride along: joining a lot id against serial-refs would silently
          // match the wrong unit.
          //
          // Carried here rather than fetched here on purpose — the drawer
          // already makes one line-detail-units call per line on open, and
          // subinventory/locator are needed only when someone prints. See
          // PrintPickSlipChain.
          unitRefId: u.unitRefId != null ? u.unitRefId : null,
          unitType: u.unitType || '',
        }));

        // ── Yard the line is picked FROM ───────────────────────────────────
        // line-detail-units already carries the unit's inventory org, and the
        // inv org IS the yard in this app: the analytics Yard filter binds
        // invOrgId (yardOrgSDP -> getInvOrgs) and EQR_V_YARD_UTILIZATION
        // exposes yards as INV_ORG_ID/NAME/CODE. So no extra fetch is needed —
        // these rows are already in hand.
        //
        // NOT locationName, which is on the same rows: that is the physical
        // site ("Trinity River Yard") and is blank for every lot/inventory
        // item.
        //
        // WHICH source to read is decided by ALLOCATION_METHOD, because the two
        // flows record the yard in different places:
        //
        //   MANUAL — someone allocated specific units, so EQR_ALLOCATION holds
        //     the committed yard per unit → sourceInvOrgName.
        //   AUTO   — Confirm was clicked with no allocation, so there is no
        //     allocation row at all; the yard was taken from the Yard picker and
        //     stamped on the REQUEST LINE → lineSourceInvOrgName.
        //
        // Reading the wrong one returns NULL rather than a wrong yard (the two
        // sets coexist on the view by design — the LINE_ prefix exists precisely
        // so repointing the allocation names didn't break this column), but a
        // blank Yard on an AUTO line is exactly the gap this closes.
        //
        // Both column sets are live on views/line-detail-units now — the
        // allocation-sourced sourceInvOrgName/destInvOrgName AND the
        // line-sourced lineSourceInvOrgName/lineDestInvOrgName, which carry the
        // LINE_ prefix precisely so adding them did not repoint the names this
        // column already depended on. (An earlier note here said tier 1 was
        // inert pending that view change; it is no longer.)
        const distinctYards = (rows, pick) => [...new Set(
          rows.map(pick).filter(n => n != null && n !== '')
        )];
        // allocationMethod rides on every row of the line (it is a line column),
        // so read it off whichever rows we have — allocation rows first, else the
        // unit rows. Anything that isn't AUTO is treated as MANUAL, which keeps
        // the pre-existing behaviour for the NULL method on legacy lines.
        const methodRow = allocRows[0] || unitRows[0] || {};
        const isAutoAllocated =
          String(methodRow.allocationMethod || '').toUpperCase() === 'AUTO';

        // ONLY a RECORDED yard is shown — never a GUESSED one.
        //
        // There used to be two guesses: the allocated unit's CURRENT inv org,
        // then the candidate units' orgs. Both are gone now that every confirmed
        // line carries a recorded source (allocation stamp for MANUAL, line stamp
        // for AUTO). They were guesses at where a unit would be picked from, and
        // a guessed yard reads exactly like a recorded one in the column — a
        // blank cell is the honest answer when nothing has been committed yet,
        // and it cannot drift if the unit is later moved.
        //
        // THE MANUAL FALLBACK BELOW IS NOT ONE OF THOSE GUESSES. It falls back
        // from one recorded stamp to another: the line's own SOURCE_INV_ORG_NAME,
        // written by Confirm. It is not derived from where a unit happens to sit
        // now, so it cannot drift.
        //
        // Why the fallback is needed: EQR_ALLOCATION.SOURCE_INV_ORG_NAME is NULL
        // on most rows (343 of 440 never got SOURCE_INV_ORG_ID written at all),
        // so reading it alone left 14 of the 111 picking-visible lines with a
        // blank Yard while the correct value sat on the very same view row in
        // lineSourceInvOrgName. The allocation stamp is still PREFERRED — it is
        // per-unit, so it stays right if a line-level stamp is later changed —
        // and the two never disagree where both exist (verified on paasdev:
        // 86 rows carry both, 86 agree, 0 disagree).
        //
        // The remaining blanks are legacy lines (ALLOCATION_METHOD NULL, created
        // before Aug 2026) that carry no recorded source yard in EITHER place.
        // Those stay blank on purpose — there is nothing to show, and the only
        // other candidate is the unit's current org, which is the guess above.
        const yardList = isAutoAllocated
          // AUTO: the line's stamped yard. Read from the unit rows — an AUTO
          // line has no allocation rows, so allocRows is empty by definition.
          ? distinctYards(unitRows, u => u.lineSourceInvOrgName)
          // MANUAL: the yard recorded on the allocation when the unit was
          // committed, else the line's own stamp.
          : distinctYards(allocRows, u => u.sourceInvOrgName || u.lineSourceInvOrgName);

        const serialNumber = allocSerials.map(s => s.serialNumber).filter(Boolean).join(', ');
        const worstCondition = allocSerials.reduce((acc, s) => {
          const c = deriveCondition(s.currentStatus);
          if (c === 'GOOD') return acc;
          return acc && acc !== 'GOOD' ? acc : c;
        }, 'GOOD');

        let pickingStatus;
        if (worstCondition !== 'GOOD') {
          pickingStatus = 'EXCEPTION';
        } else {
          pickingStatus = derivePickingStatus(allocs.length, line.quantity);
          // Gate: ALLOCATED requires a non-cancelled TO on the request.
          if (pickingStatus === 'ALLOCATED' && !hasActiveTO) {
            pickingStatus = 'IN_PROGRESS';
          }
        }

        if (pickingStatus === 'EXCEPTION') {
          exceptions.push({
            lineId: String(line.id),
            equipmentName: eqInfo.equipmentName || '',
            issue: allocSerials.find(s => deriveCondition(s.currentStatus) !== 'GOOD')
              ? ('Serial ' +
                allocSerials.find(s => deriveCondition(s.currentStatus) !== 'GOOD').serialNumber +
                ' is ' + worstCondition + '. Assign an alternate serial.')
              : 'Allocated serial flagged for review.',
            severity: worstCondition === 'EXPIRED' ? 'CRITICAL' : 'HIGH',
          });
        }

        const toInfo = requestLineToTOMap.get(line.id) || null;
        return {
          lineId: String(line.id),
          equipmentMasterId: line.eqrEquipmentMasterId,
          equipmentName: eqInfo.equipmentName || '',
          equipmentClass: eqInfo.className || '',
          serialNumber: serialNumber,
          // The allocated units behind serialNumber, one entry each, carrying
          // the unitRefId/unitType the pick slip needs to look up subinventory
          // and locator. serialNumber is the joined display string and cannot
          // be split back apart reliably (a serial may contain a comma).
          allocUnits: allocSerials,
          // Where the picker actually walks. Blank on a lot-allocated line and
          // on any serial whose ref carries no locator (185 of 198 allocated
          // serials do carry one) — the grid renders an em-dash, the pick slip
          // groups those lines under "Unlocated".
          subinventory: distinctRefValues(allocSerials, unitRefsById, r => r.currentSubinventory),
          locator:      distinctRefValues(allocSerials, unitRefsById, r => r.currentLocator),
          // '' when no unit carries an org; the grid renders an em-dash.
          yard: yardList.join(', '),
          altSerialNumber: '',
          quantity: line.quantity || 1,
          allocatedCount: allocs.length,
          pickingStatus: pickingStatus,
          condition: worstCondition,
          notes: line.lineNotes || '',
          toNumber: toInfo ? toInfo.orderNumber : '',
          // Per-line backend status (drives Line Status column + blank-out).
          // Spec doesn't list this in RequestLineDto but the DB column
          // exists; we read it defensively and fall back to '' if absent.
          lineStatus: line.lineStatus || '',
          // Request header status — kept on the line object for downstream
          // use even though it isn't rendered as its own column.
          requestStatus: (rowData && rowData.status) || '',
          // ── F&M — no Transfer Order; ships straight from ALLOCATED ──
          // ShipConfirmStuckLinesChain reads this flag to include it in Pick and
          // Ship. The class is EQR_REQUEST_LINE.FULFILMENT_CLASS (master AND both
          // yards transactable), returned by equipment-requests/{id}/lines on the
          // line itself and by views/line-detail-units per unit. The line is
          // preferred because it is present even when no unit is allocated yet.
          // rdl.isFAndM is the one front-end reader of the rule; it falls back to
          // isTransactable, and to S&T when neither field is present.
          fulfilmentClass: rdl.classOfLine(line.fulfilmentClass ? line : (unitRows[0] || line)),
          isFAndM: rdl.isFAndM(line.fulfilmentClass ? line : (unitRows[0] || line)),
        };
      });

      console.log('[openPickingDrawer] requestId=', requestId,
        'lines=', lines.length, 'exceptions=', exceptions.length);

      // ── Push enriched data into selectedRequest ────────────────────────
      $page.variables.selectedRequest = {
        ...$page.variables.selectedRequest,
        lines: lines,
        pickingExceptions: exceptions,
      };

      // ── Mark already-released TOs from the LINES ───────────────────────
      // The backend does not flip EQR_TRANSFER_ORDER.ORDER_STATUS on release,
      // so POST_RELEASE_STATUSES above cannot detect a TO released in an
      // EARLIER drawer session — reopening the drawer showed a released TO as
      // releasable again, letting the user re-release it.
      //
      // The lines are the reliable witness: releasing advances them to
      // PICK_INITIATED (and onward to SHIP_TO_SITE / DELIVERED / CLOSED), and
      // each line carries the toNumber it belongs to. So a TO with no line
      // still awaiting release has, by definition, already been released.
      //
      // Derived here rather than trusted from page state, so it holds across
      // close+reopen and after a Refresh. ReleaseTransferOrderChain still sets
      // the same flag in-session for the immediate case, where the just-PATCHed
      // lines are already reflected locally.
      //
      // PRE_RELEASE_LINE_STATUSES is the complement: statuses a line sits at
      // BEFORE its TO is released. Anything else means picking has started.
      // ALLOCATED is the normal pre-release state; '' covers a line whose
      // status the backend left blank, which must NOT be read as released.
      // SCHEDULED_FOR_PICKING is the state Confirm now leaves a line in — the
      // TO exists but has not been released yet, which is exactly "awaiting
      // release". Omitting it would make a freshly-confirmed line look like it
      // had already been released, so its TO would be flagged released and
      // Release for Picking would grey out with nothing having been released.
      const PRE_RELEASE_LINE_STATUSES = [
        'ALLOCATED', 'SCHEDULED_FOR_PICKING', 'PENDING_ALLOCATION', 'UNALLOCATED', ''
      ];
      const releasedTONumbers = new Set();
      const awaitingByTO = new Map();
      lines.forEach((l) => {
        const num = String(l.toNumber || '');
        if (!num) return;
        const st = String(l.lineStatus || '').toUpperCase();
        const awaiting = PRE_RELEASE_LINE_STATUSES.indexOf(st) > -1;
        // A TO counts as awaiting release if ANY of its lines still is.
        awaitingByTO.set(num, (awaitingByTO.get(num) || false) || awaiting);
      });
      awaitingByTO.forEach((stillAwaiting, num) => {
        if (!stillAwaiting) releasedTONumbers.add(num);
      });

      // Every TO stays in the LOV, labelled with its release state. The status
      // drives the BUTTONS, not the option list: selecting an unreleased TO
      // enables Release for Picking, selecting a released one enables Pick and
      // Ship. Nothing is hidden, so the dropdown always shows the full picture of
      // the request and the user can go back to any order.
      $page.variables.selectedRequestTOs = ($page.variables.selectedRequestTOs || [])
        .map((t) => {
          const isReleased = t.released
            || !!(t.orderNumber && releasedTONumbers.has(String(t.orderNumber)));
          return {
            ...t,
            released: isReleased,
            label: statusLabel(t.orderNumber, t.label, isReleased)
          };
        });

      // Open on the first TO still awaiting release — the actionable one. When
      // every TO is released, fall back to the first so the drawer opens on a
      // real order (and Pick and Ship is live for its lines) rather than on
      // nothing.
      const tos = $page.variables.selectedRequestTOs;
      const firstUnreleased = tos.find(t => !t.released);
      $page.variables.selectedTOId = firstUnreleased
        ? firstUnreleased.value
        : (tos.length ? tos[0].value : '');

      // TICK THAT ORDER'S LINES — explicitly, now that the LOV is gone.
      //
      // This used to happen for free: setting selectedTOId fired the dropdown's
      // on-value-changed, which ran SelectTOLinesChain, which ticked the rows.
      // With no dropdown there is no binding to fire, so the drawer has to ask
      // for the tick itself or it would open with the order selected and none of
      // its lines checked — and the ticks are now what scopes every action.
      if ($page.functions && typeof $page.functions.onTOSelectionChanged === 'function') {
        $page.functions.onTOSelectionChanged(
          { detail: { value: $page.variables.selectedTOId } }, $page);
      }

      $page.variables.isLoadingDrawer = false;

      // ── Pick slip thumbnail ─────────────────────────────────────────────
      // Generated up front, not on click, because the drawer SHOWS the slip
      // rather than offering a button that makes one — the reader should see
      // the document itself, the way the quote pages render the quote inline.
      //
      // Cheap enough to do on every open: generation is pure jsPDF over lines
      // already in memory (subinventory and locator were resolved in the fetch
      // wave above), so there is no round-trip here.
      //
      // autoOpen:false — this fills the thumbnail; it must not throw a preview
      // dialog in the user's face just for opening a request.
      //
      // Skipped entirely when nothing has been released yet, so an unreleased
      // request neither builds a document nor shows an icon.
      try {
        const { $application } = context;
        if ($application.functions.isFeatureEnabled(
              $application.variables.featureFlags,
              $application.variables.flagsLoaded,
              'SHIPPING_DOCUMENTS_ENABLED')
            && (await loadPickSlip()).hasReleasedLines($page.variables.selectedRequest.lines)) {
          await Actions.callChain(context, {
            chain:  'PrintPickSlipChain',
            params: { autoOpen: false }
          });
        }
      } catch (e) {
        // No thumbnail is an acceptable outcome; a broken drawer is not.
        console.warn('[openPickingDrawer] pick slip preview generation failed:', e);
      }
    }
  }

  return openPickingDrawerChain;
});
