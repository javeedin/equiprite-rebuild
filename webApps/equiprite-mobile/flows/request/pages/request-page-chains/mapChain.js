define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mapPicker',
  'resources/js/mobileRequest',
], (ActionChain, Actions, mapPicker, mr) => {
  'use strict';

  // The delivery point on a map, in a sheet: Next's mapChain (Old EquipRite's location drawer). Search an address or
  // tap the map, drag the pin to adjust, then Use this place. The address becomes the delivery address and the pinned
  // point is kept with it (form.locationPinned), so Review prices for the nearest yard to that point and the
  // ship-to-site gets those coordinates rather than a second lookup of the words. Nothing is written here.
  //   action: open | search (value) | pick (index) | picked (place or error, from the map) | locate | use | cancel
  // locate is the phone's own: where the phone is (navigator.geolocation, page module locate), its address
  // (mapPicker.reverse), the pin put there to check before it is used. Handy standing on the site.
  const PAUSE_MS = 300;
  let seq = 0;
  const CLOSED = { open: false, query: '', results: [], picked: null, error: '', searching: false, locating: false, note: '' };
  // A place as plain values: a page variable's old object cannot be read once the variable is replaced.
  const plain = (p) => (p ? { label: String(p.label || ''), lat: Number(p.lat), lng: Number(p.lng) } : null);

  class mapChain extends ActionChain {
    async run(context, { action, index, value, place, error }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const set = (patch) => { v.mapDlg = Object.assign({}, v.mapDlg, patch); };

      if (action === 'open' || (action === 'locate' && !v.mapDlg.open)) {
        const f = v.form || {};
        const pinned = f.locationPinned && f.locationLatitude != null && f.locationLongitude != null
          ? { label: f.location, lat: Number(f.locationLatitude), lng: Number(f.locationLongitude) } : null;
        v.mapDlg = Object.assign({}, CLOSED, { open: true, picked: pinned, locating: action === 'locate' });
        await fns.mapOpen(pinned);
        // An address typed but not pinned: find it, so the map opens on it.
        if (action === 'open' && !pinned && String(f.location || '').trim()) {
          const hits = await mapPicker.search(f.location);
          if (hits.length && v.mapDlg.open && !v.mapDlg.picked) {
            set({ picked: plain(hits[0]) });
            fns.mapShow(hits[0]);
          }
        }
        if (action === 'open') return;
      }
      if (action === 'locate') {
        set({ locating: true, note: '' });
        const here = await fns.locate();
        if (!v.mapDlg.open) return;
        if (!here || here.error) {
          set({ locating: false, note: mr.locateError(here && here.error) });
          return;
        }
        const at = plain(await mapPicker.reverse(here.lng, here.lat));
        if (!v.mapDlg.open) return;
        set({ picked: at, results: [], locating: false, note: '' });
        fns.mapShow(at);
        return;
      }
      if (action === 'cancel') {
        fns.mapClose();
        v.mapDlg = Object.assign({}, CLOSED);
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
        set({ picked: hit, results: [], error: '', note: '' });
        fns.mapShow(hit);
        return;
      }
      if (action === 'picked') {
        if (!v.mapDlg.open) return;
        if (error) {
          set({ error: 'The map could not be shown here (' + error + '). Search the address above, or use where you are.' });
        } else if (place) {
          set({ picked: plain(place), results: [], error: '', note: '' });
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
        if (fns.syncInputs) fns.syncInputs(form);
        fns.mapClose();
        v.mapDlg = Object.assign({}, CLOSED);
        await Actions.callChain(context, { chain: 'keepChain' });
      }
    }
  }

  return mapChain;
});
