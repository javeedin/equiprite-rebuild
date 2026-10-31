define([
  'resources/js/exportKit',
  'resources/js/settingsKit',
  'resources/js/configurationInventory',
  'resources/js/nav',
], (exportKit, kit, inv, nav) => {
  'use strict';

  // Settings: binding helpers. The rules are New EquipRite's (resources/js/settingsKit.js, configurationInventory.js).
  class PageModule {
    formats() { return exportKit.FORMATS; }

    rowOptions(row) { return kit.rowOptions(row); }

    /** New EquipRite's Configuration page, where the list sections are managed. */
    newConfigLink(urls) { return nav.newUrl((urls || {}).new, 'settings'); }

    newSections() { return kit.newSections(); }

    /** What has no backend setting yet (New's list; Roles and page access is Next's Access screen). */
    notYet() { return inv.NOT_YET.filter((n) => n.navId !== 'page-access'); }

    /** The section index: the sections shown, with how many unsaved changes each has. */
    index(sections, bu, history) {
      const out = (sections || []).map((s) => ({ key: s.key, title: s.title, count: s.changed }));
      out.push({ key: 'bu-settings', title: 'Business unit settings', count: 0 });
      out.push({ key: 'history', title: 'Change history', count: 0 });
      out.push({ key: 'in-new', title: 'Managed in New EquipRite', count: 0 });
      return out;
    }

    needsText(r) {
      return (r.needs || []).map((n) => n.label + (n.ok ? ' is on' : ' is off')).join(' · ');
    }

    pendingTitle(n) { return n === 1 ? '1 unsaved change' : n + ' unsaved changes'; }

    saveLabel(n, saving) {
      if (saving) return 'Saving…';
      return n ? 'Save ' + n + (n === 1 ? ' change' : ' changes') : 'Save';
    }

    pressed(on) { return on ? 'true' : 'false'; }
  }

  return PageModule;
});
