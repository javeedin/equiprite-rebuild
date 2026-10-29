define([
  'vb/action/actionChain',
  'resources/js/unitScanner',
], (ActionChain, scanner) => {
  'use strict';

  /**
   * Open the Direct Return dialog, cleared.
   *
   * Reset every time rather than reusing the last search: the operator is
   * holding a DIFFERENT piece of equipment, and leaving the previous result set
   * on screen invites returning the wrong one.
   */
  class OpenDirectReturnChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.directReturnQuery     = '';
      $page.variables.directReturnRows      = [];
      $page.variables.directReturnSelected  = [];
      $page.variables.directReturnSearching = false;
      $page.variables.directReturnMeta      = { recordCount: 0, page: 0, hasMore: false, searched: false };
      $page.variables.directReturnOpen      = true;

      // Scanner state. scanSupported drives whether the Scan button renders
      // at all - offering a camera button on an insecure origin (reaching the
      // dev server by LAN IP, say) or in a browser without getUserMedia would
      // give the operator a control that can only fail.
      $page.variables.scanOpen        = false;
      $page.variables.scanReadingText = false;
      $page.variables.scanTorchOn        = false;
      $page.variables.scanTorchAvailable = false;

      // Keep the REASON when the camera is unusable, so the dialog can say
      // why the Scan button is absent instead of leaving the operator to
      // guess whether scanning is broken. Every other way in still works: a
      // barcode gun types into the search box exactly as a human does.
      const probe = scanner.isCameraAvailable();
      $page.variables.scanSupported = probe.ok;
      $page.variables.scanStatus    = probe.ok ? '' : probe.message;

      // oj-dialog is opened IMPERATIVELY - it has no bindable `opened`
      // property, so setting a variable alone does nothing. Same call
      // openPickingDrawerChain makes for pickingDetailDialog on this page.
      const dialog = document.getElementById('directReturnDialog');
      if (dialog && typeof dialog.open === 'function') dialog.open();
      else console.warn('[OpenDirectReturnChain] directReturnDialog not found');
    }
  }

  return OpenDirectReturnChain;
});
