define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Fired by the Internal Customer oj-select-single's on-value-item-changed.
  //
  // Named "Fallback" for historical reasons: this used to be the second of two
  // customer pickers, shown only until a contract was chosen, at which point a
  // contract-scoped BIP picker took over. That BIP picker is gone (its only
  // purpose was parameterising the old per-customer ship-to-sites report, which
  // is now contract-scoped), so this is the ONLY customer path on the page and
  // the name is a misnomer — kept to avoid a rename with no behavioural gain.
  //
  // Writes request.customerId, then re-runs CustomerSelectedChain (agreement
  // filtering by fusionCustomerId) — that behavior only ever applied to this
  // Fusion-CustomerId-based source.
  class CaptureFallbackCustomerChain extends ActionChain {
    async run(context, { data, updatedFrom } = {}) {
      const { $page, $flow } = context;
      // The Customer oj-select-single's value-item is bound ONE-WAY from
      // selectedCustomerObj, so HydrateDraftChain / RequestTypeChangedChain
      // writing that variable fires value-item-changed with updatedFrom
      // 'external'. Only a user pick or clear ('internal') is a new selection.
      if (updatedFrom === 'external') return;
      // shippingCustomersLOV identifies the customer by CustomerId, so read that
      // first; PartyId is kept as a fallback for any older row shape.
      const id = data ? (data.CustomerId || data.PartyId || null) : null;

      $flow.variables.request.customerId    = id;
      $page.variables.selectedCustomerObj   = data || null;
      // Mirror the display name onto the flow model. selectedCustomerObj is a
      // PAGE variable and resets on page re-entry, so without this the field
      // renders blank after a catalog round-trip even though customerId
      // survives. HydrateDraftChain rebuilds the object from this.
      $flow.variables.request.customerName  =
        (data && (data.Customer || data.PartyName)) || '';
      // NOTE: the chosen location is deliberately NOT cleared here any more.
      // Ship-to sites are scoped to project+contract, not to the customer, so
      // changing the customer no longer invalidates the selected site — wiping
      // it would silently discard a still-valid address. CaptureContractChain
      // clears it instead, which is where the scope actually changes.

      await Actions.callChain(context, {
        chain: 'CustomerSelectedChain',
        params: { fusionCustomerId: id }
      });
    }
  }

  return CaptureFallbackCustomerChain;
});
