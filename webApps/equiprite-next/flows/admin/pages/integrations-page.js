define(['resources/js/exportKit', 'resources/js/integrationsView'], (exportKit, view) => {
  'use strict';

  // Integrations: binding helpers. The grades are New EquipRite's integrationHealth; the page model is
  // resources/js/integrationsView.js.
  class PageModule {
    formats() { return exportKit.FORMATS; }

    newLink(urls) { return view.newLink((urls || {}).new); }

    pressed(on) { return on ? 'true' : 'false'; }

    /**
     * Redwood view (your menu, Look): the general overview page's buttons, the current look's Check again and Run syncs in
     * New EquipRite (when New EquipRite's address is known).
     */
    rwActions(loading, urls) {
      return [
        { id: 'check', label: loading ? 'Checking…' : 'Check again', icon: 'oj-ux-ico-refresh', display: loading ? 'disabled' : 'on' },
        { id: 'inNew', label: 'Run syncs in New EquipRite', icon: 'oj-ux-ico-external-link', display: view.newLink((urls || {}).new) ? 'on' : 'off' },
      ];
    }
  }

  return PageModule;
});
