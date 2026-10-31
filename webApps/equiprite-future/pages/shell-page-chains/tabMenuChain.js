define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/tabs',
  'resources/js/shellTabs',
  'resources/js/shellBus',
], (ActionChain, Actions, tabs, shellTabs, bus) => {
  'use strict';

  // The tab strip's menu: toggle it, close the other tabs, or close them all (My work stays).
  class tabMenuChain extends ActionChain {
    async run(context, { action }) {
      const { $page } = context;
      if (action === 'toggle') {
        $page.variables.tabMenuOpen = !$page.variables.tabMenuOpen;
        $page.variables.bellOpen = false;
        $page.variables.profileOpen = false;
        $page.variables.personaOpen = false;
        $page.variables.clockOpen = false;
        return;
      }
      $page.variables.tabMenuOpen = false;
      const st = shellTabs.state(context);
      const closing = st.tabs.filter((t) => !t.pinned && (action === 'all' || t.id !== st.current)).map((t) => t.id);
      const warning = bus.closeWarning(closing);
      if (warning && !window.confirm(warning + ' Close the tabs anyway?')) return;
      if (action === 'others') await shellTabs.update(context, Actions, (s) => tabs.closeOthers(s, s.current));
      if (action === 'all') await shellTabs.update(context, Actions, (s) => tabs.closeOthers(s, ''));
    }
  }

  return tabMenuChain;
});
