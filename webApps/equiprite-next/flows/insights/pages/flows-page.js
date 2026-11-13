define(['resources/js/flowsGuide', 'resources/js/flowPlayer'], (G, P) => {
  'use strict';

  // How it works: binding helpers over resources/js/flowsGuide.js (the words), and the animated flow's view (the chain
  // moves playStep; resources/js/flowPlayer.js ticks while it plays). None uses `this`: a binding may call one detached.
  const byId = (id) => G.FLOWS.filter((f) => f.id === id)[0] || null;
  const count = (id) => { const f = byId(id); return f ? f.steps.length : 0; };
  /** How far along the path (0–1): where the dot is, and how much of the line is filled behind it. */
  const along = (id, i) => { const n = count(id); return n <= 1 ? 1 : Math.max(0, Math.min(1, Math.min(i, n - 1) / (n - 1))); };

  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      P.onTick(() => { if (helper) helper.fireCustomEvent('playTick', {}); });
    }
    flows() { return G.FLOWS; }
    legend() { return G.LEGEND; }
    links() { return G.LINKS; }
    stepClass(s) { return 'nx-hw-step nx-hw-step--' + s.actor; }
    chipClass(a) { return 'nx-hw-key nx-hw-key--' + a; }
    openText(f) { return f.openLabel ? 'Open ' + f.openLabel : 'Open ' + f.title; }

    // ── the animated flow ──
    flow(id) { return byId(id); }
    atEnd(id, i) { return i >= count(id); }
    nodes(id, i) {
      const f = byId(id);
      return f ? f.steps.map((s) => Object.assign({}, s, { state: s.i < i ? 'done' : (s.i === i ? 'now' : 'next') })) : [];
    }
    nodeClass(n) { return 'nx-play-node nx-play-node--' + n.actor + ' nx-play-node--' + n.state; }
    dotLeft(id, i) { return 'calc(28px + (100% - 56px) * ' + along(id, i).toFixed(4) + ')'; }
    fillWidth(id, i) { return 'calc((100% - 56px) * ' + along(id, i).toFixed(4) + ')'; }
    /** The step on show, as a one-item list keyed by step: its card is drawn afresh, and slides in, at each step. */
    current(id, i) { const f = byId(id); const s = f && f.steps[i]; return s ? [Object.assign({ key: id + '-' + i }, s)] : []; }
    cardClass(s) { return 'nx-play-card nx-play-card--' + s.actor; }
    /** What the flow has made so far: one more at each step, the newest marked. */
    made(id, i) {
      const f = byId(id);
      return f ? f.steps.filter((s) => s.makes && s.i <= i).map((s) => ({ key: id + '-m' + s.i, makes: s.makes, actor: s.actor, fresh: s.i === i })) : [];
    }
    madeClass(m) { return 'nx-play-made nx-play-made--' + m.actor + (m.fresh ? ' nx-play-made--fresh' : ''); }
    progress(id, i) { const n = count(id); return i >= n ? 'Done · ' + n + ' steps' : 'Step ' + (i + 1) + ' of ' + n; }
  }
  return PageModule;
});
