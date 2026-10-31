define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/availability',
  'resources/js/availabilityData',
  'resources/js/itemAvailability',
  'resources/js/requestData',
  'resources/js/shellBus',
], (ActionChain, Actions, Av, avData, itemAvail, requestData, bus) => {
  'use strict';

  // "Where is it, and when can I have it?" on a catalog card (the location icon): a dialog for one equipment item, for
  // the request's dates (resources/js/itemAvailability.js, the Availability screen's rules).
  //   open (id)        reads the item's units (serial-refs by equipmentId), the bookings (workbench-lines), the
  //                    requests (requestData), the units' locations and the inventory orgs, and planned maintenance
  //                    (Fusion work orders); all reads, in parallel; a part that fails is left out and named
  //   close
  //   dates (from, to) the request's dates become these (a suggested slot), as typing them would: the catalog follows
  //   add (id)         into the cart (this item, or a free alternative), as the card's Add does
  //   history          everything about the item (record equipment-360)
  //   availability     the Availability screen, on this item and these dates
  // The bookings and inventory orgs are kept a minute, so a second card opens at once.
  const KEEP_MS = 60000;
  const WO_WAIT_MS = 8000;
  const cache = { lines: null, invOrgs: null, locations: {} };

  function fresh(entry) { return entry && Date.now() - entry.at < KEEP_MS; }

  class availChain extends ActionChain {
    async run(context, { act, id, from, to }) {
      const pv = context.$page.variables;
      if (act === 'close') {
        pv.avail = Object.assign({}, pv.avail, { open: false });
        return;
      }
      if (act === 'dates') {
        if (!from || !to) return;
        const form = Object.assign({}, pv.form || {}, { startDate: from, endDate: to });
        pv.form = form;
        pv.missing = [];
        pv.saveError = '';
        // The date boxes are native inputs: once typed in, they no longer follow the bound value.
        ['orStart', 'orEnd'].forEach((elId, i) => {
          const el = typeof document !== 'undefined' ? document.getElementById(elId) : null;
          if (el) el.value = i === 0 ? from : to;
        });
        pv.avail = Object.assign({}, pv.avail, { open: false });
        bus.toast('Dates set to ' + Av.range(from, to) + ': the catalog, its prices and the cart follow.', 'info');
        await Actions.callChain(context, { chain: 'loadCatalogChain' });
        return;
      }
      if (act === 'add') {
        pv.avail = Object.assign({}, pv.avail, { open: false });
        await Actions.callChain(context, { chain: 'cartChain', params: { action: 'add', id: String(id) } });
        return;
      }
      if (act === 'history') {
        const a = pv.avail || {};
        pv.avail = Object.assign({}, a, { open: false });
        bus.open({ record: 'equipment-360', params: { name: a.name || '', equipmentId: a.id != null ? String(a.id) : '' } });
        return;
      }
      if (act === 'availability') {
        const a = pv.avail || {};
        const w = (a.result && a.result.window) || {};
        pv.avail = Object.assign({}, a, { open: false });
        bus.focus('availability', { text: a.name || '', from: w.from || '', to: w.to || '', view: 'grid' });
        return;
      }
      if (act !== 'open' || !id) return;

      const itemId = Number(id);
      const row = (pv.catalogRows || []).filter((r) => Number(r.eqrEquipmentMasterId) === itemId)[0] || {};
      const form = pv.form || {};
      const today = Av.todayKey();
      const win = Av.windowOf(form.startDate || today, form.endDate || '', today);
      const inCart = (pv.cart || []).filter((c) => Number(c.id) === itemId)[0];
      const need = inCart ? Number(inCart.quantity) || 1 : 1;
      const cls = row.className || row.category || '';
      const base = { open: true, loading: true, id: itemId, name: row.equipmentName || 'Equipment', cls, image: row.equipmentImage || '',
        datesSet: !!(form.startDate && form.endDate), result: null, notes: [], error: '' };
      pv.avail = base;

      const call = (o) => Actions.callRest(context, o);
      const notes = [];
      try {
        const [ser, lines, inv, data] = await Promise.all([
          avData.readAll(call, 'eqp-v1/getSerialRefs', { equipmentId: itemId, page: 0, size: 500 }),
          fresh(cache.lines) ? cache.lines.value : avData.readAll(call, 'eqp-v1/getEquipriteV1ViewsWorkbenchLines', { page: 0, size: 2000 }),
          fresh(cache.invOrgs) ? cache.invOrgs.value : avData.readAll(call, 'eqp-v1/getInvOrgs', { page: 0, size: 500 }),
          requestData.load(context, Actions, {}),
        ]);
        if (lines.ok) cache.lines = { at: Date.now(), value: lines };
        if (inv.ok) cache.invOrgs = { at: Date.now(), value: inv };
        if (!pv.avail.open || pv.avail.id !== itemId) return;
        if (!ser.ok) {
          pv.avail = Object.assign({}, base, { loading: false, error: 'Its units could not be read (HTTP ' + (ser.status || 'no answer') + '). Try again in a moment.' });
          return;
        }
        // The list is asked for this item's units; one the server sends for another item is left out.
        const serials = ser.rows.filter((s) => s && s.serialNumber && (s.equipmentId == null || Number(s.equipmentId) === itemId));
        const mine = {};
        serials.forEach((s) => { mine[String(s.serialNumber)] = true; });
        if (!lines.ok) notes.push('Bookings could not be read: units may look free when they are not.');
        if (!inv.ok) notes.push('Inventory orgs could not be read: units show their yard only.');

        // Each unit's location, each once, kept for the next card.
        const locIds = [];
        serials.forEach((s) => {
          const l = s.currentLocationId != null ? String(s.currentLocationId) : '';
          if (l && locIds.indexOf(l) === -1 && !cache.locations[l]) locIds.push(l);
        });
        const locs = await Promise.all(locIds.map((l) => call({ endpoint: 'eqp-v1/getLocationById', uriParams: { id: Number(l) } }).catch(() => null)));
        locIds.forEach((l, i) => {
          const r = locs[i];
          if (r && r.ok && r.body) cache.locations[l] = { locationName: r.body.locationName || r.body.address || '', locationCode: r.body.locationCode || '', orgId: r.body.orgId };
        });
        const locationsById = {};
        serials.forEach((s) => {
          const l = s.currentLocationId != null ? String(s.currentLocationId) : '';
          if (l && cache.locations[l]) locationsById[l] = cache.locations[l];
        });

        // Planned maintenance (Fusion): waited for a while, then answered without it.
        let workOrdersByAsset = {};
        if (serials.some((s) => s.maintenanceAssetNumber)) {
          const wo = await Promise.race([
            avData.workOrders(call, serials).catch(() => null),
            new Promise((r) => setTimeout(() => r(null), WO_WAIT_MS)),
          ]);
          if (wo && wo.byAsset) {
            workOrdersByAsset = wo.byAsset;
            if (wo.failed) notes.push('Planned maintenance could not be read for ' + wo.failed + ' of ' + wo.assets + ' units.');
          } else {
            notes.push('Planned maintenance could not be read in time: it is not shown.');
          }
        }
        if (!pv.avail.open || pv.avail.id !== itemId) return;

        const model = Av.build({
          serials,
          classes: [],
          lines: (lines.rows || []).filter((l) => l && mine[String(l.allocatedSerial)]),
          masterById: { [itemId]: { id: itemId, equipmentName: base.name, className: cls } },
          locationsById,
          workOrdersByAsset,
          requests: data.rows || [],
          linesByRequest: data.linesByRequest || {},
        }, today);
        const result = itemAvail.assess(model, { serials, locationsById, invOrgs: inv.rows || [] },
          { from: win.from, to: win.to, today, need, catalogRows: pv.catalogRows || [], itemId, cls });
        pv.avail = Object.assign({}, base, { loading: false, result, notes });
      } catch (e) {
        console.warn('[availChain] not read', e);
        if (pv.avail.open && pv.avail.id === itemId) pv.avail = Object.assign({}, base, { loading: false, error: 'Where it is could not be read. Try again in a moment.' });
      }
    }
  }

  return availChain;
});
