define(['resources/js/future/fxPage'], (fx) => {
  'use strict';

  // My work: the page module. fx.Base subscribes the page to the store (fxRefresh → loadChain) and gives the binding
  // helpers every Future screen shares (money, date, label, icon, canOpen, plural, stageTone, noteIcon, …).
  class PageModule extends fx.Base {
    constructor(context) {
      super(context);
    }

    /** "Priya's work". */
    title(me) {
      const first = String((me && me.name) || '').split(' ')[0];
      return first ? first + '’s work' : 'My work';
    }

    first(name) { return String(name || '').split(' ')[0]; }

    /** "Across 2 screens" (or nothing to do). */
    waitingNote(items) {
      const screens = (items || []).map((i) => i.navId).filter((x, i, a) => a.indexOf(x) === i);
      return screens.length ? 'across ' + fx.helpers.plural(screens.length, 'screen') : 'nothing to do now';
    }

    /** The newest notifications, unread first (at most six). */
    latest(rows) {
      const list = (rows || []).slice();
      return list.filter((n) => n.unread).concat(list.filter((n) => !n.unread)).slice(0, 6);
    }

    // A notification's link as the data-… attributes openChain reads (fxPage.open).
    linkNav(link) { return (link && link.navId) || ''; }
    linkRecord(link) { return (link && link.record) || ''; }
    linkId(link) { return (link && link.id) || ''; }
  }

  return PageModule;
});
