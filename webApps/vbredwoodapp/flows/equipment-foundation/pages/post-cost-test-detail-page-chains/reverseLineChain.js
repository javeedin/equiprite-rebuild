define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /*
   * Post Cost Test — REVERSE a posted line whose tier changed on early return.
   *
   * Triggered by the per-equipment "Reverse" control (id="rev-<groupKey>").
   * Calls ONE atomic backend endpoint:
   *     POST /equiprite/v1/request-lines/{id}/reverse
   *     body { weekStartDates: ['YYYY-MM-DD', ...] }   // the posted weeks to reverse
   *
   * The SERVER does the whole reversal in one DB transaction:
   *   - recompute each week's current re-tier via EQR_RESOLVE_RATE (anti-V190:
   *     the corrected amount is engine-computed server-side, never trusted from
   *     the client),
   *   - flip the POSTED ORIGINAL row -> REVERSED,
   *   - insert a CREDIT row (negating the posted amount),
   *   - insert a REPOST DRAFT row at the re-tiered amount,
   *   all tied by one LINE_REVERSAL_GROUP_ID with distinct -R/-A Fusion refs.
   * A per-week failure rolls the whole call back — no half-reversed week.
   * No OIC/PPM call (deferred) — EquipRite only records + shows the reversal.
   *
   * §5 "only reverse when the tier actually changes" is decided by comparing two
   * engine PERIOD_TYPE labels (postedPeriod vs retierPeriod) — the client selects
   * WHICH weeks to send; the server re-validates the tier change before writing.
   * This chain does NO cost math.
   */
  class reverseLineChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      // read groupKey off id="rev-<key>" (walk up in case the click lands inside a wrapper)
      let el = event && event.target;
      if (el && (!el.id || el.id.indexOf('rev-') !== 0)) {
        while (el && !(el.id && el.id.indexOf('rev-') === 0)) { el = el.parentElement; }
      }
      if (!el || !el.id || el.id.indexOf('rev-') !== 0) return;
      const groupKey = el.id.replace('rev-', '');

      const rows = ($page.variables.rowsAll || []);
      const group = rows.find(function (r) { return r.kind === 'group' && r.groupKey === groupKey; });
      if (!group) return;

      // the POSTED weeks of this group whose tier actually changed (engine labels, no day math)
      const postedWeeks = rows.filter(function (r) {
        if (r.kind !== 'week' || r.groupKey !== groupKey) return false;
        if (!r.posted) return false;
        const rp = String(r.retierPeriod || '').toUpperCase();
        const pp = String(r.postedPeriod || '').toUpperCase();
        return rp && pp && rp !== pp;
      });

      if (!postedWeeks.length) {
        $page.variables.postError = 'Nothing to reverse — no posted week on this equipment changed tier.';
        return;
      }

      const lineId = postedWeeks[0].requestLineId || group.requestLineId;
      if (!lineId) { $page.variables.postError = 'Cannot reverse: missing line id.'; return; }

      const weekStartDates = postedWeeks
        .map(function (r) { return r.weekStartISO; })
        .filter(Boolean);

      $page.variables.isPosting = true;
      $page.variables.postError = '';
      $page.variables.postSuccess = '';

      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/reverseRequestLine',           // POST /request-lines/{id}/reverse
          uriParams: { id: Number(lineId) },
          body: { weekStartDates: weekStartDates }
        });
      } catch (e) {
        $page.variables.isPosting = false;
        $page.variables.postError = 'Reversal call failed'
          + (e && e.message ? (': ' + e.message) : '')
          + '. (Is the reverseRequestLine endpoint registered?)';
        return;
      }

      $page.variables.isPosting = false;

      if (resp && resp.ok) {
        // server committed the reversal — re-read so the view (Branch 2L) shows
        // the originals struck (REVERSED) + the new re-tiered drafts (DRAFT).
        try {
          await Actions.callChain(context, { chain: 'vbEnterChain' });
        } catch (e) { console.warn('[reverse] refresh failed:', e && e.message); }
        const n = (resp.body && (resp.body.reversedCount != null ? resp.body.reversedCount : weekStartDates.length));
        $page.variables.postSuccess = 'Reversed ' + n + ' week(s) — original charge credited, '
          + 're-tiered draft created.';
      } else {
        const status = resp && resp.status;
        $page.variables.postError = 'Reversal failed'
          + (status ? (' (HTTP ' + status + ')') : '')
          + '. See console.';
        console.warn('[reverse] non-ok response:', resp);
      }
    }
  }

  return reverseLineChain;
});
