define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Enable/disable a BU & Org mapping from the ACTIVE toggle. PATCHes just the
  // isActiveFlag on that one row (per-row endpoint), then reloads.
  //
  // Guarded: the switch's value is one-way bound to the row's isActiveFlag, so a
  // reload re-renders it and fires value-changed again — we skip when the desired
  // state already matches, so there's no PATCH/reload loop.
  class toggleBuOrgActiveChain extends ActionChain {
    async run(context, { rowKey, value } = {}) {
      const { $page } = context;
      if (rowKey == null) return;

      const row = ($page.variables.BuOrgMappingsArray || [])
        .find(function (r) { return r.rowKey === rowKey; });
      if (!row || row.id == null) return;

      const desired = value ? 'Y' : 'N';
      if (desired === row.isActiveFlag) return; // already in that state — no-op

      $page.variables.isBuOrgSaving = true;
      let ok = false;
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchBuOrgMapping',
          uriParams: { id: row.id },
          body: { isActiveFlag: desired, lastUpdatedBy: 'EQUIPRITE' }
        });
        ok = !!(res && res.ok);
        if (!ok) console.error('toggleBuOrgActiveChain: PATCH failed', res && res.statusCode);
      } catch (e) {
        console.error('toggleBuOrgActiveChain: exception', e);
      }
      $page.variables.isBuOrgSaving = false;

      if (ok) {
        await Actions.callChain(context, { chain: 'loadBuOrgMappingsChain' });
        await Actions.fireNotificationEvent(context, {
          summary: desired === 'Y' ? 'Mapping enabled' : 'Mapping disabled',
          message: '"' + (row.orgName || row.orgId) + '" is now ' + (desired === 'Y' ? 'active' : 'inactive') + '.',
          displayMode: 'transient', type: 'confirmation'
        });
      } else {
        // Reload to snap the toggle back to the true stored state.
        await Actions.callChain(context, { chain: 'loadBuOrgMappingsChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not update mapping',
          message: 'Failed to change the active state. Please try again.',
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return toggleBuOrgActiveChain;
});
