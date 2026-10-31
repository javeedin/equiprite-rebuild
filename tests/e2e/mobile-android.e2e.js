'use strict';
/*
 * EquipRite Mobile and EquipRite for Android (android/). On an Android phone's browser, opened from the desktop app's
 * Wi-Fi QR code: the offer to install has "Open in the EquipRite app" (into the app with this PC's address, or its
 * download from the PC). Inside the app (its user agent and window.EquipRiteApp): no offer to install, and Me says
 * which PC it is connected to, with "Connect to another PC". On Android under VBCS (no app served): the usual offer.
 * Needs `npm run build`. Run: node tests/e2e/mobile-android.e2e.js
 */
const http = require('http');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const phone = require(path.join(__dirname, '..', '..', 'desktop', 'lib', 'phone.js'));

const T = H.makeAsserter();
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const IN_APP = ANDROID + ' EquipRiteApp/1.0 (Android)';
const ACCESS = { EQR_PROJ_CREATE_REQUEST: 'FULL', EQR_EQUIPMENT_REQUESTS: 'FULL' };

const shown = (sel) => `${sel}:visible`;
const location = (url) => new Promise((resolve) => {
  http.get(url, (res) => { res.resume(); resolve({ status: res.statusCode, to: res.headers.location || '' }); }).on('error', () => resolve({ status: 0, to: '' }));
});

(async () => {
  let env = await E.start({ port: 20900, app: 'mobile', access: ACCESS, userAgent: ANDROID, phoneApp: true });
  try {
    T.section('an Android phone\'s browser, from the PC\'s Wi-Fi QR code');
    await env.open('/?from=qr');
    await env.page.waitForSelector('#mbInstall', { timeout: 15000 });
    await env.page.waitForSelector('#mbOpenApp', { timeout: 10000 });
    T.eq('the offer leads with the EquipRite app', await env.text('#mbOpenApp'), 'Open in the EquipRite app');
    T.eq('…which this PC hands over', await env.page.getAttribute('#mbOpenApp', 'href'), '/__app/open');
    T.check('…saying the first tap downloads it', /downloads the app from your PC/.test(await env.text('#mbInstall')));
    T.check('…with adding the page to the home screen as the other way', /Or add this page to the home screen/i.test(await env.text('#mbInstall')));
    T.eq('…and a plain download, to update an older app', await env.page.getAttribute('#mbGetApp', 'href'), '/__app/EquipRite.apk');
    await env.shot('mobile-android-offer.png');
    const open = await location(`${env.mobileUrl}/__app/open`);
    const port = Number(env.mobileUrl.split(':').pop());
    T.eq('the link opens the app with this PC\'s address and the pairing key', open.to, phone.appIntent(`localhost:${port}`, 'test-pair-key'));
    T.check('…or downloads it', /S\.browser_fallback_url=.*__app%2FEquipRite\.apk/.test(open.to));
    await env.page.click('#mbInstallLater');
    await env.page.click('.mb-tabbtn[data-tab="me"]');
    await env.page.waitForSelector(shown('#meOpenApp'), { timeout: 10000 });
    T.check('Me offers the app too', (await env.page.getAttribute('#meOpenApp', 'href')) === '/__app/open');
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('mobile-android-failure.png').catch(() => {});
  } finally {
    await env.close();
  }

  env = await E.start({ port: 20910, app: 'mobile', access: ACCESS, userAgent: IN_APP, phoneApp: true,
    init: () => { window.EquipRiteApp = { info: () => '{"app":"android","version":"1.0","pc":"192.168.1.23:18898"}', changePc: () => { window.__changedPc = (window.__changedPc || 0) + 1; } }; } });
  try {
    T.section('inside EquipRite for Android');
    await env.open('/?from=app');
    await env.page.waitForTimeout(800);
    T.check('no offer to install: it is the app', !(await env.page.$('#mbInstall')));
    await env.open('/?from=qr');
    await env.page.waitForTimeout(800);
    T.check('not even when the address came from a QR code', !(await env.page.$('#mbInstall')));
    await env.page.click('.mb-tabbtn[data-tab="me"]');
    await env.page.waitForSelector(shown('#meApp'), { timeout: 10000 });
    T.check('Me: the app, its version', /The EquipRite app for Android 1\.0/.test(await env.text('#meApp')));
    T.eq('…and the PC it is connected to', await env.text('#mePc'), 'Connected to EquipRite on the PC at 192.168.1.23:18898.');
    T.check('no install steps here', !(await env.page.$('#meSteps')) && !(await env.page.$('#meOpenApp')));
    const served = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', '..', 'desktop', 'phone-app', 'version.json'), 'utf8')).versionName;
    await env.page.waitForSelector(shown('#meUpdate'), { timeout: 10000 });
    T.eq('the app (1.0) is told the PC has a newer one, and how to get it (1.0 cannot fetch it itself)', [await env.text('#meUpdate'), !!(await env.page.$('#meUpdateBtn'))].join(' | '),
      `EquipRite ${served} is on your PC. To get it: scan the PC's code with this phone's camera, and tap Download the app on the page that opens. | false`);
    await env.shot('mobile-android-in-app-me.png');
    await env.page.click('#meChangePc');
    await env.page.waitForFunction(() => window.__changedPc === 1, null, { timeout: 5000 });
    T.check('Connect to another PC: the app\'s first screen', true);
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
    await env.shot('mobile-android-failure-2.png').catch(() => {});
  } finally {
    await env.close();
  }

  env = await E.start({ port: 20930, app: 'mobile', access: ACCESS, userAgent: IN_APP.replace('1.0', '1.1'), phoneApp: true,
    init: () => {
      window.EquipRiteApp = { info: () => '{"app":"android","version":"1.1","pc":"192.168.1.23:18898","scan":true}', changePc() {},
        update: () => { window.__updated = (window.__updated || 0) + 1; }, scan() {} };
    } });
  try {
    T.section('inside EquipRite for Android 1.1');
    await env.open('/');
    await env.page.click('.mb-tabbtn[data-tab="me"]');
    await env.page.waitForSelector(shown('#meApp'), { timeout: 10000 });
    await env.page.waitForTimeout(800);
    T.check('up to date: no update offered', !(await env.page.$('#meUpdate')));
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
  } finally {
    await env.close();
  }

  env = await E.start({ port: 20940, app: 'mobile', access: ACCESS, userAgent: IN_APP.replace('1.0', '1.1'), phoneApp: true,
    init: () => {
      window.EquipRiteApp = { info: () => '{"app":"android","version":"1.0.9","pc":"192.168.1.23:18898","scan":true}', changePc() {},
        update: () => { window.__updated = (window.__updated || 0) + 1; }, scan() {} };
    } });
  try {
    T.section('an app that can fetch its update (1.1 and later), older than the PC\'s');
    await env.open('/');
    await env.page.click('.mb-tabbtn[data-tab="me"]');
    await env.page.waitForSelector(shown('#meUpdateBtn'), { timeout: 10000 });
    await env.page.click('#meUpdateBtn');
    await env.page.waitForFunction(() => window.__updated === 1, null, { timeout: 5000 });
    T.check('Update the app: the app fetches it from the PC', /Downloading the new app/.test(await env.text('#meNote')));
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
  } finally {
    await env.close();
  }

  env = await E.start({ port: 20920, app: 'mobile', access: ACCESS, userAgent: ANDROID });
  try {
    T.section('an Android phone\'s browser under VBCS (no app served there)');
    await env.open('/?from=qr');
    await env.page.waitForSelector('#mbInstall', { timeout: 15000 });
    await env.page.waitForTimeout(500);
    T.check('the usual offer, without the app', !(await env.page.$('#mbOpenApp')) && (await env.page.$$eval('#mbInstallSteps li', (l) => l.length)) >= 2);
    T.check('the steps are Android\'s', /Install app/.test(await env.text('#mbInstallSteps')));
    T.eq('no browser errors', env.errors.join(' | '), '');
  } catch (e) {
    T.check('run finished', false, e && e.stack);
  } finally {
    await env.close();
  }
  T.report();
})();
