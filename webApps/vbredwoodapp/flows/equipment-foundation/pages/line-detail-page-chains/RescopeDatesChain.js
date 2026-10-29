define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions, _au) => {
  'use strict';

  /**
   * Fired when the user adjusts the line's date pickers (onAdjustDates).
   * Re-fetches line-detail-units scoped to the adjusted window (startDate/
   * endDate) — the view recomputes per-unit availabilityStatus over that
   * window server-side via EQR_AVAILABILITY_PKG — then hands the rows to the
   * page module to repaint each serial row's status (Available / Booked).
   *
   * SERIAL mode only: lot/inventory status is qty-derived, not window-derived,
   * so there's nothing to recompute on a date change for them.
   *
   * Params (forwarded from the page JSON listener):
   *   startVal, endVal — the adjusted ISO dates from the pickers.
   */
  class RescopeDatesChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;

      const requestId = $page.variables.requestId;
      const lineId    = $page.variables.lineId;
      const startVal  = params && params.startVal;
      const endVal    = params && params.endVal;

      if (!requestId || !lineId) {
        console.warn('[line-detail RescopeDatesChain] Missing requestId/lineId.');
        return;
      }

      // Only meaningful in serial mode — the page module no-ops the apply in
      // qty (lot/inventory) modes, but skip the round-trip entirely too.
      if ($page.functions && typeof $page.functions.isSerialMode === 'function'
          && !$page.functions.isSerialMode()) {
        return;
      }

      const uriParams = { requestId: Number(requestId), lineId: Number(lineId), size: 10000 };
      if (startVal) uriParams.startDate = startVal;
      if (endVal)   uriParams.endDate   = endVal;

      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
          uriParams: uriParams
        });
      } catch (e) {
        console.warn('[line-detail RescopeDatesChain] line-detail-units re-fetch failed:', e);
        return;
      }

      if (!resp || !resp.ok || !resp.body || !Array.isArray(resp.body.data)) {
        console.warn('[line-detail RescopeDatesChain] line-detail-units re-fetch not ok.');
        return;
      }

      const units = resp.body.data.filter(u => String(u.unitType).toUpperCase() === 'SERIAL');

      if ($page.functions && typeof $page.functions.applySerialStatuses === 'function') {
        $page.functions.applySerialStatuses(units);
      }
    }
  }

  return RescopeDatesChain;
});
