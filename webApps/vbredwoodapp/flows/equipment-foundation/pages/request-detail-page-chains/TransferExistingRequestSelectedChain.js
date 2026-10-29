define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Finds the row whose requestNumber exactly matches (case-insensitive),
  // ignoring array position entirely — see the "why" comment in run().
  function findExactMatch(rows, wantedNumber) {
    const wanted = String(wantedNumber).trim().toUpperCase();
    return (rows || []).find(r => r && String(r.requestNumber || '').trim().toUpperCase() === wanted) || null;
  }

  /**
   * Captures the request picked from the "Attach to Existing Request"
   * my-requests search.
   *
   * my-requests rows carry NO numeric id — only requestNumber (see
   * transferExistingRequestsSDP's own description) — but the line-POST
   * endpoint (eqp-v1/createRequestLine) needs the numeric {requestId} path
   * param. This chain resolves that id in up to THREE steps, each one only
   * running if the previous one didn't produce an exact match:
   *
   *   1. Check whether the picked row ALREADY carries an id/requestId field
   *      — my-requests' documented schema doesn't declare one, but if the
   *      live service actually returns more fields than the example/schema
   *      shows, this skips the network round-trip entirely and can never
   *      resolve to the WRONG request (there's nothing to search or match).
   *   2. GET getEquipriteV1EquipmentRequests?requestNumber=<picked>, then
   *      filter the response CLIENT-SIDE for an exact requestNumber match —
   *      never trust array position (data[0]). Confirmed necessary: this
   *      endpoint's requestNumber filter was observed NOT reliably
   *      returning (only) the matching row.
   *   3. If step 2 comes back empty/wrong — which also happens when the
   *      filter is silently ignored AND the target request sits outside
   *      the endpoint's default page — retry with a large size and NO
   *      requestNumber filter, then filter that bigger page client-side.
   *      This is the expensive fallback, only used when the two cheaper
   *      paths both fail.
   */
  class TransferExistingRequestSelectedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;

      $page.variables.transferExistingRequestError = '';
      $page.variables.transferSelectedExistingRequest = null;

      if (!data || !data.requestNumber) {
        $page.variables.transferExistingRequestSearch = '';
        return;
      }

      $page.variables.transferExistingRequestSearch = data.requestNumber;
      const pickedNumber = data.requestNumber;

      // ── Step 1: does the picked row already carry an id? ─────────────────
      const directId = data.id != null ? data.id : (data.requestId != null ? data.requestId : null);
      if (directId != null) {
        this._commit($page, {
          id: directId, requestNumber: pickedNumber, status: data.status || '',
          requestedStartDate: data.startDate || null, requestedEndDate: data.endDate || null
        }, data);
        return;
      }

      // ── Step 2: filtered lookup, exact-match verified client-side ───────
      let row = await this._lookup(context, { requestNumber: pickedNumber }, pickedNumber);

      // ── Step 3: broader unfiltered page, only if step 2 failed ──────────
      if (!row) {
        console.warn('[TransferExistingRequestSelectedChain] filtered lookup did not return an exact match for',
          pickedNumber, '— retrying with a larger, unfiltered page.');
        row = await this._lookup(context, { size: 500 }, pickedNumber);
      }

      if (!row || row.id == null) {
        $page.variables.transferExistingRequestError =
          'Could not resolve ' + pickedNumber + ' — try picking it again, or search a narrower term.';
        return;
      }

      this._commit($page, row, data);
    }

    async _lookup(context, uriParams, wantedNumber) {
      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1EquipmentRequests',
          uriParams: uriParams
        });
      } catch (e) {
        console.error('[TransferExistingRequestSelectedChain] lookup threw:', e);
        return null;
      }
      const rows = (resp && resp.ok && resp.body && Array.isArray(resp.body.data)) ? resp.body.data : [];
      const match = findExactMatch(rows, wantedNumber);
      if (!match) {
        console.warn('[TransferExistingRequestSelectedChain] no exact match. Wanted:', wantedNumber,
          'Rows returned (' + rows.length + '):', rows.map(r => r && r.requestNumber));
      }
      return match;
    }

    _commit($page, row, pickedData) {
      $page.variables.transferSelectedExistingRequest = {
        id:                 row.id,
        requestNumber:      row.requestNumber || pickedData.requestNumber,
        projectName:        pickedData.projectName   || '',
        taskName:           pickedData.taskName      || '',
        requestorName:      pickedData.requestorName || '',
        status:             row.status || pickedData.status || '',
        requestedStartDate: row.requestedStartDate || null,
        requestedEndDate:   row.requestedEndDate   || null
      };
    }
  }

  return TransferExistingRequestSelectedChain;
});
