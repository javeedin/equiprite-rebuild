define(['resources/js/exportKit', 'resources/js/sqlWorksheet'], (exportKit, W) => {
  'use strict';

  // The SQL worksheet's binding helpers, and its keys as in SQL Developer: Ctrl+Enter runs the statement under the
  // cursor, F5 the script. A key in the editor presses the matching button, so a key does exactly what the button does
  // (and nothing while the button is disabled). Listened for once, whatever number of times the page opens.
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__eqrSqlKeys) {
    window.__eqrSqlKeys = true;
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      if (!t || t.id !== 'sqlEditor') return;
      var id = (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ? 'sqlRun' : (e.key === 'F5' ? 'sqlRunScript' : '');
      if (!id) return;
      e.preventDefault();
      var b = document.getElementById(id);
      if (b && !b.disabled) b.click();
    }, true);
  }

  class PageModule {
    formats() { return exportKit.FORMATS; }

    colors() { return W.COLORS; }

    /** A connection's colour dot (none: an outline). */
    dot(color) { return color ? { background: color, borderColor: color } : { background: 'transparent' }; }

    text(v) { return v == null ? '' : '' + v; }

    /** The result grid's column template (sqlWorksheet.grid). */
    gridStyle(style) { return style || {}; }

    took(ms) { return W.took(ms); }

    lines(list) { return (list || []).join('\n'); }

    historyRows(list) { return W.historyRows(list); }
  }

  return PageModule;
});
