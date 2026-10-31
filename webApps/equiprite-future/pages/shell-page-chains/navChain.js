define(['vb/action/actionChain'], (ActionChain) => {
  'use strict';

  // The menu button: on a wide window the menu collapses to icons (kept for next time); on a narrow one it slides
  // over the content.
  const NARROW = 900;

  class navChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      if (window.innerWidth < NARROW) {
        $page.variables.navOpen = !$page.variables.navOpen;
        return;
      }
      $page.variables.navCollapsed = !$page.variables.navCollapsed;
      try { localStorage.setItem('eqr.next.nav', $page.variables.navCollapsed ? 'rail' : 'full'); } catch (e) { /* private mode */ }
    }
  }

  return navChain;
});
