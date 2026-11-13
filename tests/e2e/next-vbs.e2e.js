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
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ items: [{ name: 'Package' }, { name: 'Deploy to DEV' }] }) }) });
  const env = await E.start({ port: 19960, app: 'next', product: 'buildrite', vbsStore: vbs });
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
    await page.fill('#vbsOUser', 'rite.user');
    await page.fill('#vbsOPass', SECRET);
    await page.click('#vbsSaveOrg');
    await page.waitForSelector('#vbsOrgList .nx-vbs-org', { timeout: 10000 }).catch(() => {});
    const saved = fs.readFileSync(path.join(dir, 'vbs.json'), 'utf8');
    T.check('saved: in the list (its user, no projects yet, not checked yet); the address as its organization\'s page', /^Saved: Rite demo\./.test(await text(page, '#vbsResult'))
      && /Rite demo\s*rite\.user · 0 projects\s*Not checked yet/.test(await text(page, '#vbsOrgList')) && (await text(page, '#vbsOrgUrl')) === ORG_URL && !(await page.$('#vbsOrgForm')), await text(page, '#vbsOrgList'));
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
    T.check('edit: its name, address, user filled in; the password empty (never read back)', (await page.inputValue('#vbsOName')) === 'Rite demo' && (await page.inputValue('#vbsOUrl')) === ORG_URL && (await page.inputValue('#vbsOUser')) === 'rite.user'
      && (await page.inputValue('#vbsOPass')) === '' && /Leave empty to keep the saved password/.test(await page.getAttribute('#vbsOPass', 'placeholder')));
    await page.fill('#vbsOName', 'Rite demo (DEV)');
    await page.click('#vbsSaveOrg');
    await page.waitForFunction(() => /Saved: Rite demo \(DEV\)/.test((document.getElementById('vbsResult') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('…saved without a password: the saved one kept (a project still checks)', /Rite demo \(DEV\)/.test(await text(page, '#vbsOrgList')) && !!vbs.auth(vbs.state().orgs[0].id));
    page.once('dialog', (d) => d.accept());
    await page.click('#vbsProjects [data-act="removeProject"]');
    await page.waitForFunction(() => !document.querySelector('#vbsProjects .nx-vbs-project'), null, { timeout: 5000 }).catch(() => {});
    T.check('the project removed (nothing changes in VB Studio)', !(await page.$('#vbsProjects .nx-vbs-project')) && /^Removed: EquipRite\.$/.test(await text(page, '#vbsResult')) && vbs.state().projects.length === 0);
    T.check('no errors in the browser console', errs().length === 0, errs().join(' | '));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
