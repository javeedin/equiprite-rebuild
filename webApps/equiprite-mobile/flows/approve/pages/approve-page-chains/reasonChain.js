define(['vb/action/actionChain', 'resources/js/mobileApprove'], (ActionChain, ma) => {
  'use strict';

  // The reason for sending back: typed (text), or a quick reason tapped (phrase), added as a sentence or taken out
  // again. A native text box stops following its bound value once typed in, so the box is set too.
  class reasonChain extends ActionChain {
    async run(context, { text, phrase }) {
      const pv = context.$page.variables;
      if (phrase) {
        const next = ma.addReason(pv.reason, phrase);
        pv.reason = next;
        const el = typeof document !== 'undefined' ? document.getElementById('apReason') : null;
        if (el) el.value = next;
      } else {
        pv.reason = String(text == null ? '' : text);
      }
      if (pv.reason.trim()) pv.formError = '';
    }
  }

  return reasonChain;
});
