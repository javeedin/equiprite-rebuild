/*
 * EquipRite Next's look (resources/js/look.js, next-redwood.css): Redwood or Current, chosen in your menu, kept for
 * you on this computer (per user, so someone else on the same computer keeps their own), shown on the page's root,
 * heard by the screens that swap to an Oracle page template; the Redwood stylesheet is loaded last and speaks only
 * for the Redwood look; the switch lives in your menu, not on Requests.
 *
 * Run:  node tests/next-look.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const NEXT = path.join(__dirname, '..', 'webApps', 'equiprite-next');
let look;
const sandbox = { console, JSON, Object, Array };
sandbox.define = (names, factory) => { look = factory(); };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(NEXT, 'resources', 'js', 'look.js'), 'utf8'), sandbox);

T.section('choices');
T.eq('two looks, Redwood first; Current the default', [look.LOOKS.map((l) => l.id).join(), look.DEFAULT].join(' | '), 'redwood,current | current');
T.eq('anything unknown is Current', [look.normal('neon'), look.normal(''), look.normal(null), look.normal('redwood')].join(), 'current,current,current,redwood');

T.section('kept for you, on this computer');
const kept = {};
const win = { localStorage: { getItem: (k) => (k in kept ? kept[k] : null), setItem: (k, v) => { kept[k] = v; } } };
T.eq('nothing kept: Current', [look.load('priya.raman', win), look.load('', win)].join(), 'current,current');
T.eq('kept', look.save('Priya.Raman', 'redwood', win), true);
T.eq('read back for you (any case), and as the last look here', [look.load('priya.raman', win), look.load('PRIYA.RAMAN', win), look.load('', win)].join(), 'redwood,redwood,redwood');
T.eq('someone else on this computer: their own (Current until they choose)', look.load('dana.cole', win), 'current');
look.save('dana.cole', 'current', win);
T.eq('their choice does not touch yours', [look.load('dana.cole', win), look.load('priya.raman', win), look.load('', win)].join(), 'current,redwood,current');
kept[look.KEY] = '{broken';
T.eq('a broken copy: Current', look.load('priya.raman', win), 'current');
kept[look.KEY] = '[1,2]';
T.eq('a copy of the wrong shape: Current', look.load('priya.raman', win), 'current');
T.eq('no storage (private mode): never throws', [look.save('x', 'redwood', { get localStorage() { throw new Error('no'); } }), look.load('x', {})].join(), 'false,current');

T.section('shown, and heard');
const attrs = {};
const doc = { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } };
const heard = [];
const stop = look.onChange((l) => heard.push(l));
look.apply('current', doc);
T.eq('shown as data-nx-look on the page\'s root', [attrs['data-nx-look'], look.current()].join(), 'current,current');
T.eq('the first look shown is not a change', heard.length, 0);
look.apply('redwood', doc);
look.apply('redwood', doc);
look.apply('nonsense', doc);
T.eq('a change is heard once; the same look again is not', heard.join(), 'redwood,current');
stop();
look.apply('redwood', doc);
T.eq('stopped listening: not heard', heard.join(), 'redwood,current');
look.onChange(() => { throw new Error('a broken screen'); });
T.eq('a listener that fails does not stop the look', look.apply('current', doc), 'current');

T.section('the stylesheet and the wiring');
const app = JSON.parse(fs.readFileSync(path.join(NEXT, 'app-flow.json'), 'utf8'));
const cssList = app.imports.css.filter((c) => /^resources\/css\/next/.test(c));
T.eq('the Redwood stylesheet is loaded after every other Next stylesheet', cssList[cssList.length - 1], 'resources/css/next-redwood.css');
const rw = fs.readFileSync(path.join(NEXT, 'resources', 'css', 'next-redwood.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = rw.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean).filter((x) => !/^\d|^from|^to/.test(x));
const loose = selectors.filter((sel) => sel.split(',').some((one) => !/^html\[data-nx-look="redwood"\]/.test(one.trim())));
T.eq('every Redwood rule speaks only for the Redwood look (Current is next.css untouched)', loose.join(' || '), '');
T.check('Oracle\'s page header colour and its own colour strip', /--nx-band: rgb\(44, 82, 102\)/.test(rw) && /oj-sp\/2601\.0\.3\/header-general-overview\/resources\/img\/colorstrip_redwood_2x\.webp/.test(rw));
T.check('the strip comes from the same oj-sp the app loads', (app.requirejs && JSON.stringify(app.requirejs).includes('oj-sp/2601.0.3/'))
  || JSON.stringify(app).includes('spectra-ui/oj-sp/2601.0.3/'));
T.check('Oracle\'s call-to-action button', /--rw-cta: rgb\(49, 45, 42\)/.test(rw) && /\.nx-btn--primary[^{]*\{[^}]*background: var\(--rw-cta\)/.test(rw));

const shellHtml = fs.readFileSync(path.join(NEXT, 'pages', 'shell-page.html'), 'utf8');
const shellJson = JSON.parse(fs.readFileSync(path.join(NEXT, 'pages', 'shell-page.json'), 'utf8'));
T.check('your menu offers the look, after the EquipRite version', shellHtml.indexOf('id="nxLooks"') > shellHtml.indexOf('id="nxVersionsLabel"')
  && /on-click="\[\[ \$listeners\.onLook \]\]"/.test(shellHtml));
T.check('the shell finds your look when it opens, and on a choice', shellJson.eventListeners.vbEnter.chains.some((c) => c.chain === 'lookChain')
  && shellJson.eventListeners.onLook.chains[0].chain === 'lookChain');
const reqHtml = fs.readFileSync(path.join(NEXT, 'flows', 'requests', 'pages', 'requests-page.html'), 'utf8');
const reqJson = JSON.parse(fs.readFileSync(path.join(NEXT, 'flows', 'requests', 'pages', 'requests-page.json'), 'utf8'));
T.check('Requests has no switch of its own any more', !/nx-uiswitch|reqUiSet|onUi\b/.test(reqHtml) && !reqJson.eventListeners.onUi && !reqJson.eventListeners.onUiSet);
T.check('Requests swaps to Oracle\'s page when the look changes', reqJson.eventListeners.lookChanged.chains[0].chain === 'setChain'
  && reqJson.eventListeners.lookChanged.chains[0].parameters.field === 'ui');
T.report();
