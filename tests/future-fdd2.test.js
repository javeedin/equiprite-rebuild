/*
 * EquipRite Future's FDD 2.0 screen (flows/fdd2): the menu item (Help, above the Guide, for every persona, built), its
 * tab, the page on the Future pattern (embeddable, every chain there, bindings VB accepts), its chains run against the
 * real store (the iframe's src set once, then only by a chapter's chip), the chapters as the document has them, and
 * Future's copies of the document (resources/fdd2), byte for byte the docs/fdd-v2 HTML and PDF. Loads the real modules.
 *
 * Run:  node tests/future-fdd2.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'webApps', 'equiprite-future');
const PAGE = path.join(APP, 'flows', 'fdd2', 'pages');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

// AMD modules of the app with their real dependencies ('resources/js/x' → webApps/equiprite-future/resources/js/x.js);
// VB's ActionChain is the one stand-in (a chain's run() is plain code on its context).
const mods = { 'vb/action/actionChain': class ActionChain {} };
function load(id) {
  if (mods[id]) return mods[id];
  const file = path.join(APP, id + '.js');
  const sandbox = { console, JSON, Math, Date, Object, Array, String, Number, Boolean, Error, URLSearchParams, setTimeout };
  sandbox.define = (deps, factory) => { mods[id] = factory(...deps.map(load)); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return mods[id];
}
const nav = load('resources/js/nav');
const tabs = load('resources/js/tabs');
const Seed = load('resources/js/future/fxSeed');
const store = load('resources/js/future/fxStore');
const fxShell = load('resources/js/future/fxShell');
const fxFdd2 = load('resources/js/future/fxFdd2');
const builder = require('../docs/fdd-v2/tools/build-fdd-v2');

T.section('the menu item');
const it = nav.item('fdd2');
T.eq('FDD 2.0: its label, tab and route (its own flow and page)', JSON.stringify([it.label, tabs.forItem('fdd2').title, it.route]), '["FDD 2.0","FDD 2.0",{"flow":"fdd2","page":"fdd2"}]');
T.eq('in Help, just above the Guide', nav.GROUPS.filter((g) => g.key === 'help')[0].items.map((i) => i.id).join(), 'fdd2,guide');
T.check('built (no "being built" dot)', it.built === true && nav.visibleGroups(['requester'], {}).filter((g) => g.key === 'help')[0].items[0].built === true);
T.check('visible to every persona, Admin too', Seed.PERSONAS.every((p) => nav.itemVisible(it, p.roles)), Seed.PERSONAS.filter((p) => !nav.itemVisible(it, p.roles)).map((p) => p.name).join());
T.eq('…for every role there is', nav.ROLES.filter((r) => it.roles.indexOf(r) === -1).join(), '');
const nextFdd = /id: 'fdd', label: 'EquipRite FDD', icon: '([\w-]+)'/.exec(read('webApps/equiprite-next/resources/js/nav.js'));
T.eq('a document icon: the one Next\'s FDD item uses (a Redwood icon font glyph; the browser test checks it draws)', it.icon, nextFdd && nextFdd[1]);
T.eq('opened by a link (?open=fdd2) as a tab of its own, with that icon', JSON.stringify([tabs.fromQuery('?open=fdd2').id, tabs.forItem('fdd2').icon, tabs.forItem('fdd2').pinned]),
  '["fdd2","oj-ux-ico-document-check",false]');
const allTabs = [tabs.forItem('work'), tabs.forItem('fdd2')];
T.check('playing someone else never closes it', Seed.PERSONAS.every((p) => fxShell.prune(allTabs, p.roles).keep.some((t) => t.id === 'fdd2')));

T.section('the flow and the page, on the Future pattern');
const flow = json('webApps/equiprite-future/flows/fdd2/fdd2-flow.json');
T.eq('flow fdd2: embeddable, its one page fdd2', JSON.stringify([flow.id, flow.navigation.embeddable, flow.defaultPage, flow.pages]),
  '["fdd2","enabled","fdd2",{"fdd2":{"path":"pages/fdd2-page"}}]');
const pj = json('webApps/equiprite-future/flows/fdd2/pages/fdd2-page.json');
T.eq('the page is embeddable', pj.navigation.embeddable, 'enabled');
T.eq('its variables: v (the view), src (the iframe\'s), chapter', Object.keys(pj.variables).map((k) => k + ':' + pj.variables[k].type).join(), 'v:any,src:string,chapter:number');
T.check('…v starts not ready, with the chapters list empty', pj.variables.v.defaultValue.ready === false && Array.isArray(pj.variables.v.defaultValue.chapters));
T.check('it hears the store: fxRefresh declared, loadChain on vbEnter and fxRefresh', pj.events.fxRefresh && pj.eventListeners.vbEnter.chains[0].chain === 'loadChain'
  && pj.eventListeners.fxRefresh.chains[0].chain === 'loadChain');
const named = [];
Object.values(pj.eventListeners).forEach((l) => l.chains.forEach((c) => named.push(c.chain)));
const chainFiles = fs.readdirSync(path.join(PAGE, 'fdd2-page-chains')).map((f) => f.replace(/\.js$/, ''));
T.eq('every chain it names exists', named.filter((c) => chainFiles.indexOf(c) === -1).join(), '');
T.eq('…and every chain there is named', chainFiles.filter((c) => named.indexOf(c) === -1).join(), '');
T.eq('the chains', chainFiles.sort().join(), 'actChain,chapterChain,loadChain,openChain');
T.eq('a chip\'s click: chapterChain with the chip\'s data', JSON.stringify(pj.eventListeners.onChapter), '{"chains":[{"chain":"chapterChain","parameters":{"data":"{{ $event.currentTarget.dataset }}"}}]}');
T.check('the module extends fx.Base (subscribed to the store)', /extends fx\.Base/.test(fs.readFileSync(path.join(PAGE, 'fdd2-page.js'), 'utf8')));
T.check('actChain acts through fxPage.act', /fx\.act\(/.test(fs.readFileSync(path.join(PAGE, 'fdd2-page-chains', 'actChain.js'), 'utf8')));
const html = fs.readFileSync(path.join(PAGE, 'fdd2-page.html'), 'utf8');
const bindings = html.match(/\[\[[\s\S]*?\]\]/g) || [];
T.eq('bindings VB accepts: no arrow functions, no String(), Number() or Boolean()', bindings.filter((b) => /=>|\bString\(|\bNumber\(|\bBoolean\(/.test(b)).join(' '), '');
T.eq('every listener it uses is declared', (html.match(/\$listeners\.(\w+)/g) || []).map((x) => x.split('.')[1]).filter((n) => !pj.eventListeners[n]).join(), '');
T.check('no $functions needed (nothing to look up)', !/\$functions\./.test(html));
T.check('nothing calls a server: no fetch, no REST', ['fdd2-page.html', 'fdd2-page.js', 'fdd2-page.json'].concat(chainFiles.map((c) => 'fdd2-page-chains/' + c + '.js'))
  .every((f) => !/\bfetch\(|callRest|eqp-v1|\/services\//.test(fs.readFileSync(path.join(PAGE, f), 'utf8'))));

T.section('what the page shows');
const text = (re) => { const m = re.exec(html); return m ? m[1].replace(/\s+/g, ' ').trim() : ''; };
T.eq('the band\'s kicker', text(/class="nx-kicker">([^<]+)</), 'Functional design · version 2.0 draft');
T.eq('…its title', text(/<h1>([^<]+)<\/h1>/), 'EquipRite FDD 2.0: many companies, many countries');
T.eq('…what it covers, in a line', text(/id="fdd2Sub">([^<]+)</), 'Requests by business unit, intercompany hire, how FleetCo bills ProjectCo, the accounting of each case, '
  + 'the rules for many countries, and the requirements this prototype is built from.');
T.check('Open full screen: the document (at the chapter shown) in a browser tab of its own', /<a class="nx-btn nx-btn--primary" id="fdd2Full" :href="\[\[ \$variables\.src \]\]" target="_blank" rel="noopener"/.test(html)
  && />Open full screen<\/a>/.test(html));
T.check('Download the PDF: a link with the download attribute', /<a class="nx-btn" id="fdd2Pdf" :href="\[\[ \$variables\.v\.pdf \]\]" download="EquipRite-FDD-v2\.pdf"/.test(html)
  && />Download the PDF<\/a>/.test(html));
T.check('a chip per chapter (v.chapters), the current one marked', /<oj-bind-for-each data="\[\[ \$variables\.v\.chapters \]\]">/.test(html)
  && /'nx-chip fx-fdd2-chip' \+ \(c\.data\.n === \$variables\.chapter \? ' nx-chip--on' : ''\)/.test(html) && /:data-n="\[\[ c\.data\.n \]\]"/.test(html)
  && /on-click="\[\[ \$listeners\.onChapter \]\]"/.test(html));
T.eq('the note under the chips', text(/id="fdd2Note">[\s\S]*?<span>([\s\S]*?)<button/) + ' ' + text(/id="fdd2Guide"[^>]*>([^<]+)</),
  'Future is the working prototype of this document: try each scenario from the Guide');
T.check('…whose link opens the Guide through openChain', /id="fdd2Guide" data-nav="guide" on-click="\[\[ \$listeners\.onOpen \]\]"/.test(html) && nav.item('guide'));
T.check('the document in an iframe: its src the page variable, a title for screen readers', /<iframe class="fx-fdd2-frame" id="fdd2Frame" :src="\[\[ \$variables\.src \]\]" title="[^"]+"/.test(html));
const css = read('webApps/equiprite-future/resources/css/future-fdd2.css');
T.check('its stylesheet, registered with the others', json('webApps/equiprite-future/app-flow.json').imports.css.indexOf('resources/css/future-fdd2.css') !== -1);
const frameRule = (/\.fx-fdd2-frame \{([^}]*)\}/.exec(css) || ['', ''])[1];
T.check('…the frame: full width, no border, filling the rest of the tab, never under 600 px', /border: 0;/.test(frameRule) && /min-height: 600px;/.test(frameRule)
  && /flex: 1 0 auto;/.test(frameRule) && /width: calc\(100% \+ 2 \* var\(--nx-pad-x\)\)/.test(frameRule) && /min-height: var\(--fx-fdd2-tab\)/.test(css)
  && /--fx-fdd2-tab: calc\(100vh - var\(--nx-top-h\) - var\(--fx-banner-h\) - var\(--nx-tab-h\)\)/.test(css));

T.section('the chapters: the document\'s own');
T.eq('fifteen chips, in words a person scans', fxFdd2.CHAPTERS.map((c) => c.label).join(', '),
  'Why version 2, The model in one page, Scenario 1, Scenario 2, Scenario 3, How FleetCo bills ProjectCo, Accounting entries, More scenarios, Many countries, '
  + 'Requirements, Data model, Integrations and setup, Decisions needed, Today and the plan, Glossary');
T.eq('…each titled as the document titles it (its builder\'s CHAPTERS)', JSON.stringify(fxFdd2.TITLES), JSON.stringify(builder.CHAPTERS));
T.eq('…ids c1..c15, the whole title on hover', [fxFdd2.CHAPTERS.map((c) => c.id).join(), fxFdd2.CHAPTERS[2].title].join(' | '),
  'c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11,c12,c13,c14,c15 | 3. Scenario 1: internal project');
const FUTURE_HTML = path.join(APP, 'resources', 'fdd2', 'EquipRite-FDD-v2.html');
const FUTURE_PDF = path.join(APP, 'resources', 'fdd2', 'EquipRite-FDD-v2.pdf');
const docHtml = fs.readFileSync(FUTURE_HTML, 'utf8');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
T.eq('every chapter id is in the document, headed with its title', fxFdd2.CHAPTERS.filter((c) => docHtml.indexOf('<section class="chapter" id="' + c.id + '"><h2><span class="n">' + c.n + '</span>'
  + esc(fxFdd2.TITLES[c.n - 1]) + '</h2>') === -1).map((c) => c.id).join(), '');
T.eq('…and no other', (docHtml.match(/<section class="chapter" id="c\d+">/g) || []).length, 15);

T.section('the document\'s address');
T.eq('src: the document under the app\'s path, at a chapter or its cover', [fxFdd2.src('version_1/', 6), fxFdd2.src('version_1/', 0), fxFdd2.src('/app/version_1', 15), fxFdd2.src('', 99)].join(' | '),
  'version_1/resources/fdd2/EquipRite-FDD-v2.html#c6 | version_1/resources/fdd2/EquipRite-FDD-v2.html | /app/version_1/resources/fdd2/EquipRite-FDD-v2.html#c15 | resources/fdd2/EquipRite-FDD-v2.html');
T.eq('a chip\'s data-n as a chapter (0: none)', [fxFdd2.chapterOf({ n: '6' }), fxFdd2.chapterOf({ n: '16' }), fxFdd2.chapterOf({}), fxFdd2.chapterOf(null)].join(), '6,0,0,0');
const d = fxFdd2.doc('version_1/');
T.eq('the links', [d.html, d.pdf, d.pdfName].join(' | '), 'version_1/resources/fdd2/EquipRite-FDD-v2.html | version_1/resources/fdd2/EquipRite-FDD-v2.pdf | EquipRite-FDD-v2.pdf');

T.section('the chains, on the real store');
store.reset();
const ctx = { $application: { path: 'version_1/' }, $page: { variables: { v: pj.variables.v.defaultValue, src: '', chapter: 0 } } };
const runChain = (name, args) => new (load('flows/fdd2/pages/fdd2-page-chains/' + name))().run(ctx, args || {});
(async () => {
  await runChain('loadChain');
  const vars = ctx.$page.variables;
  T.eq('loadChain: who is played, the chapters and the links; the frame on the cover', JSON.stringify([vars.v.ready, vars.v.error, vars.v.name, vars.v.chapters.length, vars.v.pdf, vars.src]),
    '[true,"","Priya Raman",15,"version_1/resources/fdd2/EquipRite-FDD-v2.pdf","version_1/resources/fdd2/EquipRite-FDD-v2.html"]');
  await runChain('chapterChain', { data: { n: '6' } });
  T.eq('chapterChain (How FleetCo bills ProjectCo): the chip marked, the frame at #c6', [vars.chapter, vars.src].join(' | '), '6 | version_1/resources/fdd2/EquipRite-FDD-v2.html#c6');
  await runChain('chapterChain', { data: {} });
  T.eq('…a click that names no chapter changes nothing', [vars.chapter, vars.src.slice(-3)].join(), '6,#c6');
  const firstV = vars.v;
  store.act('setPersona', { id: 'p-em' });
  store.act('advance', { days: 1 });
  await runChain('loadChain');
  T.eq('the store changed (another persona, the clock): v follows, the frame stays at chapter 6', [vars.v.name, vars.v !== firstV, vars.chapter, vars.src.slice(-3)].join(), 'Ana Costa,true,6,#c6');
  store.reset();

  T.section('the frame itself (fxFdd2.show and hold)');
  const scrolled = [];
  const win = { pageYOffset: 300, scrollTo: (x, y) => scrolled.push(y), document: { body: {}, location: { href: 'http://x/resources/fdd2/EquipRite-FDD-v2.html' },
    getElementById: (id) => (id === 'c6' ? { getBoundingClientRect: () => ({ top: 1200 }) } : null) } };
  const box = { scrollTop: 40 };
  const frame = { contentWindow: win, closest: (sel) => (sel === '.nx-content' ? box : null) };
  T.check('show: the frame\'s own window scrolls to the chapter', fxFdd2.show(frame, 6) === true && scrolled.pop() === 1500);
  T.check('…to its top for the cover; false when the chapter or the document is not there', fxFdd2.show(frame, 0) === true && scrolled.pop() === 0
    && fxFdd2.show(frame, 9) === false && fxFdd2.show({ contentWindow: null }, 6) === false);
  const later = [];
  const go = fxFdd2.hold(frame, (fn) => later.push(fn));
  box.scrollTop = 102; // the browser following #c6 scrolled the tab too
  go(6);
  later.forEach((fn) => fn());
  T.eq('hold: the tab is put back where it was and the frame is at the chapter', [box.scrollTop, scrolled.pop(), later.length].join(), '40,1500,2');

  T.section('Future\'s copies of the document never drift');
  const docsHtml = path.join(ROOT, 'docs', 'fdd-v2', 'EquipRite-FDD-v2-Multi-Company.html');
  const docsPdf = path.join(ROOT, 'docs', 'fdd-v2', 'EquipRite-FDD-v2-Multi-Company.pdf');
  T.check('the HTML: byte for byte docs/fdd-v2\'s', fs.readFileSync(FUTURE_HTML).equals(fs.readFileSync(docsHtml)));
  T.check('the PDF: byte for byte docs/fdd-v2\'s', fs.readFileSync(FUTURE_PDF).equals(fs.readFileSync(docsPdf)));
  T.check('…and the HTML is what the builder renders now', builder.render() === docHtml);
  T.eq('the builder writes both copies there', [path.relative(ROOT, builder.FUTURE_HTML), path.relative(ROOT, builder.FUTURE_PDF)].join(' | ').replace(/\\/g, '/'),
    'webApps/equiprite-future/resources/fdd2/EquipRite-FDD-v2.html | webApps/equiprite-future/resources/fdd2/EquipRite-FDD-v2.pdf');
  const src = read('docs/fdd-v2/tools/build-fdd-v2.js');
  T.check('…with the PDF and with --no-pdf alike', /if \(process\.argv\.includes\('--no-pdf'\)\) return copyToFuture\(\);/.test(src) && /\n  copyToFuture\(\);\n\}/.test(src));
  const built = path.join(ROOT, 'build', 'processed', 'webApps', 'equiprite-future');
  const version = fs.existsSync(built) ? fs.readdirSync(built).filter((f) => /^version_/.test(f))[0] : null;
  if (version) {
    const b = path.join(built, version, 'resources', 'fdd2');
    T.check('npm run build ships them (build/processed/…/resources/fdd2)', fs.existsSync(path.join(b, 'EquipRite-FDD-v2.html')) && fs.existsSync(path.join(b, 'EquipRite-FDD-v2.pdf'))
      && fs.readFileSync(path.join(b, 'EquipRite-FDD-v2.pdf')).equals(fs.readFileSync(FUTURE_PDF)));
  } else {
    console.log('  (no build/processed: run npm run build to check the built copies)');
  }
  T.report();
})().catch((e) => { T.check('ran', false, e.stack); T.report(); });
