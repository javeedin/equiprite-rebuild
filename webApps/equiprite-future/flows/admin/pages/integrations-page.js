define(['resources/js/exportKit', 'resources/js/integrationsView'], (exportKit, view) => {
  'use strict';

  // Integrations: binding helpers. The grades are New EquipRite's integrationHealth; the page model is
  // resources/js/integrationsView.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }

    newLink(urls) { return view.newLink((urls || {}).new); }

    pressed(on) { return on ? 'true' : 'false'; }
  }

  return PageModule;
});
