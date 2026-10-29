'use strict';

/**
 * Exports the redesign wireframes (docs/redesign/wireframes/source, the Design canvas files) to plain files that
 * open without the canvas:
 *   wireframes/html/<Board>.html          one static page per board, no scripts, links between boards kept
 *   wireframes/html/index.html            every board, grouped like the canvas pages
 *   EquipRite-Redesign-Wireframes.pdf     a cover with contents, then one page per board in canvas order
 *
 * The boards are Design canvas components: an <x-dc> template, a <helmet> for head content, a Component class whose
 * renderVals() feeds {{…}} placeholders, <sc-for>/<sc-if> blocks and <dc-import> of other boards (AppHeader,
 * SideNav). The canvas renders them with its own support.js, which isn't shipped here, so this serves the folder
 * with a small runtime of its own at ./support.js, lets Chromium render each board, and saves the result.
 *
 * Run: node docs/redesign/tools/export-wireframes.js   (needs playwright and Chromium; pdfunite for the PDF)
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const REDESIGN_DIR = path.join(__dirname, '..');
const SOURCE_DIR = path.join(REDESIGN_DIR, 'wireframes', 'source');
const HTML_DIR = path.join(REDESIGN_DIR, 'wireframes', 'html');
const PDF_FILE = path.join(REDESIGN_DIR, 'EquipRite-Redesign-Wireframes.pdf');
const CANVAS_URL = 'https://claude.ai/artifact/KPvPbWuSGpWcJ4VTXYBpEU';

/**
 * Runs in the page in place of the canvas's support.js. Renders <x-dc> into plain DOM, then sets
 * <html data-dc-ready>. Only what the boards use: {{expr}} in text and attributes, <sc-for list as>, <sc-if value>,
 * <dc-import name …props>; hint-* attributes are dropped.
 */
const RUNTIME = `(() => {
  class DCLogic { constructor(props) { this.props = props; } renderVals() { return {}; } }
  const one = /^\\s*\\{\\{([\\s\\S]+?)\\}\\}\\s*$/;
  const evaluate = (expr, scope) => new Function(...Object.keys(scope), 'return (' + expr + ');')(...Object.values(scope));
  const fill = (text, scope) => text.replace(/\\{\\{([\\s\\S]+?)\\}\\}/g, (m, e) => { const v = evaluate(e, scope); return v == null ? '' : String(v); });
  const value = (text, scope) => { const m = one.exec(text || ''); return m ? evaluate(m[1], scope) : fill(text || '', scope); };

  // A board's template, its helmet and its Component, rendered with the given attribute props.
  async function renderBoard(doc, attrs) {
    const xdc = doc.querySelector('x-dc');
    const helmet = xdc.querySelector(':scope > helmet');
    if (helmet) {
      [...helmet.childNodes].forEach((n) => document.head.appendChild(document.importNode(n, true)));
      helmet.remove();
    }
    const script = doc.querySelector('script[data-dc-script]');
    const declared = script ? JSON.parse(script.dataset.props || '{}') : {};
    const props = {};
    Object.keys(declared).filter((k) => !k.startsWith('$')).forEach((k) => { props[k] = declared[k].default; });
    Object.assign(props, attrs);
    const Component = script ? new Function('DCLogic', script.textContent + '\\nreturn Component;')(DCLogic) : DCLogic;
    const vals = new Component(props).renderVals() || {};
    const out = document.createDocumentFragment();
    for (const n of [...xdc.childNodes]) await render(n, vals, out);
    return out;
  }

  async function render(node, scope, parent) {
    if (node.nodeType === 3) return parent.appendChild(document.createTextNode(fill(node.data, scope)));
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-for') {
      const as = node.getAttribute('as');
      for (const item of value(node.getAttribute('list'), scope) || []) {
        for (const c of [...node.childNodes]) await render(c, Object.assign({}, scope, { [as]: item }), parent);
      }
      return;
    }
    if (tag === 'sc-if') {
      if (value(node.getAttribute('value'), scope)) for (const c of [...node.childNodes]) await render(c, scope, parent);
      return;
    }
    if (tag === 'dc-import') {
      const attrs = {};
      [...node.attributes].filter((a) => a.name !== 'name' && !a.name.startsWith('hint-'))
        .forEach((a) => { attrs[a.name] = value(a.value, scope); });
      const text = await (await fetch(node.getAttribute('name') + '.dc.html')).text();
      return parent.appendChild(await renderBoard(new DOMParser().parseFromString(text, 'text/html'), attrs));
    }
    // localName, not tagName: an upper-case "TABLE" would be an unknown inline element, not a table.
    const el = node.namespaceURI === 'http://www.w3.org/1999/xhtml'
      ? document.createElement(node.localName)
      : document.createElementNS(node.namespaceURI, node.localName);
    for (const a of node.attributes) if (!a.name.startsWith('hint-')) el.setAttribute(a.name, fill(a.value, scope));
    for (const c of [...node.childNodes]) await render(c, scope, el);
    parent.appendChild(el);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const xdc = document.querySelector('x-dc');
    const out = await renderBoard(document, {});
    xdc.replaceWith(out);
    document.documentElement.dataset.dcReady = '1';
  });
})();`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript' };

// Serves SOURCE_DIR, with RUNTIME as support.js.
function serve() {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    if (name === 'support.js') {
      res.writeHead(200, { 'content-type': TYPES['.js'] });
      return res.end(RUNTIME);
    }
    const file = path.join(SOURCE_DIR, path.basename(name));
    fs.readFile(file, (err, data) => {
      res.writeHead(err ? 404 : 200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(err ? 'Not found' : data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Boards in canvas order, grouped by canvas page: [{ page, boards: [{ file, title, w, h }] }]
function contents(canvas) {
  return canvas.pages.map((p) => ({
    page: p.name,
    boards: canvas.order.filter((f) => canvas.boards[f].page === p.id).map((f) => Object.assign({ file: f }, canvas.boards[f])),
  })).filter((g) => g.boards.length);
}

const PAGE_STYLE = `body{margin:0;background:#f8fafc;color:#111827;font-family:'Source Sans 3',system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:48px 40px}h1{font-size:40px;margin:0 0 8px}h2{font-size:20px;margin:28px 0 8px}
p{color:#475569;margin:4px 0}ol,ul{margin:0;padding-left:22px;line-height:1.7}a{color:#1d4ed8}
.band{display:flex;height:8px;margin:20px 0}.band span{flex:1}`;
const BAND = '<div class="band" aria-hidden="true"><span style="background:#c74634"></span><span style="background:#e5a22f"></span>'
  + '<span style="background:#6f9a3a"></span><span style="background:#2b8cbe"></span><span style="background:#6b4fa3"></span></div>';
const HEAD = '<meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&amp;display=swap" rel="stylesheet">';

function indexPage(groups) {
  const list = groups.map((g) => `<h2>${escape(g.page)}</h2><ul>${g.boards.map((b) =>
    `<li><a href="${escape(b.file.replace(/\.dc\.html$/, '.html'))}">${escape(b.title)}</a></li>`).join('')}</ul>`).join('');
  return `<!doctype html><html lang="en"><head>${HEAD}<title>EquipRite redesign wireframes</title><style>${PAGE_STYLE}</style></head>
<body><main><h1>EquipRite redesign wireframes</h1><p>v1 from FDD v1.7. All data on the screens is illustrative.</p>
<p>Live canvas: <a href="${CANVAS_URL}">${CANVAS_URL}</a> · PDF: <a href="../../EquipRite-Redesign-Wireframes.pdf">EquipRite-Redesign-Wireframes.pdf</a></p>
${BAND}${list}</main></body></html>`;
}

function coverPage(groups) {
  let n = 1;
  const list = groups.map((g) => `<h2>${escape(g.page)}</h2><ul style="list-style:none;padding:0">${g.boards.map((b) =>
    `<li>${escape(b.title)} <span style="color:#64748b">· page ${++n}</span></li>`).join('')}</ul>`).join('');
  return `<!doctype html><html lang="en"><head>${HEAD}<style>${PAGE_STYLE}</style></head>
<body><main><h1>EquipRite redesign wireframes</h1><p>v1 from FDD v1.7 · illustrative data · 29 Oct 2026</p>
<p>Live canvas: ${CANVAS_URL}</p>${BAND}${list}</main></body></html>`;
}

async function main() {
  const canvas = JSON.parse(fs.readFileSync(path.join(SOURCE_DIR, 'canvas.json'), 'utf8'));
  const groups = contents(canvas);
  const boards = groups.flatMap((g) => g.boards);
  fs.mkdirSync(HTML_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wireframes-'));
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const pdfs = [];
  try {
    const page = await browser.newPage();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.setContent(coverPage(groups), { waitUntil: 'networkidle' });
    pdfs.push(path.join(tmp, '000-cover.pdf'));
    await page.pdf({ path: pdfs[0], width: '1440px', height: `${await page.evaluate(() => document.documentElement.scrollHeight) + 2}px`, printBackground: true, pageRanges: '1' });

    for (const [i, b] of boards.entries()) {
      await page.setViewportSize({ width: b.w, height: Math.max(b.h, 64) });
      await page.goto(base + b.file, { waitUntil: 'networkidle' });
      await page.waitForSelector('html[data-dc-ready]');
      await page.evaluate(() => document.fonts.ready);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const file = path.join(tmp, `${String(i + 1).padStart(3, '0')}.pdf`);
      await page.pdf({ path: file, width: `${b.w}px`, height: `${height + 2}px`, printBackground: true, pageRanges: '1' });
      pdfs.push(file);

      // The static copy: no scripts, board links pointing at the exported pages.
      const html = await page.evaluate(() => {
        document.querySelectorAll('script').forEach((s) => s.remove());
        delete document.documentElement.dataset.dcReady;
        return '<!doctype html>\n' + document.documentElement.outerHTML;
      });
      fs.writeFileSync(path.join(HTML_DIR, b.file.replace(/\.dc\.html$/, '.html')), html.replace(/href="([\w-]+)\.dc\.html/g, 'href="$1.html'));
      console.log(`${b.file}  ${b.w}x${height}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  fs.writeFileSync(path.join(HTML_DIR, 'index.html'), indexPage(groups));
  execFileSync('pdfunite', [...pdfs, PDF_FILE]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${boards.length} boards -> ${path.relative(process.cwd(), HTML_DIR)}, ${path.relative(process.cwd(), PDF_FILE)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
