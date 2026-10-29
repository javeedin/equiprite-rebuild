define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/postCostToFusion',
], (ActionChain, Actions, postCostToFusion) => {
  'use strict';

  /*
   * Post the ticked weeks and charges: the old post-cost-test-detail postSelectedChain, step for step.
   *
   *   1 RECORD  each ticked postable week (not posted, not reversed) → ONE ledger call: createPostedWeek, or
   *             createPostedWeekSplit for a week with a saved split of 2+ projects (percentages only; the server
   *             apportions). The body is post-costs-page.js ledgerBody, the old body field for field, every amount a
   *             view figure. The ticked charges → ONE postMiscTransactions {ids} (all or nothing)
   *   2 SEND    only if something was recorded: the OIC flow for the request (postCostToFusion.post: project URL,
   *             then v1 on a 404). It drains everything POSTED and unsent for the request, so it is safe to repeat;
   *             a failure here is not a lost post (the next post sends it) and is reported as a warning
   *   3 re-read the preview (posted weeks now come from the ledger) and the list
   *
   * Guards kept: only the review panel can post (it lists exactly what step 1 writes), a second click while posting
   * does nothing, a posted / reversed / not-yet-ended week is never sent, a split that is not saved or sits on a PR
   * line posts whole to the request's project, and the ledger's unique keys make a re-post benign.
   *
   * Not carried: the old post-cost-detail postToPpmChain (EQP_POST_COST_FLOW, the whole request at once, flipping
   * time entries to POSTED). It posts the same cost by a second route; offering both would invite a double post.
   */
  class postSelectedChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (v.isPosting || v.readOnly) return;
      if (v.panel !== 'review') {
        v.panel = fns.selection(v.rowsAll).items ? 'review' : '';
        return;
      }
      const cur = v.current || {};
      const all = v.rowsAll || [];
      const toPost = fns.weeksToPost(all);
      const selMisc = fns.miscToPost(all);
      if (!toPost.length && !selMisc.length) return;

      v.isPosting = true;
      v.postError = '';
      v.postSuccess = '';
      let okCount = 0;
      let failCount = 0;
      let movedCost = 0;
      try {
        for (const r of toPost) {
          if (!r.requestLineId || !r.weekStartISO) { failCount++; continue; }
          const body = fns.ledgerBody(r, cur.rateScheduleId);
          try {
            const resp = await Actions.callRest(context, {
              endpoint: body.splits ? 'eqp-v1/createPostedWeekSplit' : 'eqp-v1/createPostedWeek',
              body,
            });
            if (resp && resp.ok) { okCount++; movedCost += Number(r.cost || 0); } else { failCount++; }
          } catch (e) {
            failCount++;
            console.error('[postSelectedChain] ledger write failed', e && e.message);
          }
        }

        let miscOk = 0;
        let miscCost = 0;
        let miscFailed = false;
        if (selMisc.length) {
          try {
            const m = await Actions.callRest(context, { endpoint: 'eqp-v1/postMiscTransactions', body: { ids: selMisc.map((x) => Number(x.miscId)) } });
            if (m && m.ok) {
              miscOk = selMisc.length;
              miscCost = selMisc.reduce((s, x) => s + Number(x.cost || 0), 0);
            } else {
              miscFailed = true;
            }
          } catch (e) {
            miscFailed = true;
          }
        }

        let sentToFusion = false;
        let fusionFailed = false;
        if (okCount > 0 || miscOk > 0) {
          try {
            const f = await postCostToFusion.post(context, Actions, cur.requestNumber || '');
            if (f && f.ok) sentToFusion = true; else fusionFailed = true;
          } catch (e) {
            fusionFailed = true;
          }
        }

        v.panel = '';
        if (okCount > 0 || miscOk > 0) {
          await Actions.callChain(context, { chain: 'loadPreviewChain' });
          await Actions.callChain(context, { chain: 'listChain' });
          const parts = [];
          if (okCount > 0) parts.push(okCount + ' week(s) — $' + Math.round(movedCost).toLocaleString());
          if (miscOk > 0) parts.push(miscOk + ' charge(s) — $' + Math.round(miscCost).toLocaleString());
          v.postSuccess = 'Posted ' + parts.join(' and ')
            + (failCount ? '  (' + failCount + ' week(s) failed and stay ready to post)' : '')
            + (miscFailed ? '  (the charges failed and stay ready to post)' : '')
            + (sentToFusion ? '  — sent to Fusion PPM.'
              : (fusionFailed ? '  — recorded in EquipRite, but the send to Fusion failed. It will be retried on the next post.' : ''));
          await Actions.fireNotificationEvent(context, {
            summary: fusionFailed ? 'Posted, not yet sent to Fusion' : 'Costs posted',
            message: v.postSuccess,
            type: fusionFailed || failCount || miscFailed ? 'warning' : 'confirmation',
            displayMode: fusionFailed ? 'persist' : 'transient',
          });
        }
        if (failCount > 0 && okCount === 0 && !miscOk) {
          v.postError = 'Posting failed for ' + failCount + ' week(s). Nothing was recorded, so nothing was sent to Fusion.';
        } else if (miscFailed && !miscOk && !okCount) {
          v.postError = 'Could not post the selected charge(s). Nothing was sent to Fusion.';
        }
      } finally {
        try { v.isPosting = false; } catch (e2) { /* page left */ }
      }
    }
  }

  return postSelectedChain;
});
