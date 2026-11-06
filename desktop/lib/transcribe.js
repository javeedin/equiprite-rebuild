'use strict';
/**
 * Transcribe a recorded test's voice (Record on a Jira story's panel, with "Record my voice"): turn the talking in the
 * recording into text with timestamps, so the transcript plays in step with the video and reads as notes of the test.
 * Two engines, the person's choice:
 *
 *   local   Whisper on this PC (whisper.cpp), nothing leaves the machine. Needs, once: ffmpeg (to pull 16 kHz mono
 *           audio out of the recording) and a whisper.cpp build with a model file. Private and offline.
 *   openai  OpenAI's Whisper API, with the OpenAI key already set for Ask AI. The audio is sent to OpenAI — opt-in,
 *           and said plainly in the app.
 *
 *   open({ run, which, fetch, modelsDir, tmpDir, openaiKey, reveal, now }) → engine
 *   info()                         → { local: { ready, ffmpeg, whisper, models }, openai: { ready }, engines: [...], platform, modelsDir, catalog }
 *   transcribe(file, { engine, lang }) → { ok, engine, lang, model, segments: [{ start, end, text }], ms } | { ok:false, error, setup }
 *   downloadModel(name)            → { ok, name, size } | { ok:false, error }   a Whisper model fetched into modelsDir
 *   revealModels()                 → opens the models folder (desktop: the file manager)
 *
 * The transcript holds only the words spoken and when; no credential is in it, and the audio stays on this PC unless the
 * person picks the OpenAI engine. Parsing (whisper.cpp JSON, SRT, OpenAI verbose_json) and the commands are pure, so
 * they are tested; the actual run needs the binaries (local) or the network (openai) on the person's machine.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL_RX = /^ggml-.*\.bin$/i;                 // whisper.cpp model files: ggml-base.bin, ggml-small.en.bin, …
const WHISPER_BINS = ['whisper-cli', 'whisper-cpp', 'main', 'whisper'];  // whisper.cpp names across versions/installs
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_SECONDS = 60 * 60;
// Whisper models the setup can download (from whisper.cpp's model repository). Bigger = more accurate, slower.
const MODEL_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const MODELS = [
  { name: 'ggml-tiny.bin', label: 'Tiny — fastest, roughest', mb: 75 },
  { name: 'ggml-base.bin', label: 'Base — a good balance (recommended)', mb: 142 },
  { name: 'ggml-small.bin', label: 'Small — more accurate, slower', mb: 466 },
  { name: 'ggml-base.en.bin', label: 'Base, English only', mb: 142 },
  { name: 'ggml-small.en.bin', label: 'Small, English only', mb: 466 },
];
// What to run to install the missing pieces, per OS (shown in the setup helper; no secrets, no auto-run).
const INSTALL = {
  darwin: { ffmpeg: 'brew install ffmpeg', whisper: 'brew install whisper-cpp' },
  linux: { ffmpeg: 'sudo apt-get install -y ffmpeg', whisper: 'Build whisper.cpp (github.com/ggerganov/whisper.cpp), then put "whisper-cli" on your PATH.' },
  win32: { ffmpeg: 'winget install Gyan.FFmpeg', whisper: 'Download a whisper.cpp release (github.com/ggerganov/whisper.cpp/releases) and put whisper-cli.exe on your PATH.' },
};

function trim(v) { return v == null ? '' : String(v).trim(); }

/** whisper.cpp -oj JSON: { transcription: [{ offsets: { from, to }(ms), text }] } (or { segments:[{ t0,t1 }(10ms) ]}). */
function parseWhisperJson(obj) {
  const o = obj || {};
  const list = Array.isArray(o.transcription) ? o.transcription : (Array.isArray(o.segments) ? o.segments : []);
  return list.map((s) => {
    const off = s.offsets || {};
    const start = off.from != null ? off.from / 1000 : (s.t0 != null ? s.t0 / 100 : (s.start != null ? Number(s.start) : 0));
    const end = off.to != null ? off.to / 1000 : (s.t1 != null ? s.t1 / 100 : (s.end != null ? Number(s.end) : start));
    return { start: Math.max(0, Math.round(start * 1000) / 1000), end: Math.max(0, Math.round(end * 1000) / 1000), text: trim(s.text) };
  }).filter((s) => s.text);
}

/** OpenAI verbose_json: { text, segments: [{ start, end, text }] (seconds) }. */
function parseOpenai(obj) {
  const o = obj || {};
  if (Array.isArray(o.segments) && o.segments.length) {
    return o.segments.map((s) => ({ start: Math.max(0, Number(s.start) || 0), end: Math.max(0, Number(s.end) || 0), text: trim(s.text) })).filter((s) => s.text);
  }
  const whole = trim(o.text);
  return whole ? [{ start: 0, end: 0, text: whole }] : [];
}

/** SRT (whisper.cpp -osrt fallback): blocks of "n\n HH:MM:SS,mmm --> HH:MM:SS,mmm\n text". */
function parseSrt(text) {
  const t = (secs) => secs;
  const toSec = (s) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : 0; };
  return String(text || '').replace(/\r/g, '').split(/\n\n+/).map((block) => {
    const lines = block.split('\n').filter((l) => l.trim());
    const time = lines.find((l) => l.indexOf('-->') !== -1);
    if (!time) return null;
    const parts = time.split('-->');
    const body = lines.slice(lines.indexOf(time) + 1).join(' ').trim();
    return body ? { start: t(toSec(parts[0])), end: t(toSec(parts[1])), text: body } : null;
  }).filter(Boolean);
}

/** The whole transcript as plain text, and as an SRT file, for Copy / download. */
function toText(segments) { return (segments || []).map((s) => s.text).join('\n'); }
function srtTime(sec) {
  const s = Math.max(0, sec || 0);
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = Math.floor(s % 60); const ms = Math.round((s - Math.floor(s)) * 1000);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return p(h) + ':' + p(m) + ':' + p(ss) + ',' + p(ms, 3);
}
function toSrt(segments) {
  return (segments || []).map((s, i) => (i + 1) + '\n' + srtTime(s.start) + ' --> ' + srtTime(s.end || s.start) + '\n' + s.text + '\n').join('\n');
}

function open(o) {
  const which = o.which || (() => '');
  const run = o.run;                // run(cmd, args, { cwd }) → Promise<{ code, stdout, stderr }>
  const doFetch = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const modelsDir = o.modelsDir || path.join(os.tmpdir(), 'equiprite-whisper');
  const tmpDir = o.tmpDir || os.tmpdir();
  const openaiKey = () => trim(typeof o.openaiKey === 'function' ? o.openaiKey() : o.openaiKey);

  function whisperBin() { for (const b of WHISPER_BINS) { const p = which(b); if (p) return p; } return ''; }
  function models() {
    try { return fs.existsSync(modelsDir) ? fs.readdirSync(modelsDir).filter((f) => MODEL_RX.test(f)) : []; } catch (e) { return []; }
  }
  function info() {
    const ffmpeg = which('ffmpeg');
    const whisper = whisperBin();
    const ms = models();
    const local = { ready: !!(ffmpeg && whisper && ms.length), ffmpeg: !!ffmpeg, whisper: !!whisper, models: ms };
    const openai = { ready: !!(doFetch && openaiKey()) };
    const engines = [];
    if (local.ready) engines.push('local');
    if (openai.ready) engines.push('openai');
    const platform = process.platform;
    return { local, openai, engines, modelsDir, platform, install: INSTALL[platform] || INSTALL.linux,
      catalog: MODELS.map((m) => ({ name: m.name, label: m.label, mb: m.mb, have: ms.indexOf(m.name) !== -1 })), canDownload: !!doFetch };
  }

  /** Fetch a Whisper model into modelsDir (the setup helper's "Download model"). */
  async function downloadModel(name) {
    const m = MODELS.filter((x) => x.name === name)[0];
    if (!m) return { ok: false, error: 'Unknown model.' };
    if (!doFetch) return { ok: false, error: 'This PC cannot download from the desktop app.' };
    try {
      fs.mkdirSync(modelsDir, { recursive: true });
      const dest = path.join(modelsDir, m.name);
      const tmp = dest + '.part';
      const res = await doFetch(MODEL_BASE + m.name, {});
      if (!res || !res.ok) return { ok: false, error: 'Download failed (HTTP ' + ((res && res.status) || '?') + ').' };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1024 * 1024) { return { ok: false, error: 'The download was too small to be a model.' }; }
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, dest);
      return { ok: true, name: m.name, size: buf.length };
    } catch (e) {
      try { const tmp = path.join(modelsDir, m.name + '.part'); if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e2) { /* leave it */ }
      return { ok: false, error: trim(e && e.message) || 'The download failed.' };
    }
  }

  function revealModels() { try { fs.mkdirSync(modelsDir, { recursive: true }); } catch (e) { /* exists */ } if (o.reveal) o.reveal(modelsDir); return { dir: modelsDir }; }

  /** The commands the local engine runs, as data (so a test can check them without spawning anything). */
  function localCommands(file, wav, model) {
    return {
      ffmpeg: { cmd: which('ffmpeg') || 'ffmpeg', args: ['-y', '-i', file, '-ar', '16000', '-ac', '1', '-f', 'wav', wav] },
      whisper: { cmd: whisperBin() || 'whisper-cli', args: ['-m', model, '-f', wav, '-oj', '-of', wav.replace(/\.wav$/, ''), '-l', trim(o.lang) || 'auto'] },
    };
  }

  async function local(file, opts) {
    const i = info().local;
    if (!i.ffmpeg) return { ok: false, error: 'ffmpeg is not installed.', setup: 'ffmpeg pulls the audio out of the recording. Install it (ffmpeg.org) and it will be found on the PATH.' };
    if (!i.whisper) return { ok: false, error: 'whisper.cpp is not installed.', setup: 'Build whisper.cpp (github.com/ggerganov/whisper.cpp) so "whisper-cli" is on the PATH.' };
    if (!i.models.length) return { ok: false, error: 'No Whisper model found.', setup: 'Put a model file (e.g. ggml-base.bin) in ' + modelsDir + ' — download one with whisper.cpp\'s models/download-ggml-model script.' };
    const lang = trim(opts && opts.lang);
    const wav = path.join(tmpDir, 'eqp-whisper-' + Date.now() + '.wav');
    const model = path.join(modelsDir, (opts && opts.model && i.models.indexOf(opts.model) !== -1) ? opts.model : i.models[0]);
    const cmds = open(Object.assign({}, o, { lang })).__localCommands(file, wav, model);
    const started = Date.now();
    try {
      const f = await run(cmds.ffmpeg.cmd, cmds.ffmpeg.args, {});
      if (f.code !== 0) return { ok: false, error: 'Could not read the recording\'s audio (ffmpeg).', detail: trim(f.stderr).slice(-500) };
      const w = await run(cmds.whisper.cmd, cmds.whisper.args, {});
      if (w.code !== 0) return { ok: false, error: 'Whisper could not transcribe it.', detail: trim(w.stderr).slice(-500) };
      let segments = [];
      const json = wav.replace(/\.wav$/, '') + '.json';
      if (fs.existsSync(json)) { try { segments = parseWhisperJson(JSON.parse(fs.readFileSync(json, 'utf8'))); } catch (e) { segments = []; } }
      if (!segments.length) { const srt = wav.replace(/\.wav$/, '') + '.srt'; if (fs.existsSync(srt)) segments = parseSrt(fs.readFileSync(srt, 'utf8')); }
      [wav, json, wav.replace(/\.wav$/, '') + '.srt'].forEach((p) => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) { /* leave it */ } });
      return { ok: true, engine: 'local', lang: lang || 'auto', model: path.basename(model), segments, ms: Date.now() - started };
    } catch (e) {
      try { if (fs.existsSync(wav)) fs.unlinkSync(wav); } catch (e2) { /* leave it */ }
      return { ok: false, error: trim(e && e.message) || 'Whisper failed.' };
    }
  }

  async function openai(file, opts) {
    const key = openaiKey();
    if (!doFetch) return { ok: false, error: 'No network client.' };
    if (!key) return { ok: false, error: 'No OpenAI key.', setup: 'Set an OpenAI key in SQL worksheet > Ask AI; the transcript then uses OpenAI\'s Whisper. The audio is sent to OpenAI.' };
    const started = Date.now();
    try {
      const buf = fs.readFileSync(file);
      const form = new FormData();
      form.append('file', new Blob([buf]), path.basename(file));
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      if (trim(opts && opts.lang)) form.append('language', trim(opts.lang));
      const res = await doFetch(OPENAI_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: form });
      if (!res.ok) { let m = 'HTTP ' + res.status; try { const b = await res.json(); m = (b.error && b.error.message) || m; } catch (e) { /* keep */ } return { ok: false, error: 'OpenAI refused the transcription: ' + m }; }
      const body = await res.json();
      return { ok: true, engine: 'openai', lang: trim(body.language) || trim(opts && opts.lang) || 'auto', model: 'whisper-1', segments: parseOpenai(body), ms: Date.now() - started };
    } catch (e) {
      return { ok: false, error: trim(e && e.message) || 'The OpenAI transcription failed.' };
    }
  }

  function transcribe(file, opts) {
    const o2 = opts || {};
    if (!file || !fs.existsSync(file)) return Promise.resolve({ ok: false, error: 'The recording was not found.' });
    const chosen = o2.engine || info().engines[0] || '';
    if (chosen === 'openai') return openai(file, o2);
    if (chosen === 'local') return local(file, o2);
    return Promise.resolve({ ok: false, error: 'No transcription engine is set up.',
      setup: 'Either build whisper.cpp with a model on this PC (private, offline), or set an OpenAI key in Ask AI (the audio is sent to OpenAI).' });
  }

  return { info, transcribe, downloadModel, revealModels, __localCommands: localCommands };
}

module.exports = { open, parseWhisperJson, parseOpenai, parseSrt, toText, toSrt, srtTime, MODEL_RX, WHISPER_BINS, MODELS, INSTALL };
