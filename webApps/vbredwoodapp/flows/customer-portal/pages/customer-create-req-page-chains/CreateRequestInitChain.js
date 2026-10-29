define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/draftStorage',
  'resources/js/draftResume',
], (ActionChain, Actions, _au, draftStorage, draftResume) => {
  'use strict';

  class CreateRequestInitChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;

      // Same-trip return from the catalog/cart back-button: the catalog chains
      // (goToParentChain, DiscardAndGoBackChain) set this flag right before
      // navigating here. Consume it immediately so any SUBSEQUENT fresh entry
      // (e.g. user abandons and re-enters from the dashboard) wipes state as normal.
      // Reopened DRAFT (Edit Draft): copy the staged draft into the flow and
      // restore the form from it exactly like a same-trip return.
      if (draftResume.takeResumeFlag()) {
        draftResume.hydrateFlow($flow);
        $flow.variables.isReturningToCreate = true;
      }
      const isSameTripReturn = $flow.variables.isReturningToCreate === true;
      $flow.variables.isReturningToCreate = false;

      if (!isSameTripReturn) {
        // Fresh entry — wipe any stale draft from a previous abandoned attempt.
        // Refresh-resume only applies on catalog/cart pages, not here.
        draftStorage.clear();
        $flow.variables.CartItemsArray = [];
        $flow.variables.ActiveRequestDetail = {};
        $flow.variables.requestOrigin = '';
        $flow.variables.resumeDraft = null;
      }

      // Always reload both LOVs — page variables are reset on every page entry
      // regardless of whether this is a return trip or a fresh visit.
      // Customer Name and Customer Contact are INDEPENDENT pickers.
      const [custResp, usersResp] = await Promise.all([
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerRefs' }),
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerPortalUsers' })
      ]);

      // Customer Name LOV. Row shape { id, customerName } matches what
      // customerRefsADP keys on (keyAttributes: "id", textFilterAttributes:
      // ["customerName"]) and what CustomerSelectedChain reads.
      $page.variables.customerRefsArray =
        (custResp && custResp.ok && custResp.body && Array.isArray(custResp.body.data))
          ? custResp.body.data
              .filter(c => c != null && c.id != null)
              .map(c => ({ id: Number(c.id), customerName: c.customerName || ('Customer ' + c.id) }))
          : [];

      // Customer Contact LOV. ALL portal users, every status (no customer
      // filter, no status filter). Row shape { id, contactName, username,
      // email } matches customerPortalUsersADP and ContactSelectedChain.
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

      console.log('[CreateRequestInitChain] customers:', $page.variables.customerRefsArray.length,
                  'contacts:', $page.variables.customerPortalUsersArray.length);

      if (isSameTripReturn) {
        // Restore the form fields from the snapshot saved by CreateRequestNextChain
        // just before it navigated to the catalog. ActiveRequestDetail is the
        // canonical source — it captures every field the form uses. The LOV option
        // arrays are already reloaded above, so the customer/contact pickers can
        // resolve their saved IDs back to display labels.
        const d = $flow.variables.ActiveRequestDetail || {};
        $page.variables.formData = {
          customerRefId:      d.customerRefId      != null ? d.customerRefId : null,
          customerName:       d.customerName       || '',
          requestorId:        d.requestorId        != null ? d.requestorId   : null,
          requestorName:      d.requestorName      || '',
          location:           d.location           || '',
          requestedStartDate: d.requestedStartDate || null,
          requestedEndDate:   d.requestedEndDate   || null,
          notes:              d.notes              || ''
        };
      }
    }
  }

  return CreateRequestInitChain;
});
