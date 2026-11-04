# EquipRite Next: building a screen's Redwood view

Users choose a look in the menu under their name: **Redwood** or **Current**. Under Redwood, every screen should be built from Oracle's own Redwood page templates and components, as Old EquipRite does. It should not just be Next's own layout repainted.

Under Current, every screen stays exactly as it is today.

This guide covers how to give a screen its Redwood view.

## How the look reaches a screen

- `resources/js/look.js` keeps the choice for each user, on this computer. The shell's `lookChain` applies it.
- It is shown on the page's root as `html[data-nx-look="redwood"|"current"]`.
- Every screen can read it from the application:
  - `$application.variables.look` is `'redwood'` or `'current'`.
  - `$application.variables.lookSeen` becomes true the first time Redwood is shown in this visit.
- A screen's Redwood view goes on the page the first time Redwood is shown, and is then kept there. Under Current it is only hidden, never taken off. Taking Oracle's Smart Search off the page while it is still settling throws an error ("Cannot read properties of null (reading 'dispatchEvent')").

The markup pattern for every screen:

```html
<div class="nx-page nx-<screen>">
  <oj-bind-if test="[[ $application.variables.lookSeen ]]">
    <div class="nx-rw" id="<prefix>Redwood" :hidden="[[ $application.variables.look !== 'redwood' ]]">
      … Oracle's page template …
    </div>
  </oj-bind-if>
  <oj-bind-if test="[[ $application.variables.look !== 'redwood' ]]">
    … the Current look, unchanged (at least its .nx-pagehead) …
  </oj-bind-if>
</div>
```

Shared styles in `next-redwood.css` apply to any `.nx-rw`, so screens don't add their own for these:

- The header's colour runs to the tab's edges and on down behind the top of the content, as Old's body banner does. It is 340px by default; a screen can set `--rw-banner-h` on its `.nx-page`.
- The template sits 40px in from each side, with corners rounded to 12px.

## The three patterns: pick by what the screen is in Old

Old's templates for each screen are listed by `grep -o "<oj-sp-[a-z-]*" webApps/vbredwoodapp/flows/**/pages/*-page.html`. Follow Old's choice for the matching screen.

### L: list screens use Oracle's Smart Search page

The reference implementation is **Requests**:

- `flows/requests/pages/requests-page.{html,json,js}`
- `requests-page-chains/{applyChain,rwFilterChain,openRecordChain}.js`
- `resources/data/requestsSearchConfig.json`
- `requestList.redwoodRows`, `columnOptions` and `byColumns`

Build it like this:

- **Page.** `oj-sp-smart-search-page` with:
  - `page-title` and `page-subtitle` (the screen's summary line).
  - `primary-action.display/label` plus `on-sp-primary-action` for the screen's main "New …" action, if it has one.
  - `display-mode="mixed"`.
- **Search.** `oj-sp-smart-search slot="search"`:
  - `filter-criterion="{{ $variables.rwCriterion }}"` and `on-filter-criterion-changed` pointing to a filter chain.
  - `search-config` set to `JsonSearchConfigProviderFactory` with the URL `$application.path + 'resources/data/<screen>SearchConfig.json'`.
  - `search-context` and `suggestion-filters`.
  - A `placeholder`.
- **Filters are the table's columns**, in the columns' order, then any extra fields. Each one is a `SelectSingleFilter`. Its options are what the rows hold, with how many rows have each: `{ value, label: 'X (3)' }`, worked out from all the rows, not just the ones shown.
  - **Every filter in the config needs its entry in the page's `rwSearchContext`.** A filter without one throws, and the table comes up blank.
  - Each filter's options are an `any[]` page variable plus an `ArrayDataProvider2` (`keyAttributes: 'value'`).
- **Reading the criterion.** It is a tree: a `text` node, plus `$eq` nodes. A `$eq` node holds its value either as `{ attribute, value }` or as `{ value: { field: v } }`; read both, as `rwFilterChain` does.
  - Smart Search applies a picked filter **when its dropdown closes** (Oracle's own behaviour, the same in Old), and can take more than a second after that. Tests should click the page title after picking, then wait for the rows to change rather than pausing for a fixed time.
- **Anything inside `oj-sp-collection-container` that an `oj-bind-if` adds later** (a message, a bar) must sit in an element that is there from the start, such as `<div class="…"><oj-bind-if …>…</oj-bind-if></div>`. Added straight inside the container, it never shows.
- **Body.** `oj-sp-collection-container` with:
  - A small tools row (`oj-c-button` Refresh and Export, `chroming="borderless"`).
  - An `oj-table` with:
    - `data` from an `ArrayDataProvider2` of plain rows (`keyAttributes: 'key'`).
    - A static `columns` JSON attribute, and `layout="fixed"`. Size the columns with `"weight": N`; with fixed layout the table ignores a `"style": "width:N%"`.
    - If its rows are replaced while it is still drawing them (data streaming in), `oj-table` throws "Aborting stale fetch". Coalesce updates that arrive close together (see `usageRedwood.js`).
    - Cell `<template slot="…">` blocks that use `cell.row`.
    - `on-oj-row-action`.
- **Statuses** use Oracle's `oj-badge` classes, as in `requestList.BADGE`:
  - `oj-badge oj-badge-subtle`
  - `oj-badge-info oj-badge-subtle`
  - `oj-badge-warning oj-badge-subtle`
  - `oj-badge-success oj-badge-subtle`
  - `oj-badge-danger oj-badge-subtle`
  - `oj-badge-info` (solid)
- **Row steps.** `oj-c-button`: the one main step uses `chroming="callToAction"`; the others use `chroming="outlined"`. Each carries `data-*` attributes for its listener, inside `<div data-oj-clickthrough="disabled">` so a click doesn't also trigger the row.
- **Smart Search's criterion can't be set from the page** (it is read-only). A Redwood list's default filter is "nothing picked", as in Old. Give the Redwood view its own state for any filter the Current look also has, such as a default "Open", so Current keeps its own.
- **Where the rows come from.** Work the Redwood rows out in the same chain that fills the Current list, from the same filtered rows, then apply the column filters to the Redwood rows only. Current must never be filtered by a filter it doesn't show.
- **Clicks.**
  - A row click (`$event.detail.context.key`; `context.item` is often undefined) does exactly what the Current row click does: the same chain, the same tab, the same dialog.
  - Step buttons call the same chains as the Current look's buttons.

### R: record, form and dashboard screens use Oracle's header over the screen's own body

The reference implementation is **Help** (`flows/help/pages/help-page.{html,js,json}`):

```html
<oj-bind-if test="[[ $application.variables.lookSeen ]]">
  <div class="nx-rw nx-rw--head" id="<prefix>Redwood" :hidden="[[ $application.variables.look !== 'redwood' ]]">
    <oj-sp-general-overview-page page-title="…" page-subtitle="…" display-mode="mixed"
      primary-action="[[ $functions.rwPrimary(…) ]]" on-sp-primary-action="[[ $listeners.… ]]"
      secondary-actions="[[ $functions.rwActions(…) ]]" on-sp-secondary-action="[[ $listeners.onRwAction ]]"
      display-options.in-flow-back="true" on-sp-in-flow-back="[[ $listeners.… ]]">
    </oj-sp-general-overview-page>
  </div>
</oj-bind-if>
<oj-bind-if test="[[ $application.variables.look !== 'redwood' ]]">
  <div class="nx-pagehead">… unchanged …</div>
</oj-bind-if>
… the screen's body, unchanged (next-redwood.css draws its parts in Redwood) …
```

How the header's parts work:

- **Primary action** (`primary-action`): `{ label, icon, display: 'on' }`. It is the white button on the dark band.
- **Secondary actions** (`secondary-actions`): an array of `{ id, label, icon, display: 'on' }`. Your listener reads the clicked item's id from `$event.detail.secondaryItem`, and should route each id to the chain that the Current look's button calls.
- **Arrays and objects in bindings come from page-module functions.** Next does not write array literals in bindings.
- **Return the same array (or object) for the same content.** Oracle's header rebuilds its toolbar whenever the action list changes, and throws "oj-toolbar … Cannot access methods before element is upgraded" if it changes again before the toolbar is ready. So keep labels steady: no "Refreshing…" swap.
- **Back.** Use in-flow back where the Current look has one, for example a record that came from a list.
- **Disabling an action.** Set `display: 'disabled'` on it. A `disabled: true` flag is ignored by oj-sp 2601.
- **The kicker** that sits over a Current title ("Commercial", "Project request") goes into the subtitle or is dropped. Oracle's header has no kicker.
- **Header-only views** (`.nx-rw--head`) have the template's empty content slot collapsed by `next-redwood.css`.
- **On a record screen, mount the header once the record is known** (`oj-bind-if` on its id). Its title and actions should not change while Oracle's toolbar is still loading.
- **Text not on a card sits on the band.** The header's colour runs 340px down behind the body. Any text there that is not on a card (a legend, a banner) needs a light colour or a card under it; or set a shorter `--rw-banner-h` for the screen.
- **The Redwood dialog head is white.** Anything a screen draws in white on Current's dark dialog head needs a dark colour under Redwood.

Where a section of the body is plainly a table of records, you may replace that section's Current markup with an `oj-table`, but only under Redwood (`:hidden` on the Redwood copy, `oj-bind-if` on the Current one), and only if it stays simple. Otherwise leave the body as it is.

### M: master-detail screens (Rates, Agreements) use both, as Old does

- The list is L, a Smart Search page of the records. In Old, Rates is a Smart Search page of schedules that opens a drawer or the record page.
- Choosing a row shows the record as R: Oracle's header with in-flow back to the list, over the screen's existing detail body.
- Keep the screen's selected-record state, so that both looks show the same record.

## Rules: the VBCS ones bite

- **No arrow functions, array literals, `String()`, `Number()` or `Boolean()` in bindings.** Use page-module functions instead.
- **Page variables are proxies.** Copy them to plain objects (`JSON.parse(JSON.stringify(...))`) before you reset them and then read the old value.
- **`oj-bind-if` remounts its content.** Native inputs keep their typed value.
- **Element ids must be unique.** Prefix every id in a Redwood view (`rate…` → `rateRw…`): the Current look's ids may still be in the DOM.
- **Imports.** Each page imports what it uses, in its page json:
  - `"oj-sp-smart-search-page": { "path": "oj-sp/smart-search-page/loader" }`, and likewise for `smart-search`, `collection-container` and `general-overview-page`.
  - `"oj-table": { "path": "ojs/ojtable" }`
  - `"oj-c-button": { "path": "oj-c/button" }`
- **Every screen's Redwood rules go in that screen's own stylesheet** (`next-commercial.css`, `next-yard.css` and so on). Every selector must start with `html[data-nx-look="redwood"]`. Don't edit `next.css` or `next-redwood.css`; say in your report if something shared is missing.
- **Don't change what a screen does.** Reuse its chains; a Redwood view is another way to look at the same state.
- **Shared modules.** `requestList.js`, `approvalQueue.js` and `orderForm.js` are shared with Mobile, which keeps identical copies. If you change one, copy it to `webApps/equiprite-mobile/resources/js/`.

## Testing

- Run `npm run build`, then `npm test`. Three unit suites already fail on the base and must not get worse: `import-chains`, `mobile-pick` and `mobile-approve`.
- Every existing browser suite for your screens (`tests/e2e/next-*.e2e.js`) must still pass. They run under Current.
- Add `tests/e2e/next-redwood-<group>.e2e.js` on its own port. It should:
  - Call `env.setLook('redwood')` (harness).
  - For each screen, check that Oracle's template is upgraded (`.oj-complete`) and shows the screen's data.
  - Check that the filters are the columns and that one filter narrows the rows.
  - Check that a row opens what it opens under Current, and that a header action works.
  - Check there are no browser errors.
  - Save a screenshot of each screen.
  - Switch back with `env.setLook('current')` and check that the Current look is back.
- Use `tests/e2e/next-redwood.e2e.js` (Requests) as the model.
