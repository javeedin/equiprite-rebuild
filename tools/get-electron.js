'use strict';

/**
 * Runs before "npm run desktop" / "desktop:fresh": makes sure Electron's binary is there, fetching it so that a
 * dropped connection does not lose the download.
 *
 * Electron 45 runs no install script; the first "electron" start downloads one ~110 MB zip with a single
 * fetch. On a laptop where antivirus or a proxy cuts long downloads, that dies with "TypeError: terminated" and
 * "Electron failed to install correctly", and the next try starts again from zero. This downloads the same zip
 * with HTTP Range resume, retries and a stall timeout, checks its SHA-256 against node_modules/electron/
 * checksums.json, and drops it into @electron/get's cache. Electron's own install.js then finds it there,
 * verifies it again and unzips it; nothing here unzips or runs the binary.
 *
 * Plain Node, no dependencies, no shell (eScan-safe). The only child process is node running electron/install.js,
 * which is what electron's own index.js does.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron');
const GITHUB = 'https://github.com/electron/electron/releases/download/';
const MAX_ATTEMPTS = 25;
const STALL_MS = 30000;

/** "electron-v45.1.0-win32-x64.zip" — @electron/get artifact-utils getArtifactFileName. */
function artifactName(version, platform, arch) {
  return `electron-v${version}-${platform}-${arch}.zip`;
}

/** Download URL, honouring ELECTRON_MIRROR / ELECTRON_CUSTOM_DIR the way @electron/get does. */
function remoteUrl(version, fileName, env) {
  const base = env.npm_config_electron_mirror || env.ELECTRON_MIRROR || GITHUB;
  const dir = (env.npm_config_electron_custom_dir || env.ELECTRON_CUSTOM_DIR || `v${version}`).replace('{{ version }}', version);
  return `${base}${dir}/${fileName}`;
}

/** @electron/get's cache root: electron_config_cache, else env-paths('electron', { suffix: '' }).cache. */
function cacheRoot(env, platform, home) {
  if (env.electron_config_cache) {
    return env.electron_config_cache;
  }
  if (platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'electron', 'Cache');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'electron');
  }
  return path.join(env.XDG_CACHE_HOME || path.join(home, '.cache'), 'electron');
}

/** Where @electron/get looks for the zip: <root>/<sha256 of the URL's folder>/<file> (Cache.getCachePath). */
function cachePath(root, url, fileName) {
  const u = new URL(url);
  u.hash = '';
  u.search = '';
  u.pathname = path.posix.dirname(u.pathname);
  return path.resolve(root, crypto.createHash('sha256').update(u.toString()).digest('hex'), fileName);
}

/** Same test as electron/install.js isInstalled(). */
function isInstalled(electronDir, version, exeName) {
  try {
    return fs.readFileSync(path.join(electronDir, 'dist', 'version'), 'utf8').replace(/^v/, '') === version
      && fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8') === exeName
      && fs.existsSync(path.join(electronDir, 'dist', exeName));
  } catch {
    return false;
  }
}

function exeFor(platform) {
  return { win32: 'electron.exe', darwin: 'Electron.app/Contents/MacOS/Electron' }[platform] || 'electron';
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function mb(n) {
  return (n / 1048576).toFixed(1);
}

/** One attempt: appends to partFile from its current size. Resolves when the server has sent everything. */
async function fetchInto(url, partFile, onProgress) {
  const have = fs.existsSync(partFile) ? fs.statSync(partFile).size : 0;
  const ctrl = new AbortController();
  let stall = setTimeout(() => ctrl.abort(new Error(`no data for ${STALL_MS / 1000}s`)), STALL_MS);
  try {
    const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctrl.signal });
    if (res.status === 416) {
      return; // asked past the end: the part file is already complete
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    const resumed = res.status === 206;
    const total = resumed
      ? Number((res.headers.get('content-range') || '').split('/')[1]) || 0
      : Number(res.headers.get('content-length')) || 0;
    const out = fs.createWriteStream(partFile, { flags: resumed ? 'a' : 'w' });
    let got = resumed ? have : 0;
    try {
      for await (const chunk of res.body) {
        clearTimeout(stall);
        stall = setTimeout(() => ctrl.abort(new Error(`no data for ${STALL_MS / 1000}s`)), STALL_MS);
        if (!out.write(chunk)) {
          await new Promise((r) => out.once('drain', r));
        }
        got += chunk.length;
        onProgress(got, total);
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (total && got < total) {
      throw new Error(`connection closed at ${mb(got)} of ${mb(total)} MB`);
    }
  } finally {
    clearTimeout(stall);
  }
}

async function download(url, target, expectedSha, log) {
  const part = `${target}.part`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let last = 0;
  const onProgress = (got, total) => {
    if (Date.now() - last > 2000) {
      last = Date.now();
      log(`  ${mb(got)}${total ? ` / ${mb(total)} MB (${Math.floor((got / total) * 100)}%)` : ' MB'}`);
    }
  };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await fetchInto(url, part, onProgress);
      const actual = sha256(part);
      if (expectedSha && actual !== expectedSha) {
        fs.rmSync(part, { force: true });
        throw new Error('checksum mismatch, starting over');
      }
      fs.renameSync(part, target);
      return;
    } catch (e) {
      const wait = Math.min(2000 * attempt, 15000);
      log(`  attempt ${attempt} of ${MAX_ATTEMPTS} stopped: ${(e && (e.cause && e.cause.message)) || (e && e.message) || e}`);
      if (attempt === MAX_ATTEMPTS) {
        throw e;
      }
      log(`  resuming in ${wait / 1000}s…`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function main() {
  const log = (s) => console.log(s);
  let version;
  try {
    version = require(path.join(ELECTRON, 'package.json')).version;
  } catch {
    console.error('\nget-electron: Electron is not installed. Run: npm install\n');
    process.exit(1);
  }
  const { platform, arch } = process;
  const exeName = exeFor(platform);
  if (isInstalled(ELECTRON, version, exeName)) {
    return;
  }

  const fileName = artifactName(version, platform, arch);
  const url = remoteUrl(version, fileName, process.env);
  const target = cachePath(cacheRoot(process.env, platform, os.homedir()), url, fileName);
  const expected = (require(path.join(ELECTRON, 'checksums.json')) || {})[fileName];

  if (fs.existsSync(target) && (!expected || sha256(target) === expected)) {
    log(`get-electron: ${fileName} is already downloaded.`);
  } else {
    fs.rmSync(target, { force: true });
    log(`get-electron: downloading ${fileName} (resumes if the connection drops)`);
    log(`  from ${url}`);
    log(`  to   ${target}`);
    try {
      await download(url, target, expected, log);
    } catch (e) {
      console.error([
        '',
        `get-electron: could not download ${fileName}: ${(e && e.message) || e}`,
        'Download it in your browser from the address above and save it as the "to" file, then run this again.',
        '',
      ].join('\n'));
      process.exit(1);
    }
    log('  downloaded and checksum verified.');
  }

  log('get-electron: unpacking with Electron\'s own installer…');
  const r = spawnSync(process.execPath, [path.join(ELECTRON, 'install.js')], { stdio: 'inherit' });
  if (r.status !== 0 || !isInstalled(ELECTRON, version, exeName)) {
    console.error(`\nget-electron: Electron's installer could not unpack ${target}. Send the lines above.\n`);
    process.exit(1);
  }
  log(`get-electron: Electron ${version} is ready.`);
}

module.exports = { artifactName, remoteUrl, cacheRoot, cachePath, isInstalled, exeFor };

if (require.main === module) {
  main();
}
