define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Where Old, New, Next, Mobile and Future EquipRite live, for the version list in the profile menu.
  //
  // Under VBCS the web apps sit in one visual application, so the others' addresses are this one with
  // webApps/equiprite-next swapped for webApps/vbredwoodapp (Old), webApps/equiprite (New), webApps/equiprite-mobile
  // (Mobile) and webApps/equiprite-future (Future). Locally the desktop
  // app runs each on its own port and says where at /__versions. Anything else (Designer preview) leaves them empty
  // and the switch shows Next alone, rather than guessing.
  class loadVersionsChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const here = String(window.location.href);
      const m = /^(.*\/webApps\/)equiprite-next\//.exec(here);
      if (m) {
        // Build.Rite is this same web app shown as the team's tools (?product=buildrite; ?product=next comes back)
        $application.variables.appUrls = { old: m[1] + 'vbredwoodapp/', new: m[1] + 'equiprite/', next: m[1] + 'equiprite-next/?product=next',
          mobile: m[1] + 'equiprite-mobile/', future: m[1] + 'equiprite-future/', build: m[1] + 'equiprite-next/?product=buildrite' };
        return;
      }
      try {
        const res = await fetch('/__versions', { credentials: 'same-origin' });
        if (res.ok) {
          const v = await res.json();
          // Build.Rite on Next's own address (?product=buildrite): going back to Next says so (?product=next)
          const sameApp = (a, b) => { try { return !!a && !!b && new URL(a).origin === new URL(b).origin; } catch (e) { return false; } };
          const next = (v && v.next) || '';
          $application.variables.appUrls = { old: (v && v.old) || '', new: (v && v.new) || '', next: next && sameApp(next, v.build) && next.indexOf('product=') === -1 ? next + (next.indexOf('?') === -1 ? '?' : '&') + 'product=next' : next,
            mobile: (v && v.mobile) || '', future: (v && v.future) || '', build: (v && v.build) || '' };
        }
      } catch (e) {
        console.warn('[loadVersionsChain] no /__versions here; the Old/New switch is hidden', e);
      }
    }
  }

  return loadVersionsChain;
});
