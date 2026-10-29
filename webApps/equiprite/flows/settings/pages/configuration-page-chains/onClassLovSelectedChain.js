define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/onClassLovSelectedChain.js, unchanged.

  // A class was picked. Mirror its LABEL into className (that is what actually
  // gets persisted to EQR_EQUIPMENT_CLASS.CLASS_NAME — the Fusion id is the LOV
  // key, not our storage), clear any subclass chosen under the previous class,
  // and reload the subclass list cascaded off the new parent.
  class onClassLovSelectedChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const form = $page.variables.newClassSubclass || {};
      const picked = ($page.variables.ClassLovArray || [])
        .find(r => String(r.value) === String(form.classLovId));

      $page.variables.newClassSubclass = {
        ...form,
        // Fall back to the existing name rather than blanking it if the lookup
        // misses -- a cleared name would silently fail the required-field check
        // on submit with no visible cause.
        className: picked ? picked.label : (form.className || ''),
        subclassLovId: null,
        subclassName: ''
      };

      await Actions.callChain(context, { chain: 'loadSubclassLovChain' });
    }
  }

  return onClassLovSelectedChain;
});
