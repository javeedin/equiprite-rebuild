'use strict';

/**
 * Runs first in "npm run build" (and so in serve, desktop and desktop:fresh): Oracle's build tool in
 * node_modules must be at least the Visual Builder version this app is written for
 * (visual-application.json "source.version", 2701 = Visual Builder 27.01). Otherwise vb-process-local
 * stops with "Project's source.version … is newer than current build tool version"; this says what to do.
 *
 * Plain Node, no native code, no shell (eScan-safe).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** "2701.0.3" -> 2701; anything unreadable -> 0. */
function release(version) {
  const m = String(version || '').match(/^(\d{4})/);
  return m ? Number(m[1]) : 0;
}

/** { ok, app, tool, message } for the app's source.version and the installed tool's version ('' when missing). */
function checkTools(appVersion, toolVersion) {
  const app = release(appVersion);
  const tool = release(toolVersion);
  if (!toolVersion) {
    return { ok: false, app, tool, message: "Oracle's build tool (@oracle/grunt-vb-build) is not installed. Run: npm install" };
  }
  if (tool < app) {
    return {
      ok: false,
      app,
      tool,
      message: [
        `This app is Visual Builder ${app}, but the build tool in node_modules is ${tool} (@oracle/grunt-vb-build ${toolVersion}).`,
        'Get the new tools (a terminal, in this folder):',
        '  rm -rf node_modules/@oracle      (Windows: rmdir /s /q node_modules\\@oracle)',
        '  npm install',
        '  npm ls @oracle/grunt-vb-build    (should show ' + app + '…)',
        'If npm install fails to download grunt-vb-build, send its error lines.',
      ].join('\n'),
    };
  }
  return { ok: true, app, tool, message: '' };
}

module.exports = { checkTools, release };

if (require.main === module) {
  const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'visual-application.json'), 'utf8'))['source.version'];
  let toolVersion = '';
  try {
    toolVersion = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', '@oracle', 'grunt-vb-build', 'package.json'), 'utf8')).version;
  } catch {
    toolVersion = '';
  }
  const result = checkTools(appVersion, toolVersion);
  if (!result.ok) {
    console.error(`\ncheck-tools: ${result.message}\n`);
    process.exit(1);
  }
}
