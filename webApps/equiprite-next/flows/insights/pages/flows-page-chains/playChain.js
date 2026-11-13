define(['vb/action/actionChain', 'resources/js/flowsGuide', 'resources/js/flowPlayer'], (ActionChain, G, P) => {
  'use strict';

  // The animated flow: open it (it plays: a step every few seconds), the next and previous step, play / pause, from the
  // start, the details (the flow's section on the page), close. Its end (last step + 1) shows its other ways and where
  // what it makes is kept.
  const EVERY = 2800;
  class playChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      if (!act) return;
      const f = G.FLOWS.filter((x) => x.id === (key || v.playId))[0];
      const n = f ? f.steps.length : 0;
      const dlg = () => { try { return document.getElementById('hwPlay'); } catch (e) { return null; } };
      const play = () => { P.start(EVERY); v.playing = true; };
      const pause = () => { P.stop(); v.playing = false; };
      if (act === 'open' && f) {
        v.playId = f.id; v.playStep = 0;
        setTimeout(() => { const d = dlg(); try { if (d && !d.open && d.showModal) d.showModal(); if (d) d.focus(); } catch (e) { /* no DOM */ } }, 20);
        play();
        return;
      }
      if (!f) return;
      if (act === 'tick') { if (v.playStep < n) v.playStep = v.playStep + 1; if (v.playStep >= n) pause(); return; }
      if (act === 'next') { v.playStep = Math.min(n, v.playStep + 1); if (v.playing) play(); if (v.playStep >= n) pause(); return; }
      if (act === 'prev') { v.playStep = Math.max(0, v.playStep - 1); if (v.playing) play(); return; }
      if (act === 'toggle') { if (v.playing) pause(); else { if (v.playStep >= n) v.playStep = 0; play(); } return; }
      if (act === 'restart') { v.playStep = 0; play(); return; }
      if (act === 'details') {
        pause();
        const d = dlg(); try { if (d && d.open) d.close(); } catch (e) { /* closed */ }
        const id = v.playId; v.playId = '';
        setTimeout(() => { try { const el = document.getElementById('hw-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* no DOM */ } }, 60);
        return;
      }
      if (act === 'close') { pause(); const d = dlg(); try { if (d && d.open) d.close(); } catch (e) { /* closed */ } v.playId = ''; return; }
      if (act === 'closed') { pause(); v.playId = ''; }
    }
  }
  return playChain;
});
