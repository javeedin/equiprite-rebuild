define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobilePick',
], (ActionChain, Actions, mp) => {
  'use strict';

  // A unit read by the camera, typed, or typed by a tag reader (it types the number and presses Enter). On the open
  // request, its piece is ticked (tickChain, so the rules are a tap's: full access, a piece that can be ticked); with
  // read-only access it is only found. From the list, the request it is on opens first (scan first: walk up to a
  // machine, scan its tag, and the phone opens its request with it ticked). A unit not on the request says so, and
  // which request it is on when the list knows. A match buzzes once, a miss twice (where the phone can). Nothing is
  // sent.
  let lastRead = null;

  class scanHitChain extends ActionChain {
    async run(context, { value, source, key }) {
      const v = context.$page.variables;
      if (key !== undefined && key !== null && key !== '' && key !== 'Enter') return;
      const read = String(value || '').trim();
      if (!read || v.busy) return;
      const now = Date.now();
      if (source === 'camera' && mp.sameScan(lastRead, read, now)) return;
      lastRead = { value: read, at: now };
      const vibe = (kind) => { if (typeof navigator !== 'undefined') mp.vibrate(navigator, kind); };
      const say = (last) => { v.scan = Object.assign({}, v.scan, { last }); };
      if (source === 'typed') {
        v.unitText = '';
        const box = typeof document !== 'undefined' ? document.getElementById('pkUnit') : null;
        if (box) box.value = '';
      }
      if (v.view !== 'work' || !v.openId) {
        const found = mp.findInList(v.items, v.units, read);
        if (!found) {
          say({ tone: 'miss', title: read + ' is not in today’s work',
            text: v.yardsLoading ? 'Still finding the units of each request: try again in a moment, or open the request.' : 'Check the tag, or type the unit number.' });
          vibe('miss');
          return;
        }
        await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(found.id), keepBanner: false } });
        if (String(v.openId) !== String(found.id)) return;
        if (v.workError) {
          say({ tone: 'warn', title: read + ' is on ' + found.number, text: v.workError });
          vibe('hit');
          return;
        }
      }
      const work = v.work;
      const res = mp.scanResult(work, v.ticks, read, {
        canTick: v.can.act, number: work.req && work.req.requestNumber, items: v.items, units: v.units, external: work.req && work.req.isCustomer,
      });
      if (res.tick) await Actions.callChain(context, { chain: 'tickChain', params: { lineId: res.lineId, checked: true, source: 'scan' } });
      v.flash = res.lineId || '';
      say({ tone: res.tone, title: res.title, text: res.text });
      vibe(res.buzz);
    }
  }

  return scanHitChain;
});
