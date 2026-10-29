define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/deliveryCoords',
  'resources/js/projectBusinessUnit',
], (ActionChain, Actions, draftStorage, deliveryCoords, projectBusinessUnit) => {
  'use strict';

  class NavigateToCatalogChain extends ActionChain {
    async run(context) {
      const { $page, $flow, $application } = context;
      const request = $flow.variables.request;

      // Start/End dates are ALWAYS required to advance — a reservation
      // (soft or hard) needs a date window to hold against. A soft reservation
      // relaxes EVERYTHING ELSE (party, contact, location, project/task): it is
      // a provisional hold on the dates, and the rest is settled when it is
      // firmed up.
      // The party field differs by request type, so validate whichever one is
      // actually on screen:
      //   INTERNAL → Fusion party      → request.customerId
      //   EXTERNAL → EQR_CUSTOMER_REF  → request.customerRefId
      // Validating customerId unconditionally would block EXTERNAL requests on
      // a field that is hidden and never populated for them, with a message
      // naming a control the user cannot see.
      // Both render under the single label "Customer" now, so only the VALUE
      // forks — the message must keep matching what is on screen.
      const isExternalRequest = String(request.requestType || '').toUpperCase() === 'EXTERNAL';
      const partyField = {
        value: isExternalRequest ? request.customerRefId : request.customerId,
        label: 'Customer'
      };
      // Both types need a contact; only the label and the source LOV differ
      // (EQR_USER vs EQR_CUSTOMER_PORTAL_USER — see CaptureExternalContactChain
      // for why they share request.requestorId).
      const contactLabel = isExternalRequest ? 'Customer Contact' : 'Requestor Contact';

      // Project/Task are required only when they are actually on screen. On an
      // EXTERNAL request they render only if EXTERNAL_PROJECT_ASSIGN_ENABLED is
      // on; with the flag off the request is raised with no project (the
      // manager attributes one later via request-detail-page's Assign Project
      // drawer, which hangs off the same flag). Demanding them regardless would
      // dead-end the user on fields the page does not display.
      // Same fail-closed accessor the binding uses, so screen and validation
      // can never disagree about whether the fields exist.
      const projectFieldsShown = !isExternalRequest
        || $application.functions.isFeatureEnabled(
             $application.variables.featureFlags,
             $application.variables.flagsLoaded,
             'EXTERNAL_PROJECT_ASSIGN_ENABLED'
           );

      const projectFields = projectFieldsShown
        ? [
            { value: request.projectId, label: 'Project' },
            { value: request.taskId,    label: 'Task' }
          ]
        : [];

      // SOFT RESERVATION → DATES ONLY. A soft reservation just holds a date
      // window against the equipment; who it is for, where it goes and which
      // project it lands on are all decided later when it is firmed up. The
      // customer/party field was previously required here too, which contradicted
      // the whole point of the toggle — the user had to fill in a customer to
      // place a provisional hold.
      const mandatoryFields = request.isSoftReservation === true
        ? [
            { value: request.startDate,  label: 'Start Date' },
            { value: request.endDate,    label: 'End Date' }
          ]
        : [
            partyField,
            // INTERNAL's requestor is the signed-in user, locked by
            // SeedRequestorChain — no id just means they have no EQR_USER row
            // yet, which the user cannot fix from this screen. Only the
            // EXTERNAL Customer Contact is still a pick the user owes us.
            ...(isExternalRequest ? [{ value: request.requestorId, label: contactLabel }] : []),
            { value: request.location,    label: 'Delivery Location' },
            ...projectFields,
            { value: request.startDate,   label: 'Start Date' },
            { value: request.endDate,     label: 'End Date' }
          ];

      const missing = mandatoryFields.filter(f => !f.value).map(f => f.label);
      if (missing.length > 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Required Fields Missing',
          message: 'Please fill in: ' + missing.join(', '),
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      // Fetch project name/number + task name/number from LOV as defensive
      // fallback (e.g. if the user pasted an id instead of picking from the
      // dropdown, the in-page Capture chain didn't fire).
      var projectName   = request.projectName   || '';
      var projectNumber = request.projectNumber || '';
      var taskName      = request.taskName      || '';
      var taskNumber    = request.taskNumber    || '';
      var requestorName = request.requestorName || '';
      var projectBuId   = request.projectBuId   != null ? request.projectBuId : null;
      var projectBuName = request.projectBuName || '';

      if ((!projectName || !projectNumber) && request.projectId) {
        try {
          const projResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectsLOV',
            uriParams: {
              q:      'ProjectId=' + request.projectId,
              fields: 'ProjectId,ProjectNumber,ProjectName',
              limit:  1
            }
          });
          if (projResp.ok && projResp.body && projResp.body.items && projResp.body.items.length > 0) {
            const p = projResp.body.items[0];
            projectName   = p.ProjectName   || projectName;
            projectNumber = p.ProjectNumber || projectNumber;
            $flow.variables.request.projectName   = projectName;
            $flow.variables.request.projectNumber = projectNumber;
          }
        } catch (e) {
          console.warn('NavigateToCatalogChain: could not fetch project name/number', e);
        }
      }

      // Same defensive fallback for the BUSINESS UNIT. CaptureProjectNameChain
      // fetches it on the pick, so this only fires when that chain did not run
      // — a pasted id, or a draft hydrated from storage before this field
      // existed. Separate `if` from the block above because the two come from
      // DIFFERENT Fusion resources: projectsLOV has no BusinessUnit attribute,
      // so the BU needs projects/{ProjectId}. See resources/js/projectBusinessUnit.js.
      if (!projectBuName && request.projectId) {
        const bu = await projectBusinessUnit.fetchForProject(
          context, Actions, request.projectId);
        if (bu && bu.name) {
          projectBuId   = bu.id;
          projectBuName = bu.name;
          $flow.variables.request.projectBuId   = projectBuId;
          $flow.variables.request.projectBuName = projectBuName;
        }
      }

      if ((!taskName || !taskNumber) && request.taskId) {
        try {
          const taskResp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasksLOV',
            uriParams: {
              q:      'TaskId=' + request.taskId,
              fields: 'TaskId,TaskNumber,TaskName',
              limit:  1
            }
          });
          if (taskResp.ok && taskResp.body && taskResp.body.items && taskResp.body.items.length > 0) {
            const t = taskResp.body.items[0];
            taskName   = t.TaskName   || taskName;
            taskNumber = t.TaskNumber || taskNumber;
            $flow.variables.request.taskName   = taskName;
            $flow.variables.request.taskNumber = taskNumber;
          }
        } catch (e) {
          console.warn('NavigateToCatalogChain: could not fetch task name/number', e);
        }
      }

      // Defensive fallback: if the in-page capture missed (e.g. user pasted an
      // id rather than clicking a dropdown row), look the requestor up by id.
      if (!requestorName && request.requestorId) {
        try {
          const userResp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1Users2'
          });
          if (userResp.ok && userResp.body && Array.isArray(userResp.body.data)) {
            const match = userResp.body.data.find(function(u) {
              return Number(u.id) === Number(request.requestorId);
            });
            if (match) {
              requestorName = match.fullName || '';
              $flow.variables.request.requestorName = requestorName;
            }
          }
        } catch (e) {
          console.warn('NavigateToCatalogChain: could not fetch requestor name', e);
        }
      }

      // ── Delivery coordinates ────────────────────────────────────────────
      // Resolved HERE rather than on the catalog page because this is the last
      // point the map drawer's picked coordinates are still reachable — they
      // live on $page.variables and die with this page. Persisted onto the
      // request (flow-scoped + draftStorage below) so they survive the
      // navigation and a refresh.
      //
      // Covers both delivery modes: map-picked coordinates are used as-is,
      // otherwise the address string is geocoded (the project ship-to-site
      // case). Best-effort — nulls just mean the catalog omits the params.
      try {
        const coords = await deliveryCoords.resolve(
          $page.variables.pickedLat,
          $page.variables.pickedLng,
          request.location
        );
        $flow.variables.request.locationLatitude  = coords.latitude;
        $flow.variables.request.locationLongitude = coords.longitude;
      } catch (e) {
        console.warn('NavigateToCatalogChain: delivery coordinate resolution failed', e);
        $flow.variables.request.locationLatitude  = null;
        $flow.variables.request.locationLongitude = null;
      }

      // The request's rental window is whatever the user entered on this page.
      // We deliberately do NOT fall back to the agreement's effectiveFrom/To:
      // those describe the agreement's own duration, not the rental window of a
      // release order against it. For a hard reservation the dates are already
      // validated as present above; for a soft reservation they may be blank by
      // design.
      var resolvedStart = request.startDate || null;
      var resolvedEnd   = request.endDate   || null;

      // The FORM's dates win. If the user came back from the catalog / cart and
      // changed Start or End Date, cart lines that carry their own dates (set or
      // pinned by Edit Line, see CartSaveQtyChain) would keep the old window.
      // Drop them so every line takes the new one. Compared against the window
      // the cart last used; CartSaveQtyChain keeps request.startDate/endDate in
      // step with it, so an untouched form is never read as a change.
      var prevDetail = $flow.variables.ActiveRequestDetail || {};
      var d10 = function (v) { return v ? String(v).slice(0, 10) : ''; };
      var windowChanged = !!(prevDetail.requestedStartDate || prevDetail.requestedEndDate) &&
        (d10(resolvedStart) !== d10(prevDetail.requestedStartDate) ||
         d10(resolvedEnd)   !== d10(prevDetail.requestedEndDate));
      if (windowChanged) {
        var cart = $flow.variables.CartItemsArray || [];
        var hadLineDates = cart.some(function (ci) { return ci.startDate || ci.endDate; });
        if (hadLineDates) {
          $flow.variables.CartItemsArray = cart.map(function (ci) {
            var copy = Object.assign({}, ci);
            delete copy.startDate;
            delete copy.endDate;
            return copy;
          });
          draftStorage.save('CartItemsArray', $flow.variables.CartItemsArray);
          await Actions.fireNotificationEvent(context, {
            summary: 'Cart dates updated',
            message: 'The request dates changed, so every line in your cart now uses ' +
              d10(resolvedStart) + ' to ' + d10(resolvedEnd) + '.',
            type: 'info',
            displayMode: 'transient'
          });
        }
      }

      // This page is a UNIFIED entry point: the Request Type picker decides
      // whether the manager is raising an internal (project) or external
      // (customer) request. The chosen type travels on request.requestType and
      // SubmitRequestChain reads it directly to decide both what to post as
      // requestType and which customer columns to fill.
      //
      // requestOrigin stays 'project' regardless — it records WHICH PAGE the
      // request came from (it drives back-navigation and draft resume), not
      // what kind of request it is. Those were the same thing only while each
      // page raised exactly one type.
      // isExternalRequest is resolved once at the top of this chain, alongside
      // the type-aware required-field validation.
      $flow.variables.ActiveRequestDetail = {
        requestorId:        request.requestorId,
        requestorName:      requestorName,
        location:           request.location,
        // Delivery MODE plus, for an internal location, the two Fusion ids behind
        // it. Snapshotted for the same reason `location` is: SubmitRequestChain
        // reads request.* first and falls back to detail.* so a refresh between
        // cart-entry and submit can't silently drop them. Losing these is quieter
        // than losing the address — the request still submits and still reads
        // correctly, it just never relocates the maintenance asset in Fusion on
        // ship, with nothing on screen to say so.
        locationType:       request.locationType || null,
        deliveryInvOrgId:   request.deliveryInvOrgId   != null ? Number(request.deliveryInvOrgId)   : null,
        deliveryLocationId: request.deliveryLocationId != null ? Number(request.deliveryLocationId) : null,
        requestedStartDate: resolvedStart,
        requestedEndDate:   resolvedEnd,
        hours:              request.hours != null ? Number(request.hours) : null,
        projectId:          request.projectId,
        projectNumber:      projectNumber,
        projectName:        projectName,
        // Snapshotted alongside projectNumber/projectName for the same reason
        // they are: SubmitRequestChain reads detail.* first, so a refresh
        // between cart-entry and submit must not drop the business unit.
        projectBuId:        projectBuId,
        projectBuName:      projectBuName,
        taskId:             request.taskId,
        taskNumber:         taskNumber,
        taskName:           taskName,
        // Customer identity — EXTERNAL only, and named exactly as
        // SubmitRequestChain reads them (detail.customerRefId / customerName).
        // Null on an internal request so the customer columns stay empty there.
        customerRefId:      isExternalRequest ? request.customerRefId   : null,
        customerName:       isExternalRequest ? (request.customerRefName || '') : '',
        // INTERNAL customer + contract — the project-side counterparts of the
        // two fields above, landing in PROJECT_INTERNAL_CUSTOMER_ID/NAME and
        // PROJECT_CONTRACT_ID/NAME. Kept in their own fields rather than reusing
        // customerRefId/customerName: those hold an EQR_CUSTOMER_REF id, a
        // DIFFERENT id space from the Fusion CustomerId captured here, so
        // sharing them would point at an unrelated row instead of failing.
        // Null on an external request so the project columns stay empty there.
        internalCustomerId:   isExternalRequest ? null : (request.customerId   != null ? request.customerId : null),
        internalCustomerName: isExternalRequest ? ''   : (request.customerName || ''),
        // Contract is captured on both types (it is inside the Project/Task
        // gate), so it is NOT branched on request type.
        contractId:         request.contractId != null ? request.contractId : null,
        contractNumber:     request.contractNumber || '',
        notes:              request.notes || '',
        isSoftReservation:  request.isSoftReservation === true
      };
      $flow.variables.requestOrigin = 'project';

      // Keep the request object coherent with the resolved dates so a
      // refresh/resume re-hydrates the same values the cart shows.
      $flow.variables.request.startDate = resolvedStart;
      $flow.variables.request.endDate   = resolvedEnd;

      // Persist draft so refresh / cross-tab can resume the in-progress request
      draftStorage.save('request', $flow.variables.request);
      draftStorage.save('ActiveRequestDetail', $flow.variables.ActiveRequestDetail);
      draftStorage.save('requestOrigin', $flow.variables.requestOrigin);

      await Actions.navigateToPage(context, { page: 'request-catalog' });
    }
  }

  return NavigateToCatalogChain;
});
