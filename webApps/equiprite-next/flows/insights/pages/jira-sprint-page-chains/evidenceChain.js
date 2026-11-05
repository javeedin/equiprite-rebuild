define([
  'vb/action/actionChain',
  'resources/js/testRecorder',
  'resources/js/shellBus',
], (ActionChain, R, bus) => {
  'use strict';

  // A sprint's item: its test evidence, as on Jira stories (resources/js/testRecorder.js, kept on this PC by the desktop app):
  //   list     its recordings and screenshots (and whether recording works here)
  //   record   the picker, then a recording of the screen or window chosen (the bar: time, Screenshot, Stop)
  //   shot     the picker, then one screenshot (while recording: a screenshot of the recording)
  //   folder   its folder, in the file manager
  class evidenceChain extends ActionChain {
    async run(context, { act }) {
      const v = context.$page.variables;
      const key = v.selKey;
      const ev = JSON.parse(JSON.stringify(v.evidence || {}));
      if (!key) return;
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
        }
      } catch (e) {
        const err = JSON.parse(JSON.stringify(v.evidence || {}));
        err.error = String((e && e.message) || e);
        err.busy = '';
        v.evidence = err;
        R.keepFocus('#jspShot');
        return;
      }
      const ok = await R.available();
      const got = ok ? await R.list(key) : { items: [], folder: '' };
      if (v.selKey !== key) return;
      const st = R.state();
      v.evidence = { available: ok, key, items: got.items || [], folder: got.folder || '', error: got.error || '', busy: '',
        recording: st.recording ? st.key : '' };
      if (ok) R.keepFocus('#jspShot');
    }
  }

  return evidenceChain;
});
