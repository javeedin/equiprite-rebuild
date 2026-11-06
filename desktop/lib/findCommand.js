'use strict';
/**
 * Find a command (ffmpeg, whisper-cli, …) on this PC, for the transcription setup (lib/transcribe.js). The desktop app's
 * own PATH is whatever it was when the app started, so a tool installed afterwards (e.g. "winget install Gyan.FFmpeg")
 * is not on it until the app restarts. So this also looks where winget, Scoop, Chocolatey and Homebrew actually put
 * things, and scans winget's package folder — so "Check again" finds a freshly installed tool without a restart.
 *
 *   find(cmd, { platform, env, isFile, readdir }) → absolute path, or '' if not found
 *
 * fs access is injected (isFile, readdir) so the search is testable without a real filesystem.
 */
const path = require('path');
const fs = require('fs');

function find(cmd, opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const env = o.env || process.env;
  const isFile = o.isFile || ((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
  const readdir = o.readdir || ((p) => { try { return fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return []; } });
  const win = platform === 'win32';
  const pth = win ? path.win32 : path.posix;   // so a Windows path is built on Windows, and this stays testable elsewhere
  const sep = win ? ';' : ':';
  const exts = win ? String(env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.trim()).filter(Boolean) : [''];
  const dirs = String(env.PATH || '').split(sep);

  // Where installers put things, beyond the (possibly stale) PATH.
  if (win) {
    const la = env.LOCALAPPDATA || '';
    if (la) dirs.push(pth.join(la, 'Microsoft', 'WinGet', 'Links'));         // winget shims
    if (env.ProgramData) dirs.push(pth.join(env.ProgramData, 'chocolatey', 'bin'));
    if (env.ProgramFiles) dirs.push(pth.join(env.ProgramFiles, 'ffmpeg', 'bin'));
    if (env.USERPROFILE) dirs.push(pth.join(env.USERPROFILE, 'scoop', 'shims'));
  } else if (platform === 'darwin') {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', pth.join(env.HOME || '', 'homebrew', 'bin'));
  } else {
    dirs.push('/usr/local/bin', '/usr/bin', '/bin', '/snap/bin', pth.join(env.HOME || '', '.local', 'bin'));
  }

  for (const d of dirs) {
    if (!d) continue;
    for (const e of exts) {
      const p = pth.join(d, cmd + e);
      if (isFile(p)) return p;
    }
  }

  // winget often extracts a tool into its package folder without a shim: scan it, shallow and bounded.
  if (win && env.LOCALAPPDATA) {
    const base = pth.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
    const targets = exts.map((e) => (cmd + e).toLowerCase());
    const stack = [[base, 0]];
    let seen = 0;
    while (stack.length && seen < 4000) {
      const top = stack.pop();
      const dir = top[0];
      const depth = top[1];
      const entries = readdir(dir);
      for (const en of entries) {
        seen += 1;
        const p = pth.join(dir, en.name);
        if (en.isFile && en.isFile() && targets.indexOf(en.name.toLowerCase()) !== -1) return p;
        if (en.isDirectory && en.isDirectory() && depth < 6) stack.push([p, depth + 1]);
      }
    }
  }
  return '';
}

module.exports = { find };
