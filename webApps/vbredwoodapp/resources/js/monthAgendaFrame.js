/*
 * Runtime for the month-agenda popup document.
 *
 * NOT AN AMD MODULE — deliberately. This file is loaded by a plain <script src>
 * inside the popup's blob-URL iframe, where there is no RequireJS. Wrapping it
 * in define() would leave it inert.
 *
 * Its input is window.EQP_DATA, written into the document by
 * monthAgendaPopup.js before this script runs. Its output is a Bryntum Calendar
 * in #eqp-ma-cal. See monthAgendaPopup.js for why the popup is an iframe at all.
 */
(function () {
  'use strict';

  var calEl = document.getElementById('eqp-ma-cal');

  // GUARD: this file only has a job inside the popup's blob-URL iframe, which
  // is the only document that contains #eqp-ma-cal. It is NOT an AMD module,
  // so the VBCS optimizer sweeps it into bundles/vb-app-bundle.js and it then
  // ALSO runs in the main document at app boot - where calEl is null, fail()
  // threw "Cannot set properties of null (setting 'innerHTML')", and the whole
  // app white-screened before rendering. Bail out when we are not in the frame.
  if (!calEl) return;

  function fail(msg) {
    calEl.innerHTML = '<div class="eqp-ma-msg">' + msg + '</div>';
  }

  var ns       = window.bryntum && window.bryntum.calendar;
  var Calendar = ns && ns.Calendar;
  var Combo    = ns && ns.Combo;
  if (!Calendar || !Combo) {
    fail('Bryntum Calendar failed to load.');
    return;
  }

  var DATA = window.EQP_DATA || { units: [] };
  var byId = {};
  DATA.units.forEach(function (u) { byId[String(u.id)] = u; });

  // A semantic hook on each event element, not a styling one — colour comes
  // from `eventColor` below. Kept because it makes the rendered DOM
  // self-describing when inspecting, and gives any later per-status tweak
  // (a hatch pattern on maintenance, say) something to hang off.
  function statusCls(s) {
    if (s === 'ALLOCATED') return 'eqpc-booked';
    if (s === 'PENDING' || s === 'IN_PROCESS') return 'eqpc-reserved';
    if (s === 'MOBILIZATION') return 'eqpc-mobilization';
    if (s === 'MAINTENANCE') return 'eqpc-maintenance';
    return 'eqpc-other';
  }

  // Agenda rows say what the booking IS, not just its status.
  //
  // The bar label on the timeline is deliberately terse ("Booked",
  // "Maintenance") because a bar is a few pixels wide. An agenda row is a full
  // line of text, so the status alone wastes it — four rows all reading
  // "Maintenance" distinguish nothing. The qualifier is the project for a
  // rental and the work-order number for maintenance, matching what the
  // schedule's own tooltip leads with.
  function eventLabel(e) {
    var qualifier = e.status === 'MAINTENANCE' ? e.workOrder : e.project;
    return qualifier ? e.name + '  ·  ' + qualifier : e.name;
  }

  /*
   * `eventColor` TAKES THE HEX DIRECTLY — do not "fix" this into CSS.
   *
   * Two earlier attempts got this wrong, both verified against a real render:
   *
   *   1. `background-color: … !important` on the status class drew every event
   *      blue. An all-day event paints as
   *      `.b-cal-event-wrap.b-solid-bar > .b-cal-event`, and the record's `cls`
   *      lands on the WRAP while the background is on the CHILD, so the rule
   *      was styling the wrong element and could not win at any weight.
   *   2. Setting `--b-calendar-solid-bar-background` on the wrap fixed the
   *      background but left the label invisible: text colour comes from
   *      `.b-cal-event-desc { color: var(--bi-calendar-event-text-color)
   *      !important }`, which Bryntum derives separately, so the label stayed
   *      the untouched default against the new background.
   *
   * Bryntum's `eventColor` compiles down to `--b-primary: <value>` on the
   * event, and the whole b-colorize system derives background, text, hover and
   * selected from that one variable. Handing it our hex therefore gets a
   * correctly contrasted chip for free — a pale tint with a dark readable
   * label, which is exactly how Bryntum's own MonthAgenda demo renders its
   * all-day events. Overriding any single derived variable breaks that
   * relationship.
   *
   * `allDay: true` is a real event field despite not being enumerated in
   * calendar.thin.d.ts (which omits fields inherited from Scheduler's
   * EventModel); Bryntum's shipped demo data sets it and the bundle honours it.
   * It matters because every one of our events is a whole-day booking or work
   * order, never an intraday appointment — which is also why the agenda shows
   * chips with "Ends 25 Sep" rather than the "09:00 - 10:00" rows in Bryntum's
   * demo. That demo's data is timed meetings; ours is multi-day spans, and the
   * chip is how Bryntum renders those (its own "Hackathon 2020" row is the
   * same shape).
   */
  /* STATUSES ARE MODELLED AS BRYNTUM "RESOURCES".
   *
   * The popup shows one unit, so the resource axis is free — and Bryntum's
   * sidebar renders a ResourceFilter as a list of coloured checkboxes. Mapping
   * each allocStatus to a resource turns that built-in widget into exactly
   * what this view needs: a colour legend that is also a filter, so "show me
   * only the maintenance" is a click rather than a feature to build.
   *
   * The filter list sorts its entries ALPHABETICALLY — declaration order here
   * does not carry through, so do not rely on it to mirror the legend order on
   * the page behind the dialog.
   */
  var ALL_STATUS_RESOURCES = [
    { id : 'ALLOCATED',    name : 'Booked',       eventColor : '#1565C0' },
    { id : 'RESERVED',     name : 'Reserved',     eventColor : '#E65100' },
    { id : 'MOBILIZATION', name : 'Mobilization', eventColor : '#2E7D32' },
    { id : 'MAINTENANCE',  name : 'Maintenance',  eventColor : '#757575' },
    { id : 'OTHER',        name : 'Other',        eventColor : '#9ca3af' }
  ];

  /* Only the statuses that actually occur get a resource.
   *
   * Listing all five put "Other" and "Reserved" below the fold in a 600px
   * popup (the list sorts alphabetically, so the tail is arbitrary) and put a
   * dead "Other" checkbox in front of the user on data that has no rejected or
   * cancelled lines. Computed across EVERY unit, not just the visible one, so
   * the filter does not reshuffle as the unit picker changes.
   */
  function presentStatusResources(units) {
    var present = {};
    units.forEach(function (u) {
      u.events.forEach(function (e) { present[statusResourceId(e.status)] = true; });
    });
    var picked = ALL_STATUS_RESOURCES.filter(function (r) { return present[r.id]; });
    // Never hand Bryntum an empty resource store — an event whose resourceId
    // matches nothing would not render at all.
    return picked.length ? picked : ALL_STATUS_RESOURCES.slice(0, 1);
  }

  function statusResourceId(s) {
    if (s === 'ALLOCATED') return 'ALLOCATED';
    if (s === 'PENDING' || s === 'IN_PROCESS') return 'RESERVED';
    if (s === 'MOBILIZATION') return 'MOBILIZATION';
    if (s === 'MAINTENANCE') return 'MAINTENANCE';
    return 'OTHER';
  }

  /* ── Day colouring ───────────────────────────────────────────────────────
   *
   * A rental paints the DATE ITSELF — the circle round the day number — while
   * maintenance stays as the grey bar under it. That way a day that is both
   * booked and in for maintenance says both things at once, which a single
   * dot cannot.
   *
   * dayStatus maps 'YYYY-MM-DD' to the rental status that should own that
   * day's circle. Ranked, because a day can carry several: a firm booking
   * outranks a mobilisation leg, which outranks a tentative reservation —
   * strongest commitment wins, so the circle never under-states the day.
   */
  var DAY_RANK = { ALLOCATED : 3, MOBILIZATION : 2, RESERVED : 1 };
  var DAY_CLS  = {
    ALLOCATED    : 'eqp-day--booked',
    MOBILIZATION : 'eqp-day--mobilization',
    RESERVED     : 'eqp-day--reserved'
  };
  var dayStatus = {};
  var dayMaint  = {};

  function isoLocal(d) {
    var m = String(d.getMonth() + 1), dd = String(d.getDate());
    return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (dd.length < 2 ? '0' + dd : dd);
  }

  function rebuildDayStatus(unit) {
    dayStatus = {};
    dayMaint  = {};
    unit.events.forEach(function (e) {
      var rid = statusResourceId(e.status);
      if (rid === 'MAINTENANCE') {
        var md  = new Date(e.start + 'T00:00:00');
        var men = new Date(e.end + 'T00:00:00');
        while (md < men) { dayMaint[isoLocal(md)] = true; md.setDate(md.getDate() + 1); }
        return;
      }
      if (!DAY_RANK[rid]) return;           // 'other': no circle, no bar
      // e.end is EXCLUSIVE (see exclusiveEnd in monthAgendaPopup.js), so the
      // loop stops before it and a one-day booking colours exactly one day.
      var d   = new Date(e.start + 'T00:00:00');
      var end = new Date(e.end + 'T00:00:00');
      while (d < end) {
        var k = isoLocal(d);
        if (!dayStatus[k] || DAY_RANK[rid] > DAY_RANK[dayStatus[k]]) dayStatus[k] = rid;
        d.setDate(d.getDate() + 1);
      }
    });
  }

  /* Draws BOTH marks, because a custom cellRenderer REPLACES Bryntum's default
   * cell rendering — and the default rendering is what drew the event dots.
   * The first attempt set only the circle class and the maintenance stripe
   * silently disappeared. `cellPayload` is documented as "an empty, absolutely
   * positioned element, by default docked at the bottom of the cell", which is
   * exactly where the stripe belongs, so we draw it there ourselves and drop
   * eventDots/eventFilter entirely. Deterministic, and it means a day can show
   * a rental circle and a maintenance stripe at once.
   */
  function paintDayCell(renderData) {
    var cell = renderData.cell;
    var key  = isoLocal(renderData.date);

    // Cells are recycled as the month changes, so stale marks must come off
    // before the new ones go on or they smear across months.
    cell.classList.remove('eqp-day--booked', 'eqp-day--mobilization', 'eqp-day--reserved');
    var cls = DAY_CLS[dayStatus[key]];
    if (cls) cell.classList.add(cls);

    // The payload element is docked at the bottom with NO HEIGHT of its own,
    // so an absolutely positioned child inside it was laid out (44x4, correct
    // position) but clipped and invisible. Give it a height only on the days
    // that need one, and let flex centre the stripe inside it.
    var payload = renderData.cellPayload;
    if (payload) {
      if (dayMaint[key]) {
        payload.innerHTML = '<div class="eqp-day-maint"></div>';
        payload.style.height     = '6px';
        payload.style.overflow   = 'visible';
        payload.style.alignItems = 'flex-end';
        payload.style.justifyContent = 'center';
      }
      else {
        payload.innerHTML    = '';
        payload.style.height = '';
      }
    }
  }

  function toEvents(unit) {
    return unit.events.map(function (e, i) {
      return {
        id         : i + 1,
        name       : eventLabel(e),
        startDate  : e.start,
        endDate    : e.end,
        allDay     : true,
        resourceId : statusResourceId(e.status),
        cls        : statusCls(e.status),
        eventColor : e.color,
        eqpDetail  : e
      };
    });
  }

  // Open on a month that actually contains something.
  //
  // Defaulting to today would show an empty grid for any unit whose work is
  // wholly in the past or the future, which reads as "the calendar is broken"
  // rather than "this unit is free". Preference order: this month if it has
  // events, else the next event, else the most recent one.
  function openingDate(unit) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var starts = unit.events.map(function (e) { return new Date(e.start + 'T00:00:00'); });

    var inThisMonth = starts.some(function (d) {
      return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
    });
    if (inThisMonth) return today;

    var upcoming = starts.filter(function (d) { return d >= today; })
                         .sort(function (a, b) { return a - b; });
    if (upcoming.length) return upcoming[0];

    return starts.sort(function (a, b) { return b - a; })[0] || today;
  }

  function meta(unit) {
    var bits = [];
    if (unit.klass)    bits.push(unit.klass.replace(/_/g, ' '));
    if (unit.location) bits.push(unit.location);
    bits.push(unit.events.length + (unit.events.length === 1 ? ' event' : ' events'));
    return bits.join('  ·  ');
  }

  var first = byId[String(DATA.initialUnitId)] || DATA.units[0];
  if (!first) {
    fail('No units have scheduled events.');
    return;
  }

  rebuildDayStatus(first);

  var calendar = new Calendar({
    appendTo  : 'eqp-ma-cal',
    date      : openingDate(first),
    mode      : 'month',
    resources : presentStatusResources(DATA.units),

    /* ── Toolbar: keep three items, drop three ──────────────────────────
     * Every toolbar item is individually configurable, so rather than hiding
     * the whole bar (the previous approach) we keep what earns its place:
     *
     *   toggleSidebar   the "⋮" button — the only way to reach the sidebar
     *   todayButton     jump back to today
     *   viewDescription the current date, so the header says where you are
     *
     * prevButton/nextButton are removed because they step by a single DAY in
     * this view — `MonthAgendaView.stepUnit` is readonly, so the step cannot
     * be changed, and month navigation lives in the sidebar's date picker
     * instead (see navigatorPlacement below). modeSelector is removed because
     * there is only one mode.
     */
    tbar : {
      items : {
        prevButton   : null,
        nextButton   : null,
        modeSelector : null,
        // Its handler never fires: the button widget is built (ref
        // 'toggleSidebar', onClick a handler string) but neither a synthetic
        // click nor a full pointerdown/mouseup sequence expands the sidebar —
        // it stays `b-collapsed` at width 0, which is why "⋮" looked dead.
        // Setting `calendar.sidebar.collapsed = false` DOES work (width 295),
        // so the sidebar itself is fine and only the wiring is not. Rather
        // than leave a dead control on screen and risk double-toggling if it
        // ever starts working, it is removed and replaced by our own button.
        toggleSidebar : null
      }
    },

    // NO navigatorPlacement:'sidebar'. It does work — it puts a « ‹ › » picker
    // in the sidebar that steps months and years — but that picker is ~200px
    // tall and pushed the status checkboxes below the fold in a 600px popup.
    // The inline month stepper in the header already covers month navigation
    // and is one click rather than two, so the sidebar is left to the two
    // filters and stays compact.

    sidebar : {
      items : {
        // Free text over event names. Our labels carry the project and the
        // work-order number, so this filters by either.
        eventFilter : { placeholder : 'Filter bookings' }
      }
    },

    modes    : {
      // Only the month mode is wanted here. The popup is a focused "when is
      // this unit busy" view; the day/week/year tabs would just add chrome the
      // full-page Scheduler behind the dialog already covers better.
      day    : null,
      week   : null,
      year   : null,
      agenda : null,
      list   : null,
      month  : {
        // No eventDots/eventFilter: paintDayCell draws both marks itself.
        cellRenderer : paintDayCell
      }
    },
    events : toEvents(first),

    // THE MONTHAGENDA SWAP.
    //
    // Bryntum has no `mode: 'monthagenda'`; the agenda variant is selected by
    // rewriting the month view's type as the mode is constructed. The shipped
    // demo guards this with matchMedia('(max-width: 600px)') so the agenda only
    // appears on phones. Here the popup IS the phone-shaped surface, so it
    // always applies.
    onBeforeCreateMode : function (ev) {
      if (ev.config.type === 'month') {
        ev.config.type = 'monthagenda';
      }
    }
  });

  /* ── On sizing: the popup is a FIXED phone-shaped panel ──────────────────
   *
   * An auto-size pass (frame measures content, posts a height, host resizes the
   * iframe) was built and removed. It cannot work here: MonthAgendaView
   * DISTRIBUTES its height between the month grid and the agenda rather than
   * deriving it from content, so the month grid shrinks as the iframe shrinks.
   * Measuring it therefore measures whatever height you already gave it, and
   * feeding that back is a loop — it reported 304px for a container whose month
   * grid alone wants 322px.
   *
   * So the host sets a fixed 540x600 panel (see equipment-schedule-page.html):
   * the month grid settles around 322px, leaving roughly five agenda rows, and
   * the agenda scrolls past that. Two dead ends worth not repeating if someone
   * revisits this: `.b-cal-agenda-grid-row` still renders on an empty day as a
   * single stretched placeholder holding zero `.b-cal-agenda-event-row`
   * children, and `.b-empty-text` is an overlay filling that same stretched
   * area — so both measure the void instead of the content.
   */

  /* ── Month navigation ────────────────────────────────────────────────────
   *
   * Bryntum's own toolbar is hidden (see the CSS in monthAgendaPopup.js) and
   * replaced by this row, because its arrows step by a single DAY. That is
   * correct for an agenda — the agenda lists one day — but it made "show me
   * next month" about thirty clicks. `MonthAgendaView.stepUnit` is declared
   * readonly in calendar.thin.d.ts, so the step cannot simply be reconfigured
   * to 'month'; driving `calendar.date` directly is the way.
   *
   * This stays even though the sidebar now has a date picker: month navigation
   * has to be one visible click, not two behind a "⋮". The sidebar picker is
   * for jumping further (it steps years with « »).
   *
   * The day of the month is preserved across a jump where it exists, clamped
   * to the last day where it does not — stepping from 31 Jan lands on 28/29
   * Feb rather than skidding into March, which is what a naive setMonth does.
   */
  var monthEl = document.getElementById('eqp-ma-month');

  // deltaMonths is the whole step, so a year is just 12 of them — one clamp,
  // one code path, and « » cannot drift out of step with ‹ ›.
  function shiftMonth(delta) {
    var cur   = new Date(calendar.date);
    var day   = cur.getDate();
    var first = new Date(cur.getFullYear(), cur.getMonth() + delta, 1);
    var last  = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first.setDate(Math.min(day, last));
    calendar.date = first;
  }

  function syncMonthLabel() {
    if (!monthEl) return;
    var d = new Date(calendar.date);
    monthEl.textContent = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  document.getElementById('eqp-ma-prevyear')
    .addEventListener('click', function () { shiftMonth(-12); });
  document.getElementById('eqp-ma-prev')
    .addEventListener('click', function () { shiftMonth(-1); });
  document.getElementById('eqp-ma-next')
    .addEventListener('click', function () { shiftMonth(1); });
  document.getElementById('eqp-ma-nextyear')
    .addEventListener('click', function () { shiftMonth(12); });

  // Keeps the label honest when the date moves for any other reason — clicking
  // a day cell, or the unit picker jumping to that unit's next booking.
  calendar.on('dateChange', syncMonthLabel);
  syncMonthLabel();

  // ── Unit picker ──────────────────────────────────────────────────────────
  //
  // A Bryntum Combo rather than a <select>: with hundreds of units a plain
  // dropdown means scrolling, while the Combo filters as you type. Built from
  // the same bundle the calendar comes from (bryntum.calendar.Combo), so it
  // matches the surrounding widgets without extra CSS.
  //
  // The serial is appended only when it adds something: most units in dev
  // carry no equipment_name (the rail renders them "—"), so buildPayload falls
  // back to the resource's `name`, which IS the serial — appending
  // unconditionally produced "LIE-EXC-…-0005 · LIE-EXC-…-0005".
  function unitLabel(u) {
    return (u.serial && u.serial !== u.name) ? u.name + '  ·  ' + u.serial : u.name;
  }

  var metaEl = document.getElementById('eqp-ma-meta');
  metaEl.textContent = meta(first);

  new Combo({
    appendTo     : 'eqp-ma-unit',
    store        : { data : DATA.units.map(function (u) {
                      return { id : u.id, text : unitLabel(u) };
                    }) },
    value        : first.id,
    editable     : true,
    clearable    : false,
    autoExpand   : true,
    placeholder  : 'Search equipment…',
    // Substring match, not prefix: users know a serial fragment or a model
    // name far more often than they know what a label starts with.
    filterOperator : '*',
    onChange : function (ev) {
      var u = byId[String(ev.value)];
      if (!u) return;
      rebuildDayStatus(u);          // before the refresh that repaints the cells
      calendar.events = toEvents(u);
      calendar.date   = openingDate(u);
      metaEl.textContent = meta(u);
      syncMonthLabel();
    }
  });

  // Our sidebar toggle, since Bryntum's is configured away (see tbar above).
  document.getElementById('eqp-ma-filters').addEventListener('click', function () {
    var sb = calendar.sidebar;
    if (sb) sb.collapsed = !sb.collapsed;
  });
}());
