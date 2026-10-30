# Building a tab for EquipRite Mobile

EquipRite Mobile (`webApps/equiprite-mobile`) is the phone app. It is a VB **web** app, installable on the home
screen as a PWA; VB's own mobile apps are retired. It runs on the same services (`services/`), the same page codes
and the same data as Old, New and Next. None of those apps is changed by it.

**One app, a tab per job.** Each person gets the tabs their page access allows (`resources/js/mobileTabs.js`):

| Tab | For | Page code | Needs |
|---|---|---|---|
| Approve | decide requests: approve or send back; assign units | `EQR_WORKBENCH` | FULL |
| Pick | the yard: what to pick and ship today, scan, release, ship | `EQR_INITIATE_PICKING` | FULL or READ_ONLY (read-only looks) |
| Request | raise a request | `EQR_PROJ_CREATE_REQUEST` | FULL |
| My requests | where each of your requests is, its history | `EQR_EQUIPMENT_REQUESTS` | FULL or READ_ONLY |
| Me | you, installing the app, the other versions | everyone | |

**Design for a phone; keep the rules.** Start from what the person is doing standing in a yard or on a site, one
hand on the phone. What do they need to see first? What is the one next step? EquipRite Next's screens are where the
**business rules** live in the new code (which calls, in which order, with which guards). Reuse its pure modules and
port its chains' calls exactly. The screens are yours to design.

Reference to read first: `flows/track/` (My requests): a list with chips and search, a record with its next step, its
equipment, its history, the step buttons, the offline copy. Its tests: `tests/mobile-app.test.js` and
`tests/e2e/mobile-foundation.e2e.js`.

## The shell, and what a tab gets from it

- **Tabs.** The shell (`pages/shell-page.*`) holds an `oj-vb-switcher` with one item per tab the role gets. Each tab's
  page stays alive, and each keeps its scroll position. A tab is one flow (`flows/<tab>/`) with one page
  (`pages/<tab>-page.*`). Inside it, show a list and a record in turn with a `view` variable (see track). Do not
  navigate away from your page.
- **`resources/js/mobileBus.js`.** A tab talks to the shell through this module:
  - `bus.go('track')` shows another tab;
  - `bus.focus('approve', { id, number })` shows a tab on one request. The tab that takes it registers
    `bus.onFocus('<tab>', fn)` in its page module (firing a `focusRequest` event) and reads it once with
    `bus.takeFocus('<tab>')` after it has loaded. See track's `focusChain` and `loadChain`. My requests sends approve,
    pick and continue (to the Request tab, with a draft or sent-back request) this way, and so does a deep link
    (`?tab=approve&id=…&number=…`);
  - `bus.toast(message, 'info' | 'warning' | 'error')` shows a toast over the tab bar;
  - `bus.badge('<tab>', n)` sets the count on your tab's icon. The shell counts each tab from the shared request list
    when the app opens and every five minutes (`countsChain`): Approve, the requests waiting for a decision; Pick, the
    pieces with a unit ready for the yard; Request, your drafts. Set your own count after a step changes it, or when
    your tab counts it more exactly.
- **The top bar, the tab bar, the offline strip and the toast** belong to the shell. Leave them alone.
- **The page head is the Redwood band.** Start your page with `.mb-head` (title, `.mb-head-sub`, a `.mb-back` button
  in `.mb-head-row` on a record). Then put the content in `.mb-body`.

## Phone rules

- One column. Touch targets at least 44 px (`.mb-btn`, `.mb-item` and `.mb-chip` already are). Inputs at 16 px, or an
  iPhone zooms in on focus (`.mb-input`, `.mb-search input`).
- The width is 320 to 430 px. Never let the page scroll sideways (the e2e tests check it). Long text wraps
  (`overflow-wrap: anywhere`); long names ellipsis.
- Lists are cards (`.mb-list` > `li` > `button.mb-item`). A tap opens the record. Secondary facts go in `.mb-facts`.
- One primary action per screen. When a screen has a main step (Approve, Ship, Submit), put it in a `.mb-dock` held
  above the tab bar.
- Decisions and pickers slide up as a bottom sheet (`.mb-sheet-wrap` > `.mb-sheet-scrim` + `.mb-sheet` with
  `.mb-sheet-grip`, `.mb-sheet-head`, `.mb-sheet-body`, `.mb-sheet-foot`). Say what will happen before it happens
  ("Approve 2 pieces for Pier B"). Say what happened after, with a toast.
- Status always in words and colours from `requestProgress` (`.mb-pill` inside a `.mb-stage--<stage>`, `.mb-jbar`),
  never a raw stored status.
- **No connection.** The phone may lose signal in a yard. Read with `requestData` as usual. When a read fails, show
  the copy `offlineSnapshot` kept last time, saying when (`offlineSnapshot.savedText`), and offer no steps (see
  track's `loadChain` and `trackList.keep`/`restore`). Before any write, check `navigator.onLine`. When offline, say
  "No connection: nothing was sent" and send nothing. Keep only small summaries on the phone, per user.
- **Fusion writes stay in New EquipRite.** Where a step needs Fusion (a project's PR, a sync), say so and link to New
  (`$application.variables.appUrls.new`). Do not post to Fusion from Mobile.
- The camera: `resources/js/unitScanner.js` (BarcodeDetector, with a fallback) reads a unit's tag. A camera needs
  HTTPS (VBCS is). Locally it works on `localhost` only.

## Page rules (VBCS)

- Every page JSON and flow JSON has `"navigation": { "embeddable": "enabled" }`.
- In HTML bindings call `$functions.x(...)` (page module) and `$application.functions.x(...)`.
  - No arrow functions, no `String()`, `Number()` or `Boolean()`, and no array literals in bindings. Put them in a page
    function (`tests/mobile-app.test.js` checks this).
  - No `oj-bind-for-each` inside `<table>`, `<tbody>` or `<select>`.
- Each chain is a class in `<page>-page-chains/` named like the file. Every chain the page JSON names must exist, and
  every chain file must be used (checked).
- REST: `Actions.callRest(context, { endpoint: 'eqp-v1/<operationId>', uriParams, body })`. Operation ids are in
  `services/eqp-v1/openapi3.json`. Writes carry the audit headers (`currentUser.auditHeaders(context)`) where Next's do.
- Replace objects and arrays instead of mutating them. Use `"type": "any"` for free-form objects.
- A native input stops following its bound value once someone has typed in it. When a chain changes it, set the
  element's value too.
- Read what you need from a page variable before replacing it. A VB variable's old proxy throws when read after.
- VB loads a chain the first time it runs. A chain needed with no connection must have run once before (see the
  shell's `toastChain`).

## Shared parts

`resources/js` holds Next's modules, **byte for byte**: `tests/mobile-app.test.js` fails if a shared file differs from
Next's. If a shared module needs a change, make it in both apps and keep Next's tests green. Mobile's own modules are
`mobileTabs`, `mobileBus`, `trackList`, `offlineSnapshot`, `installPrompt` and `pwaSetup`. Add yours as
`resources/js/mobile<Tab>.js` (pure: no calls, so it can be unit-tested), and add its name to `MOBILE_ONLY` in
`tests/mobile-app.test.js`.

| Module | Use it for |
|---|---|
| `rules.js` | page access (`pageAccess`, `canSee`), persona, feature flags, quotes, user name and initials |
| `requestData.js` | requests and their lines (shared with the other tabs for half a minute); `invalidate()` after a write |
| `requestProgress.js` | where a request and each piece is: stage, words, next step, late |
| `requestHistory.js` | a request from start to end |
| `approvalQueue.js`, `approveAllocate.js` | Approve: the queue, a request's lines in words, deciding (`decideRequest`), units |
| `yardWork.js`, `yardLoad.js`, `pickSlip.js`, `unitScanner.js` | Pick: the yard's work, loading it, the pick slip, the camera |
| `orderForm.js`, `catalogCart.js`, `bipLov.js`, `mapPicker.js`, `deliveryCoords.js`, `draftResume.js` | Request |
| `offlineSnapshot.js` | the copy kept on the phone |
| `fmt.js` | dates, ranges, relative days, money, counts |

Styles: your tab's own go in `resources/css/mobile-<tab>.css` (already loaded by the app), as `.mb-<tab>-*`. Use the
tokens in `mobile.css` (`--mb-band`, `--mb-ok`, `--mb-danger`, `--mb-line`, …) rather than new colours.

## Tests

- `tests/mobile-<tab>.test.js`: your pure module, and any chain logic worth pinning, with the real shared modules
  loaded (see `tests/mobile-app.test.js`'s `load`).
- `tests/e2e/mobile-<tab>.e2e.js`: in a phone-sized browser. `E.start({ port, app: 'mobile', handle, access })` opens
  the app at 390 x 844 (touch, 2x). Give your script its own port (Approve 20500, Pick 20600, Request 20800); the app
  uses port + 3. Check the role's tabs, your list, a record, the main step and what it writes (`env.writes`), the
  offline case, no sideways scroll, and `env.errors` empty at the end. Save screenshots with `env.shot('mobile-<tab>-….png')`.
- `npm run build` first. `npm test` runs every unit suite.
