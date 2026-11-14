#!/usr/bin/env node
'use strict';
/**
 * Build.Rite's Setup → Organizations & projects, end to end in the browser, with the real store (desktop/lib/vbs.js) and
 * stand-ins for git and VB Studio's builds API:
 *   first in Build.Rite's menu → no organization: its form open → saved (the password emptied at once, kept encrypted,
 *   never in the page) → a project added by its Git address: signed in, its branches (the default one marked) and build
 *   jobs → a wrong address, a refused sign-in: said → checked again → the organization edited (the password kept) →
 *   the project removed. Needs npm run build.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const V = require('../../desktop/lib/vbs');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const HOST = 'acme-dev1-demo-phx.developer.ocp.oraclecloud.com';
const ORG = 'acme-dev1-demo-phx';
const ORG_URL = 'https://' + HOST + '/' + ORG + '/';
const REPO = 'https://' + HOST + '/' + ORG + '/s/' + ORG + '_equiprite_1234/scm/equiprite.git';
const SECRET = 'Pa55-w0rd#e2e';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-vbs-e2e-'));
  const enc = (t) => Buffer.from('enc:' + Buffer.from(t, 'utf8').toString('base64'));
  const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString('utf8');
  const gitSeen = [];
  let branches = 'ref: refs/heads/main\tHEAD\n1111111\tHEAD\n1111111\trefs/heads/main\n2222222\trefs/heads/release-26c\n3333333\trefs/heads/ws-javeed\n';
  const vbs = V.open({ file: path.join(dir, 'vbs.json'), encrypt: enc, decrypt: dec,
    git: (args, auth) => { gitSeen.push({ args: args, auth: auth }); return /other\.git/.test(args.join(' ')) ? { code: 128, stdout: '', stderr: 'fatal: Authentication failed' } : { code: 0, stdout: branches, stderr: '' }; },
    // VB Studio's API: its builds (jobs); for Sync, the organization's projects (10 a page, 23 in all; the calls its pages
    // make), each project's repositories (refused with the username and password, read with the window's session) and workspaces
    fetch: async (url, init) => vbsApi(url, init && init.headers && init.headers.Authorization ? 'basic' : 'none'),
    sessionFetch: async (url) => vbsApi(url, 'session'),
    pageFetch: async (url) => (signedOut ? { signIn: true } : vbsApi(url, 'page')) });
  const syncSeen = [];
  let signedOut = false; // VB Studio's session expired: its page sends its sign-in page
  function vbsApi(url, how) {
    const u = new URL(url);
    const ans = (status, body) => ({ ok: status < 300, status: status, text: async () => JSON.stringify(body) });
    if (/\/cibuild\/v1\/jobs$/.test(u.pathname)) return ans(200, { items: [{ name: 'Package' }, { name: 'Deploy to DEV' }] });
    if (signedOut) return ans(401, {});
    syncSeen.push(how + ' ' + u.pathname.split(ORG).join('<org>') + u.search);
    if (u.pathname === '/' + ORG + '/rest/' + ORG + '/projects') {
      const all = [{ identifier: 'equiprite_1234', displayName: 'EquipRite' }].concat(Array.from({ length: 22 }, (x, i) => ({ identifier: 'app_' + (i + 1), displayName: 'App ' + (i + 1) })));
      const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 10);
      return ans(200, { items: all.slice(off, off + lim), totalResults: all.length, hasMore: off + lim < all.length });
    }
    const m = new RegExp('^/' + ORG + '/rest/' + ORG + '_([^/]+)/(scm/v2/repositories|workspaces/v1/workspaces)$').exec(u.pathname);
    if (m && m[2][0] === 's') return how === 'session' ? ans(200, [{ name: m[1] + '-ui', httpUrl: 'https://' + HOST + '/' + ORG + '/s/' + ORG + '_' + m[1] + '/scm/' + m[1] + '-ui.git' }]) : ans(401, {});
    if (m) return ans(200, { items: m[1] === 'app_7' ? [{ id: 'w9', name: 'app7-hotfix', branch: 'ws-hotfix', repository: { name: 'app_7-ui' }, owner: { username: 'demo.user' } }] : [] });
    return ans(404, {});
  }
  // Find in VB Studio: the desktop app's VB Studio window, here a stand-in that "browses" — the organization's projects,
  // a project's repositories and workspaces, another organization — fed to the real learner, then closes
  const L = require('../../desktop/lib/vbsLearn');
  const opened = [];
  const B = 'https://' + HOST + '/' + ORG;
  const vbsFind = async (url) => {
    opened.push(url);
    vbs.setFinder(true, url, true);
    vbs.finderLog('opening ' + url);
    vbs.finderLog('redirected to https://idcs-0000.identity.oraclecloud.com/ui/v1/signin   (Oracle\'s sign-in: sign in here)');
    const lr = L.learner();
    setTimeout(() => {
      lr.see({ url: url, status: 200 });
      lr.see({ url: B + '/rest/' + ORG + '/projects', status: 200, json: { items: [{ identifier: 'equiprite_1234', displayName: 'EquipRite', description: 'Rentals' }, { identifier: 'billing', displayName: 'Billing portal' }, { identifier: 'reports', displayName: 'Reports' }] } });
      lr.see({ url: B + '/rest/' + ORG + '_billing/scm/v2/repositories', status: 200, json: [{ name: 'billing-ui', httpUrl: B + '/s/' + ORG + '_billing/scm/billing-ui.git' }] });
      lr.see({ url: B + '/rest/' + ORG + '_equiprite_1234/scm/v2/repositories', status: 200, json: [{ name: 'equiprite', httpUrl: REPO }] });
      lr.see({ url: B + '/rest/' + ORG + '_equiprite_1234/workspaces/v1/workspaces', status: 200, json: { items: [{ id: 'w1', name: 'javeed-26c-titles', branch: 'ws-javeed', repository: { name: 'equiprite' }, owner: { username: 'javeed.shaik' }, environment: { name: 'OICDEMO' }, lastOpened: new Date(2026, 10, 14, 1, 37).toISOString() },
        { id: 'w2', name: 'Release 26D', branch: 'release-26d', repository: { name: 'equiprite' }, owner: { username: 'demo.user' } }] } });
      lr.see({ url: B + '/rest/me/organizations', status: 200, json: { items: [{ url: 'https://other-dev2-demo-iad.developer.ocp.oraclecloud.com/other-dev2-demo-iad/' }] } });
      vbs.learn(Object.assign(lr.found(), { calls: lr.calls() }));
      vbs.finderLog('read /<org>/rest/' + ORG + '/projects (HTTP 200) — found so far: 2 org · 3 projects · 2 repos · 2 workspaces');
    }, 400);
    setTimeout(() => vbs.setFinder(false, url), 5000);
    return { ok: true, url: url };
  };
  const env = await E.start({ port: 19960, app: 'next', product: 'buildrite', vbsStore: vbs, vbsFind: vbsFind });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('Setup → Organizations & projects: first in Build.Rite\'s menu');
    await env.open('/');
    await page.waitForSelector('#nxNav [data-nav-id]', { timeout: 30000 });
    const items = await page.$$eval('#nxNav [data-nav-id]', (b) => b.map((x) => x.getAttribute('data-nav-id')));
    T.check('first in the menu: Organizations & projects', items[0] === 'projects' && /Organizations & projects/.test(await text(page, '#nxNav [data-nav-id="projects"]')), items.join(','));
    await page.click('#nxNav [data-nav-id="projects"]');
    await page.waitForSelector('#vbsOrgForm', { timeout: 20000 }).catch(() => {});
    T.check('no organization yet: its form open (name, VB Studio address, username, password)', (await text(page, '#vbsTitle')) === 'Organizations & projects' && !!(await page.$('#vbsOrgForm'))
      && (await page.getAttribute('#vbsOPass', 'type')) === 'password' && /Start by adding your Visual Builder Studio organization/.test(await text(page, '#vbsSub')));

    T.section('the organization saved: its password kept encrypted, never in the page');
    await page.fill('#vbsOName', 'Rite demo');
    await page.fill('#vbsOUrl', ORG_URL + '#/projects');
    await page.fill('#vbsOUser', 'demo.user');
    await page.fill('#vbsOPass', SECRET);
    await page.click('#vbsSaveOrg');
    await page.waitForSelector('#vbsOrgList .nx-vbs-org', { timeout: 10000 }).catch(() => {});
    const saved = fs.readFileSync(path.join(dir, 'vbs.json'), 'utf8');
    T.check('saved: in the list (its user, no projects yet, not checked yet); the address as its organization\'s page', /^Saved: Rite demo\./.test(await text(page, '#vbsResult'))
      && /Rite demo\s*demo\.user · 0 projects\s*Not checked yet/.test(await text(page, '#vbsOrgList')) && (await text(page, '#vbsOrgUrl')) === ORG_URL && !(await page.$('#vbsOrgForm')), await text(page, '#vbsOrgList'));
    T.check('…the password: not in the file (encrypted), nor anywhere in the page', saved.indexOf(SECRET) === -1 && (await page.evaluate((s) => document.documentElement.outerHTML.indexOf(s), SECRET)) === -1
      && /kept encrypted on this PC/.test(await text(page, '.nx-vbs-orgstatus')));

    T.section('a project by its Git address: signed in, its branches and build jobs');
    T.check('the address to paste is shown in this organization\'s shape', (await page.getAttribute('#vbsPRepo', 'placeholder')) === 'https://' + HOST + '/' + ORG + '/s/' + ORG + '_<project>/scm/<repository>.git');
    await page.fill('#vbsPRepo', REPO);
    await page.fill('#vbsPName', 'EquipRite');
    await page.click('#vbsAddProjectBtn');
    await page.waitForSelector('#vbsProjects .nx-vbs-project', { timeout: 10000 }).catch(() => {});
    T.check('added and checked: its project and repository, 3 branches (the default one marked), 2 build jobs; the organization signed in', /^Added and checked: EquipRite — signed in; 3 branches, 2 build jobs\.$/.test(await text(page, '#vbsResult'))
      && /EquipRite\s*Project equiprite_1234 · repository equiprite · default branch main/.test(await text(page, '#vbsProjects')) && (await text(page, '#vbsProjects .nx-vbs-chip--head')) === 'main'
      && /main\s*release-26c\s*ws-javeed/.test(await text(page, '#vbsProjects')) && /Package\s*Deploy to DEV/.test(await text(page, '#vbsProjects')) && /^✓ Signed in · /.test(await text(page, '#vbsOrgStatus')), await text(page, '#vbsProjects'));
    T.check('…git asked with the sign-in for that host only (not in the address)', gitSeen[0].args.join(' ') === 'ls-remote --symref ' + REPO && gitSeen[0].auth.host === HOST && /^Basic /.test(gitSeen[0].auth.header) && gitSeen[0].args.join(' ').indexOf(SECRET) === -1);
    await page.fill('#vbsPRepo', 'https://github.com/acme/equiprite.git');
    await page.click('#vbsAddProjectBtn');
    await page.waitForFunction(() => /Repositories tab/.test((document.getElementById('vbsResult') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('not a VB Studio Git address: said, with what to copy', /That is not a VB Studio Git address: copy it from the project's Repositories tab/.test(await text(page, '#vbsResult')));
    await page.fill('#vbsPRepo', REPO.replace('equiprite.git', 'other.git'));
    await page.click('#vbsAddProjectBtn');
    await page.waitForFunction(() => /refused/.test((document.getElementById('vbsResult') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('a refused sign-in: said in words; not added; the organization marked', /The username or password was refused by VB Studio\./.test(await text(page, '#vbsResult')) && (await page.$$('#vbsProjects .nx-vbs-project')).length === 1
      && /^✗ The username or password was refused/.test(await text(page, '#vbsOrgStatus')));
    branches = 'ref: refs/heads/main\tHEAD\n1111111\trefs/heads/main\n4444444\trefs/heads/release-26d\n';
    await page.click('#vbsProjects [data-act="checkProject"]');
    await page.waitForFunction(() => /^Checked: /.test((document.getElementById('vbsResult') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('checked again: its branches now; signed in again', /^Checked: EquipRite — signed in; 2 branches, 2 build jobs\.$/.test(await text(page, '#vbsResult')) && /release-26d/.test(await text(page, '#vbsProjects')) && /^✓ Signed in/.test(await text(page, '#vbsOrgStatus')));
    await env.shot('buildrite-setup.png');

    T.section('edited; removed');
    await page.click('#vbsEditOrg');
    await page.waitForSelector('#vbsOrgForm', { timeout: 3000 }).catch(() => {});
    T.check('edit: its name, address, user filled in; the password empty (never read back)', (await page.inputValue('#vbsOName')) === 'Rite demo' && (await page.inputValue('#vbsOUrl')) === ORG_URL && (await page.inputValue('#vbsOUser')) === 'demo.user'
      && (await page.inputValue('#vbsOPass')) === '' && /Leave empty to keep the saved password/.test(await page.getAttribute('#vbsOPass', 'placeholder')));
    await page.fill('#vbsOName', 'Rite demo (DEV)');
    await page.click('#vbsSaveOrg');
    await page.waitForFunction(() => /Saved: Rite demo \(DEV\)/.test((document.getElementById('vbsResult') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('…saved without a password: the saved one kept (a project still checks)', /Rite demo \(DEV\)/.test(await text(page, '#vbsOrgList')) && !!vbs.auth(vbs.state().orgs[0].id));
    page.once('dialog', (d) => d.accept());
    await page.click('#vbsProjects [data-act="removeProject"]');
    await page.waitForFunction(() => !document.querySelector('#vbsProjects .nx-vbs-project'), null, { timeout: 5000 }).catch(() => {});
    T.check('the project removed (nothing changes in VB Studio)', !(await page.$('#vbsProjects .nx-vbs-project')) && /^Removed: EquipRite\.$/.test(await text(page, '#vbsResult')) && vbs.state().projects.length === 0);

    T.section('Find in VB Studio: its organizations, projects and workspaces read as you browse');
    await page.click('#vbsFind');
    await page.waitForSelector('#vbsFoundProjects .nx-vbs-ptr[data-found]', { timeout: 10000 }).catch(() => {});
    T.check('VB Studio opened in a window of Build.Rite, at the organization chosen; watched (a spinner) while it is open', opened[0] === ORG_URL && /^VB Studio is open in a window of Build\.Rite \(/.test(await text(page, '#vbsResult'))
      && /The VB Studio window is open: sign in as usual/.test(await text(page, '#vbsFoundNote')) && !!(await page.$('#vbsFoundNote .nx-spin')), await text(page, '#vbsResult'));
    await page.waitForFunction(() => /found so far/.test((document.getElementById('vbsFinderLogText') || {}).textContent || ''), null, { timeout: 6000 }).catch(() => {});
    T.check('the VB Studio window\'s log, live and open while it is open: each step (going to, Oracle\'s sign-in, what it read)', /opening https:\/\/acme-dev1-demo-phx/.test(await text(page, '#vbsFinderLogText'))
      && /Oracle's sign-in: sign in here/.test(await text(page, '#vbsFinderLogText')) && /read \/<org>\/rest\/.*found so far: 2 org/.test(await text(page, '#vbsFinderLogText'))
      && (await page.getAttribute('#vbsFinderLog', 'open')) !== null && /^VB Studio window log · 3 lines$/.test(await text(page, '#vbsFinderLog summary')), await text(page, '#vbsFinderLog'));
    T.check('the projects: 3 projects · 2 repositories · 2 workspaces', (await text(page, '#vbsFoundCounts')) === '3 projects · 2 repositories · 2 workspaces', await text(page, '#vbsFoundCounts'));
    const rows = async () => page.$$eval('#vbsFoundProjects .nx-vbs-ptr[data-found]', (l) => l.map((x) => Array.from(x.querySelectorAll('[role="cell"]')).map((y) => y.textContent.replace(/\s+/g, ' ').trim()).join('|')));
    const r0 = await rows();
    T.check('a row each: its name (opens it), id and description, organization, repositories, workspaces, Open', r0.join(' || ') === 'Billing portal billing|acme-dev1-demo-phx|1 repository|—|Open › || EquipRite equiprite_1234 · Rentals|acme-dev1-demo-phx|1 repository|2 workspaces|Open › || Reports reports|acme-dev1-demo-phx|—|—|Open ›', r0.join(' || '));
    const forg = await page.$$eval('#vbsFoundOrgs .nx-vbs-foundrow', (l) => l.map((x) => Array.from(x.querySelectorAll('b, code, button')).map((y) => y.textContent.trim()).join('|')));
    T.check('another organization in VB Studio, not set up here: with Set up', forg.join(' || ') === 'other-dev2-demo-iad|https://other-dev2-demo-iad.developer.ocp.oraclecloud.com/other-dev2-demo-iad/|Set up', forg.join(' || '));

    T.section('a project, in a tab of its own: its workspaces read at once; its repository added to Build.Rite');
    await page.click('#vbsFoundProjects [data-found="' + HOST + '/' + ORG + '/billing"] .nx-vbs-plink');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#vbspResult')).some((e) => e.offsetParent && /Read from VB Studio/.test(e.textContent)), null, { timeout: 10000 }).catch(() => {});
    T.check('Billing portal opened in a tab: its name, id; no workspace read yet — read from VB Studio at once (none in it); its repository', (await text(page, '#vbspTitle:visible')) === 'Billing portal' && (await text(page, '#vbspSub:visible')) === 'Project billing · acme-dev1-demo-phx'
      && /^Read from VB Studio: 0 workspaces, 1 repository\.$/.test(await text(page, '#vbspResult:visible')) && (await text(page, '#vbspNoWs:visible')) === 'VB Studio lists no workspace in this project.'
      && /billing-ui\s*https:\/\/\S*_billing\/scm\/billing-ui\.git\s*Add to Build\.Rite/.test(await text(page, '#vbspRepoList:visible')), await text(page, '#vbspResult:visible') + ' / ' + await text(page, '#vbspWorkspaces:visible'));
    await page.click('#vbspRepoList:visible [data-act="addRepo"]');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#vbspResult')).some((e) => e.offsetParent && /^Added to Build\.Rite/.test(e.textContent.trim())), null, { timeout: 8000 }).catch(() => {});
    T.check('Add to Build.Rite: checked (signed in, its branches, build jobs) and marked added', /^Added to Build\.Rite and checked: billing-ui — signed in; 2 branches, 2 build jobs\.$/.test(await text(page, '#vbspResult:visible'))
      && /billing-ui.*✓ Added to Build\.Rite/.test(await text(page, '#vbspRepoList:visible')) && vbs.state().projects.some((x) => x.repoUrl === B + '/s/' + ORG + '_billing/scm/billing-ui.git'), await text(page, '#vbspResult:visible'));
    await page.click('#nxNav [data-nav-id="projects"]');
    await page.waitForSelector('#vbsFoundProjects', { state: 'visible', timeout: 5000 }).catch(() => {});
    T.check('back on Organizations & projects: the repository listed as added to Build.Rite', (await page.$$('#vbsProjects .nx-vbs-project')).length === 1 && /Billing portal/.test(await text(page, '#vbsProjects')), await text(page, '#vbsProjects'));
    await page.click('#vbsFoundOrgs [data-act="setupOrg"]');
    await page.waitForSelector('#vbsOrgForm', { timeout: 3000 }).catch(() => {});
    T.check('Set up another organization: its form with its address and name; its sign-in asked', (await page.inputValue('#vbsOUrl')) === 'https://other-dev2-demo-iad.developer.ocp.oraclecloud.com/other-dev2-demo-iad/'
      && (await page.inputValue('#vbsOName')) === 'other-dev2-demo-iad' && (await page.inputValue('#vbsOUser')) === '' && /Enter how you sign in to other-dev2-demo-iad/.test(await text(page, '#vbsResult')));
    await page.click('#vbsCancelOrg');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.click('#vbsDiag');
    await page.waitForFunction(() => /^Copied: the calls/.test((document.getElementById('vbsResult') || {}).textContent || ''), null, { timeout: 3000 }).catch(() => {});
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    T.check('Copy what Build.Rite saw: the calls as paths and field names — no name, id or value', /"calls"/.test(clip) && /<org>_<project>\/workspaces\/v1\/workspaces/.test(clip) && clip.indexOf('Billing') === -1 && clip.indexOf('javeed') === -1 && clip.indexOf(ORG) === -1, clip.slice(0, 300));
    await page.waitForFunction(() => !document.querySelector('#vbsFoundNote .nx-spin'), null, { timeout: 12000 }).catch(() => {});
    T.check('the VB Studio window closed: no longer watched; what was found kept', !(await page.$('#vbsFoundNote .nx-spin')) && /^Read from VB Studio, last on .*Open a project to see its workspaces\.$/.test(await text(page, '#vbsFoundNote')), await text(page, '#vbsFoundNote'));
    await env.shot('buildrite-find-vbs.png');

    T.section('Sync from VB Studio (API): no window — the calls its pages made, made directly');
    const shownBefore = opened.length;
    await page.click('#vbsSync');
    await page.waitForFunction(() => /^Synced from VB Studio/.test((document.getElementById('vbsResult') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    const projSeen = syncSeen.filter((x) => /\/projects/.test(x)).join(' ');
    T.check('synced, no window opened: every project (3 pages of 10), each one\'s repositories and workspaces', /^Synced from VB Studio \(API, no window\): 25 projects, 25 repositories, 1 workspace\.$/.test(await text(page, '#vbsResult')) && opened.length === shownBefore
      && projSeen.replace(/(^| )(basic|session|page) /g, '$1').indexOf('/<org>/rest/<org>/projects /<org>/rest/<org>/projects?offset=10&limit=10 /<org>/rest/<org>/projects?offset=20&limit=10') === 0, await text(page, '#vbsResult') + ' | ' + projSeen);
    T.check('…the repositories, refused once with the username and password, then read with the VB Studio window\'s session (the way that worked kept)', syncSeen.filter((x) => /^basic .*repositories/.test(x)).length === 1 && syncSeen.filter((x) => /^session .*repositories/.test(x)).length === 26
      && /App 22 app_22\|acme-dev1-demo-phx\|1 repository\|—\|Open ›/.test((await rows()).join(' || ')), syncSeen.filter((x) => /repositories/.test(x)).slice(0, 4).join(' | '));
    T.check('the last sync in one line (how it signed in); what it did (closed when it went well): each call, pages and items', /^✓ Synced through VB Studio's API on .*: 25 projects · 25 repositories · 1 workspace — signed in with (your username and password and )?the VB Studio window's session$/.test(await text(page, '#vbsSyncLine'))
      && (await page.getAttribute('#vbsSyncSteps', 'open')) === null && /\/<org>\/rest\/<org>\/projects — projects: 3 pages, 23 items/.test(await text(page, '#vbsSyncStepsText')), await text(page, '#vbsSyncBox'));
    T.check('…App 7: its workspace found by Sync, counted on its row', /App 7 app_7\|acme-dev1-demo-phx\|1 repository\|1 workspace\|Open ›/.test((await rows()).join(' || ')));
    T.check('…the password never in the page', (await page.evaluate((s) => document.documentElement.outerHTML.indexOf(s), SECRET)) === -1);
    await env.shot('buildrite-sync-vbs.png');

    T.section('the filter: an organization (its projects), projects by name');
    const chips = await page.$$eval('#vbsFilters .nx-vbs-fchip', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim() + (x.getAttribute('aria-pressed') === 'true' ? '*' : '')));
    T.check('in the header: All organizations (its projects), each organization (its name as set up, its projects); All chosen', chips.join(' | ') === 'All organizations25* | Rite demo (DEV)25 | other-dev2-demo-iad0', chips.join(' | '));
    await page.click('#vbsFilters .nx-vbs-fchip[data-key="other-dev2-demo-iad.developer.ocp.oraclecloud.com/other-dev2-demo-iad"]');
    await page.waitForSelector('#vbsNoProjects', { timeout: 3000 }).catch(() => {});
    T.check('an organization with no project read: said', (await text(page, '#vbsNoProjects')) === 'No project in this organization.' && (await text(page, '#vbsFoundCounts')) === '0 projects · 0 repositories · 0 workspaces');
    await page.click('#vbsFilters .nx-vbs-fchip[data-key="' + HOST + '/' + ORG + '"]');
    await page.waitForSelector('#vbsFoundProjects', { timeout: 3000 }).catch(() => {});
    T.check('an organization chosen: its projects', (await page.getAttribute('#vbsFilters .nx-vbs-fchip[data-key="' + HOST + '/' + ORG + '"]', 'aria-pressed')) === 'true' && (await text(page, '#vbsFoundCounts')) === '25 projects · 26 repositories · 3 workspaces', await text(page, '#vbsFoundCounts'));
    await page.fill('#vbsFText', 'app 2');
    await page.waitForFunction(() => /^Showing 4 of/.test((document.getElementById('vbsFilterNote') || {}).textContent || ''), null, { timeout: 3000 }).catch(() => {});
    const shownP = await page.$$eval('#vbsFoundProjects .nx-vbs-plink', (l) => l.map((x) => x.textContent.trim()));
    T.check('projects by name: “app 2” → App 2, App 20, App 21, App 22 (said: 4 of 25)', shownP.join() === 'App 2,App 20,App 21,App 22' && /^Showing 4 of 25 projects matching “app 2”\.$/.test(await text(page, '#vbsFilterNote')), shownP.join() + ' / ' + await text(page, '#vbsFilterNote'));
    await page.evaluate(() => { const t = document.getElementById('vbsTitle'); if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start' }); });
    await env.shot('buildrite-vbs-filter.png');
    await page.fill('#vbsFText', '');
    await page.waitForFunction(() => !/matching/.test((document.getElementById('vbsFilterNote') || {}).textContent || ''), null, { timeout: 3000 }).catch(() => {});

    T.section('a project\'s tab: all its workspaces as VB Studio lists them; Refresh workspaces; signed out of VB Studio: sign in, read again');
    await page.click('#vbsFoundProjects [data-found="' + HOST + '/' + ORG + '/equiprite_1234"] [data-act="openProject"].nx-btn');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#vbspTitle')).some((e) => e.offsetParent && e.textContent.trim() === 'EquipRite'), null, { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#vbspWsTable [role="row"]:not(.nx-vbs-wth)')).some((x) => x.offsetParent), null, { timeout: 5000 }).catch(() => {});
    const wsr = await page.$$eval('#vbspWsTable [role="row"]:not(.nx-vbs-wth)', (l) => l.filter((x) => x.offsetParent).map((x) => Array.from(x.querySelectorAll('[role="cell"]')).map((y) => y.textContent.trim()).join('|')));
    T.check('EquipRite: its 2 workspaces, the last opened first — workspace (owner), repository, branch, environment, last opened; as last read (not read again by itself)', (await text(page, '#vbspWsTitle:visible')) === 'Workspaces · 2'
      && wsr.join(' || ') === 'javeed-26c-titlesjaveed.shaik|equiprite|ws-javeed|OICDEMO|14 Nov 2026, 01:37 || Release 26Ddemo.user|equiprite|release-26d|—|—'
      && /^As Build\.Rite last read them from VB Studio\./.test(await text(page, '#vbspStatus:visible')), wsr.join(' || ') + ' / ' + await text(page, '#vbspStatus:visible'));
    await page.fill('#vbspWsQ:visible', 'release');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#vbspWsTable [role="row"]:not(.nx-vbs-wth)')).filter((x) => x.offsetParent).length === 1, null, { timeout: 3000 }).catch(() => {});
    T.check('its workspaces filtered (“release”: Release 26D)', (await page.$$eval('#vbspWsTable [role="row"]:not(.nx-vbs-wth)', (l) => l.filter((x) => x.offsetParent).map((x) => x.querySelector('b').textContent))).join() === 'Release 26D');
    await page.fill('#vbspWsQ:visible', '');
    await page.click('#vbspRefresh:visible');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#vbspStatus')).some((e) => e.offsetParent && /^✓ Read from VB Studio at/.test(e.textContent.trim())), null, { timeout: 8000 }).catch(() => {});
    T.check('Refresh workspaces: read again from VB Studio (that project only): when, how many', /^✓ Read from VB Studio at \d\d:\d\d:\d\d: 2 workspaces, 2 repositories\.$/.test(await text(page, '#vbspStatus:visible'))
      && /^Read from VB Studio: 2 workspaces, 2 repositories\.$/.test(await text(page, '#vbspResult:visible')) && (await page.getAttribute('#vbspSteps:visible', 'open')) === null
      && /workspaces of 1 project: 1 answered/.test(await page.$eval('#vbspStepsText', (e) => e.textContent)), await text(page, '#vbspStatus:visible') + ' / ' + await text(page, '#vbspResult:visible'));
    signedOut = true;
    await page.click('#vbspRefresh:visible');
    await page.waitForSelector('#vbspSignIn', { state: 'visible', timeout: 8000 }).catch(() => {});
    T.check('signed out of VB Studio: said, with Open VB Studio to sign in; what the refresh did shown open', /VB Studio needs you to sign in/.test(await text(page, '#vbspResult:visible')) && !!(await page.$('#vbspSignIn:visible'))
      && (await page.getAttribute('#vbspSteps:visible', 'open')) !== null && /^✗ Not read at/.test(await text(page, '#vbspStatus:visible')), await text(page, '#vbspResult:visible'));
    const openedNow = opened.length;
    await page.click('#vbspSignIn:visible');
    signedOut = false; // signed in, in VB Studio's window
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#vbspStatus')).some((e) => e.offsetParent && /^✓ Read from VB Studio at/.test(e.textContent.trim())), null, { timeout: 20000 }).catch(() => {});
    T.check('…VB Studio\'s window opened at the organization; once closed, the workspaces read again by themselves', opened.length === openedNow + 1 && opened[opened.length - 1] === ORG_URL && /^✓ Read from VB Studio at .*: 2 workspaces/.test(await text(page, '#vbspStatus:visible')), opened.slice(-1)[0] + ' / ' + await text(page, '#vbspStatus:visible'));
    await env.shot('buildrite-vbs-project.png');
    T.check('no errors in the browser console', errs().length === 0, errs().join(' | '));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
