'use strict';
/*
 * EquipRite Next's toolbar QR code: EquipRite Mobile on your phone. In a plain browser (as under VBCS without Mobile's
 * address known), inside the desktop app with nothing set up ("Set it up" opens its phone window), and with the VBCS
 * address and this PC's Wi-Fi both set up: the code, the other way, the address. Each code is read back from the image
 * and compared with the QR code of the address it should open (the desktop app's own lib/phone.js).
 * Needs `npm run build`. Run: node tests/e2e/next-phone.e2e.js
 */
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const phone = require(path.join(__dirname, '..', '..', 'desktop', 'lib', 'phone.js'));

const T = H.makeAsserter();
const VBCS = 'https://eqp-abc.builder.us-ashburn-1.ocp.oraclecloud.com/ic/builder/rt/EquipRite_Rebuild/live/webApps/equiprite-mobile/?from=qr';
const LAN = 'http://192.168.1.23:18898/?pair=Zk3yZk3yZk3yZk3yZk3y&from=qr';

/** The modules drawn in the panel's QR image, as rows of booleans (the quiet zone of 4 taken off). */
function modulesOf(src) {
  const svg = decodeURIComponent(String(src).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  const total = Number((/viewBox="0 0 (\d+) /.exec(svg) || [])[1]);
  const n = total - 8;
  const m = Array.from({ length: n }, () => Array(n).fill(false));
  (svg.match(/M(\d+) (\d+)h1v1h-1z/g) || []).forEach((p) => {
    const [x, y] = p.match(/\d+/g).map(Number);
    m[y - 4][x - 4] = true;
  });
  return m;
}
const same = (a, b) => a.length === b.length && a.every((r, i) => r.every((v, j) => v === b[i][j]));

async function openPanel(env) {
  await env.open('/');
  await env.page.click('#nxPhone');
  await env.page.waitForSelector('#nxPhonePanel');
  await env.page.waitForFunction(() => !/Getting the code/.test(document.querySelector('#nxPhonePanel').innerText), null, { timeout: 10000 });
}

(async () => {
  let env = await E.start({ port: 19410, app: 'next' });
  try {
    T.section('in a browser, Mobile\'s address not reachable by a phone');
    await openPanel(env);
    T.check('the toolbar has the QR button, and it opens the panel', (await env.page.getAttribute('#nxPhone', 'aria-expanded')) === 'true');
    T.check('no code for this PC\'s own address (localhost): it says why', !(await env.page.$('#nxPhoneQr'))
      && /not known here/.test(await env.text('#nxPhoneEmpty')));
    T.check('no desktop set-up button outside the desktop app', !(await env.page.$('#nxPhoneSetup')));
    await env.page.keyboard.press('Escape');
    await env.page.waitForSelector('#nxPhonePanel', { state: 'detached', timeout: 5000 });
    T.check('Escape closes it', true);
    await env.page.click('#nxPhone');
    await env.page.waitForSelector('#nxPhonePanel');
    await env.page.mouse.click(400, 600);
    await env.page.waitForSelector('#nxPhonePanel', { state: 'detached', timeout: 5000 });
    T.check('a click outside closes it', true);
    await env.page.click('#nxPhone');
    await env.page.waitForSelector('#nxPhonePanel');
    await env.page.keyboard.press('Escape');
    await env.page.click('#nxUser');
    await env.page.waitForSelector('#nxProfilePanel');
    T.check('your menu opens with it closed', !(await env.page.$('#nxPhonePanel')));
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
  } finally {
    await env.close();
  }

  env = await E.start({ port: 19420, app: 'next', desktop: { phone: {} } });
  try {
    T.section('in the desktop app, nothing set up');
    await openPanel(env);
    T.check('it says to set it up', /Set it up once/.test(await env.text('#nxPhoneEmpty')));
    T.eq('Set it up', await env.text('#nxPhoneSetup'), 'Set it up');
    await env.page.click('#nxPhoneSetup');
    await env.page.waitForSelector('#nxPhonePanel', { state: 'detached', timeout: 5000 });
    T.eq('it opens the desktop app\'s phone window', await env.page.evaluate(() => window.__openedPhone || 0), 1);
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
  } finally {
    await env.close();
  }

  env = await E.start({ port: 19430, app: 'next', desktop: { phone: { vbcs: VBCS, lan: LAN } } });
  try {
    T.section('in the desktop app, VBCS and this PC\'s Wi-Fi set up');
    await openPanel(env);
    await env.page.waitForSelector('#nxPhoneQr');
    T.eq('two ways, VBCS first', await env.page.$$eval('.nx-phone-ways button', (b) => b.map((x) => x.textContent.trim() + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')).join()), 'From VBCS*,This PC over Wi-Fi');
    T.eq('its address', await env.text('#nxPhoneUrl'), VBCS);
    T.check('the code opens it', same(modulesOf(await env.page.getAttribute('#nxPhoneQr', 'src')), phone.qrMatrix(VBCS)));
    await env.shot('next-phone-vbcs.png');
    await env.page.click('.nx-phone-ways button[data-key="lan"]');
    await env.page.waitForFunction((u) => document.querySelector('#nxPhoneUrl').textContent.trim() === u, LAN, { timeout: 5000 });
    T.check('the other way: this PC\'s Wi-Fi code', same(modulesOf(await env.page.getAttribute('#nxPhoneQr', 'src')), phone.qrMatrix(LAN)));
    T.check('it says the phone works as you', /works as you/.test(await env.text('#nxPhonePanel')));
    await env.shot('next-phone-lan.png');
    await env.page.click('#nxPhonePanel .nx-panel-head .nx-iconbtn');
    await env.page.waitForSelector('#nxPhonePanel', { state: 'detached', timeout: 5000 });
    await env.page.click('#nxPhone');
    await env.page.waitForSelector('#nxPhoneQr');
    T.eq('opened again: the way chosen before', await env.text('#nxPhoneUrl'), LAN);
    T.eq('Change how the phone connects: the desktop window', await env.text('#nxPhoneSetup'), 'Change how the phone connects');
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('next-phone-failure.png').catch(() => {});
  } finally {
    await env.close();
  }
  T.report();
})();
