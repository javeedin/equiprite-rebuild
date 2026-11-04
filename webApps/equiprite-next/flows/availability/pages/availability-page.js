define(['resources/js/exportKit', 'resources/js/availability', 'resources/js/availabilityPivot', 'resources/js/shellBus'], (exportKit, av, pivot, bus) => {
  'use strict';

  // Availability: binding helpers. The logic is resources/js/availability.js (the yard grid: availabilityPivot.js).
  const RW_ACTIONS = [
    { id: 'refresh', label: 'Refresh', icon: 'oj-ux-ico-refresh', display: 'on' },
    { id: 'export', label: 'Export to Excel', icon: 'oj-ux-ico-download', display: 'on' }
  ];

  class PageModule {
    constructor(context) {
      // Another screen may hand over a search, a window and a view (shellBus.focus, Check availability): focusChain takes
      // it. Only while this page is on screen: after its tab was closed, the page opened anew takes it once loaded.
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('availability', () => {
        if (helper && typeof document !== 'undefined' && document.getElementById('avTimeline')) helper.fireCustomEvent('focusRequest', {});
      });
    }

    /** The export menu's formats. */
    formats() { return exportKit.FORMATS; }

    /** What the colours mean. */
    legend() { return av.legend(); }

    /** What the yard grid's colours mean: all, some, none free (equipment) or each unit's state (units). */
    gridLegend(grain) { return pivot.legend(grain); }

    /** The yard button: "All yards" or the yard picked. */
    yardText(yard, yards) {
      if (!yard) return 'All yards';
      const hit = (yards || []).filter((y) => y.key === yard)[0];
      return hit ? hit.label : 'All yards';
    }

    /**
     * Keeps the search and date boxes showing the page's values after a change made elsewhere (a quick window,
     * "Show on the timeline", "Clear filters", another screen's handover): once a person has typed in a native input,
     * its value attribute no longer drives what it shows. A box already showing the value is left alone, so typing is
     * never disturbed.
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

    /**
     * Redwood (your menu): the general overview page's actions (rwActionChain), the current look's head buttons:
     * Refresh, and Export as Excel (what the timeline or the yard grid shows, as the Export menu). One array, never a
     * new one: Oracle's header redraws its toolbar for every new array, and two redraws in a row throw.
     */
    rwActions() { return RW_ACTIONS; }
  }

  return PageModule;
});
