define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/draftStorage',
  'resources/js/requestModel',
  'resources/js/deliveryCoords',
], (ActionChain, Actions, _au, draftStorage, requestModel, deliveryCoords) => {
  'use strict';

  class CreateRequestNextChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;

      const data = $page.variables.formData;

      const isBlank = v => v == null || (typeof v === 'string' && v.trim() === '');
      const missing = [];
      if (isBlank(data.customerRefId))      missing.push('Customer Name');
      if (isBlank(data.requestorId))        missing.push('Customer Contact');
      if (!data.requestedStartDate)         missing.push('Start Date');
      if (!data.requestedEndDate)           missing.push('End Date');
      if (isBlank(data.location))           missing.push('Delivery Location');

      if (missing.length > 0) {
        await Actions.fireNotificationEvent(context, {
          summary:     'Required Fields Missing',
          message:     'Fill in: ' + missing.join(', '),
          displayMode: 'transient',
          type:        'warning'
        });
        return;
      }

      // Snapshot the form into ActiveRequestDetail (used by SubmitRequestChain
      // as a defensive fallback) and also onto $flow.variables.request, which
      // is the primary shape the cart submit chain reads from.
      $flow.variables.ActiveRequestDetail = {
        customerRefId:      data.customerRefId,
        customerName:       data.customerName,
        requestorId:        data.requestorId,
        requestorName:      data.requestorName,
        location:           data.location,
        requestedStartDate: data.requestedStartDate,
        requestedEndDate:   data.requestedEndDate,
        notes:              data.notes || '',
        // Customer-mode requests do not carry Fusion project/task — those
        // are a Projects-module concern. Submit chain handles nulls cleanly.
        projectId:          null,
        projectNumber:      '',
        projectName:        '',
        taskId:             null,
        taskNumber:         '',
        taskName:           '',
        // Project-side customer + contract are a Projects-module concern and
        // have no controls on this page. Stated explicitly rather than left
        // undefined so SubmitRequestChain's payload reads the same shape from
        // both entry points and the PROJECT_* columns stay null here.
        internalCustomerId:   null,
        internalCustomerName: '',
        contractId:           null,
        contractNumber:       '',
        isSoftReservation:  false
      };

      // Start from the canonical default shape, preserve anything already on
      // the in-flight request, then overlay the customer-mode fields. The
      // factory base guarantees project/task keys are present-and-empty
      // (customer mode carries no Fusion project/task) without re-listing them.
      $flow.variables.request = Object.assign(
        requestModel.defaultRequest(),
        $flow.variables.request || {},
        {
          customerId:        data.customerRefId,
          requestorId:       data.requestorId,
          requestorName:     data.requestorName,
          location:          data.location,
          startDate:         data.requestedStartDate,
          endDate:           data.requestedEndDate,
          notes:             data.notes || '',
          projectId:         null,
          projectNumber:     '',
          projectName:       '',
          taskId:            null,
          taskNumber:        '',
          taskName:          '',
          isSoftReservation: false
        }
      );

      $flow.variables.requestOrigin = 'customer';
      // The customer flow is EXTERNAL by definition — there is no Request Type
      // picker on this page (unlike project-create-request, where the user
      // chooses). Stamped here so request.requestType is populated on BOTH
      // paths; SubmitRequestChain still derives the posted value from
      // requestOrigin, so this is for consistency of the in-flight model rather
      // than something the POST depends on.
      $flow.variables.request.requestType = 'EXTERNAL';

      // ── Delivery coordinates ────────────────────────────────────────────
      // Resolved HERE because the map drawer's picked coordinates live on
      // $page.variables and die with this page. Persisted onto the request so
      // they survive the navigation into the catalog, which uses them to price
      // from the yard nearest the delivery address.
      //
      // Same shared resolver the project page uses: map-picked coordinates win,
      // otherwise the address string is geocoded. Best-effort — a null pair
      // just means the catalog omits the params.
      try {
        const coords = await deliveryCoords.resolve(
          $page.variables.pickedLat,
          $page.variables.pickedLng,
          $flow.variables.request.location
        );
        $flow.variables.request.locationLatitude  = coords.latitude;
        $flow.variables.request.locationLongitude = coords.longitude;
      } catch (e) {
        console.warn('CreateRequestNextChain: delivery coordinate resolution failed', e);
        $flow.variables.request.locationLatitude  = null;
        $flow.variables.request.locationLongitude = null;
      }

      // Persist draft so a refresh between here and submit can resume.
      draftStorage.save('ActiveRequestDetail', $flow.variables.ActiveRequestDetail);
      draftStorage.save('request',             $flow.variables.request);
      draftStorage.save('requestOrigin',       $flow.variables.requestOrigin);

      await Actions.navigateToPage(context, {
        page: 'request-catalog'
      });
    }
  }

  return CreateRequestNextChain;
});
