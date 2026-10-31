define([
  'vb/action/actionChain',
  'resources/js/fddModel',
  'resources/js/shellBus',
], (ActionChain, model, bus) => {
  'use strict';

  // The drill-down behind every number of the Mapping tab (fddModel.drill). Nothing is read from the server or written.
  //   open    a tile, a bar or one of its segments (value: the source, status: a segment's status): the items behind it,
  //           under the tiles; the title takes the focus
  //   status | module | text   narrow it (the status chips, the module chips, the search)
  //   crumb   the breadcrumb: mapping closes the drill, base clears the narrowing, status clears the module
  //   close   back to Mapping; the tile or bar that opened it takes the focus again
  //   screen  a Next screen chip: that screen in its tab (shellBus, as the Flows tab's Open button; only one this user may open)
  //   req     an item's full entry on the Requirements tab: that tab, the requirement open and scrolled to
  //   exportMenu   the drill's Export menu (exportChain exports exactly what the drill shows)
  // Each new view is worked out first (fddModel.drill) and set in one step.
  const EMPTY = { open: false, rows: [], extra: [], crumbs: [], chips: [], modules: [], mode: '', rule: '', summary: '', count: 0 };
  const TRIES = 40;
  const GAP_MS = 50;

  const later = () => new Promise((r) => setTimeout(r, GAP_MS));

  /** The element once the page has drawn it (or null). */
  async function find(selector) {
    if (typeof document === 'undefined') return null;
    for (let i = 0; i < TRIES; i++) {
      const el = document.querySelector(selector);
      if (el) return el;
      await later();
    }
    return null;
  }

  /** A native input stops following its bound value once typed in: set it too. */
  function setInput(id, value) {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
    if (el && el.value !== value) el.value = value;
  }

  class drillChain extends ActionChain {
    async run(context, { act, value, status }) {
      const v = context.$page.variables;
      if (!act) return;

      if (act === 'exportMenu') { v.drillExportOpen = !v.drillExportOpen; return; }

      if (act === 'screen') {
        if (value && v.names && v.names.open && v.names.open[value]) bus.open({ navId: value });
        return;
      }

      if (act === 'req') {
        const row = (v.reqAll || []).filter((r) => r.id === value)[0];
        if (!row) return;
        v.exportOpen = false;
        v.drillExportOpen = false;
        const shown = ((v.reqView && v.reqView.shown) || []).some((r) => r.id === value);
        if (!shown) {
          const view = model.reqView(v.reqAll, { text: '', module: 'all', phase: 'all', kind: 'all' });
          v.reqText = '';
          v.reqModule = 'all';
          v.reqPhase = 'all';
          v.reqKind = 'all';
          v.reqView = view;
        }
        v.reqOpen = value;
        v.tab = 'requirements';
        const el = await find('.fdd-req[data-req="' + value + '"]');
        setInput('fddReqSearch', v.reqText || '');
        if (el) {
          if (el.scrollIntoView) el.scrollIntoView({ block: 'start' });
          const btn = el.querySelector('.fdd-req-row');
          if (btn && btn.focus) btn.focus({ preventScroll: true });
        }
        return;
      }

      if (act === 'close' || (act === 'crumb' && value === 'mapping')) {
        const from = v.drillFrom || '';
        v.drillExportOpen = false;
        v.drillSpec = { source: '', status: 'all', module: 'all', text: '' };
        v.drill = EMPTY;
        const [source, st] = from.split('|');
        if (source) {
          const el = await find('[data-act="open"][data-value="' + source + '"][data-status="' + (st || 'all') + '"]');
          if (el && el.focus) el.focus();
        }
        return;
      }

      const cur = v.drillSpec || {};
      let spec;
      if (act === 'open') {
        spec = { source: value || '', status: status || 'all', module: 'all', text: '' };
      } else if (act === 'status') {
        spec = Object.assign({}, cur, { status: value || 'all' });
      } else if (act === 'module') {
        spec = Object.assign({}, cur, { module: value || 'all' });
      } else if (act === 'text') {
        spec = Object.assign({}, cur, { text: String(value == null ? '' : value) });
      } else if (act === 'crumb') {
        spec = value === 'base' ? { source: cur.source, status: 'all', module: 'all', text: '' } : Object.assign({}, cur, { module: 'all' });
      } else {
        return;
      }
      const d = model.drill(spec, v.names);
      if (!d) return;
      if (act === 'open') v.drillFrom = spec.source + '|' + spec.status;
      v.drillExportOpen = false;
      v.exportOpen = false;
      v.drillSpec = spec;
      v.drill = d;
      if (act === 'open' || (act === 'crumb' && value === 'base')) setInput('fddDrillSearch', spec.text);
      if (act === 'open') {
        const title = await find('#fddDrillTitle');
        setInput('fddDrillSearch', spec.text);
        if (title) {
          const box = document.getElementById('fddDrill') || title;
          if (box.scrollIntoView) box.scrollIntoView({ block: 'start' });
          if (title.focus) title.focus({ preventScroll: true });
        }
      }
    }
  }

  return drillChain;
});
