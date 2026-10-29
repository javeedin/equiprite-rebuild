define([], () => {
  'use strict';

  // Empty page module.
  //
  // This page needs no page-scoped functions — every expression in its HTML
  // resolves against $application.functions (formatLineStatus, statusPillClass,
  // statusTextClass), which lives in app-flow.js.
  //
  // The file exists anyway because VBCS requests <page>.js while loading the
  // page (runtimeEnvironment.getPageFunctions -> container.functionsLoader).
  // When it is absent the Designer serves application/problem+json with a 404,
  // RequireJS refuses to execute it under strict MIME checking, and the page
  // load aborts — which presents as "the page won't open" with no obvious cause.
  class PageModule {
  }

  return PageModule;
});
