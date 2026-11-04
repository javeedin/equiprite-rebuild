define([], function () {
  'use strict';

  // EquipRite Next's look: Redwood (Oracle's own: the Redwood page header with its colour strip, Oracle Sans, the
  // call-to-action button, badges, tables and fields as Oracle draws them) or Current (Next's own). Chosen in your menu
  // (under your name) and kept for you: per user, on this computer (localStorage), with the last choice made here used
  // while the shell is still finding out who you are, so the page does not flash the other look first.
  // Shown as data-nx-look on the page's root, where next.css picks it up; a screen with an Oracle page template of its
  // own (Requests) also hears the change (onChange) and swaps to it.
  var KEY = 'equiprite-next:look';
  var LOOKS = [
    { id: 'redwood', label: 'Redwood', note: 'Oracle\'s own look, as in Fusion' },
    { id: 'current', label: 'Current', note: 'Next\'s own look, with your colours' }
  ];
  var DEFAULT = 'current';
  var listeners = [];
  var shown = null;

  /** A look made valid: anything unknown is the default. */
  function normal(id) { return id === 'redwood' || id === 'current' ? id : DEFAULT; }

  /** The key a user's choice is kept under: the username, lower case ('' for nobody known). */
  function who(user) { return String(user || '').trim().toLowerCase(); }

  function store(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    try { return w && w.localStorage ? w.localStorage : null; } catch (e) { return null; }
  }

  function read(win) {
    var s = store(win);
    if (!s) return {};
    try {
      var m = JSON.parse(s.getItem(KEY) || 'null');
      return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
    } catch (e) { return {}; }
  }

  /**
   * The look kept for a user on this computer. With no user yet (the shell opening): the last look chosen here.
   * A user who never chose has the default, whatever someone else chose on this computer.
   */
  function load(user, win) {
    var m = read(win);
    var u = who(user);
    if (!u) return normal(m.last);
    var users = m.users && typeof m.users === 'object' ? m.users : {};
    return Object.prototype.hasOwnProperty.call(users, u) ? normal(users[u]) : DEFAULT;
  }

  /** Keeps a user's look (and makes it the last look chosen here). False when the browser will not keep it. */
  function save(user, look, win) {
    var s = store(win);
    if (!s) return false;
    var m = read(win);
    var users = m.users && typeof m.users === 'object' ? m.users : {};
    var u = who(user);
    if (u) users[u] = normal(look);
    try { s.setItem(KEY, JSON.stringify({ last: normal(look), users: users })); return true; } catch (e) { return false; }
  }

  /** Shows a look: data-nx-look on the page's root; whoever listens hears a change. */
  function apply(look, doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    var l = normal(look);
    if (d && d.documentElement) d.documentElement.setAttribute('data-nx-look', l);
    var changed = shown !== null && shown !== l;
    shown = l;
    if (changed) {
      listeners.slice().forEach(function (fn) {
        try { fn(l); } catch (e) { if (typeof console !== 'undefined') console.warn('[look] a listener failed', e); }
      });
    }
    return l;
  }

  /** The look on the page now (the default before anything is shown). */
  function current() { return shown || DEFAULT; }

  /** Hear every change of look; returns a function that stops listening. */
  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
  }

  return { KEY: KEY, LOOKS: LOOKS, DEFAULT: DEFAULT, normal: normal, load: load, save: save, apply: apply, current: current, onChange: onChange };
});
