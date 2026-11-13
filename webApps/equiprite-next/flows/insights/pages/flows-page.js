define(['resources/js/flowsGuide'], (G) => {
  'use strict';

  // How it works: binding helpers over resources/js/flowsGuide.js (the words). None uses `this`.
  class PageModule {
    flows() { return G.FLOWS; }
    legend() { return G.LEGEND; }
    links() { return G.LINKS; }
    stepClass(s) { return 'nx-hw-step nx-hw-step--' + s.actor; }
    chipClass(a) { return 'nx-hw-key nx-hw-key--' + a; }
    openText(f) { return f.openLabel ? 'Open ' + f.openLabel : 'Open ' + f.title; }
  }
  return PageModule;
});
