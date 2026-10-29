define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/equipmentAttachments',
  'resources/js/currentUser',
], (ActionChain, Actions, ea, cu) => {
  'use strict';

  // Remove = eqpt DELETE: EQR_ATTACHMENT.STATUS -> REMOVED, and eqpt
  // deactivates the common-service document. Soft on purpose - the row and
  // the file stay for audit. Idempotent on the backend.
  //
  // Only the page's OWN attachments reach here; the master's documents on a
  // serial page are read-only (no Remove button).
  //
  // The confirm step is inline on the row (attConfirmRemoveId), so this chain
  // only runs on the confirming click.
  class removeAttachmentChain extends ActionChain {
    async run(context, { id }) {
      const { $page } = context;
      if (!id) return;

      $page.variables.attNotice = {};
      try {
        const response = await Actions.callRest(context, {
          endpoint: 'eqp-v1/removeEquipmentAttachment',
          uriParams: { id: Number(id) },
          headers: cu.auditHeaders(context)
        });
        if (!response.ok) throw new Error(ea.errorText(response, 'Could not remove the attachment'));
        $page.variables.attNotice = { type: 'success', text: 'Attachment removed.' };
        await Actions.callChain(context, { chain: 'loadAttachmentsChain' });
      } catch (e) {
        $page.variables.attNotice = { type: 'error', text: e.message };
      } finally {
        $page.variables.attConfirmRemoveId = null;
      }
    }
  }

  return removeAttachmentChain;
});
