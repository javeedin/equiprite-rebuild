/*
 * The API tester (Application pages → a page → Integrations → Test; desktop/lib/apiTest.js), in a browser, against the
 * harness's fake backend: Old EquipRite's Create Equipment Request page — its REST calls each with Test, a call sent
 * (where it goes, the login, its rows, its shape against the example it was built with, body, headers, curl), its last
 * run beside it; a call that changes data held until confirmed; one of its BI Publisher reports run with its parameter
 * (its rows decoded); Check all reads.
 *
 * Run:  node tests/e2e/next-api-test.e2e.js   (after npm run build)
 */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const E = require('./harness');
const H = require('../_harness');
const A = require('../../desktop/lib/apiTest');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..', '..');
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const ID = 'vbredwoodapp/customer-portal/project-create-request';
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'services/eqp-v1/examples/getEquipriteV1EquipmentMaster/response_default_application_json_vb.json'), 'utf8'));

(async () => {
  const pg = await E.pagesSandbox();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-api-e2e-'));
  const apiStore = A.open({ root: ROOT, file: path.join(dir, 'api-tests.json') });
  const reportBodies = [];
  const env = await E.start({ port: 19870, app: 'next', pagesStore: pg.store, apiStore,
    handle: (r, res) => {
      if (r.path === '/equiprite/v1/equipment-master') return res.json(EXAMPLE);
      if (r.path.endsWith('/ExternalReportWSSService') && /EQP_CONTRACTS_BY_PROJECT_LOV_RP/.test(r.body)) {
        reportBodies.push(r.body);
        return res.bip([{ CONTRACT_ID: '7', CONTRACT_NUMBER: 'C-7', STATUS: 'ACTIVE' }, { CONTRACT_ID: '8', CONTRACT_NUMBER: 'C-8', STATUS: 'ON HOLD' }]);
      }
      return false;
    } });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const dlgOpen = () => page.evaluate(() => document.getElementById('apiDlg').open);
  try {
    T.section('a page\'s REST calls, each with Test');
    await env.open('/?open=app-pages');
    await page.waitForSelector('#pgRows .nx-pg-row', { timeout: 30000 });
    await page.click('#pgApps [data-value="vbredwoodapp"]');
    await page.click('#pgRows .nx-pg-row[data-id="' + ID + '"]');
    await page.waitForSelector('#pgRest', { timeout: 15000 });
    await page.waitForSelector('#apiReports .nx-api-rep', { timeout: 10000 }).catch(() => {});
    const rows = await page.$$eval('#pgRest .nx-pg-gr[data-endpoint]', (r) => r.length);
    const tests = await page.$$eval('#pgRest .nx-api-test', (b) => b.filter((x) => !x.disabled).length);
    T.check('every call of the page has Test (27), with Check all reads', rows === 27 && tests === 27 && /Check all reads/.test(await text(page, '#apiCheckAll')), rows + ' / ' + tests);
    T.check('its BI Publisher reports read from its code, each with Run: path and parameters', (await page.$$('#apiReports .nx-api-rep')).length === 5
      && /\/Custom\/EquipRite\/EQP_CONTRACTS_BY_PROJECT_LOV_RP\.xdo[\s\S]*Parameters: P_PROJECT_ID/.test(await text(page, '#apiReports [data-report="EQP_CONTRACTS_BY_PROJECT_LOV_RP"]')));

    T.section('one call sent to the backend');
    await page.click('#pgRest [data-endpoint="eqp-v1/getEquipriteV1EquipmentMaster"] .nx-api-test');
    await page.waitForSelector('#apiParams', { timeout: 10000 });
    T.check('the tester: where it goes (the backend\'s address and path), the login, only reads; its parameters from the service', await dlgOpen()
      && /^http:\/\/127\.0\.0\.1:\d+\/equiprite\/v1\/equipment-master$/.test(await text(page, '#apiTarget')) && (await text(page, '#apiLogin')) === 'None needed'
      && (await text(page, '#apiKind')) === 'Only reads' && (await text(page, '#apiTitle')) === 'getEquipriteV1EquipmentMaster' && (await page.$$('#apiParams [data-param]')).length > 0);
    await page.click('#apiSend');
    await page.waitForSelector('#apiStatus', { timeout: 15000 });
    await page.waitForTimeout(400);
    T.check('sent: 200 OK, its time and size and rows; same shape as the example the page was built with', (await text(page, '#apiStatus')) === '200 OK'
      && new RegExp('ms · [0-9.]+ (KB|B) · ' + EXAMPLE.data.length + ' rows').test(await text(page, '#apiFacts')) && /Same shape as the example/.test(await text(page, '#apiShapeBadge')), await text(page, '#apiFacts'));
    const tbl = await page.evaluate(() => ({ heads: Array.prototype.map.call(document.querySelectorAll('#apiTable .nx-api-tr--head .nx-api-td'), (c) => c.textContent.trim()),
      rows: document.querySelectorAll('#apiTable .nx-api-tr:not(.nx-api-tr--head)').length, first: (document.querySelector('#apiTable .nx-api-tr:not(.nx-api-tr--head)') || {}).textContent || '' }));
    T.check('its rows as a table: its columns, every record', tbl.rows === EXAMPLE.data.length && tbl.heads.indexOf('equipmentName') !== -1 && tbl.first.indexOf(EXAMPLE.data[0].equipmentName) !== -1, JSON.stringify(tbl).slice(0, 300));
    await env.shot('api-test.png');
    await page.click('.nx-api-tab[data-key="body"]');
    T.check('…the body, pretty', /"equipmentName": "/.test(await text(page, '#apiBodyOut')));
    await page.click('.nx-api-tab[data-key="headers"]');
    T.check('…its headers', /content-type\s*application\/json/.test(await text(page, '#apiHeaders')));
    await page.click('.nx-api-tab[data-key="shape"]');
    T.check('…its shape: why it matters, compared with the saved example', /Every field of the example the page was built with is still in the answer[\s\S]*services\/eqp-v1\/examples\/getEquipriteV1EquipmentMaster/.test(await text(page, '#apiShape')));
    await page.click('.nx-api-tab[data-key="curl"]');
    T.check('…the same call as curl', /^curl -X GET 'http:\/\/127\.0\.0\.1:\d+\/equiprite\/v1\/equipment-master' \\ -H 'Accept: application\/json'/.test(await text(page, '#apiCurl')), await text(page, '#apiCurl'));
    T.check('its last runs listed', /^200 · \d+ ms · \d+ rows/.test(await text(page, '#apiHist li')));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    T.check('Esc closes it; its last run shown beside the call', !(await dlgOpen()) && /^200 · \d+ ms · \d+ rows/.test(await text(page, '#pgRest [data-endpoint="eqp-v1/getEquipriteV1EquipmentMaster"] .nx-api-last')));

    T.section('a call that changes data waits for "Send it"');
    const before = env.writes.length;
    await page.click('#pgRest [data-endpoint="eqp-v1/createEquipmentRequest"] .nx-api-test');
    await page.waitForSelector('#apiBody', { timeout: 10000 });
    await page.waitForTimeout(200);
    T.check('a POST: "changes data", its JSON body to start from', /Changes data/.test(await text(page, '#apiKind')) && (await page.$eval('#apiBody', (e) => e.value)).trim().length > 0);
    await page.fill('#apiBody', '{"requestNumber":"T-1"}');
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('#apiConfirm', { timeout: 10000 });
    T.check('Ctrl+Enter: not sent — it asks first', env.writes.length === before && /changes data on http:\/\/127\.0\.0\.1:\d+/.test(await text(page, '#apiMsg')));
    await page.click('#apiConfirm');
    await page.waitForSelector('#apiStatus', { timeout: 10000 });
    const w = env.writes[env.writes.length - 1];
    T.check('…"Send it — it changes data": sent, with its body', env.writes.length === before + 1 && w.method === 'POST' && w.path === '/equiprite/v1/equipment-requests' && w.body.requestNumber === 'T-1'
      && /^201/.test(await text(page, '#apiStatus')), JSON.stringify(w));
    await page.click('#apiClose');

    T.section('a BI Publisher report run');
    await page.click('#apiReports [data-report="EQP_CONTRACTS_BY_PROJECT_LOV_RP"] .nx-api-test');
    await page.waitForSelector('#apiParams [data-param="P_PROJECT_ID"]', { timeout: 10000 });
    T.check('the report: REPORT, to BI Publisher\'s SOAP service, its parameter from the code', /REPORT/.test(await text(page, '.nx-api-method')) && /\/xmlpserver\/services\/ExternalReportWSSService$/.test(await text(page, '#apiTarget')) && (await text(page, '#apiReportPath')) === '/Custom/EquipRite/EQP_CONTRACTS_BY_PROJECT_LOV_RP.xdo'
      && /No Fusion login yet/.test(await text(page, '#apiLogin')), [await text(page, '.nx-api-method'), await text(page, '#apiTarget'), await text(page, '#apiLogin')].join(' | '));
    await page.fill('#apiParams [data-param="P_PROJECT_ID"]', '42');
    await page.click('#apiSend');
    await page.waitForSelector('#apiTable', { timeout: 10000 });
    T.check('run: the envelope the app sends (its path, P_PROJECT_ID=42); the report\'s rows decoded', /reportAbsolutePath>\/Custom\/EquipRite\/EQP_CONTRACTS_BY_PROJECT_LOV_RP\.xdo</.test(reportBodies[0] || '') && /<pub:name>P_PROJECT_ID<\/pub:name><pub:values><pub:item>42</.test(reportBodies[0] || '')
      && (await page.$$('#apiTable .nx-api-tr:not(.nx-api-tr--head)')).length === 2 && /C-7[\s\S]*ACTIVE/.test(await text(page, '#apiTable')) && /report rows <G_1>/.test(await text(page, '#apiFacts')));
    await env.shot('api-test-report.png');
    await page.click('#apiClose');

    T.section('Check all reads');
    await page.click('#apiCheckAll');
    await page.waitForSelector('#apiCheckSum', { timeout: 60000 });
    const sum = await text(page, '#apiCheckSum');
    const notes = await page.$$eval('#pgRest .nx-api-chk', (n) => n.map((x) => x.textContent.trim()));
    T.check('every call that only reads, run: counted; the writes and the report runner left alone; a call needing an id says so', /^\d+ ok/.test(sum) && !/failed/.test(sum)
      && notes.some((x) => /Changes data/.test(x)) && notes.some((x) => /reports/.test(x)) && notes.some((x) => /^— Needs id/.test(x)), sum + ' | ' + notes.slice(0, 6).join(' | '));
    await page.$eval('#apiBar', (e) => e.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await env.shot('api-test-check.png');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    await env.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
    if (pg.cleanup) pg.cleanup();
  }
  T.report();
})();
