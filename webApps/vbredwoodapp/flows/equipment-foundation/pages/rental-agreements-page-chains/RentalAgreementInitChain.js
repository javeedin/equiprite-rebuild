define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  class RentalAgreementInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsRentalAgreements',
        uriParams: { page: 0, size: 200 }
      });

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

      $page.variables.RequestAllArray      = records;
      $page.variables.RequestFilteredArray = [...records];
    }
  }

  return RentalAgreementInitChain;
});
