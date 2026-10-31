define(['resources/js/shellBus', 'resources/js/theme', 'resources/js/nav', 'resources/js/future/fxPage', 'resources/js/future/fxShell'],
  (bus, theme, nav, fx, fxShell) => {
    'use strict';

    // The shell's page module: the line from the screens in the tabs (shellBus) to the shell's chains, the store's
    // changes (fxRefresh: the persona, the clock, any action, another browser tab) and Escape (close the open popup).
    class PageModule {
      constructor(context) {
        // The colours chosen on this computer, before anything is drawn (theme.js; your menu, Colours).
        theme.apply(theme.load());
        const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
        const fire = (name, payload) => { if (helper && typeof helper.fireCustomEvent === 'function') helper.fireCustomEvent(name, payload || {}); };
        bus.register((req) => fire('shellRequest', {
          action: req.action || 'open', navId: req.navId || '', record: req.record || '', params: req.params || {},
          id: req.id || '', title: req.title || '', message: req.message || '', tone: req.tone || '',
        }));
        // The menu, badges, bell and Playing as follow the store (fx.watch fires fxRefresh → refreshChain).
        this.watch = fx.watch(context);
        if (typeof document !== 'undefined' && !PageModule.keysBound) {
          PageModule.keysBound = true;
          document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fire('dismiss'); });
        }
      }

      /** The menu item to highlight: the current tab's own item (a record's list for a record tab). */
      activeNav(tabList, currentTab) {
        const t = (tabList || []).filter((x) => x.id === currentTab)[0];
        return t ? t.navId : '';
      }

      /** Whether the persona played may open a screen (New request in the toolbar). */
      canOpen(navId, roles) { return nav.itemVisible(nav.item(navId), roles); }

      /** The toolbar's date: "Mon 2 Nov 2026". */
      today(me) { return fxShell.today(me); }

      /** A notification's icon by its kind (action, warning, error, info). */
      noteIcon(kind) { return fx.helpers.noteIcon(kind); }

      /** The colour themes, for the picker in your menu. */
      themes() { return theme.THEMES; }

      /** A theme's swatch: the menu's colour and the page head's. */
      swatch(t) { return theme.swatch(t); }

      /** The menu's two looks. */
      menus() { return theme.MENUS; }
    }

    return PageModule;
  });
