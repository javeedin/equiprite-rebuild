define([
  'resources/js/recordCostMock'
], (rc) => {
  'use strict';

  // Record Cost (POC). Every rule - defaults, required fields, the payload
  // each tab would send - lives in resources/js/recordCostMock.js so the
  // chains and the bindings cannot drift apart. These are thin wrappers.

  function meta(tab) {
    return rc.TABS.find(t => t.id === tab) || rc.TABS[0];
  }

  class PageModule {
    tabTitle(tab) {
      return meta(tab).title;
    }

    tabBlurb(tab) {
      return meta(tab).blurb;
    }

    // AP header total = the one line, negative for a credit memo.
    invoiceTotal(form) {
      const f = form || {};
      const n = Number(f.lineAmount);
      if (f.lineAmount === null || f.lineAmount === undefined || f.lineAmount === '' || isNaN(n)) return '—';
      const amount = (f.invoiceType === 'Credit Memo' ? -1 : 1) * Math.abs(n);
      try {
        return amount.toLocaleString(undefined, { style: 'currency', currency: f.currency || 'USD' });
      } catch (e) {
        return (f.currency || '') + ' ' + amount.toFixed(2);
      }
    }

    orDash(value) {
      return value === null || value === undefined || value === '' ? '—' : String(value);
    }
  }

  return PageModule;
});
