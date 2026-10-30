define(['resources/js/agreementRules', 'resources/js/exportKit', 'resources/js/fmt'], (A, exportKit, fmt) => {
  'use strict';

  // Agreements: binding helpers. The rules are resources/js/agreementRules.js (New EquipRite's, unchanged).
  class PageModule {
    formats() { return exportKit.FORMATS; }
    sortMark(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''; }
    ariaSort(key, sortKey, sortDir) { return key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'; }
    statusLabel(code) { return A.statusLabel(code); }
    tone(code) { return 'nx-cm-st--' + A.tone(code); }
    range(a, b) { return fmt.range(a, b) || '—'; }
    expiryText(row) { return A.expiryText(row); }
    isExpiring(row) { return A.isExpiring(row); }
    nextStep(row) { return row ? A.nextStep(row.statusCode, row.endDate, row.lineCount) : ''; }
    lines(n) { return fmt.count(n, 'line'); }
  }

  return PageModule;
});
