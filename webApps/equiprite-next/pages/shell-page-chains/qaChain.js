define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/nav',
  'resources/js/availability',
  'resources/js/quickAvailability',
  'resources/js/searchData',
  'resources/js/shellBus',
], (ActionChain, Actions, nav, av, qav, data, bus) => {
  'use strict';

  // Check availability, the toolbar's calendar button: pick equipment and a window, and see at once how many units
  // are free and where (resources/js/quickAvailability.js, on the Availability screen's own rules). The fleet is read
  // once and shared with the global search (resources/js/searchData.js); planned maintenance from Fusion follows a
  // moment later and the counts are worked out again. Reads only.
  //   toggle        opens or closes the panel (the other popups close); opening reads the fleet when it is not fresh
  //   text          what is typed (text): suggestions (classes, equipment items) and the answer for the words
  //   key           ↑ ↓ through the suggestions, Enter picks the one chosen (key)
  //   pick          a suggestion, or a class in the answer (key)
  //   preset        Today | This week | Next week | Two weeks (key)
  //   from | to     a date set (value); the window never ends before it starts
  //   clear         the equipment typed or picked
  //   open          everything about an equipment item in its tab (equipment-360) (key: the row)
  //   unit          everything about one unit (key: its serial)
  //   availability  Availability on what is asked, for this window (key: a row, or '' for the whole answer)
  //   refresh       the answer again (the fleet or its maintenance arrived)

  /** The panel's state with the answer worked out for it (read every field from `qa` before it is replaced). */
  function render(qa, today) {
    const snap = data.snapshot();
    const fleet = snap.fleet;
    const pick = qa.pickKey ? { kind: qa.pickKind, key: qa.pickKey } : null;
    const ans = qav.answer(fleet, { text: qa.text, pick, from: qa.from, to: qa.to, today });
    return Object.assign({}, qa, {
      answer: ans, from: ans.win.from, to: ans.win.to, winText: ans.win.text,
      preset: qav.presetOf(ans.win.from, ans.win.to, today), presets: qav.presets(today),
      loading: !fleet && !snap.errors.fleet,
      error: !fleet && snap.errors.fleet ? 'The fleet could not be read: ' + snap.errors.fleet : '',
      maint: fleet ? fleet.maint : '',
      note: fleet ? qav.note(fleet) : '',
    });
  }

  /** Native inputs stop following their bound values once used: set them too. */
  function sync(qa) {
    [['nxQaText', qa.text], ['nxQaFrom', qa.from], ['nxQaTo', qa.to]].forEach(([id, value]) => {
      const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
      if (el && el.value !== (value || '')) el.value = value || '';
    });
  }

  class qaChain extends ActionChain {
    async run(context, { action, key, text, value }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      const today = av.todayKey();
      const qa = v.qa || {};

      if (action === 'toggle') {
        v.qaOpen = !v.qaOpen;
        v.phoneOpen = false;
        v.bellOpen = false;
        v.profileOpen = false;
        v.cartOpen = false;
        v.tabMenuOpen = false;
        v.showResults = false;
        if (!v.qaOpen) return;
        const win = qa.from && qa.to ? { from: qa.from, to: qa.to } : qav.defaultWindow(today);
        const can360 = nav.itemVisible(nav.item('fleet'), app.pageAccessMap, app.pageAccessLoaded, app.featureFlags, app.flagsLoaded, app.buRateSources);
        v.qa = render(Object.assign({}, qa, win, { optOpen: false, options: [], optIndex: 0, can360: !!can360 }), today);
        // Once the panel is drawn: its boxes show what is asked, and typing goes to the equipment box.
        let tries = 0;
        const ready = () => {
          const el = document.getElementById('nxQaText');
          if (!el) { if (tries++ < 20 && v.qaOpen) setTimeout(ready, 25); return; }
          sync(v.qa);
          el.focus();
          el.select();
        };
        setTimeout(ready, 0);
        // The fleet (shared with the global search), then its planned maintenance.
        const jobs = data.start(context, Actions, { requests: true, fleet: true });
        if (jobs.length) {
          await Promise.all(jobs);
          if (!v.qaOpen) return;
          v.qa = render(v.qa, today);
        }
        const maint = data.startMaintenance(context, Actions);
        if (maint) {
          v.qa = render(v.qa, today);
          await maint;
          if (v.qaOpen) v.qa = render(v.qa, today);
        }
        return;
      }

      if (action === 'refresh') {
        v.qa = render(qa, today);
        return;
      }

      if (action === 'text') {
        const t = String(text || '');
        const picked = !!qa.pickKey && t === qa.pickLabel;
        const options = picked || !t.trim() ? [] : qav.options(data.snapshot().fleet, t);
        v.qa = render(Object.assign({}, qa, {
          text: t, pickKind: picked ? qa.pickKind : '', pickKey: picked ? qa.pickKey : '', pickLabel: picked ? qa.pickLabel : '',
          options, optIndex: 0, optOpen: options.length > 0,
        }), today);
        return;
      }

      if (action === 'key') {
        const n = (qa.options || []).length;
        if (!qa.optOpen || !n) return;
        if (key === 'ArrowDown') v.qa = Object.assign({}, qa, { optIndex: (qa.optIndex + 1) % n });
        else if (key === 'ArrowUp') v.qa = Object.assign({}, qa, { optIndex: (qa.optIndex - 1 + n) % n });
        else if (key === 'Enter') await Actions.callChain(context, { chain: 'qaChain', params: { action: 'pick', key: qa.options[qa.optIndex].key } });
        return;
      }

      if (action === 'pick') {
        const o = (qa.options || []).filter((x) => x.key === key)[0]
          || (((qa.answer || {}).rows) || []).filter((x) => x.key === key).map((x) => ({ key: x.key, kind: x.kind, label: x.name }))[0];
        if (!o) return;
        const next = render(Object.assign({}, qa, { text: o.label, pickKind: o.kind, pickKey: o.key, pickLabel: o.label, options: [], optOpen: false, optIndex: 0 }), today);
        v.qa = next;
        sync(next);
        return;
      }

      if (action === 'clear') {
        const next = render(Object.assign({}, qa, { text: '', pickKind: '', pickKey: '', pickLabel: '', options: [], optOpen: false, optIndex: 0 }), today);
        v.qa = next;
        sync(next);
        const el = document.getElementById('nxQaText');
        if (el) el.focus();
        return;
      }

      if (action === 'preset') {
        const p = qav.presets(today).filter((x) => x.key === key)[0];
        if (!p) return;
        const next = render(Object.assign({}, qa, { from: p.from, to: p.to, optOpen: false }), today);
        v.qa = next;
        sync(next);
        return;
      }

      if (action === 'from' || action === 'to') {
        const d = av.d10(value);
        if (!d) return;
        let from = action === 'from' ? d : qa.from;
        let to = action === 'to' ? d : qa.to;
        if (to < from) { if (action === 'from') to = from; else from = to; }
        const next = render(Object.assign({}, qa, { from, to, optOpen: false }), today);
        v.qa = next;
        sync(next);
        return;
      }

      if (action === 'open' || action === 'unit') {
        const row = action === 'open' ? (((qa.answer || {}).rows) || []).filter((x) => x.key === key)[0] : null;
        const params = action === 'unit' ? { serial: key } : (row ? { name: row.name, equipmentId: row.equipmentId } : null);
        if (!params || (action === 'unit' && !key)) return;
        v.qaOpen = false;
        await Actions.callChain(context, { chain: 'openChain', params: { record: 'equipment-360', params } });
        return;
      }

      if (action === 'availability') {
        const row = key ? (((qa.answer || {}).rows) || []).filter((x) => x.key === key)[0] : null;
        const what = { text: row ? row.availText : ((qa.answer || {}).availText || ''), from: qa.from, to: qa.to };
        v.qaOpen = false;
        bus.open({ navId: 'availability' });
        bus.focus('availability', what);
      }
    }
  }

  return qaChain;
});
