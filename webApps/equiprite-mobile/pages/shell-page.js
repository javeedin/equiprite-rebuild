define(['require', 'resources/js/mobileBus', 'resources/js/pwaSetup', 'resources/js/installPrompt'], (require, bus, pwaSetup) => {
  'use strict';

  // The mobile shell's page module: the line from the screens in the tabs (mobileBus) to the shell's chains, the
  // connection (online / offline) and the tabs' counts every five minutes. It also makes the app installable
  // (pwaSetup) and starts listening for the browser's install prompt early (installPrompt), before the Me tab opens.
  const COUNTS_EVERY_MS = 5 * 60 * 1000;

  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      const fire = (name, payload) => { if (helper) helper.fireCustomEvent(name, payload || {}); };
      bus.register((req) => fire('shellRequest', {
        action: req.action || '', tab: req.tab || '', message: req.message || '', tone: req.tone || '', count: req.count || 0,
      }));
      if (typeof window !== 'undefined' && !PageModule.bound) {
        PageModule.bound = true;
        window.addEventListener('online', () => fire('connection', { online: true }));
        window.addEventListener('offline', () => fire('connection', { online: false }));
        setInterval(() => fire('refreshCounts'), COUNTS_EVERY_MS);
        try { pwaSetup.apply(document, (p) => require.toUrl(p)); } catch (e) { console.warn('[shell] not installable here', e); }
        // Past the screen's band, the top bar names the tab (a large title that folds into the bar).
        const SCROLLED_PX = 64;
        let scrolled = false;
        window.addEventListener('scroll', () => {
          const now = window.scrollY > SCROLLED_PX;
          if (now === scrolled) return;
          scrolled = now;
          const app = document.querySelector('.mb-app');
          if (app) app.classList.toggle('mb-app--scrolled', now);
        }, { passive: true });
      }
    }

    /** The tab's count on its icon, '' for none, '99+' past 99. */
    badge(badges, id) {
      const n = Number((badges || {})[id]) || 0;
      return n > 99 ? '99+' : (n > 0 ? String(n) : '');
    }

    /** The title in the top bar: the tab's. */
    title(tabBar, current) {
      const t = (tabBar || []).filter((x) => x.id === current)[0];
      return t ? t.title : 'EquipRite';
    }
  }

  return PageModule;
});
