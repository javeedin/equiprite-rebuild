define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/lineDetailUnits',
  'resources/js/lineConfirmed',
], (ActionChain, Actions, lineDetailUnits, lineConfirmed) => {
  'use strict';

  // Saves the staged allocation of the open line. Carried over from the old line-detail page's Save
  // (equipment-foundation line-detail-page-chains/saveLineChain.js); the writes, their bodies and their order are
  // the same:
  //   0. gate     getTransferOrders (+ getTransferOrderLines, lineConfirmed): a line with a live Transfer Order is
  //               confirmed, and nothing on it may change
  //   0b. stale   getAllocations (and the lines, when the line already has its quantity) as the old chain reads them
  //   1. releases patchAllocation RELEASED, then per mode:
  //               serial     patchSerialRef unitStatus AVAILABLE
  //               lot        getLotRefById, patchLotRef availableToReserve + qty
  //               inventory  getInventoryItemRefById, patchInventoryItemRef availableToReserve + qty
  //   2. assigns  createAllocation (serialRefId | lotRefId | inventoryItemRefId, allocatedQty, ALLOCATED, today,
  //               the unit's inventory org), then
  //               serial     patchSerialRef unitStatus RENTED
  //               lot        getLotRefById, patchLotRef availableToReserve − qty
  //               inventory  getInventoryItemRefById, patchInventoryItemRef availableToReserve − qty
  //   3. the line views/line-detail-units again, then patchRequestLine allocationStatus PENDING | PARTIAL |
  //               ALLOCATED, with lineStatus ALLOCATED on full allocation from a pre-allocation status, or back to
  //               IN_PROCESS (QUOTE_ACCEPTED when quoted) when the last unit is released from an ALLOCATED line
  // Left out: the old page's line date adjustment (dates are never changed here, so no startDate / endDate is sent;
  // adjusting a line's dates stays in Old EquipRite) and the reads that only redrew the old scheduler afterwards
  // (workbench-requests, the allocations list, line-detail-bookings): the picker is reloaded instead. The old page
  // then went back to the request; here the request's lines and the picker are refreshed in place.

  // Denormalize the allocated unit's inventory org onto the allocation row (old orgFields).
  function orgFields(assn) {
    if (!assn || assn.invOrgId == null) return {};
    return {
      eqpInvOrgId:   Number(assn.invOrgId),
      eqpInvOrgName: assn.invOrgName || '',
    };
  }

  const CASCADABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_ACCEPTED'];

  class saveAllocationChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const lineData = v.allocLine;
      if (!lineData || v.isSaving) {
        return;
      }
      const requestId = v.requestNumericId;
      const lineId    = lineData.line_id;

      const staged = ($page.functions.getStagedChanges && $page.functions.getStagedChanges()) || {};
      const pendingAssignments = staged.pendingAssignments || [];
      const pendingReleases    = staged.pendingReleases    || [];

      if (!pendingAssignments.length && !pendingReleases.length) {
        await Actions.fireNotificationEvent(context, {
          summary:     'No changes',
          message:     'Nothing to save — assign or release a unit first.',
          type:        'info',
          displayMode: 'transient'
        });
        return;
      }
      v.isSaving = true;
      try {
        await this.save(context, requestId, lineId, lineData, staged, pendingAssignments, pendingReleases);
      } finally {
        v.isSaving = false;
      }
    }

    async save(context, requestId, lineId, lineData, staged, pendingAssignments, pendingReleases) {
      const { $page } = context;

      // ── ALLOCATION GATE: has this line been CONFIRMED (a live Transfer Order)? Fails open on a lookup error. ──
      let lineIsConfirmedNow = false;
      try {
        const toResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getTransferOrders',
          uriParams: { equipmentRequestId: Number(requestId) }
        });
        const tos = (toResp && toResp.ok && toResp.body && toResp.body.data) || [];
        lineIsConfirmedNow = await lineConfirmed.lineIsConfirmed(context, Actions, tos, lineId);
      } catch (e) {
        console.warn('[saveAllocationChain] confirmed-check failed — treating as unconfirmed:', e);
        lineIsConfirmedNow = false;
      }
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

      const preAllocStatusFor = () => (lineData.quoting_on ? 'QUOTE_ACCEPTED' : 'IN_PROCESS');

      let knownLineStatus;
      let knownLineStatusFetched = false;
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
          console.warn('[saveAllocationChain] failed to fetch current lineStatus:', e);
        }
        return null;
      };

      // ── Stale check (old saveLineChain): active allocations, and the line's status when it has its quantity ──
      try {
        const lineQty = lineData.qty || 1;
        const allocResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getAllocations',
          uriParams: { requestLineId: Number(lineId) }
        });
        const activeList = (allocResp && allocResp.ok)
          ? ((allocResp.body && allocResp.body.data) || [])
              .filter(a => (a.allocationStatus || '').toUpperCase() !== 'RELEASED')
          : [];
        if (activeList.length >= lineQty) {
          const linesResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
            uriParams: { requestId: Number(requestId), size: 2000 }
          });
          if (linesResp && linesResp.ok && linesResp.body && Array.isArray(linesResp.body.data)) {
            const row = linesResp.body.data.find(l => Number(l.id) === Number(lineId));
            knownLineStatus = row ? row.lineStatus : null;
            knownLineStatusFetched = true;
          }
        }
      } catch (e) {
        console.warn('[saveAllocationChain] stale-check failed (will fall through):', e);
      }

      const today  = new Date().toISOString();
      const errors = [];
      const stagedMode = staged.mode || null;
      const sample = pendingAssignments[0] || pendingReleases[0] || null;
      const shapeIsQty = sample && sample.qty != null;
      const isLotMode = (stagedMode === 'lot') || (!stagedMode && shapeIsQty);
      const isInventoryMode = (stagedMode === 'inventory');

      // ── 1. Releases first (free up before re-allocating) ────────────────────────────────────────────────────
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
            errors.push('Release allocation ' + rel.allocationId + ' failed (HTTP ' + ((r1 && r1.status) || '?') + ')');
            continue;
          }
          if (isLotMode) {
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
              } catch (e) { /* tolerate; skip the patch */ }
              if (curAtr != null) {
                const r2 = await Actions.callRest(context, {
                  endpoint:  'eqp-v1/patchLotRef',
                  uriParams: { id: Number(rel.eqrLotRefId) },
                  body: { availableToReserve: curAtr + releasedQty }
                });
                if (!r2 || !r2.ok) {
                  errors.push('Return lot ' + rel.lotNumber + ' to ATR failed (HTTP ' + ((r2 && r2.status) || '?') + ')');
                }
              }
            }
          } else if (isInventoryMode) {
            const releasedQty = Number(rel.qty || rel.allocatedQty || 0);
            const invRefId    = Number(rel.inventoryItemRefId);
            if (releasedQty > 0 && invRefId) {
              let curAtr = null;
              try {
                const invGet = await Actions.callRest(context, {
                  endpoint:  'eqp-v1/getInventoryItemRefById',
                  uriParams: { id: invRefId }
                });
                if (invGet && invGet.ok && invGet.body && invGet.body.availableToReserve != null) {
                  curAtr = Number(invGet.body.availableToReserve);
                }
              } catch (e) { /* tolerate; skip the patch */ }
              if (curAtr != null) {
                const r2 = await Actions.callRest(context, {
                  endpoint:  'eqp-v1/patchInventoryItemRef',
                  uriParams: { id: invRefId },
                  body: { availableToReserve: curAtr + releasedQty }
                });
                if (!r2 || !r2.ok) {
                  errors.push('Return inventory ' + (rel.itemNumber || rel.lotNumber || invRefId) + ' to ATR failed (HTTP ' + ((r2 && r2.status) || '?') + ')');
                }
              }
            }
          } else if (rel.eqrSerialRefId != null) {
            const ru = await Actions.callRest(context, {
              endpoint:  'eqp-v1/patchSerialRef',
              uriParams: { id: Number(rel.eqrSerialRefId) },
              body: { unitStatus: 'AVAILABLE' }
            });
            if (!ru || !ru.ok) {
              errors.push('Release unit ' + rel.serialNumber + ' failed (HTTP ' + ((ru && ru.status) || '?') + ')');
            }
          }
        } catch (e) {
          errors.push('Release error for ' + (rel.serialNumber || rel.lotNumber) + ': ' + ((e && e.message) || e));
        }
      }

      // ── 2. New assignments ──────────────────────────────────────────────────────────────────────────────────
      for (const assn of pendingAssignments) {
        try {
          if (isLotMode) {
            const assnQty = Math.max(1, Number(assn.qty || 0));
            const r1 = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createAllocation',
              body: Object.assign({
                requestLineId:    Number(lineId),
                lotRefId:         Number(assn.eqrLotRefId),
                allocatedQty:     assnQty,
                allocationStatus: 'ALLOCATED',
                allocatedDate:    today,
              }, orgFields(assn))
            });
            if (!r1 || !r1.ok) {
              errors.push('Create lot allocation for ' + assn.lotNumber + ' failed (HTTP ' + ((r1 && r1.status) || '?') + ')');
              continue;
            }
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
                errors.push('Reserve lot ' + assn.lotNumber + ' from ATR failed (HTTP ' + ((r2 && r2.status) || '?') + ')');
              }
            }
          } else if (isInventoryMode) {
            const assnQty = Math.max(1, Number(assn.qty || 0));
            const invRefId = Number(assn.inventoryItemRefId);
            const r1 = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createAllocation',
              body: Object.assign({
                requestLineId:      Number(lineId),
                inventoryItemRefId: invRefId,
                allocatedQty:       assnQty,
                allocationStatus:   'ALLOCATED',
                allocatedDate:      today,
              }, orgFields(assn))
            });
            if (!r1 || !r1.ok) {
              errors.push('Create inventory allocation for ' + (assn.itemNumber || assn.lotNumber || ('item ' + invRefId)) + ' failed (HTTP ' + ((r1 && r1.status) || '?') + ')');
              continue;
            }
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
                errors.push('Reserve inventory ' + (assn.itemNumber || assn.lotNumber || invRefId) + ' from ATR failed (HTTP ' + ((r2 && r2.status) || '?') + ')');
              }
            }
          } else {
            const r1 = await Actions.callRest(context, {
              endpoint: 'eqp-v1/createAllocation',
              body: Object.assign({
                requestLineId:    Number(lineId),
                serialRefId:      Number(assn.eqrSerialRefId),
                allocatedQty:     1,
                allocationStatus: 'ALLOCATED',
                allocatedDate:    today,
              }, orgFields(assn))
            });
            if (!r1 || !r1.ok) {
              errors.push('Create allocation for ' + assn.serialNumber + ' failed (HTTP ' + ((r1 && r1.status) || '?') + ')');
              continue;
            }
            const ru = await Actions.callRest(context, {
              endpoint:  'eqp-v1/patchSerialRef',
              uriParams: { id: Number(assn.eqrSerialRefId) },
              body: { unitStatus: 'RENTED' }
            });
            if (!ru || !ru.ok) {
              errors.push('Set unit ' + assn.serialNumber + ' RENTED failed (HTTP ' + ((ru && ru.status) || '?') + ')');
            }
          }
        } catch (e) {
          errors.push('Assignment error for ' + (assn.serialNumber || assn.lotNumber) + ': ' + ((e && e.message) || e));
        }
      }

      // ── 3. Recount from line-detail-units and PATCH the line's allocationStatus (the Workbench's allocation
      //       percentage counts lines whose allocation_status is ALLOCATED) ────────────────────────────────────
      const mode = isLotMode ? 'lot' : (isInventoryMode ? 'inventory' : 'serial');
      let allocatedNow = [];
      try {
        const unitsResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
          uriParams: { requestId: Number(requestId), lineId: Number(lineId), size: 10000 }
        });
        if (unitsResp && unitsResp.ok && unitsResp.body && Array.isArray(unitsResp.body.data)) {
          allocatedNow = lineDetailUnits.buildResources(unitsResp.body.data, mode,
            { equipmentName: lineData.equipment_name || '', className: lineData.class || '' },
            lineData.equipment_master_id).allocated;
        }
      } catch (e) { /* tolerate */ }

      let lineError = '';
      try {
        const lineQty = lineData.qty || 1;
        const allocatedUnits = mode === 'serial'
          ? allocatedNow.length
          : allocatedNow.reduce((sum, a) => sum + Number(a.allocatedQty || 0), 0);
        let newLineStatus;
        if (allocatedUnits === 0)           newLineStatus = 'PENDING';
        else if (allocatedUnits >= lineQty) newLineStatus = 'ALLOCATED';
        else                                newLineStatus = 'PARTIAL';

        const body = { allocationStatus: newLineStatus };
        if (newLineStatus === 'ALLOCATED') {
          const currentLineStatus = await readCurrentLineStatus();
          if (CASCADABLE.indexOf(currentLineStatus) !== -1) body.lineStatus = 'ALLOCATED';
        } else if (newLineStatus === 'PENDING') {
          // Demote on full release, only from ALLOCATED (old chain: a released line must be allocatable again).
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
          lineError = 'The line\'s allocation status was not updated (HTTP ' + (lineStatusResp && lineStatusResp.status) + ').';
          console.warn('[saveAllocationChain] PATCH request-line status failed', lineStatusResp && lineStatusResp.status);
        }
      } catch (e) {
        console.warn('[saveAllocationChain] PATCH line status threw:', e);
      }

      // ── 4. Tell, then refresh the request's lines and this picker in place ────────────────────────────────
      if (errors.length || lineError) {
        await Actions.fireNotificationEvent(context, {
          summary:     'Save partially failed',
          message:     errors.concat(lineError ? [lineError] : []).join('\n'),
          type:        'error',
          displayMode: 'persist'
        });
      } else {
        const total = pendingAssignments.length + pendingReleases.length;
        const noun = mode === 'lot' ? 'lot change' : (mode === 'inventory' ? 'inventory change' : 'allocation change');
        await Actions.fireNotificationEvent(context, {
          summary:     'Saved',
          message:     total + ' ' + noun + (total === 1 ? '' : 's') + ' applied successfully.',
          type:        'confirmation',
          displayMode: 'transient'
        });
      }
      await Actions.callChain(context, {
        chain: 'initChain',
        params: { requestId: $page.variables.requestId, requestNumericId: Number(requestId) }
      });
      await Actions.callChain(context, {
        chain: 'openUnitsChain',
        params: { lineId: String(lineId), reload: true }
      });
    }
  }

  return saveAllocationChain;
});
