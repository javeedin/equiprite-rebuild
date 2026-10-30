define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // "Open a request": Enter opens the request typed (a number alone reads as REQ-number) in its own tab.
  class workFindChain extends ActionChain {
    async run(context, { text, key }) {
      context.$page.variables.find = text ? '' + text : '';
      const t = (text ? '' + text : '').trim();
      if (key !== 'Enter' || !t) return;
      bus.open({ record: 'request', params: { number: /^\d+$/.test(t) ? 'REQ-' + t : t.toUpperCase() } });
    }
  }

  return workFindChain;
});
