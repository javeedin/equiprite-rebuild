define(['resources/js/exportKit'], (exportKit) => {
  'use strict';

  // Help: binding helpers. The flow, its steps and the statuses are resources/js/helpGuide.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }

    /** Redwood look: the general overview page's secondary actions (its header's buttons). */
    rwActions(loading) {
      return [{ id: 'refresh', label: loading ? 'Refreshing…' : 'Refresh the numbers', icon: 'oj-ux-ico-refresh', display: 'on' }];
    }
  }

  return PageModule;
});
