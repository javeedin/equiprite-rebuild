/*
 * EquipRite Next's colours (resources/js/theme.js and next.css): the themes and the menu dark or light, kept on this
 * computer; every theme defined in the stylesheet; white text readable on every menu and page head (WCAG AA).
 *
 * Run:  node tests/next-theme.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
let theme;
const sandbox = { console, JSON };
sandbox.define = (names, factory) => { theme = factory(); };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(NEXT, 'resources', 'js', 'theme.js'), 'utf8'), sandbox);

T.section('choices');
T.eq('the default: Redwood teal, a dark menu', JSON.stringify(theme.normal(null)), '{"theme":"teal","menu":"dark"}');
T.eq('an unknown theme or menu falls back', JSON.stringify(theme.normal({ theme: 'pink', menu: 'neon' })), '{"theme":"teal","menu":"dark"}');
T.eq('six themes, two menus', [theme.THEMES.length, theme.MENUS.map((m) => m.id).join()].join(' | '), '6 | dark,light');
const kept = {};
const win = { localStorage: { getItem: (k) => kept[k] || null, setItem: (k, v) => { kept[k] = v; } } };
T.eq('nothing kept: the default', theme.load(win).theme, 'teal');
T.eq('kept', theme.save({ theme: 'industry', menu: 'light' }, win), true);
T.eq('…and read back', JSON.stringify(theme.load(win)), '{"theme":"industry","menu":"light"}');
kept[theme.KEY] = '{broken';
T.eq('a broken copy: the default', theme.load(win).theme, 'teal');
T.eq('no storage (private mode): never throws', [theme.save({}, { get localStorage() { throw new Error('no'); } }), theme.load({}).theme].join(), 'false,teal');
const attrs = {};
const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
theme.apply({ theme: 'smoky', menu: 'dark' }, doc);
T.eq('shown as attributes on the page\'s root', attrs['data-nx-theme'] + ' ' + attrs['data-nx-menu'], 'smoky dark');
T.eq('a swatch: the menu\'s colour, then the page head\'s', theme.swatch(theme.THEMES[1]).background, 'linear-gradient(90deg, #0f2c52 0 46%, #1f5491 46% 100%)');

T.section('the stylesheet');
const css = fs.readFileSync(path.join(NEXT, 'resources', 'css', 'next.css'), 'utf8');
const root = /:root \{([\s\S]*?)\n\}/.exec(css)[1];
const val = (block, name) => (new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})', 'i').exec(block) || [])[1];
theme.THEMES.forEach((t) => {
  const block = t.id === 'teal' ? root : ((new RegExp('html\\[data-nx-theme="' + t.id + '"\\] \\{([^}]*)\\}').exec(css)) || [])[1] || '';
  T.eq(t.label + ': its colours in next.css match the picker', [val(block, 'nx-nav-bg'), val(block, 'nx-band')].join(), [t.nav, t.band].join());
});
T.check('the menu reads its own colour (not the page head\'s)', /\.nx-nav \{ background: var\(--nx-nav-bg\)/.test(css));
T.check('a light menu is styled', /html\[data-nx-menu="light"\] \.nx-nav \{ background: var\(--nx-surface\)/.test(css));

T.section('readable');
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
theme.THEMES.forEach((t) => {
  T.check(t.label + ': white text on the menu and the page heads, 4.5:1 or more', ratio(t.nav, '#ffffff') >= 4.5 && ratio(t.band, '#ffffff') >= 4.5,
    ratio(t.nav, '#ffffff').toFixed(1) + ' / ' + ratio(t.band, '#ffffff').toFixed(1));
});
T.report();
