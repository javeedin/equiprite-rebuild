define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class RequestDetailInitChain extends ActionChain {
    /**
     * @param {Object} context
     */
    async run(context) {
      const { $page } = context;
      const requestId = $page.variables.requestId;
      const allRecords = $page.functions.getCustomerRequestData();

      // Find by exact ID, or fall back to the first record for dev preview
      const request = allRecords.find(r => r.id === requestId) || allRecords[0];

      if (!request) {
        console.warn('[RequestDetailInitChain] No request found for ID:', requestId);
        return;
      }

      console.log('[RequestDetailInitChain] Loading request:', request);

      $page.variables.requestDetail = request;
      $page.variables.RequestLinesAllArray = Array.isArray(request.lines) ? [...request.lines] : [];
      $page.variables.pageActions = $page.functions.buildPageActions(request.status);

      // Populate contextual info (Top metadata)
      $page.variables.contextualInfo = [
        { label: 'Project', value: request.project || '—' },
        { label: 'Status',  value: request.status || '—' },
        { label: 'Start',   value: request.startDate || '—' }
      ];

      // Set Badge
      let badgeStatus = 'neutral';
      if (request.status === 'IN_PROCESS' || request.status === 'QUOTE_ACCEPTED' || request.status === 'DEPLOYED') badgeStatus = 'success';
      if (request.status === 'SUBMITTED' || request.status === 'SHIPPED') badgeStatus = 'warning';
      if (request.status === 'REJECTED') badgeStatus = 'danger';

      $page.variables.badge = {
        text: request.status || 'Unknown',
        status: badgeStatus
      };
    }
  }

  return RequestDetailInitChain;
});
