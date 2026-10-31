define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // One field of the business-unit editor changed (New EquipRite's setDraftChain, for its EsDraft form): the value
  // rules the old components applied are applied here — on/off fields are true / false (oj-switch), the markup a
  // number or null when empty (oj-input-number), the rest text — into a new draft object.
  const FORMS = { EsDraft: true };
  const BOOLS = { PASS_PROCUREMENT_COST: true, ADHOC_TIMESHEET_ENABLED: true };
  const NUMBERS = { MARGIN_PERCENTAGE: true };
  const FIELDS = { RATE_SOURCE: true, PPM_TRANS_SOURCE: true, PPM_BATCH_PREFIX: true, PASS_PROCUREMENT_COST: true, ADHOC_TIMESHEET_ENABLED: true, MARGIN_PERCENTAGE: true };

  class setDraftChain extends ActionChain {
    async run(context, { form, field, value }) {
      const { $page } = context;
      if (!FORMS[form] || !FIELDS[field] || $page.variables.readOnly || $page.variables.isEsSaving) return;
      let v = value == null ? '' : value;
      if (BOOLS[field]) {
        v = v === true || v === 'true';
      } else if (NUMBERS[field]) {
        v = String(v).trim() === '' ? null : (isNaN(Number(v)) ? String(v) : Number(v));
      } else {
        v = String(v);
      }
      const next = Object.assign({}, $page.variables[form] || {});
      next[field] = v;
      $page.variables[form] = next;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return setDraftChain;
});
