define([
  'vb/action/actionChain',
  'resources/js/mobileTabs',
  'resources/js/installPrompt',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
  'resources/js/rules',
  'resources/js/mobileBus',
], (ActionChain, mobileTabs, installPrompt, snapshot, cu, rules, bus) => {
  'use strict';

  // The Me tab:
  //   load     who you are, your role, the tabs your access gives, whether the app is installed and how to install it
  //   install  the browser's own install prompt (Android); an iPhone has none: the steps are on the screen
  //   share    this app's address: the phone's share sheet, else copied
  //   clear    forget what this phone keeps for the tabs (their saved copies)
  const KEPT = ['track:mine', 'track:all', 'approve', 'pick', 'request'];

  class meChain extends ActionChain {
    async run(context, { act }) {
      const { $page, $application } = context;
      const app = $application.variables;
      const pv = $page.variables;
      const user = cu.auditActor(context) || ($application.user || {}).username || '';
      if (act === 'install') {
        const outcome = await installPrompt.prompt();
        pv.note = outcome === 'accepted' ? 'Installed: open EquipRite from your home screen.'
          : outcome === 'dismissed' ? 'Not installed. You can install it any time from here.' : 'Use the steps below to install it.';
      } else if (act === 'share') {
        const url = pv.link;
        try {
          if (navigator.share) {
            await navigator.share({ title: 'EquipRite Mobile', text: 'EquipRite on your phone', url });
            pv.note = '';
          } else if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(url);
            pv.note = 'Link copied. Send it to yourself or a colleague.';
          } else {
            pv.note = 'The link: ' + url;
          }
        } catch (e) {
          // Closing the share sheet is not a failure.
          if (!(e && e.name === 'AbortError')) pv.note = 'The link: ' + url;
        }
      } else if (act === 'clear') {
        KEPT.forEach((k) => snapshot.clear(k, user));
        bus.toast('This phone no longer keeps a copy of your requests.', 'info');
      }
      const tabs = mobileTabs.visible(app.pageAccessMap, app.pageAccessLoaded).filter((t) => t.id !== 'me');
      const persona = app.viewAs || rules.persona(app.fusionRoles, app.sessionRoles);
      pv.me = {
        name: cu.displayName(context) || user || 'You',
        username: user,
        role: rules.personaLabel(persona) || '',
        can: mobileTabs.summary(app.pageAccessMap, app.pageAccessLoaded),
        tabs: tabs.map((t) => ({ id: t.id, label: t.title, icon: t.icon })),
      };
      const platform = installPrompt.platform();
      pv.install = { installed: installPrompt.installed(), canPrompt: installPrompt.canPrompt(), platform, steps: installPrompt.howTo(platform) };
      const here = String(window.location.href).split(/[?#]/)[0];
      pv.link = app.appUrls && app.appUrls.mobile ? app.appUrls.mobile : here;
    }
  }

  return meChain;
});
