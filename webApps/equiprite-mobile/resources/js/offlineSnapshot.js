define([], function () {
  'use strict';

  // A copy, on this phone, of what a tab last loaded, so it still shows something with no connection (a yard or a site
  // with no signal). Small summaries only, kept per user in the browser's localStorage; nothing is sent from it, and
  // the tabs say when what they show is the saved copy. Storage failing (private mode, full) never breaks a tab.
  var PREFIX = 'equiprite-mobile:';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function key(name, user) { return PREFIX + name + ':' + String(user || '').trim().toLowerCase(); }
  function store() {
    try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch (e) { return null; }
  }

  /** Keeps data under name for user; false when the phone would not keep it. */
  function save(name, user, data, now) {
    var s = store();
    if (!s) return false;
    try { s.setItem(key(name, user), JSON.stringify({ at: now || Date.now(), data: data })); return true; } catch (e) { return false; }
  }

  /** { at, data } as last saved, or null. */
  function read(name, user) {
    var s = store();
    if (!s) return null;
    try {
      var v = JSON.parse(s.getItem(key(name, user)) || 'null');
      return v && v.data !== undefined ? v : null;
    } catch (e) { return null; }
  }

  function clear(name, user) {
    var s = store();
    if (s) { try { s.removeItem(key(name, user)); } catch (e) { /* nothing kept */ } }
  }

  /** "Saved on this phone at 14:05" (today), "Saved on this phone 8 Oct, 14:05" (before). */
  function savedText(at, now) {
    if (!at) return '';
    var d = new Date(at);
    var n = new Date(now || Date.now());
    var hm = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    var same = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    return 'Saved on this phone ' + (same ? 'at ' + hm : d.getDate() + ' ' + MON[d.getMonth()] + ', ' + hm);
  }

  return { save: save, read: read, clear: clear, savedText: savedText, key: key };
});
