define([], function() {
  'use strict';

  // Bryntum scheduler treats event/timeRange endDate as EXCLUSIVE — an event
  // with endDate = 2026-06-20T00:00:00Z ends at the START of June 20, so the
  // bar visually stops at the June 19/20 boundary.
  //
  // Our backend stores inclusive end dates ("ends on June 20"). Bump +1 day
  // before handing to Bryntum so the bar visually covers through the user's
  // intended last day. Backend writes are unaffected — only Bryntum input
  // should be passed through this helper.
  //
  // Accepts an ISO date or datetime string; returns a Date one day later.
  // Falsy / unparseable input passes through unchanged so callers can use
  // this as a drop-in transformer.
  function inclusiveEnd(val) {
    if (!val) return val;
    var day = String(val).substring(0, 10);
    var d = new Date(day + 'T00:00:00Z');
    if (isNaN(d.getTime())) return val;
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }

  return {
    inclusiveEnd: inclusiveEnd
  };
});
