define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens the full pick slip preview from the thumbnail card.
  //
  // Nothing is regenerated: the drawer built the slip on open and the blob URL
  // the card is already rendering is the same one the preview shows. So the
  // sheet that opens is exactly the sheet on the card, and clicking costs no
  // work — which is the point of generating up front.
  class OpenPickSlipPreviewChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      if (!$page.variables.pickSlipUrl) return;

      const dialog = document.getElementById('pickSlipPreviewDialog');
      if (dialog && typeof dialog.open === 'function') dialog.open();
    }
  }

  return OpenPickSlipPreviewChain;
});
