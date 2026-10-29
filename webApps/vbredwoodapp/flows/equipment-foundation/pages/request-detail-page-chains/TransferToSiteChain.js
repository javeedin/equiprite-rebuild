define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Same swallow-as-warning toast pattern used throughout this flow
  // (ActionChain.safeNotify, AssignProjectChain.safeNotify) — a failed toast
  // must never mask or break the actual save.
  async function safeNotify(context, payload) {
    try {
      await Actions.fireNotificationEvent(context, payload);
    } catch (e) {
      console.warn('[TransferToSiteChain] toast failed — continuing:', e);
    }
  }

  function toISODate(val) {
    if (!val) return null;
    const s = String(val);
    return s.includes('T') ? s : s + 'T00:00:00Z';
  }

  /**
   * "Transfer to Another Site" — Confirm Transfer. Two modes, one shared
   * equipment context (the source line's equipment/qty/rate):
   *
   *   CREATE NEW REQUEST — builds a brand-new request the same way
   *   project-create-request-page's SubmitRequestChain does, from whatever
   *   was filled in on this drawer's Project Details / Dates / Delivery
   *   Details sections.
   *
   *   ATTACH TO EXISTING REQUEST — posts a line onto a request the user
   *   picked from eqp-v1/getEquipriteV1ViewsMyRequests, with the SAME
   *   createRequestLine payload shape SubmitRequestChain uses when adding a
   *   catalog item to the cart's request — no new header, no status
   *   changes to the header itself; that request's own approval flow
   *   continues exactly as it already was.
   *
   * Neither path calls Process Return or touches the source line's status —
   * that's a separate, deliberate action via the page's own Process Return
   * button.
   */
  class TransferToSiteChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const equipmentMasterId = $page.variables.transferEquipmentMasterId;
      if (!equipmentMasterId) {
        $page.variables.transferError = 'Missing equipment context — close and reopen the drawer.';
        return;
      }

      $page.variables.transferSaving = true;
      $page.variables.transferError  = '';
      try {
        if ($page.variables.transferIsExistingMode) {
          await this._attachToExisting(context);
        } else {
          await this._createNewRequest(context);
        }
      } finally {
        $page.variables.transferSaving = false;
      }
    }

    // ── ATTACH TO EXISTING REQUEST ────────────────────────────────────────
    async _attachToExisting(context) {
      const { $page } = context;

      const equipmentMasterId = $page.variables.transferEquipmentMasterId;
      const equipmentName     = $page.variables.transferEquipmentName || '';
      const quantity          = $page.variables.transferQuantity || 1;
      const billRate          = $page.variables.transferBillRate;
      const priceUom          = $page.variables.transferPriceUom || '';

      const sourceRequestNumber = $page.variables.transferSourceRequestNumber;
      const sourceLineNo        = $page.variables.transferSourceLineNo;

      const dest = $page.variables.transferSelectedExistingRequest;
      if (!dest || dest.id == null) {
        $page.variables.transferError = 'Search for and select a request to attach this equipment to.';
        return;
      }

      // Same createRequestLine shape SubmitRequestChain uses when adding a
      // catalog item to the cart's request: the line's own dates fall back
      // to the destination request's dates when it has none of its own —
      // "item.startDate || detail.requestedStartDate" there is
      // "transferStartDate || dest.requestedStartDate" here.
      const lineStartDate = $page.variables.transferStartDate || dest.requestedStartDate;
      const lineEndDate   = $page.variables.transferEndDate   || dest.requestedEndDate;

      const noteBase = 'Related to ' + (sourceRequestNumber || 'source request') +
        ' line #' + sourceLineNo + (equipmentName ? ' (' + equipmentName + ')' : '');

      let lineResult;
      try {
        lineResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/createRequestLine',
          uriParams: { requestId: dest.id },
          body: {
            eqrEquipmentRequestId: dest.id,
            eqrEquipmentMasterId:  Number(equipmentMasterId),
            eqrEquipmentClassId:   null,
            quantity:              Number(quantity) || 1,
            billRate:              billRate,
            priceUom:              priceUom || null,
            startDate:             toISODate(lineStartDate),
            endDate:               toISODate(lineEndDate),
            lineNotes:             noteBase
          }
        });
      } catch (e) {
        console.error('[TransferToSiteChain] createRequestLine (existing) threw:', e);
        lineResult = null;
      }

      if (!lineResult || !lineResult.ok) {
        await safeNotify(context, {
          summary:     'Line not added',
          message:     'Could not add ' + equipmentName + ' to ' + dest.requestNumber + ' (' +
                       (lineResult ? lineResult.status : 'no response') + '). Try again.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      // New line tracks the destination header's CURRENT status — it is
      // joining a request already somewhere in its lifecycle, not starting
      // one, so it should read the same as every other line already there
      // rather than reverting to a default like DRAFT.
      const destLineId = lineResult.body.id;
      await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchRequestLine',
        uriParams: { requestId: dest.id, id: destLineId },
        body:      { lineStatus: dest.status }
      });

      $page.variables.isTransferDrawerOpen = false;

      await safeNotify(context, {
        summary: 'Added to request',
        message: equipmentName + ' added to ' + dest.requestNumber + ' (' + dest.projectName + ').',
        type:        'confirmation',
        displayMode: 'persist'
      });
    }

    // ── CREATE NEW REQUEST ────────────────────────────────────────────────
    async _createNewRequest(context) {
      const { $page } = context;

      const sourceRequestId     = $page.variables.transferSourceRequestId;
      const sourceRequestNumber = $page.variables.transferSourceRequestNumber;
      const sourceLineNo        = $page.variables.transferSourceLineNo;
      const equipmentMasterId   = $page.variables.transferEquipmentMasterId;
      const equipmentName       = $page.variables.transferEquipmentName || '';
      const quantity            = $page.variables.transferQuantity || 1;
      const billRate            = $page.variables.transferBillRate;
      const priceUom            = $page.variables.transferPriceUom || '';

      const projectId     = $page.variables.transferProjectId;
      const projectName   = $page.variables.transferProjectName   || null;
      const projectNumber = $page.variables.transferProjectNumber || null;
      const taskId        = $page.variables.transferTaskId;
      const taskName      = $page.variables.transferTaskName   || null;
      const taskNumber    = $page.variables.transferTaskNumber || null;

      const startDate = $page.variables.transferStartDate;
      const endDate   = $page.variables.transferEndDate;

      // Same shape as project-create-request-page's NavigateToCatalogChain:
      // the customer/party field differs by Customer Type, the contact
      // label differs with it, and a SOFT RESERVATION relaxes everything
      // but the dates — it is only a provisional hold on a date window,
      // settled in full later.
      const isCustomerOrigin = $page.variables.transferCustomerType === 'EXTERNAL';
      const partyField = {
        value: isCustomerOrigin ? $page.variables.transferCustomerId : $page.variables.transferInternalCustomerId,
        label: 'Customer'
      };
      const contactLabel = isCustomerOrigin ? 'Customer Contact' : 'Requestor Contact';

      const mandatoryFields = $page.variables.transferIsSoftReservation === true
        ? [
            { value: startDate, label: 'Start Date' },
            { value: endDate,   label: 'End Date' }
          ]
        : [
            partyField,
            { value: $page.variables.transferRequestorId, label: contactLabel },
            { value: $page.variables.transferLocation,     label: 'Delivery Location' },
            { value: projectId, label: 'Project' },
            { value: taskId,    label: 'Task' },
            { value: startDate, label: 'Start Date' },
            { value: endDate,   label: 'End Date' }
          ];

      const missing = mandatoryFields.filter(f => !f.value).map(f => f.label);
      if (missing.length > 0) {
        $page.variables.transferError = 'Please fill in: ' + missing.join(', ');
        await safeNotify(context, {
          summary:     'Required Fields Missing',
          message:     'Please fill in: ' + missing.join(', '),
          displayMode: 'transient',
          type:        'warning'
        });
        return;
      }

      if (new Date(endDate) < new Date(startDate)) {
        $page.variables.transferError = 'End date cannot be before start date.';
        return;
      }

      // Same rule SubmitRequestChain uses: a customer-origin request skips
      // the internal approval step (IN_PROCESS); an internal one starts at
      // SUBMITTED.
      const destRequestType = isCustomerOrigin ? 'EXTERNAL' : 'INTERNAL';
      const destStatus      = isCustomerOrigin ? 'IN_PROCESS' : 'SUBMITTED';

      const internalCustomerObj = $page.variables.transferSelectedInternalCustomerObj || null;
      const contractObj         = $page.variables.transferSelectedContractObj || null;

      const noteBase = sourceRequestId
        ? ('Related to ' + (sourceRequestNumber || sourceRequestId) + ' line #' + sourceLineNo +
           (equipmentName ? ' (' + equipmentName + ')' : ''))
        : '';
      const userNotes = $page.variables.transferNotes || '';
      const attribute2 = userNotes ? (noteBase ? (noteBase + ' — ' + userNotes) : userNotes) : (noteBase || null);

      // ── Create the request header ────────────────────────────────────────
      let headerResult;
      try {
        headerResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createEquipmentRequest',
          body: {
            status:                  'DRAFT',
            requestType:             destRequestType,
            projectRefId:            Number(projectId),
            projectName:             projectName,
            projectNumber:           projectNumber,
            taskId:                  Number(taskId),
            taskName:                taskName,
            taskNumber:              taskNumber,
            // Party: EXTERNAL → EQR_CUSTOMER_REF customer + portal-user
            // contact; INTERNAL → Fusion party (optional) + EQR_USER
            // requestor. Both share transferRequestorId/Name for the
            // "contact" slot — same mutually-exclusive design as the
            // real page's request.requestorId.
            requestorUserId:           isCustomerOrigin ? null : ($page.variables.transferRequestorId || null),
            eqrCustomerPortalUserId:   isCustomerOrigin ? ($page.variables.transferRequestorId || null) : null,
            eqrCustomerRefId:          isCustomerOrigin ? ($page.variables.transferCustomerId || null) : null,
            customerName:             isCustomerOrigin
              ? ($page.variables.transferCustomerName || null)
              : ((internalCustomerObj && (internalCustomerObj.Customer || internalCustomerObj.PartyName)) || null),
            contactName:              $page.variables.transferRequestorName || null,
            projectInternalCustomerId: !isCustomerOrigin ? ($page.variables.transferInternalCustomerId || null) : null,
            projectInternalCustomer:   !isCustomerOrigin
              ? ((internalCustomerObj && (internalCustomerObj.Customer || internalCustomerObj.PartyName)) || null)
              : null,
            projectContractId:       $page.variables.transferContractId || null,
            projectContract:         (contractObj && contractObj.CONTRACT_NUMBER) || null,
            contractNumber:          (contractObj && contractObj.CONTRACT_NUMBER) || null,
            attribute1:              $page.variables.transferLocation || null,
            requestedStartDate:      toISODate(startDate),
            requestedEndDate:        toISODate(endDate),
            defaultHours:            $page.variables.transferPlannedHours || null,
            isSoftReservation:       $page.variables.transferIsSoftReservation === true ? 'Y' : 'N',
            eqrAgreementHeaderId:    $page.variables.transferAgreementId || null,
            attribute2:              attribute2
          }
        });
      } catch (e) {
        console.error('[TransferToSiteChain] createEquipmentRequest threw:', e);
        headerResult = null;
      }

      if (!headerResult || !headerResult.ok) {
        await safeNotify(context, {
          summary:     'Request not created',
          message:     'The destination request could not be created (' +
                       (headerResult ? headerResult.status : 'no response') + '). Try again.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      const destRequestId     = headerResult.body.id;
      const destRequestNumber = headerResult.body.requestNumber;

      await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchEquipmentRequest',
        uriParams: { id: Number(destRequestId) },
        body:      { status: destStatus }
      });

      // ── Create the line ──────────────────────────────────────────────────
      let lineResult;
      try {
        lineResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/createRequestLine',
          uriParams: { requestId: destRequestId },
          body: {
            eqrEquipmentRequestId: destRequestId,
            eqrEquipmentMasterId:  Number(equipmentMasterId),
            eqrEquipmentClassId:   null,
            quantity:              Number(quantity) || 1,
            billRate:              billRate,
            priceUom:              priceUom || null,
            startDate:             toISODate(startDate),
            endDate:               toISODate(endDate),
            lineNotes:             noteBase || null
          }
        });
      } catch (e) {
        console.error('[TransferToSiteChain] createRequestLine threw:', e);
        lineResult = null;
      }

      if (!lineResult || !lineResult.ok) {
        await safeNotify(context, {
          summary:     'Request created, line failed',
          message:     'Request ' + destRequestNumber + ' was created, but its line could not be added. ' +
                       'Add ' + equipmentName + ' to it manually.',
          type:        'error',
          displayMode: 'persist'
        });
        return;
      }

      const destLineId = lineResult.body.id;
      await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchRequestLine',
        uriParams: { requestId: destRequestId, id: destLineId },
        body:      { lineStatus: destStatus }
      });

      $page.variables.isTransferDrawerOpen = false;

      await safeNotify(context, {
        summary: 'Request created',
        message: 'Request ' + destRequestNumber + ' created for ' + (projectName || projectId) +
                 ' with ' + equipmentName + ' (' + startDate + ' – ' + endDate + ').',
        type:        'confirmation',
        displayMode: 'persist'
      });
    }
  }

  return TransferToSiteChain;
});
