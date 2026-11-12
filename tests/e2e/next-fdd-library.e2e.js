/*
 * EquipRite Next's FDD library page (flows/fdd library), in a browser against a throwaway project that is a git
 * repository with its own bare origin: upload an FDD (committed and pushed), a second one not marked latest, make it the
 * latest (pushed), read an outline and a section, remove one (pushed). Then the same page without the local server's
 * FDD library (as in VBCS): reading only, no upload.
 *
 * Run:  node tests/e2e/next-fdd-library.e2e.js   (after npm run build)
 */
'use strict';
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const settle = (page, ms) => page.waitForTimeout(ms || 300);
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

const FDD17 = `<html><body><h1>EquipRite Functional Design</h1><p>Document control: v1.7.</p>
<h1>7 Equipment registry</h1><p>The registry of equipment.</p>
<h2>7.2 Equipment master list</h2><p>The master list shows every equipment record in a grid with smart search and filters.</p>
<h3>7.2.5 Map view</h3><p>A map view shows where each unit is.</p>
<h1>8 Rentals</h1><h2>8.4 Hire extensions</h2><table><tr><td>BR-012</td><td>An extension over 30 days needs the manager to approve.</td></tr></table></body></html>`;
const FDD18 = '# 7 Equipment registry\nThe registry.\n## 7.2 Equipment master list\nv1.8: the list also shows the yard.\n## 7.3 Equipment detail\nOne unit.';

async function upload(page, name, body, mime) {
  await page.setInputFiles('#flibFile', { name, mimeType: mime, buffer: Buffer.from(body) });
  await settle(page, 300);
}

(async () => {
  const fdd = await E.fddSandbox({ git: true });
  const env = await E.start({ port: 19820, app: 'next', fddStore: fdd.store });
  const page = env.page;
  page.on('dialog', (d) => d.accept());
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('the FDD library: empty, uploads allowed, git up to date');
    await env.open('/?open=fdd-library');
    await page.waitForSelector('#flibTitle', { timeout: 30000 });
    await page.waitForSelector('#flibDrop', { timeout: 10000 });
    T.check('an empty library says so', await page.isVisible('#flibEmpty'));
    T.check('it says it is kept in git, on which branch, and that everything is in git', /Kept in git/.test(await text(page, '#flibGit')) && /fdd\/test → origin\/fdd\/test · everything is in git/.test(await text(page, '#flibGitState')), await text(page, '#flibGit'));

    T.section('upload to git');
    await upload(page, 'EquipRite_FDD_v1.7.html', FDD17, 'text/html');
    T.check('choosing the file offers the name and version from its file name', (await page.inputValue('#flibName')) === 'EquipRite FDD' && (await page.inputValue('#flibVersion')) === '1.7' && /EquipRite_FDD_v1\.7\.html/.test(await text(page, '#flibDrop')));
    T.check('"Make it the latest" and "Commit & push to git" are ticked; the button says Upload to git', await page.isChecked('#flibLatest') && await page.isChecked('#flibCommit') && /Upload to git/.test(await text(page, '#flibUpload')));
    await page.fill('#flibNote', 'Baseline from the client');
    await page.dispatchEvent('#flibNote', 'change');
    await page.click('#flibUpload');
    await page.waitForSelector('#flibResult', { timeout: 30000 });
    const r1 = await text(page, '#flibResult');
    T.check('uploaded: sections read, now the latest, committed and pushed', /Uploaded EquipRite FDD v1\.7/.test(r1) && /sections read/.test(r1) && /now the latest/.test(r1) && /pushed to origin\/fdd\/test/.test(r1), r1);
    T.check('the remote has the commit, with only the FDD files', fdd.gitRemote('log', '-1', '--format=%s', 'fdd/test') === 'FDD library: add EquipRite FDD v1.7 (latest)'
      && fdd.gitRemote('show', '--name-only', '--format=', 'fdd/test').split('\n').sort().join(',') === 'docs/fdd/equiprite-fdd-v1-7.html,webApps/equiprite-next/resources/fdd/equiprite-fdd-v1-7.json,webApps/equiprite-next/resources/fdd/library.json');
    T.check('the form is cleared for the next one (name, version, note, file)', (await page.inputValue('#flibNote')) === '' && (await page.inputValue('#flibName')) === '' && /Choose the FDD file/.test(await text(page, '#flibDrop')));
    await page.waitForSelector('.nx-flib-row', { timeout: 10000 });
    T.check('the library lists it, marked Latest, with its note', /EquipRite FDD\s*v1\.7\s*Latest/.test(await text(page, '#flibRows')) && /Baseline from the client/.test(await text(page, '#flibRows')));

    T.section('a second FDD, not the latest; then make it the latest');
    await upload(page, 'EquipRite_FDD_v1.8.md', FDD18, 'text/markdown');
    await page.click('#flibLatest');
    await page.click('#flibUpload');
    await page.waitForFunction(() => /v1\.8/.test((document.getElementById('flibResult') || {}).textContent || ''), null, { timeout: 30000 });
    T.check('v1.8 is in the library; v1.7 stays the latest', /pushed/.test(await text(page, '#flibResult')) && (await page.$$('.nx-flib-row')).length === 2
      && /v1\.7\s*Latest/.test(await text(page, '.nx-flib-row--latest')));
    await page.click('.nx-flib-row[data-id="equiprite-fdd-v1-8"] [data-act="latest"]');
    await page.waitForFunction(() => /v1\.8/.test((document.querySelector('.nx-flib-row--latest') || {}).textContent || '')
      && /The latest is now/.test((document.getElementById('flibResult') || {}).textContent || ''), null, { timeout: 30000 });
    T.check('Make latest moves the Latest mark, and is pushed', /The latest is now equiprite-fdd-v1-8/.test(await text(page, '#flibResult')) && fdd.gitRemote('log', '-1', '--format=%s', 'fdd/test') === 'FDD library: equiprite-fdd-v1-8 is the latest');
    await page.waitForFunction(() => /everything is in git/.test((document.getElementById('flibGitState') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('git: everything is in git, no Commit & push button', /everything is in git/.test(await text(page, '#flibGitState')) && !(await page.$('#flibPush')));

    T.section('the outline and a section — what the AI reads');
    await page.click('.nx-flib-row[data-id="equiprite-fdd-v1-7"] [data-act="view"]');
    await page.waitForSelector('#flibTree .nx-flib-node', { timeout: 10000 });
    T.check('the outline lists the numbered sections', /7\s*Equipment registry/.test(await text(page, '#flibTree')) && /7\.2\.5\s*Map view/.test(await text(page, '#flibTree')) && /8\.4\s*Hire extensions/.test(await text(page, '#flibTree')));
    await page.fill('#flibFilter', '8.4');
    await page.dispatchEvent('#flibFilter', 'input');
    await settle(page, 300);
    T.eq('the filter finds a section by number', (await page.$$('#flibTree .nx-flib-node')).length, 1);
    await page.click('#flibTree .nx-flib-node');
    await page.waitForFunction(() => /BR-012/.test((document.getElementById('flibText') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('a section shows its text (a table row) and where it sits', /BR-012 \| An extension over 30 days/.test(await text(page, '#flibText')) && /in 8 Rentals/.test(await text(page, '#flibText')), await text(page, '#flibText'));
    await page.fill('#flibFilter', '');
    await page.dispatchEvent('#flibFilter', 'input');
    await page.click('#flibTree .nx-flib-node:has-text("Equipment master list")');
    await settle(page, 300);
    await page.evaluate(() => { const c = document.querySelector('.nx-content'); if (c) c.scrollTop = 0; });
    await env.shot('next-fdd-library.png');

    T.section('remove one');
    await page.click('.nx-flib-row[data-id="equiprite-fdd-v1-7"] [data-act="remove"]');
    await page.waitForFunction(() => document.querySelectorAll('.nx-flib-row').length === 1, null, { timeout: 30000 });
    T.check('removed, the outline closed, the removal pushed as deletions', !(await page.$('#flibOutline')) && fdd.gitRemote('log', '-1', '--format=%s', 'fdd/test') === 'FDD library: remove equiprite-fdd-v1-7'
      && /D\s+docs\/fdd\/equiprite-fdd-v1-7\.html/.test(fdd.gitRemote('show', '--name-status', '--format=', 'fdd/test')));
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
  }

  // Without the local server's FDD library (as in VBCS): the library still reads, uploading is not offered.
  const env2 = await E.start({ port: 19830, app: 'next' });
  try {
    T.section('without the local FDD library (as in VBCS): read only');
    await env2.open('/?open=fdd-library');
    await env2.page.waitForSelector('#flibNoUpload', { timeout: 30000 });
    T.check('it says uploading is done from the desktop app; the library still lists what the build has', /desktop app/.test(await text(env2.page, '#flibNoUpload')) && (await env2.page.$$('.nx-flib-row')).length === 1 && !(await env2.page.$('#flibFile')));
  } catch (e) {
    T.check('no exception (read only): ' + (e && e.message), false);
  } finally {
    await env2.close();
    fdd.restore();
  }
  T.report();
})();
