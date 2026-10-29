define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Closes the pick slip preview, and ONLY that.
  //
  // It used to revoke the blob URL here, which was right when the preview was
  // the only thing rendering it. It no longer is: the thumbnail card in the
  // drawer renders the same URL, so revoking on close blanked the card the
  // moment the user dismissed the preview. The revoke lives in
  // closePickingDrawerChain now — the drawer closing is what actually ends the
  // document's life on screen.
  //
  // The picking dialog underneath stays open, so the user lands back on the
  // request they printed for and can release the next transfer order.
  class ClosePickSlipPreviewChain extends ActionChain {
    async run(context) {
      const dialog = document.getElementById('pickSlipPreviewDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();
    }
  }

  return ClosePickSlipPreviewChain;
});
