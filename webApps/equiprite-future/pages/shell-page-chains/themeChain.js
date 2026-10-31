define([
  'vb/action/actionChain',
  'resources/js/theme',
], (ActionChain, theme) => {
  'use strict';

  // Your colours (resources/js/theme.js). With nothing: the choice kept on this computer (the shell opening). With a
  // theme or a menu: that, shown at once and kept.
  class themeChain extends ActionChain {
    async run(context, { theme: t, menu }) {
      const v = context.$page.variables;
      const now = theme.load();
      const want = theme.normal({ theme: t || now.theme, menu: menu || now.menu });
      if (t || menu) theme.save(want);
      v.colours = theme.apply(want);
    }
  }

  return themeChain;
});
