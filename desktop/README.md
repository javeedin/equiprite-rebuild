# EquipRite desktop client

A thin Electron shell that runs the EquipRite Visual Builder (Redwood) app on your laptop, in its own
window, with live backend data — the same way the Re-ERP maintenance app runs with `npm run desktop:fresh`.

## How it works

On start, the shell launches Oracle's own local server, **`grunt vb-serve`**, as a child process and loads
`http://localhost:18888/` in the window. `vb-serve` does two jobs:

1. **Serves the built app** (`build/processed/webApps/vbredwoodapp`), with the Redwood `oj-sp` components,
   JET and the VB runtime loaded from Oracle's public CDN (`static.oracle.com`).
2. **Proxies the REST calls server-side.** Every backend in `services/catalog.json` is `"forceProxy": always`,
   so the page makes only same-origin calls to `localhost` and `vb-serve` forwards them — exactly as Visual
   Builder does when the app is deployed. No CORS setting, no dev proxy, and the page keeps full web security.

Because of that, the shell needs **no HTTP bridge** (unlike the Re-ERP maintenance desktop client). The only
dependency is Electron, a prebuilt binary — nothing native is compiled and no shell is started (eScan-safe).

## What works locally, what doesn't

| Backend | Auth | Local |
|---|---|---|
| `eqpt` — ORDS at `132.145.153.37:8087` (the system of record) | anonymous | ✅ full |
| `commonService` — shared lookups at `:8082` | anonymous | ✅ full |
| `fusion` / `callPWPBIP` / `bipService` — Fusion REST + BI Publisher | VBCS stored credential | ⚠️ unavailable |
| `ics` — OIC / Integration Applications | VBCS stored credential | ⚠️ unavailable |

The core app (equipment, requests, allocation, timesheets, costing — all on `eqpt`) runs on **live data**.
Project LOVs and PDF output, which need the VBCS credential store, degrade until the app is deployed to VBCS.

## Run it

From the **project root** (the folder with `package.json`), the first time:

```bash
npm install            # Oracle build tooling (grunt-vb-build) from static.oracle.com
npm run desktop:install # Electron, into desktop/
npm run desktop:fresh  # build the app, then open the desktop window
```

After that, `npm run desktop:fresh` is all you need (it rebuilds, then launches). `npm run desktop` skips the
rebuild and reuses the last build.

Prefer the browser? `npm run serve` builds and opens the same app at `http://localhost:8888/`.

## Troubleshooting

- **The window shows "Could not start the local server".** Run `npm install` in the project root and check
  `npm run build` succeeds on its own. The window shows the last lines of the `vb-serve` log.
- **The window stays on the spinner.** The app is fetching JET / `oj-sp` from `static.oracle.com`; a blocked
  CDN or no internet will stall it. `View → Toggle Developer Tools` shows the failing requests.
- **A different port.** Set `EQP_PORT` (e.g. `EQP_PORT=18890 npm run desktop`).

## Packaging an installer

Not wired yet. This shell runs the app through `grunt vb-serve`, which suits local development
(`desktop:fresh`). A standalone installer would bundle the built app and an embedded static+proxy server
instead of spawning grunt; that can be added later with `electron-builder`, mirroring the maintenance app.
