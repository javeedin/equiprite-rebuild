# EquipRite — Visual Builder (Redwood) application

EquipRite is an equipment-rental and project-costing application built on Oracle Visual Builder with the
Redwood page templates (`oj-sp`). This repository is the Visual Builder app export plus a small local-run
harness so the app can be run on a laptop — in the browser or in a desktop window — against live backends,
without first deploying it to VBCS.

## Run it locally

Oracle's build tooling and the Redwood runtime load from Oracle's public CDN, so the machine needs internet
access to `static.oracle.com`. From this folder:

```bash
npm install             # Oracle build tooling (@oracle/grunt-vb-build) and Electron

# In a browser (opens http://localhost:8888/):
npm run serve

# Or as a desktop window (the first start downloads Electron's binary):
npm run desktop:fresh
```

Upgrading from the old `npm run desktop:install`? Delete `desktop/node_modules` first; Oracle's build copies
every project folder and fails on it, and `npm run build` stops and says so.

`npm run serve` and `npm run desktop:fresh` both build the app first (`grunt vb-process-local`) and then start
Oracle's local server, **`grunt vb-serve`**, which serves the built app. It does not proxy REST calls or sign
anyone in, so today the app renders but has no data and lands on the No Access page. See
[`desktop/README.md`](desktop/README.md) for what works locally and why.

## Layout

| Path | What |
|---|---|
| `webApps/vbredwoodapp/` | the app: `app-flow.*`, `flows/`, `pages/`, `fragments/`, `resources/` |
| `services/` | backend service definitions and `catalog.json` (backend base URLs + proxy settings) |
| `tools/check-tools.js` | build preflight (the installed `grunt-vb-build` must match the app's `source.version`; no `node_modules` inside a copied folder) |
| `desktop/` | the Electron desktop shell (not part of the VB app) |
| `tests/` | dependency-free `node` test suites (`npm test`) |

Everything under `node_modules/`, `build/`, and `desktop/{dist,app}/`, and `package-lock.json`, is local build
output and is git-ignored (`.gitignore`).

## Developing a screen

Each page is a triplet `<name>-page.json` / `.html` / `.js` under `webApps/vbredwoodapp/flows/<flow>/pages/`,
with chains under `<name>-page-chains/`. Edit the triplet, then `npm run serve` (or `desktop:fresh`) to see the
change. The components come from the `oj-sp` CDN pack pinned in `webApps/vbredwoodapp/app-flow.json`.
