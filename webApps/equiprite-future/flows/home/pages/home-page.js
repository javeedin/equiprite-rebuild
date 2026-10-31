define(['resources/js/fmt', 'resources/js/nav'], (fmt, nav) => {
  'use strict';

  // My work: binding helpers.
  class PageModule {
    greeting(user, appFns) {
      const name = appFns ? appFns.userDisplayName(user) : '';
      const first = name ? name.split(/[\s.@_-]+/)[0] : '';
      return fmt.greeting() + (first ? ', ' + first.charAt(0).toUpperCase() + first.slice(1) : '');
    }

    today() {
      return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    item(navId) { return nav.item(navId) || { label: navId, icon: 'oj-ux-ico-file' }; }
    range(a, b) { return fmt.range(a, b); }
  }

  return PageModule;
});
