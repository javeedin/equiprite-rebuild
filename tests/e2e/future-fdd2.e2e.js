'use strict';
/*
 * EquipRite Future's FDD 2.0 screen in a real browser: the menu item (Help, above the Guide) for Priya and for Ana, its
 * tab with the page-head band, the document in its frame (its cover, the four flow diagrams, the journal explorer
 * recomputing), a chapter's chip bringing that chapter into view, Open full screen (a browser tab of its own), the
 * PDF's link answering 200, the Guide's link, the frame left alone when the store changes, no sideways scroll, no
 * browser errors and no backend call. Needs `npm run build`.
 * Run: node tests/e2e/future-fdd2.e2e.js
 */
const fs = require('fs');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const PDF_FILE = path.join(E.ROOT, 'webApps', 'equiprite-future', 'resources', 'fdd2', 'EquipRite-FDD-v2.pdf');

(async () => {
  const env = await E.start({ port: 19650, app: 'future' });
  const { page } = env;
  const menu = () => page.$$eval('.nx-nav-item', (b) => b.map((x) => x.dataset.navId).join(' '));
  const helpGroup = () => page.$$eval('.nx-nav-group[data-group="help"] .nx-nav-item', (b) => b.map((x) => x.innerText.trim()).join(' | '));
  const currentTab = () => page.$eval('.nx-tab--on', (t) => t.dataset.tabId);
  const playAs = async (id, name) => {
    await page.click('#fxPersona');
    await page.waitForSelector('#fxPersonaPanel');
    await page.click(`#fxPersonaPanel .fx-person[data-id="${id}"]`);
    await page.waitForFunction((n) => { const e = document.getElementById('fxPersonaName'); return e && e.innerText.trim() === n; }, name, { timeout: 10000 });
    await page.waitForTimeout(400);
  };
  const doc = () => page.frame({ url: /resources\/fdd2\/EquipRite-FDD-v2\.html/ });
  const chapterTop = (n) => doc().$eval('#c' + n, (e) => Math.round(e.getBoundingClientRect().top));
  const tabScroll = () => page.$eval('.nx-content', (c) => c.scrollTop);
  const noToast = async () => { if (await page.$('#nxToast button')) await page.click('#nxToast button'); };
  try {
    T.section('the menu: FDD 2.0 in Help, above the Guide, for everyone');
    await env.open('/');
    await page.waitForSelector('#page-work', { timeout: 30000 });
    T.eq('Priya (ProjectCo, Project Manager): FDD 2.0 then the Guide, last', await menu(), 'work requests new-request site charges billing reports setup fdd2 guide');
    T.eq('…the Help group', await helpGroup(), 'FDD 2.0 | Guide: the end-to-end story');
    T.check('…built (no "being built" dot)', !(await page.$('.nx-nav-item[data-nav-id="fdd2"] .nx-nav-soon')));
    const icon = await page.$eval('.nx-nav-item[data-nav-id="fdd2"] .nx-nav-icon', (e) => {
      const s = getComputedStyle(e, '::before');
      return { cls: e.className, content: s.content, font: s.fontFamily, w: e.getBoundingClientRect().width };
    });
    T.check('…with a document icon that draws (a glyph of the Redwood icon font)', /oj-ux-ico-document-check/.test(icon.cls) && icon.content && icon.content !== 'none'
      && icon.content !== 'normal' && icon.content !== '""' && /ojuxIconFont/.test(icon.font) && icon.w > 0, JSON.stringify(icon));
    await playAs('p-em', 'Ana Costa');
    T.eq('Ana (FleetCo, Equipment Manager) has it too', await menu(), 'work approvals yard reports setup fdd2 guide');
    await playAs('p-pm', 'Priya Raman');

    T.section('its tab: the band and the document');
    await page.click('.nx-nav-item[data-nav-id="fdd2"]');
    await page.waitForSelector('#page-fdd2 #fdd2Frame', { timeout: 30000 });
    T.eq('a tab "FDD 2.0", shown', [await currentTab(), await page.$eval('.nx-tab--on', (t) => t.innerText.trim())].join(' | '), 'fdd2 | FDD 2.0');
    T.check('…with the document icon', await page.$eval('.nx-tab--on .nx-tab-icon', (e) => e.classList.contains('oj-ux-ico-document-check')));
    T.eq('the band: kicker and title', [await env.text('#page-fdd2 .nx-pagehead .nx-kicker'), await env.text('#page-fdd2 .nx-pagehead h1')].join(' | '),
      'FUNCTIONAL DESIGN · VERSION 2.0 DRAFT | EquipRite FDD 2.0: many companies, many countries');
    T.eq('…what it covers, in a line', await env.text('#fdd2Sub'), 'Requests by business unit, intercompany hire, how FleetCo bills ProjectCo, the accounting of each case, '
      + 'the rules for many countries, and the requirements this prototype is built from.');
    T.eq('…and its two buttons', await page.$$eval('#page-fdd2 .nx-pagehead .nx-actions .nx-btn', (b) => b.map((x) => x.innerText.trim()).join(' | ')), 'Open full screen | Download the PDF');
    T.eq('a chip per chapter, in the document\'s order', await page.$$eval('#fdd2Chapters .fx-fdd2-chip', (c) => c.map((x) => x.dataset.n + ' ' + x.querySelector('.fx-fdd2-chip-label').innerText.trim()).join(', ')),
      '1 Why version 2, 2 The model in one page, 3 Scenario 1, 4 Scenario 2, 5 Scenario 3, 6 How FleetCo bills ProjectCo, 7 Accounting entries, 8 More scenarios, '
      + '9 Many countries, 10 Requirements, 11 Data model, 12 Integrations and setup, 13 Decisions needed, 14 Today and the plan, 15 Glossary');
    T.eq('…a scenario\'s chip says the whole title on hover', await page.getAttribute('.fx-fdd2-chip[data-n="3"]', 'title'), '3. Scenario 1: internal project');
    T.eq('the note under the chips', await env.text('#fdd2Note'), 'Future is the working prototype of this document: try each scenario from the Guide.');

    T.section('the document in its frame');
    await page.waitForFunction(() => { const f = document.getElementById('fdd2Frame'); const d = f && f.contentDocument; return d && d.readyState === 'complete' && d.querySelector('h1'); },
      null, { timeout: 15000 });
    T.check('the frame shows the document, titled for a screen reader', /resources\/fdd2\/EquipRite-FDD-v2\.html$/.test(await page.getAttribute('#fdd2Frame', 'src'))
      && /FDD 2\.0/.test(await page.getAttribute('#fdd2Frame', 'title')));
    T.eq('its cover', await doc().$eval('h1', (h) => h.innerText.trim()), 'EquipRite: many companies, many countries');
    T.eq('its four flow diagrams', await doc().$$eval('svg.fdd-svg', (s) => s.length), 4);
    T.eq('its fifteen chapters', await doc().$$eval('section.chapter', (s) => s.map((x) => x.id).join()), 'c1,c2,c3,c4,c5,c6,c7,c8,c9,c10,c11,c12,c13,c14,c15');
    await noToast();
    await env.shot('future-fdd2.png');
    const icTile = () => doc().$$eval('#jx-out .kpis > div', (d) => d.filter((x) => x.querySelector('span').innerText.trim() === 'IC invoice')
      .map((x) => x.querySelector('b').innerText.trim()).join());
    T.eq('the journal explorer: the IC invoice at the document\'s rate (4 weeks × 1,000 + 600 transport + 5 % VAT)', await icTile(), '4,830');
    await doc().fill('#jx input[data-k="icRate"]', '1200');
    await doc().waitForFunction(() => [].some.call(document.querySelectorAll('#jx-out .kpis > div'), (x) => x.innerText.indexOf('5,670') !== -1), null, { timeout: 5000 });
    T.eq('…IC rate / week 1,200: the IC invoice reads 5,670', await icTile(), '5,670');
    const frame = await page.$eval('#fdd2Frame', (f) => { const r = f.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, w: r.width, border: getComputedStyle(f).borderTopWidth }; });
    const content = await page.$eval('.nx-content', (c) => { const r = c.getBoundingClientRect(); return { bottom: r.bottom, w: c.clientWidth }; });
    T.check('the frame fills the rest of the tab: full width, no border, at least 600 px high, down to the tab\'s foot',
      frame.h >= 600 && Math.abs(frame.w - content.w) <= 1 && frame.border === '0px' && frame.bottom >= content.bottom - 1, JSON.stringify([frame, content]));

    T.section('a chapter\'s chip brings that chapter into view');
    const before = await tabScroll();
    await page.click('.fx-fdd2-chip[data-n="6"]');
    await page.waitForFunction(() => /#c6$/.test(document.getElementById('fdd2Frame').getAttribute('src')), null, { timeout: 5000 });
    await page.waitForTimeout(400);
    T.eq('How FleetCo bills ProjectCo: the frame\'s src is the document at #c6', (await page.getAttribute('#fdd2Frame', 'src')).replace(/^.*\//, ''), 'EquipRite-FDD-v2.html#c6');
    const top6 = await chapterTop(6);
    T.check('…chapter 6 at the top of the frame', top6 >= -2 && top6 <= 40, String(top6));
    T.eq('…its heading', await doc().$eval('#c6 h2', (h) => h.innerText.replace(/\s+/g, ' ').trim()), '6How FleetCo bills ProjectCo');
    T.eq('…its chip marked, and only it', await page.$$eval('#fdd2Chapters .nx-chip--on', (c) => c.map((x) => x.dataset.n + ':' + x.getAttribute('aria-current')).join()), '6:true');
    T.eq('…the tab around the frame did not move (the chips stay in sight)', await tabScroll(), before);
    T.eq('…the document was not reloaded (the explorer keeps 1,200)', await doc().$eval('#jx input[data-k="icRate"]', (i) => i.value), '1200');
    await noToast();
    await env.shot('future-fdd2-chapter6.png');
    await doc().evaluate(() => window.scrollTo(0, 0));
    await page.click('.fx-fdd2-chip[data-n="6"]');
    await page.waitForTimeout(500);
    const again = await chapterTop(6);
    T.check('clicked again after reading elsewhere: back at chapter 6', again >= -2 && again <= 40, String(again));
    await page.click('.fx-fdd2-chip[data-n="15"]');
    await page.waitForTimeout(500);
    const top15 = await chapterTop(15);
    T.check('the Glossary: chapter 15 in view', top15 >= -2 && top15 < 300, String(top15));
    T.eq('…its chip marked now', await page.$$eval('#fdd2Chapters .nx-chip--on', (c) => c.map((x) => x.dataset.n).join()), '15');
    T.eq('Open full screen opens the chapter shown', (await page.getAttribute('#fdd2Full', 'href')).replace(/^.*\//, ''), 'EquipRite-FDD-v2.html#c15');

    T.section('the store changes, the document stays');
    await page.click('#fxDay');
    await page.waitForFunction(() => document.getElementById('fxToday').innerText.trim() === 'Tue 3 Nov 2026', null, { timeout: 5000 });
    await page.waitForTimeout(400);
    T.eq('+1 day: same chapter, same frame (the explorer still 1,200)', [(await page.getAttribute('#fdd2Frame', 'src')).replace(/^.*\//, ''),
      await doc().$eval('#jx input[data-k="icRate"]', (i) => i.value)].join(' | '), 'EquipRite-FDD-v2.html#c15 | 1200');

    T.section('Open full screen, Download the PDF');
    T.eq('Open full screen: a browser tab of its own', [await page.getAttribute('#fdd2Full', 'target'), await page.getAttribute('#fdd2Full', 'rel')].join(), '_blank,noopener');
    const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 10000 }), page.click('#fdd2Full')]);
    await popup.waitForLoadState('load');
    T.eq('…the document, full screen', [await popup.title(), popup.url().replace(/^.*\//, '')].join(' | '), 'EquipRite FDD v2.0: many companies, many countries | EquipRite-FDD-v2.html#c15');
    await popup.close();
    const pdf = await page.$eval('#fdd2Pdf', (a) => ({ href: a.href, download: a.getAttribute('download') }));
    T.check('Download the PDF: a link to the PDF, downloaded as EquipRite-FDD-v2.pdf', /\/resources\/fdd2\/EquipRite-FDD-v2\.pdf$/.test(pdf.href) && pdf.download === 'EquipRite-FDD-v2.pdf', JSON.stringify(pdf));
    const res = await page.request.get(pdf.href);
    const body = await res.body();
    T.eq('…its request answers 200 with the PDF itself', [res.status(), body.slice(0, 5).toString(), body.length].join(), [200, '%PDF-', fs.statSync(PDF_FILE).size].join());

    T.section('the Guide, from the note');
    await page.click('#fdd2Guide');
    await page.waitForFunction(() => { const t = document.querySelector('.nx-tab--on'); return t && t.dataset.tabId === 'guide'; }, null, { timeout: 10000 });
    T.check('the Guide opens in its tab', true);
    await page.click('.nx-tab-btn[data-id="fdd2"]');
    await page.waitForTimeout(300);

    T.section('fits the window');
    for (const w of [1440, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(400);
      const fit = await page.evaluate(() => {
        const c = document.querySelector('.nx-content');
        const f = document.getElementById('fdd2Frame').getBoundingClientRect();
        return { page: document.documentElement.scrollWidth <= document.documentElement.clientWidth, tab: c.scrollWidth <= c.clientWidth + 1,
          frame: f.right <= c.getBoundingClientRect().right + 1, h: f.height };
      });
      T.check(`${w}px: no sideways scroll, the frame inside the tab, at least 600 px high`, fit.page && fit.tab && fit.frame && fit.h >= 600, JSON.stringify(fit));
    }
    await noToast();
    await env.shot('future-fdd2-1024.png');
    await page.setViewportSize({ width: 1440, height: 1000 });

    T.section('runs on the store alone');
    T.eq('no call to any backend', env.calls.join('\n'), '');
    T.eq('no browser errors or warnings', env.errors.join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.message);
    await env.shot('future-fdd2-failed.png').catch(() => {});
  } finally {
    await env.close();
    T.report();
  }
})();
