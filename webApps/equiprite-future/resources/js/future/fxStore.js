define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine', 'resources/js/future/fxViews'], function (Seed, Engine, Views) {
  'use strict';

  /**
   * EquipRite Future's store: the simulated backend's state for this browser. One state, kept in localStorage (so a
   * reload or another tab continues the same story), changed only by act(), read by view(). Screens subscribe and
   * refresh when anything changes (in this tab or another).
   *   act(type, payload) → { ok, error, result }
   *   view(name, ...args) → the screen's view model (fxViews)
   *   reset() → the demo group again, today 2 Nov 2026
   */
  var KEY = 'equiprite-future:state:v3';
  var state = null;
  var listeners = [];

  function load() {
    if (state) return state;
    try {
      var raw = window.localStorage && window.localStorage.getItem(KEY);
      var s = raw ? JSON.parse(raw) : null;
      if (s && s.version === Seed.seed().version) state = s;
    } catch (e) { state = null; }
    if (!state) state = Seed.seed();
    return state;
  }
  function save() {
    try { if (window.localStorage) window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode: the story lasts for this page only */ }
  }
  function emit(type) {
    listeners.slice().forEach(function (fn) { try { fn(type); } catch (e) { console.warn('[fxStore] listener', e); } });
  }
  function get() { return load(); }
  function act(type, payload) {
    var res = Engine.apply(load(), type, payload);
    if (res.ok) {
      state = res.state;
      save();
      emit(type);
    }
    return { ok: res.ok, error: res.error || '', result: res.result || null };
  }
  function view(name) {
    var fn = Views[name];
    if (typeof fn !== 'function') throw new Error('No view ' + name);
    var args = [load()].concat(Array.prototype.slice.call(arguments, 1));
    return fn.apply(null, args);
  }
  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
  }
  function reset() {
    var who = state ? state.personaId : 'p-pm';
    state = Seed.seed();
    state.personaId = who;
    save();
    emit('reset');
  }
  function replace(s) { state = s; save(); emit('replace'); }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY || !e.newValue) return;
      try { state = JSON.parse(e.newValue); emit('sync'); } catch (x) { /* ignore a half-written value */ }
    });
  }

  return { get: get, act: act, view: view, subscribe: subscribe, reset: reset, replace: replace, KEY: KEY, fmt: Views.fmt, personas: Seed.PERSONAS };
});
