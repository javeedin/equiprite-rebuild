define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens the Attachments dialog on its list, with a fresh load.
  //
  // The dialog has no `open` binding - like every dialog in this app it is
  // opened by id. It sits at the top level of the page HTML, outside the
  // overview-page root, because a dialog nested inside an overflow/transform
  // container paints the scrim and never positions the box.
  class openAttachmentsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.attFilterCat = 'ALL';
      $page.variables.attFilterStatus = 'ALL';

      await Actions.callChain(context, { chain: 'resetAttachmentFormChain', params: { mode: 'list' } });

      const dlg = document.getElementById('attachmentsDialog');
      if (dlg) dlg.open();

      await Actions.callChain(context, { chain: 'loadAttachmentsChain' });
    }
  }

  return openAttachmentsChain;
});
