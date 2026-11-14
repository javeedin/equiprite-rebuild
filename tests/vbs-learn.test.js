#!/usr/bin/env node
'use strict';
/**
 * Find in VB Studio (desktop/lib/vbsLearn.js): organizations, projects (with their Git addresses) and workspaces
 * recognised in what VB Studio's own pages load — from the addresses called and the JSON answered — never from a sign-in
 * call or another site; the calls summed up as paths and field names only (no value); merged across visits.
 */
const H = require('./_harness');
const L = require('../desktop/lib/vbsLearn');

const T = H.makeAsserter();
const HOST = 'acme-dev1-demo-phx.developer.ocp.oraclecloud.com';
const ORG = 'acme-dev1-demo-phx';
const base = 'https://' + HOST + '/' + ORG;
const SECRET_VALUE = 'Quarterly revenue 4,2M — do not share';

const l = L.learner();
T.section('organizations');
T.check('the organization of a page visited, and of any VB Studio address in the data', l.see({ url: base + '/#/projects', status: 200 })
  && l.see({ url: base + '/rest/me/organizations', status: 200, json: { items: [{ name: 'Other org', url: 'https://other-dev2-demo-iad.developer.ocp.oraclecloud.com/other-dev2-demo-iad/' }] } })
  && l.found().orgs.map((o) => o.org).sort().join() === ORG + ',other-dev2-demo-iad', JSON.stringify(l.found().orgs));
T.check('never another site, never a sign-in call', !l.see({ url: 'https://github.com/x', json: { a: 1 } }) && !l.see({ url: 'https://idcs-123.identity.oraclecloud.com/oauth2/v1/token', json: { access_token: 'x' } })
  && !l.see({ url: base + '/oauth2/token', json: { access_token: 'x' } }) && l.calls().every((c) => !/token|oauth/.test(c.path)));

T.check('VB Studio\'s own services are not organizations (api2, static, rest…), from the addresses called or in the data', (() => {
  const l4 = L.learner();
  l4.see({ url: 'https://' + HOST + '/api2/v2/whatever', json: { a: 1 } });
  l4.see({ url: base + '/api2/v2/organization/current', json: { links: ['https://' + HOST + '/api2/v2/x', 'https://' + HOST + '/static/app.js', 'https://' + HOST + '/' + ORG + '/'] } });
  return l4.found().orgs.map((o) => o.org).join() === ORG && L.isOrgId(ORG) && !L.isOrgId('api2') && !L.isOrgId('static');
})());

T.section('projects: from the calls, the Git addresses, the project lists');
l.see({ url: base + '/rest/' + ORG + '/projects?offset=0', status: 200, json: { count: 2, items: [
  { identifier: 'equiprite_1234', displayName: 'EquipRite', description: SECRET_VALUE, owner: { username: 'demo.user' } },
  { identifier: 'billing', displayName: 'Billing portal', description: 'B' }] } });
l.see({ url: base + '/rest/' + ORG + '_equiprite_1234/scm/v2/repositories', status: 200, json: [
  { name: 'equiprite', httpUrl: base + '/s/' + ORG + '_equiprite_1234/scm/equiprite.git', sshUrl: 'ssh://x' },
  { name: 'docs', cloneUrl: base + '/s/' + ORG + '_equiprite_1234/scm/docs.git' }] });
l.see({ url: base + '/rest/' + ORG + '_reports/cibuild/v1/jobs', status: 200, json: { items: [] } });
const pr = l.found().projects;
const eq = pr.filter((p) => p.project === 'equiprite_1234')[0] || {};
T.check('a project list: each project\'s id, name, description', eq.name === 'EquipRite' && eq.description === SECRET_VALUE && (pr.filter((p) => p.project === 'billing')[0] || {}).name === 'Billing portal', JSON.stringify(pr));
T.check('its Git addresses: each repository (https), the project known by them', eq.repos.map((r) => r.repo + '=' + r.url).join(' | ') === 'equiprite=' + base + '/s/' + ORG + '_equiprite_1234/scm/equiprite.git | docs=' + base + '/s/' + ORG + '_equiprite_1234/scm/docs.git', JSON.stringify(eq.repos));
T.check('a project only seen in a call\'s address: known too (its name later)', pr.some((p) => p.project === 'reports' && p.org === ORG));
T.check('…a project\'s repositories are not taken for projects: exactly its three projects', pr.map((p) => p.project).sort().join() === 'billing,equiprite_1234,reports', pr.map((p) => p.project).join());

T.section('workspaces');
l.see({ url: base + '/rest/' + ORG + '_equiprite_1234/workspaces/v1/workspaces', status: 200, json: { items: [
  { id: 'w-1', name: 'javeed-26c-titles', branch: 'ws-javeed', repository: { name: 'equiprite' }, owner: { username: 'javeed.shaik' } },
  { workspaceId: 'w-2', displayName: 'Release 26D', gitBranch: 'release-26d', repositoryUrl: base + '/s/' + ORG + '_equiprite_1234/scm/equiprite.git', createdBy: 'demo.user' }] } });
const ws = l.found().workspaces;
T.check('each workspace: its project, name, branch, repository, owner (whatever the fields are called)', ws.length === 2
  && JSON.stringify(ws.map((w) => [w.project, w.name, w.branch, w.repo, w.owner])) === JSON.stringify([['equiprite_1234', 'javeed-26c-titles', 'ws-javeed', 'equiprite', 'javeed.shaik'], ['equiprite_1234', 'Release 26D', 'release-26d', 'equiprite', 'demo.user']]), JSON.stringify(ws));

T.section('what Build.Rite saw: paths and field names only, never a value');
const calls = l.calls();
const all = JSON.stringify(calls);
T.check('the calls: their paths (ids hidden as <org>, <org>_<project>) and the shape of their answers', calls.some((c) => c.path === '/<org>/rest/<org>/projects' && /items: \[2\] \{ identifier, displayName, description, owner: \{ username \} \}/.test(c.shape))
  && calls.some((c) => c.path === '/<org>/rest/<org>_<project>/workspaces/v1/workspaces') && all.indexOf(ORG) === -1 && all.indexOf(SECRET_VALUE) === -1 && all.indexOf('javeed') === -1 && all.indexOf('equiprite_1234') === -1, all.slice(0, 600));

T.check('…each call: what it is for (projects, repositories, workspaces), its paging parameters (nothing else from its query)', (() => {
  const l3 = L.learner();
  l3.see({ url: base + '/rest/' + ORG + '/projects?offset=0&limit=25&q=SECRET&owner=SECRET', json: { items: [] } });
  l3.see({ url: base + '/rest/' + ORG + '_equiprite_1234/scm/v2/repositories', json: [] });
  l3.see({ url: base + '/rest/' + ORG + '_equiprite_1234/workspaces/v1/workspaces?limit=50', json: { items: [] } });
  const c = l3.calls();
  return c[0].role === 'projects' && c[0].query === 'offset=0&limit=25' && c[1].role === 'repos' && c[2].role === 'workspaces' && c[2].query === 'limit=50' && JSON.stringify(c).indexOf('SECRET') === -1;
})());

T.section('as VB Studio addresses them (…/s2/<org>_<project>/…)');
T.check('a project\'s workspaces (…/s2/…/vbdt/design/workspaces): inside that project, with their environment and when last opened; its repositories (…/scm/api/repository)', (() => {
  const l5 = L.learner();
  const s2 = base + '/s2/' + ORG + '_rebuild-app_100010';
  l5.see({ url: s2 + '/vbdt/design/workspaces', json: { items: [{ id: 'w1', name: 'Dev_One', repository: 'app.git', branch: 'dev-one', environment: { name: 'OICDEMO' }, lastOpened: 1763084220000, owner: 'demo.user' }] } });
  l5.see({ url: s2 + '/scm/api/repository', json: [{ name: 'app', httpUrl: base + '/s/' + ORG + '_rebuild-app_100010/scm/app.git' }] });
  const f = l5.found();
  const w = f.workspaces[0] || {};
  const c = l5.calls();
  return w.project === 'rebuild-app_100010' && w.environment === 'OICDEMO' && w.lastOpened === '1763084220000' && w.repo === 'app' && f.projects.length === 1 && f.projects[0].repos.length === 1
    && c.map((x) => x.path + '=' + x.role).join() === '/<org>/s2/<org>_<project>/vbdt/design/workspaces=workspaces,/<org>/s2/<org>_<project>/scm/api/repository=repos';
})());
T.check('…a call about one project (…/projects/<name>/get, …/projects/stat) is not a list of projects; VB Studio\'s services (cloudgate…) are not organizations', (() => {
  const l6 = L.learner();
  l6.see({ url: base + '/api2/projects/rebuild-app/get', json: { members: [{ id: 'm1', name: 'Someone' }], links: ['https://' + HOST + '/cloudgate/v1/x', 'https://' + HOST + '/' + ORG + '/s2/' + ORG + '_x/scm/a.git'] } });
  l6.see({ url: base + '/api2/projects/stat', json: { items: [{ id: 'p', name: 'n' }] } });
  return l6.found().projects.length === 0 && l6.found().orgs.map((o) => o.org).join() === ORG;
})());
T.check('…a workspace read before outside its project: replaced when read inside it (not doubled)', (() => {
  const a = { orgs: [], projects: [{ host: HOST, org: ORG, project: 'rebuild-app_100010', repos: [] }], workspaces: [{ host: HOST, org: ORG, project: '', id: 'w1', name: 'Dev_One' }], calls: [] };
  const m2 = L.merge(a, { workspaces: [{ host: HOST, org: ORG, project: 'rebuild-app_100010', id: 'w1', name: 'Dev_One', branch: 'dev-one' }] });
  return m2.workspaces.length === 1 && m2.workspaces[0].project === 'rebuild-app_100010';
})());

T.section('merged across visits');
const l2 = L.learner();
l2.see({ url: base + '/rest/' + ORG + '_billing/scm/v2/repositories', json: [{ httpUrl: base + '/s/' + ORG + '_billing/scm/billing-ui.git' }] });
l2.see({ url: base + '/rest/' + ORG + '_equiprite_1234/workspaces/v1/workspaces', json: { items: [{ id: 'w-1', name: 'javeed-26c-titles', branch: 'ws-javeed-2' }] } });
const m = L.merge(Object.assign(l.found(), { calls: l.calls() }), Object.assign(l2.found(), { calls: l2.calls() }));
const bl = m.projects.filter((p) => p.project === 'billing')[0];
T.check('a second visit: its repositories added to the known project (its name kept); a workspace updated, not doubled', bl.name === 'Billing portal' && bl.repos.length === 1 && bl.repos[0].repo === 'billing-ui'
  && m.workspaces.length === 2 && m.workspaces.filter((w) => w.id === 'w-1')[0].branch === 'ws-javeed-2' && m.orgs.length === 2 && m.calls.length >= calls.length, JSON.stringify(m.workspaces));
T.report();
