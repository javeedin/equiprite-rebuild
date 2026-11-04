define(['resources/js/fmt', 'resources/js/nav'], (fmt, nav) => {
  'use strict';

  // My work: binding helpers.
  class PageModule {
    greeting(user, appFns) {
      const name = appFns ? appFns.userDisplayName(user) : '';
      const first = name ? name.split(/[\s.@_-]+/)[0] : '';
      return fmt.greeting() + (first ? ', ' + first.charAt(0).toUpperCase() + first.slice(1) : '');
    }

    today() {
      return new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    // ── The Redwood look (your menu): Oracle's general overview header ──────────────────────────────────────────
    /** The header's subtitle: the role whose work this is, and today ("Your work as Equipment Manager · Wednesday 4 November 2026"). */
    rwSub(persona, appFns) {
      const who = persona && appFns ? 'Your work as ' + appFns.personaLabel(persona) : '';
      return [who, this.today()].filter((t) => !!t).join(' · ');
    }

    /** The header's actions: Refresh, as on the current look's head. */
    rwActions(loading) {
      return [{ id: 'refresh', label: loading ? 'Refreshing…' : 'Refresh', icon: 'oj-ux-ico-refresh', display: loading ? 'disabled' : 'on' }];
    }

    item(navId) { return nav.item(navId) || { label: navId, icon: 'oj-ux-ico-file' }; }
    range(a, b) { return fmt.range(a, b); }
  }

  return PageModule;
});
