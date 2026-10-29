'use strict';

/**
 * Runs first in "npm run build" (and so in serve, desktop and desktop:fresh): Oracle's build tool in
 * node_modules must be at least the Visual Builder version this app is written for
 * (visual-application.json "source.version", 2701 = Visual Builder 27.01). Otherwise vb-process-local
 * stops with "Project's source.version … is newer than current build tool version"; this says what to do.
 * It also stops on a node_modules inside a copied project folder (e.g. desktop/), which breaks the build.
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

// Folders vb-process-local does not copy into build/processed (grunt-vb-build copyVisualApplicationBuilder).
const NOT_COPIED = new Set(['build', '.git', 'node_modules', 'mobileApps', 'webApps', 'services']);

/**
 * Every other top-level folder is copied into build/processed, and the copy dies on a nested node_modules
 * (EISDIR on node_modules/.bin/electron, left by the old "npm run desktop:install"). Returns those folders'
 * node_modules paths, relative to root.
 */
function strayNodeModules(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !NOT_COPIED.has(d.name))
    .map((d) => `${d.name}/node_modules`)
    .filter((rel) => fs.existsSync(path.join(root, rel)));
}

function strayMessage(stray) {
  return [
    `Oracle's build copies every project folder into build/processed and fails on ${stray.join(', ')}.`,
    'Electron now installs with the root "npm install", so delete it (a terminal, in this folder):',
    ...stray.map((rel) => `  rm -rf ${rel}      (Windows: rmdir /s /q ${rel.replace(/\//g, '\\')})`),
  ].join('\n');
}

module.exports = { checkTools, release, strayNodeModules, strayMessage };

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
  const stray = strayNodeModules(ROOT);
  if (stray.length) {
    console.error(`\ncheck-tools: ${strayMessage(stray)}\n`);
    process.exit(1);
  }
}
