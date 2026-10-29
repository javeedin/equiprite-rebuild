define(['require'], function (localRequire) {
  'use strict';

  /*
   * Month-agenda popup — Bryntum Calendar 7.3.6 inside a blob-URL iframe.
   *
   * WHY AN IFRAME, AND NOT A WIDGET ON THE PAGE
   * -------------------------------------------
   * This app already loads Bryntum Scheduler Pro 6.1.1 app-wide
   * (app-flow.json -> requirejs.paths.schedulerPro, plus schedulerpro.classic.css
   * in imports.css). Bryntum Calendar is a DIFFERENT product on a DIFFERENT
   * major version, and the two cannot share a document:
   *
   *   - CSS: calendar.css and schedulerpro.classic.css share 741 `.b-*`
   *     selectors. imports.css is application-wide, so adding Calendar's
   *     stylesheet there would restyle the timeline on this page AND the Gantt
   *     on line-detail-page. Bryntum 7 also dropped the `classic` theme, so
   *     there is no matching pair to load.
   *   - JS: calendar.umd.js has no AMD wrapper (`define.amd` appears zero
   *     times in it, unlike schedulerpro.umd.js), and it writes to the same
   *     `globalThis.bryntum` namespace Scheduler Pro already owns.
   *   - Version: Bryntum refuses to mix products across major versions, and the
   *     ESM-only thin bundles that would let them share a Core cannot be loaded
   *     by RequireJS without a build step this project does not have.
   *
   * A separate document dissolves all three at once: its own CSS scope, its own
   * global object, its own Core. Nothing here touches app-flow.json, and
   * deleting this file plus the dialog reverts the feature completely.
   *
   * The blob-URL-into-an-iframe mechanism is the pattern this app already uses
   * three times for PDF previews (pickSlip.js toBlobUrl, QuoteInitChain,
   * ProjectQuoteInitChain), so it is known to work under VBCS.
   *
   * DATA IS INLINED, NOT postMessage'd. A blob: document has an opaque origin,
   * which makes postMessage origin checks meaningless and adds a load-order
   * race for no benefit. Writing the payload into the document as a literal
   * removes both problems: the calendar has its data before Bryntum boots.
   *
   * TRIAL BUNDLE WARNING. resources/js/calendar.umd.js is Bryntum Calendar
   * 7.3.6 (TRIAL VERSION). It is obfuscated, and its tail appends a Google
   * Analytics tag (G-1VY6776VJP) to document.head when it loads. That is
   * contained to this iframe and only fires when the popup is opened, which is
   * fine for a demo but NOT acceptable in production. Replacing it with a
   * licensed build is a straight file swap; nothing in this module changes.
   */

  /**
   * Absolute URL for a file under the web app root.
   *
   * It has to be absolute. A blob: document cannot resolve a relative href
   * (it has no meaningful base), and document.baseURI on the host page is the
   * current ROUTE — routerStrategy is "path", so .../main/equipment-schedule-page
   * — not the app root, so resolving against that would climb to the wrong
   * place.
   *
   * require.toUrl() is the intended API and resolves against RequireJS's
   * configured baseUrl, which VBCS points at the app root. The script-tag scan
   * is the fallback for when toUrl hands back something relative: the Scheduler
   * Pro bundle is guaranteed to be loaded by the time this module is used (the
   * page module depends on it), so its <script src> is the empirical truth
   * about where resources/ actually lives.
   */
  function appUrl(relPath) {
    try {
      var u = localRequire.toUrl(relPath);
      if (u && /^https?:|^\//.test(u)) return new URL(u, window.location.origin).href;
    } catch (e) { /* fall through to the scan */ }

    var marker = 'resources/js/schedulerpro.umd';
    var tag = Array.prototype.slice.call(document.querySelectorAll('script[src]'))
      .map(function (s) { return s.src; })
      .filter(function (src) { return src.indexOf(marker) !== -1; })[0];
    if (tag) return tag.slice(0, tag.indexOf('resources/')) + relPath;

    return new URL(relPath, document.baseURI).href;
  }

  /**
   * 'YYYY-MM-DD' + n inclusive days -> 'YYYY-MM-DD' exclusive end.
   *
   * The scheduler's events carry an INCLUSIVE day count (a one-day booking is
   * duration 1); Bryntum Calendar wants an EXCLUSIVE endDate on an all-day
   * event. Getting this wrong is a silent off-by-one that makes every booking
   * look a day short, so the conversion lives in exactly one place.
   */
  function exclusiveEnd(startIso, durationDays) {
    var d = new Date(startIso + 'T00:00:00');
    d.setDate(d.getDate() + Math.max(1, durationDays || 1));
    return d.toISOString().slice(0, 10);
  }

  function isoDay(v) {
    if (!v) return null;
    if (v instanceof Date) {
      // Local parts, not toISOString(): a date at local midnight west of UTC
      // shifts back a day when serialised as UTC, which would move bookings.
      var m = String(v.getMonth() + 1);
      var d = String(v.getDate());
      return v.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (d.length < 2 ? '0' + d : d);
    }
    return String(v).slice(0, 10);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Build the payload the popup document renders.
   *
   * Reads the Bryntum Scheduler stores the page already holds, so the popup
   * costs no extra REST calls — everything it shows was fetched by
   * initSchedulerChain on page enter.
   *
   * Units with no events are EXCLUDED. A month agenda for a unit that has never
   * been booked is an empty grid, which is both useless and a poor first
   * impression; the picker should only offer units that have something to show.
   */
  function buildPayload(resourceStore, eventStore, preferredResourceId) {
    var byResource = {};

    eventStore.forEach(function (ev) {
      var rid = ev.resourceId != null ? ev.resourceId : (ev.resource && ev.resource.id);
      if (rid == null) return;

      var startIso = isoDay(ev.startDate);
      if (!startIso) return;

      (byResource[rid] = byResource[rid] || []).push({
        name      : ev.name || 'Booked',
        status    : (ev.allocStatus || '').toUpperCase(),
        start     : startIso,
        end       : exclusiveEnd(startIso, ev.duration),
        color     : ev.eventColor || '#10b981',
        project   : ev.projectName || '',
        task      : ev.taskName || '',
        workOrder : ev.workOrderNumber || '',
        location  : ev.shortAddress || ''
      });
    });

    var units = [];
    resourceStore.forEach(function (r) {
      var evs = byResource[r.id];
      if (!evs || !evs.length) return;
      units.push({
        id       : r.id,
        name     : r.equipment_name || r.name || '(unnamed)',
        serial   : r.serial_number || '',
        klass    : r.equipment_class || '',
        location : r.location || '',
        events   : evs
      });
    });

    // The unit asked for is ALWAYS included, even with nothing booked.
    //
    // Units with no events are otherwise excluded (an empty month is a poor
    // first impression in the picker). But the per-row calendar button names a
    // specific unit, and dropping it would silently open a different one —
    // the popup would look like it ignored the click. An idle unit showing an
    // empty month is the honest answer, and "this unit is free" is a useful
    // thing for the schedule to be able to say.
    if (preferredResourceId != null &&
        !units.some(function (u) { return u.id === preferredResourceId; })) {
      resourceStore.forEach(function (r) {
        if (r.id !== preferredResourceId) return;
        units.push({
          id       : r.id,
          name     : r.equipment_name || r.name || '(unnamed)',
          serial   : r.serial_number || '',
          klass    : r.equipment_class || '',
          location : r.location || '',
          events   : []
        });
      });
    }

    units.sort(function (a, b) {
      return a.name.localeCompare(b.name) || a.serial.localeCompare(b.serial);
    });

    // Open on whatever the user had selected in the rail, when that unit
    // actually has events; otherwise the first unit in the list.
    var hasPreferred = units.some(function (u) { return u.id === preferredResourceId; });
    return {
      units         : units,
      initialUnitId : hasPreferred ? preferredResourceId : (units[0] && units[0].id)
    };
  }

  /**
   * The popup document. Self-contained: two stylesheets, the Calendar bundle,
   * the payload as a literal, and monthAgendaFrame.js to assemble them.
   *
   * The runtime lives in its own file rather than an inline string so it stays
   * lintable, debuggable in devtools, and free of escaping hazards.
   */
  function buildHtml(payload) {
    var cssBase  = appUrl('resources/css/calendar.css');
    var cssTheme = appUrl('resources/css/calendar-visby-light.css');
    // NOTE: resources/js/calendar.umd.js has been REMOVED from the build -
    // the 5.1 MB trial bundle retained ~1.3 GB of Babel heap and OOM'd CI.
    // This module is unreachable while equipment-schedule-page's
    // openMonthAgenda() returns early; restoring the feature means putting a
    // licensed, transpile-safe bundle back at this path.
    var jsBundle = appUrl('resources/js/calendar.umd.js');
    var jsFrame  = appUrl('resources/js/monthAgendaFrame.js');



    // </script> inside a JSON literal would close the enclosing script element,
    // so the opening angle bracket is escaped. JSON.stringify output is
    // otherwise safe to embed.
    var payloadLiteral = JSON.stringify(payload).replace(/</g, '\\u003c');

    return [
      '<!DOCTYPE html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>Month Agenda</title>',
      '<link rel="stylesheet" href="' + cssBase + '">',
      '<link rel="stylesheet" href="' + cssTheme + '" data-bryntum-theme>',
      '<style>',
      // Font Awesome from the CDN, for the same reason bryntum-shim.css does
      // it: the local fa-* webfonts Bryntum's stylesheet references were never
      // copied into this project, so the bundled icon rules would 404.
      '@font-face{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:900;font-display:block;',
      'src:url("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/webfonts/fa-solid-900.woff2") format("woff2");}',
      '@font-face{font-family:"Font Awesome 6 Free";font-style:normal;font-weight:400;font-display:block;',
      'src:url("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/webfonts/fa-regular-400.woff2") format("woff2");}',
      'html,body{margin:0;height:100%;font-family:"Oracle Sans",system-ui,sans-serif;background:#fff;}',
      'body{display:flex;flex-direction:column;}',
      // The bar STACKS rather than sitting on one row. MonthAgenda is a
      // phone-width layout, so the popup is a ~460px column; a dropdown, a
      // meta line and four legend pills will not share a line at that width.
      '#eqp-ma-bar{display:flex;flex-direction:column;align-items:stretch;gap:6px;',
      'padding:9px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;flex:0 0 auto;}',
      '#eqp-ma-unit{width:100%;}',
      '#eqp-ma-unit .b-field-inner{background:#fff;border:1px solid #cbd5e1;border-radius:6px;}',
      '#eqp-ma-unit input{font-size:13px;padding:6px 8px;}',
      '#eqp-ma-filters{margin-left:auto;}',
      '#eqp-ma-meta{font-size:11px;color:#64748b;}',
      // Bryntum's toolbar stays visible now: it carries the sidebar toggle
      // ("⋮") and Today. Its day-stepping arrows are configured away in
      // monthAgendaFrame.js rather than hidden here.
      '#eqp-ma-nav{display:flex;align-items:center;gap:4px;}',
      '#eqp-ma-month{font-size:13px;font-weight:700;color:#0f172a;min-width:126px;text-align:center;}',
      '#eqp-ma-nav button{font:inherit;font-size:13px;line-height:1;cursor:pointer;color:#334155;',
      'background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:5px 9px;}',
      '#eqp-ma-nav button:hover{background:#eef2f7;border-color:#94a3b8;}',
      '#eqp-ma-cal{flex:1 1 auto;min-height:0;}',
      // The status checkbox list is flex-sized inside the sidebar and clipped
      // at 128px against 201px of content, which silently hid "Reserved" —
      // the last item, since the list sorts alphabetically. Let it take its
      // natural height and scroll the sidebar as a whole instead.
      '#eqp-ma-cal .b-sidebar .b-list{flex:0 0 auto!important;max-height:none!important;}',
      '#eqp-ma-cal .b-sidebar{overflow-y:auto;}',
      '.eqp-ma-msg{padding:24px;font-size:13px;color:#b91c1c;}',
      // ── Day circles ────────────────────────────────────────────────────
      // A rental fills the date number's circle; maintenance keeps the grey
      // stripe under it (monthAgendaFrame.js paintDayCell adds the class,
      // eventFilter limits the stripe to maintenance). `.b-date-picker-cell-inner`
      // is the aspect-ratio:1 element that holds the number, which is why the
      // fill lands as a circle rather than a block.
      '.eqp-day--booked .b-date-picker-cell-inner,',
      '.eqp-day--reserved .b-date-picker-cell-inner,',
      '.eqp-day--mobilization .b-date-picker-cell-inner{',
      'border-radius:50%;color:#fff!important;font-weight:700;}',
      '.eqp-day--booked .b-date-picker-cell-inner{background:#1565C0!important;}',
      '.eqp-day--reserved .b-date-picker-cell-inner{background:#E65100!important;}',
      '.eqp-day--mobilization .b-date-picker-cell-inner{background:#2E7D32!important;}',
      // Maintenance stripe, drawn into the cell's payload element.
      '.eqp-day-maint{width:58%;height:4px;border-radius:2px;background:#757575;flex:0 0 auto;}',
      // Today keeps its identity on a coloured day: a ring outside the fill
      // rather than a competing background.
      '.b-today.eqp-day--booked .b-date-picker-cell-inner,',
      '.b-today.eqp-day--reserved .b-date-picker-cell-inner,',
      '.b-today.eqp-day--mobilization .b-date-picker-cell-inner{',
      'box-shadow:0 0 0 2px #fff,0 0 0 4px currentColor;}',
      // NO event-colour rules here on purpose. Colour is set per event via
      // Bryntum's `eventColor` (see monthAgendaFrame.js toEvents), which drives
      // its b-colorize system and derives a readable label automatically.
      // Two attempts to do it in CSS here were reverted — the reasons are
      // recorded in that file so they stay next to the code that replaced them.
      '</style></head><body>',
      '<div id="eqp-ma-bar">',
      '<div id="eqp-ma-unit"></div>',
      '<span id="eqp-ma-meta"></span>',
      '<div id="eqp-ma-nav">',
      '<button type="button" id="eqp-ma-prevyear" aria-label="Previous year">«</button>',
      '<button type="button" id="eqp-ma-prev" aria-label="Previous month">‹</button>',
      '<span id="eqp-ma-month"></span>',
      '<button type="button" id="eqp-ma-next" aria-label="Next month">›</button>',
      '<button type="button" id="eqp-ma-nextyear" aria-label="Next year">»</button>',
      // Our own sidebar toggle. Bryntum's built-in toggleSidebar button is
      // configured away because its handler never fired — see the note in
      // monthAgendaFrame.js.
      '<button type="button" id="eqp-ma-filters" aria-label="Filters">⋮ Filters</button>',
      '</div>',
      '</div>',
      '<div id="eqp-ma-cal"></div>',
      '<script src="' + jsBundle + '"></' + 'script>',
      '<script>window.EQP_DATA=' + payloadLiteral + ';</' + 'script>',
      '<script src="' + jsFrame + '"></' + 'script>',
      '</body></html>'
    ].join('\n');
  }

  /**
   * Build the popup document and hand back a blob URL for an <iframe src>.
   *
   * Always returns a URL, including when no unit has any event —
   * monthAgendaFrame.js renders "No units have scheduled events" in that case.
   * Returning null instead would leave the caller with a button that silently
   * does nothing, which is a worse answer than the dialog saying so.
   *
   * The caller owns the URL and must revokeObjectURL it when the dialog closes.
   */
  function createUrl(resourceStore, eventStore, preferredResourceId) {
    var payload = buildPayload(resourceStore, eventStore, preferredResourceId);
    return URL.createObjectURL(new Blob([buildHtml(payload)], { type: 'text/html' }));
  }

  return {
    createUrl    : createUrl,
    buildPayload : buildPayload
  };
});
