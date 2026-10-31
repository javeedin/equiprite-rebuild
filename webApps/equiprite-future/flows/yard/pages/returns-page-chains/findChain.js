define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/directReturn',
], (ActionChain, Actions, dr) => {
  'use strict';

  // Finds equipment still in the field: New's searchDirectChain (Enter or Search) and DirectReturnSearchChain, the same
  // calls: views/deployed-units?serialNumber=<term> (an exact unit identifier, as a scanner reads it), and when that finds
  // nothing, ?q=<term> (a typed fragment). A list of candidates, never a choice: nothing is ticked, even for one match,
  // because a unit can be out on more than one rental. Reads only.
  class findChain extends ActionChain {
    async run(context, { value, key }) {
      const v = context.$page.variables;
      if (key !== undefined && key !== null && key !== '' && key !== 'Enter') return;
      if (value !== undefined && value !== null) v.findQuery = String(value);
      const term = String(v.findQuery || '').trim();
      v.findBanner = { type: '', text: '' };
      if (!term) {
        v.found = [];
        v.foundTicks = [];
        v.foundMeta = { recordCount: 0, page: 0, hasMore: false, tooShort: false, searched: false };
        return;
      }
      if (v.busy) return;
      v.busy = 'search';
      try {
        const exact = await dr.findDeployedUnits(context, Actions, { serialNumber: term, page: 0, size: dr.DEFAULT_PAGE_SIZE });
        let result = exact;
        if (exact.ok && !exact.rows.length) {
          result = await dr.findDeployedUnits(context, Actions, { q: term, page: 0, size: dr.DEFAULT_PAGE_SIZE });
        }
        if (!result.ok) {
          v.found = [];
          v.foundTicks = [];
          v.foundMeta = { recordCount: 0, page: 0, hasMore: false, tooShort: false, searched: true, error: true };
          return;
        }
        v.foundTicks = [];
        v.found = result.rows;
        v.foundMeta = {
          recordCount: result.recordCount, page: result.page, pageSize: result.pageSize, totalPages: result.totalPages,
          hasMore: result.hasMore, tooShort: result.tooShort === true, searched: true, error: false, ambiguous: result.rows.length > 1,
        };
      } finally {
        v.busy = '';
      }
    }
  }

  return findChain;
});
