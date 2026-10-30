define([
  'vb/action/actionChain',
  'resources/js/mapPicker',
], (ActionChain, mapPicker) => {
  'use strict';

  // The delivery point on a map, as Old EquipRite's location drawer: search an address or click the map, drag the pin
  // to adjust, then Use this location. The address becomes the delivery address and the pinned point is kept with it
  // (form.locationPinned), so Review prices for the nearest yard to that point and the ship-to-site gets those
  // coordinates rather than a second lookup of the words. Nothing is written here.
  //   action: open | search (value) | pick (index) | picked (place or error, from the map) | use | cancel
  const PAUSE_MS = 300;
  let seq = 0;
  // A place as plain values: a page variable's old object cannot be read once the variable is replaced.
  const plain = (p) => (p ? { label: String(p.label || ''), lat: Number(p.lat), lng: Number(p.lng) } : null);

  class mapChain extends ActionChain {
    async run(context, { action, index, value, place, error }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const set = (patch) => { v.mapDlg = Object.assign({}, v.mapDlg, patch); };

      if (action === 'open') {
        const f = v.form || {};
        const pinned = f.locationPinned && f.locationLatitude != null && f.locationLongitude != null
          ? { label: f.location, lat: Number(f.locationLatitude), lng: Number(f.locationLongitude) } : null;
        v.mapDlg = { open: true, query: '', results: [], picked: pinned, error: '', searching: false };
        await fns.mapOpen(pinned);
        // An address typed but not pinned: find it, so the map opens on it.
        if (!pinned && String(f.location || '').trim()) {
          const hits = await mapPicker.search(f.location);
          if (hits.length && v.mapDlg.open && !v.mapDlg.picked) {
            set({ picked: hits[0] });
            fns.mapShow(hits[0]);
          }
        }
        return;
      }
      if (action === 'cancel') {
        fns.mapClose();
        v.mapDlg = { open: false, query: '', results: [], picked: null, error: '', searching: false };
        return;
      }
      if (action === 'search') {
        const q = String(value || '').trim();
        const mine = ++seq;
        set({ query: q, searching: q.length >= 3, results: q.length >= 3 ? v.mapDlg.results : [] });
        if (q.length < 3) return;
        await new Promise((r) => setTimeout(r, PAUSE_MS));
        if (mine !== seq) return;
        const near = v.mapDlg.picked ? [v.mapDlg.picked.lng, v.mapDlg.picked.lat] : null;
        const results = await mapPicker.search(q, near);
        if (mine !== seq || !v.mapDlg.open) return;
        set({ results, searching: false });
        return;
      }
      if (action === 'pick') {
        const hit = plain((v.mapDlg.results || [])[Number(index)]);
        if (!hit) return;
        set({ picked: hit, results: [], error: '' });
        fns.mapShow(hit);
        return;
      }
      if (action === 'picked') {
        if (!v.mapDlg.open) return;
        if (error) {
          set({ error: 'The map could not be shown here (' + error + '). Search for the address above instead.' });
        } else if (place) {
          set({ picked: plain(place), results: [], error: '' });
        }
        return;
      }
      if (action === 'use') {
        const p = plain(v.mapDlg.picked);
        if (!p) return;
        const form = Object.assign({}, v.form, {
          locationType: 'DELIVERY_LOCATION', location: p.label, locationLatitude: p.lat, locationLongitude: p.lng, locationPinned: true,
        });
        v.form = form;
        if (v.missing && v.missing.length) v.missing = v.missing.filter((m) => m !== 'Delivery location');
        // A native input stops following its bound value once typed in: put the address in it too.
        try {
          Array.prototype.forEach.call(document.querySelectorAll('.nx-order input[data-field="location"]'), (el) => {
            if (el.getClientRects().length) el.value = p.label;
          });
        } catch (e) { /* not in a browser */ }
        fns.mapClose();
        v.mapDlg = { open: false, query: '', results: [], picked: null, error: '', searching: false };
      }
    }
  }

  return mapChain;
});
