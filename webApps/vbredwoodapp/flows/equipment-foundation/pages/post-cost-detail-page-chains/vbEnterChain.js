define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const requestNumber = $page.variables.requestNumber || '';

      if (!requestNumber) {
        console.warn('[vbEnterChain post-cost] Missing requestNumber');
        return;
      }

      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsPostCostDetails',
        uriParams: { requestNumber: requestNumber }
      });

      if (!response || !response.ok || !response.body || !Array.isArray(response.body.data)) {
        console.warn('[vbEnterChain post-cost] Failed to fetch post-cost details:', response && response.status);
        return;
      }

      const rows = response.body.data;

      if (!rows.length) {
        console.warn('[vbEnterChain post-cost] No rows returned for requestNumber:', requestNumber);
        return;
      }

      // RENTABLE rows carry time-entry ids (entryIds); posting flips those to POSTED.
      // DIRECT rows (non-rentable consumables/materials) have no time entry — posting
      // stamps costPostedDate on the request line instead. Collect both so postToPpmChain
      // can settle each kind the right way.
      $page.variables.matchedEntryIds = rows.flatMap(function(r) {
        return r.entryIds ? String(r.entryIds).split(',').map(Number) : [];
      });
      // ...with two exclusions, tested separately because they are different reasons:
      //
      //  1. CONSUMABLE — Fusion costs it on the material issue and Post Cost only
      //     mirrors that, so posting it here would charge the project twice.
      //     Tested on the real consumableFlag (resolved server-side off the SUBCLASS).
      //     This previously inferred "consumable" from postStatus IN_PROGRESS/POSTED,
      //     which is wrong: two live DIRECT lines are POSTED via the EQR_POSTED_WEEK
      //     ledger and are NOT consumables. That inference reached the right answer
      //     for the wrong reason; this does not depend on the coincidence.
      //
      //  2. ALREADY SETTLED — a POSTED or REVERSED row must not be posted again,
      //     whatever kind of line it is.
      $page.variables.matchedDirectLineIds = rows
        .filter(function(r) {
          if (r.lineType !== 'DIRECT' || !r.requestLineId) return false;
          if (r.consumableFlag === 'Y') return false;
          var st = String(r.postStatus || '').toUpperCase();
          return st !== 'POSTED' && st !== 'REVERSED';
        })
        .map(function(r) { return Number(r.requestLineId); });

      const lines = rows.map(r => ({
        equipment_name:  r.equipmentName  || '',
        qty:             r.qty            || 0,
        applicable_rate: r.applicableRate || 0,
        rate_period:     r.ratePeriod     || '—',
        reg_hours:       r.regHours       || 0,
        ot_hours:        r.otHours        || 0,
        total_hours:     r.totalHours     || 0,
        cost_amount:     r.costAmount     || 0,
        bill_amount:     r.billAmount     || 0
      }));

      const provider = $page.functions.initProviderFromLinesReadOnly(lines);
      $page.variables.dataGridProvider = provider;
      $page.variables.totalHours = rows.reduce((s, r) => s + (r.totalHours || 0), 0);
      $page.variables.totalCost  = rows.reduce((s, r) => s + (r.costAmount  || 0), 0);
      $page.variables.headerStatus = rows[0].postStatus || '';

      // Nothing to post manually when every row is a consumable mirroring Fusion.
      $page.variables.hasPostableCost =
        ($page.variables.matchedEntryIds || []).length > 0 ||
        ($page.variables.matchedDirectLineIds || []).length > 0;
    }
  }

  return vbEnterChain;
});
