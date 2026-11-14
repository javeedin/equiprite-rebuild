#!/usr/bin/env node
'use strict';
/**
 * VB Studio as Build.Rite shows it (webApps/equiprite-next/resources/js/vbsView.js): the projects listed (an organization's,
 * matching a search, by name in natural order, with their repositories and workspaces counted) and one project's tab (its
 * repositories, its workspaces the last opened first, as VB Studio lists them). A workspace read without its project id
 * still found by the project's short name.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
let V = null;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'webApps', 'equiprite-next', 'resources', 'js', 'vbsView.js'), 'utf8'), { define: (deps, f) => { V = f(); } });

const H1 = 'acme-dev1-demo-phx.developer.ocp.oraclecloud.com', O = 'acme-dev1-demo-phx';
const found = {
  orgs: [{ host: H1, org: O }, { host: H1, org: 'other-org' }],
  projects: [
    { host: H1, org: O, project: 'app-10_100010', name: 'App 10', description: 'Ten', repos: [{ repo: 'app', url: 'https://x/app.git', added: true }, { repo: 'tools', url: 'https://x/tools.git' }] },
    { host: H1, org: O, project: 'app-2_100002', name: 'App 2', repos: [] },
    { host: H1, org: 'other-org', project: 'misc_1', name: 'Misc', repos: [] },
  ],
  workspaces: [
    { host: H1, org: O, project: 'app-10_100010', id: 'w1', name: 'Dev_One', owner: 'demo.user', repo: 'app', branch: 'dev-one', environment: 'OICDEMO', lastOpened: new Date(2026, 10, 12, 9, 5).toISOString() },
    { host: H1, org: O, project: 'app-10', id: 'w2', name: 'QA_Two', lastOpened: String(new Date(2026, 10, 14, 1, 37).getTime()) }, // read without its id: the short name
    { host: H1, org: O, project: '', id: 'w3', name: 'Lost' }, // no project: never shown in one
    { host: H1, org: 'other-org', project: 'app-10_100010', id: 'w4', name: 'Elsewhere' }, // another organization
  ],
};

T.section('the projects listed');
const all = V.projectRows(found, '', '');
T.check('every organization\'s, by name in natural order (App 2 before App 10); repositories and workspaces counted', all.map((r) => r.name + ':' + r.reposText + ':' + r.wsText).join(' | ') === 'App 2:—:— | App 10:2 repositories:2 workspaces | Misc:—:—', all.map((r) => r.name + ':' + r.reposText + ':' + r.wsText).join(' | '));
T.check('…one organization\'s; matching a search (name, id or description)', V.projectRows(found, H1 + '/other-org', '').map((r) => r.name).join() === 'Misc' && V.projectRows(found, '', 'ten').map((r) => r.name).join() === 'App 10' && V.projectRows(found, '', '100002').map((r) => r.name).join() === 'App 2');
T.check('…each row: its key (its tab\'s), id, organization', all[1].key === H1 + '/' + O + '/app-10_100010' && all[1].project === 'app-10_100010' && all[1].org === O);

T.section('a project\'s tab');
const p = V.project(found, H1 + '/' + O + '/app-10_100010');
T.check('its name, id, description; its repositories (added to Build.Rite or not)', p.name === 'App 10' && p.project === 'app-10_100010' && p.description === 'Ten' && p.repos.map((r) => r.repo + (r.added ? '+' : '')).join() === 'app+,tools' && p.orgKey === H1 + '/' + O);
T.check('its workspaces, the last opened first — one read without its id found by the short name; none from another organization, none without a project',
  p.workspaces.map((w) => w.name).join() === 'QA_Two,Dev_One', p.workspaces.map((w) => w.name).join());
const w = p.workspaces[1];
T.check('…each as VB Studio lists it: name, owner, repository, branch, environment, last opened (a date, or milliseconds, shown as a date)', w.owner === 'demo.user' && w.repo === 'app' && w.branch === 'dev-one' && w.environment === 'OICDEMO' && w.lastOpened === '12 Nov 2026, 09:05'
  && p.workspaces[0].lastOpened === '14 Nov 2026, 01:37' && p.workspaces[0].branch === '—' && p.workspaces[0].environment === '—', JSON.stringify(p.workspaces));
T.check('a project not among what was found: none', V.project(found, H1 + '/' + O + '/nope') === null && V.project(null, 'x') === null);
T.check('when, as VB Studio may give it: seconds, milliseconds, a date, or its own words', V.opened('') === '—' && V.opened(String(Math.floor(new Date(2026, 0, 2, 3, 4).getTime() / 1000))) === '2 Jan 2026, 03:04' && V.opened('yesterday') === 'yesterday');
T.report();
