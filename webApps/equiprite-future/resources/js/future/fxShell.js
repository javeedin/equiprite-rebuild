define(['resources/js/nav'], function (nav) {
  'use strict';

  /**
   * The shell's own rules, pure (pages/shell-page-chains use them; tests/future-foundation.test.js checks them):
   * which tabs stay when another persona is played, what the demo clock says happened, and the words for both.
   */

  /** Tabs another persona keeps: My work, records (their page says when one is not theirs), and screens they may open. */
  function prune(tabList, roles) {
    var keep = [];
    var closed = [];
    (tabList || []).forEach(function (t) {
      var record = String(t.id).indexOf(':') !== -1;
      if (t.pinned || record || nav.itemVisible(nav.item(t.navId || t.id), roles)) keep.push(t);
      else closed.push(t);
    });
    return { keep: keep, closed: closed };
  }

  function list(words) {
    if (words.length < 2) return words.join('');
    return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
  }

  /** "Playing as Ana Costa, Equipment Manager · FleetCo. Closed New request: not open to Ana." */
  function personaToast(me, closed) {
    var first = String((me && me.name) || '').split(' ')[0];
    var t = 'Playing as ' + ((me && me.name) || 'someone else') + ((me && me.title) ? ', ' + me.title : '') + '.';
    if ((closed || []).length) t += ' Closed ' + list(closed.map(function (c) { return c.title; })) + ': not open to ' + first + '.';
    return t;
  }

  function sentence(s) { var x = String(s || '').trim(); return x && !/[.!?]$/.test(x) ? x + '.' : x; }

  /**
   * What the demo clock did, in a toast: the new day, what happened by itself on the way (the system's log lines:
   * statements accepted by silence, accruals at the cut-off) and how many new notifications the persona has.
   *   before, after: the store's state around the move; notesBefore, notesAfter: fxViews.notifications() around it;
   *   me: fxViews.me() after it.
   */
  function clockNews(before, after, notesBefore, notesAfter, me) {
    var seen = {};
    ((before && before.log) || []).forEach(function (l) { seen[l.id] = true; });
    var events = ((after && after.log) || []).filter(function (l) { return !seen[l.id] && l.who === 'EquipRite'; }).map(function (l) { return sentence(l.what); }).reverse();
    var had = {};
    ((notesBefore && notesBefore.rows) || []).forEach(function (n) { had[n.id] = true; });
    var fresh = ((notesAfter && notesAfter.rows) || []).filter(function (n) { return !had[n.id]; });
    var t = 'Today is ' + (me ? me.weekday + ' ' + me.todayText : (after && after.today) || '') + '.';
    if (events.length) t += ' ' + events.slice(0, 3).join(' ') + (events.length > 3 ? ' And ' + (events.length - 3) + ' more.' : '');
    else t += ' Nothing happened by itself.';
    if (fresh.length) t += ' ' + fresh.length + (fresh.length === 1 ? ' new notification' : ' new notifications') + ' for you.';
    return { text: t, events: events, fresh: fresh.length };
  }

  /** The toolbar's date: "Mon 2 Nov 2026" (and whether it is a month end). */
  function today(me) { return me ? me.weekday + ' ' + me.todayText : ''; }

  return { prune: prune, personaToast: personaToast, clockNews: clockNews, today: today };
});
