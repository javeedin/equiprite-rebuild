define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // New EquipRite: the section index. Marks the section and scrolls it to the top of the page.
  class jumpChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      if (!key) return;
      $page.variables.activeSection = String(key);
      const el = typeof document !== 'undefined' ? document.getElementById('cfg-' + key) : null;
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  return jumpChain;
});
