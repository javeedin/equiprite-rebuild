/*
 * Microsoft 365 / Graph for the Minutes page (desktop/lib/graph.js), with a fake fetch: the device-code sign-in (poll to
 * a token), tokens kept encrypted and refreshed, the directory from /me/people, and sending via /me/sendMail. No network.
 *
 * Run:  node tests/graph.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const G = require('../desktop/lib/graph');

const enc = (t) => Buffer.from('enc:' + Buffer.from(t).toString('base64'));
const dec = (b) => Buffer.from(String(b).replace(/^enc:/, ''), 'base64').toString();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-graph-'));

const calls = [];
let tokenCalls = 0;
function fakeFetch(url, init) {
  const body = (init && init.body) || '';
  calls.push({ url, method: (init && init.method) || 'GET', body });
  const json = (status, obj) => Promise.resolve({ status, text: async () => JSON.stringify(obj) });
  if (/\/devicecode$/.test(url)) return json(200, { device_code: 'DC', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', interval: 2, expires_in: 900, message: 'Open the page and enter ABCD-EFGH' });
  if (/\/token$/.test(url) && /grant_type=urn/.test(body)) { tokenCalls += 1; return json(200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }); }
  if (/\/token$/.test(url) && /grant_type=refresh_token/.test(body)) return json(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 });
  if (/\/me$/.test(url)) return json(200, { userPrincipalName: 'javeed@rite.digital' });
  if (/\/me\/people/.test(url)) return json(200, { value: [
    { displayName: 'Sandeep Reddy Bommareddy', scoredEmailAddresses: [{ address: 'sandeep.reddy@rite.digital' }] },
    { displayName: 'HR India', scoredEmailAddresses: [{ address: 'hrindia@rite.digital' }] },
  ] });
  if (/\/me\/sendMail$/.test(url)) return Promise.resolve({ status: 202, text: async () => '' });
  return json(404, { error: { message: 'no route ' + url } });
}
const opened = [];
const openExternal = (u) => opened.push(u);

(async () => {
  const store = G.open({ file: path.join(dir, 'graph.json'), encrypt: enc, decrypt: dec, fetch: fakeFetch, openExternal });

  T.section('configuration');
  T.check('not configured until tenant + client are set', store.status().configured === false);
  const s = store.saveConfig({ tenantId: 'tenant-123', clientId: 'client-abc' });
  T.check('configured once both are set, not signed in yet', s.configured === true && s.signedIn === false);

  T.section('device-code sign-in');
  const begin = await store.beginSignIn();
  T.check('begin returns a user code + verification URL and opens the browser', begin.ok && begin.userCode === 'ABCD-EFGH' && /devicelogin/.test(begin.verificationUri) && opened.length === 1);
  T.check('status is pending while the user signs in', store.status().pending === true);
  // the poll fires on the device-code interval (>= 2s)
  await new Promise((r) => setTimeout(r, 2600));
  const after = store.status();
  T.check('after the user signs in: signed in, the account known, not pending', after.signedIn === true && after.account === 'javeed@rite.digital' && after.pending === false && tokenCalls >= 1);
  T.check('the token file does not hold the tokens in clear text', !fs.readFileSync(path.join(dir, 'graph.json'), 'utf8').includes('RT1'));

  T.section('the directory from /me/people (like Outlook suggestions)');
  const ppl = await store.people('san');
  T.check('people returns name + email from Graph', ppl.ok && ppl.contacts.length === 2 && ppl.contacts[0].email === 'sandeep.reddy@rite.digital'
    && calls.some((c) => /\/me\/people\?\$search=/.test(c.url)));

  T.section('sending via /me/sendMail');
  const sent = await store.sendMail({ to: 'a@x.com; b@y.com', subject: 'Minutes', html: '<b>hi</b>' });
  const sendCall = calls.filter((c) => /\/me\/sendMail$/.test(c.url))[0];
  T.check('sendMail posts the HTML message with both recipients', sent.ok && /"contentType":"HTML"/.test(sendCall.body) && /a@x.com/.test(sendCall.body) && /b@y.com/.test(sendCall.body));

  T.section('token refresh when the access token has expired');
  // force expiry
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'graph.json'), 'utf8'));
  raw.tokens.expiresAt = Date.now() - 1000;
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(raw));
  const store2 = G.open({ file: path.join(dir, 'graph.json'), encrypt: enc, decrypt: dec, fetch: fakeFetch, openExternal });
  const tok = await store2._token();
  T.check('an expired access token is refreshed with the refresh token', tok === 'AT2' && calls.some((c) => /grant_type=refresh_token/.test(c.body)));

  T.section('sign out');
  T.check('sign out clears the session', store2.signOut().signedIn === false);

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
  T.report();
})();
