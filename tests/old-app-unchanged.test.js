/*
 * Old EquipRite stays exactly as it is.
 *
 * The redesign (New EquipRite, webApps/equiprite) is built next to today's app so users can be shown both. The
 * promise is that nothing under webApps/vbredwoodapp changes while that happens, so this suite fails on any
 * difference from BASELINE, the last commit before the redesign started, including new or deleted files.
 *
 * If the old app is ever changed on purpose (a fix agreed for both apps), move BASELINE to that commit in the
 * same change, so the decision is visible in review; or, for a change asked for in Old alone, name its files in AGREED
 * below with the reason, so every other file is still held to the baseline.
 *
 * Needs git and the baseline commit in history; it says so and passes when either is missing (a zip download or
 * a shallow clone), because it cannot tell either way there.
 *
 * Run:  node tests/old-app-unchanged.test.js
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const OLD_APP = 'webApps/vbredwoodapp';
const BASELINE = 'c653d203dfef7fab7872ce4958e59ec9e7ad7439'; // claude/local-run-harness, 29 Oct 2026, before the redesign code

// Changes asked for in Old, each with its reason. A path ending in '/' covers everything under it.
const AGREED = [
  { why: 'Jira stories page, asked for in Old and Next on 5 Nov 2026 (reads the EquipRite Jira backlog, read only)',
    paths: [
      'webApps/vbredwoodapp/resources/js/jiraBacklog.js',            // identical to Next's (tests/jira-backlog.test.js)
      'webApps/vbredwoodapp/resources/js/testRecorder.js',           // Record on a story, identical to Next's (tests/test-recorder.test.js)
      'webApps/vbredwoodapp/flows/setup/pages/jira-stories-page.html',
      'webApps/vbredwoodapp/flows/setup/pages/jira-stories-page.js',
      'webApps/vbredwoodapp/flows/setup/pages/jira-stories-page.json',
      'webApps/vbredwoodapp/flows/setup/pages/jira-stories-page-chains/',
      'webApps/vbredwoodapp/flows/setup/pages/jira-sprint-page.html',     // one sprint, from Jira Stories' By sprint
      'webApps/vbredwoodapp/flows/setup/pages/jira-sprint-page.js',
      'webApps/vbredwoodapp/flows/setup/pages/jira-sprint-page.json',
      'webApps/vbredwoodapp/flows/setup/pages/jira-sprint-page-chains/',
      'webApps/vbredwoodapp/flows/setup/setup-flow.json',              // the page registered in its flow
      'webApps/vbredwoodapp/app-flow.js',                               // its menu item and route (Administrator)
      'webApps/vbredwoodapp/app-flow.json',
      'webApps/vbredwoodapp/pages/shell-page-chains/navigateChain.js',
      'webApps/vbredwoodapp/resources/data/jiraStoriesSearchConfig.json'
    ] }
];
const agreed = (file) => AGREED.some((a) => a.paths.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p)));

const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

T.section('Old EquipRite (webApps/vbredwoodapp) unchanged since the redesign started');
const known = git('cat-file', '-e', `${BASELINE}^{commit}`);
if (known.error || known.status !== 0) {
  console.log(`  skip  no git, or commit ${BASELINE} is not in this clone`);
} else {
  const changed = git('diff', '--name-status', BASELINE, '--', OLD_APP).stdout.trim().split('\n').filter(Boolean)
    .filter((l) => !agreed(l.split('\t').pop()));
  T.check('no tracked file differs from the baseline, beyond the agreed changes', !changed.length, changed.join('\n'));
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', OLD_APP).stdout.trim().split('\n').filter(Boolean)
    .filter((f) => !agreed(f));
  T.check('no new files added, beyond the agreed changes', !untracked.length, untracked.join('\n'));
  T.check('every agreed change says why', AGREED.every((a) => a.why && a.paths.length));
}
T.report();
