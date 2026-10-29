define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Load the two EXTERNAL-flow party LOVs: Customer Name (EQR_CUSTOMER_REF) and
   * Customer Contact (EQR_CUSTOMER_PORTAL_USER).
   *
   * Deliberately a copy of customer-create-req-page CreateRequestInitChain's
   * LOV block — same endpoints, same row shapes — so an EXTERNAL request raised
   * from THIS page resolves its customer and contact from exactly the same
   * source as one raised in the customer flow, and lands in the same DB columns
   * (eqrCustomerRefId / eqrCustomerPortalUserId).
   *
   * The two pickers are INDEPENDENT: there is no DB relationship between a
   * customer and a portal user, so picking a customer neither filters nor
   * clears the contact list. Both are fetched once, up front.
   *
   * Called on page enter and again when Request Type flips to EXTERNAL (the
   * lists are page variables, so they are empty on a fresh entry). Best-effort:
   * a failed fetch leaves the picker empty rather than blocking the form, and
   * re-selecting the type retries.
   */
  class LoadExternalPartyLovsChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // Already loaded — don't re-fetch on every type toggle.
      if (($page.variables.customerRefsArray || []).length &&
          ($page.variables.customerPortalUsersArray || []).length) {
        return;
      }

      const [custResp, usersResp] = await Promise.all([
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerRefs' }),
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerPortalUsers' })
      ]);

      // Row shape { id, customerName } — matches customerRefsADP's keyAttributes
      // and textFilterAttributes, and what CaptureExternalCustomerChain reads.
      $page.variables.customerRefsArray =
        (custResp && custResp.ok && custResp.body && Array.isArray(custResp.body.data))
          ? custResp.body.data
              .filter(c => c != null && c.id != null)
              .map(c => ({ id: Number(c.id), customerName: c.customerName || ('Customer ' + c.id) }))
          : [];

      // ALL portal users, every status — no customer filter, no status filter
      // (mirrors the customer flow exactly).
      $page.variables.customerPortalUsersArray =
        (usersResp && usersResp.ok && usersResp.body && Array.isArray(usersResp.body.data))
          ? usersResp.body.data
              .filter(u => u != null && u.id != null)
              .map(u => ({
                id:          Number(u.id),
                contactName: u.contactName || u.username || ('User ' + u.id),
                username:    u.username || '',
                email:       u.email || ''
              }))
          : [];

      console.log('[LoadExternalPartyLovsChain] customers:', $page.variables.customerRefsArray.length,
                  'contacts:', $page.variables.customerPortalUsersArray.length);
    }
  }

  return LoadExternalPartyLovsChain;
});
