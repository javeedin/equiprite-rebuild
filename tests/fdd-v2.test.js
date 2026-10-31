/*
 * EquipRite FDD v2.0 (docs/fdd-v2): the worked accounting balances, every flow is well formed, every journal code a
 * flow step names exists, and the document renders without gaps.
 *
 * Run:  node tests/fdd-v2.test.js
 */
'use strict';

const H = require('./_harness');
const journals = require('../docs/fdd-v2/tools/journals');
const { LANES, FLOWS } = require('../docs/fdd-v2/tools/flows');
const { svgs } = require('../docs/fdd-v2/tools/diagrams');
const doc = require('../docs/fdd-v2/tools/build-fdd-v2');

const T = H.makeAsserter();

T.section('every journal entry balances');
[{}, { weeks: 6, icRate: 1250, vat: 0.15, fx: 3.75, fxPay: 3.7, wht: 0.1 }, { fxPay: 0.9, lossValue: 200000, damage: 6000 }, { vat: 0, wht: 0 }].forEach((input, i) => {
  const r = journals(input);
  const bad = r.entries.filter((e) => {
    let dr = 0;
    let cr = 0;
    e.lines.forEach((l) => { if (l[0] === 'Dr') dr += l[2]; else cr += l[2]; });
    return Math.abs(dr - cr) > 0.005 || e.lines.some((l) => !l[1] || !isFinite(l[2]) || l[2] < 0);
  });
  T.eq('assumptions #' + (i + 1) + ': ' + r.entries.length + ' entries, none unbalanced or negative', bad.map((e) => e.id).join(), '');
});

T.section('the worked numbers');
const J = journals({});
T.eq('the IC invoice: 4 weeks × 1,000 + transport 600, VAT 5 %', [J.totals.icNet, J.totals.icVat, J.totals.icGross].join(), '4600,230,4830');
T.eq('Customer X (S2) and ProjectCo\'s margin', [J.totals.custNet, J.totals.margin2].join(), '6300,1700');
T.eq('Customer Y (S3)', J.totals.gross3, 7035);
T.eq('cross-border: cost converted at 0.92, exchange loss at 0.93', [J.totals.xbCost, J.totals.xbFx].join(), '4232,46');
T.eq('ids are unique', new Set(J.entries.map((e) => e.id)).size, J.entries.length);
T.check('every entry names its company, scenarios and source', J.entries.every((e) => ['FleetCo', 'ProjectCo', 'Group'].indexOf(e.ledger) !== -1 && e.sc.length && e.source && e.when));
T.check('the intercompany invoice is the same amount on both sides (F6 = P2)', J.entries.filter((e) => e.id === 'F6')[0].lines[0][2] === J.entries.filter((e) => e.id === 'P2')[0].lines.slice(-1)[0][2]);
T.check('elimination removes exactly the IC revenue (G1 = F6 net)', J.entries.filter((e) => e.id === 'G1')[0].lines.filter((l) => l[0] === 'Cr')[0][2] === J.totals.icNet);

T.section('the flows');
const ids = new Set(J.entries.map((e) => e.id));
FLOWS.forEach((f) => {
  const keys = new Set(f.steps.map((s) => s.key));
  T.check(f.short + ': lanes exist and every step sits in one of them', f.lanes.every((l) => LANES[l]) && f.steps.every((s) => f.lanes.indexOf(s.lane) !== -1));
  T.check(f.short + ': every edge joins two of its steps', f.edges.every((e) => keys.has(e.from) && keys.has(e.to)));
  const pos = new Set();
  T.check(f.short + ': no two steps in one cell', f.steps.every((s) => { const k = s.lane + ':' + s.col; if (pos.has(k)) return false; pos.add(k); return true; }));
  const codes = f.steps.filter((s) => s.dp).map((s) => s.dp.split(' ')).reduce((a, b) => a.concat(b), []);
  T.eq(f.short + ': every journal code on a step exists', codes.filter((c) => !ids.has(c)).join(), '');
});
const S = svgs();
T.check('drawn by EquipRite Next\'s renderer: four SVGs', FLOWS.every((f) => /^<svg class="fdd-svg"/.test(S[f.id]) && S[f.id].indexOf('data-step=') !== -1));

T.section('the document');
const html = doc.render();
T.check('15 chapters', (html.match(/<section class="chapter"/g) || []).length === 15);
T.check('no undefined, NaN or empty cells from missing data', !/undefined|NaN|>null</.test(html));
T.check('requirement ids unique', new Set(doc.BR.map((r) => r[0]).concat(doc.FR.reduce((a, g) => a.concat(g[1].map((r) => r[0])), []))).size === doc.BR.length + doc.FR.reduce((a, g) => a + g[1].length, 0));
T.check('the explorer ships with the same journal function', html.indexOf('function journals(') !== -1 && html.indexOf('id="jx"') !== -1);

T.report();
