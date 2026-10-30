define(['resources/js/installPrompt'], (installPrompt) => {
  'use strict';

  // Me: binding helpers, and the browser's install prompt as it comes and goes.
  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      installPrompt.onChange(() => { if (helper) helper.fireCustomEvent('installChanged', {}); });
    }

    /** The other versions, for a computer: those whose address is known. */
    versions(urls) {
      const u = urls || {};
      return [
        { key: 'next', label: 'EquipRite Next', about: 'Everything, in tabs, for a big screen', url: u.next || '' },
        { key: 'new', label: 'New EquipRite', about: 'Where Fusion steps are taken', url: u.new || '' },
        { key: 'old', label: 'Old EquipRite', about: 'The original app', url: u.old || '' },
      ].filter((v) => !!v.url);
    }
  }

  return PageModule;
});
