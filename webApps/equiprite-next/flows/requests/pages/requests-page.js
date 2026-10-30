define(['resources/js/exportKit', 'resources/js/fmt'], (exportKit, fmt) => {
  'use strict';

  // Requests: binding helpers. The logic is resources/js/requestList.js.
  class PageModule {
    /** The export menu's formats. */
    formats() { return exportKit.FORMATS; }

    /** Sort arrow for a column header. */
    sortMark(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''; }

    /** aria-sort for a column header. */
    ariaSort(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'; }

    range(a, b) { return fmt.range(a, b); }

    /** Where today is in the rental: "Starts in 5 days", "Ends today", "Ended 3 days ago". */
    when(start, end) {
      const t = fmt.today();
      const s = fmt.dayMs(start);
      const e = fmt.dayMs(end);
      if (s != null && t < s) return 'Starts ' + fmt.relative(start);
      if (e != null && t <= e) return 'Ends ' + fmt.relative(end);
      if (e != null) return 'Ended ' + fmt.relative(end);
      return '';
    }
  }

  return PageModule;
});
