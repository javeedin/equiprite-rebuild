define(['resources/js/fddCatalog'], function (C) {
  'use strict';

  // The EquipRite FDD page's logic, pure: the requirements as rows (filters, groups by module), the KPIs and the
  // breakdowns of the mapping to the development, the mapping's rows and lists, the flows' step details, and each flow
  // as a swimlane diagram in SVG (static markup, as Help's helpGuide.svg). The content is resources/js/fddCatalog.js.
  //
  // Screens are named through `names`: { nav: { id: label } (Next's menu, nav.ITEMS), open: { id: true } (the Next
  // screens this user may open) }; without them the ids are shown as they are and nothing opens.

  var STATUS_LABEL = { done: 'Done', partly: 'Partly done', none: 'Not started', na: 'Not applicable' };
  var STATUS_ORDER = ['done', 'partly', 'none', 'na'];
  var KIND_LABEL = { business: 'Business requirement', page: 'Page (functional)', integration: 'Integration', scenario: 'Scenario', decision: 'Decision point', beyond: 'Beyond the FDD' };
  var MOBILE_LABEL = { approve: 'Approve', pick: 'Pick', request: 'Request', track: 'My requests', me: 'Me' };
  var DEVICE_LABEL = { desktop: 'Desktop client', android: 'Android app' };
  var APPS = [
    { key: 'next', label: 'EquipRite Next' }, { key: 'newApp', label: 'New EquipRite' }, { key: 'oldApp', label: 'Old EquipRite' },
    { key: 'mobile', label: 'EquipRite Mobile' }, { key: 'device', label: 'Desktop and Android' }
  ];

  function byId(list) { var o = {}; (list || []).forEach(function (x) { o[x.id || x.key] = x; }); return o; }
  var MOD = byId(C.MODULES);
  var PHASE = byId(C.PHASES);
  var SCEN = byId(C.SCENARIOS);
  var INTS = byId(C.INTEGRATIONS);
  var DPS = byId(C.DECISIONS);
  var REQS = byId(C.REQUIREMENTS);
  var BEY = byId(C.BEYOND);

  function low(v) { return String(v == null ? '' : v).toLowerCase(); }
  function mapOf(id) { return C.MAPPING[id] || null; }
  function statusOf(id) { var m = mapOf(id); return m ? m.status : ''; }
  function statusLabel(s) { return STATUS_LABEL[s] || ''; }
  function navLabel(names, id) { var n = names && names.nav; return (n && n[id]) || id; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /** Where a mapping entry lives, in words: { next: [{ id, label, open }], newApp, oldApp, mobile, device, any }. */
  function where(entry, names) {
    var e = entry || {};
    var open = (names && names.open) || {};
    return {
      next: (e.next || []).map(function (id) { return { id: id, label: navLabel(names, id), open: !!open[id] }; }),
      newApp: (e.newApp || []).slice(),
      oldApp: (e.oldApp || []).slice(),
      mobile: (e.mobile || []).map(function (t) { return MOBILE_LABEL[t] || t; }),
      device: (e.device || []).map(function (d) { return DEVICE_LABEL[d] || d; })
    };
  }

  // ── Requirements ─────────────────────────────────────────────────────────────────────────────────────────────
  /** Every requirement as a row: what the FDD says, its module and phase, the roles and scenarios, how far it is built. */
  function requirementRows(names) {
    return C.REQUIREMENTS.map(function (r) {
      var mp = mapOf(r.id) || {};
      var w = where(mp, names);
      var label = r.kind === 'page' ? '§' + r.id : r.id;
      return {
        id: r.id, label: label, kind: r.kind, kindLabel: KIND_LABEL[r.kind], title: r.title, says: r.says,
        module: r.module, moduleLabel: (MOD[r.module] || {}).label || r.module,
        phase: r.phase, phaseLabel: (PHASE[r.phase] || {}).label || r.phase, phaseShort: (PHASE[r.phase] || {}).short || r.phase,
        priority: r.priority, section: r.section, vague: r.vague || '',
        roles: (r.roles || []).map(function (k) { return C.ROLES[k] || k; }),
        scenarios: (r.scenarios || []).map(function (id) { return { id: id, title: (SCEN[id] || {}).title || '', status: statusOf(id), statusLabel: statusLabel(statusOf(id)) }; }),
        integrations: (r.integrations || []).map(function (id) { return { id: id, title: (INTS[id] || {}).name || '', status: statusOf(id), statusLabel: statusLabel(statusOf(id)) }; }),
        detail: (r.detail || []).slice(),
        status: mp.status || '', statusLabel: statusLabel(mp.status), has: mp.has || '', missing: mp.missing || '',
        next: w.next, nextText: w.next.map(function (x) { return x.label; }).join(', '),
        search: low([r.id, label, r.title, r.says, r.section, (MOD[r.module] || {}).label, (PHASE[r.phase] || {}).label, (r.detail || []).join(' '), r.vague,
          (r.roles || []).map(function (k) { return C.ROLES[k]; }).join(' '), (r.scenarios || []).join(' '), (r.integrations || []).join(' '), mp.has, mp.missing].join(' '))
      };
    });
  }

  /** The rows a search and the filters keep: f { text, module, phase, kind } ('all' or '' for any). */
  function filterRequirements(rows, f) {
    var o = f || {};
    var words = low(o.text).split(/\s+/).filter(function (w) { return !!w; });
    return (rows || []).filter(function (r) {
      if (o.module && o.module !== 'all' && r.module !== o.module) return false;
      if (o.phase && o.phase !== 'all' && r.phase !== o.phase) return false;
      if (o.kind && o.kind !== 'all' && r.kind !== o.kind) return false;
      if (o.status && o.status !== 'all' && r.status !== o.status) return false;
      return words.every(function (w) { return r.search.indexOf(w) !== -1; });
    });
  }

  /** The rows by module, in the FDD's order, empty modules left out. */
  function groupByModule(rows) {
    return C.MODULES.map(function (m) {
      var list = (rows || []).filter(function (r) { return r.module === m.key; });
      return { key: m.key, label: m.label, what: m.what, rows: list, count: list.length, countText: plural(list.length, 'requirement') };
    }).filter(function (g) { return g.count > 0; });
  }

  /** Filter chips with counts: by module, phase, kind (counted on the other filters, as a person narrows down). */
  function chips(rows, field, f) {
    var other = Object.assign({}, f || {});
    other[field] = 'all';
    var base = filterRequirements(rows, other);
    var defs = field === 'module' ? C.MODULES.map(function (m) { return { key: m.key, label: m.label }; })
      : field === 'phase' ? C.PHASES.map(function (p) { return { key: p.key, label: p.short }; })
        : [{ key: 'business', label: 'Business (4.1)' }, { key: 'page', label: 'Pages (7)' }];
    return [{ key: 'all', label: 'All', count: base.length }].concat(defs.map(function (d) {
      return { key: d.key, label: d.label, count: base.filter(function (r) { return r[field] === d.key; }).length };
    }));
  }

  // ── The mapping: KPIs, breakdowns, rows ──────────────────────────────────────────────────────────────────────
  function count(ids) {
    var c = { total: 0, done: 0, partly: 0, none: 0, na: 0 };
    (ids || []).forEach(function (id) { var s = statusOf(id) || 'none'; c.total += 1; c[s] += 1; });
    c.applicable = c.total - c.na;
    c.pct = c.applicable ? Math.round(((c.done + c.partly / 2) / c.applicable) * 100) : 0;
    return c;
  }

  function reqIds() { return C.REQUIREMENTS.map(function (r) { return r.id; }); }
  function fddScenarioIds() { return C.SCENARIOS.filter(function (s) { return s.inFdd !== false; }).map(function (s) { return s.id; }); }

  /** The KPIs: requirements by status and % complete, by app, integrations, scenarios and decision points. */
  function kpis() {
    var r = count(reqIds());
    var ints = count(C.INTEGRATIONS.map(function (i) { return i.id; }));
    var sc = count(fddScenarioIds());
    var dp = count(C.DECISIONS.map(function (d) { return d.id; }));
    var apps = APPS.map(function (a) {
      var n = C.REQUIREMENTS.filter(function (q) { var m = mapOf(q.id); return m && (m[a.key] || []).length > 0; }).length;
      return { key: a.key, label: a.label, n: n, total: r.total, text: n + ' of ' + r.total };
    });
    return {
      req: r, ints: ints, scen: sc, dps: dp, apps: apps,
      business: C.REQUIREMENTS.filter(function (q) { return q.kind === 'business'; }).length,
      pages: C.REQUIREMENTS.filter(function (q) { return q.kind === 'page'; }).length,
      beyond: C.BEYOND.length,
      headline: r.pct + '% of the FDD\'s requirements are built: ' + r.done + ' done, ' + r.partly + ' partly done, ' + r.none + ' not started'
        + (r.na ? ', ' + r.na + ' not applicable yet' : '') + '. Integrations ' + ints.done + ' of ' + ints.total + ' done (' + ints.partly + ' partly); scenarios '
        + sc.done + ' of ' + sc.total + ' done (' + sc.partly + ' partly).',
      tiles: [
        { key: 'total', label: 'Requirements', value: String(r.total), note: '14 business (4.1), ' + (r.total - 14) + ' pages (7)', st: 'all' },
        { key: 'done', label: 'Done', value: String(r.done), note: 'Built and usable', st: 'done' },
        { key: 'partly', label: 'Partly done', value: String(r.partly), note: 'Something is missing', st: 'partly' },
        { key: 'none', label: 'Not started', value: String(r.none), note: 'Nothing in the code', st: 'none' },
        { key: 'na', label: 'Not applicable', value: String(r.na), note: 'A future phase (2.3)', st: 'na' },
        { key: 'pct', label: 'Complete', value: r.pct + '%', note: 'Done counts 1, partly ½', st: 'pct' }
      ],
      tiles2: apps.slice(0, 4).map(function (a) { return { key: a.key, label: 'In ' + a.label, value: a.text, note: 'requirements with a screen there', st: 'app' }; }).concat([
        { key: 'ints', label: 'Integrations', value: ints.done + ' + ' + ints.partly + ' of ' + ints.total, note: 'done + partly; ' + ints.none + ' not started', st: 'ints' },
        { key: 'scen', label: 'Scenarios', value: sc.done + ' + ' + sc.partly + ' of ' + sc.total, note: 'done + partly; ' + sc.none + ' not started (S35 is the redesign\'s)', st: 'scen' },
        { key: 'dps', label: 'Decision points', value: dp.done + ' + ' + dp.partly + ' of ' + dp.total, note: 'DP-01 to DP-10; ' + dp.none + ' not started', st: 'dps' }
      ])
    };
  }

  /** Requirements by module or by phase: per group the counts and the bar's segments (width in %). */
  function breakdown(by) {
    var groups = by === 'phase' ? C.PHASES : C.MODULES;
    return groups.map(function (g) {
      var ids = C.REQUIREMENTS.filter(function (r) { return (by === 'phase' ? r.phase : r.module) === g.key; }).map(function (r) { return r.id; });
      var c = count(ids);
      var segs = STATUS_ORDER.filter(function (s) { return c[s] > 0; }).map(function (s) {
        return { status: s, n: c[s], w: c.total ? Math.round((c[s] / c.total) * 1000) / 10 : 0, title: c[s] + ' ' + STATUS_LABEL[s].toLowerCase() };
      });
      return {
        key: g.key, label: by === 'phase' ? g.short : g.label, sub: plural(c.total, 'requirement'), total: c.total, pct: c.pct, pctText: c.applicable ? c.pct + '%' : '—', segs: segs,
        text: STATUS_ORDER.filter(function (s) { return c[s] > 0; }).map(function (s) { return c[s] + ' ' + STATUS_LABEL[s].toLowerCase(); }).join(' · '),
        aria: (by === 'phase' ? g.short : g.label) + ': ' + plural(c.total, 'requirement') + (c.applicable ? ', ' + c.pct + '% complete' : ', not expected yet')
      };
    }).filter(function (g) { return g.total > 0; });
  }

  var MAP_KINDS = [
    { key: 'requirements', label: 'Requirements' }, { key: 'integrations', label: 'Integrations' }, { key: 'scenarios', label: 'Scenarios' },
    { key: 'decisions', label: 'Decision points' }, { key: 'beyond', label: 'Beyond the FDD' }, { key: 'all', label: 'Everything' }
  ];

  function itemsOf(kind) {
    var out = [];
    if (kind === 'requirements' || kind === 'all') {
      C.REQUIREMENTS.forEach(function (r) { out.push({ id: r.id, label: r.kind === 'page' ? '§' + r.id : r.id, kind: r.kind, title: r.title, section: r.section, module: r.module, phase: r.phase }); });
    }
    if (kind === 'integrations' || kind === 'all') {
      C.INTEGRATIONS.forEach(function (i) { out.push({ id: i.id, label: i.id, kind: 'integration', title: i.name + ' (' + i.module + ', ' + i.dir + ')', section: '8.1', module: 'cross', phase: 'across' }); });
    }
    if (kind === 'scenarios' || kind === 'all') {
      C.SCENARIOS.forEach(function (s) { out.push({ id: s.id, label: s.id, kind: 'scenario', title: s.title, section: s.refs, module: 'cross', phase: s.phase, inFdd: s.inFdd !== false }); });
    }
    if (kind === 'decisions' || kind === 'all') {
      C.DECISIONS.forEach(function (d) { out.push({ id: d.id, label: d.id, kind: 'decision', title: d.title, section: d.id + ', ' + d.scenario, module: 'cross', phase: (SCEN[d.scenario] || {}).phase || 'across' }); });
    }
    if (kind === 'beyond' || kind === 'all') {
      C.BEYOND.forEach(function (b) { out.push({ id: b.id, label: b.id, kind: 'beyond', title: b.title, section: b.note, module: 'cross', phase: 'across' }); });
    }
    return out;
  }

  /** The mapping's rows for one kind (or 'all'): status, where it lives in each app, tests, evidence, built, missing. */
  function mappingRows(kind, names) {
    return itemsOf(kind || 'requirements').map(function (it) {
      var mp = mapOf(it.id) || {};
      var w = where(mp, names);
      var status = mp.status || 'none';
      return {
        id: it.id, label: it.label, kind: it.kind, kindLabel: KIND_LABEL[it.kind], title: it.title, section: it.section, status: status, statusLabel: statusLabel(status),
        next: w.next, nextText: w.next.map(function (x) { return x.label; }).join(', '), newText: w.newApp.join(', '), oldText: w.oldApp.join(', '),
        mobileText: w.mobile.join(', '), deviceText: w.device.join(', '),
        apps: [w.next.length ? 'Next' : '', w.newApp.length ? 'New' : '', w.oldApp.length ? 'Old' : '', w.mobile.length ? 'Mobile' : '', w.device.length ? w.device.join(', ') : '']
          .filter(function (x) { return !!x; }).join(' · '),
        tests: (mp.tests || []).slice(), testsText: (mp.tests || []).join(', '), testCount: (mp.tests || []).length,
        evidence: (mp.evidence || []).slice(), evidenceText: (mp.evidence || []).join(', '), has: mp.has || '', missing: mp.missing || '', inFdd: it.inFdd !== false,
        search: low([it.id, it.label, it.title, it.section, mp.has, mp.missing, (mp.next || []).join(' '), w.next.map(function (x) { return x.label; }).join(' '),
          (mp.newApp || []).join(' '), (mp.oldApp || []).join(' '), w.mobile.join(' '), (mp.tests || []).join(' '), (mp.evidence || []).join(' ')].join(' '))
      };
    });
  }

  function filterMapping(rows, f) {
    var o = f || {};
    var words = low(o.text).split(/\s+/).filter(function (w) { return !!w; });
    return (rows || []).filter(function (r) {
      if (o.status && o.status !== 'all' && r.status !== o.status) return false;
      return words.every(function (w) { return r.search.indexOf(w) !== -1; });
    });
  }

  function statusChips(rows) {
    return [{ key: 'all', label: 'All', count: (rows || []).length }].concat(STATUS_ORDER.map(function (s) {
      return { key: s, label: STATUS_LABEL[s], count: (rows || []).filter(function (r) { return r.status === s; }).length };
    }));
  }

  /** What is pending: every item not started, of every kind (beyond the FDD aside), FDD order. */
  function pending(names) {
    return mappingRows('all', names).filter(function (r) { return r.status === 'none' && r.kind !== 'beyond'; });
  }

  /** What is partly done and what is missing, for one kind. */
  function partly(kind, names) {
    return mappingRows(kind || 'requirements', names).filter(function (r) { return r.status === 'partly'; });
  }

  function partlyChips(names) {
    return MAP_KINDS.filter(function (k) { return k.key !== 'beyond' && k.key !== 'all'; }).map(function (k) {
      return { key: k.key, label: k.label, count: partly(k.key, names).length };
    });
  }

  // ── What each tab shows, in one object (the page sets it in one step) ─────────────────────────────────────────
  /** Requirements tab: f { text, module, phase, kind } → { groups, shown, summary, module, phase, kind (chips) }. */
  function reqView(all, f) {
    var shown = filterRequirements(all, f);
    var total = (all || []).length;
    var filtered = shown.length !== total;
    return {
      groups: groupByModule(shown), shown: shown,
      summary: filtered ? shown.length + ' of ' + total + ' requirements match' : total + ' requirements: ' + C.REQUIREMENTS.filter(function (r) { return r.kind === 'business'; }).length
        + ' business requirements (FDD 4.1) and ' + C.REQUIREMENTS.filter(function (r) { return r.kind === 'page'; }).length + ' pages (FDD 7)',
      module: chips(all, 'module', f), phase: chips(all, 'phase', f), kind: chips(all, 'kind', f)
    };
  }

  /** Mapping tab's table: one kind (or everything), a status, a search → { rows, chips, kinds, summary }. */
  function mapView(kind, status, text, names) {
    var all = mappingRows(kind, names);
    var rows = filterMapping(all, { status: status, text: text });
    var k = MAP_KINDS.filter(function (x) { return x.key === kind; })[0] || MAP_KINDS[0];
    return {
      rows: rows, chips: statusChips(filterMapping(all, { text: text })),
      kinds: MAP_KINDS.map(function (x) { return { key: x.key, label: x.label, count: itemsOf(x.key).length }; }),
      summary: rows.length === all.length ? all.length + ' ' + k.label.toLowerCase() : rows.length + ' of ' + all.length + ' ' + k.label.toLowerCase()
    };
  }

  /** The partly-done list for one kind, with the chips to switch kind. */
  function partlyView(kind, names) {
    return { rows: partly(kind, names), chips: partlyChips(names) };
  }

  // ── Exports ──────────────────────────────────────────────────────────────────────────────────────────────────
  function exportColumns(view) {
    if (view === 'requirements') {
      return [{ key: 'label', label: 'ID' }, { key: 'kindLabel', label: 'Kind' }, { key: 'title', label: 'Requirement' }, { key: 'says', label: 'What the FDD says' },
        { key: 'moduleLabel', label: 'Module' }, { key: 'phaseLabel', label: 'Phase' }, { key: 'priority', label: 'Priority' }, { key: 'section', label: 'FDD section' },
        { key: 'rolesText', label: 'Roles' }, { key: 'scenariosText', label: 'Scenarios' }, { key: 'integrationsText', label: 'Integrations' },
        { key: 'statusLabel', label: 'Development status' }, { key: 'vague', label: 'Where the FDD is vague' }];
    }
    if (view === 'flows') {
      return [{ key: 'flow', label: 'Flow' }, { key: 'n', label: 'Step' }, { key: 'title', label: 'What' }, { key: 'laneLabel', label: 'Who / where' }, { key: 'kindLabel', label: 'Kind' },
        { key: 'section', label: 'FDD section' }, { key: 'fdd', label: 'FDD status' }, { key: 'devText', label: 'Stored statuses' }, { key: 'dpText', label: 'Decision point' },
        { key: 'intsText', label: 'Integrations' }, { key: 'statusLabel', label: 'Development status' }, { key: 'screensText', label: 'Next screens' }, { key: 'what', label: 'What happens' }];
    }
    return [{ key: 'label', label: 'ID' }, { key: 'kindLabel', label: 'Kind' }, { key: 'title', label: 'Item' }, { key: 'section', label: 'FDD' }, { key: 'statusLabel', label: 'Status' },
      { key: 'nextText', label: 'EquipRite Next' }, { key: 'newText', label: 'New EquipRite' }, { key: 'oldText', label: 'Old EquipRite' }, { key: 'mobileText', label: 'EquipRite Mobile' },
      { key: 'deviceText', label: 'Desktop / Android' }, { key: 'testsText', label: 'Tests' }, { key: 'evidenceText', label: 'Evidence' }, { key: 'has', label: 'What is built' },
      { key: 'missing', label: 'What is missing' }];
  }

  /** Requirement rows ready for export (lists as text). */
  function exportRequirements(rows) {
    return (rows || []).map(function (r) {
      return Object.assign({}, r, {
        rolesText: r.roles.join(', '),
        scenariosText: r.scenarios.map(function (s) { return s.id; }).join(', '),
        integrationsText: r.integrations.map(function (s) { return s.id; }).join(', ')
      });
    });
  }

  // ── Flows ────────────────────────────────────────────────────────────────────────────────────────────────────
  function flowOf(id) { return C.FLOWS.filter(function (f) { return f.id === id; })[0] || null; }
  var KIND_STEP = { task: 'A step someone takes', decision: 'A decision', system: 'Done by a system', end: 'The outcome' };

  /** The flows for the list: each with its steps and how far they are built. */
  function flowList() {
    return C.FLOWS.map(function (f) {
      var c = count(f.steps.map(function (s) { return s.map; }).filter(function (m) { return !!m; }));
      var ints = {};
      f.steps.forEach(function (s) { (s.ints || []).forEach(function (i) { ints[i] = 1; }); });
      return { id: f.id, title: f.title, short: f.short, section: f.section, steps: f.steps.length, lanes: f.lanes.length,
        sub: plural(f.steps.length, 'step') + ' · ' + plural(Object.keys(ints).length, 'integration') + ' · ' + c.pct + '% built' };
    });
  }

  /** One flow's head: title, summary, lanes, what it covers. */
  function flowInfo(id) {
    var f = flowOf(id);
    if (!f) return { id: '' };
    var scen = {};
    var dps = {};
    var ints = {};
    f.steps.forEach(function (s) {
      if (/^S\d+$/.test(s.map || '')) scen[s.map] = 1;
      if (s.dp) dps[s.dp] = 1;
      (s.ints || []).forEach(function (i) { ints[i] = 1; });
    });
    return {
      id: f.id, title: f.title, summary: f.summary, section: f.section, vague: f.vague || '', map: f.kind === 'map',
      lanes: f.lanes.map(function (k) { return C.LANES[k].label; }).join(' · '),
      covers: [Object.keys(scen).sort().join(', '), Object.keys(dps).sort().join(', '), Object.keys(ints).sort().join(', ')].filter(function (x) { return !!x; }).join(' · ')
    };
  }

  /** A step with everything its panel says: who, what, the FDD's section and status, the stored ones, how it is built. */
  function stepDetail(flowId, key, names) {
    var f = flowOf(flowId);
    if (!f) return null;
    var i = -1;
    for (var k = 0; k < f.steps.length; k++) if (f.steps[k].key === key) i = k;
    if (i < 0) return null;
    var s = f.steps[i];
    var lane = C.LANES[s.lane] || {};
    var mp = s.map ? mapOf(s.map) : null;
    var w = where(mp, names);
    var screens = (s.navIds || []).map(function (id) { return { id: id, label: navLabel(names, id), open: !!((names && names.open) || {})[id] }; });
    var mapTitle = s.map ? ((REQS[s.map] && ((REQS[s.map].kind === 'page' ? '§' : '') + s.map + ' ' + REQS[s.map].title)) || (SCEN[s.map] && s.map + ' ' + SCEN[s.map].title)
      || (INTS[s.map] && s.map + ' ' + INTS[s.map].name) || (DPS[s.map] && s.map + ' ' + DPS[s.map].title) || (BEY[s.map] && s.map + ' ' + BEY[s.map].title) || s.map) : '';
    var ints = (s.ints || []).map(function (id) {
      var x = INTS[id] || {};
      return { id: id, text: id + ' ' + (x.name || '') + ' · ' + (x.module || '') + ' · ' + (x.method || '') + ', ' + (x.dir === 'in' ? 'into EquipRite' : 'out of EquipRite'),
        status: statusOf(id), statusLabel: statusLabel(statusOf(id)) };
    });
    var status = mp ? mp.status : '';
    return {
      key: s.key, n: i + 1, of: f.steps.length, flow: f.title, title: s.label.join(' '), lane: s.lane, laneLabel: lane.label + (lane.sub ? ' (' + lane.sub + ')' : ''),
      kind: s.kind || 'task', kindLabel: KIND_STEP[s.kind || 'task'], what: s.what || '', section: s.section || '', fdd: s.fdd || '', dev: (s.dev || []).slice(),
      devText: (s.dev || []).join(', '), dp: s.dp ? { id: s.dp, title: (DPS[s.dp] || {}).title || '', status: statusOf(s.dp), statusLabel: statusLabel(statusOf(s.dp)) } : null,
      dpText: s.dp || '', ints: ints, intsText: (s.ints || []).join(', '), notInFdd: !!s.notInFdd,
      map: s.map || '', mapTitle: mapTitle, status: status, statusLabel: status ? statusLabel(status) : 'Not mapped', has: mp ? mp.has : '', missing: mp ? mp.missing : '',
      screens: screens, screensText: screens.map(function (x) { return x.label; }).join(', '), canOpen: screens.some(function (x) { return x.open; }),
      newText: w.newApp.join(', '), oldText: w.oldApp.join(', '), mobileText: w.mobile.join(', '), deviceText: w.device.join(', '),
      first: i === 0, last: i === f.steps.length - 1, prev: i > 0 ? f.steps[i - 1].key : '', next: i < f.steps.length - 1 ? f.steps[i + 1].key : ''
    };
  }

  /** Every step of a flow as export rows. */
  function flowRows(flowId, names) {
    var f = flowOf(flowId);
    if (!f) return [];
    return f.steps.map(function (s) { return Object.assign({ flow: f.title }, stepDetail(flowId, s.key, names)); });
  }

  // ── The diagram ──────────────────────────────────────────────────────────────────────────────────────────────
  var LEFT = 132;
  var TOP = 14;
  var LANE_H = 92;
  var NODE_H = 52;

  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /**
   * A flow's geometry: lanes (top, height), each step's box, and the edges' paths with where their tags sit.
   * Routing: a forward edge runs along its own lane and turns in the gap just before the target (or, when its own lane
   * has a step in the way, turns at once and runs along the target's lane); a step under another in the same column is
   * joined straight down or up; an edge back to an earlier column loops over the top of the higher lane, dashed.
   */
  function layout(flow) {
    var f = flow;
    var colW = f.colW || 136;
    var nodeW = f.nodeW || 108;
    var gap = colW - nodeW;
    var laneIdx = {};
    f.lanes.forEach(function (k, i) { laneIdx[k] = i; });
    var maxCol = 0;
    f.steps.forEach(function (s) { if (s.col > maxCol) maxCol = s.col; });
    var width = LEFT + (maxCol + 1) * colW + 12;
    var height = TOP + f.lanes.length * LANE_H + 6;
    function laneTop(i) { return TOP + i * LANE_H; }
    var boxes = {};
    var occupied = {};
    f.steps.forEach(function (s) {
      var li = laneIdx[s.lane];
      var x = LEFT + s.col * colW + gap / 2;
      var y = laneTop(li) + (LANE_H - NODE_H) / 2;
      boxes[s.key] = { x: x, y: y, w: nodeW, h: NODE_H, cx: x + nodeW / 2, cy: y + NODE_H / 2, lane: li, col: s.col };
      occupied[li + ':' + s.col] = true;
    });
    function blocked(li, c1, c2) {
      for (var c = Math.min(c1, c2) + 1; c < Math.max(c1, c2); c++) if (occupied[li + ':' + c]) return true;
      return false;
    }
    // Two edges from different steps never share a vertical run: the later one moves aside by 6 px (within the gap).
    var vsegs = [];
    function free(x, ya, yb, from) {
      var y1 = Math.min(ya, yb);
      var y2 = Math.max(ya, yb);
      var tries = [0, 6, -6, 11, -11];
      for (var t = 0; t < tries.length; t++) {
        var cand = x + tries[t];
        var clash = vsegs.some(function (v) { return v.from !== from && Math.abs(v.x - cand) < 3 && v.y1 < y2 && y1 < v.y2; });
        if (!clash) return cand;
      }
      return x;
    }
    var loops = {};
    var edges = (f.edges || []).map(function (e) {
      var a = boxes[e.from];
      var b = boxes[e.to];
      if (!a || !b) return null;
      var d;
      var tag;
      var back = b.col < a.col || !!e.back;
      if (back && b.col <= a.col) {
        var upper = Math.min(a.lane, b.lane);
        var k = loops[upper] = (loops[upper] || 0) + 1;
        var ly = laneTop(upper) + 4 + (k - 1) * 6;
        d = 'M' + a.cx + ' ' + a.y + ' V' + ly + ' H' + b.cx + ' V' + (b.y - 3);
        tag = { x: (a.cx + b.cx) / 2, y: ly };
      } else if (a.col === b.col) {
        var down = b.lane > a.lane;
        var y1 = down ? a.y + a.h : a.y;
        var y2 = down ? b.y - 3 : b.y + b.h + 3;
        d = 'M' + a.cx + ' ' + y1 + ' V' + y2;
        tag = { x: a.cx, y: down ? laneTop(b.lane) : laneTop(b.lane) + LANE_H };
      } else {
        var x1 = a.x + a.w;
        var x2 = b.x - 3;
        if (a.lane === b.lane) {
          d = 'M' + x1 + ' ' + a.cy + ' H' + x2;
          tag = { x: (x1 + b.x) / 2, y: a.cy - 9, inline: true };
        } else {
          var turnLate = !blocked(a.lane, a.col, b.col);
          var xv = free(turnLate ? b.x - gap / 2 : a.x + a.w + gap / 2, a.cy, b.cy, e.from);
          vsegs.push({ x: xv, y1: Math.min(a.cy, b.cy), y2: Math.max(a.cy, b.cy), from: e.from });
          d = 'M' + x1 + ' ' + a.cy + ' H' + xv + ' V' + b.cy + ' H' + x2;
          var goingDown = b.lane > a.lane;
          tag = { x: xv, y: goingDown ? laneTop(b.lane) : laneTop(b.lane) + LANE_H };
        }
      }
      var text = [e.label || '', (e.ints || []).join(' · ')].filter(function (x) { return !!x; }).join(' · ');
      return { from: e.from, to: e.to, d: d, back: back, ints: (e.ints || []).length > 0, start: e.arrow === 'start', text: text, tag: tag };
    }).filter(function (e) { return !!e; });
    return { width: width, height: height, laneTop: laneTop, boxes: boxes, edges: edges, colW: colW, nodeW: nodeW };
  }

  function lines(arr, cx, cy, cls, lh) {
    var h = lh || 14;
    var y0 = cy - ((arr.length - 1) * h) / 2 + 4;
    return arr.map(function (t, i) { return '<text class="' + cls + '" x="' + cx + '" y="' + (y0 + i * h) + '" text-anchor="middle">' + esc(t) + '</text>'; }).join('');
  }

  /**
   * The flow as SVG (static words only): lanes, steps (each a <g data-step="key"> a click or Enter opens), the edges
   * with their integration and branch tags, and a dot on each step saying how far the development has it.
   * o: { selected }.
   */
  function svg(flowId, o) {
    var f = flowOf(flowId);
    if (!f) return '';
    var opts = o || {};
    var L = layout(f);
    var out = [];
    out.push('<svg class="fdd-svg" viewBox="0 0 ' + L.width + ' ' + L.height + '" width="' + L.width + '" height="' + L.height
      + '" role="group" aria-label="' + esc(f.title + ': a swimlane diagram with ' + f.lanes.length + ' lanes and ' + f.steps.length + ' steps') + '" xmlns="http://www.w3.org/2000/svg">');
    out.push('<defs>' + ['', '--int', '--back'].map(function (v) {
      return '<marker id="fddArrow' + v + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        + '<path d="M0 0 L10 5 L0 10 z" class="fdd-head' + (v ? ' fdd-head' + v : '') + '"/></marker>';
    }).join('') + '</defs>');
    f.lanes.forEach(function (k, i) {
      var lane = C.LANES[k];
      var y = L.laneTop(i);
      out.push('<rect class="fdd-lane' + (i % 2 ? ' fdd-lane--alt' : '') + (lane.fusion ? ' fdd-lane--fusion' : '') + (lane.system ? ' fdd-lane--system' : '') + '" x="0" y="' + y
        + '" width="' + L.width + '" height="' + LANE_H + '"/>');
      out.push('<line class="fdd-lane-line" x1="0" x2="' + L.width + '" y1="' + y + '" y2="' + y + '"/>');
      out.push('<text class="fdd-lane-label" x="12" y="' + (y + LANE_H / 2 - 3) + '">' + esc(lane.label) + '</text>');
      out.push('<text class="fdd-lane-sub" x="12" y="' + (y + LANE_H / 2 + 12) + '">' + esc(lane.sub || '') + '</text>');
    });
    out.push('<line class="fdd-lane-edge" x1="' + (LEFT - 8) + '" x2="' + (LEFT - 8) + '" y1="' + TOP + '" y2="' + (L.height - 6) + '"/>');
    L.edges.forEach(function (e) {
      var cls = 'fdd-edge' + (e.back ? ' fdd-edge--back' : (e.ints ? ' fdd-edge--int' : ''));
      var mk = 'url(#fddArrow' + (e.back ? '--back' : (e.ints ? '--int' : '')) + ')';
      out.push('<path class="' + cls + '" d="' + e.d + '" ' + (e.start ? 'marker-start="' + mk + '"' : 'marker-end="' + mk + '"') + '/>');
    });
    // Tags after every edge, so a line never crosses one.
    L.edges.forEach(function (e) {
      if (!e.text) return;
      var tw = Math.round(e.text.length * 6.1 + 12);
      var cls = 'fdd-tag' + (e.back ? ' fdd-tag--back' : (e.ints ? ' fdd-tag--int' : ''));
      out.push('<g class="' + cls + '"><rect x="' + (e.tag.x - tw / 2) + '" y="' + (e.tag.y - 8) + '" width="' + tw + '" height="16" rx="8"/>'
        + '<text x="' + e.tag.x + '" y="' + (e.tag.y + 3.5) + '" text-anchor="middle">' + esc(e.text) + '</text></g>');
    });
    f.steps.forEach(function (s, i) {
      var b = L.boxes[s.key];
      var kind = s.kind || 'task';
      var st = s.map ? statusOf(s.map) : '';
      var cls = 'fdd-node fdd-node--' + kind + (s.notInFdd ? ' fdd-node--dev' : '') + (opts.selected === s.key ? ' fdd-node--on' : '');
      out.push('<g class="' + cls + '" data-step="' + esc(s.key) + '" tabindex="0" role="button" aria-label="'
        + esc('Step ' + (i + 1) + ': ' + s.label.join(' ') + ', ' + C.LANES[s.lane].label + (s.dp ? ', ' + s.dp : '') + (s.ints ? ', ' + s.ints.join(', ') : '')
          + (st ? ', development: ' + statusLabel(st) : '') + (s.notInFdd ? ', not in the FDD' : '')) + '">');
      if (kind === 'decision') {
        out.push('<polygon class="fdd-shape" points="' + b.cx + ',' + (b.y - 7) + ' ' + (b.x + b.w + 7) + ',' + b.cy + ' ' + b.cx + ',' + (b.y + b.h + 7) + ' ' + (b.x - 7) + ',' + b.cy + '"/>');
      } else {
        out.push('<rect class="fdd-shape" x="' + b.x + '" y="' + b.y + '" width="' + b.w + '" height="' + b.h + '" rx="' + (kind === 'end' ? 24 : (kind === 'system' ? 6 : 10)) + '"/>');
      }
      out.push(lines(s.label, b.cx, b.cy, 'fdd-label' + (kind === 'decision' ? ' fdd-label--sm' : ''), kind === 'decision' ? 12.5 : 14));
      if (s.dp) out.push('<text class="fdd-dp" x="' + (b.x + 2) + '" y="' + (b.y + 3) + '">' + esc(s.dp) + '</text>');
      if (s.notInFdd) out.push('<text class="fdd-devnote" x="' + b.cx + '" y="' + (b.y + b.h + 12) + '" text-anchor="middle">not in the FDD</text>');
      if (st) {
        var dx = kind === 'decision' ? b.cx + 20 : b.x + b.w - 3;
        var dy = kind === 'decision' ? b.y + 2 : b.y + 3;
        out.push('<circle class="fdd-dot fdd-st--' + st + '" cx="' + dx + '" cy="' + dy + '" r="6"><title>' + esc('Development: ' + statusLabel(st)) + '</title></circle>');
      }
      out.push('</g>');
    });
    out.push('</svg>');
    return out.join('');
  }

  return {
    STATUS_LABEL: STATUS_LABEL,
    STATUS_ORDER: STATUS_ORDER,
    KIND_LABEL: KIND_LABEL,
    MAP_KINDS: MAP_KINDS,
    APPS: APPS,
    statusOf: statusOf,
    statusLabel: statusLabel,
    requirementRows: requirementRows,
    filterRequirements: filterRequirements,
    groupByModule: groupByModule,
    chips: chips,
    count: count,
    kpis: kpis,
    breakdown: breakdown,
    mappingRows: mappingRows,
    filterMapping: filterMapping,
    statusChips: statusChips,
    pending: pending,
    partly: partly,
    partlyChips: partlyChips,
    reqView: reqView,
    mapView: mapView,
    partlyView: partlyView,
    exportColumns: exportColumns,
    exportRequirements: exportRequirements,
    flowList: flowList,
    flowInfo: flowInfo,
    stepDetail: stepDetail,
    flowRows: flowRows,
    layout: layout,
    svg: svg
  };
});
