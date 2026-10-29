define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bryntumDates',
  'resources/js/lineDetailUnits',
  'resources/js/lineConfirmed',
], (ActionChain, Actions, bryntumDates, lineDetailUnits, lineConfirmed) => {
  'use strict';

  // YYYY-MM-DD (from oj-input-date) → ISO datetime suffix the backend expects.
  // Pass-through if it's already an ISO datetime.
  function toISODate(val) {
    if (!val) return null;
    var s = String(val);
    return s.includes('T') ? s : (s + 'T00:00:00Z');
  }

  // Normalize to YYYY-MM-DD for equality comparison — both inputs may be
  // either bare dates or ISO datetimes.
  function asDay(val) {
    if (!val) return '';
    return String(val).substring(0, 10);
  }

  // Denormalize the allocated unit's current inv org onto the allocation row
  // (EQR_ALLOCATION.EQP_INV_ORG_ID / EQP_INV_ORG_NAME). The value rides in on
  // the staged record (line-detail-page.js), sourced from the line-detail-units
  // row's invOrgId/invOrgName. Captured at allocation time so the outbound
  // Transfer Order can derive its source org from the allocation instead of the
  // old hardcoded '001'. Returns {} when the org isn't known, so we never write
  // a null over a value the backend might default. NOTE: persistence depends on
  // the backend AllocationDto/entity mapping these fields — the OpenAPI spec
  // doesn't declare them (known drift), so verify on deploy that a saved
  // allocation comes back with EQP_INV_ORG_ID populated.
  function orgFields(assn) {
    if (!assn || assn.invOrgId == null) return {};
    return {
      eqpInvOrgId:   Number(assn.invOrgId),
      eqpInvOrgName: assn.invOrgName || '',
    };
  }

  class saveLineChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const requestId = $page.variables.requestId;
      const lineId    = $page.variables.lineId;

      // Staging state lives on the page module — fetch it via $page.functions.
      const staged = ($page.functions.getStagedChanges && $page.functions.getStagedChanges()) || {};
      const pendingAssignments = staged.pendingAssignments || [];
      const pendingReleases    = staged.pendingReleases    || [];

      // Did the user edit the line's start/end via the "Adjust for this line"
      // date pickers? Compare normalized YYYY-MM-DD form against the
      // original line dates seeded by vbEnterChain.
      const newStart = $page.variables.adjustedStartDate || '';
      const newEnd   = $page.variables.adjustedEndDate   || '';
      const origStart = asDay($page.variables.lineData && $page.variables.lineData.start_date);
      const origEnd   = asDay($page.variables.lineData && $page.variables.lineData.end_date);
      const datesChanged = (asDay(newStart) !== origStart) || (asDay(newEnd) !== origEnd);

      // ── Guard: nothing the user changed ───────────────────────────────
      // The Save button is disabled (display:"disabled") whenever there is
      // nothing staged — see $variables.saveEnabled in the page module. This
      // is the matching server-side backstop: if a click still lands on the
      // button (e.g. the header renders "disabled" as clickable), bail out
      // BEFORE making any REST calls, so a fully-allocated line with nothing
      // staged can't be re-saved. Mirrors the button's enable rule, plus
      // datesChanged (a saveable change too). Runs ahead of the stale-check
      // below, which only matters once there's real work to do.
      if (!pendingAssignments.length && !pendingReleases.length && !datesChanged) {
        await Actions.fireNotificationEvent(context, {
          summary:     'No changes',
          message:     'Nothing to save — assign or release a unit first.',
          type:        'info',
          displayMode: 'transient'
        });
        return;
      }

      // ── ALLOCATION GATE — has this line been CONFIRMED? ────────────────
      //
      // Confirmation (a live Transfer Order on this line) is the ONE thing that
      // closes allocation. Before it, both Assign and Release stay open: the
      // manager is still arranging which units go out, and any arrangement is
      // reversible. After it, the line is committed in Fusion and nothing on it
      // may change — the picker shows the "Assigned" badge with no Release
      // button (see line-detail-page.js `_confirmed`).
      //
      // DELIBERATELY NOT A LINE-STATUS CHECK. This gate used to require
      // lineStatus === IN_PROCESS (or QUOTE_ACCEPTED when quoted), which was
      // wrong twice over:
      //   - It trapped lines. Assigning promotes lineStatus to ALLOCATED, so
      //     after a release-and-retry the line's own status locked it out of
      //     being re-allocated.
      //   - It duplicated a judgement lineStatus cannot make. Status is a
      //     lifecycle label, not a record of whether units are committed;
      //     TO existence is the actual commitment, and it is what the picker UI
      //     has always gated on.
      // Keeping both meant two sources of truth for one question, and they
      // disagreed. There is now one.
      //
      // PER-LINE and STATUS-AWARE via resources/js/lineConfirmed: only a TO that
      // is live in Fusion (fusionToStatus === 'TO_CREATED') locks, and a TO on a
      // SIBLING line must not lock this one. Pending ('SR_CREATED') and failed
      // ('TO_FAILED') TOs leave the line editable so the user can retry.
      //
      // Applies to assignments AND releases: once a TO is live, neither is
      // permitted. Date changes and the stale-status cascade are unaffected.
      //
      // FAILS OPEN. If the TO lookup errors we allow the save rather than
      // blocking legitimate work on a network blip — the picker UI has already
      // gated on the same signal at page load, and the backend owns the real
      // invariant. This is the UX layer.
      // Memoized: the gate below and the serial bar-colouring step near the end
      // of the chain both need this, and it costs a getTransferOrders plus a
      // getTransferOrderLines per live TO. Resolved at most once per save.
      let confirmedCache;
      const readLineIsConfirmed = async () => {
        if (confirmedCache !== undefined) return confirmedCache;
        try {
          const toResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getTransferOrders',
            uriParams: { equipmentRequestId: Number(requestId) }
          });
          const tos = (toResp && toResp.ok && toResp.body && toResp.body.data) || [];
          confirmedCache = await lineConfirmed.lineIsConfirmed(context, Actions, tos, lineId);
        } catch (e) {
          console.warn('[saveLineChain] confirmed-check failed — treating as unconfirmed:', e);
          confirmedCache = false;
        }
        return confirmedCache;
      };

      if (pendingAssignments.length || pendingReleases.length) {
        const lineIsConfirmedNow = await readLineIsConfirmed();

        if (lineIsConfirmedNow) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Line already confirmed',
            message: 'A Transfer Order has been created for this line, so its equipment ' +
                     'can no longer be changed. Assignments and releases are closed once ' +
                     'the line is confirmed.',
            displayMode: 'persist',
            type: 'error'
          });
          return;
        }
      }

      const preAllocStatusFor = () => {
        const ld = $page.variables.lineData || {};
        return ld.quoting_on ? 'QUOTE_ACCEPTED' : 'IN_PROCESS';
      };

      // This line's CURRENT lineStatus as the DB has it. Prefers the value the
      // stale-check already read; only hits the network when that didn't resolve
      // (knownLineStatus is set to the value — possibly null — once fetched).
      // Both the ALLOCATED promotion and the release demotion need it, in all
      // three allocation modes, which is why it lives here rather than being
      // re-inlined per branch.
      const readCurrentLineStatus = async () => {
        if (knownLineStatusFetched) return knownLineStatus;
        try {
          const cur = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
            uriParams: { requestId: Number(requestId), size: 2000 }
          });
          if (cur && cur.ok && cur.body && Array.isArray(cur.body.data)) {
            const row = cur.body.data.find(l => Number(l.id) === Number(lineId));
            if (row) {
              knownLineStatus        = row.lineStatus;
              knownLineStatusFetched = true;
              return row.lineStatus;
            }
          }
        } catch (e) {
          console.warn('[saveLineChain] failed to fetch current lineStatus:', e);
        }
        return null;
      };


      // ── "Anything to save?" detection ─────────────────────────────────
      // Save runs only when the DB is out of sync with the view. Four ways
      // that can be true:
      //   1. staged assignments waiting to be POSTed
      //   2. staged releases waiting to be PATCHed
      //   3. picker dates differ from DB
      //   4. lineStatus is stale — line has enough allocations to be
      //      ALLOCATED but DB lineStatus is still in a pre-allocated state
      //      (legacy from old Auto Allocate path, or any cascade that missed)
      // Current lineStatus, read once here during the stale-check and reused by
      // the ALLOCATED-cascade blocks below (which previously each refetched the
      // lines list just to read this same field). `undefined` means "not yet
      // resolved" — the cascade blocks fall back to a refetch only in that case.
      let knownLineStatus;        // set to the value (incl. null) once fetched
      let knownLineStatusFetched = false;

      // Active allocations as read at the TOP of the chain (before any
      // release/assign writes). Reused by step 4 ONLY when this save makes no
      // allocation changes (dates-only / status-only) — in that case the list
      // can't have changed, so we skip the refetch. `null` = not captured.
      let preWriteActiveAllocations = null;

      let lineStatusStale = false;
      try {
        const lineQty = $page.variables.lineData.qty || 1;
        const allocResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getAllocations',
          uriParams: { requestLineId: Number(lineId) }
        });
        const activeList = (allocResp && allocResp.ok)
          ? ((allocResp.body && allocResp.body.data) || [])
              .filter(a => (a.allocationStatus || '').toUpperCase() !== 'RELEASED')
          : [];
        preWriteActiveAllocations = activeList;
        const activeCount = activeList.length;

        if (activeCount >= lineQty) {
          const linesResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
            uriParams: { requestId: Number(requestId), size: 2000 }
          });
          if (linesResp && linesResp.ok && linesResp.body && Array.isArray(linesResp.body.data)) {
            const row = linesResp.body.data.find(l => Number(l.id) === Number(lineId));
            knownLineStatus = row ? row.lineStatus : null;
            knownLineStatusFetched = true;
            const CASCADABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_ACCEPTED'];
            if (CASCADABLE.indexOf(knownLineStatus) !== -1) lineStatusStale = true;
          }
        }
      } catch (e) {
        console.warn('[saveLineChain] stale-check failed (will fall through):', e);
      }

      if (!pendingAssignments.length && !pendingReleases.length && !datesChanged && !lineStatusStale) {
        await Actions.fireNotificationEvent(context, {
          summary:     'No changes',
          message:     'Nothing to save — the line is already up to date.',
          type:        'info',
          displayMode: 'transient'
        });
        return;
      }

      // Validate the adjusted date window — End must be >= Start.
      if (datesChanged) {
        const startMs = newStart ? new Date(asDay(newStart) + 'T00:00:00Z').getTime() : NaN;
        const endMs   = newEnd   ? new Date(asDay(newEnd)   + 'T00:00:00Z').getTime() : NaN;
        if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
          await Actions.fireNotificationEvent(context, {
            summary:     'Invalid date range',
            message:     'End Date must be on or after Start Date.',
            type:        'error',
            displayMode: 'transient'
          });
          return;
        }
      }

      $page.variables.isSaving = true;
      const today  = new Date().toISOString();
      const errors = [];

      // Mode comes authoritatively from the page module (getStagedChanges()
      // now returns it). Lot and inventory staging records have identical
      // shape ({qty, lotNumber}) so we cannot reliably detect
      // inventory mode from staged data alone. Fall back to shape-based
      // detection only when mode is missing (legacy safety net).
      const stagedMode = staged.mode || null;
      const sample = pendingAssignments[0] || pendingReleases[0] || null;
      const shapeIsQty = sample && sample.qty != null;
      const isLotMode = (stagedMode === 'lot') || (!stagedMode && shapeIsQty);
      const isInventoryMode = (stagedMode === 'inventory');

      // ── 1. Process releases first (free up before re-allocating) ────────
      for (const rel of pendingReleases) {
        try {
          const r1 = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchAllocation',
            uriParams: { id: Number(rel.allocationId) },
            body: {
              allocationStatus: 'RELEASED',
              releasedDate:     today,
            }
          });
          if (!r1 || !r1.ok) {
            errors.push('Release allocation ' + rel.allocationId + ' failed (HTTP ' + (r1?.status || '?') + ')');
            continue;
          }

          if (isLotMode) {
            // Lot release — return qty to the reservable pool by INCREMENTING
            // availableToReserve (ATR). onHandQty (total owned) and reservedQty
            // are NOT touched: the user reserves purely out of ATR. Read
            // current ATR first to math against the authoritative value.
            const releasedQty = Number(rel.qty || 0);
            if (releasedQty > 0 && rel.eqrLotRefId != null) {
              let curAtr = null;
              try {
                const lotGet = await Actions.callRest(context, {
                  endpoint:  'eqp-v1/getLotRefById',
                  uriParams: { id: Number(rel.eqrLotRefId) }
                });
                if (lotGet && lotGet.ok && lotGet.body && lotGet.body.availableToReserve != null) {
                  curAtr = Number(lotGet.body.availableToReserve);
                }
              } catch (e) { /* tolerate; we'll skip the patch */ }
              if (curAtr != null) {
                const r2 = await Actions.callRest(context, {
                  endpoint:  'eqp-v1/patchLotRef',
                  uriParams: { id: Number(rel.eqrLotRefId) },
                  body: { availableToReserve: curAtr + releasedQty }
                });
                if (!r2 || !r2.ok) {
                  errors.push('Return lot ' + rel.lotNumber + ' to ATR failed (HTTP ' + (r2?.status || '?') + ')');
                }
              }
            }
          } else if (isInventoryMode) {
            // Inventory release — return qty to the reservable pool by
            // INCREMENTING availableToReserve (ATR). `quantity` (total owned)
            // is left untouched; only ATR moves. Read current ATR first so we
            // math against the authoritative value, not stale UI numbers.
            const releasedQty = Number(rel.qty || rel.allocatedQty || 0);
            const invRefId    = Number(rel.inventoryItemRefId);
            if (releasedQty > 0 && invRefId) {
              let curAtr = null;
              try {
                const invGet = await Actions.callRest(context, {
                  endpoint:  'eqp-v1/getInventoryItemRefById',
                  uriParams: { id: Number(rel.inventoryItemRefId != null ? rel.inventoryItemRefId : assn?.inventoryItemRefId) }
                });
                if (invGet && invGet.ok && invGet.body && invGet.body.availableToReserve != null) {
                  curAtr = Number(invGet.body.availableToReserve);
                }
              } catch (e) { /* tolerate; we'll skip the patch */ }
              if (curAtr != null) {
                const r2 = await Actions.callRest(context, {
                  endpoint:  'eqp-v1/patchInventoryItemRef',
                  uriParams: { id: Number(rel.inventoryItemRefId != null ? rel.inventoryItemRefId : assn?.inventoryItemRefId) },
                  body: { availableToReserve: curAtr + releasedQty }
                });
                if (!r2 || !r2.ok) {
                  errors.push('Return inventory ' + (rel.itemNumber || rel.lotNumber || invRefId) + ' to ATR failed (HTTP ' + (r2?.status || '?') + ')');
                }
              }
            }
          } else {
            // Serial release - EQR_SERIAL_REF carries unitStatus.
            if (rel.eqrSerialRefId != null) {
              const ru = await Actions.callRest(context, {
                endpoint:  'eqp-v1/patchSerialRef',
                uriParams: { id: Number(rel.eqrSerialRefId) },
                body: { unitStatus: 'AVAILABLE' }
              });
              if (!ru || !ru.ok) {
                errors.push('Release unit ' + rel.serialNumber + ' failed (HTTP ' + (ru?.status || '?') + ')');
              }
            }

            const r2 = { ok: true };
            if (!r2 || !r2.ok) {
              errors.push('Set serial ' + rel.serialNumber + ' AVAILABLE failed (HTTP ' + (r2?.status || '?') + ')');
            }
          }
        } catch (e) {
          errors.push('Release error for ' + (rel.serialNumber || rel.lotNumber) + ': ' + (e?.message || e));
        }
      }

      // ── 2. Process new assignments ──────────────────────────────────────
      for (const assn of pendingAssignments) {
        try {
          if (isLotMode) {
            const assnQty = Math.max(1, Number(assn.qty || 0));
            const r1 = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createAllocation',
              body: {
                requestLineId:    Number(lineId),
                lotRefId:         Number(assn.eqrLotRefId),

                allocatedQty:     assnQty,
                allocationStatus: 'ALLOCATED',
                allocatedDate:    today,
                ...orgFields(assn),
              }
            });
            if (!r1 || !r1.ok) {
              errors.push('Create lot allocation for ' + assn.lotNumber + ' failed (HTTP ' + (r1?.status || '?') + ')');
              continue;
            }

            // Reserve the qty by DECREMENTING availableToReserve (ATR). The
            // user reserves purely out of ATR — onHandQty (total owned) and
            // reservedQty are NOT touched. Read current ATR first to math
            // against the authoritative value.
            let curAtr = null;
            try {
              const lotGet = await Actions.callRest(context, {
                endpoint:  'eqp-v1/getLotRefById',
                uriParams: { id: Number(assn.eqrLotRefId) }
              });
              if (lotGet && lotGet.ok && lotGet.body && lotGet.body.availableToReserve != null) {
                curAtr = Number(lotGet.body.availableToReserve);
              }
            } catch (e) { /* tolerate */ }
            if (curAtr != null) {
              const r2 = await Actions.callRest(context, {
                endpoint:  'eqp-v1/patchLotRef',
                uriParams: { id: Number(assn.eqrLotRefId) },
                body: { availableToReserve: Math.max(0, curAtr - assnQty) }
              });
              if (!r2 || !r2.ok) {
                errors.push('Reserve lot ' + assn.lotNumber + ' from ATR failed (HTTP ' + (r2?.status || '?') + ')');
              }
            }
          } else if (isInventoryMode) {
            const assnQty = Math.max(1, Number(assn.qty || 0));
            const invRefId = Number(assn.inventoryItemRefId);
            const r1 = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createAllocation',
              body: {
                requestLineId:      Number(lineId),
                inventoryItemRefId: invRefId,
                allocatedQty:       assnQty,
                allocationStatus:   'ALLOCATED',
                allocatedDate:      today,
                ...orgFields(assn),
              }
            });
            if (!r1 || !r1.ok) {
              const itemLabel = assn.itemNumber || assn.lotNumber || ('item ' + invRefId);
              errors.push('Create inventory allocation for ' + itemLabel + ' failed (HTTP ' + (r1?.status || '?') + ')');
              continue;
            }

            // Reserve the qty by DECREMENTING availableToReserve (ATR).
            // `quantity` (total owned) is left untouched — only ATR moves.
            // Read current ATR first so we math against authoritative values.
            let curAtr = null;
            try {
              const invGet = await Actions.callRest(context, {
                endpoint:  'eqp-v1/getInventoryItemRefById',
                uriParams: { id: invRefId }
              });
              if (invGet && invGet.ok && invGet.body && invGet.body.availableToReserve != null) {
                curAtr = Number(invGet.body.availableToReserve);
              }
            } catch (e) { /* tolerate */ }
            if (curAtr != null) {
              const r2 = await Actions.callRest(context, {
                endpoint:  'eqp-v1/patchInventoryItemRef',
                uriParams: { id: invRefId },
                body: { availableToReserve: Math.max(0, curAtr - assnQty) }
              });
              if (!r2 || !r2.ok) {
                errors.push('Reserve inventory ' + (assn.itemNumber || assn.lotNumber || invRefId) + ' from ATR failed (HTTP ' + (r2?.status || '?') + ')');
              }
            }
          } else {
            // EQR_ALLOCATION carries one FK per unit type; serialRefId is the
            // one declared for serial units. createAllocation's body schema
            // declares serialRefId and lotRefId - an undeclared field is
            // passed straight through rather than rejected, so sending the
            // wrong name writes a row with a NULL unit reference.
            const r1 = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createAllocation',
              body: {
                requestLineId:    Number(lineId),
                serialRefId:      Number(assn.eqrSerialRefId),
                allocatedQty:     1,
                allocationStatus: 'ALLOCATED',
                allocatedDate:    today,
                ...orgFields(assn),
              }
            });
            if (!r1 || !r1.ok) {
              errors.push('Create allocation for ' + assn.serialNumber + ' failed (HTTP ' + (r1?.status || '?') + ')');
              continue;
            }

            // Status goes to EQR_SERIAL_REF, which is where unitStatus lives
            // for serial units (lot and item rows carry lotStatus / itemStatus
            // instead and are handled by the branches above).
            const ru = await Actions.callRest(context, {
              endpoint:  'eqp-v1/patchSerialRef',
              uriParams: { id: Number(assn.eqrSerialRefId) },
              body: { unitStatus: 'RENTED' }
            });
            if (!ru || !ru.ok) {
              errors.push('Set unit ' + assn.serialNumber + ' RENTED failed (HTTP ' + (ru?.status || '?') + ')');
            }

          }
        } catch (e) {
          errors.push('Assignment error for ' + (assn.serialNumber || assn.lotNumber) + ': ' + (e?.message || e));
        }
      }

      // ── 3. Refetch workbench-requests view to confirm allocation state ──
      let viewError = null;
      try {
        const viewResponse = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsWorkbenchRequests',
          uriParams: { eqrEquipmentRequestId: Number(requestId) }
        });
        if (viewResponse && viewResponse.ok) {
          // Server-side scoped by eqrEquipmentRequestId — rows are this
          // request's lines; pick out the one we just saved.
          const requestRows = viewResponse.body.data || [];
          const lineRow = requestRows.find(r => String(r.eqrRequestLineId) === String(lineId));
          if (lineRow) {
            $page.variables.lineData = {
              ...$page.variables.lineData,
              alloc_status:     lineRow.allocStatus     || 'PENDING',
              allocated_serial: lineRow.allocatedSerial || '',
              allocated_qty:    lineRow.allocatedQty    || 0,
            };
          }
        } else {
          viewError = 'Refetch workbench-requests failed (HTTP ' + (viewResponse?.status || '?') + ')';
        }
      } catch (e) {
        viewError = 'Refetch error: ' + (e?.message || e);
      }

      // ── 4. Refetch allocations + (serials | lot-refs) so the Bryntum UI
      //       reflects truth. When this save wrote no allocation changes
      //       (dates-only / status-only), the list captured at the top of the
      //       chain is still authoritative — reuse it and skip the refetch.
      const wroteAllocations = pendingAssignments.length > 0 || pendingReleases.length > 0;
      let activeAllocations = [];
      if (!wroteAllocations && preWriteActiveAllocations !== null) {
        activeAllocations = preWriteActiveAllocations;
      } else {
        try {
          const allocResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getAllocations',
            uriParams: { requestLineId: Number(lineId) }
          });
          if (allocResp && allocResp.ok) {
            activeAllocations = (allocResp.body.data || [])
              .filter(a => (a.allocationStatus || '').toUpperCase() !== 'RELEASED');
          }
        } catch (e) { /* tolerate */ }
      }

      // ─────────────────────────────────────────────────────────────────
      // LOT MODE post-save rebuild — refetch lot-refs, rebuild resources,
      // patch line status by allocated QTY, re-init scheduler, return.
      // ─────────────────────────────────────────────────────────────────
      if (isLotMode) {
        const eqpMasterIdLot = $page.variables.equipmentMasterId || $page.variables.lineData.equipment_master_id;
        const eqpInfoLot = {
          equipmentName: $page.variables.lineData.equipment_name || '',
          className:     $page.variables.lineData.class          || '',
        };
        let lotResources = [];
        let allocatedLots = [];

        // Post-save lot rebuild from line-detail-units (unitType=LOT) via the
        // shared builder — server ATR + allocationId off the row, ATR only.
        try {
          const unitsResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
            uriParams: { requestId: Number(requestId), lineId: Number(lineId), size: 10000 }
          });
          if (unitsResp && unitsResp.ok && unitsResp.body && Array.isArray(unitsResp.body.data)) {
            const built = lineDetailUnits.buildResources(unitsResp.body.data, 'lot', eqpInfoLot, eqpMasterIdLot);
            lotResources = built.resources;
            allocatedLots = built.allocated;
          }
        } catch (e) { /* tolerate */ }

        // Update line status by allocated QTY (sum of allocatedQty across
        // ALLOCATED rows), not row count.
        try {
          const lineQty       = $page.variables.lineData.qty || 1;
          const allocatedUnits = allocatedLots.reduce((sum, a) => sum + Number(a.allocatedQty || 0), 0);
          let newLineStatus;
          if (allocatedUnits === 0)             newLineStatus = 'PENDING';
          else if (allocatedUnits >= lineQty)   newLineStatus = 'ALLOCATED';
          else                                  newLineStatus = 'PARTIAL';

          const body = { allocationStatus: newLineStatus };
          if (datesChanged) {
            body.startDate = toISODate(newStart);
            body.endDate   = toISODate(newEnd);
          }
          if (newLineStatus === 'ALLOCATED') {
            const CASCADABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_ACCEPTED'];
            const currentLineStatus = await readCurrentLineStatus();
            if (CASCADABLE.indexOf(currentLineStatus) !== -1) body.lineStatus = 'ALLOCATED';
          } else if (newLineStatus === 'PENDING') {
            // Demote on full release — see the serial branch for why this must
            // mirror the promotion, and why it only fires from ALLOCATED.
            const currentLineStatus = await readCurrentLineStatus();
            if (String(currentLineStatus || '').toUpperCase() === 'ALLOCATED') {
              body.lineStatus = preAllocStatusFor();
            }
          }
          const lineStatusResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchRequestLine',
            uriParams: { requestId: Number(requestId), id: Number(lineId) },
            body:      body
          });
          if (!lineStatusResp || !lineStatusResp.ok) {
            console.warn('[saveLineChain LOT] PATCH request-line status failed (HTTP ' + (lineStatusResp && lineStatusResp.status) + ')');
          } else {
            const patch = { alloc_status: newLineStatus };
            if (body.lineStatus) patch.line_status = body.lineStatus;
            if (datesChanged) {
              patch.start_date = asDay(newStart);
              patch.end_date   = asDay(newEnd);
            }
            $page.variables.lineData = { ...$page.variables.lineData, ...patch };
          }
        } catch (e) {
          console.warn('[saveLineChain LOT] PATCH line status threw:', e);
        }

        $page.variables.lineHasAllocations = allocatedLots.length > 0;
        $page.functions.initScheduler(lotResources, [], $page.variables.lineData, allocatedLots, 'lot');

        $page.variables.isSaving = false;

        if (errors.length || viewError) {
          try {
            await Actions.fireNotificationEvent(context, {
              summary:     'Save partially failed',
              message:     [...errors, viewError].filter(Boolean).join('\n'),
              type:        'error',
              displayMode: 'persist'
            });
          } catch (e) { /* noop */ }
          return;
        }
        try {
          const total = pendingAssignments.length + pendingReleases.length;
          const message = total > 0
            ? (total + ' lot change' + (total === 1 ? '' : 's') + ' applied successfully.')
            : (datesChanged ? 'Line updated.' : 'Line is up to date.');
          await Actions.fireNotificationEvent(context, {
            summary:     'Saved',
            message:     message,
            type:        'confirmation',
            displayMode: 'transient'
          });
        } catch (e) { /* noop */ }
        await Actions.navigateToPage(context, {
          page: 'request-detail',
          params: {
            requestId:     String(requestId),
            requestNumber: String($page.variables.requestNumber || ''),
          }
        });
        return;
      }

      // ─────────────────────────────────────────────────────────────────
      // INVENTORY MODE post-save rebuild — refetch inventory-item-refs,
      // filter client-side by master id, rebuild resources in lot-shape,
      // patch line status by allocated QTY, re-init scheduler, return.
      // Mirrors the LOT branch but with no source-table patch (Fusion
      // owns the inventory quantity).
      // ─────────────────────────────────────────────────────────────────
      if (isInventoryMode) {
        const eqpMasterIdInv = $page.variables.equipmentMasterId || $page.variables.lineData.equipment_master_id;
        const eqpInfoInv = {
          equipmentName: $page.variables.lineData.equipment_name || '',
          className:     $page.variables.lineData.class          || '',
        };
        let invResources = [];
        let allocatedInventory = [];

        // Post-save inventory rebuild from line-detail-units (unitType=
        // INVENTORY) via the shared builder — lot-shaped for the renderer, ATR.
        try {
          const unitsResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
            uriParams: { requestId: Number(requestId), lineId: Number(lineId), size: 10000 }
          });
          if (unitsResp && unitsResp.ok && unitsResp.body && Array.isArray(unitsResp.body.data)) {
            const built = lineDetailUnits.buildResources(unitsResp.body.data, 'inventory', eqpInfoInv, eqpMasterIdInv);
            invResources = built.resources;
            allocatedInventory = built.allocated;
          }
        } catch (e) { /* tolerate */ }

        // Line status by allocated QTY (same as lot).
        try {
          const lineQty        = $page.variables.lineData.qty || 1;
          const allocatedUnits = allocatedInventory.reduce((sum, a) => sum + Number(a.allocatedQty || 0), 0);
          let newLineStatus;
          if (allocatedUnits === 0)             newLineStatus = 'PENDING';
          else if (allocatedUnits >= lineQty)   newLineStatus = 'ALLOCATED';
          else                                  newLineStatus = 'PARTIAL';

          const body = { allocationStatus: newLineStatus };
          if (datesChanged) {
            body.startDate = toISODate(newStart);
            body.endDate   = toISODate(newEnd);
          }
          if (newLineStatus === 'ALLOCATED') {
            const CASCADABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_ACCEPTED'];
            const currentLineStatus = await readCurrentLineStatus();
            if (CASCADABLE.indexOf(currentLineStatus) !== -1) body.lineStatus = 'ALLOCATED';
          } else if (newLineStatus === 'PENDING') {
            // Demote on full release — see the serial branch for why this must
            // mirror the promotion, and why it only fires from ALLOCATED.
            const currentLineStatus = await readCurrentLineStatus();
            if (String(currentLineStatus || '').toUpperCase() === 'ALLOCATED') {
              body.lineStatus = preAllocStatusFor();
            }
          }
          const lineStatusResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchRequestLine',
            uriParams: { requestId: Number(requestId), id: Number(lineId) },
            body:      body
          });
          if (!lineStatusResp || !lineStatusResp.ok) {
            console.warn('[saveLineChain INV] PATCH request-line status failed (HTTP ' + (lineStatusResp && lineStatusResp.status) + ')');
          } else {
            const patch = { alloc_status: newLineStatus };
            if (body.lineStatus) patch.line_status = body.lineStatus;
            if (datesChanged) {
              patch.start_date = asDay(newStart);
              patch.end_date   = asDay(newEnd);
            }
            $page.variables.lineData = { ...$page.variables.lineData, ...patch };
          }
        } catch (e) {
          console.warn('[saveLineChain INV] PATCH line status threw:', e);
        }

        $page.variables.lineHasAllocations = allocatedInventory.length > 0;
        $page.functions.initScheduler(invResources, [], $page.variables.lineData, allocatedInventory, 'inventory');

        $page.variables.isSaving = false;

        if (errors.length || viewError) {
          try {
            await Actions.fireNotificationEvent(context, {
              summary:     'Save partially failed',
              message:     [...errors, viewError].filter(Boolean).join('\n'),
              type:        'error',
              displayMode: 'persist'
            });
          } catch (e) { /* noop */ }
          return;
        }
        try {
          const total = pendingAssignments.length + pendingReleases.length;
          const message = total > 0
            ? (total + ' inventory change' + (total === 1 ? '' : 's') + ' applied successfully.')
            : (datesChanged ? 'Line updated.' : 'Line is up to date.');
          await Actions.fireNotificationEvent(context, {
            summary:     'Saved',
            message:     message,
            type:        'confirmation',
            displayMode: 'transient'
          });
        } catch (e) { /* noop */ }
        await Actions.navigateToPage(context, {
          page: 'request-detail',
          params: {
            requestId:     String(requestId),
            requestNumber: String($page.variables.requestNumber || ''),
          }
        });
        return;
      }

      const eqpMasterId = $page.variables.equipmentMasterId || $page.variables.lineData.equipment_master_id;
      const eqpInfo = {
        equipmentName: $page.variables.lineData.equipment_name || '',
        className:     $page.variables.lineData.class          || '',
      };
      let resources = [];
      let allocatedSerials = [];

      // Post-save serial rebuild reads line-detail-units (same view + shared
      // builder as the load path) — per-unit availabilityStatus computed
      // server-side, allocationId off the row. Block-(a) bar logic below reuses
      // `resources` / `allocatedSerials`.
      try {
        const unitsResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
          uriParams: { requestId: Number(requestId), lineId: Number(lineId), size: 10000 }
        });
        if (unitsResp && unitsResp.ok && unitsResp.body && Array.isArray(unitsResp.body.data)) {
          const built = lineDetailUnits.buildResources(unitsResp.body.data, 'serial', eqpInfo, eqpMasterId);
          resources = built.resources;
          allocatedSerials = built.allocated;
        }
      } catch (e) { /* tolerate */ }

      // ── 5a. Recompute + PATCH this request line's allocationStatus ─────
      // Workbench view computes allocation_pct from rl.allocation_status =
      // 'ALLOCATED', so we MUST update the line's own status field after any
      // allocation/release for the workbench bar to move.
      try {
        const lineQty       = $page.variables.lineData.qty || 1;
        const allocatedNow  = allocatedSerials.length;
        let newLineStatus;
        if (allocatedNow === 0)             newLineStatus = 'PENDING';
        else if (allocatedNow >= lineQty)   newLineStatus = 'ALLOCATED';
        else                                newLineStatus = 'PARTIAL';

        // On full allocation, also cascade lineStatus = 'ALLOCATED' — but only
        // when current lineStatus is in the cascadable set, so we don't rewind
        // a line that's already past this point (SHIP_TO_SITE, DEPLOYED, ...).
        const body = { allocationStatus: newLineStatus };

        // If the user edited the line's dates via the "Adjust for this line"
        // pickers, persist them in the same PATCH.
        if (datesChanged) {
          body.startDate = toISODate(newStart);
          body.endDate   = toISODate(newEnd);
        }

        if (newLineStatus === 'ALLOCATED') {
          const CASCADABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_ACCEPTED'];
          const currentLineStatus = await readCurrentLineStatus();
          if (CASCADABLE.indexOf(currentLineStatus) !== -1) {
            body.lineStatus = 'ALLOCATED';
          }
        } else if (newLineStatus === 'PENDING') {
          // ── DEMOTE on full release ──────────────────────────────────────
          // Releasing every unit has to put lineStatus BACK to the
          // pre-allocation state, or the line is trapped: allocating promoted
          // it to ALLOCATED, and the allocation gate above accepts only the
          // pre-allocation status — so after a release the user could never
          // allocate again. allocationStatus was already recomputed correctly
          // on release; only lineStatus was one-way, which also left the two
          // columns disagreeing (allocationStatus PENDING vs lineStatus
          // ALLOCATED) on the same row.
          //
          // ONLY from ALLOCATED. A line further down the lifecycle
          // (SHIPPED_TO_SITE, DEPLOYED, ...) must not be rewound by a release,
          // and a line already at the pre-allocation status needs no write.
          const currentLineStatus = await readCurrentLineStatus();
          if (String(currentLineStatus || '').toUpperCase() === 'ALLOCATED') {
            body.lineStatus = preAllocStatusFor();
          }
        }

        const lineStatusResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchRequestLine',
          uriParams: { requestId: Number(requestId), id: Number(lineId) },
          body:      body
        });
        if (!lineStatusResp || !lineStatusResp.ok) {
          console.warn('[saveLineChain] PATCH request-line status failed (HTTP ' + (lineStatusResp && lineStatusResp.status) + ')');
        } else {
          const patch = { alloc_status: newLineStatus };
          if (body.lineStatus) patch.line_status = body.lineStatus;
          if (datesChanged) {
            patch.start_date = asDay(newStart);
            patch.end_date   = asDay(newEnd);
          }
          $page.variables.lineData = { ...$page.variables.lineData, ...patch };
        }
      } catch (e) {
        console.warn('[saveLineChain] PATCH request-line status threw:', e);
      }

      // ── 5b. Rebuild event bars. (a) THIS line's bar from the allocations
      //       table (instant, no view lag). (b) cross-request "Booked" bars
      //       from line-detail-bookings (join by unitRefId == resource.id).
      //       Statuses were already set from line-detail-units in step 1 —
      //       no workbench-lines / availability.js pass needed.
      let events = [];
      try {
        // See resources/js/bryntumDates.js — Bryntum endDate is exclusive;
        // bump +1 day so bars visually cover through the inclusive backend end.
        const inclusiveEnd = bryntumDates.inclusiveEnd;
        const myReqNumber = $page.variables.requestNumber || '';

        // Is THIS LINE confirmed? PER-LINE + status-aware (a live TO on the same
        // line — fusionToStatus==='TO_CREATED' — via resources/js/lineConfirmed).
        // Allocations on a confirmed line render as
        // Booked (blue); unconfirmed as Reserving (orange). A TO on a sibling
        // line must NOT paint this line's bars Booked.
        // Same signal as the allocation gate at the top of the chain, so the
        // bars can never disagree with what the gate decided. Memoized there.
        const currentLineConfirmed = await readLineIsConfirmed();

        // (a) Current-line bar(s) synthesised from activeAllocations + the
        // line's own start/end. Read directly from the allocations table
        // (no view-refresh lag) so the bar appears immediately after Save.
        let evtSeq = 1;
        const lineStart = $page.variables.lineData.start_date;
        const lineEnd   = $page.variables.lineData.end_date;
        activeAllocations.forEach(a => {
          // Allocations carry one FK per unit type; the resource rows come
          // from views/line-detail-units, whose unitRefId is the matching
          // per-type ref id. Compare against whichever FK this allocation has.
          const allocRefId = a.eqrSerialRefId != null ? a.eqrSerialRefId
                           : a.eqrLotRefId    != null ? a.eqrLotRefId
                           : a.inventoryItemRefId;
          const matchingResource = resources.find(r =>
            allocRefId != null && Number(r.unitRefId) === Number(allocRefId));
          if (!matchingResource) return;
          if (!lineStart || !lineEnd) return;
          events.push({
            id:          'evt-' + (evtSeq++),
            resourceId:  matchingResource.id,
            name:        currentLineConfirmed ? 'Booked' : 'Reserving',
            startDate:   lineStart,
            endDate:     inclusiveEnd(lineEnd),
            eventColor:  currentLineConfirmed ? '#1565C0' : '#f59e0b',
            requestNumber: myReqNumber,
          });
        });

        // (b) Other requests' bars from line-detail-bookings (join by unitRefId
        // == resource.id; skip OUR request, dedupe exact-duplicate rows).
        const resourceIds = new Set(resources.map(r => Number(r.id)));
        let bookingRows = [];
        if (eqpMasterId) {
          try {
            const bookingsResp = await Actions.callRest(context, {
              endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailBookings',
              uriParams: { equipmentMasterId: Number(eqpMasterId), size: 10000 }
            });
            if (bookingsResp && bookingsResp.ok && bookingsResp.body && Array.isArray(bookingsResp.body.data)) {
              bookingRows = bookingsResp.body.data;
            }
          } catch (e) {
            console.warn('[saveLineChain] line-detail-bookings fetch failed:', e);
          }
        }

        const seenBooking = new Set();
        bookingRows.forEach(b => {
          if (!b) return;
          if (String(b.bookingRequestNumber || '') === String(myReqNumber || '')) return;
          const resId = Number(b.unitRefId);
          if (!resourceIds.has(resId)) return;
          const barStart = b.bookingStartDate;
          const barEnd   = b.bookingEndDate;
          if (!barStart || !barEnd) return;
          const dedupeKey = resId + '|' + (b.bookingRequestNumber || '') + '|' + barStart + '|' + barEnd;
          if (seenBooking.has(dedupeKey)) return;
          seenBooking.add(dedupeKey);

          events.push({
            id:          'evt-' + (evtSeq++),
            resourceId:  resId,
            name:        'Booked',
            startDate:   barStart,
            endDate:     inclusiveEnd(barEnd),
            eventColor:  '#1565C0',
            requestNumber: b.bookingRequestNumber || '',
            projectName:  b.projectName || '',
            taskName:     b.taskName || '',
          });
        });
      } catch (e) {
        console.warn('[saveLineChain] event-bar rebuild failed:', e);
      }

      // Keep the date-picker lock flag in sync with current allocations.
      $page.variables.lineHasAllocations = allocatedSerials.length > 0;

      // ── 5c. Push fresh data into Bryntum (initScheduler resets staging
      //       internally because it accepts allocatedSerials as 4th arg) ────
      $page.functions.initScheduler(resources, events, $page.variables.lineData, allocatedSerials, 'serial');

      $page.variables.isSaving = false;

      // ── 6. Notify (toast errors are non-fatal) ──────────────────────────
      if (errors.length || viewError) {
        try {
          await Actions.fireNotificationEvent(context, {
            summary:     'Save partially failed',
            message:     [...errors, viewError].filter(Boolean).join('\n'),
            type:        'error',
            displayMode: 'persist'
          });
        } catch (e) {
          console.warn('[saveLineChain] toast (error) failed to render — continuing:', e);
        }
        // Stay on the line-detail page so the user can retry / inspect.
        return;
      }

      try {
        const total = pendingAssignments.length + pendingReleases.length;
        const message = total > 0
          ? (total + ' allocation change' + (total === 1 ? '' : 's') + ' applied successfully.')
          : (datesChanged ? 'Line updated.' : 'Line is up to date.');
        await Actions.fireNotificationEvent(context, {
          summary:     'Saved',
          message:     message,
          type:        'confirmation',
          displayMode: 'transient'
        });
      } catch (e) {
        console.warn('[saveLineChain] toast (success) failed to render — continuing:', e);
      }

      // ── 7. Navigate back to the parent request-detail page ──────────────
      await Actions.navigateToPage(context, {
        page: 'request-detail',
        params: {
          requestId:     String(requestId),
          requestNumber: String($page.variables.requestNumber || ''),
        }
      });
    }
  }

  return saveLineChain;
});

