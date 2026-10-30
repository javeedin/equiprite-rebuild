define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Where Old EquipRite lives, for the screens New EquipRite does not have yet, and where EquipRite Next lives, for
  // the header's Old / New / Next switch.
  //
  // Under VBCS both web apps sit in the same visual application, so the old app's address is this one with
  // webApps/equiprite swapped for webApps/vbredwoodapp. Locally the desktop app runs each on its own port and
  // says where at /__versions. Anything else (Designer preview, an unknown host) leaves oldAppUrl empty, and the
  // "Open in Old EquipRite" buttons stay disabled rather than guessing.
  class loadVersionsChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const here = String(window.location.href);
      const m = /^(.*\/webApps\/)equiprite\//.exec(here);
      if (m) {
        $application.variables.oldAppUrl = m[1] + 'vbredwoodapp/';
        $application.variables.nextAppUrl = m[1] + 'equiprite-next/';
        return;
      }
      try {
        const res = await fetch('/__versions', { credentials: 'same-origin' });
        if (res.ok) {
          const v = await res.json();
          $application.variables.oldAppUrl = (v && v.old) || '';
          $application.variables.nextAppUrl = (v && v.next) || '';
        }
      } catch (e) {
        console.warn('[loadVersionsChain] no /__versions here; Old EquipRite links disabled', e);
      }
    }
  }

  return loadVersionsChain;
});
