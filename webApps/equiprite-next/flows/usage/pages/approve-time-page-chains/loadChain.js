define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageAccess',
], (ActionChain, Actions, usageAccess) => {
  'use strict';

  // Opens Approve time. Once the settings are in (usageAccess: the flags and page access New's approvalInitChain
  // checks; read-only for a READ_ONLY role; whether Fusion PPM prices the hours), New's loadApprovalsChain on the newest
  // week with lines waiting. Nothing is written on entry.
  class loadChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const acc = await usageAccess.settle(context, 'approve-time');
      v.readOnly = !!acc.readOnly;
      v.ppmOn = !!acc.ppmOn;
      if (!acc.open) {
        v.closed = acc.reason;
        v.isLoading = false;
        return;
      }
      await Actions.callChain(context, { chain: 'loadApprovalsChain', params: { week: '' } });
    }
  }

  return loadChain;
});
