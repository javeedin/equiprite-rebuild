define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // The list: the old rental-agreements-page-chains/RentalAgreementInitChain.js (views/rental-agreements, page 0,
  // size 200, newest first), unchanged except that the rows go to allRows and a failed read is said, not shown
  // as an empty list. FULL access shows New agreement.
  class agreementsInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < 60 && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      $page.variables.canWrite = $application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded,
        'EQR_RENTAL_AGREEMENTS') === 'FULL';
      $page.variables.isLoading = true;

      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsRentalAgreements',
        uriParams: { page: 0, size: 200 }
      });

      $page.variables.isLoading = false;
      if (!response || !response.ok) {
        $page.variables.fetchError = 'The agreements could not be loaded (HTTP ' + (response && response.status) + ').';
      }
      const rows = (response && response.body && response.body.data) || [];

      const records = rows.map(r => ({
        headerId:        r.id != null ? r.id : null,
        agreementNumber: r.agreementNumber || '',
        agreementName:   r.agreementName   || '',
        customer:        r.customerName    || '',
        agreementType:   r.agreementType   || '',
        startDate:       r.effectiveFrom ? r.effectiveFrom.substring(0, 10) : '',
        endDate:         r.effectiveTo   ? r.effectiveTo.substring(0, 10)   : '',
        statusCode:      r.status          || '',
        lineCount:       r.lines           || 0
      }));

      // Sort newest-created first. headerId is the sequence-generated
      // EQR_AGREEMENT_HEADER_ID, so higher = newer. Null IDs (defensive,
      // shouldn't happen) sink to the bottom.
      records.sort((a, b) => {
        const aId = a.headerId != null ? Number(a.headerId) : -Infinity;
        const bId = b.headerId != null ? Number(b.headerId) : -Infinity;
        return bId - aId;
      });

      $page.variables.allRows = records;
      await Actions.callChain(context, { chain: 'setFilterChain', params: { kind: 'apply' } });
    }
  }

  return agreementsInitChain;
});
