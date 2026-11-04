define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood header's buttons (Oracle's general overview page: its secondary actions, and back), each what the current
  // look's button does: Refresh reads the quote again; Export to Excel exports its lines and total; Open the PDF opens it
  // in a new window and Download saves it, as the current look's links do; The request opens in its tab; back is the portal.
  class rwActChain extends ActionChain {
    async run(context, { id }) {
      const v = context.$page.variables;
      if (id === 'refresh') await Actions.callChain(context, { chain: 'loadQuoteChain' });
      else if (id === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
      else if (id === 'request') await Actions.callChain(context, { chain: 'openChain', params: { record: 'customer-request' } });
      else if (id === 'back') await Actions.callChain(context, { chain: 'openChain', params: { record: 'portal' } });
      else if ((id === 'pdf' || id === 'download') && v.hasQuoteDoc && v.quotePdfUrl) {
        const a = document.createElement('a');
        a.href = v.quotePdfUrl;
        if (id === 'pdf') { a.target = '_blank'; a.rel = 'noopener'; } else a.download = v.quoteFileName || 'quote.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    }
  }

  return rwActChain;
});
