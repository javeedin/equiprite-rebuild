define(['resources/js/shellBus', 'resources/js/cartDrafts', 'resources/js/requestData', 'resources/js/theme'], (bus, cartDrafts, requestData, theme) => {
  'use strict';

  // The shell's page module: the line from the screens in the tabs (shellBus) to the shell's chains, the keyboard
  // (Ctrl+K: the search box; Escape: close the open popup), a click outside the search list, and the bell's five-minute
  // check.
  const ALERT_EVERY_MS = 5 * 60 * 1000;

  class PageModule {
    constructor(context) {
      // The colours chosen on this computer, before anything is drawn (theme.js; your menu, Colours).
      theme.apply(theme.load());
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
        // The search list closes on a click anywhere outside the box and its list (the popups have a backdrop for that;
        // the list sits in the toolbar, above it).
        document.addEventListener('pointerdown', (e) => {
          const inBox = e.target && typeof e.target.closest === 'function' && e.target.closest('.nx-command');
          if (!inBox && document.getElementById('nxResults')) fire('searchAway');
        }, true);
        setInterval(() => fire('refreshAlerts'), ALERT_EVERY_MS);
        // A request saved, submitted or decided anywhere: the cart counts its drafts again, once things settle.
        let wait = null;
        requestData.onChange(() => {
          clearTimeout(wait);
          wait = setTimeout(() => fire('refreshDrafts'), 1500);
        });
      }
    }

    /** The drafts the cart shows: yours, or everyone's (yours first). */
    draftsShown(drafts, all) {
      const d = drafts || {};
      return all ? (d.mine || []).concat(d.others || []) : (d.mine || []);
    }

    /** "2 pieces · Komatsu D65EX-18 Dozer, Tadano ATF 220G-5". */
    draftAbout(d) { return cartDrafts.about(d); }

    /** The menu item to highlight: the current tab's own item (a record's list for a record tab). */
    activeNav(tabList, currentTab) {
      const t = (tabList || []).filter((x) => x.id === currentTab)[0];
      return t ? t.navId : '';
    }

    /** The colour themes, for the picker in your menu. */
    themes() { return theme.THEMES; }

    /** A theme's swatch: the menu's colour and the page head's. */
    swatch(t) { return theme.swatch(t); }

    /** The menu's two looks. */
    menus() { return theme.MENUS; }
  }

  return PageModule;
});
