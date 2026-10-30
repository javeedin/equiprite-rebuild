define([], () => {
  'use strict';

  // ───────────────────────────────────────────────────────────────────────
  // "Is THIS request line confirmed?" — drives the line-detail read-only gate
  // (Assign + Release hidden) and the serial bar colour (Booked vs Reserving).
  //
  // PER-LINE, not request-level: a Transfer Order raised for a SIBLING line must
  // NOT lock this line. So the answer is "this line's requestLineId appears on a
  // TO line", NOT "the request has any TO".
  //
  // STATUS-AWARE: only a TO that is actually LIVE in Fusion locks the line —
  //   fusionToStatus === 'TO_CREATED'.
  // A pending supply request (fusionToStatus 'SR_CREATED') or a failed one
  // ('TO_FAILED') does NOT lock — the user can still edit / retry. fusionToStatus
  // is the authoritative signal (per product decision); orderStatus is NOT used.
  //
  // Takes the ALREADY-FETCHED getTransferOrders list (callers fetch it anyway),
  // so this only adds one getTransferOrderLines call per live TO (usually 0–1).
  // Returns a Promise<boolean>.
  // ───────────────────────────────────────────────────────────────────────
  async function lineIsConfirmed(context, Actions, transferOrders, lineId) {
    const lineIdNum = Number(lineId);
    if (!lineIdNum) return false;

    const liveTOs = (transferOrders || []).filter(t =>
      String(t.fusionToStatus) === 'TO_CREATED'
    );
    if (!liveTOs.length) return false;

    let lineSets;
    try {
      lineSets = await Promise.all(liveTOs.map(t =>
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getTransferOrderLines',
          uriParams: { transferOrderId: Number(t.id) }
        }).then(r => (r && r.ok && r.body && r.body.data) || [])
          .catch(() => [])
      ));
    } catch (e) {
      return false;
    }

    return lineSets.some(lines =>
      lines.some(l => Number(l.requestLineId) === lineIdNum)
    );
  }

  return { lineIsConfirmed };
});
