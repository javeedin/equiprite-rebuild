# Building a screen for EquipRite Future

EquipRite Future (`webApps/equiprite-future`) is the multi-company, multi-country version from **FDD v2.0**
(`docs/fdd-v2`): requests by the requesting business unit, approvals by the sourcing business unit, intercompany hire
billed by an invoice pair, and full clarity on whether every financial transaction of a request is done. It is a
**prototype**: it runs entirely on a simulated group and Fusion kept in the browser, and calls **no REST service**.
EquipRite creates the transactions; each company's Fusion makes the accounting, which Future shows and never posts.

Old, New, Next and Mobile are not changed by it (apart from the Future entry in their version switches).

Read first:

- **The backend** (done and tested; do not change its rules): `resources/js/future/`
  - `fxSeed.js`: the demo group, `PERSONAS` (who can be played), `ACCOUNTS`.
  - `fxEngine.js`: `apply(state, type, payload)` and every action (`createRequest`, `approveLine`, `shipLine`, …),
    each with the roles that may run it (`who`).
  - `fxViews.js`: one view model per screen, already filtered to the persona played.
  - `fxStore.js`: the browser store: `get()`, `act(type, payload)` → `{ ok, error, result }`, `view(name, …args)`,
    `subscribe(fn)`, `reset()`, `fmt`. Kept in localStorage, synced across browser tabs.
  - `tests/future-engine.test.js` plays every scenario through it: the best place to see what each action takes.
- **The two reference screens**, built on the pattern below:
  - `flows/work/pages/work-page.*` (My work): a view model, queues that open screens, a request list that opens records,
    notifications, and "Play as … and open …" through `actChain`.
  - `flows/guide/pages/guide-page.*` (Guide): steps, players, scenarios, the FDD v2.0 rules.
- `docs/redesign/BUILDING-NEXT-SCREENS.md`: Future keeps Next's shell, look and VB rules (below).

## Routes: your screen's page is already there

Every menu item has a page of its own, `flows/<flow>/pages/<page>-page.*`, with **page = the item's id**. Each one not
built yet is a **skeleton** already on the pattern (its view model, `fxRefresh`, `actChain`, `openChain`) that shows
what its view holds. Build your screen by replacing your page's HTML, module and chains; the flow JSON already lists
every page of the flow, so screens built side by side never touch the same flow file.

| Menu (group) | navId | Route (flow/page) | Files | View (`store.view`) | Roles that see it |
|---|---|---|---|---|---|
| Home | `work` | `work/work` | `flows/work/pages/work-page.*` (built) | `work` | everyone |
| Requests | `requests` | `requests/requests` | `flows/requests/pages/requests-page.*` | `requests` (filter) | requester, desk, site, receiver-review, finance, ic-finance |
| Requests | `new-request` | `order/new-request` | `flows/order/pages/new-request-page.*` | `me` (+ `fxEngine.sourcing`) | requester, desk |
| Fleet owner | `approvals` | `owner/approvals` | `flows/owner/pages/approvals-page.*` | `approvals` | owner-em |
| Fleet owner | `yard` | `owner/yard` | `flows/owner/pages/yard-page.*` | `yard` | yard, owner-em |
| On site | `site` | `site/site` | `flows/site/pages/site-page.*` | `site`, `hours` | site, requester, desk, receiver-review |
| Money | `charges` | `money/charges` | `flows/money/pages/charges-page.*` | `charges` (filter) | receiver-review, finance, owner-finance, ic-finance |
| Money | `ic-workbench` | `money/ic-workbench` | `flows/money/pages/ic-workbench-page.*` | `workbench` | ic-finance, finance |
| Money | `billing` | `money/billing` | `flows/money/pages/billing-page.*` | `billing` | desk, owner-finance, ic-finance, finance, receiver-review |
| Finance | `accounting` | `finance/accounting` | `flows/finance/pages/accounting-page.*` | `ledger` (company), `consolidation` | finance, owner-finance, ic-finance |
| Finance | `reports` | `finance/reports` | `flows/finance/pages/reports-page.*` | `reports` | everyone but the site supervisor |
| Setup | `setup` | `setup/setup` | `flows/setup/pages/setup-page.*` | `setup` | everyone (changes: ic-finance) |
| Help | `guide` | `guide/guide` | `flows/guide/pages/guide-page.*` (built) | `guide` | everyone |
| (record) | `request` | `requests/request` | `flows/requests/pages/request-page.*` | `request` (id) | anyone; the view says `hidden` when not theirs |

A request opens in a tab of its own: `bus.open({ record: 'request', params: { id: 'R1001', number: 'FR-1001' } })`
(in HTML: `data-record="request" data-id data-number` on an element whose click goes to `openChain`). Its page reads
`id` and `number` (`"input": "fromCaller"`).

Admin sees every item. The roles are in `resources/js/nav.js`; `fxViews.work()` items carry the same navIds, and
`tests/future-foundation.test.js` checks that no persona is ever sent to a screen they cannot open. When your screen
works, set `built: true` on its item in `nav.js` (the menu's "being built" dot goes), and change nothing else there.
Your styles go in `resources/css/future-<flow>.css` (already imported); the shared ones are `next.css` and
`future.css`.

## The page pattern

Every Future screen is built the same way.

1. **A page variable `v`** (`"type": "any"`) holds the screen's view model. `loadChain` sets it from the store:

   ```js
   // <page>-page-chains/loadChain.js
   define(['vb/action/actionChain', 'resources/js/future/fxPage'], (ActionChain, fx) => {
     class loadChain extends ActionChain {
       async run(context) {
         context.$page.variables.v = fx.view('approvals');      // store.view(...) + ready: true, never throws
       }
     }
     return loadChain;
   });
   ```

   Give `v` a `defaultValue` with the arrays your template iterates, and wrap the content in
   `<oj-bind-if test="[[ $variables.v.ready ]]">`. Derive what the template needs in `loadChain` (as My work adds
   `story`), and **replace** `v` each time; never mutate it.

2. **The page hears the store.** The page module extends `fx.Base`, which subscribes to the store in its constructor
   and fires the page event **`fxRefresh`** on every change (an action here, the persona switched, the demo clock, a
   reset, another browser tab). The page declares the event and listens with `loadChain`:

   ```js
   define(['resources/js/future/fxPage'], (fx) => {
     class PageModule extends fx.Base {
       constructor(context) { super(context); }
       // your binding helpers (no `this`)
     }
     return PageModule;
   });
   ```

   ```json
   "events": { "fxRefresh": { "payloadType": "object" } },
   "eventListeners": {
     "vbEnter":   { "chains": [{ "chain": "loadChain" }] },
     "fxRefresh": { "chains": [{ "chain": "loadChain" }] },
     "onAct":     { "chains": [{ "chain": "actChain", "parameters": { "data": "{{ $event.currentTarget.dataset }}" } }] },
     "onOpen":    { "chains": [{ "chain": "openChain", "parameters": { "data": "{{ $event.currentTarget.dataset }}" } }] }
   }
   ```

   It unsubscribes on dispose: VB disposes the page's event helper when its tab closes, and `fx.watch` stops at the
   next change (`dispose()` stops it sooner).

3. **Actions go through one `actChain`**, which calls `fx.act(...)`:
   - from a click: `data-act="<action>"` and `data-…` attributes on the element, `on-click="[[ $listeners.onAct ]]"`:

     ```html
     <button type="button" class="nx-btn nx-btn--sm" data-act="approveLine" :data-request-id="[[ l.data.requestId ]]"
       :data-line-id="[[ l.data.id ]]" :data-unit-id="[[ o.data.unitId ]]" on-click="[[ $listeners.onAct ]]">Approve</button>
     ```

     `data-request-id` arrives as `requestId`; `'7'` as 7, `'true'` as true. Reserved keys: `data-open="<navId>"`
     (open a screen once it worked), `data-quiet` (no toast), `data-confirm="<question>"` (ask first).
   - from a form: a page function builds the payload, and a listener passes it:
     `"parameters": { "type": "createRequest", "payload": "{{ $functions.payload($variables.form) }}" }`.

   `fx.act` calls `store.act`; on failure it toasts the engine's error in plain words (`bus.toast(error, 'error')`)
   and changes nothing; on success it toasts what happened (the engine's own log lines: "Raised FR-1001 for ProjectCo
   Projects · PC-INT-014."), opens the request when the result has an `id`, then `data-open`'s screen. The screen
   refreshes through `fxRefresh`; never set `v` by hand after an action.

4. **Links go through `openChain`** (`fx.open(data)`): `data-nav="<navId>"`, or `data-record="request"` with `data-id`
   (and `data-number`; looked up when missing). A notification's `link` (`{ navId }` or `{ record, id }`) becomes these
   attributes with `fx.linkData(link)`.

5. **Shared code is `resources/js/future/fxPage.js`**: `view`, `watch`, `act`, `request` (payload parsing), `open`,
   `linkData`, and the binding helpers every page gets from `fx.Base`: `money(n, cur)`, `num`, `date`, `short`,
   `period` (all `store.fmt`, the way the views write them), `plural`, `arr`, `label(navId)`, `icon(navId)`,
   `canOpen(navId, roles)`, `stageTone(stage)` (Next's journey colours, `nx-stage--<tone>`), `stateTone(state)` (a
   finance checklist state as `fx-chip--<tone>`), `noteIcon(kind)`, `outline(v)`.

Who is played: `fx.view('me')` (name, title, roles, business units, the demo's today). The views are already filtered
to the persona (requests by the requesting BU, approvals by the sourcing BU, finance by company); never filter again
by hand, and never show a button the engine would refuse: check the role (`me.roles`, or the view's `can…` flags).

## The shell, and what a screen gets from it

As in Next: tabs (every screen and record in a tab of its own, kept alive), the coloured menu (collapsible), your
menu (the version list Old, New, Next, Mobile, **Future**, the colours, **Reset the demo**), Help → the Guide, and
New request. Future adds:

- **Playing as** (toolbar): the persona; choosing one runs `setPersona`. The menu, its badges (counts of
  `fxViews.work().items` per navId), the bell and every open screen follow; tabs the new persona may not open close.
  A screen can switch the persona too (`data-act="setPersona" data-id="p-em" data-open="approvals"`).
- **The demo clock** (toolbar): the group's today, `+1 day`, `+1 week`, `Month end` (`advance`, `toMonthEnd`). Days
  pass for everyone: statements are accepted by silence, the cut-off accrues, alerts fire; the toast says what
  happened.
- **The bell**: `fxViews.notifications()`, unread per persona, Mark all read (`markRead`), each opening its link.
- **The banner**: "Prototype: simulated companies and Fusion. EquipRite creates the transactions; the accounting is
  shown, never posted."

`resources/js/shellBus.js` is Next's: `bus.open`, `bus.rename(tabId, title)`, `bus.toast(message, tone)`.

## Look and words

Next's look (`next.css`): the page head band (`nx-pagehead`, with kicker, title, sub and actions), cards
(`nx-card`, `nx-card-head`), KPIs (`nx-kpis`), chips (`nx-chips`, `nx-chip`), the div grid (`nx-grid`, `nx-row`),
pills in the journey colours (`nx-pill nx-stage--<tone>`), buttons (`nx-btn`, `nx-btn--primary`, `nx-btn--sm`).
Future's shared parts (`future.css`):

- `fx-chip fx-chip--<tone>`: states `ok`, `todo`, `bad`, `run`, `na`, `next`; relationships `neutral` (own fleet),
  `info` (same company), `ic` (intercompany), `xb` (cross-border), `cust` (customer); the `REL` tones of `fxViews`.
- `fx-who`: someone's avatar, name and title. `fx-progress`: n of m done.

Words: say which company and business unit, what is next and who does it, and what each step creates (a transfer
order, an AR invoice in FleetCo, an AP invoice in ProjectCo coded to the project, a cost in PPM). Accounting is
always "shown": never offer to post it.

## VB rules (from BUILDING-NEXT-SCREENS.md, all apply)

- Every page JSON and flow JSON has `"navigation": { "embeddable": "enabled" }`.
- No arrow functions and no global `String()`, `Number()`, `Boolean()` in bindings: put them in a page function.
- No `oj-bind-for-each` in `<table>`, `<tbody>` or `<select>`: use the div grid.
- `:style` takes the object form: `:style="[[ { width: x + '%' } ]]"`.
- Replace objects and arrays rather than mutate them; `"type": "any"` for free-form ones.
- Listeners go under `eventListeners`; every chain a page names exists in `<page>-page-chains/`, named like its file.
- One click, one handler: inside a clickable row, a button lets the row handle it.
- A native `<select>` ignores a bound `:value`: bind `:selected` on each `<option>`.
- Never write on page entry. Future has no REST: no `callRest`, no service, no `fetch` (the test checks).

## Tests (required)

- A unit test, `tests/future-<area>.test.js`: load the modules the way `tests/future-foundation.test.js` does, play the
  steps through `fxEngine.apply`, check what your page functions and payloads produce.
- A browser test, `tests/e2e/future-<area>.e2e.js`: `E.start({ port, app: 'future' })`, `env.open('/?open=<navId>')`.
  Switch persona as a person does (`#fxPersona`, then `#fxPersonaPanel .fx-person[data-id="…"]`); stage data through
  the screens (or, before they exist, `window.require(['resources/js/future/fxStore'], …)` as
  `tests/e2e/future-shell.e2e.js` does). Check what a person sees, no sideways scroll, `env.errors` empty, and
  `env.calls` empty (no backend call). Take a screenshot.
- `npm run build` first. `npm test`, `node tests/future-foundation.test.js` and `node tests/e2e/future-shell.e2e.js`
  must keep passing (`import-chains.test.js` already fails on the base: leave it).
