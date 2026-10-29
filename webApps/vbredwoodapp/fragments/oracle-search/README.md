# Oracle Search Fragment — Usage Guide

> **Platform:** Oracle Visual Builder Cloud Service (VBCS) — Redwood

---

## What this fragment does

The `oracle-search` fragment is a reusable VBCS fragment that turns any Oracle Fusion REST endpoint into a type-ahead lookup field.

It:
- works with any endpoint that supports Oracle Fusion `q`, `fields`, and `limit` query parameters
- shows matching suggestions in an `oj-input-search` dropdown
- returns the selected row object back to the host page via `selectedItem`
- is configured entirely through fragment properties

Use it for any LOV, autocomplete, lookup, or search use case.

---

## Installation

1. Copy the `oracle-search` folder into your app:

```bash
webApps/<your-app-name>/fragments/oracle-search/
```

2. Commit the new files if using Git:

```bash
git add webApps/<your-app-name>/fragments/oracle-search/
git commit -m "chore: add oracle-search fragment"
git push
```

3. Refresh the VBCS page designer if the fragment does not appear.

---

## Fragment configuration

Configure the fragment with these properties:

| Property | Required | Purpose |
|---|---|---|
| `endpoint` | Yes | ServiceConnectionName/OperationId |
| `searchField` | Yes | The backend field used for filtering |
| `keyField` | Yes | Unique ID field for each row |
| `returnFields` | Recommended | Fields to fetch from the endpoint |
| `displayField1` | Recommended | Primary suggestion text |
| `displayField2` | Optional | Secondary suggestion text |
| `labelText` | Optional | Search input label |
| `placeholderText` | Optional | Input placeholder |
| `selectedDisplayFormat` | Optional | Format for selected input text. Use `%displayField1%` and `%displayField2%` placeholders; do not use `{{...}}` syntax. |
| `minChars` | Optional | Minimum typed characters before search runs |
| `maxResults` | Optional | Maximum returned rows |
| `selectedItem` | Recommended | Page variable to receive the selected object |

---

## Using the fragment on a page

### 1. Add the fragment to the page

Drag the `oracle-search` fragment from the Fragments palette onto the page.

### 2. Create the selection variable

Create a page variable to hold the selected row, for example:
- ID: `fragmentSelectedItem`
- Type: `Any`

### 3. Bind `selectedItem`

Bind the fragment's `selectedItem` to the page variable with two-way binding:

```html
<oj-vb-fragment-param name="selectedItem" value="{{ $variables.fragmentSelectedItem }}"></oj-vb-fragment-param>
```
You can also set `selectedDisplayFormat` to control how the selected item text appears in the search input, for example:
- `%displayField1%`
- `%displayField1% - %displayField2%`

> Note: `selectedDisplayFormat` must use percent-style placeholders such as `%displayField1%` and `%displayField2%`. Do not use the Visual Builder expression syntax `{{displayField1}}` or `{{displayField2}}` here.

### 4. Display selected values

Use the selected object in any component.

Example:

```html
<oj-input-text
  label-hint="Selected Item"
  readonly="true"
  value="[[ $variables.fragmentSelectedItem ? $variables.fragmentSelectedItem.ProjectNumber : '' ]]">
</oj-input-text>
```

You can also bind specific fields to multiple components.

---

## Use it for any endpoint or LOV

This fragment is designed for any endpoint that supports the standard Oracle Fusion REST query model.

Common use cases:
- Search employees by name
- Lookup suppliers by code
- Find purchase orders by number
- Choose customers by email
- Select inventory items by description

How to adapt it:
1. Set `endpoint` to the target operation.
2. Set `searchField` to the field users type against.
3. Set `returnFields` to the fields required for display and selection.
4. Set `displayField1` and optionally `displayField2` for suggestion display.
5. Bind `selectedItem` to a page variable.

---

## Example configurations

### Project lookup

| Property | Value |
|---|---|
| `endpoint` | `Projects/getFscmRestApiResources11_13_18_05Projects` |
| `searchField` | `ProjectNumber` |
| `keyField` | `ProjectId` |
| `returnFields` | `ProjectId,ProjectNumber,ProjectName,ProjectManagerName,ProjectStatusCode,ProjectStatus` |
| `displayField1` | `ProjectNumber` |
| `displayField2` | `ProjectName` |
| `labelText` | `Project` |
| `placeholderText` | `Search by project number...` |
| `selectedItem` | `{{ $variables.fragmentSelectedProject }}` |

### Employee lookup

| Property | Value |
|---|---|
| `endpoint` | `Employees/getHcmRestApiResources11_13_18_05Workers` |
| `searchField` | `DisplayName` |
| `keyField` | `PersonId` |
| `returnFields` | `PersonId,PersonNumber,DisplayName,WorkEmail,DepartmentName` |
| `displayField1` | `DisplayName` |
| `displayField2` | `PersonNumber` |
| `labelText` | `Employee` |
| `placeholderText` | `Search by employee name...` |
| `selectedItem` | `{{ $variables.fragmentSelectedEmployee }}` |

---

## Troubleshooting

- If no results appear, verify that the endpoint supports `q` filtering and that `searchField` is correct.
- If `selectedItem` is not populated, ensure the fragment uses `{{ }}` writeback binding.
- If returned fields are blank, include them in `returnFields`.
- If the endpoint uses a different filter model, map `searchField` to the appropriate searchable field.

---

## Notes

- This fragment is intended to be reusable for any search or LOV requirement.
- You can use multiple instances on the same page with different `selectedItem` bindings.
- Control behavior with `minChars` and `maxResults`.
