/*
 * Shared test harness — assertions plus AMD loading of the real modules.
 *
 * WHY LOAD THE REAL MODULE: a hand-written copy of the function under test
 * passes happily while the shipped one is broken — the test then pins the
 * copy, not the code. Every suite here loads the actual file from
 * webApps/vbredwoodapp, so a regression in shipped code fails the suite.
 *
 * VBCS modules are AMD (`define([...], factory)`), which node does not
 * understand. Both loaders below shim `define`, resolve the Oracle
 * dependencies to inert stand-ins, and hand back whatever the factory
 * returned.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const APP    = path.join(__dirname, '..', 'webApps', 'vbredwoodapp');
const PAGES  = path.join(APP, 'flows', 'equipment-foundation', 'pages');
const CHAINS = path.join(PAGES, 'equipment-master-page-chains');
const SERVICES = path.join(__dirname, '..', 'services');

// ── assertions ───────────────────────────────────────────────────────

function makeAsserter() {
  const state = { pass: 0, fail: 0, failures: [] };

  function check(name, cond, detail) {
    if (cond) { state.pass++; console.log('  ok   ' + name); }
    else {
      state.fail++;
      state.failures.push(name + (detail ? ' - ' + detail : ''));
      console.log('  FAIL ' + name + (detail ? ' - ' + detail : ''));
    }
  }
  function eq(name, actual, expected) {
    check(name, actual === expected,
      'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
  function section(t) { console.log('\n=== ' + t + ' ==='); }

  function report() {
    console.log('\n' + '='.repeat(60));
    console.log('passed: ' + state.pass + '   failed: ' + state.fail);
    if (state.failures.length) {
      console.log('\nFAILURES:');
      state.failures.forEach(f => console.log('  - ' + f));
    }
    // Set the code and let node drain stdout rather than process.exit(): a
    // hard exit while stdout is a redirected pipe tears the socket down
    // mid-flush and trips a libuv assertion on Windows (exit 127 with every
    // test passing).
    process.exitCode = state.fail ? 1 : 0;
  }

  return { check, eq, section, report, state };
}

// ── loading the real modules ─────────────────────────────────────────

/** Stand-in for oj ArrayDataProvider: keeps the list so a test can inspect it. */
function FakeADP(data, options) { this.data = data; this.options = options; }
/** Stand-in for the grid provider: keeps the 2-D data + headers. */
function FakeGridProvider(params) {
  this.params = params;
  // Same shape as resources/js/arrayDataGridProvider: refreshRowCells writes
  // into dataParameters.data and announces the change with doUpdate.
  this.dataParameters = params;
  this.version = 0;
  this.updates = [];
}
FakeGridProvider.prototype.doUpdate = function (detail) { this.updates.push(detail); };

/**
 * Load equipment-master-page.js — the page module holding the grid logic.
 * Uses vm so module-scope constants (COLUMN_WIDTHS etc.) evaluate normally.
 */
function loadPageModule() {
  const src = fs.readFileSync(path.join(PAGES, 'equipment-master-page.js'), 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  let PageModule;
  sandbox.define = function (deps, factory) {
    PageModule = factory.apply(null, deps.map(d => {
      if (d === 'ojs/ojarraydataprovider') return FakeADP;
      if (d === 'resources/js/arrayDataGridProvider') return FakeGridProvider;
      return {};
    }));
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'equipment-master-page.js' });
  if (typeof PageModule !== 'function') {
    throw new Error('equipment-master-page.js did not return a constructor');
  }
  return new PageModule();
}

/**
 * Load an action chain with a stubbed Actions module, so a test can drive it
 * and inspect every REST call and notification it made.
 */
function loadChain(name, Actions) {
  const src = fs.readFileSync(path.join(CHAINS, name + '.js'), 'utf8');
  let mod;
  const define = (deps, factory) => {
    mod = factory.apply(null, (deps || []).map(d => {
      if (d === 'vb/action/actionChain') return class ActionChain {};
      if (d === 'vb/action/actions')     return Actions;
      return {};
    }));
  };
  new Function('define', src)(define);
  return mod;
}

/**
 * Fake Actions. `responder(opts, callNo)` decides each reply, so a test can
 * vary the answer per batch or per syncCode. Records calls and notifications.
 */
function makeActions(responder) {
  const calls = [];
  const notifications = [];
  const chainCalls = [];
  return {
    calls, notifications, chainCalls,
    Actions: {
      callRest: async (_ctx, opts) => { calls.push(opts); return responder(opts, calls.length); },
      fireNotificationEvent: async (_ctx, n) => { notifications.push(n); },
      callChain: async (_ctx, c) => { chainCalls.push(c); return { ok: true }; }
    }
  };
}

/** Source of a chain, with comments stripped — for negative assertions. */
function chainCode(name) {
  return fs.readFileSync(path.join(CHAINS, name + '.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
}

function chainSource(name) {
  return fs.readFileSync(path.join(CHAINS, name + '.js'), 'utf8');
}

function readPageFile(name) {
  return fs.readFileSync(path.join(PAGES, name), 'utf8');
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

module.exports = {
  APP, PAGES, CHAINS, SERVICES,
  makeAsserter, loadPageModule, loadChain, makeActions,
  chainCode, chainSource, readPageFile, readJson,
  FakeADP, FakeGridProvider
};
