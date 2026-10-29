/*
 * Old EquipRite stays exactly as it is.
 *
 * The redesign (New EquipRite, webApps/equiprite) is built next to today's app so users can be shown both. The
 * promise is that nothing under webApps/vbredwoodapp changes while that happens, so this suite fails on any
 * difference from BASELINE, the last commit before the redesign started, including new or deleted files.
 *
 * If the old app is ever changed on purpose (a fix agreed for both apps), move BASELINE to that commit in the
 * same change, so the decision is visible in review.
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

const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

T.section('Old EquipRite (webApps/vbredwoodapp) unchanged since the redesign started');
const known = git('cat-file', '-e', `${BASELINE}^{commit}`);
if (known.error || known.status !== 0) {
  console.log(`  skip  no git, or commit ${BASELINE} is not in this clone`);
} else {
  const changed = git('diff', '--name-status', BASELINE, '--', OLD_APP).stdout.trim();
  T.check('no tracked file differs from the baseline', !changed, changed);
  const untracked = git('ls-files', '--others', '--exclude-standard', '--', OLD_APP).stdout.trim();
  T.check('no new files added', !untracked, untracked);
}
T.report();
