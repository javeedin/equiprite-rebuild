# Building a New EquipRite screen

How the screens in `webApps/equiprite/` are made, so each one looks and behaves like the rest. Built examples to
copy from: `flows/request/pages/` (My requests, Request detail, New request) and `flows/home/pages/home-page.*`.

## Rules

1. **Old EquipRite stays unchanged.** Nothing under `webApps/vbredwoodapp/` is edited
   (`tests/old-app-unchanged.test.js` fails otherwise). Read it, copy from it.
2. **Same data, same calls.** A screen reads and writes through the endpoints the old screen uses
   (`services/eqp-v1`, `bipService`, `ProjectLOV`, `commonService`), with the same request bodies, in the same
   order. When the old page's logic lives in `resources/js/*.js`, copy that file unchanged into
   `webApps/equiprite/resources/js/` and use it; when it lives in a chain, carry the chain's logic over and say in
   a comment which old chain it comes from. Only build UI on an endpoint that exists in `services/`.
3. **One page per job, from the wireframe.** The approved wireframes are `docs/redesign/wireframes/html/*.html`
   (index in `docs/redesign/wireframes/html/index.html`); the FDD summary is
   `docs/redesign/fdd-summary/EquipRite-FDD-Summary.html` (scenarios S01–S35, pages, access, flags). Where the
   wireframe and the old page disagree on data, the old page wins (it is what the backend supports); where they
   disagree on layout, the wireframe wins.
4. **Keep the Old link.** Every screen's band has an "Old version" button:
   `$application.functions.oldAppLink($application.variables.oldAppUrl, '<navId>')`. In the desktop app it opens
   Old EquipRite in its own window, on the same screen.

## Files

- A flow per area: `flows/<flow>/<flow>-flow.json` (+ `<flow>-flow.js`, an empty module class), pages
  `flows/<flow>/pages/<page>-page.json|html|js`, chains `flows/<flow>/pages/<page>-page-chains/<chain>.js`
  (VB JS action chains: `class x extends ActionChain { async run(context, params) {} }`). Every chain a page JSON
  names must exist in its own chains folder (a page cannot call another page's chain).
- **Page ids are unique across all flows** (the menu and the access guard look pages up by id).
- Every page's `vbBeforeEnter` runs `enforcePageAccessChain`: copy `flows/request/pages/my-requests-page-chains/
  enforcePageAccessChain.js` byte for byte. Menu jumps from a page use a copy of `openNavChain.js`.
- Styles: the shared pieces are in `resources/css/equiprite.css` (do not restyle them). Each area adds its own
  classes to its own file: `fulfil.css`, `usage.css`, `master.css`, `insights.css`, `customers.css`, all loaded by
  `app-flow.json`. Prefix new classes `er-`.
- The menu is `NAV_GROUPS` in `app-flow.js`. When a screen is built: `status: 'new'`, `route: { flow, page }`,
  `pages: [...]` for its other pages (detail pages), keep `old`. Nothing else in `app-flow.js` changes for a
  screen.

## Page layout

```
.er-band > .er-band-inner   kicker ("Fulfil · FDD 7.11"), h1, .er-band-sub, .er-actions (Old version, main action)
.er-strip                   the five-colour strip (5 empty spans)
.er-page                    the content column: .er-card, .er-card-pad, .er-filters, .er-chip-row, .er-error …
```

Shared classes worth knowing: `er-btn` + `--primary` (white, on the band) `--ghost` (outline, on the band)
`--dark` (main action on the page) `--plain` (secondary) `--danger`; `er-chip`/`er-chip--on`/`er-chip-count`;
`er-search`; `er-kpis`/`er-kpi`; `er-status er-status--<STATUS>` (status pills; or
`$application.functions.statusPillClass(status)` and `formatLineStatus(status)`); `er-facts` (dl of facts);
`er-tracker`; `er-grid`/`er-grid-row`/`er-grid-head` (div tables); `er-field`/`er-label`/`er-input`/`er-req`;
`er-seg`/`er-seg-btn` (segmented choice); `er-picked`, `er-results`/`er-result` (search and pick);
`er-later` (an explanatory card); `er-note`, `er-muted`, `er-num` (tabular numbers), `er-sr` (screen readers).

## Gotchas (each cost an hour once)

- Never put `oj-bind-for-each` inside `<table>`, `<tbody>`, `<tr>` or `<select>`: the browser moves or drops it.
  Use a div grid (`role="table"`), or `oj-table` with an ArrayDataProvider. Lists of choices are buttons
  (`er-chip`, `er-result`), not `<select>`.
- `oj-table` sizes columns from `width` / `minWidth` in the column definitions; `style` only styles the cells.
- Bindings: `[[ ]]` one-way, `:attr=`, `on-click="[[ $listeners.x ]]"`. Read values in the listener's parameters
  from `$event.target.value` / `$event.currentTarget.dataset.x` (put `data-*` on the element). No global
  `String()` / `Number()` calls inside bindings; use `'' + x`.
- In chains, page module functions are `$page.functions.x`; in HTML they are `$functions.x`. App ones are
  `$application.functions.x` in both. Page variables are not available in `vbBeforeEnter`.
- A variable holding a free-form object is `"type": "any"` (VB coerces typed objects). Replace objects and arrays
  rather than mutating them (`$page.variables.form = Object.assign({}, form, patch)`), so bindings update.
- `Actions.callRest(context, { endpoint: 'eqp-v1/<operationId>', uriParams, body, headers })`; path and query
  parameters both go in `uriParams`. `Actions.callChain(context, { chain, params })`.
  `Actions.navigateToPage(context, { page, params })` in the same flow, `Actions.navigateToFlow(context,
  { flow, page, params, target: 'parent' })` to another flow.
- Links into Old EquipRite need `vp/shell/<flow>/<page>` (the app-level `oldAppLink` does this).
- Writes send `headers: cu.auditHeaders(context)` (`resources/js/currentUser.js`) where the old chain does.

## Tests

- **Unit** (`npm test`): `tests/<area>.test.js` with `tests/_harness.js` (`makeAsserter`). Load the real page
  modules and chains with a small AMD loader (see `tests/new-request.test.js`), give chains a fake `Actions`, and
  check what they send: endpoint, body, order, and what happens on a failure. Test the pure page functions
  (filters, totals, labels).
- **Browser** (`node tests/e2e/<area>.e2e.js`, after `npm run build`): `tests/e2e/harness.js` starts both apps
  against a fake backend and Chromium; see `tests/e2e/new-request.e2e.js`. Check the screen renders, the main
  actions send the right calls, and there are no console errors. Give each script its own port.
- `tests/new-app.test.js` already checks that every `status: 'new'` menu item's page exists and that every chain a
  page names exists.

## Design

Redwood, as in the wireframes: the teal band, white cards, the dark menu. Be bold inside that frame: put the next
action where the eye lands, show the consequence before the click (counts, totals, what will happen), prefer one
page with clear steps over several pages, and say plainly when something is still in Old EquipRite.
