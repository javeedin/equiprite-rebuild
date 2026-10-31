define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Re-tier: reverse the posted weeks of one equipment whose tier changed on early return. New's Post costs
  // reverseLineChain: the POSTED weeks of the equipment whose re-tier PERIOD differs from the period they were posted at
  // (engine labels, no day math), sent as ONE POST reverseRequestLine { weekStartDates } for the line. The server
  // re-prices each week, flips the original to REVERSED, writes a credit and a re-tiered draft in one transaction, and
  // calls no Fusion endpoint; the re-tiered draft is then posted like any other week.
  //
  // It asks first: the first call names the weeks and what they will be credited and re-drafted at, the second
  // (confirm 'go') reverses, then the preview is read again (New's loadPreviewChain).
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
        v.postError = 'Nothing to reverse: no posted week on this equipment changed tier.';
        return;
      }
      const lineId = postedWeeks[0].requestLineId || group.requestLineId;
      if (!lineId) {
        v.postError = 'Cannot reverse: the request line is not known.';
        return;
      }
      const weekStartDates = postedWeeks.map((r) => r.weekStartISO).filter(Boolean);
      v.isPosting = true;
      v.postError = '';
      v.postNote = '';
      let resp;
      try {
        resp = await Actions.callRest(context, { endpoint: 'eqp-v1/reverseRequestLine', uriParams: { id: Number(lineId) }, body: { weekStartDates } });
      } catch (e) {
        v.isPosting = false;
        v.postError = 'The reversal failed' + (e && e.message ? ': ' + e.message : '') + '.';
        return;
      }
      v.isPosting = false;
      if (resp && resp.ok) {
        await Actions.callChain(context, { chain: 'loadRecordChain', params: { refresh: true, reread: 'preview' } });
        const n = resp.body && resp.body.reversedCount != null ? resp.body.reversedCount : weekStartDates.length;
        v.postNote = 'Reversed ' + n + (Number(n) === 1 ? ' week' : ' weeks') + ': the original charge is credited and a re-tiered draft created. Post the draft to send the correction.';
      } else {
        v.postError = 'The reversal failed' + (resp && resp.status ? ' (HTTP ' + resp.status + ')' : '') + '.';
      }
    }
  }

  return reverseLineChain;
});
