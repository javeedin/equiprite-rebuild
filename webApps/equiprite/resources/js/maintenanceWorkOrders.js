define([], () => {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────
  // Fusion maintenance work orders, keyed by maintenance asset number.
  //
  // Shared by the pages that draw planned-maintenance bars on a Bryntum
  // scheduler — equipment-schedule (fleet-wide) and line-detail (one line's
  // serials). Extracted rather than copied a second time: the call shape below
  // was arrived at through several wrong turns, and having two divergent copies
  // of it is how those wrong turns come back.
  //
  // WHAT WAS LEARNED THE HARD WAY, so it does not get re-litigated:
  //
  //  1. DO NOT BATCH WITH `or`. Asking for 25 assets in one q —
  //       AssetNumber='A' or AssetNumber='B' or …
  //     returns HTTP 200 with {"items":[],"count":0}. Not an error, just
  //     silently nothing, even when a single-asset call for one of those same
  //     assets returns rows. maintenanceWorkOrders does not honour q that way.
  //     One asset per request is the only shape observed to work.
  //
  //  2. DO NOT SEND `fields`. Fusion rejects the whole request if any name is
  //     wrong, and the names here are genuinely uncertain — the unit-detail
  //     page reads status as WorkOrderStatus || WorkOrderStatusName ||
  //     WorkOrderStatusCode || SystemStatus || SystemStatusCode because nobody
  //     knows which this instance returns.
  //
  //  3. THE STORED KEY IS NOT ENOUGH. For a human-code asset (BT-100000) the
  //     AssetId is a DIFFERENT value living on the asset record, so the work
  //     order has to be looked up by an id we do not hold until we resolve the
  //     asset first via installedBaseAssets. Skipping that step is why
  //     BT-100000 showed no bars while a surrogate-keyed asset worked.
  //
  // Returns a plain object { assetNumber: [workOrder, …] }. Empty is a valid
  // answer and simply means no maintenance bars. Every failure is swallowed per
  // asset: these pages are primarily rental views, and Fusion being unreachable
  // must not take them down.
  // ───────────────────────────────────────────────────────────────────────

  // Fusion q string literal — single quotes delimit, so an embedded one must be
  // doubled.
  function qLit(v) {
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  // Requests in flight at once. One-per-asset means the call count equals the
  // DISTINCT asset count, so this bounds the burst without serialising it.
  const CONCURRENCY = 8;

  /**
   * @param context   VB action-chain context
   * @param Actions   vb/action/actions
   * @param serials   rows carrying maintenanceAssetNumber (serial-refs, or
   *                  anything else with that field)
   * @returns Promise<{ [assetNumber: string]: object[] }>
   */
  async function fetchByAsset(context, Actions, serials) {
    // DEDUPED. One asset is commonly shared by many serials (in dev, a single
    // asset number covers 158 of them), so keying the fetch on the asset rather
    // than the serial is the difference between ~52 calls and ~209.
    const assetNumbers = [];
    const seen = new Set();
    (serials || []).forEach(s => {
      const a = s && s.maintenanceAssetNumber;
      if (a && !seen.has(a)) {
        seen.add(a);
        assetNumbers.push(a);
      }
    });
    if (!assetNumbers.length) return {};

    const byAsset = {};

    const fetchOne = async (assetNumber) => {
      // STEP 1 — resolve the asset, for its real AssetId and operating org.
      // Also acts as a cheap existence check: an asset Fusion does not know
      // cannot have work orders, so we skip step 2 entirely for it.
      let resolvedId  = null;
      let resolvedOrg = '';
      let assetExists = false;
      try {
        const aResp = await Actions.callRest(context, {
          endpoint:  'ProjectLOV/getInstalledBaseAssets',
          uriParams: { q: 'AssetNumber=' + qLit(assetNumber), limit: 1 }
        });
        const aItems = (aResp && aResp.ok && aResp.body)
          ? (aResp.body.items || aResp.body) : null;
        if (Array.isArray(aItems) && aItems.length) {
          assetExists = true;
          const fa = aItems[0];
          if (fa.AssetId != null) resolvedId = String(fa.AssetId);
          resolvedOrg = fa.OperatingOrganizationCode || '';
        }
      } catch (e) {
        // A failed lookup is NOT "asset absent" — that would silently drop a
        // real asset on a transient error. Fall through and try anyway.
        console.warn('[maintenanceWorkOrders] asset lookup failed for '
          + assetNumber + ' — trying the stored key anyway', e);
        assetExists = true;
        if (/^\d+$/.test(assetNumber)) resolvedId = assetNumber;
      }
      if (!assetExists) return;

      // STEP 2 — widen progressively, same ladder as the unit-detail page.
      // Work orders are raised INSIDE an organization, which several Fusion
      // maintenance resources want as query context, so the org variants are
      // not redundant.
      const org = resolvedOrg ? ' and OrganizationCode=' + qLit(resolvedOrg) : '';
      const attempts = ['AssetNumber=' + qLit(assetNumber)];
      if (org) attempts.push('AssetNumber=' + qLit(assetNumber) + org);
      if (resolvedId) {
        attempts.push('AssetId=' + resolvedId);
        if (org) attempts.push('AssetId=' + resolvedId + org);
      }

      for (let i = 0; i < attempts.length; i++) {
        try {
          const resp = await Actions.callRest(context, {
            endpoint:  'ProjectLOV/getMaintenanceWorkOrders',
            uriParams: {
              q:       attempts[i],
              limit:   100,
              orderBy: 'PlannedStartDate:desc'
            }
          });
          if (!resp || !resp.ok || !resp.body) continue;
          const items = resp.body.items || resp.body;
          if (!Array.isArray(items) || !items.length) continue;

          // Keyed on the asset number WE asked for, not the one the row
          // carries: an AssetId match returns rows whose AssetNumber is the
          // human code, which would not match the serial's stored key and
          // would leave the bars unreachable.
          (byAsset[assetNumber] = byAsset[assetNumber] || []).push(...items);
          return;
        } catch (e) {
          console.warn('[maintenanceWorkOrders] lookup failed for '
            + assetNumber + ' — it renders without maintenance bars', e);
          return;
        }
      }
    };

    // Bounded concurrency: CONCURRENCY workers pulling off a shared index.
    let next = 0;
    const worker = async () => {
      while (next < assetNumbers.length) {
        await fetchOne(assetNumbers[next++]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, assetNumbers.length) }, worker)
    );

    return byAsset;
  }

  /**
   * Normalise one Fusion work order into the fields a maintenance bar needs.
   * Returns null when it has no planned start — an unscheduled work order has
   * no place on a timeline, and inventing a date would assert maintenance that
   * is not planned.
   */
  function toBar(w) {
    const start = w && w.PlannedStartDate
      ? String(w.PlannedStartDate).substring(0, 10) : null;
    if (!start) return null;
    return {
      start:  start,
      end:    w.PlannedCompletionDate
                ? String(w.PlannedCompletionDate).substring(0, 10) : null,
      number: w.WorkOrderNumber || '',
      type:   w.WorkOrderType || 'Maintenance',
      detail: w.WorkOrderDescription || w.WorkOrderStatus || '',
      asset:  w.AssetNumber || ''
    };
  }

  return {
    fetchByAsset: fetchByAsset,
    toBar:        toBar,
    COLOR:        '#757575'   // matches the legend's Maintenance pill
  };
});
