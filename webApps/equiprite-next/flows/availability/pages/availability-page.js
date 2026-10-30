define(['resources/js/exportKit', 'resources/js/availability'], (exportKit, av) => {
  'use strict';

  // Availability: binding helpers. The logic is resources/js/availability.js.
  class PageModule {
    /** The export menu's formats. */
    formats() { return exportKit.FORMATS; }

    /** What the colours mean. */
    legend() { return av.legend(); }

    /** The yard button: "All yards" or the yard picked. */
    yardText(yard, yards) {
      if (!yard) return 'All yards';
      const hit = (yards || []).filter((y) => y.key === yard)[0];
      return hit ? hit.label : 'All yards';
    }

    /**
     * Keeps the search and date boxes showing the page's values after a change made elsewhere (a quick window,
     * "Show on the timeline", "Clear filters"): once a person has typed in a native input, its value attribute no
     * longer drives what it shows. A box already showing the value is left alone, so typing is never disturbed.
     */
    syncInputs(text, from, to) {
      [['avSearch', text], ['avFrom', from], ['avTo', to]].forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el && el.value !== (value || '')) el.value = value || '';
      });
    }

    /** Brings the timeline into view (after "Show on the timeline"). */
    scrollToTimeline() {
      const el = document.getElementById('avTimeline');
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  return PageModule;
});
