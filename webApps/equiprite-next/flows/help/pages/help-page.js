define(['resources/js/exportKit'], (exportKit) => {
  'use strict';

  // Help: binding helpers. The flow, its steps and the statuses are resources/js/helpGuide.js.
  const RW_ACTIONS = [{ id: 'refresh', label: 'Refresh the numbers', icon: 'oj-ux-ico-refresh', display: 'on' }];
  class PageModule {
    formats() { return exportKit.FORMATS; }

    /**
     * Redwood look: the general overview page's secondary actions (its header's buttons). Always the same array: Oracle's
     * header rebuilds its toolbar when the list changes, and throws if it changes again before the toolbar is ready.
     */
    rwActions() { return RW_ACTIONS; }
  }

  return PageModule;
});
