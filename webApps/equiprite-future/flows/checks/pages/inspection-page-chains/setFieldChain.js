define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Inspection notes and the acknowledgement a conditional result needs (New EquipRite's setFieldChain).
  class setFieldChain extends ActionChain {
    async run(context, { field, value }) {
      const { $page } = context;
      const v = $page.variables;
      if (field === 'notes') {
        v.notes = value == null ? '' : String(value);
      } else if (field === 'ack') {
        v.ack = value === true || value === 'true';
        v.blocked = [];
      }
    }
  }

  return setFieldChain;
});
