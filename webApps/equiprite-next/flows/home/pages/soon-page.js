define(['resources/js/nav'], (nav) => {
  'use strict';
  class PageModule {
    item(navId) { return nav.item(navId) || { label: 'This screen', icon: 'oj-ux-ico-build' }; }
    newUrl(base, navId) { return nav.newUrl(base, navId); }

    /** Redwood look: the header's primary action, the same screen in New EquipRite (when there is one). */
    rwPrimary(newBase, navId) {
      return this.newUrl(newBase, navId) ? { label: 'Open it in New EquipRite', display: 'on' } : { label: '', display: 'off' };
    }

    /** Redwood look: the header's other action, Old EquipRite (when known). */
    rwActions(oldBase) {
      return oldBase ? [{ id: 'old', label: 'Open Old EquipRite', icon: 'oj-ux-ico-external-link', display: 'on' }] : [];
    }
  }
  return PageModule;
});
