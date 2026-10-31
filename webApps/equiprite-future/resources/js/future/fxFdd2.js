define([], function () {
  'use strict';

  /**
   * FDD 2.0 (flows/fdd2): where Future keeps the document and its chapters. The copies in resources/fdd2 are written by
   * the document's builder (node docs/fdd-v2/tools/build-fdd-v2.js), byte for byte the docs/fdd-v2 HTML and PDF.
   * The chapters are the builder's CHAPTERS, each a <section id="c<n>"> in the HTML; a chip shows the words before
   * the colon ("Scenario 1"), its tooltip the whole title. Pure, apart from show(), which scrolls the frame.
   */
  var HTML = 'resources/fdd2/EquipRite-FDD-v2.html';
  var PDF = 'resources/fdd2/EquipRite-FDD-v2.pdf';
  var PDF_NAME = 'EquipRite-FDD-v2.pdf';

  var TITLES = ['Why version 2', 'The model in one page', 'Scenario 1: internal project', 'Scenario 2: customer project',
    'Scenario 3: FleetCo rents to its customer', 'How FleetCo bills ProjectCo', 'Accounting entries', 'More scenarios', 'Many countries',
    'Requirements', 'Data model', 'Integrations and setup', 'Decisions needed', 'Today and the plan', 'Glossary'];

  var CHAPTERS = TITLES.map(function (t, i) {
    return { n: i + 1, id: 'c' + (i + 1), label: t.split(':')[0], title: (i + 1) + '. ' + t };
  });

  /** The application's path ($application.path, '' or ending in '/') with a resource after it. */
  function url(base, rel) {
    var b = base || '';
    if (b && b.charAt(b.length - 1) !== '/') b += '/';
    return b + rel;
  }

  /** The iframe's src: the document, at chapter n (1..15) or at its cover (0). */
  function src(base, n) {
    var k = parseInt(n, 10);
    return url(base, HTML) + (k >= 1 && k <= CHAPTERS.length ? '#c' + k : '');
  }

  /** The chapter a clicked chip names (its data-n), or 0 when it names none. */
  function chapterOf(data) {
    var k = parseInt((data || {}).n, 10);
    return k >= 1 && k <= CHAPTERS.length ? k : 0;
  }

  /** The screen's words and links, for loadChain (v). */
  function doc(base) {
    return { chapters: CHAPTERS, html: url(base, HTML), pdf: url(base, PDF), pdfName: PDF_NAME };
  }

  /**
   * Scrolls the frame's own window to chapter n (or its top for 0), for a chip clicked again after the reader moved
   * on: the src is then unchanged, so the frame would not move by itself. Only the frame scrolls, not the tab around
   * it. False when the document is not there yet (the src's #c<n> takes it there once it loads).
   */
  function show(frame, n) {
    try {
      var w = frame && frame.contentWindow;
      var d = w && w.document;
      if (!d || !d.body || (d.location && /^about:/.test(String(d.location.href)))) return false;
      if (!n) { w.scrollTo(0, 0); return true; }
      var el = d.getElementById('c' + n);
      if (!el) return false;
      w.scrollTo(0, el.getBoundingClientRect().top + (w.pageYOffset || 0));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Before a chip sets the src: notes where the tab around the frame is scrolled, and returns go(n), which (once the
   * frame has had time to follow its new #c<n>) puts the tab back there and scrolls the frame to chapter n. A browser
   * following an iframe's #c<n> may scroll the page holding it too, which would take the chips away. `later` is
   * setTimeout in the browser.
   */
  function hold(frame, later) {
    var box = frame && typeof frame.closest === 'function' ? frame.closest('.nx-content') : null;
    var top = box ? box.scrollTop : 0;
    var wait = later || (typeof setTimeout === 'function' ? setTimeout : null);
    return function go(n) {
      function settle() {
        if (box && box.scrollTop !== top) box.scrollTop = top;
        show(frame, n);
      }
      if (!wait) { settle(); return; }
      wait(settle, 40);
      wait(settle, 220);
    };
  }

  return { HTML: HTML, PDF: PDF, PDF_NAME: PDF_NAME, TITLES: TITLES, CHAPTERS: CHAPTERS, url: url, src: src, chapterOf: chapterOf, doc: doc, show: show, hold: hold };
});
