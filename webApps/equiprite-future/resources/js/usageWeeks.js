define([], function () {
  'use strict';

  /*
   * Week arithmetic for the Usage & cost screens (Time entry, Timesheet approval).
   *
   * A timesheet week starts on MONDAY, as in Old EquipRite (timesheet-detail vbEnterChain getMondayOf) and the
   * backend view: views/timesheet-details/{weekStartDate}/{requestNumber} answers day1Hours..day7Hours for
   * weekStartDate + 0..6, and the save chains post day d at weekStartDate + d. WEEK_END_DAY is not honoured by that
   * view, so it is not honoured here either.
   *
   * Everything works on 'YYYY-MM-DD' strings with UTC arithmetic, so a daylight-saving change can never move a day.
   */
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function iso10(v) {
    var s = v ? String(v).slice(0, 10) : '';
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function toUtc(isoDay) {
    var s = iso10(isoDay);
    if (!s) { return null; }
    return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));
  }

  function fromUtc(d) {
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  /** Today's date on the user's clock, as 'YYYY-MM-DD'. */
  function today(now) {
    var n = now || new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }

  function addDays(isoDay, n) {
    var d = toUtc(isoDay);
    if (!d) { return ''; }
    d.setUTCDate(d.getUTCDate() + Number(n || 0));
    return fromUtc(d);
  }

  /** The Monday of the week holding isoDay. */
  function mondayOf(isoDay) {
    var d = toUtc(isoDay);
    if (!d) { return ''; }
    var dow = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
    return fromUtc(d);
  }

  /** "Mon 2 Nov" */
  function dayLabel(isoDay) {
    var d = toUtc(isoDay);
    return d ? DOW[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()] : '';
  }

  /** The seven days of a week: [{ i: 0..6, iso, dow: 'Mon', num: '2', label: 'Mon 2 Nov' }]. */
  function weekDays(weekStart) {
    var start = mondayOf(weekStart);
    if (!start) { return []; }
    var out = [];
    for (var i = 0; i < 7; i++) {
      var iso = addDays(start, i);
      var d = toUtc(iso);
      out.push({ i: i, iso: iso, dow: DOW[d.getUTCDay()], num: String(d.getUTCDate()), label: dayLabel(iso) });
    }
    return out;
  }

  /** "2 – 8 Nov 2026", "30 Nov – 6 Dec 2026", "29 Dec 2025 – 4 Jan 2026". */
  function weekLabel(weekStart) {
    var a = toUtc(mondayOf(weekStart));
    if (!a) { return ''; }
    var b = toUtc(addDays(fromUtc(a), 6));
    if (a.getUTCFullYear() !== b.getUTCFullYear()) {
      return a.getUTCDate() + ' ' + MON[a.getUTCMonth()] + ' ' + a.getUTCFullYear() + ' – '
        + b.getUTCDate() + ' ' + MON[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
    }
    if (a.getUTCMonth() !== b.getUTCMonth()) {
      return a.getUTCDate() + ' ' + MON[a.getUTCMonth()] + ' – ' + b.getUTCDate() + ' ' + MON[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
    }
    return a.getUTCDate() + ' – ' + b.getUTCDate() + ' ' + MON[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
  }

  /**
   * Every week (Monday) from the week holding startISO to the week holding endISO, the way the old page built its
   * week picker from the request's rental span. Capped at 260 weeks so a bad date cannot spin.
   */
  function weeksBetween(startISO, endISO) {
    var first = mondayOf(startISO);
    var last = mondayOf(endISO);
    if (!first || !last || last < first) { return first ? [first] : []; }
    var out = [];
    for (var w = first; w <= last && out.length < 260; w = addDays(w, 7)) { out.push(w); }
    return out;
  }

  /** Clamp a wanted week into a list of weeks, as the old vbEnterChain step 3 does. */
  function clampWeek(wanted, weeks) {
    var list = Array.isArray(weeks) ? weeks : [];
    if (!list.length) { return mondayOf(wanted) || ''; }
    var w = mondayOf(wanted) || list[0];
    if (w <= list[0]) { return list[0]; }
    if (w >= list[list.length - 1]) { return list[list.length - 1]; }
    return list.indexOf(w) >= 0 ? w : list[0];
  }

  /** True when isoDay falls inside [start, end]; an open end counts as inside. */
  function inSpan(isoDay, start, end) {
    var d = iso10(isoDay);
    var s = iso10(start);
    var e = iso10(end);
    if (!d) { return false; }
    return (!s || d >= s) && (!e || d <= e);
  }

  return {
    iso10: iso10, today: today, addDays: addDays, mondayOf: mondayOf, dayLabel: dayLabel,
    weekDays: weekDays, weekLabel: weekLabel, weeksBetween: weeksBetween, clampWeek: clampWeek, inSpan: inSpan
  };
});
