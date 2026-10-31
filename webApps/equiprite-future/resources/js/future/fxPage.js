define(['resources/js/future/fxStore', 'resources/js/shellBus', 'resources/js/nav'], function (store, bus, nav) {
  'use strict';

  /**
   * What every EquipRite Future screen shares (docs/redesign/BUILDING-FUTURE-SCREENS.md):
   *
   *   watch(context)          in the page module's constructor: the page hears every change to the store (this tab,
   *                           another tab, the shell's persona switch and demo clock) as its 'fxRefresh' event, whose
   *                           listener runs loadChain again. Stops by itself when VB disposes the page (its tab closed).
   *   view(name, ...args)     for loadChain: the screen's view model (fxViews), with ready: true (or error/missing).
   *   act(request)            for actChain: { data } (a clicked element's data-act and data-… attributes) or
   *                           { type, payload }. Runs store.act, toasts the error in plain words or what happened, and
   *                           opens the request when the result names one. Returns { ok, error, result }.
   *   open(data)              for openChain: data-nav="<navId>", or data-record="request" data-id data-number.
   *   Base                    the page module's base class: the subscription and the binding helpers below.
   *
   * Money and dates are written the one way fxViews writes them (store.fmt).
   */
  var RESERVED = { act: 1, open: 1, quiet: 1, confirm: 1 };
  var F = store.fmt;

  /** A data-… value as the engine wants it: 'true'/'false' → boolean, '12' or '-3.5' → number, else the text. */
  function value(s) {
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
  }

  /**
   * An action request from a click or from a page function, made plain:
   *   { data: dataset }                  data-act="approveLine" data-request-id="R1001" data-line-id="L1" data-unit-id="U-EX1"
   *   { type, payload }                  a payload a page function built
   * Reserved data keys: act (the action), open (a navId to open after it worked), quiet (no toast when it worked),
   * confirm (a question asked first). Everything else goes into the payload (data-request-id → requestId).
   * Returns { type, payload, open, quiet, confirm }.
   */
  function request(o) {
    var r = o || {};
    var data = r.data || null;
    var out = { type: r.type || '', payload: Object.assign({}, r.payload || {}), open: r.open || '', quiet: !!r.quiet, confirm: r.confirm || '' };
    if (data) {
      Object.keys(data).forEach(function (k) {
        var v = data[k];
        if (k === 'act') { if (!out.type) out.type = v; return; }
        if (k === 'open') { out.open = v; return; }
        if (k === 'quiet') { out.quiet = v !== 'false'; return; }
        if (k === 'confirm') { out.confirm = v; return; }
        if (!RESERVED[k]) out.payload[k] = value(v);
      });
    }
    return out;
  }

  /** The log lines an action wrote (newest first in the state), oldest first, as sentences. */
  function said(state, lastId) {
    var out = [];
    var log = (state && state.log) || [];
    for (var i = 0; i < log.length && log[i].id !== lastId; i++) out.unshift(sentence(log[i].what));
    return out;
  }
  function sentence(t) { var s = String(t || '').trim(); return s && !/[.!?]$/.test(s) ? s + '.' : s; }

  /** What to toast when an action worked ('' for none). */
  function success(type, lines) {
    if (type === 'setPersona' || type === 'markRead') return '';
    return lines.length ? lines.slice(0, 3).join(' ') : 'Done.';
  }

  /** Runs an action through the store; see request() for what it takes. */
  function act(o, win) {
    var r = request(o);
    if (!r.type) return { ok: false, error: 'Nothing to do.', result: null };
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (r.confirm && w && typeof w.confirm === 'function' && !w.confirm(r.confirm)) return { ok: false, error: '', result: null, cancelled: true };
    var before = store.get();
    var lastId = before.log && before.log.length ? before.log[0].id : '';
    var res = store.act(r.type, r.payload);
    if (!res.ok) {
      bus.toast(res.error || 'That did not work.', 'error');
      return res;
    }
    var lines = said(store.get(), lastId);
    if (res.result && res.result.failed) bus.toast(lines.join(' ') || 'It did not go through.', 'warning');
    else if (!r.quiet) {
      var msg = success(r.type, lines);
      if (msg) bus.toast(msg, 'info');
    }
    if (res.result && res.result.id) bus.open({ record: 'request', params: { id: res.result.id, number: res.result.number || '' } });
    if (r.open) bus.open({ navId: r.open });
    return res;
  }

  /** Opens what a clicked element names: data-nav="<navId>", or data-record="request" data-id="R1001" data-number="FR-1001". */
  function open(data) {
    var d = data || {};
    if (d.record && (d.id || d.number)) {
      var number = d.number || '';
      if (!number && d.record === 'request') {
        var r = (store.get().requests || []).filter(function (x) { return x.id === d.id; })[0];
        number = r ? r.number : '';
      }
      bus.open({ record: d.record, params: { id: d.id || '', number: number } });
      return true;
    }
    if (d.nav) { bus.open({ navId: d.nav }); return true; }
    return false;
  }

  /** A notification's link ({ navId } or { record: 'request', id }) as open() takes it. */
  function linkData(link) {
    var l = link || {};
    if (l.record) return { record: l.record, id: l.id || '', number: l.number || '' };
    if (l.navId) return { nav: l.navId };
    return {};
  }

  /** The screen's view model for loadChain: store.view(name, ...args) with ready: true; never throws. */
  function view(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      var v = store.view.apply(null, [name].concat(args));
      if (v === null || v === undefined) return { ready: true, missing: true, error: '' };
      if (Array.isArray(v)) return { ready: true, error: '', rows: v };
      return Object.assign({ ready: true, error: '' }, v);
    } catch (e) {
      return { ready: true, error: String((e && e.message) || e) };
    }
  }

  /**
   * In the page module's constructor: fires 'fxRefresh' on the page whenever the store changes. VB deletes the
   * event helper's fireCustomEvent when it disposes the page (its tab closed), so the next change unsubscribes.
   */
  function watch(context) {
    var helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
    var off = null;
    function stop() { if (off) { off(); off = null; } }
    if (helper) {
      off = store.subscribe(function (type) {
        if (!helper || typeof helper.fireCustomEvent !== 'function') { stop(); return; }
        try {
          var p = helper.fireCustomEvent('fxRefresh', { type: type || '' });
          if (p && typeof p.catch === 'function') p.catch(function () { stop(); });
        } catch (e) { stop(); }
      });
    }
    return { dispose: stop, active: function () { return !!off; } };
  }

  /** Whether the persona played now may open a menu item's screen. */
  function canOpen(navId, roles) {
    var r = roles || store.view('me').roles;
    return nav.itemVisible(nav.item(navId), r);
  }

  // Binding helpers (no `this`: a binding may call them detached from the module).
  var helpers = {
    money: function (n, cur) { return F.money(n, cur); },
    num: function (n) { return F.num(n); },
    date: function (s) { return F.date(s); },
    short: function (s) { return F.short(s); },
    period: function (p) { return F.period(p); },
    plural: function (n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); },
    arr: function (a) { return Array.isArray(a) ? a : []; },
    label: function (navId) { var it = nav.item(navId); return it ? it.label : navId; },
    icon: function (navId) { var it = nav.item(navId); return it ? it.icon : 'oj-ux-ico-file'; },
    canOpen: function (navId, roles) { return canOpen(navId, roles); },
    /** A finance checklist state (fxViews.finance items) as a chip tone (fx-chip--<tone>). */
    stateTone: function (state) { return { done: 'ok', pending: 'todo', failed: 'bad', running: 'run', na: 'na' }[state] || 'todo'; },
    /** A request's or line's stage (fxViews requestRow/lineView .stage) as Next's journey colour (nx-stage--<tone>). */
    stageTone: function (stage) {
      return { requested: 'approval', approved: 'ready', shipped: 'out', onhire: 'onsite', offhire: 'back', returned: 'back', closed: 'done', rejected: 'stopped', lost: 'stopped' }[stage] || 'draft';
    },
    /** A notification's icon by its kind (action, warning, error, info). */
    noteIcon: function (kind) { return { action: 'oj-ux-ico-bell-ring', warning: 'oj-ux-ico-warning', error: 'oj-ux-ico-error' }[kind] || 'oj-ux-ico-notification'; },
    /** A view model's outline, for a skeleton page: [{ key, text }] ("rows: 3 rows", "count: 2"). */
    outline: function (v) {
      return Object.keys(v || {}).filter(function (k) { return k !== 'ready' && k !== 'error'; }).map(function (k) {
        var x = v[k];
        var text = Array.isArray(x) ? x.length + (x.length === 1 ? ' row' : ' rows')
          : (x && typeof x === 'object') ? Object.keys(x).slice(0, 6).map(function (q) { var y = x[q]; return q + ' ' + (Array.isArray(y) ? y.length : (y && typeof y === 'object') ? '…' : String(y)); }).join(', ')
            : String(x);
        return { key: k, text: text.length > 140 ? text.slice(0, 139) + '…' : text };
      });
    }
  };

  /** The page module's base: class PageModule extends fx.Base { … }. */
  function Base(context) { this.watch = watch(context); }
  Base.prototype.dispose = function () { if (this.watch) this.watch.dispose(); };
  Object.keys(helpers).forEach(function (k) { Base.prototype[k] = helpers[k]; });

  return { request: request, value: value, act: act, open: open, linkData: linkData, view: view, watch: watch, canOpen: canOpen, said: said,
    helpers: helpers, Base: Base, store: store, fmt: F };
});
