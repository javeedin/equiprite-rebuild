'use strict';
/**
 * Draws the FDD v2 flows with EquipRite Next's own swimlane renderer (resources/js/fddModel.js), loaded with a small
 * catalog that holds only these lanes and flows, so the document's diagrams look exactly like the app's FDD page.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { LANES, FLOWS } = require('./flows');

const MODEL = path.join(__dirname, '..', '..', '..', 'webApps', 'equiprite-next', 'resources', 'js', 'fddModel.js');

function load() {
  const C = { SOURCE: { checked: '' }, MODULES: [], PHASES: [], ROLES: {}, STATUSES: [], REQUIREMENTS: [], SCENARIOS: [], DECISIONS: [],
    INTEGRATIONS: [], BEYOND: [], MAPPING: {}, LANES, FLOWS };
  let model;
  const sandbox = { console, JSON, Math, Object, String, Number, Array };
  sandbox.define = (deps, factory) => { model = factory(C); };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(MODEL, 'utf8'), sandbox, { filename: 'fddModel.js' });
  return model;
}

function svgs() {
  const m = load();
  const out = {};
  FLOWS.forEach((f) => { out[f.id] = m.svg(f.id, {}); });
  return out;
}

module.exports = { svgs, FLOWS, LANES };
