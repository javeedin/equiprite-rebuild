define([], function () {
  'use strict';

  // An application page's technical sheet (desktop/lib/pageScan.js facts), in words: the prompt the shared Ask AI is given
  // to explain the page's business logic, and the compact text "Analyze with AI" carries for the pages a story is mapped
  // to. Pure — no page, no DOM, no network.
  //
  //   factsText(facts, o)      the facts as plain text (o.short: the essentials only, for a story's analysis)
  //   prompt(facts)            { system, user } — "explain this page": what it is for, how it is used, its business
  //                            logic, its integrations, what to watch
  //   storyPagesText(sheets)   the pages mapped to a story, each with its AI explanation (cut) and its essentials
  //   methodClass(m)           'get' | 'post' | 'patch' | 'put' | 'delete' (a badge's colour)

  function txt(v) { return v == null ? '' : String(v); }
  function list(a) { return (a || []).filter(Boolean); }

  function factsText(f, o) {
    var short = !!(o && o.short);
    if (!f) return '';
    var L = [];
    L.push('PAGE ' + txt(f.label) + ' (' + txt(f.appName) + ', ' + (f.flow ? f.flow + '/' : '') + txt(f.page) + ')' + (f.route && f.route.menu ? ' — menu: ' + f.route.menu : ''));
    if (txt(f.description).trim()) L.push('Description: ' + txt(f.description).trim());
    var ft = f.features || {};
    if (list(ft.sections).length) L.push('Sections: ' + ft.sections.join(' | '));
    if (list(ft.columns).length) L.push('Table columns: ' + ft.columns.join(', '));
    if (list(ft.fields).length) L.push('Fields: ' + ft.fields.slice(0, short ? 15 : 60).join(', '));
    if (list(ft.actions).length) L.push('Actions: ' + ft.actions.slice(0, short ? 12 : 60).map(function (a) { return a.label + (a.chains && a.chains.length ? ' → ' + a.chains.join(' + ') : ''); }).join('; '));
    if (list(ft.lifecycle).length) L.push('Runs ' + ft.lifecycle.map(function (l) { return l.when + ': ' + l.chains.join(' + '); }).join('; '));
    if (list(ft.inputs).length) L.push('Opened with: ' + ft.inputs.map(function (i) { return i.name; }).join(', '));
    var lg = f.logic || {};
    if (list(lg.chains).length) {
      L.push(''); L.push('Action chains (' + lg.chains.length + '):');
      lg.chains.slice(0, short ? 12 : 60).forEach(function (c) {
        L.push('- ' + c.name + (c.on && c.on.length ? ' [on ' + c.on.join(', ') + ']' : '') + ': ' + (short ? txt(c.about).slice(0, 220) : txt(c.about))
          + (c.calls && c.calls.length ? ' | calls ' + c.calls.join(', ') : '') + (c.reports && c.reports.length ? ' | reports ' + c.reports.join(', ') : '')
          + (c.opens && c.opens.length ? ' | opens ' + c.opens.join(', ') : ''));
      });
    }
    if (!short && list(lg.modules).length) {
      L.push(''); L.push('Rules modules (' + lg.modules.length + '):');
      lg.modules.forEach(function (m) { L.push('- ' + m.name + ': ' + txt(m.about).slice(0, 400)); });
    }
    var ig = f.integrations || {};
    if (list(ig.rest).length) {
      L.push(''); L.push('REST calls (' + ig.rest.length + '):');
      ig.rest.slice(0, short ? 15 : 80).forEach(function (r) { L.push('- ' + r.method + ' ' + r.path + ' — ' + r.backendLabel + ' (' + r.endpoint + ')' + (r.summary ? ': ' + r.summary : '') + (r.usedBy && r.usedBy.length ? ' — used by ' + r.usedBy.join(', ') : '')); });
    }
    if (list(ig.reports).length) L.push('BI Publisher reports: ' + ig.reports.join(', '));
    if (list(ig.local).length) L.push('Desktop app services: ' + ig.local.map(function (l) { return l.what; }).join(', '));
    if (list(f.links).length) L.push('Opens: ' + f.links.join(', '));
    return L.join('\n');
  }

  var SYSTEM = [
    'You are a senior Oracle Visual Builder (VBCS / Oracle JET Redwood) developer and business analyst on EquipRite, an equipment-rental and project application (Oracle Fusion, OIC and BI Publisher behind it).',
    'You are given the technical facts of ONE application page, read from its code: its sections, fields, actions and the action chains they run (with each chain\'s own description), its rules modules, its REST calls (with the backend each goes to), BI Publisher reports and links.',
    'Explain the page for a developer and a functional consultant, using EXACTLY these Markdown headings in this order:',
    '## What this page is for', '## How people use it', '## Business logic', '## Integrations', '## Things to watch',
    'Under each heading use short "- " bullets. Under "Business logic" describe the rules and the flow (what happens when it opens, on each main action, validations, statuses), naming the chains in `code`.',
    'Under "Integrations" list each backend and what the page reads or writes there (method + path), and the BI Publisher reports.',
    'Under "Things to watch" note risks, gaps, hard-coded values or duplication you can see in the facts.',
    'Base everything ONLY on the facts given; when something cannot be told from them, say so rather than guess.'
  ].join('\n');

  function prompt(facts) {
    return { system: SYSTEM, user: factsText(facts, { short: false }) };
  }

  /** The pages a story is mapped to, for its analysis: each one's AI explanation (cut) and its essentials. */
  function storyPagesText(sheets, total) {
    var ss = list(sheets);
    if (!ss.length) return '';
    var cap = Math.max(2500, Math.floor((total || 24000) / ss.length));
    return ss.map(function (sh) {
      var t = factsText(sh.facts, { short: true });
      if (sh.ai && sh.ai.text) t += '\n\nWhat the page does (AI explanation saved with its sheet):\n' + txt(sh.ai.text).slice(0, 2500);
      return t.length > cap ? t.slice(0, cap).replace(/\s+\S*$/, '') + '\n… (cut to fit)' : t;
    }).join('\n\n');
  }

  function methodClass(m) { var k = txt(m).toLowerCase(); return /^(get|post|patch|put|delete)$/.test(k) ? k : 'other'; }

  return { factsText: factsText, prompt: prompt, storyPagesText: storyPagesText, methodClass: methodClass, SYSTEM: SYSTEM };
});
