define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // How it works: jump to a flow on the page, or open its screen in a tab.
  class actChain extends ActionChain {
    async run(context, { act, key }) {
      if (act === 'jump' && key) {
        try { const el = document.getElementById('hw-' + key); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* no DOM */ }
        return;
      }
      if (act === 'open' && key) bus.open({ navId: key });
    }
  }
  return actChain;
});
