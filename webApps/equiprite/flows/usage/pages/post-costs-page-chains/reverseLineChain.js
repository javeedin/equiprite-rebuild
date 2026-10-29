define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Re-tier: reverse the posted weeks of one equipment whose tier changed on early return. The old
  // reverseLineChain: the POSTED weeks of the equipment whose re-tier PERIOD differs from the period they were
  // posted at (engine labels, no day math), sent as ONE POST reverseRequestLine {weekStartDates} for the line. The
  // server re-prices each week, flips the original to REVERSED, writes a credit and a re-tiered draft in one
  // transaction, and calls no Fusion endpoint; the re-tiered draft is then posted like any other week.
  //
  // It asks first (the old control acted on a single tick): the first call names the weeks and what they will be
  // credited and re-drafted at, the second (confirm 'go') reverses.
  class reverseLineChain extends ActionChain {
    async run(context, { groupKey, confirm }) {
      const { $page } = context;
      const v = $page.variables;
      if (confirm === 'cancel') {
        v.reverseAsk = '';
        return;
      }
      if (v.isPosting || v.readOnly) return;
      if (confirm !== 'go') {
        v.reverseAsk = groupKey || '';
        v.postError = '';
        return;
      }
      groupKey = v.reverseAsk;
      v.reverseAsk = '';
      const rows = v.rowsAll || [];
      const group = rows.find((r) => r.kind === 'group' && r.groupKey === groupKey);
      if (!group) return;
      const postedWeeks = rows.filter((r) => {
        if (r.kind !== 'week' || r.groupKey !== groupKey || !r.posted) return false;
        const rp = String(r.retierPeriod || '').toUpperCase();
        const pp = String(r.postedPeriod || '').toUpperCase();
        return rp && pp && rp !== pp;
      });
      if (!postedWeeks.length) {
        v.postError = 'Nothing to reverse — no posted week on this equipment changed tier.';
        return;
      }
      const lineId = postedWeeks[0].requestLineId || group.requestLineId;
      if (!lineId) {
        v.postError = 'Cannot reverse: missing line id.';
        return;
      }
      const weekStartDates = postedWeeks.map((r) => r.weekStartISO).filter(Boolean);
      v.isPosting = true;
      v.postError = '';
      v.postSuccess = '';
      let resp;
      try {
        resp = await Actions.callRest(context, { endpoint: 'eqp-v1/reverseRequestLine', uriParams: { id: Number(lineId) }, body: { weekStartDates } });
      } catch (e) {
        v.isPosting = false;
        v.postError = 'Reversal call failed' + (e && e.message ? ': ' + e.message : '') + '.';
        return;
      }
      v.isPosting = false;
      if (resp && resp.ok) {
        await Actions.callChain(context, { chain: 'loadPreviewChain' });
        const n = resp.body && resp.body.reversedCount != null ? resp.body.reversedCount : weekStartDates.length;
        v.postSuccess = 'Reversed ' + n + ' week(s) — original charge credited, re-tiered draft created. Post the draft to send the correction.';
      } else {
        v.postError = 'Reversal failed' + (resp && resp.status ? ' (HTTP ' + resp.status + ')' : '') + '.';
      }
    }
  }

  return reverseLineChain;
});
