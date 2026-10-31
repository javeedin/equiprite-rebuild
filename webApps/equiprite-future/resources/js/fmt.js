define([], function () {
  'use strict';

  // Dates, money and counts the way a person writes them, for every screen of EquipRite Next.
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAY = 86400000;

  function parts(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
    return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null;
  }

  function dayMs(v) {
    var p = parts(v);
    return p ? Date.UTC(p.y, p.m, p.d) : null;
  }

  function today(now) {
    var d = new Date(now || Date.now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  /** '8 Oct 2026' ('8 Oct' with year false). */
  function date(v, year) {
    var p = parts(v);
    if (!p) return '';
    return p.d + ' ' + MON[p.m] + (year === false ? '' : ' ' + p.y);
  }

  /** '8 Oct – 30 Oct 2026', the year once when both share it. */
  function range(a, b) {
    var x = parts(a);
    var y = parts(b);
    if (x && y) return x.y === y.y ? date(a, false) + ' – ' + date(b) : date(a) + ' – ' + date(b);
    return x ? date(a) : (y ? date(b) : '');
  }

  /** 'today', 'tomorrow', 'in 3 days', 'yesterday', '4 days ago'. */
  function relative(v, now) {
    var d = dayMs(v);
    if (d == null) return '';
    var n = Math.round((d - today(now)) / DAY);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? 'in ' + n + ' days' : -n + ' days ago';
  }

  /** '$1,240' (no cents when whole), '' for nothing. */
  function money(v, currency) {
    if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '';
    var n = Number(v);
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD',
        minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
    } catch (e) {
      return '$' + n.toFixed(2);
    }
  }

  /** '1 piece', '3 pieces'. */
  function count(n, one, many) {
    var v = Number(n) || 0;
    return v + ' ' + (v === 1 ? one : (many || one + 's'));
  }

  /** 'Good morning' etc. */
  function greeting(now) {
    var h = new Date(now || Date.now()).getHours();
    return h < 12 ? 'Good morning' : (h < 18 ? 'Good afternoon' : 'Good evening');
  }

  return { date: date, range: range, relative: relative, money: money, count: count, dayMs: dayMs, today: today, greeting: greeting };
});
