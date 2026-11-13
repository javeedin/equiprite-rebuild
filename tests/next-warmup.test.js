#!/usr/bin/env node
'use strict';
/**
 * The warm-up (webApps/equiprite-next/resources/js/warmup.js): every JET component a screen imports is in its product's
 * list (Build.Rite: its Insights screens, the FDD ones and SQL; EquipRite Next: every screen), so none is left to load
 * when its tab is first opened; and the list holds nothing no screen uses.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_harness');

const T = H.makeAsserter();
const APP = path.join(__dirname, '..', 'webApps', 'equiprite-next');
let W = null;
vm.runInNewContext(fs.readFileSync(path.join(APP, 'resources', 'js', 'warmup.js'), 'utf8'), { define: (deps, f) => { W = f(() => {}); } });

const importsOf = (flows) => {
  const out = {};
  flows.forEach((flow) => {
    const dir = path.join(APP, 'flows', flow, 'pages');
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter((f) => /-page\.json$/.test(f)).forEach((f) => {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      Object.values((j.imports && j.imports.components) || {}).forEach((c) => { if (c.path !== 'ojs/ojknockout') (out[c.path] = out[c.path] || []).push(flow + '/' + f); });
    });
  });
  return out;
};
const build = importsOf(['insights', 'fdd', 'admin']);
const all = importsOf(fs.readdirSync(path.join(APP, 'flows')));
const missB = Object.keys(build).filter((m) => W.LISTS.buildrite.indexOf(m) === -1);
T.check('every component a Build.Rite screen imports is warmed up', missB.length === 0, missB.map((m) => m + ' (' + build[m].join(', ') + ')').join('; '));
const missN = Object.keys(all).filter((m) => W.LISTS.next.indexOf(m) === -1);
T.check('every component an EquipRite Next screen imports is warmed up', missN.length === 0, missN.map((m) => m + ' (' + all[m].slice(0, 3).join(', ') + ')').join('; '));
const unused = W.LISTS.next.filter((m) => !all[m]);
T.check('nothing warmed up that no screen uses', unused.length === 0, unused.join(', '));
T.check('…and ojknockout (always there) is not', W.LISTS.next.indexOf('ojs/ojknockout') === -1 && W.LISTS.buildrite.indexOf('ojs/ojknockout') === -1);
T.report();
