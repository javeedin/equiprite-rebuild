define([
  'vb/action/actionChain',
  'resources/js/testRecorder',
  'resources/js/shellBus',
], (ActionChain, R, bus) => {
  'use strict';

  // The open item's test evidence (resources/js/testRecorder.js, kept on this PC by the desktop app):
  //   list     its recordings and screenshots (and whether recording works here)
  //   record   the picker, then a recording of the screen or window chosen (the bar: time, Screenshot, Stop)
  //   shot     the picker, then one screenshot (while recording: a screenshot of the recording)
  //   folder   its folder, in the file manager
  //   trace       a recording's technical trace (name): the video beside its web service calls, JSON and errors
  //   transcript  a recording's transcript (name): the video beside the words, in step
  //   transcribe  turn a recording's voice into a transcript with Whisper (local on this PC, or OpenAI)
  //   remove      delete a recording (and its trace and transcript) or a screenshot, after a confirm
  //   setup       set up transcription (ffmpeg, whisper.cpp, a model) when nothing is ready yet
  class evidenceChain extends ActionChain {
    async run(context, { act, name }) {
      const v = context.$page.variables;
      const key = v.selKey;
      const ev = JSON.parse(JSON.stringify(v.evidence || {}));
      if (!key) {
        // no story open: only the lists' icons (which stories have evidence)
        if (act === 'list') v.evidenceIndex = await R.index();
        return;
      }
      try {
        if (act === 'record' || act === 'shot') {
          ev.busy = act; ev.error = ''; v.evidence = ev;
          const done = await R.begin(key, act);
          if (done && act === 'shot') bus.toast('Screenshot saved for ' + key + '.', 'info');
        } else if (act === 'stop') {
          await R.stop();
        } else if (act === 'folder') {
          await R.reveal(key);
          return;
        } else if (act === 'trace') {
          await R.openTrace(key, name);
          return;
        } else if (act === 'transcript') {
          await R.openTranscript(key, name);
          return;
        } else if (act === 'setup') {
          await R.openSetup();
          // fall through: re-read so "Transcribe" appears once an engine is set up
        } else if (act === 'remove') {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function'
            && !window.confirm('Delete "' + (name || 'this file') + '"? This also removes its trace and transcript, and cannot be undone.')) return;
          await R.removeEvidence(key, name);
          // fall through: re-read the list so it disappears
        } else if (act === 'transcribe') {
          const ev = JSON.parse(JSON.stringify(v.evidence || {})); ev.busy = 'transcribe'; ev.error = ''; v.evidence = ev;
          const r = await R.transcribe(key, name, {});
          if (!(r && r.ok)) {
            const err = JSON.parse(JSON.stringify(v.evidence || {}));
            err.error = (r && (r.error + (r.setup ? ' — ' + r.setup : '') + (r.detail ? '\n' + r.detail : ''))) || 'Could not transcribe.';
            err.busy = '';
            v.evidence = err;
            R.keepFocus('#jiraShot');
            return;
          }
          bus.toast('Transcript ready for ' + key + ': ' + r.lines + (r.lines === 1 ? ' line' : ' lines') + '.', 'info');
          // fall through: re-read the list so the Transcript button appears
        }
      } catch (e) {
        const err = JSON.parse(JSON.stringify(v.evidence || {}));
        err.error = String((e && e.message) || e);
        err.busy = '';
        v.evidence = err;
        R.keepFocus('#jiraShot');
        return;
      }
      const ok = await R.available();
      const got = ok ? await R.list(key) : { items: [], folder: '' };
      if (v.selKey !== key) return;
      v.evidenceIndex = await R.index();
      const ti = await R.transcribeInfo();
      const st = R.state();
      v.evidence = { available: ok, key, items: got.items || [], folder: got.folder || '', error: got.error || '', busy: '',
        recording: st.recording ? st.key : '', canTranscribe: !!(ti.engines && ti.engines.length), engines: ti.engines || [] };
      if (ok) R.keepFocus('#jiraShot');
    }
  }

  return evidenceChain;
});
