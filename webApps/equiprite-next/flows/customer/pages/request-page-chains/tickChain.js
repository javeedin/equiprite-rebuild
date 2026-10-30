define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // A piece's tick box, the header's (lineId 'all'), or the next step's shortcut (status): tick exactly the pieces in
  // one status (the ones on their way to accept, the ones on site to return) and bring the equipment into view, as
  // New's selectChain does. Nothing is sent; a staged action is dropped, since what it would act on changed.
  class tickChain extends ActionChain {
    async run(context, { lineId, checked, status }) {
      const v = context.$page.variables;
      const lines = v.lines || [];
      let next = Object.assign({}, v.ticks || {});
      if (status) {
        next = {};
        lines.forEach((l) => { if (l.lineStatus === status) next[l.lineId] = true; });
      } else if (lineId === 'all') {
        next = {};
        if (checked === true || checked === 'true') lines.forEach((l) => { next[l.lineId] = true; });
      } else if (lineId) {
        if (checked === true || checked === 'true') next[String(lineId)] = true;
        else delete next[String(lineId)];
      } else {
        return;
      }
      v.ask = {};
      v.ticks = next;
      if (status) {
        try {
          const el = document.getElementById('crLines');
          if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) { /* not in a browser */ }
      }
    }
  }

  return tickChain;
});
