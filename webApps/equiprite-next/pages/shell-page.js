define(['resources/js/shellBus'], (bus) => {
  'use strict';

  // The shell's page module: the line from the screens in the tabs (shellBus) to the shell's chains, the keyboard
  // (Ctrl+K: the command bar; Escape: close the open popup) and the bell's five-minute check.
  const ALERT_EVERY_MS = 5 * 60 * 1000;

  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      const fire = (name, payload) => { if (helper) helper.fireCustomEvent(name, payload || {}); };
      bus.register((req) => fire('shellRequest', {
        action: req.action || 'open', navId: req.navId || '', record: req.record || '', params: req.params || {},
        id: req.id || '', title: req.title || '', message: req.message || '', tone: req.tone || '',
      }));
      if (typeof document !== 'undefined' && !PageModule.keysBound) {
        PageModule.keysBound = true;
        document.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'k') {
            e.preventDefault();
            const box = document.getElementById('nxCommand');
            if (box) { box.focus(); box.select(); }
          } else if (e.key === 'Escape') {
            fire('dismiss');
          }
        });
        setInterval(() => fire('refreshAlerts'), ALERT_EVERY_MS);
      }
    }

    /** The menu item to highlight: the current tab's own item (a record's list for a record tab). */
    activeNav(tabList, currentTab) {
      const t = (tabList || []).filter((x) => x.id === currentTab)[0];
      return t ? t.navId : '';
    }
  }

  return PageModule;
});
