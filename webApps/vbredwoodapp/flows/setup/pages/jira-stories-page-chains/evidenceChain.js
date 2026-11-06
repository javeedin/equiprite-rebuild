define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/testRecorder'
], (ActionChain, Actions, R) => {
  'use strict';

  // The open story's test evidence (resources/js/testRecorder.js, kept on this PC by the desktop app):
  //   list     its recordings and screenshots (and whether recording works here)
  //   record   the picker, then a recording of the screen or window chosen (the bar: time, Screenshot, Stop)
  //   shot     the picker, then one screenshot (while recording: a screenshot of the recording)
  //   stop     the recording ends and is saved
  //   folder   its folder, in the file manager
  //   trace       a recording's technical trace (name): the video beside its web service calls, JSON and errors
  //   transcript  a recording's transcript (name): the video beside the words, in step
  //   transcribe  turn a recording's voice into a transcript with Whisper (local on this PC, or OpenAI)
  //   setup       set up transcription (ffmpeg, whisper.cpp, a model) when nothing is ready yet
  class evidenceChain extends ActionChain {
    async run(context, { act, name }) {
      const v = context.$page.variables;
      const key = v.selected && v.selected.key;
      if (!key) {
        // no story open: only the lists' icons (which stories have evidence)
        if (act === 'list') v.evidenceIndex = await R.index();
        return;
      }
      try {
        if (act === 'record' || act === 'shot') {
          const ev = JSON.parse(JSON.stringify(v.evidence || {}));
          ev.busy = act; ev.error = ''; v.evidence = ev;
          const done = await R.begin(key, act);
          if (done && act === 'shot') {
            await Actions.fireNotificationEvent(context, { summary: 'Screenshot saved', message: 'In the folder of ' + key + '.', displayMode: 'transient', type: 'confirmation' });
          }
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
        } else if (act === 'transcribe') {
          const ev = JSON.parse(JSON.stringify(v.evidence || {})); ev.busy = 'transcribe'; ev.error = ''; v.evidence = ev;
          const r = await R.transcribe(key, name, {});
          if (!(r && r.ok)) {
            const err = JSON.parse(JSON.stringify(v.evidence || {}));
            err.error = (r && (r.error + (r.setup ? ' — ' + r.setup : ''))) || 'Could not transcribe.';
            err.busy = '';
            v.evidence = err;
            R.keepFocus('#jiraShot');
            return;
          }
          await Actions.fireNotificationEvent(context, { summary: 'Transcript ready', message: r.lines + ' lines for ' + key + '.', displayMode: 'transient', type: 'confirmation' });
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
      if (!v.selected || v.selected.key !== key) return;
      v.evidenceIndex = await R.index();
      const ti = await R.transcribeInfo();
      const st = R.state();
      v.evidence = { available: ok, key, items: got.items || [], folder: got.folder || '', error: got.error || '', busy: '', recording: st.recording ? st.key : '', canTranscribe: !!(ti.engines && ti.engines.length), engines: ti.engines || [] };
      if (ok) R.keepFocus('#jiraShot');
    }
  }

  return evidenceChain;
});
