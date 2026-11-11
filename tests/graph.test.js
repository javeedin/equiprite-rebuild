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
  if (/\/users/.test(url)) return json(200, { value: [
    { displayName: 'Sandeep Reddy Bommareddy', mail: 'sandeep.reddy@rite.digital' },
    { displayName: 'Tester One', mail: 'tester.one@rite.digital' },
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

  T.section('the directory: relevant people (/me/people) merged with the org directory (/users)');
  const ppl = await store.people('san');
  T.check('people merges suggestions and the directory, deduped by email', ppl.ok
    && ppl.contacts.some((c) => c.email === 'sandeep.reddy@rite.digital') && ppl.contacts.some((c) => c.email === 'hrindia@rite.digital')
    && ppl.contacts.some((c) => c.email === 'tester.one@rite.digital')
    && ppl.contacts.filter((c) => c.email === 'sandeep.reddy@rite.digital').length === 1
    && calls.some((c) => /\/me\/people\?\$search=/.test(c.url)) && calls.some((c) => /\/users\?\$filter=/.test(c.url)));
  T.check('directory=true when /users could be read (User.ReadBasic.All granted)', ppl.directory === true);

  T.section('sending via /me/sendMail');
  const sent = await store.sendMail({ to: 'a@x.com; b@y.com', cc: 'c@z.com', subject: 'Minutes', html: '<b>hi</b>' });
  const sendCall = calls.filter((c) => /\/me\/sendMail$/.test(c.url))[0];
  T.check('sendMail posts the HTML message with both recipients and the Cc', sent.ok && /"contentType":"HTML"/.test(sendCall.body)
    && /a@x.com/.test(sendCall.body) && /b@y.com/.test(sendCall.body) && /ccRecipients/.test(sendCall.body) && /c@z.com/.test(sendCall.body));

  T.section('token refresh when the access token has expired');
  // force expiry
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'graph.json'), 'utf8'));
  raw.tokens.expiresAt = Date.now() - 1000;
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(raw));
  const store2 = G.open({ file: path.join(dir, 'graph.json'), encrypt: enc, decrypt: dec, fetch: fakeFetch, openExternal });
  const tok = await store2._token();
  T.check('an expired access token is refreshed with the refresh token', tok === 'AT2' && calls.some((c) => /grant_type=refresh_token/.test(c.body)));

  T.section('directory not granted: relevant people still returned, directory=false');
  const fetch403 = (url, init) => (/\/users/.test(url) ? Promise.resolve({ status: 403, text: async () => JSON.stringify({ error: { message: 'Authorization_RequestDenied' } }) }) : fakeFetch(url, init));
  const store403 = G.open({ file: path.join(dir, 'graph.json'), encrypt: enc, decrypt: dec, fetch: fetch403, openExternal });
  const ppl403 = await store403.people('san');
  T.check('without User.ReadBasic.All: relevant people (/me/people) still come back, directory=false', ppl403.ok
    && ppl403.contacts.some((c) => c.email === 'sandeep.reddy@rite.digital') && ppl403.directory === false
    && !ppl403.contacts.some((c) => c.email === 'tester.one@rite.digital'));

  T.section('signed in on a valid access token even without a refresh token');
  const accFile = path.join(dir, 'graph-acc.json');
  fs.writeFileSync(accFile, JSON.stringify({ tenantId: 't', clientId: 'c', account: 'me@x', tokens: { access: 'enc:' + Buffer.from('AX').toString('base64'), refresh: null, expiresAt: Date.now() + 3600000 } }));
  T.check('a valid access token alone counts as signed in', G.open({ file: accFile, encrypt: enc, decrypt: dec, fetch: fakeFetch }).status().signedIn === true);
  fs.writeFileSync(accFile, JSON.stringify({ tenantId: 't', clientId: 'c', tokens: { access: 'enc:' + Buffer.from('AX').toString('base64'), refresh: null, expiresAt: Date.now() - 1000 } }));
  T.check('an expired access token with no refresh is not signed in', G.open({ file: accFile, encrypt: enc, decrypt: dec, fetch: fakeFetch }).status().signedIn === false);

  T.section('sign-in falls back to base scopes when the directory scope is not available');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-graph2-'));
  const fbCalls = [];
  const fbFetch = (url, init) => {
    const body = (init && init.body) || '';
    fbCalls.push(body);
    if (/\/devicecode$/.test(url) && /User\.ReadBasic\.All/.test(body)) return Promise.resolve({ status: 400, text: async () => JSON.stringify({ error: 'invalid_scope', error_description: 'AADSTS70011 scope User.ReadBasic.All is invalid' }) });
    if (/\/devicecode$/.test(url)) return Promise.resolve({ status: 200, text: async () => JSON.stringify({ device_code: 'DC2', user_code: 'WXYZ-1234', verification_uri: 'https://microsoft.com/devicelogin', interval: 2, expires_in: 900 }) });
    return Promise.resolve({ status: 400, text: async () => JSON.stringify({ error: 'authorization_pending' }) });
  };
  const store5 = G.open({ file: path.join(dir2, 'g.json'), encrypt: enc, decrypt: dec, fetch: fbFetch, openExternal });
  store5.saveConfig({ tenantId: 't', clientId: 'c' });
  const b2 = await store5.beginSignIn();
  T.check('sign-in retries without User.ReadBasic.All and still starts', b2.ok === true && b2.userCode === 'WXYZ-1234'
    && fbCalls.some((b) => /User\.ReadBasic\.All/.test(b)) && fbCalls.some((b) => /scope=/.test(b) && !/User\.ReadBasic\.All/.test(b)));
  store5.signOut();
  try { fs.rmSync(dir2, { recursive: true, force: true }); } catch (e) { /* temp */ }

  T.section('admin approval required: a clear message, not a raw AADSTS code');
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-graph3-'));
  const acFetch = (url) => {
    if (/\/devicecode$/.test(url)) return Promise.resolve({ status: 200, text: async () => JSON.stringify({ device_code: 'DC3', user_code: 'AAAA-BBBB', verification_uri: 'https://microsoft.com/devicelogin', interval: 1, expires_in: 900 }) });
    if (/\/token$/.test(url)) return Promise.resolve({ status: 400, text: async () => JSON.stringify({ error: 'access_denied', error_description: 'AADSTS90094: The grant requires admin permission.' }) });
    return Promise.resolve({ status: 404, text: async () => '{}' });
  };
  const store6 = G.open({ file: path.join(dir3, 'g.json'), encrypt: enc, decrypt: dec, fetch: acFetch, openExternal });
  store6.saveConfig({ tenantId: 't', clientId: 'c' });
  await store6.beginSignIn();
  await new Promise((r) => setTimeout(r, 2600));
  T.check('when the tenant needs admin approval, the error explains it (not a raw code)', /administrator to approve/i.test(store6.status().error) && store6.status().signedIn === false);
  try { fs.rmSync(dir3, { recursive: true, force: true }); } catch (e) { /* temp */ }

  T.section('sign out');
  T.check('sign out clears the session', store2.signOut().signedIn === false);

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
  T.report();
})();
