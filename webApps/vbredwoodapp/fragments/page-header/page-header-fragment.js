define([], () => {
  'use strict';

  class FragmentModule {
    hasDrawer() {
      return Boolean(document.querySelector('oj-vb-fragment[name="shell-drawer"]'));
    }
  }
  
  return FragmentModule;
});
