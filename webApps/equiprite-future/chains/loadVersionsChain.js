define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Where Old, New, Next, Mobile and Future EquipRite live, for the version list in your menu.
  //
  // Under VBCS the web apps sit in one visual application, so the others' addresses are this one with
  // webApps/equiprite-future swapped for webApps/vbredwoodapp (Old), webApps/equiprite (New), webApps/equiprite-next
  // (Next) and webApps/equiprite-mobile (Mobile). Locally the desktop app runs each on its own port and says where at
  // /__versions. Anything else (Designer preview) leaves them empty and the list shows Future alone, rather than
  // guessing. (/__versions is the desktop app's own address, not a REST service: Future calls none.)
  class loadVersionsChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const here = String(window.location.href);
      const m = /^(.*\/webApps\/)equiprite-future\//.exec(here);
      if (m) {
        $application.variables.appUrls = { old: m[1] + 'vbredwoodapp/', new: m[1] + 'equiprite/', next: m[1] + 'equiprite-next/',
          mobile: m[1] + 'equiprite-mobile/', future: m[1] + 'equiprite-future/' };
        return;
      }
      try {
        const res = await fetch('/__versions', { credentials: 'same-origin' });
        if (res.ok) {
          const v = await res.json();
          $application.variables.appUrls = { old: (v && v.old) || '', new: (v && v.new) || '', next: (v && v.next) || '',
            mobile: (v && v.mobile) || '', future: (v && v.future) || '' };
        }
      } catch (e) {
        console.info('[loadVersionsChain] no /__versions here; the version list shows Future alone');
      }
    }
  }

  return loadVersionsChain;
});
