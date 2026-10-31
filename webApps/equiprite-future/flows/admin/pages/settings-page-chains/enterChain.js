define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
], (ActionChain, Actions, rules) => {
  'use strict';

  // Opens Settings: waits briefly for page access, then loads as New EquipRite's Configuration page does on entry
  // (pageEnterChain, loadConfigSettingsChain, loadEsSettingsChain; the list sections it also loads are New's).
  // Read-only unless the role's access to EQR_CONFIGURATIONS is Full. New made the page read-only for READ_ONLY
  // only; Next also keeps it read-only while access is unknown, so a write never depends on a guess.
  const TRIES = 60;
  const GAP_MS = 50;

  class enterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < TRIES && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      $page.variables.readOnly = rules.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_CONFIGURATIONS') !== 'FULL';
      await Actions.callChain(context, { chain: 'loadConfigSettingsChain' });
      await Actions.callChain(context, { chain: 'loadEsSettingsChain' });
    }
  }

  return enterChain;
});
