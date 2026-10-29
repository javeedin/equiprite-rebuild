# EquipRite redesign: FDD summary and wireframes

Everything here is documentation for the redesign. Nothing in this folder is part of the VBCS app, so it does not
affect `webApps/` or `services/` and is not deployed.

| File | What it is |
|------|------------|
| `EquipRite-FDD-Summary.pdf` | Summary of FDD v1.7: modules, business requirements, roles and access, menus and pages, the five phases, status lifecycles, 35 scenarios with flow diagrams (including DP-01 to DP-10), integrations INT-01 to INT-20, errors and monitoring, notifications, reports, settings, data model, testing, open items, old app vs new app, and inconsistencies found in the FDD. |
| `fdd-summary/EquipRite-FDD-Summary.html` | The same summary as a web page. |
| `EquipRite-Redesign-Wireframes.pdf` | Every wireframe screen, one per page, after a cover with contents. |
| `wireframes/html/index.html` | The wireframes as static web pages. Open `index.html` in a browser; links between screens work. |
| `wireframes/source/` | The design-canvas source (`*.dc.html` and `canvas.json`). The live canvas is https://claude.ai/artifact/KPvPbWuSGpWcJ4VTXYBpEU (private to its owner unless shared). |
| `tools/` | Scripts that rebuild the PDFs and HTML. |

All names and numbers in the wireframes are illustrative.

## Rebuilding

Both scripts need Playwright with its Chromium (`npm install` in the repo root). The wireframe export also needs
`pdfunite` (poppler).

```bash
node docs/redesign/tools/build-fdd-summary.js
```

```bash
node docs/redesign/tools/export-wireframes.js
```

The FDD summary's content lives in `tools/build-fdd-summary.js` as data, with FDD section numbers next to each fact.
After the canvas changes, copy its files into `wireframes/source/` and rerun the export.
