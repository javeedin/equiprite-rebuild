# EquipRite desktop client

A thin Electron shell that runs the EquipRite Visual Builder (Redwood) app on your laptop, in its own
window — the same way the Re-ERP maintenance app runs with `npm run desktop:fresh`.

> **Status (2026-10-29): the window opens and the app renders, but it has no data and no user yet.** It lands
> on "You don't have access to EquipRite". See [What works locally](#what-works-locally-what-doesnt).

## How it works

On start, the shell launches Oracle's own local server, **`grunt vb-serve`**, as a child process and loads
`http://localhost:18888/` in the window. `vb-serve` **serves the built app** (`build/processed/webApps/vbredwoodapp`),
with the Redwood `oj-sp` components, JET and the VB runtime loaded from Oracle's public CDN (`static.oracle.com`).

That is all it does. Oracle's `vb-serve` task is `express.static` plus a canned `/_currentuser`: it does **not**
proxy REST calls, so the `"forceProxy": always` backends in `services/catalog.json` have nothing to forward them.
The only dependency is Electron, a prebuilt binary — nothing native is compiled and no shell is started (eScan-safe).

Electron is a devDependency of the **root** `package.json`, not of `desktop/`. Oracle's build copies every
project folder except `node_modules`, `build`, `webApps` and `services` into `build/processed`, and it fails on a
`node_modules` inside `desktop/` (EISDIR on `.bin/electron`). The root `node_modules` is never copied. Electron 45
runs no install script; it downloads its binary the first time it starts.

## What works locally, what doesn't

Checked by running `npm run desktop:fresh` and recording the page's calls:

| What | Local today | Why |
|---|---|---|
| Window, Redwood shell, menus | ✅ | built app + CDN |
| Every REST backend, `eqpt` included | ❌ | the app asks for `services/catalog.json` next to the web app; the build writes it to `build/processed/services/`, so VB configures no endpoint ("Unable to configure endpoint …") |
| Signed-in user and roles | ❌ | `/_currentuser` has no username, so `loadFusionRolesChain` fails closed and every page resolves to HIDDEN (No Access page) |
| `fusion` / `bipService` / `callPWPBIP` / `ics` | ❌ | basic auth with credentials only the VBCS credential store holds |

Getting live data locally needs a real local server in place of `vb-serve`: one that serves the catalog, forwards the
`forceProxy` backends (`eqpt` and `commonService` are anonymous), and supplies a local user and roles.

## Run it

From the **project root** (the folder with `package.json`), the first time:

```bash
npm install            # Oracle build tooling (grunt-vb-build) and Electron
npm run desktop:fresh  # build the app, then open the desktop window (first start downloads Electron's binary)
```

Electron's binary (~120 MB) is fetched by `tools/get-electron.js` before the window starts. If antivirus or a
proxy cuts the download, it resumes from where it stopped instead of starting over, and it checks the zip's
SHA-256 before Electron's own installer unpacks it. Running it again after a failure carries on from the
`.part` file.

After that, `npm run desktop:fresh` is all you need (it rebuilds, then launches). `npm run desktop` skips the
rebuild and reuses the last build.

Upgrading from the old `npm run desktop:install`? Delete `desktop/node_modules` (`rmdir /s /q desktop\node_modules`
on Windows); `npm run build` stops and says so until you do.

Prefer the browser? `npm run serve` builds and opens the same app at `http://localhost:8888/`.

## Troubleshooting

- **"TypeError: terminated" / "Electron failed to install correctly".** That is Electron's own one-shot
  download being cut; `npm run desktop` now fetches through `tools/get-electron.js`, which resumes. If even that
  gives up, download the zip it names in your browser and save it as the "to" path it prints.
- **The window shows "Could not start the local server".** Run `npm install` in the project root and check
  `npm run build` succeeds on its own. The window shows the last lines of the `vb-serve` log.
- **The window stays on the spinner.** The app is fetching JET / `oj-sp` from `static.oracle.com`; a blocked
  CDN or no internet will stall it. `View → Toggle Developer Tools` shows the failing requests.
- **A different port.** Set `EQP_PORT` (e.g. `EQP_PORT=18890 npm run desktop`).

## Packaging an installer

Not wired yet. This shell runs the app through `grunt vb-serve`, which suits local development
(`desktop:fresh`). A standalone installer would bundle the built app and an embedded static+proxy server
instead of spawning grunt; that can be added later with `electron-builder`, mirroring the maintenance app.
