# EquipRite — Visual Builder (Redwood) application

EquipRite is an equipment-rental and project-costing application built on Oracle Visual Builder with the
Redwood page templates (`oj-sp`). This repository is the Visual Builder app export plus a small local-run
harness so the app can be run on a laptop — in the browser or in a desktop window — against live backends,
without first deploying it to VBCS.

## Run it locally

Oracle's build tooling and the Redwood runtime load from Oracle's public CDN, so the machine needs internet
access to `static.oracle.com`. From this folder:

```bash
npm install             # Oracle build tooling (@oracle/grunt-vb-build) from static.oracle.com

# In a browser (opens http://localhost:8888/):
npm run serve

# Or as a desktop window (first time: install Electron into desktop/):
npm run desktop:install
npm run desktop:fresh
```

`npm run serve` and `npm run desktop:fresh` both build the app first (`grunt vb-process-local`) and then start
Oracle's local server, **`grunt vb-serve`**, which serves the app **and** proxies its REST calls server-side —
every backend in `services/catalog.json` is `"forceProxy": always`, so the page makes only same-origin calls
and needs no CORS setting. See [`desktop/README.md`](desktop/README.md) for how the desktop shell works and
which backends are available locally (the anonymous `eqpt` system of record and `commonService` work on live
data; Fusion/OIC/BI Publisher need the VBCS credential store and degrade until the app is deployed).

## Layout

| Path | What |
|---|---|
| `webApps/vbredwoodapp/` | the app: `app-flow.*`, `flows/`, `pages/`, `fragments/`, `resources/` |
| `services/` | backend service definitions and `catalog.json` (backend base URLs + proxy settings) |
| `tools/check-tools.js` | build preflight (the installed `grunt-vb-build` must match the app's `source.version`) |
| `desktop/` | the Electron desktop shell (not part of the VB app) |
| `tests/` | dependency-free `node` test suites (`npm test`) |

Everything under `node_modules/`, `build/`, and `desktop/{node_modules,dist,app}/` is local build output and is
git-ignored.

## Developing a screen

Each page is a triplet `<name>-page.json` / `.html` / `.js` under `webApps/vbredwoodapp/flows/<flow>/pages/`,
with chains under `<name>-page-chains/`. Edit the triplet, then `npm run serve` (or `desktop:fresh`) to see the
change. The components come from the `oj-sp` CDN pack pinned in `webApps/vbredwoodapp/app-flow.json`.
