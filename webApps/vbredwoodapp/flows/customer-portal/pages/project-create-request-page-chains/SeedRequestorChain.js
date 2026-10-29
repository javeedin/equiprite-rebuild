define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
], (ActionChain, Actions, cu) => {
  'use strict';

  // Locks the INTERNAL Requestor Contact to the signed-in user.
  //
  // The requestor IS the logged-in user — captured from the session identity,
  // not looked up in any table. currentUser.auditActor resolves the username by
  // the same identity walk as the RBAC roles and the X-User-Id audit stamp (JWT
  // `sub` first, then $application.user), so the three can never name different
  // people; displayName gives the person's name for the field.
  //
  // Both are posted on the request header as requestorName / requestorUsername.
  // requestorUserId (the EQR_USER FK) is no longer set for INTERNAL: EQR_USER is
  // a seed list, not the user directory, and requiring a row there left real
  // users with no requestor at all.
  //
  // RUNS: on vbEnter after SeedCustomerTypeChain, and from
  // RequestTypeChangedChain whenever the type lands on INTERNAL (that chain
  // clears requestorId on every switch). EXTERNAL is left alone — its Customer
  // Contact shares request.requestorId and is still a real pick.
  //
  // UX layer. A client-decoded JWT is an unverified claim; the backend stamps
  // the requestor from X-User-Id and must not trust the body as identity.
  class SeedRequestorChain extends ActionChain {
    async run(context) {
      const { $flow, $page } = context;
      const request = $flow.variables.request;

      if (String(request.requestType || '').toUpperCase() === 'EXTERNAL') return;

      // auditActor already logs which identity sources were empty.
      const actor = cu.auditActor(context);
      request.requestorId       = null;
      request.requestorUsername = actor || '';
      request.requestorName     = actor ? (cu.displayName(context) || actor) : '';

      // The locked box is a one-option LOV, so its single item is the user.
      $page.variables.requestorArray = request.requestorName
        ? [{ value: request.requestorName, label: request.requestorName }]
        : [];
    }
  }

  return SeedRequestorChain;
});
