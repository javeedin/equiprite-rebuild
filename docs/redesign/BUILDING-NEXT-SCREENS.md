# Building a screen for EquipRite Next

EquipRite Next (`webApps/equiprite-next`) is designed from the FDD. It is not a copy of Old (`webApps/vbredwoodapp`) or
New (`webApps/equiprite`). It runs on the same services (`services/`), the same page codes and the same data, and both
of those apps stay as they are.

**Design it; don't copy it.** Start from the job the person is doing, and decide what they need to see first and what
the next step is. Then build it on the shared parts below. Old and New are where the **business rules** live (which
calls, in which order, with which guards); keep those rules exactly. The screens are yours to design.

Reference implementations to read first:
- `flows/requests/pages/requests-page.*`: a list with search, chips, sort, three views, export, and opening a record
  in a tab.
- `flows/requests/pages/request-page.*`: a record in its own tab.

Tests for them: `tests/e2e/next-requests.e2e.js`, `tests/next-foundation.test.js`.

## The shell, and what a screen gets from it

- **Tabs.** Every menu item opens in a tab, and records open in tabs of their own. Each tab keeps its page alive
  (`oj-vb-switcher`). Do not navigate away from your page; open another tab instead.
- **`resources/js/shellBus.js`.** A screen talks to the shell through this module:
  - `bus.open({ navId: 'fleet' })` opens a screen;
  - `bus.open({ record: 'request', params: { id, number } })` opens a record (record kinds are in `nav.js` `RECORDS`;
    add yours there);
  - `bus.rename(tabId, title)` names your tab once a record loads;
  - `bus.toast(message, 'info' | 'warning' | 'error')` shows a toast;
  - `bus.focus(navId, { id, number })` opens a screen on one request (Requests' "Assign units" and "Pick" do this). A
    screen that takes it registers with `bus.onFocus(navId, fn)` in its page module (fire a `focusRequest` event) and
    reads it once with `bus.takeFocus(navId)` after it has loaded: see Approve & allocate's and Picking's `focusChain`.
- **`resources/js/nav.js`.** The menu. Your item is already there with its `route` and `pageCodes`. When your screen
  works, set `built: true` on it. Change nothing else in that file except adding a record kind.
- **The bell, Ctrl+K, Help and the Old / New / Next switch** belong to the shell. Leave them alone.
- **The page head is a Redwood band.** Every `.nx-pagehead` is drawn as New EquipRite's band (deep teal, white title,
  the five-colour strip) running to the edges of the tab; buttons in it turn white-on-teal. Put your title, kicker,
  summary and page actions in it as before; nothing else is needed.

## Page rules (VBCS)

- Every page JSON and flow JSON has `"navigation": { "embeddable": "enabled" }`. Without it the switcher refuses the
  page.
- Inputs from a tab come in as variables with `"input": "fromCaller"`.
- In HTML bindings call `$functions.x(...)` (page module) and `$application.functions.x(...)`.
  - Avoid arrow functions and global `String()`, `Number()` and `Boolean()` in bindings; put them in a page function.
  - `:style` must use the object form: `:style="[[ { width: x + '%' } ]]"`.
  - No `oj-bind-for-each` inside `<table>`, `<tbody>` or `<select>`. Use the div grid
    (`.nx-grid` / `.nx-row` / `.nx-row--head`).
- Each chain is a class in `<page>-page-chains/` named like the file. Every chain the page JSON names must exist.
- REST: `Actions.callRest(context, { endpoint: 'eqp-v1/<operationId>', uriParams, body })`. The operation ids are in
  `services/eqp-v1/openapi3.json`.
- Replace objects and arrays instead of mutating them. Use `"type": "any"` for free-form objects.
- Never change a view's variable and its rows in two steps that a template can see between them. Compute the new
  rows first, then switch (see `requests-page-chains/applyChain.js`).
- One click, one handler: inside a clickable row, a button lets the row handle it.
- A native `<select>` ignores a bound `:value` (it sets the attribute, not the selection): bind `:selected` on each
  `<option>` instead. A native input stops following its bound value once someone has typed in it: when a chain
  changes it, set the element's value too.
- Read what you need from a page variable before setting it to null; a later read of the old object throws.
- Long work that must not be cut off (a Fusion sync): `bus.guard(tabId, 'what closing would interrupt')` while it
  runs, `bus.guard(tabId, null)` after. The shell asks before closing the tab.
- A record kind may name its own key (`key: (p) => …`) and be `transient` (not kept after a restart); see
  `agreement-request` in `nav.js`.

## Shared parts

| Module (`resources/js`) | Use it for |
|---|---|
| `rules.js` | persona, page access, feature flags, quotes, rate source, user name and initials |
| `requestData.js` | requests and their lines (shared, half-minute cache), `lineOf`, `indexLines` |
| `requestProgress.js` | where a request and each piece of equipment is: stage, words, next step, late |
| `requestHistory.js` | a request from start to end: milestones (when, by whom, how many pieces), everything recorded |
| `helpGuide.js` | the flow's steps (who, which screen, which statuses), pieces at each step now, the diagram |
| `exportKit.js` | `run(format, { name, title, subtitle, rows, columns })`: Excel, CSV, PDF, Copy |
| `fmt.js` | dates, ranges, relative days, money, counts |

**Every list exports.** Put an Export menu (see `requests-page.html`) in the page head. It exports exactly what is
shown, with the columns a person would want in Excel, and toasts the result.

**Status.** Show where things are with `requestProgress` and the journey colours (`.nx-pill.nx-stage--<stage>`,
`.nx-jbar`, `.nx-track`), never a raw stored status. Keep the stored status one hover away (`title`).

**Styles.** Use `resources/css/next.css` classes:
- page and head: `nx-page`, `nx-pagehead`
- controls: `nx-toolbar`, `nx-search`, `nx-chips`/`nx-chip`, `nx-seg`, `nx-btn--primary`
- containers: `nx-card`, `nx-kpis`/`nx-kpi`
- tables: `nx-grid`, `nx-row`
- states: `nx-empty`, `nx-error`, `nx-late`

Put the styles your screen needs in `resources/css/next-<area>.css` and add it to `imports.css` in `app-flow.json`.
Don't restyle shared classes.

**Look and words.**
- Light surfaces, one accent for actions, colour only where it means something.
- Plain words: "Approved, no unit assigned yet", not `IN_PROCESS`.
- Say what is next and who does it. Say what is late and by how much.
- Every action says what it will do before it does it.
- A failure stays on the page in words.

## Writes

- **EquipRite's own data** (requests, lines, allocations, inspections, timesheets, settings): keep the same calls,
  order and guards as the equivalent New/Old chain, and read the result back.
- **Fusion** (contracts, transfer orders, ICS syncs, cost postings, anything that writes to Fusion): not part of Next
  yet. Reading from Fusion is fine.
  - Show the step and what it would do.
  - Offer to do it in New EquipRite (a link to the same screen there; see `nav.newUrl`, or the request tab's
    "Act on it in New").
  - Never update EquipRite's status as if the Fusion step had happened.
- Never write on page entry.

## Tests (required)

- A unit test, `tests/next-<area>.test.js`: load your pure modules the way `tests/next-foundation.test.js` does, and
  test the logic (filters, rules, request bodies).
- A browser test, `tests/e2e/next-<area>.e2e.js`:
  - `E.start({ port, handle, app: 'next' })`, then `env.open('/?open=<navId>')`;
  - check what a person sees and what is sent (`env.writes`);
  - check no sideways scroll and no browser errors;
  - take a screenshot.
- Build in your own checkout (`npm run build`). `npm test` must pass; `import-chains.test.js` already fails on the
  base, so leave it.
