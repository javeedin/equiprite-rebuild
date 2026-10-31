define(['vb/action/actionChain', 'resources/js/future/fxFdd2'], (ActionChain, fxFdd2) => {
  'use strict';

  // A chapter's chip (data-n="6"): the iframe's src becomes the document at #c6 (the frame goes there by itself) and
  // its chip is marked. Then the element itself (fxFdd2.hold): the frame's own window is scrolled to the chapter (a chip
  // clicked again after the reader moved on leaves the src unchanged, so the frame would not move), and the tab around
  // the frame is kept where it was.
  class chapterChain extends ActionChain {
    async run(context, { data }) {
      const n = fxFdd2.chapterOf(data);
      if (!n) return;
      const frame = typeof document !== 'undefined' ? document.getElementById('fdd2Frame') : null;
      const go = frame ? fxFdd2.hold(frame) : null;
      context.$page.variables.chapter = n;
      context.$page.variables.src = fxFdd2.src(context.$application.path || '', n);
      if (go) go(n);
    }
  }

  return chapterChain;
});
