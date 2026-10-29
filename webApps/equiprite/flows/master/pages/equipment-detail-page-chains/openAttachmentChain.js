define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Open one document in a new tab. The old viewAttachmentChain's mintUrl: a 15-minute common-service link for the
  // row's commonDocId (GET /common/documents/v1/{docId}/access-url), minted per open and never stored. The tab is
  // opened first and pointed at the link when it arrives, so the popup blocker lets it through.
  class openAttachmentChain extends ActionChain {
    async run(context, { id }) {
      const { $page } = context;
      const row = ($page.variables.attRows || []).find((r) => String(r.id) === String(id));
      if (!row || row.commonDocId == null) return;
      const tab = typeof window !== 'undefined' && window.open ? window.open('', '_blank') : null;
      try {
        const response = await Actions.callRest(context, {
          endpoint: 'commonService/getCommonDocumentAccessUrl',
          uriParams: { docId: Number(row.commonDocId) }
        });
        if (!response.ok || !response.body || !response.body.url) {
          throw new Error('Could not open the file (HTTP ' + response.status + ').');
        }
        if (tab) { tab.location.href = response.body.url; } else { window.open(response.body.url, '_blank', 'noopener'); }
      } catch (e) {
        if (tab) tab.close();
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not open the document', message: e.message, type: 'error', displayMode: 'transient',
        });
      }
    }
  }

  return openAttachmentChain;
});
