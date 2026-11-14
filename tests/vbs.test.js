#!/usr/bin/env node
'use strict';
/**
 * Visual Builder Studio for Build.Rite (desktop/lib/vbs.js): an organization (its page's address, a name, the sign-in —
 * the password encrypted, never given back) and its projects, each added by its Git address (the project id read from
 * it), checked: its branches (git ls-remote, the sign-in only in git's environment) and its build jobs (VB Studio's
 * builds API); refused sign-ins, other organizations, wrong addresses said in words; saved and read again; removed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const V = require('../desktop/lib/vbs');

const T = H.makeAsserter();
const ORG_URL = 'https://acme-dev1-demo-phx.developer.ocp.oraclecloud.com/acme-dev1-demo-phx/';
const REPO = 'https://acme-dev1-demo-phx.developer.ocp.oraclecloud.com/acme-dev1-demo-phx/s/acme-dev1-demo-phx_equiprite_1234/scm/equiprite.git';

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-vbs-'));
  try {
    T.section('addresses');
    const o = V.parseOrgUrl(ORG_URL.replace('https://', '').replace(/\/$/, '') + '/#/projects');
    T.check('the organization\'s page: its host and organization (with or without https://, a trailing part ignored)', o && o.host === 'acme-dev1-demo-phx.developer.ocp.oraclecloud.com' && o.org === 'acme-dev1-demo-phx' && o.url === ORG_URL, JSON.stringify(o));
    T.check('…no organization in it, or not https: said', V.parseOrgUrl('https://acme.oraclecloud.com/').org === '' && V.parseOrgUrl('http://acme.oraclecloud.com/x/') === null && V.parseOrgUrl('') === null);
    const r = V.parseRepoUrl(REPO.replace('https://', 'https://demo.user@'));
    T.check('a project\'s Git address: its organization, project id and repository (a user name in it left out)', r && r.org === 'acme-dev1-demo-phx' && r.project === 'equiprite_1234' && r.repo === 'equiprite' && r.repoUrl === REPO, JSON.stringify(r));
    T.check('…not a VB Studio Git address: none', V.parseRepoUrl('https://github.com/acme/equiprite.git') === null && V.parseRepoUrl('https://x/acme/s/other_p/scm/r.git') === null);
    T.check('git\'s branches and its HEAD; VB Studio\'s jobs (whatever list it answers with)', JSON.stringify(V.branchesOf('ref: refs/heads/main\tHEAD\nabc1234\tHEAD\nabc1234\trefs/heads/main\ndef5678\trefs/heads/ws-javeed\n')) === '{"branches":["main","ws-javeed"],"head":"main"}'
      && V.jobsOf({ items: [{ name: 'Package' }, { name: 'Deploy' }] }).join() === 'Package,Deploy' && V.jobsOf([{ jobName: 'Build' }]).join() === 'Build' && V.jobsOf(null).length === 0);
    T.check('what went wrong, in words', /refused/.test(V.why('fatal: Authentication failed for'))
      && /no such repository/.test(V.why('', 404)) && /Could not reach/.test(V.why('Could not resolve host: x')) && /may not open/.test(V.why('', 403)));

    T.section('an organization: its sign-in kept encrypted, never given back');
    const enc = (t) => Buffer.from('enc:' + Buffer.from(t, 'utf8').toString('base64'));
    const dec = (b) => { const s = b.toString(); if (s.indexOf('enc:') !== 0) throw new Error('bad'); return Buffer.from(s.slice(4), 'base64').toString('utf8'); };
    const gitCalls = [], fetchCalls = [];
    let gitAnswer = { code: 0, stdout: 'ref: refs/heads/main\tHEAD\n1111111\trefs/heads/main\n2222222\trefs/heads/ws-javeed\n3333333\trefs/heads/release-26c\n', stderr: '' };
    let jobsAnswer = { ok: true, status: 200, body: { items: [{ name: 'Package' }, { name: 'Deploy to DEV' }] } };
    const store = V.open({ file: path.join(tmp, 'vbs.json'), encrypt: enc, decrypt: dec,
      git: (args, auth) => { gitCalls.push({ args: args, auth: auth }); return gitAnswer; },
      fetch: async (url, init) => { fetchCalls.push({ url: url, init: init }); return { ok: jobsAnswer.ok, status: jobsAnswer.status, text: async () => JSON.stringify(jobsAnswer.body) }; } });
    let threw = '';
    try { store.saveOrg({ url: ORG_URL, user: 'demo.user' }); } catch (e) { threw = e.message; }
    T.check('a new organization needs its password', /Enter the password/.test(threw) && store.state().orgs.length === 0, threw);
    const so = store.saveOrg({ name: 'Rite demo', url: ORG_URL, user: 'demo.user', password: 'S3cret!#' });
    const file = fs.readFileSync(path.join(tmp, 'vbs.json'), 'utf8');
    T.check('saved: its name, address, user; the password encrypted in the file, never given back', so.ok && so.org.name === 'Rite demo' && so.org.org === 'acme-dev1-demo-phx' && so.org.hasPassword && so.org.keychain
      && file.indexOf('S3cret') === -1 && JSON.stringify(store.state()).indexOf('S3cret') === -1 && JSON.stringify(store.state()).indexOf('password') === -1, file.slice(0, 300));
    const again = store.saveOrg({ id: so.org.id, name: 'Rite demo (DEV)', url: ORG_URL, user: 'demo.user', password: '' });
    T.check('saved again without a password: the saved one kept', again.org.name === 'Rite demo (DEV)' && again.org.hasPassword && store.auth(so.org.id).header === 'Basic ' + Buffer.from('demo.user:S3cret!#').toString('base64'));
    try { threw = ''; store.saveOrg({ url: 'https://acme.oraclecloud.com/', user: 'x', password: 'y' }); } catch (e) { threw = e.message; }
    T.check('an address without its organization: said', /has no organization in it/.test(threw), threw);

    T.section('a project, by its Git address: its branches and build jobs');
    const ap = await store.addProject({ orgId: so.org.id, repoUrl: REPO, name: 'EquipRite' });
    T.check('added: its project id from the address; its branches (the workspaces\' pushed ones too), its default branch, its build jobs', ap.ok && ap.project.project === 'equiprite_1234' && ap.project.name === 'EquipRite'
      && ap.project.branches.join() === 'main,release-26c,ws-javeed' && ap.project.head === 'main' && ap.project.jobs.join() === 'Package,Deploy to DEV' && !ap.project.jobsError, JSON.stringify(ap));
    T.check('…git asked for the branches with the sign-in for that host only (not in the address)', gitCalls[0].args.join(' ') === 'ls-remote --symref ' + REPO
      && gitCalls[0].auth.host === 'acme-dev1-demo-phx.developer.ocp.oraclecloud.com' && /^Basic /.test(gitCalls[0].auth.header) && gitCalls[0].args.join(' ').indexOf('S3cret') === -1);
    T.check('…VB Studio\'s builds API asked for its jobs (project-scoped, signed in)', fetchCalls[0].url === 'https://acme-dev1-demo-phx.developer.ocp.oraclecloud.com/acme-dev1-demo-phx/rest/acme-dev1-demo-phx_equiprite_1234/cibuild/v1/jobs'
      && /^Basic /.test(fetchCalls[0].init.headers.Authorization) && store.state().orgs[0].checked.ok && store.state().orgs[0].projects === 1, JSON.stringify(fetchCalls[0]));
    T.check('the same repository twice: said', /added already/.test((await store.addProject({ orgId: so.org.id, repoUrl: REPO })).error));
    T.check('a repository of another organization: said', /in another organization/.test((await store.addProject({ orgId: so.org.id, repoUrl: 'https://other-host.oraclecloud.com/other/s/other_p/scm/r.git' })).error));
    T.check('not a VB Studio Git address: said, with the shape to copy', /Repositories tab, like https:\/\/acme-dev1-demo-phx\.developer\.ocp\.oraclecloud\.com\/acme-dev1-demo-phx\/s\/acme-dev1-demo-phx_<project>\/scm\/<repo>\.git/.test((await store.addProject({ orgId: so.org.id, repoUrl: 'https://github.com/a/b.git' })).error));
    gitAnswer = { code: 128, stdout: '', stderr: 'fatal: Authentication failed for \'https://…\'' };
    const bad = await store.addProject({ orgId: so.org.id, repoUrl: REPO.replace('equiprite.git', 'other.git') });
    T.check('a refused sign-in: said in words; not added; the organization marked', !bad.ok && /username or password was refused/.test(bad.error) && store.state().projects.length === 1 && store.state().orgs[0].checked.ok === false, bad.error);
    gitAnswer = { code: 0, stdout: '1111111\trefs/heads/main\n', stderr: '' };
    jobsAnswer = { ok: false, status: 403, body: {} };
    const ck = await store.checkProject(ap.project.id);
    T.check('checked again: its branches now; the jobs not readable (said), the branches still fine', ck.ok && ck.project.branches.join() === 'main' && ck.project.head === 'main' && /may not open/.test(ck.project.jobsError), JSON.stringify(ck.project));

    T.section('Find in VB Studio: what its pages showed, kept; set up or added marked; no values copied');
    const Ln = require('../desktop/lib/vbsLearn');
    const lr = Ln.learner();
    const B = 'https://acme-dev1-demo-phx.developer.ocp.oraclecloud.com/acme-dev1-demo-phx';
    lr.see({ url: B + '/rest/acme-dev1-demo-phx/projects', json: { items: [{ identifier: 'equiprite_1234', displayName: 'EquipRite', description: 'Rentals' }, { identifier: 'billing', displayName: 'Billing portal' }] } });
    lr.see({ url: B + '/rest/acme-dev1-demo-phx_billing/scm/v2/repositories', json: [{ httpUrl: B + '/s/acme-dev1-demo-phx_billing/scm/billing-ui.git' }, { httpUrl: REPO }] });
    lr.see({ url: B + '/rest/acme-dev1-demo-phx_equiprite_1234/workspaces/v1/workspaces', json: { items: [{ id: 'w1', name: 'javeed-26c', branch: 'ws-javeed', owner: 'javeed.shaik' }] } });
    const dsc = store.learn(Object.assign(lr.found(), { calls: lr.calls() }));
    const eqp = dsc.projects.filter((x) => x.project === 'equiprite_1234')[0], bil = dsc.projects.filter((x) => x.project === 'billing')[0];
    T.check('kept: its organization (set up here), its projects (EquipRite\'s repository added here, Billing\'s not), its workspace', dsc.orgs.length === 1 && dsc.orgs[0].orgId === so.org.id
      && eqp.name === 'EquipRite' && eqp.repos[0].added && bil.name === 'Billing portal' && bil.repos.length === 1 && !bil.repos[0].added && bil.orgId === so.org.id
      && dsc.workspaces.length === 1 && dsc.workspaces[0].branch === 'ws-javeed' && dsc.calls === 3 && !!dsc.at, JSON.stringify(dsc).slice(0, 500));
    const dg = store.diagnostic();
    T.check('"Copy what Build.Rite saw": the calls as paths and field names, counts — no name, id or value', /"calls"/.test(dg) && /\/<org>\/rest\/<org>_<project>\/workspaces\/v1\/workspaces/.test(dg) && /"projects": 2/.test(dg)
      && dg.indexOf('EquipRite') === -1 && dg.indexOf('billing') === -1 && dg.indexOf('javeed') === -1 && dg.indexOf('acme') === -1, dg.slice(0, 400));
    store.setFinder(true, ORG_URL);
    T.check('the VB Studio window open: said', store.discovered().finder.open && store.discovered().finder.url === ORG_URL);
    T.check('cleared', store.clearDiscovered().projects.length === 0 && store.discovered().calls === 0);

    T.section('read again; removed');
    const st2 = V.open({ file: path.join(tmp, 'vbs.json'), encrypt: enc, decrypt: dec, git: () => gitAnswer, fetch: async () => ({ ok: true, status: 200, text: async () => '[]' }) });
    T.check('another start of the app: the organization and its project, the sign-in still there (decrypted)', st2.state().orgs.length === 1 && st2.state().projects.length === 1 && st2.state().orgs[0].hasPassword && !!st2.auth(so.org.id));
    const noKey = V.open({ file: path.join(tmp, 'vbs2.json') });
    const nk = noKey.saveOrg({ url: ORG_URL, user: 'u', password: 'p' });
    T.check('no keychain: the password for this run only (not written)', nk.org.hasPassword && !nk.org.keychain && fs.readFileSync(path.join(tmp, 'vbs2.json'), 'utf8').indexOf('"password": "p"') === -1);
    T.check('a project removed; the organization removed with its projects', store.removeProject(ap.project.id).projects.length === 0 && (await store.addProject({ orgId: so.org.id, repoUrl: REPO })).ok
      && store.removeOrg(so.org.id).orgs.length === 0 && store.state().projects.length === 0);

    T.section('real git: the sign-in in git\'s environment, a real repository read');
    try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
    const bare = path.join(tmp, 'origin.git'), work = path.join(tmp, 'work');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
    fs.mkdirSync(work); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work });
    fs.writeFileSync(path.join(work, 'a.txt'), 'a\n');
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e', 'add', '-A'], { cwd: work }); execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e', 'commit', '-q', '-m', 'a'], { cwd: work });
    execFileSync('git', ['push', '-q', bare, 'main', 'main:ws-one'], { cwd: work });
    const real = V.open({ file: path.join(tmp, 'vbs3.json'), encrypt: enc, decrypt: dec });
    const rr = await real.git(['ls-remote', '--symref', bare], null);
    T.check('git ls-remote through the store\'s own git (no prompts): the branches and HEAD', rr.code === 0 && JSON.stringify(V.branchesOf(rr.stdout)) === '{"branches":["main","ws-one"],"head":"main"}', rr.stderr + rr.stdout);
    T.report();
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
    T.report();
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
})();
