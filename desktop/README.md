# EquipRite desktop client

A thin Electron shell that runs the EquipRite Visual Builder (Redwood) app on your laptop, in its own
window, against the live backends — the same way the Re-ERP maintenance app runs with `npm run desktop:fresh`.

## How it works

The shell runs a small local server in its own process (`lib/devserver.js`) and loads `http://localhost:18888/`.
The server serves the built app (`build/processed/webApps/vbredwoodapp`; JET, `oj-sp` and the VB runtime come from
Oracle's CDN) and does the server-side jobs the VBCS server does when the app is deployed:

| VBCS does | Locally |
|---|---|
| fills `%{env.userProfileUrl}%` in `app-flow.json` and answers it with the signed-in user | `/_currentuser` answers with the user from the sign-in window |
| serves the application's `services/catalog.json` next to the web app | served from `build/processed/services/`, each backend pointed at `/__backend/<name>` on the local server, with `forceProxy` and the VBCS credential reference removed (in memory only; the file in `services/` is untouched) |
| proxies the backends, adding the stored credential | `/__backend/<name>/…` forwards to the real URL; backends that use the Fusion credential (`fusion`, `bipService`, `callPWPBIP`) get the Fusion login from the sign-in window |

Oracle's own `grunt vb-serve` does none of this (it is `express.static` plus a canned `/_currentuser`), which is
why the app used to land on "You don't have access to EquipRite" with no data.

Nothing in `webApps/` or `services/` changes for this, so what you build here deploys to VBCS as-is.

## Signing in

On first start a sign-in window asks for:

- **Open** — **Old EquipRite** (today's app, unchanged) or **New EquipRite** (the redesign, a preview while it is
  being built). Each runs on its own local server, Old on port 18888 and New on 18889, at the site root as VB
  expects; both use the same backends and the same sign-in, so they show the same data. The window title says
  which one is open. **File → Open Old EquipRite** (Ctrl+Shift+1) and **File → Open New EquipRite** (Ctrl+Shift+2)
  switch without signing out, and the choice is remembered. New EquipRite is offered once `npm run build` has
  built it (`desktop:fresh` builds both).

- **Fusion username to sign in as** — what `$application.user` carries; `ROLES_RP` is run for it (`P_LOGIN`).
- **Fusion login** — stands in for the VBCS stored credential (`vb_e32dea99…`) on BIP and Fusion REST calls: the
  roles report, project lists, PDFs. Use an account that can run `/Custom/EquipRite/ROLES_RP.xdo`.
- **Roles** — read from Fusion (`ROLES_RP`), exactly as in VBCS, or picked by hand to try a persona without a
  Fusion login (the local server then answers `ROLES_RP` itself with those roles).

It is saved in `%APPDATA%\EquipRite\local-identity.json` (outside the project: never committed, never copied into
a build). The password is stored only encrypted with your Windows account (Electron `safeStorage`). Change it with
**File → Sign in as…** (the app reloads as the new login); **File → Sign out** forgets it, password included.
**View → Backend calls…** lists every call the server forwarded, with its status. When Fusion refuses a call
(no or wrong Fusion login) or a backend cannot be reached, the window says so once, naming the report.

| Backend | Auth in VBCS | Locally |
|---|---|---|
| `eqpt` (:8087, the EquipRite REST service), `commonService` (:8082) | anonymous | forwarded, no credentials |
| `fusion`, `bipService`, `callPWPBIP` | stored credential `vb_e32dea99…` | the Fusion login from the sign-in window |
| `ics` (OIC) | stored credential `vb_cf7d9fde…` | not available (forwarded without a login, answers 401) |

## Web services

**View → Web services…** (or `http://localhost:18888/__services/`) lists every endpoint of every service
connection, read from `services/*/openapi3.json` each time it opens: method, path, operation ID, description,
the backend URL, the credentials it goes out with, and the pages and chains that call it by endpoint ID
(`eqp-v1/getX`). Search by path, operation ID or summary; filter by service, method, or whether the app calls it.

Each GET has a **Test** panel: fill its path and query parameters (VB's default values are pre-filled), press
**Send GET**, and see the status, time and formatted response. The request goes through the same forwarding as the
app's own calls, so `eqpt` gets no login and the Fusion endpoints get the Fusion login from the sign-in window.
Only GET can be tested, so a test never changes data. This page belongs to the desktop client, not the VB app,
and is never deployed to VBCS.

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

Prefer the browser? `npm run serve` builds and serves the same app at `http://localhost:8888/`. It has no sign-in
window, so say who you are in the environment first (PowerShell):

```bash
$env:EQP_USER="john.dunbar"; $env:EQP_ROLES="RT_EQP_MANAGER"; npm run serve
```

`EQP_FUSION_USER` / `EQP_FUSION_PASSWORD` give it a Fusion login instead of (or as well as) `EQP_ROLES`.

## Troubleshooting

- **"TypeError: terminated" / "Electron failed to install correctly".** That is Electron's own one-shot
  download being cut; `npm run desktop` now fetches through `tools/get-electron.js`, which resumes. If even that
  gives up, download the zip it names in your browser and save it as the "to" path it prints.
- **"Could not start the local server".** No build (run `npm run desktop:fresh`), or port 18888 is taken (close
  the other window, or set `EQP_PORT`).
- **Still "You don't have access".** View → Backend calls… shows the `ROLES_RP` and `rbac/page-access` calls and
  their status: 401 from `bipService` is the Fusion login; a FAILED `eqpt` line means this PC cannot reach the
  EquipRite REST service.
- **The window stays on the spinner.** The app is fetching JET / `oj-sp` from `static.oracle.com`; a blocked
  CDN or no internet will stall it. `View → Toggle Developer Tools` shows the failing requests.
- **A different backend for one run.** `EQP_BACKEND_<NAME>=<url>` (e.g. `EQP_BACKEND_EQPT=http://host:8087`)
  points that backend elsewhere.

## Packaging an installer

Not wired yet. The local server already runs inside the Electron process, so an installer only needs to bundle
the built app with the shell; that can be added later with `electron-builder`, mirroring the maintenance app.
