define(['resources/js/nav'], (nav) => {
  'use strict';
  class PageModule {
    item(navId) { return nav.item(navId) || { label: 'This screen', icon: 'oj-ux-ico-build' }; }
    newUrl(base, navId) { return nav.newUrl(base, navId); }
  }
  return PageModule;
});
