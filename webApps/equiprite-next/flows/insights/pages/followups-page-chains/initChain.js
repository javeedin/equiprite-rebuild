define([
  'vb/action/actionChain',
  'resources/js/followupsClient',
], (ActionChain, FC) => {
  'use strict';

  // Opening the Follow-ups page: is this the desktop app (DuckDB on this PC)? Then read the saved follow-ups.
  class initChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const info = await FC.info();
      v.checked = true;
      v.available = !!info.available;
      if (!v.available) { v.followups = []; return; }
      v.busy = true;
      try {
        const r = await FC.list();
        v.followups = (r.ok && r.body && r.body.followups) ? r.body.followups : [];
      } finally {
        v.busy = false;
      }
    }
  }

  return initChain;
});
