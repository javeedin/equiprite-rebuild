# EquipRite FDD v2.0 (draft): many companies, many countries

Extends FDD v1.7 with requests tied to business units, equipment shared between group companies (intercompany hire),
how the owner bills the user company, multi-country rules, and the accounting entries of each case.

- `EquipRite-FDD-v2-Multi-Company.pdf`: the document (A4 landscape).
- `EquipRite-FDD-v2-Multi-Company.html`: the same, with a journal explorer (change the assumptions, the entries recompute).
- `tools/flows.js`: the swimlane flows (drawn by EquipRite Next's own FDD-page renderer, `tools/diagrams.js`).
- `tools/journals.js`: the worked accounting example (one function, used by the PDF and the explorer).
- `tools/build-fdd-v2.js`: the content and the build.

EquipRite Future shows the document in its own tab (menu Help → FDD 2.0, `webApps/equiprite-future/flows/fdd2`) from
copies in `webApps/equiprite-future/resources/fdd2/`; the build writes them too, byte for byte (`--no-pdf` copies the
PDF already here), and `tests/future-fdd2.test.js` checks they match.

Rebuild after editing: `node docs/fdd-v2/tools/build-fdd-v2.js`. Checked by `node tests/fdd-v2.test.js` (every entry
balances, every flow is well formed, every journal code on a flow exists).
