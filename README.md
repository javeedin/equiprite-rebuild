# EquipRite — Visual Builder (Redwood) application

EquipRite is an equipment-rental and project-costing application built on Oracle Visual Builder with the
Redwood page templates (`oj-sp`). This repository is the Visual Builder app export plus a small local-run
harness so the app can be run on a laptop — in the browser or in a desktop window — against live backends,
without first deploying it to VBCS.

The visual application holds two web apps that share `services/` and therefore the same data:

- **Old EquipRite** (`webApps/vbredwoodapp/`): today's app. It is not changed by the redesign;
  `tests/old-app-unchanged.test.js` fails on any difference from the commit before the redesign started.
- **New EquipRite** (`webApps/equiprite/`): the Redwood redesign from `docs/redesign/` (FDD summary and
  wireframes). It is built screen by screen; a screen not rebuilt yet opens in the old app.

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
a small local server (`desktop/lib/devserver.js`) that does what the VBCS server does for the app: it supplies the
signed-in user, serves the services catalog and forwards the backend calls, adding a Fusion login where VBCS adds
its stored credential. The desktop window asks who you are on first start, and whether to open Old or New
EquipRite. See [`desktop/README.md`](desktop/README.md) for how it works and what each backend gets.

`npm run serve` serves Old EquipRite. For New EquipRite in a browser use `EQP_WEBAPP=equiprite npm run serve`.

## Layout

| Path | What |
|---|---|
| `webApps/vbredwoodapp/` | Old EquipRite: `app-flow.*`, `flows/`, `pages/`, `fragments/`, `resources/` (not changed) |
| `webApps/equiprite/` | New EquipRite, the redesign: same layout; the menu (`NAV_GROUPS` in `app-flow.js`) says which screens are built |
| `docs/redesign/` | FDD summary and wireframes (PDF and HTML) the redesign is built from |
| `services/` | backend service definitions and `catalog.json` (backend base URLs + proxy settings) |
| `tools/check-tools.js` | build preflight (the installed `grunt-vb-build` must match the app's `source.version`; no `node_modules` inside a copied folder) |
| `tools/get-electron.js` | fetches Electron's binary with resume and checksum before `desktop` / `desktop:fresh` start it |
| `desktop/` | the Electron desktop shell (not part of the VB app) |
| `tests/` | dependency-free `node` test suites (`npm test`) |

Everything under `node_modules/`, `build/`, and `desktop/{dist,app}/`, and `package-lock.json`, is local build
output and is git-ignored (`.gitignore`).

## Developing a screen

Each page is a triplet `<name>-page.json` / `.html` / `.js` under `webApps/<app>/flows/<flow>/pages/`,
with chains under `<name>-page-chains/`. Edit the triplet, then `npm run serve` (or `desktop:fresh`) to see the
change. The components come from the `oj-sp` CDN pack pinned in each app's `app-flow.json`.

New screens go into `webApps/equiprite/`. When one is built, set its menu item's `status` to `'new'` with a
`route` in `NAV_GROUPS` (`webApps/equiprite/app-flow.js`); `tests/new-app.test.js` checks every menu item leads to
a page that exists in one of the two apps.
