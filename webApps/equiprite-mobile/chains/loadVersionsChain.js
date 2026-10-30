define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Where Old, New, Next and Mobile EquipRite live, for the Me tab's links.
  //
  // Under VBCS the web apps sit in one visual application, so the others' addresses are this one with
  // webApps/equiprite-mobile swapped for theirs. Locally the desktop app runs each on its own port and says where at
  // /__versions. Anything else (Designer preview) leaves them empty and the links are hidden, rather than guessed.
  class loadVersionsChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const here = String(window.location.href);
      const m = /^(.*\/webApps\/)equiprite-mobile\//.exec(here);
      if (m) {
        $application.variables.appUrls = { old: m[1] + 'vbredwoodapp/', new: m[1] + 'equiprite/', next: m[1] + 'equiprite-next/',
          mobile: m[1] + 'equiprite-mobile/' };
        return;
      }
      try {
        const res = await fetch('/__versions', { credentials: 'same-origin' });
        if (res.ok) {
          const v = await res.json();
          $application.variables.appUrls = { old: (v && v.old) || '', new: (v && v.new) || '', next: (v && v.next) || '', mobile: (v && v.mobile) || '' };
        }
      } catch (e) {
        console.warn('[loadVersionsChain] no /__versions here; the links to the other versions are hidden', e);
      }
    }
  }

  return loadVersionsChain;
});
