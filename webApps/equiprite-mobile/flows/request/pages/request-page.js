define(['require', 'resources/js/mobileBus', 'resources/js/mobileRequest', 'resources/js/orderForm', 'resources/js/mapPicker'],
  (require, bus, mr, order, mapPicker) => {
  'use strict';

  // The Request tab: binding helpers (the words are resources/js/mobileRequest.js, the rules Next's orderForm.js), the
  // line from another tab (mobileBus.focus('request', …)) to this screen, the connection, and what only a browser can
  // do for the chains: the map, where the phone is, the native inputs. The chains are request-page-chains.
  // Binding helpers do not use `this`: a binding may call one detached from the module.
  let helper = null;
  let map = null;
  let bound = false;
  const fire = (name, payload) => { if (helper) helper.fireCustomEvent(name, payload || {}); };
  const ROOT = '#mbRequest';
  const LOCATE = { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 };

  class PageModule {
    constructor(context) {
      helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      bus.onFocus('request', () => fire('focusRequest', {}));
      if (typeof window !== 'undefined' && !bound) {
        bound = true;
        window.addEventListener('online', () => fire('connection', { online: true }));
        window.addEventListener('offline', () => fire('connection', { online: false }));
      }
    }

    // ── For the chains ──────────────────────────────────────────────────────────────────────────────────────
    /**
     * Draws the map in the open map sheet (the map library loads the first time it is needed). A tap or a drag of the
     * pin answers with the mapPicked event ({ place }); a map that cannot be drawn with ({ error }).
     */
    mapOpen(picked) {
      if (map) map.destroy();
      map = null;
      return new Promise((resolve) => {
        let tries = 0;
        const box = () => Array.prototype.filter.call(document.querySelectorAll(ROOT + ' .mb-request-map'), (el) => el.getClientRects().length > 0)[0];
        const go = () => {
          const el = box();
          if (!el) {
            if (tries++ < 40) setTimeout(go, 50); else resolve(false);
            return;
          }
          require(['mapboxgl'], (mapboxgl) => {
            try {
              map = mapPicker.open(el, mapboxgl, picked, (place) => fire('mapPicked', { place }), (error) => fire('mapPicked', { error }));
              resolve(true);
            } catch (e) {
              fire('mapPicked', { error: (e && e.message) || 'the map could not start' });
              resolve(false);
            }
          }, () => {
            fire('mapPicked', { error: 'the map library could not be loaded' });
            resolve(false);
          });
        };
        go();
      });
    }
    mapShow(place) { if (map) map.show(place); }
    /** The map goes with its sheet: mapPicker's destroy stops any fly-to before it removes the map. */
    mapClose() {
      if (map) map.destroy();
      map = null;
    }

    /** Where the phone is: { lat, lng, accuracy }, or { error: denied | unsupported | timeout | unavailable }. Never rejects. */
    locate() {
      return new Promise((resolve) => {
        const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null;
        if (!geo || typeof geo.getCurrentPosition !== 'function') {
          resolve({ error: 'unsupported' });
          return;
        }
        try {
          geo.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
            (e) => resolve({ error: e && e.code === 1 ? 'denied' : (e && e.code === 3 ? 'timeout' : 'unavailable') }),
            LOCATE);
        } catch (e) {
          resolve({ error: 'unavailable' });
        }
      });
    }

    /**
     * Native inputs stop following their bound value once someone has typed in them: when a chain changes the form
     * (a quick length, the map, a reopened draft, Start another), the inputs on the screen are given the new values.
     */
    syncInputs(form, catalogText) {
      const f = form || {};
      try {
        const root = document.querySelector(ROOT);
        if (!root) return;
        Array.prototype.forEach.call(root.querySelectorAll('input[data-field]'), (el) => {
          const k = el.dataset.field;
          if (k === 'taskQuery' || !(k in f) || el.dataset.id) return;
          const v = f[k] == null ? '' : String(f[k]);
          if (el.value !== v) el.value = v;
        });
        if (catalogText !== undefined) {
          const s = root.querySelector('#rqSearch');
          if (s && s.value !== String(catalogText || '')) s.value = String(catalogText || '');
        }
      } catch (e) { /* not in a browser */ }
    }

    /** The top of this tab's screen, or one part of it (the list of what is missing). */
    toTop(sel) {
      try {
        const el = sel ? document.querySelector(ROOT + ' ' + sel) : null;
        if (el && el.getClientRects().length) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        else if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
      } catch (e) { /* not in a browser */ }
    }

    /** A request just sent, in My requests: it reads its list again when requests change, and finds this one there. */
    showInTrack(id, number) {
      bus.focus('track', { id: id ? Number(id) : undefined, number: number || '' });
    }

    // ── Binding helpers ─────────────────────────────────────────────────────────────────────────────────────
    steps(step, form, cart) { return mr.steps(step, form, cart); }
    stepClass(s) { return 'mb-request-step mb-request-step--' + (s && s.state ? s.state : 'todo'); }
    title(resume) { return mr.title(resume); }
    subline(form) { return mr.subline(form); }
    count(cart) { return mr.count(cart); }
    cartCount(cart) { return mr.cartCount(cart); }
    totals(cart, form, hideRates) { return mr.totals(cart, form, hideRates); }
    catalogNote(count, all, form) { return mr.catalogNote(count, all, form); }
    listNote(kind, results, query, searching) { return mr.listNote(kind, results, query, searching); }
    missingText(missing) { return mr.missingText(missing); }
    projectText(form) { return mr.projectText(form); }
    taskText(form) { return mr.taskText(form); }
    deliveryText(form) { return mr.deliveryText(form); }
    coords(p) { return mr.coords(p); }
    pinText(form) { return mr.pinText(form); }
    submitWords(cart, resume) { return mr.submitWords(cart, resume); }
    draftWords(resume) { return mr.draftWords(resume); }
    initials(name) { return mr.initials(name); }
    imageSrc(raw, appPath) { return mr.imageSrc(raw, appPath); }
    fresh(cart, resume) { return mr.fresh(cart, resume); }
    started(form, cart) { return mr.started(form, cart); }
    replaceText(pending, form, cart, resume) { return mr.replaceText(pending, form, cart, resume); }
    resetText(resume, cart) { return mr.resetText(resume, cart); }
    sentText(sent) { return mr.sentText(sent); }
    lineAbout(l) { return mr.lineAbout(l); }
    stillNeeded(form, cart) { return order.stillNeeded(form, cart); }
    windowText(start, end) { return order.windowText(start, end); }
    lengths(start, end) { return order.lengths(start, end); }
    qtyIn(cart, id) { return order.qtyIn(cart, id); }
    ids(cart) { return order.cartIds(cart); }
    line(cart, id, form, hideRates) { return order.cartLine(cart, id, form, hideRates); }
    taskMatches(tasks, text) { return order.taskMatches(tasks, text); }
    customerUrl(newBase, draftId) { return order.customerRequestUrl(newBase, draftId); }
    same(a, b) { return (a == null ? '' : '' + a) === (b == null ? '' : '' + b); }
    picked(v) { return v != null && v !== ''; }
    /** The task sheet's note: loading, none, or how many of how many. */
    taskNote(loading, tasks, query) {
      if (loading) return 'Loading the project’s tasks…';
      const all = Array.isArray(tasks) ? tasks.length : 0;
      if (!all) return 'This project has no chargeable tasks.';
      const n = order.taskMatches(tasks, query).length;
      return n + ' of ' + all + ' chargeable ' + (all === 1 ? 'task' : 'tasks') + (n === 30 && all > 30 ? '. Type to narrow it.' : '');
    }
    /** "Free on these dates only": what tapping the chip asks for. */
    availNext(avail) { return avail === 'free' ? 'false' : 'true'; }
    /** A card's availability pill colours. */
    availClass(key) { return 'mb-request-avail mb-request-avail--' + (key || 'unknown'); }
  }

  return PageModule;
});
