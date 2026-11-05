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
  //   trace    a recording's technical trace (name): the video beside its web service calls, JSON and errors
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
      const st = R.state();
      v.evidence = { available: ok, key, items: got.items || [], folder: got.folder || '', error: got.error || '', busy: '',
        recording: st.recording ? st.key : '' };
      if (ok) R.keepFocus('#jiraShot');
    }
  }

  return evidenceChain;
});
