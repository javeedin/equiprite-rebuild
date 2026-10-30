define(['resources/js/exportKit'], (exportKit) => {
  'use strict';

  // Help: binding helpers. The flow, its steps and the statuses are resources/js/helpGuide.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }
  }

  return PageModule;
});
