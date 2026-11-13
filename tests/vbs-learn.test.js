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

T.section('projects: from the calls, the Git addresses, the project lists');
l.see({ url: base + '/rest/' + ORG + '/projects?offset=0', status: 200, json: { count: 2, items: [
  { identifier: 'equiprite_1234', displayName: 'EquipRite', description: SECRET_VALUE, owner: { username: 'rite.user' } },
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
  { workspaceId: 'w-2', displayName: 'Release 26D', gitBranch: 'release-26d', repositoryUrl: base + '/s/' + ORG + '_equiprite_1234/scm/equiprite.git', createdBy: 'rite.user' }] } });
const ws = l.found().workspaces;
T.check('each workspace: its project, name, branch, repository, owner (whatever the fields are called)', ws.length === 2
  && JSON.stringify(ws.map((w) => [w.project, w.name, w.branch, w.repo, w.owner])) === JSON.stringify([['equiprite_1234', 'javeed-26c-titles', 'ws-javeed', 'equiprite', 'javeed.shaik'], ['equiprite_1234', 'Release 26D', 'release-26d', 'equiprite', 'rite.user']]), JSON.stringify(ws));

T.section('what Build.Rite saw: paths and field names only, never a value');
const calls = l.calls();
const all = JSON.stringify(calls);
T.check('the calls: their paths (ids hidden as <org>, <org>_<project>) and the shape of their answers', calls.some((c) => c.path === '/<org>/rest/<org>/projects' && /items: \[2\] \{ identifier, displayName, description, owner: \{ username \} \}/.test(c.shape))
  && calls.some((c) => c.path === '/<org>/rest/<org>_<project>/workspaces/v1/workspaces') && all.indexOf(ORG) === -1 && all.indexOf(SECRET_VALUE) === -1 && all.indexOf('javeed') === -1 && all.indexOf('equiprite_1234') === -1, all.slice(0, 600));

T.section('merged across visits');
const l2 = L.learner();
l2.see({ url: base + '/rest/' + ORG + '_billing/scm/v2/repositories', json: [{ httpUrl: base + '/s/' + ORG + '_billing/scm/billing-ui.git' }] });
l2.see({ url: base + '/rest/' + ORG + '_equiprite_1234/workspaces/v1/workspaces', json: { items: [{ id: 'w-1', name: 'javeed-26c-titles', branch: 'ws-javeed-2' }] } });
const m = L.merge(Object.assign(l.found(), { calls: l.calls() }), Object.assign(l2.found(), { calls: l2.calls() }));
const bl = m.projects.filter((p) => p.project === 'billing')[0];
T.check('a second visit: its repositories added to the known project (its name kept); a workspace updated, not doubled', bl.name === 'Billing portal' && bl.repos.length === 1 && bl.repos[0].repo === 'billing-ui'
  && m.workspaces.length === 2 && m.workspaces.filter((w) => w.id === 'w-1')[0].branch === 'ws-javeed-2' && m.orgs.length === 2 && m.calls.length >= calls.length, JSON.stringify(m.workspaces));
T.report();
