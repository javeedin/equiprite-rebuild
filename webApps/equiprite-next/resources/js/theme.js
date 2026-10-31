define([], function () {
  'use strict';

  // EquipRite Next's colours: a theme (a dark menu and the page heads in the same colour, lighter) and the menu dark
  // or light. Applied as data-nx-theme / data-nx-menu on the page's root, where next.css picks the colours up
  // (--nx-band, --nx-band-ink, --nx-nav-bg). Kept on this computer per browser (localStorage); a choice that cannot
  // be kept still applies for the session. Every theme keeps white text readable (WCAG AA, 4.5:1 and more).
  var KEY = 'equiprite-next:theme';
  var THEMES = [
    { id: 'teal', label: 'Redwood teal', nav: '#1d3846', band: '#2e5468' },
    { id: 'industry', label: 'Industry blue', nav: '#0f2c52', band: '#1f5491' },
    { id: 'smoky', label: 'Smoky', nav: '#25292f', band: '#4b5461' },
    { id: 'slate', label: 'Slate', nav: '#1e2a3a', band: '#3d5170' },
    { id: 'forest', label: 'Forest', nav: '#1b3326', band: '#2f5b42' },
    { id: 'ember', label: 'Ember', nav: '#45211a', band: '#8a3d2c' }
  ];
  var MENUS = [{ id: 'dark', label: 'Dark menu' }, { id: 'light', label: 'Light menu' }];
  var DEFAULT = { theme: 'teal', menu: 'dark' };

  function known(list, id) { return list.some(function (x) { return x.id === id; }); }

  /** A choice made valid: an unknown theme or menu falls back to the default. */
  function normal(choice) {
    var c = choice || {};
    return { theme: known(THEMES, c.theme) ? c.theme : DEFAULT.theme, menu: known(MENUS, c.menu) ? c.menu : DEFAULT.menu };
  }

  function store(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    try { return w && w.localStorage ? w.localStorage : null; } catch (e) { return null; }
  }

  /** The choice kept on this computer, or the default. */
  function load(win) {
    var s = store(win);
    if (!s) return normal(null);
    try { return normal(JSON.parse(s.getItem(KEY) || 'null')); } catch (e) { return normal(null); }
  }

  /** Keeps a choice (false when the browser will not). */
  function save(choice, win) {
    var s = store(win);
    if (!s) return false;
    try { s.setItem(KEY, JSON.stringify(normal(choice))); return true; } catch (e) { return false; }
  }

  /** Shows a choice: the attributes next.css reads, on the page's root. */
  function apply(choice, doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    var c = normal(choice);
    if (d && d.documentElement) {
      d.documentElement.setAttribute('data-nx-theme', c.theme);
      d.documentElement.setAttribute('data-nx-menu', c.menu);
    }
    return c;
  }

  /** A swatch's colours: the menu's on the left, the page head's on the right. */
  function swatch(t) {
    return { background: 'linear-gradient(90deg, ' + t.nav + ' 0 46%, ' + t.band + ' 46% 100%)' };
  }

  return { THEMES: THEMES, MENUS: MENUS, DEFAULT: DEFAULT, KEY: KEY, normal: normal, load: load, save: save, apply: apply, swatch: swatch };
});
