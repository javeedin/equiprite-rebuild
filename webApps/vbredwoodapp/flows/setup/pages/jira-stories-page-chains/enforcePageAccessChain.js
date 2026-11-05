define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // Page-level RBAC deep-link guard. GENERATED - every copy is byte-identical;
  // change the template and regenerate rather than editing one copy.
  //
  // Copies exist because a page's eventListeners resolve a bare chain id
  // against that page's OWN <page>-chains folder, so an app-level chain
  // referenced by name 404s. This file holds NO policy: the decision
  // (canEnterPage), the page code (getPageCodeForPage), the redirect target
  // (getRoleHomeTarget) and the same-flow test (isSameFlow) all live in
  // $application.functions. Deriving the page code at runtime is what lets
  // every copy be identical.
  class enforcePageAccessChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      try {
        const fns = $application.functions;
        const vars = $application.variables;
        const pageCode = fns.getPageCodeForPage($application.currentPage);

        // Ungated page (detail/child pages) - render it.
        if (!pageCode) { return; }

        if (fns.canEnterPage(vars.pageAccessMap, vars.pageAccessLoaded, pageCode)) {
          return;
        }

        // The role's OWN landing page, not a hardcoded dashboard - not every
        // role can open the dashboard, and sending one that cannot would
        // re-trigger this same guard.
        const home = fns.getRoleHomeTarget(vars.featureFlags, vars.flagsLoaded,
          vars.pageAccessMap, vars.pageAccessLoaded);

        // Never redirect a page to itself. getRoleHomeTarget only returns pages
        // the role can open, or the ungated No Access page when it can open
        // none, so this should be unreachable -- it is kept as a backstop.
        // (Its old last resort was Configuration Settings, whose guard landed
        // here and RENDERED the page: a user with no role saw admin settings.)
        if (home.page === ($application.currentPage || {}).id) {
          console.error('[enforcePageAccessChain] no landing page for this role;'
            + ' staying put rather than looping');
          return;
        }

        console.warn('[enforcePageAccessChain] blocked', pageCode, '-> ',
          home.flow + '/' + home.page);

        // The navigation action depends on whether the target is in this flow.
        // navigateToFlow + target:'parent' asks the PARENT router to switch
        // flows; when the destination flow is the one already displayed there
        // is nothing to switch and VB throws "Cannot read properties of null
        // (reading 'getLeafPageInstanceFromFlowId')". Omitting 'parent' has the
        // mirror problem on a genuine cross-flow hop: VB resolves the flow id
        // relative to the current flow and 404s. Since the Dashboard became the
        // shared landing page, home.flow is 'main' for most roles, so the
        // same-flow case is now the common one rather than impossible.
        if (fns.isSameFlow($application.currentPage, home.flow)) {
          await Actions.navigateToPage(context, { page: home.page });
        } else {
          await Actions.navigateToFlow(context,
            { flow: home.flow, page: home.page, target: 'parent' });
        }
      } catch (e) {
        console.error('[enforcePageAccessChain] unexpected error', e);
      }
    }
  }

  return enforcePageAccessChain;
});
