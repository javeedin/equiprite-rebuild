/*
 * The FDD library (desktop/lib/fdd.js): reading Word, HTML, Markdown, text and PDF into numbered sections; the library
 * kept in the project (docs/fdd + webApps/equiprite-next/resources/fdd) with its latest; and saving it to git — only the
 * FDD files committed, pushed to the branch, a refused push said with what to do.
 *
 * Builds its own .docx and .pdf (no fixtures), and a throwaway git repository with a bare "origin".
 *
 * Run:  node tests/fdd-library.test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const F = require('../desktop/lib/fdd');

const T = H.makeAsserter();

// ── a .docx, built here: stored (uncompressed) zip entries; the reader does not check CRCs ──────────────────────────
function zip(entries) {
  const locals = [], centrals = [];
  let off = 0;
  Object.keys(entries).forEach((name) => {
    const data = Buffer.from(entries[name]);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, n);
    off += 30 + n.length + data.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(locals.concat([cd, end]));
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const P = (style, text, extra) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra || ''}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const STYLES = `<?xml version="1.0"?><w:styles ${W}>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Heading2"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
</w:styles>`;
function docx(body) {
  return zip({ '[Content_Types].xml': '<Types/>', 'word/styles.xml': STYLES,
    'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>` });
}
const DOCX = docx([
  P('Title', 'EquipRite Functional Design'),
  P('', 'Document control: version 1.7'),
  P('TOC1', 'Introduction 3'), P('TOC1', 'Rentals 9'),
  P('Heading1', 'Document history', '<w:numPr><w:numId w:val="0"/></w:numPr>'),   // a heading taken out of the numbering
  P('', 'Revised 08 Jun 2026.'),
  P('Heading1', 'Introduction'),                                                 // auto-numbered: 1
  P('', 'EquipRite rents equipment to projects &amp; customers.'),
  P('Heading2', 'Purpose'),                                                      // 1.1
  P('', 'Why it is built.'),
  P('Heading1', 'Rentals'),                                                      // 2
  P('Heading2', 'Rental agreements'),                                            // 2.1
  P('', 'An agreement has a customer, rates and dates.'),
  '<w:tbl><w:tr><w:tc>' + P('', 'Rule') + '</w:tc><w:tc>' + P('', 'Text') + '</w:tc></w:tr><w:tr><w:tc>' + P('', 'BR-012') + '</w:tc><w:tc>' + P('', 'An extension over 30 days needs approval.') + '</w:tc></w:tr></w:tbl>',
  P('Heading3', '7.2.5G Hire extensions'),                                       // typed number wins: 7.2.5G
  '<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>',
  '<w:p><w:del><w:r><w:delText>deleted words</w:delText></w:r></w:del><w:r><w:t>kept</w:t></w:r></w:p>',
].join(''));

// ── a PDF, built here: Helvetica text, one page per array, real xref offsets ─────────────────────────────────────────
function pdf(pages) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + 1; objs.push(null);
  const kids = pages.map((lines) => {
    const esc = (t) => t.replace(/[\\()]/g, (c) => '\\' + c);
    const stream = 'BT /F1 11 Tf 14 TL 50 780 Td ' + lines.map((l) => '(' + esc(l) + ') Tj T*').join(' ') + ' ET';
    const content = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
    return add('<< /Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' + font + ' 0 R >> >> /Contents ' + content + ' 0 R >>');
  });
  objs[pagesId - 1] = '<< /Type /Pages /Kids [' + kids.map((k) => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>';
  const cat = add('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = out.length; out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; return at; });
  const x = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + cat + ' 0 R >>\nstartxref\n' + x + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

(async () => {
  T.section('section numbers in headings');
  T.eq('7.2.5G Hire extensions', JSON.stringify(F.headingNumber('7.2.5G Hire extensions')), JSON.stringify({ n: '7.2.5G', t: 'Hire extensions' }));
  T.eq('"7.14A. Rates"', F.headingNumber('7.14A. Rates').n, '7.14A');
  T.eq('"Section 7.2 – Agreements"', JSON.stringify(F.headingNumber('Section 7.2 – Agreements')), JSON.stringify({ n: '7.2', t: 'Agreements' }));
  T.eq('"7.2 Gantt view" keeps the G in the title', JSON.stringify(F.headingNumber('7.2 Gantt view')), JSON.stringify({ n: '7.2', t: 'Gantt view' }));
  T.eq('"2026 plan" is not a section number', F.headingNumber('2026 plan').n, '');
  T.check('an outline moves forward: 7.2 → 7.2.5, 7.2.5 → 7.2.5G, 7.3 → 8.1, 2 → 7', F.canFollow('7.2', '7.2.5') && F.canFollow('7.2.5', '7.2.5G') && F.canFollow('7.3', '8.1') && F.canFollow('2', '7'));
  T.check('…never back, nor far ahead: 7.3 → 7.2, 7.3 → 9.1, 7 → 30', !F.canFollow('7.3', '7.2') && !F.canFollow('7.3', '9.1') && !F.canFollow('7', '30'));

  T.section('Word (.docx): headings from the heading styles, numbered as Word numbers them');
  const d = await F.parse(DOCX, 'EquipRite_FDD_v1.7.docx');
  const byN = (r, n) => r.sections.filter((s) => s.n === n)[0];
  T.eq('kind', d.kind, 'docx');
  T.check('the title and text before the first heading are the front matter', d.sections[0].t === '(Front matter)' && /Document control/.test(d.sections[0].x) && /EquipRite Functional Design/.test(d.sections[0].x), JSON.stringify(d.sections[0]));
  T.check('the table of contents is left out', !d.sections.some((s) => /Introduction 3/.test(s.x)));
  T.check('a heading taken out of the numbering has no number', d.sections.some((s) => s.t === 'Document history' && s.n === ''));
  T.check('auto-numbered headings: 1 Introduction, 1.1 Purpose, 2 Rentals, 2.1 Rental agreements',
    byN(d, '1') && byN(d, '1').t === 'Introduction' && byN(d, '1.1').t === 'Purpose' && byN(d, '2').t === 'Rentals' && byN(d, '2.1').t === 'Rental agreements',
    JSON.stringify(d.sections.map((s) => s.n + ' ' + s.t)));
  T.check('a number typed in the heading wins (7.2.5G), at its level', byN(d, '7.2.5G') && byN(d, '7.2.5G').t === 'Hire extensions' && byN(d, '7.2.5G').l === 3);
  T.check('text under a heading, with entities decoded', /rents equipment to projects & customers/.test(byN(d, '1').x));
  T.check('a table becomes rows of cells', /Rule \| Text\nBR-012 \| An extension over 30 days needs approval\./.test(byN(d, '2.1').x), byN(d, '2.1').x);
  T.check('line breaks kept; deleted (tracked) text left out', /Line one\nline two/.test(byN(d, '7.2.5G').x) && /kept/.test(byN(d, '7.2.5G').x) && !/deleted words/.test(byN(d, '7.2.5G').x));
  let bad = '';
  try { await F.parse(Buffer.from('not a zip'), 'x.docx'); } catch (e) { bad = e.message; }
  T.check('a file that is not a .docx says so', /not a Word document/.test(bad), bad);

  T.section('HTML, Markdown and text');
  const h = F.parseHtml('<html><head><title>x</title><style>h1{}</style></head><body><p>Cover</p><h1><span>7</span>Rentals</h1><p>Intro &amp; scope</p>'
    + '<h2>7.2 Rental agreements</h2><table><tr><td>A</td><td>B</td></tr></table><ul><li>one</li><li>two</li></ul><script>alert(1)</script></body></html>');
  T.check('<h1>–<h6> are the headings; a number in its own span is still the number', h.sections.some((s) => s.n === '7' && s.t === 'Rentals') && h.sections.some((s) => s.n === '7.2' && s.l === 2), JSON.stringify(h.sections));
  T.check('tables, lists and entities read; scripts and styles dropped', /A \| B/.test(h.sections[2].x) && /- one\n- two/.test(h.sections[2].x) && /Intro & scope/.test(h.sections[1].x) && !/alert/.test(JSON.stringify(h)));
  const md = F.parseText('# EquipRite FDD\nIntro\n## 7.2 Rental agreements\nRates and dates.\n### 7.2.5 Extensions\nOver 30 days.', 'md');
  T.check('Markdown: # headings, numbers taken from them', md.sections.map((s) => s.n + '|' + s.t).join(',') === '|EquipRite FDD,7.2|Rental agreements,7.2.5|Extensions', JSON.stringify(md.sections));
  const tx = F.parseText('1 Introduction\nThe system.\n1. The user signs in, then clicks things.\n2 Scope\nIn scope.\n2.1 Rentals\nSee 7.2 Rental agreements for rates.\n', 'txt');
  T.check('text: numbered lines that follow the outline open sections; a list item and a cross-reference do not',
    tx.sections.map((s) => s.n).join(',') === '1,2,2.1' && /1\. The user signs in/.test(tx.sections[0].x) && /See 7\.2/.test(tx.sections[2].x), JSON.stringify(tx.sections));

  T.section('PDF (pdf.js): a contents page skipped, headings by number, running header and footer dropped');
  const pages = [['Contents', '1 Introduction 3', '1.1 Purpose 3', '2 Rentals 4', '2.1 Agreements 4', '2.1.5G Extensions 5']];
  for (let i = 1; i <= 5; i++) {
    const body = i === 1 ? ['1 Introduction', 'EquipRite rents equipment.', '1.1 Purpose', 'Why it is built.']
      : i === 2 ? ['2 Rentals', 'Rentals intro.', '2.1 Agreements', 'An agreement has a customer and rates.']
        : i === 3 ? ['2.1.5G Extensions', 'An extension over 30 days needs approval (BR-012).'] : ['More text on page ' + i + '.'];
    pages.push(['EquipRite FDD v1.7 Confidential'].concat(body, ['Page ' + (i + 1) + ' of 6']));
  }
  const pr = await F.parse(pdf(pages), 'fdd.pdf');
  T.eq('kind', pr.kind, 'pdf');
  T.check('sections 1, 1.1, 2, 2.1, 2.1.5G, in order (not the contents page\'s copies)', pr.sections.filter((s) => s.n).map((s) => s.n).join(',') === '1,1.1,2,2.1,2.1.5G', JSON.stringify(pr.sections.map((s) => s.n + ' ' + s.t)));
  T.check('text under the headings', /customer and rates/.test(byN(pr, '2.1').x) && /BR-012/.test(byN(pr, '2.1.5G').x));
  T.check('the line on every page (header, footer) is dropped', !/Confidential|Page \d of 6/.test(pr.sections.map((s) => s.x).join('\n')));
  T.check('a PDF upload says to check the outline', pr.warnings.some((w) => /check the outline/i.test(w)));

  T.section('the library in a project: upload, latest, outline, remove');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fdd-'));
  fs.mkdirSync(path.join(root, 'webApps', 'equiprite-next', 'resources'), { recursive: true });
  const mirror = path.join(root, 'build', 'resources', 'fdd');
  let clock = Date.parse('2026-11-12T10:00:00Z');
  const S = F.open({ root, mirror, now: () => new Date(clock += 60000) });
  T.check('an empty library; uploads possible (the project has webApps/equiprite-next)', S.info().docs.length === 0 && S.info().canUpload === true);
  const u1 = await S.upload({ fileName: 'EquipRite_FDD_v1.6.docx', base64: DOCX.toString('base64'), name: 'EquipRite FDD', version: '1.6', note: 'first', by: 'javeed' });
  T.check('uploaded: id from name + version, sections counted', u1.ok && u1.doc.id === 'equiprite-fdd-v1-6' && u1.doc.sections === d.sections.length && u1.doc.uploadedBy === 'javeed', JSON.stringify(u1));
  T.check('saved in the project: the document in docs/fdd, the sections and the library in resources/fdd',
    fs.existsSync(path.join(root, 'docs/fdd/equiprite-fdd-v1-6.docx')) && fs.existsSync(path.join(root, F.RES_DIR, 'equiprite-fdd-v1-6.json')) && JSON.parse(fs.readFileSync(path.join(root, F.RES_DIR, 'library.json'), 'utf8')).latest === 'equiprite-fdd-v1-6');
  T.check('…and the same JSON in the running app\'s build copy', fs.readFileSync(path.join(mirror, 'library.json'), 'utf8') === fs.readFileSync(path.join(root, F.RES_DIR, 'library.json'), 'utf8') && fs.existsSync(path.join(mirror, 'equiprite-fdd-v1-6.json')));
  const u2 = await S.upload({ fileName: 'fdd.pdf', base64: pdf(pages).toString('base64'), name: 'EquipRite FDD', version: '1.7', latest: true });
  T.check('a second upload marked latest becomes the latest; warnings come back', u2.ok && S.info().latest === 'equiprite-fdd-v1-7' && u2.warnings.length > 0);
  const u3 = await S.upload({ fileName: 'draft.md', base64: Buffer.from('# 9 Draft\nText').toString('base64'), name: 'EquipRite FDD', version: '1.7', latest: false });
  T.check('the same name + version again gets its own id, and "not latest" leaves the latest alone', u3.ok && u3.doc.id === 'equiprite-fdd-v1-7-2' && S.info().latest === 'equiprite-fdd-v1-7');
  T.check('the library lists the newest first', S.info().docs.map((x) => x.id).join(',') === 'equiprite-fdd-v1-7-2,equiprite-fdd-v1-7,equiprite-fdd-v1-6');
  T.check('make another the latest', S.setLatest('equiprite-fdd-v1-6').ok && S.info().latest === 'equiprite-fdd-v1-6' && !S.setLatest('nope').ok);
  const ol = S.outline('equiprite-fdd-v1-6');
  T.check('the outline: numbers, titles, levels and sizes', ol.ok && ol.sections.some((s) => s.n === '7.2.5G' && s.l === 3 && s.chars > 0));
  const orig = S.original('equiprite-fdd-v1-6');
  T.check('the original, to download', orig.ok && orig.name === 'EquipRite_FDD_v1.6.docx' && /wordprocessingml/.test(orig.mime));
  T.check('refused: an unknown kind of file, an empty file', !(await S.upload({ fileName: 'x.exe', base64: 'AAAA' })).ok && !(await S.upload({ fileName: 'x.txt', base64: '' })).ok);
  const libPath = path.join(root, F.RES_DIR, 'library.json');
  const good = fs.readFileSync(libPath, 'utf8');
  const evil = JSON.parse(good); evil.docs.push({ id: 'evil', name: 'x', file: 'docs/fdd/../../outside.txt', uploadedAt: '2000-01-01' });
  fs.writeFileSync(path.join(root, 'outside.txt'), 'keep me'); fs.writeFileSync(libPath, JSON.stringify(evil));
  T.check('a library.json pointing outside docs/fdd is refused: no download, no delete; odd ids refused',
    !S.original('evil').ok && S.remove('evil').ok && fs.existsSync(path.join(root, 'outside.txt')) && !S.outline('../x').ok && !S.setLatest('../x').ok);
  fs.writeFileSync(libPath, good);
  const rm = S.remove('equiprite-fdd-v1-6');
  T.check('removing the latest: its files go, the newest left becomes the latest', rm.ok && !fs.existsSync(path.join(root, 'docs/fdd/equiprite-fdd-v1-6.docx')) && !fs.existsSync(path.join(mirror, 'equiprite-fdd-v1-6.json')) && S.info().latest === 'equiprite-fdd-v1-7-2');
  const fresh = path.join(root, 'build2', 'resources', 'fdd');
  fs.mkdirSync(fresh, { recursive: true }); fs.writeFileSync(path.join(fresh, 'stale.json'), '{}'); fs.writeFileSync(path.join(fresh, 'library.json'), '{"latest":"","docs":[]}');
  F.open({ root }).setMirror(() => fresh);
  T.check('as the server starts, the project\'s FDD files are copied into the build copy (a git pull shows without a rebuild)',
    fs.readFileSync(path.join(fresh, 'library.json'), 'utf8') === fs.readFileSync(path.join(root, F.RES_DIR, 'library.json'), 'utf8') && fs.existsSync(path.join(fresh, 'equiprite-fdd-v1-7.json')) && !fs.existsSync(path.join(fresh, 'stale.json')));
  const noProject = F.open({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-nofdd-')) });
  T.check('outside a project folder: reading is empty, uploading is refused with why', noProject.info().canUpload === false && /project folder/.test((await noProject.upload({ fileName: 'a.md', base64: 'IyBh' })).error || ''));

  T.section('git: only the FDD files are committed, then pushed to the branch');
  let haveGit = true;
  try { git(root, '--version'); } catch (e) { haveGit = false; }
  if (!haveGit) { T.check('git is installed (skipping the git checks)', true); T.report(); return; }
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fdd-repo-'));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fdd-remote-'));
  git(remote, 'init', '--bare', '-q');
  git(repo, 'init', '-q', '-b', 'feature/x');
  git(repo, 'config', 'user.email', 'test@example.com'); git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(repo, 'webApps', 'equiprite-next', 'resources'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'webApps', 'equiprite-next', 'app.txt'), 'app\n');
  fs.writeFileSync(path.join(repo, 'other.txt'), 'one\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'start');
  const G = F.open({ root: repo });
  let st = await G.gitStatus();
  T.check('status before a remote: the branch, nothing pending, no upstream', st.available && st.branch === 'feature/x' && st.pending.length === 0 && st.upstream === '');
  git(repo, 'remote', 'add', 'origin', remote);
  const g1 = await G.upload({ fileName: 'fdd.md', base64: Buffer.from('# 7.2 Rental agreements\nRates.').toString('base64'), name: 'EquipRite FDD', version: '1.7' });
  fs.writeFileSync(path.join(repo, 'other.txt'), 'two\n'); git(repo, 'add', 'other.txt'); // someone's own staged work
  st = await G.gitStatus();
  T.check('after an upload: the three FDD files are pending', g1.ok && st.pending.length === 3, JSON.stringify(st.pending));
  const s1 = await G.gitSave({ message: 'FDD library: add EquipRite FDD v1.7 (latest)' });
  T.check('commit + first push: -u origin, the upstream is set', s1.ok && s1.committed && s1.pushed && s1.upstream === 'origin/feature/x', JSON.stringify(s1));
  const files = git(repo, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort();
  T.check('the commit holds only the FDD files', files.join(',') === ['docs/fdd/equiprite-fdd-v1-7.md', 'webApps/equiprite-next/resources/fdd/equiprite-fdd-v1-7.json', 'webApps/equiprite-next/resources/fdd/library.json'].join(','), files.join(','));
  T.check('…and the other staged change is still staged, not committed', git(repo, 'diff', '--cached', '--name-only') === 'other.txt');
  T.check('the remote has the commit', git(remote, 'log', '-1', '--format=%s', 'feature/x') === 'FDD library: add EquipRite FDD v1.7 (latest)');
  st = await G.gitStatus();
  T.check('then: nothing pending, nothing unpushed', st.pending.length === 0 && st.unpushed.length === 0);
  T.check('saving with nothing to do says so', (await G.gitSave({})).nothing === true);
  await G.upload({ fileName: 'v18.md', base64: Buffer.from('# 7.2 Rental agreements\nRates v1.8.').toString('base64'), name: 'EquipRite FDD', version: '1.8', latest: false });
  G.setLatest('equiprite-fdd-v1-8');
  const s2 = await G.gitSave({ message: 'FDD library: v1.8 is the latest', push: false });
  st = await G.gitStatus();
  T.check('commit without push: one FDD commit waits to be pushed', s2.ok && !s2.pushed && st.unpushed.length === 1);
  const s3 = await G.gitSave({});
  T.check('…and Commit & push pushes it', s3.ok && s3.pushed && git(remote, 'log', '-1', '--format=%s', 'feature/x') === 'FDD library: v1.8 is the latest');
  G.remove('equiprite-fdd-v1-7');
  const s4 = await G.gitSave({ message: 'FDD library: remove v1.7' });
  T.check('a removal is committed as deletions', s4.ok && s4.pushed && /D\s+docs\/fdd\/equiprite-fdd-v1-7\.md/.test(git(repo, 'show', '--name-status', '--format=', 'HEAD')));
  // someone else pushes first
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fdd-other-'));
  execFileSync('git', ['clone', '-q', '-b', 'feature/x', remote, other]);
  git(other, 'config', 'user.email', 'o@example.com'); git(other, 'config', 'user.name', 'Other'); git(other, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(other, 'theirs.txt'), 'x'); git(other, 'add', '-A'); git(other, 'commit', '-q', '-m', 'theirs'); git(other, 'push', '-q');
  await G.upload({ fileName: 'v19.md', base64: Buffer.from('# 1 New\nx').toString('base64'), name: 'EquipRite FDD', version: '1.9' });
  const s5 = await G.gitSave({});
  T.check('a refused push: committed here, not pushed, and says to pull first', !s5.ok && s5.committed && !s5.pushed && /git pull/.test(s5.hint), JSON.stringify(s5));
  T.check('nothing was rebased or forced: the remote still ends with their commit', git(remote, 'log', '-1', '--format=%s', 'feature/x') === 'theirs');
  const notRepo = await F.open({ root: root }).gitStatus();
  T.check('a project folder that is not a git repository says so', notRepo.available === false && /not a git repository/.test(notRepo.reason));

  [root, repo, remote, other].forEach((p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* tmp */ } });
  T.report();
})().catch((e) => { console.error(e); process.exit(1); });
