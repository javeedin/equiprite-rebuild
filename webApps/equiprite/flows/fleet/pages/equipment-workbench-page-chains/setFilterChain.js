define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // One filter changed. A chip clicked again clears it; a lane tile clicked again shows every lane.
  class setFilterChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      const val = value == null ? '' : String(value);
      if (field === 'text') v.text = val;
      else if (field === 'cls') v.cls = v.cls === val ? '' : val;
      else if (field === 'yard') v.yard = v.yard === val ? '' : val;
      else if (field === 'lane') v.lane = v.lane === val ? 'all' : (val || 'all');
      else if (field === 'tight') v.tightOnly = !v.tightOnly;
      else if (field === 'view') v.view = val === 'list' ? 'list' : 'board';
    }
  }

  return setFilterChain;
});
