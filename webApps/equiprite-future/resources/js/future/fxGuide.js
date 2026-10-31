define(['resources/js/future/fxSeed', 'resources/js/nav'], function (Seed, nav) {
  'use strict';

  /**
   * The Guide's words around fxViews.guide(): the FDD v2.0 rules in one card, how each scenario is played, and each
   * step with who plays it and the one click that plays it ("Play as Ana and open Approve & allocate"). Pure.
   */

  // FDD v2.0, section 2: the seven rules everything else follows (docs/fdd-v2/tools/build-fdd-v2.js RULES).
  var RULES = [
    { id: 'GR-1', title: 'Ownership never moves', text: 'FleetCo keeps the unit on its books for its whole life. A hire moves custody, location and money, never ownership.' },
    { id: 'GR-2', title: 'Every request has a requesting business unit', text: 'Everything else is derived from it and from the unit chosen: the companies, the countries and the relationship between them.' },
    { id: 'GR-3', title: 'The cost lands where the work is', text: 'On the requesting company\'s project, in its ledger and currency, through its own Payables.' },
    { id: 'GR-4', title: 'Group prices come from intercompany agreements', text: 'Approved, versioned and kept apart from customer rates.' },
    { id: 'GR-5', title: 'One charge, one id, everywhere', text: 'The same charge id is on the owner\'s AR line, the user\'s AP line and the project cost.' },
    { id: 'GR-6', title: 'Stock moves stay inside the owner', text: 'Transfer orders only between the owner\'s own orgs (its yard → its deployment org at the site).' },
    { id: 'GR-7', title: 'Country rules are data', text: 'Currency, tax, withholding, customs, calendars and certificates are set per country, never coded.' }
  ];

  // Who is who, and the user's own words for the split of responsibility (FDD v2.0 sections 2 and 6).
  var MODEL = [
    { label: 'Company 1 · ProjectCo', text: 'Does the projects. Its BU raises the request (the requesting BU), and the cost lands on its project.' },
    { label: 'Company 2 · FleetCo', text: 'Holds the fleet. Its BU approves and allocates (the sourcing BU), ships, and bills ProjectCo every month.' },
    { label: 'Between them', text: 'A monthly statement, agreed by both, turned into an invoice pair (FleetCo\'s AR, ProjectCo\'s AP coded to the project), settled by netting.' },
    { label: 'EquipRite and Fusion', text: 'EquipRite creates the transactions; each company\'s Fusion makes the accounting, which EquipRite shows and never posts.' }
  ];

  // How each scenario is started: who raises it, on which screen, and its relationship's tone (fxViews REL).
  var SCENARIO = {
    S1: { persona: 'p-pm', navId: 'new-request', tone: 'ic', rel: 'Intercompany · domestic' },
    S2: { persona: 'p-pm', navId: 'new-request', tone: 'ic', rel: 'Intercompany · domestic, then customer billing' },
    S3: { persona: 'p-desk', navId: 'new-request', tone: 'cust', rel: 'Customer rental' },
    XB: { persona: 'p-pk', navId: 'new-request', tone: 'xb', rel: 'Intercompany · cross-border' },
    LE: { persona: 'p-pm', navId: 'new-request', tone: 'info', rel: 'Same company · cross-charge' }
  };

  function persona(id) {
    for (var i = 0; i < Seed.PERSONAS.length; i++) if (Seed.PERSONAS[i].id === id) return Seed.PERSONAS[i];
    return null;
  }
  function first(name) { return String(name || '').split(' ')[0]; }

  /** The button that plays a step: open the screen when it is the persona played, else play as them and open it. */
  function play(personaId, navId, meId) {
    var p = persona(personaId) || {};
    var it = nav.item(navId);
    var screen = it ? it.label : navId;
    var mine = personaId === meId;
    return { persona: personaId, personaName: p.name || '', first: first(p.name), initials: p.initials || '', title: p.title || '', navId: navId,
      screen: screen, mine: mine, action: mine ? 'Open ' + screen : 'Play as ' + first(p.name) + ' and open ' + screen };
  }

  /** fxViews.guide() with, for each step and scenario, who plays it and the button that does (meId: the persona played). */
  function story(guide, meId) {
    var g = guide || { steps: [], scenarios: [], done: 0, total: 0 };
    var steps = (g.steps || []).map(function (s) {
      return Object.assign({}, s, play(s.persona, s.navId, meId), { state: s.done ? 'done' : (s.next ? 'next' : 'todo'), stateText: s.done ? 'Done' : (s.next ? 'Next' : 'To do') });
    });
    var scenarios = (g.scenarios || []).map(function (sc) {
      var m = SCENARIO[sc.id] || { persona: 'p-pm', navId: 'new-request', tone: '', rel: '' };
      return Object.assign({}, sc, play(m.persona, m.navId, meId), { tone: m.tone, rel: m.rel });
    });
    var next = steps.filter(function (s) { return s.next; })[0] || null;
    return { steps: steps, scenarios: scenarios, next: next, done: g.done || 0, total: g.total || steps.length, complete: !!steps.length && steps.every(function (s) { return s.done; }),
      pct: steps.length ? Math.round((g.done || 0) / steps.length * 100) : 0, rules: RULES, model: MODEL };
  }

  return { RULES: RULES, MODEL: MODEL, SCENARIO: SCENARIO, story: story, play: play };
});
