define(['vb/action/actionChain', 'resources/js/shellBus'], (ActionChain, bus) => {
  'use strict';

  // Build.Rite: the build in scope, chosen in the top bar ('?': the one kept on this PC, when the shell opens). Issues and
  // Application pages follow it (shellBus.onScope).
  class scopeChain extends ActionChain {
    async run(context, { app }) {
      const v = context.$page.variables;
      if (app === '?') { v.scope = bus.scope(); return; }
      const next = String(app || '');
      v.scope = next;
      if (next !== bus.scope()) bus.setScope(next);
    }
  }
  return scopeChain;
});
