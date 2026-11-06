/*
 * Finding a command (ffmpeg, whisper-cli) for transcription (desktop/lib/findCommand.js): it must look beyond the app's
 * start-time PATH — in winget's Links and Packages folders, Scoop, Chocolatey and Homebrew — so a tool installed while
 * the app is open is found on "Check again", without a restart. (This was the bug: ffmpeg stayed ✗ after winget.)
 *
 * Run:  node tests/find-command.test.js
 */
'use strict';
const path = require('path');
const H = require('./_harness');
const F = require(path.join(__dirname, '..', 'desktop', 'lib', 'findCommand.js'));

const T = H.makeAsserter();

// A fake Windows disk: isFile is case-insensitive (as Windows is), readdir returns dirent-likes.
function winDisk(files, tree) {
  const low = new Set(files.map((f) => f.toLowerCase()));
  return {
    isFile: (p) => low.has(String(p).toLowerCase()),
    readdir: (p) => (tree[p] || []).map((e) => ({ name: e.name, isFile: () => !e.dir, isDirectory: () => !!e.dir })),
  };
}

T.section('Windows: a tool just installed by winget is found without a restart');
{
  const env = { PATH: 'C:\\tools', PATHEXT: '.EXE;.CMD', LOCALAPPDATA: 'C:\\la', ProgramData: 'C:\\pd', ProgramFiles: 'C:\\pf', USERPROFILE: 'C:\\u' };
  // ffmpeg is NOT on PATH; winget extracted it under Packages (no shim)
  const pkg = 'C:\\la\\Microsoft\\WinGet\\Packages';
  const disk = winDisk(
    ['C:\\la\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_x\\ffmpeg-7-full\\bin\\ffmpeg.exe', 'C:\\tools\\whisper-cli.exe'],
    {
      [pkg]: [{ name: 'Gyan.FFmpeg_x', dir: true }],
      [pkg + '\\Gyan.FFmpeg_x']: [{ name: 'ffmpeg-7-full', dir: true }],
      [pkg + '\\Gyan.FFmpeg_x\\ffmpeg-7-full']: [{ name: 'bin', dir: true }],
      [pkg + '\\Gyan.FFmpeg_x\\ffmpeg-7-full\\bin']: [{ name: 'ffmpeg.exe', dir: false }],
    });
  T.eq('ffmpeg found inside the winget package folder (not on PATH)', F.find('ffmpeg', Object.assign({ platform: 'win32', env }, disk)),
    'C:\\la\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_x\\ffmpeg-7-full\\bin\\ffmpeg.exe');
  T.eq('whisper-cli found on PATH (case-insensitive ext)', F.find('whisper-cli', Object.assign({ platform: 'win32', env }, disk)).toLowerCase(), 'c:\\tools\\whisper-cli.exe');
  T.eq('a tool that is nowhere returns empty', F.find('nope', Object.assign({ platform: 'win32', env }, disk)), '');

  const links = winDisk(['C:\\la\\Microsoft\\WinGet\\Links\\ffmpeg.exe'], {});
  T.eq('ffmpeg found via a winget shim in Links (PATH empty)', F.find('ffmpeg', Object.assign({ platform: 'win32', env: { PATH: '', PATHEXT: '.EXE', LOCALAPPDATA: 'C:\\la' } }, links)).toLowerCase(),
    'c:\\la\\microsoft\\winget\\links\\ffmpeg.exe');
  const scoop = winDisk(['C:\\u\\scoop\\shims\\ffmpeg.exe'], {});
  T.eq('…or a Scoop shim', F.find('ffmpeg', Object.assign({ platform: 'win32', env: { PATH: '', PATHEXT: '.EXE', USERPROFILE: 'C:\\u' } }, scoop)).toLowerCase(), 'c:\\u\\scoop\\shims\\ffmpeg.exe');
}

T.section('macOS / Linux: Homebrew and the usual bins, beyond PATH');
{
  const mac = { isFile: (p) => p === '/opt/homebrew/bin/ffmpeg', readdir: () => [] };
  T.eq('Homebrew ffmpeg found though PATH has only /usr/bin', F.find('ffmpeg', Object.assign({ platform: 'darwin', env: { PATH: '/usr/bin' } }, mac)), '/opt/homebrew/bin/ffmpeg');
  const lin = { isFile: (p) => p === '/usr/bin/ffmpeg', readdir: () => [] };
  T.eq('on Linux, /usr/bin is searched', F.find('ffmpeg', Object.assign({ platform: 'linux', env: { PATH: '/snap/bin' } }, lin)), '/usr/bin/ffmpeg');
}

T.report();
