define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftResume',
  'resources/js/shellBus',
  'resources/js/portalSignal',
  'resources/js/requestData',
], (ActionChain, Actions, draftResume, bus, signal, requestData) => {
  'use strict';

  // Deletes a customer draft, once the customer has confirmed (deleteAsk): New's draftActionChain delete, the same call
  // (draftResume.deleteDraft: DELETE equipment-requests/{id}, isAdmin, no callerUserId: the customer request's header
  // carries no requestor or portal-user id, as in New). Only a DRAFT request offers it. Then the tab closes and the
  // portal is shown.
  class deleteDraftChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const requestId = Number(v.requestId);
      const head = v.head || {};
      if (!requestId || v.busy || String(head.status || '').toUpperCase() !== 'DRAFT') return;
      v.busy = 'delete';
      try {
        const owner = head.requestorUserId != null ? head.requestorUserId : head.eqrCustomerPortalUserId;
        const del = await draftResume.deleteDraft(context, Actions, requestId, owner);
        if (!del.ok) {
          v.banner = { type: 'error', text: 'The draft was not deleted: ' + del.message, link: '' };
          return;
        }
        v.deleteAsk = false;
        signal.changed();
        requestData.invalidate();
        bus.toast((head.requestNumber || 'The draft') + ' was deleted.', 'info');
        bus.open({ navId: 'customer-portal' });
        bus.close('customer-request:' + (v.id || v.number));
      } finally {
        v.busy = '';
      }
    }
  }

  return deleteDraftChain;
});
