define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Forces Customer Type when the user has no real choice about it.
  //
  // TWO INDEPENDENT REASONS the choice can be taken away, matching the markup:
  //
  //   LICENCE - each module flag owns one request type (PROJECTS->INTERNAL,
  //             CUSTOMERS->EXTERNAL), so a single-module tenant has exactly one
  //             legal type. forcedCustomerType() returns it, or '' when both
  //             modules are licensed. This applies to EVERY user, managers
  //             included - a licence is not something a role overrides.
  //
  //   ROLE    - a plain equipment requestor cannot raise an external request, so
  //             with both modules licensed they still get INTERNAL.
  //
  // Licence wins when both apply: on a Customers-only tenant even a non-manager
  // seeds EXTERNAL, because INTERNAL is not a type this tenant can service.
  //
  // The readonly field in the page HTML is DISPLAY ONLY - it writes nothing.
  // Without this chain requestTypeSel would stay '' for a fresh request, so:
  //   - every oj-bind-if on the page tests the page scalar, so NONE of the
  //     type-specific fields (Internal Customer / Requestor Contact / Soft
  //     Reservation, or the External party pair) would render - the form would
  //     look broken, not frozen; and
  //   - SubmitRequestChain posts $flow.variables.request.requestType, so the
  //     request would go out with no type at all.
  //
  // Runs on vbEnter AFTER HydrateDraftChain, so a resumed draft has already
  // re-seeded its own value. Only writes when the value is not already the
  // target, so it never fights the hydrate path.
  //
  // Delegates to RequestTypeChangedChain rather than assigning requestTypeSel
  // directly: that chain owns mirroring the page scalar onto
  // $flow.variables.request.requestType (the value that actually gets posted)
  // and is a documented no-op when the type has not changed. Setting the scalar
  // here by hand would leave the flow model empty - the exact split-brain that
  // chain exists to prevent.
  //
  // GATES MATCH THE MARKUP EXACTLY: same canChooseCustomerType() and
  // forcedCustomerType() calls, so the field shown and the value seeded can
  // never disagree. Both fail CLOSED.
  //
  // UX layer. The backend must enforce the real rule - freezing a picker does
  // not stop a crafted payload.

  // Waits briefly for loadFusionRolesChain to populate fusionRoles, which it
  // does IN PARALLEL with page entry - so without this the gate can read an
  // empty array and freeze a MANAGER's picker to Internal.
  //
  // Same bounded-wait shape as dashboardInitChain's waitForRoles, and bounded
  // for the same reason: the roles come from a BIP report that can legitimately
  // return nothing (an unmapped user), so an unbounded wait would hang the page
  // on exactly the accounts that need the frozen default. ~2s at 50ms covers the
  // normal race imperceptibly; past that we proceed with what's there, which
  // fails closed to Internal.
  async function waitForRoles($application, tries = 40, gapMs = 50) {
    for (let i = 0; i < tries; i++) {
      if (($application.variables.fusionRoles || []).length) return;
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  // Then for the server's session roles (loadPageAccessChain, GET
  // /rbac/session-roles), which is what lets a manager whose Fusion role is
  // named differently (OII_RT_EQP_MANAGER_JR) pick a type. sessionRolesLoaded
  // is a SETTLED latch, set on success and failure alike, so this normally
  // returns as soon as the call ends; the bound only covers a hung call.
  // Past it, canChooseCustomerType falls back to the RT_EQP_* codes.
  async function waitForSessionRoles($application, tries = 100, gapMs = 50) {
    for (let i = 0; i < tries; i++) {
      if ($application.variables.sessionRolesLoaded) return;
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  // Same race on the licence side: loadFeatureFlagsChain runs on the app's
  // vbEnter, which can still be in flight when this page enters. Reading the
  // flags too early makes forcedCustomerType() fail closed to INTERNAL, which
  // on a Customers-only tenant would seed the ONE type that tenant cannot
  // service. Bounded for the same reason as the roles wait.
  async function waitForFlags($application, tries = 40, gapMs = 50) {
    for (let i = 0; i < tries; i++) {
      if ($application.variables.flagsLoaded) return;
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  class SeedCustomerTypeChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;

      await Promise.all([
        waitForRoles($application).then(() => waitForSessionRoles($application)),
        waitForFlags($application)
      ]);

      const fns = $application.functions;

      // '' when both modules are licensed, so the licence forces nothing.
      const forced = fns.forcedCustomerType(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded
      );

      const canChoose = fns.canChooseCustomerType(
        $application.variables.fusionRoles,
        $application.variables.sessionRoles
      );

      // Licence first - it binds regardless of role. Falling back to the role
      // rule only matters when both modules are licensed, and there INTERNAL is
      // the historical frozen default for anyone who cannot choose.
      const target = forced || (canChoose ? '' : 'INTERNAL');

      // Nothing to force: a manager on a dual-module tenant picks freely and the
      // field stays blank with its placeholder.
      if (!target) return;

      const current = String($page.variables.requestTypeSel || '').toUpperCase();
      if (current === target) return;

      // A saved value that disagrees with the target means a draft raised under
      // different conditions is being reopened - by someone who cannot choose,
      // or on a tenant whose licence has since changed. Forcing would silently
      // rewrite their request, so leave it and log.
      //
      // The licence half of this is a DEV-ONLY situation: the module flags are
      // provisioning-time product flags, fixed per tenant at implementation, so
      // in production a draft cannot outlive its licence. Hence a console
      // breadcrumb rather than a user-facing warning.
      // (The page-access guard should keep such a user off this draft entirely.)
      if (current) {
        console.warn('[SeedCustomerTypeChain] saved Customer Type is ' + current
          + ' but this context forces ' + target
          + ' - leaving the saved value as-is');
        return;
      }

      await Actions.callChain(context, {
        chain:  'RequestTypeChangedChain',
        params: { requestType: target }
      });
    }
  }

  return SeedCustomerTypeChain;
});
