define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/expenditureTypes',
  'resources/js/prPassThrough',
], (ActionChain, Actions, expenditureTypes, prPassThrough) => {
  'use strict';

  // The preview of one request: the old post-cost-test-detail vbEnterChain's reads, in its order.
  //   views/post-cost-details?requestNumber=     the cost rows (ledger-aware: POSTED / REVERSED / DRAFT …)
  //   views/line-retier-weeks                    what each week costs at today's tier (drives Reverse)
  //   views/blackout-weeks                       excluded days per line and week
  //   views/misc-transactions                    miscellaneous charges
  //   views/line-project-splits                  authored project splits per line and week
  //   purchase-requisitions?requestId=           which lines are PR pass-through (no split; base rows not ours)
  // The companions are non-fatal, as before: the rental cost must render without them. The expenditure-type list
  // loads in the background (expenditureTypes.loadForRequest), never holding up the money.
  // post-costs-page.js buildPreview turns it all into the equipment → week → day tree.
  const body = async (context, endpoint, uriParams) => {
    try {
      const r = await Actions.callRest(context, { endpoint, uriParams });
      return r && r.ok ? r.body : null;
    } catch (e) {
      console.warn('[loadPreviewChain] ' + endpoint + ' not read (non-fatal):', e && e.message);
      return null;
    }
  };

  class loadPreviewChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const cur = v.current;
      if (!cur || !cur.requestNumber) return;
      const requestNumber = cur.requestNumber;
      const callRest = (opts) => Actions.callRest(context, opts);
      v.previewLoading = true;
      v.previewError = '';
      try {
        const res = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsPostCostDetails', uriParams: { requestNumber } });
        if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) {
          v.rowsAll = [];
          v.previewError = 'The cost of ' + requestNumber + ' could not be loaded (HTTP ' + (res && res.status) + ').';
          return;
        }
        const retier = await body(context, 'eqp-v1/getEquipriteV1ViewsLineRetierWeeks', { requestNumber });
        const blackout = await body(context, 'eqp-v1/getBlackoutWeeks', { requestNumber });
        const misc = await body(context, 'eqp-v1/getMiscTransactions', { requestNumber });
        const splits = await body(context, 'eqp-v1/getLineProjectSplits', { requestNumber });

        // PR lines. requestId is required by the endpoint; fall back to resolving it from the number. Fails OPEN.
        const prLineIds = {};
        const prPoPrices = {};
        let rid = Number(cur.eqrEquipmentRequestId) || 0;
        if (!rid) {
          rid = Number(await expenditureTypes.resolveRequestIdByNumber(callRest, requestNumber)) || 0;
          if (rid && v.current && v.current.requestNumber === requestNumber) v.current = Object.assign({}, v.current, { eqrEquipmentRequestId: rid });
        }
        if (rid) {
          const pr = await body(context, 'eqp-v1/getPurchaseRequisitions', { requestId: rid, page: 0, size: 200 });
          Object.assign(prLineIds, prPassThrough.parsePrLineIds(pr));
          Object.assign(prPoPrices, prPassThrough.parsePrPoPrices(pr));
        }

        expenditureTypes.loadForRequest(callRest, { projectIdHint: cur.ppmProjectRefId, requestId: rid, requestNumber })
          .then((list) => { if (list && list.length) v.expTypeList = list; })
          .catch((e) => console.warn('[loadPreviewChain] expenditure types kept at the proven values:', e && e.message));

        if (!v.current || v.current.requestNumber !== requestNumber) return; // another request was opened meanwhile
        const out = $page.functions.buildPreview(res.body.data, { retier, blackout, misc, splits, prLineIds, prPoPrices }, $page.functions.hdrOf(cur));
        v.rowsAll = out.rowsAll;
        v.facts = {
          totalCost: out.totalCost, postedCost: out.postedCost, incurredToDate: out.incurredToDate, netAdjustment: out.netAdjustment,
          lastPostedLabel: out.lastPostedLabel, headerStatus: out.headerStatus, isEarlyReturn: out.isEarlyReturn,
          startDate: out.startDate, endDate: out.endDate,
        };
      } catch (e) {
        console.error('[loadPreviewChain] failed', e);
        v.previewError = 'The cost of ' + requestNumber + ' could not be loaded.';
      } finally {
        v.previewLoading = false;
      }
    }
  }

  return loadPreviewChain;
});
