define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Where Old, New and Next EquipRite live, for the toolbar's switch.
  //
  // Under VBCS the three web apps sit in one visual application, so the others' addresses are this one with
  // webApps/equiprite-next swapped for webApps/vbredwoodapp (Old) and webApps/equiprite (New). Locally the desktop
  // app runs each on its own port and says where at /__versions. Anything else (Designer preview) leaves them empty
  // and the switch shows Next alone, rather than guessing.
  class loadVersionsChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const here = String(window.location.href);
      const m = /^(.*\/webApps\/)equiprite-next\//.exec(here);
      if (m) {
        $application.variables.appUrls = { old: m[1] + 'vbredwoodapp/', new: m[1] + 'equiprite/', next: m[1] + 'equiprite-next/' };
        return;
      }
      try {
        const res = await fetch('/__versions', { credentials: 'same-origin' });
        if (res.ok) {
          const v = await res.json();
          $application.variables.appUrls = { old: (v && v.old) || '', new: (v && v.new) || '', next: (v && v.next) || '' };
        }
      } catch (e) {
        console.warn('[loadVersionsChain] no /__versions here; the Old/New switch is hidden', e);
      }
    }
  }

  return loadVersionsChain;
});
