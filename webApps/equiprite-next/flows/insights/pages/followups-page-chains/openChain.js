define([
  'vb/action/actionChain',
  'resources/js/followupsClient',
], (ActionChain, FC) => {
  'use strict';

  // Open one saved follow-up on the right: read its header and lines.
  class openChain extends ActionChain {
    async run(context, { id }) {
      const v = context.$page.variables;
      v.selId = String(id || '');
      if (!v.selId) { v.detail = null; return; }
      const r = await FC.get(v.selId);
      v.detail = (r.ok && r.body && r.body.followup) ? r.body.followup : null;
    }
  }

  return openChain;
});
