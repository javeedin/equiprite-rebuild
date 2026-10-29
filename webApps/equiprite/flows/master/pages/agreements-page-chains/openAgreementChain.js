define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A row opens its lines page, by agreement number (the old navigateToRentalLinesChain's requestId parameter).
  class openAgreementChain extends ActionChain {
    async run(context, { row }) {
      // oj-table fires firstSelectedRowChanged part way through its own sequence: yield before navigating.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!row || !row.agreementNumber) return;
      await Actions.navigateToPage(context, { page: 'agreement-lines', params: { agreementNumber: row.agreementNumber } });
    }
  }

  return openAgreementChain;
});
