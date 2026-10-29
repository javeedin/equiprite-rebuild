define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/pickSlip',
], (ActionChain, Actions, pickSlip) => {
  'use strict';

  // Generates the pick slip for the request currently open in the drawer and
  // shows it in the preview dialog.
  //
  // Runs in TWO situations:
  //   1. automatically at the end of ReleaseTransferOrderChain, on a
  //      confirmation result only;
  //   2. manually from the Print Pick Slip button, for a reprint.
  //
  // NEVER inside the release transaction. A PDF that fails to render must not
  // roll back a pick release — the equipment has been released whether or not
  // the paperwork printed. Every failure path here is therefore reported and
  // swallowed, and the caller is expected to have already committed.

  // No fetching here. Subinventory and locator are resolved once, when the
  // drawer opens (openPickingDrawerChain fires the serial-ref lookups in the
  // same wave as the per-line unit fetches, so they cost no extra wall-clock),
  // and are already sitting on each line as .subinventory / .locator. Printing
  // is therefore synchronous — which is what makes it safe to hang off the end
  // of a release without holding it open.

  class PrintPickSlipChain extends ActionChain {
    // autoOpen=false generates the slip WITHOUT opening the preview — that is
    // how the thumbnail in the drawer gets something to render. The drawer
    // calls it that way on open; Release for Picking and a thumbnail click
    // both want the full preview, so they leave it true.
    async run(context, { autoOpen = true } = {}) {
      const { $page } = context;

      const request = $page.variables.selectedRequest || {};
      const lines   = Array.isArray(request.lines) ? request.lines : [];

      $page.variables.isPrintingPickSlip = true;
      try {
        // The header's Transfer Order number: the drawer holds TO state per
        // line, not per request, so take the number off the SELECTED TO in the
        // LOV — that is the order the user is releasing and printing for. Blank
        // when the request has none, which is the normal case for the
        // non-stockable lines this document exists to serve.
        const selectedTO = (($page.variables.selectedRequestTOs || [])
          .find(t => String(t.value) === String($page.variables.selectedTOId))) || null;

        const model = pickSlip.buildModel(
          {
            requestNumber: request.requestNumber,
            toNumber:      selectedTO ? selectedTO.orderNumber : '',
            // Yard is recorded per line; the header shows the distinct set so a
            // multi-yard request does not silently claim one origin.
            yard: [...new Set(
              lines.map(l => l.yard).filter(y => y != null && String(y).trim() !== '')
            )].join(', '),
            project:      request.project,
            neededByDate: request.neededByDate,
          },
          lines,
          new Date()
        );

        const pdf = pickSlip.buildPickSlipPdf(model);

        // Release the previous preview's blob before replacing it, or every
        // reprint leaks one for the life of the tab.
        if ($page.variables.pickSlipUrl) {
          try { URL.revokeObjectURL($page.variables.pickSlipUrl); } catch (e) { /* already gone */ }
        }

        $page.variables.pickSlipUrl       = pickSlip.toBlobUrl(pdf.base64);
        $page.variables.pickSlipFileName  = pdf.fileName;
        $page.variables.pickSlipDocNumber = pdf.docNumber;

        if (autoOpen) {
          const dialog = document.getElementById('pickSlipPreviewDialog');
          if (dialog && typeof dialog.open === 'function') dialog.open();
        }

        console.log('[PrintPickSlip]', pdf.docNumber, pdf.rowCount, 'lines');
      } catch (e) {
        console.error('[PrintPickSlip] generation failed:', e);
        // Reported through the drawer's existing banner, not a toast:
        // oj-messages renders BEHIND the modal overlay, and the picking dialog
        // stays open across releases, so a toast here would be invisible.
        // Deliberately worded so it cannot be read as "the release failed".
        // Only shout when the user asked for the document. A background
        // generation on drawer open that fails should leave the thumbnail
        // absent, not plant a warning banner over an unrelated release result.
        if (autoOpen) {
          $page.variables.releaseMessage =
            'The pick slip could not be generated. The release itself completed — '
            + 'reopen the request to try again.';
          $page.variables.releaseMessageType = 'warning';
        }
      } finally {
        $page.variables.isPrintingPickSlip = false;
      }
    }
  }

  return PrintPickSlipChain;
});
