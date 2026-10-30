define([], function () {
  'use strict';

  // EquipRite Mobile's lists open on what is recent, pure (no calls, no storage, no DOM). My requests, Approve and Pick
  // each open on the last DAYS days, with a switch to every date; a search always looks through every date.
  //
  // A thing (a request, a queue item, a pick work item) is recent when any of its dates falls on or after today minus
  // DAYS days, from local midnight: when it was raised or last changed, its start date or its end date. So: active in the
  // last few days, still running, or upcoming. A thing with no date at all is recent: what cannot be dated is never
  // hidden. Since any date counts, the latest one decides; a card keeps it as lastAt (so the copy kept on the phone is
  // filtered the same way when it is shown again, days later).

  var DAYS = 3;
  // When it was raised or last changed (whichever the row has), then when it runs.
  var CHANGED = ['createdDate', 'creationDate', 'createdOn', 'lastUpdatedDate', 'lastUpdateDate', 'updatedDate', 'submittedDate'];
  var SPAN = ['startDate', 'endDate', 'start', 'end'];
  var FIELDS = CHANGED.concat(SPAN);

  var LABEL = 'Last ' + DAYS + ' days';
  var PHRASE = 'in the last ' + DAYS + ' days';

  function words(text) { return String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean); }

  /**
   * A date as ms, or null when it is not one. A day ("2026-10-27") is that day's local midnight; so is a time at
   * midnight UTC or with no time of its own ("2026-10-27T00:00:00Z": a day sent as a timestamp, shown as 27 Oct). Any
   * other time is the moment it names. A number is ms already (a card's lastAt).
   */
  function ms(v) {
    if (typeof v === 'number') return isFinite(v) && v > 0 ? v : null;
    if (v instanceof Date) { var t = v.getTime(); return isNaN(t) ? null : t; }
    if (typeof v !== 'string') return null;
    var s = v.trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]) - 1;
    var d = Number(m[3]);
    var day = new Date(y, mo, d);
    if (day.getFullYear() !== y || day.getMonth() !== mo || day.getDate() !== d) return null;
    var midnight = !m[4] || (Number(m[4]) === 0 && Number(m[5]) === 0 && !Number(m[6] || 0) && (!m[7] || /^(Z|[+-]00:?00)$/.test(m[7])));
    if (midnight) return day.getTime();
    var at = Date.parse(s.replace(' ', 'T').replace(/\s+(?=[Z+-])/, '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    return isNaN(at) ? null : at;
  }

  /** Where recent starts: local midnight, DAYS days before today (now: ms, default the clock). */
  function cutoff(now, days) {
    var d = new Date(now == null ? Date.now() : now);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (days == null ? DAYS : days)).getTime();
  }

  /** The latest of a thing's dates (its fields, FIELDS unless given, and any more dates given), as ms; null when none. */
  function latest(x, more, fields) {
    var best = null;
    var take = function (v) {
      var t = ms(v);
      if (t != null && (best == null || t > best)) best = t;
    };
    if (x && typeof x === 'object') (fields || FIELDS).forEach(function (k) { take(x[k]); });
    (Array.isArray(more) ? more : []).forEach(take);
    return best;
  }

  /** Whether the latest date given (ms, or null: no date) is recent. */
  function recentAt(t, now) {
    var v = ms(t);
    return v == null || v >= cutoff(now);
  }

  /** A thing's latest date: its lastAt when it has one (null: no date), else read from its fields. */
  function when(x) {
    if (x && x.lastAt !== undefined) return ms(x.lastAt);
    return latest(x);
  }

  /** Whether a thing is recent (when: how to read its latest date, default its lastAt or its fields). */
  function isRecent(x, now, whenFn) {
    return recentAt((whenFn || when)(x), now);
  }

  /** The recent ones, in their order. */
  function only(list, now, whenFn) {
    return (Array.isArray(list) ? list : []).filter(function (x) { return isRecent(x, now, whenFn); });
  }

  /** The same things, the recent ones first (each part in its order): what a "next up" goes through first. */
  function recentFirst(list, now, whenFn) {
    var l = Array.isArray(list) ? list : [];
    var older = [];
    var out = l.filter(function (x) {
      if (isRecent(x, now, whenFn)) return true;
      older.push(x);
      return false;
    });
    return out.concat(older);
  }

  /**
   * What a list shows for the period chosen and the search:
   *   period  'recent' (the default) | 'all'
   *   text    while words are typed, every date is searched: the period is set aside
   * { list (what the period keeps: the chips count it), filtered (the period is applied), searching (the period set
   *   aside for a search), older (how many it leaves out) }
   */
  function view(list, period, text, now, whenFn) {
    var all = Array.isArray(list) ? list : [];
    var typed = words(text).length > 0;
    var recentPeriod = period !== 'all';
    if (!recentPeriod || typed) return { list: all.slice(), filtered: false, searching: recentPeriod && typed, older: 0 };
    var kept = only(all, now, whenFn);
    return { list: kept, filtered: true, searching: false, older: all.length - kept.length };
  }

  /** "12 older requests"; '' for none. */
  function olderText(n, one, many) {
    var c = Number(n) || 0;
    if (c <= 0) return '';
    return c + ' older ' + (c === 1 ? one : (many || one + 's'));
  }

  /**
   * What a page keeps of a view, for its bindings: { filtered, searching, older (left out of the list shown: under its
   * chip), olderText ("12 older requests"), count (in the period) }.
   */
  function dated(v, olderShown, one, many) {
    var o = v && v.filtered ? Math.max(0, Number(olderShown) || 0) : 0;
    return { filtered: !!(v && v.filtered), searching: !!(v && v.searching), older: o, olderText: olderText(o, one, many),
      count: v && v.list ? v.list.length : 0 };
  }

  return {
    DAYS: DAYS, CHANGED: CHANGED, SPAN: SPAN, FIELDS: FIELDS, LABEL: LABEL, PHRASE: PHRASE,
    ms: ms, cutoff: cutoff, latest: latest, recentAt: recentAt, when: when, isRecent: isRecent, only: only, recentFirst: recentFirst,
    view: view, olderText: olderText, dated: dated
  };
});
