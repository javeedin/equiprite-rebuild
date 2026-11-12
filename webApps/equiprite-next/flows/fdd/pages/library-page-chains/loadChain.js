define([
  'vb/action/actionChain',
  'resources/js/fddClient',
], (ActionChain, FC) => {
  'use strict';

  // Opening the FDD library (and Refresh): the library shipped with the app (resources/fdd/library.json), whether this
  // app can upload (the local server runs from the project folder), and the git state of the FDD files.
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.busy = true;
      try {
        const [lib, info] = await Promise.all([FC.library(context.$application.path), FC.info()]);
        v.lib = lib.body;
        v.canUpload = !!info.canUpload;
        v.git = info.canUpload ? ((await FC.gitStatus()).body || null) : null;
      } finally {
        v.checked = true;
        v.busy = false;
      }
    }
  }
  return loadChain;
});
