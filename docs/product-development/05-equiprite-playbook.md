# Part 5 — The EquipRite playbook (your concrete SOP)

This turns Parts 0–4 into **the exact way to run EquipRite**, given what it actually is today. Adopt it incrementally — the "Start here" checklist at the end orders it by payoff.

---

## 1. What EquipRite is (the shippable pieces)

EquipRite is not one artifact — it's a **product made of several deliverables**, each of which needs its own version and release path:

| Component | Repo folder | What it is | Ships as |
|-----------|-------------|-----------|----------|
| **Old** (live app) | `webApps/vbredwoodapp` | the current production VBCS app | VBCS deployment |
| **New** | `webApps/equiprite` | the redesigned app | VBCS deployment |
| **Next** | `webApps/equiprite-next` | the Redwood/flagship app | VBCS deployment |
| **Mobile** | `webApps/equiprite-mobile` | the mobile/PWA app | VBCS + Android wrapper |
| **Future** | `webApps/equiprite-future` | multi‑company prototype | VBCS deployment (preview) |
| **Desktop** | `desktop/` | Electron wrapper (Jira page, Record, SQL, local files) | packaged installer (Win/Mac) |
| **Android** | `desktop/phone-app` | native wrapper for the Wi‑Fi app | `.apk` (`versionName`/`versionCode`) |

This is why your versions are scattered today. The fix isn't "one version" — it's **one clear scheme per shippable piece**, all recorded in one place.

---

## 2. Versioning scheme for EquipRite

Recommendation:

- **The product as a whole** uses a **marketing/release version** (e.g. "EquipRite 2026.1") — CalVer, because it ships on a cadence and "how old is this" should be obvious to users.
- **Each shippable artifact** uses **SemVer** in its own manifest:
  - Web apps: a `version` per app (today only the root `package.json` 2510.0.3 exists — give each web app, or at least the suite, an explicit version and bump it on release).
  - **Desktop app:** `desktop/package.json` `version` (currently `0.1.0`) → SemVer; this is what `app.getVersion()` shows in the title bar. Bump **MINOR** for features, **PATCH** for fixes, **MAJOR** at the first stable GA.
  - **Android:** keep `versionName` (SemVer‑style, user‑facing) **and** increment `versionCode` on **every** build you distribute (store rule).
- **Record the mapping** in a `VERSIONS.md` at the repo root: "EquipRite 2026.1 = Next 1.3.0 + Desktop 0.4.0 + Android 1.1 (code 2)". One glance tells you what any release contains.
- **Tag every release** `v<desktop-or-suite-version>` and note the component versions in the tag message and CHANGELOG.

> Because the desktop app is **installed software with old copies on people's PCs** (exactly the "spawn EFTYPE / rebuild needed" situation you just hit), its version and a changelog matter a lot — users need to know which build they have and whether to update.

---

## 3. Branching model for EquipRite

Today: many `claude/*` and `worktree-agent-*` branches, **no `main`, no tags**. Move to **GitHub Flow + release tags**, with Git‑Flow‑style hotfix/release branches reserved for the desktop app:

1. **`main`** — always releasable; protected (PR + green `npm test` required to merge). This becomes your single source of truth for "what's good".
2. **Feature branches** — short‑lived, one per story/feature: `feat/jira-record-trace`, `fix/transcribe-eftype`. Branch off `main`, PR back into `main`.
3. **Release tags** — when you ship, tag `main`: `v0.4.0` (desktop) etc.
4. **`release/x.y` branch** — only if you need to stabilise a desktop release while `main` moves on.
5. **`hotfix/x.y.z`** — urgent production/desktop fix: branch from the release **tag**, fix, bump PATCH, tag, ship, merge back to `main`.

Migration from today:
- Pick the known‑good branch (currently `claude/equiprite-future`) and make it the basis of **`main`**.
- Delete/retire the `worktree-agent-*` branches once merged (they're exploratory).
- From then on, feature branches off `main`, PRs, tags.

> Keep using **Conventional Commits** (you already write descriptive messages) — `feat:`, `fix:`, `docs:` — so the changelog and next version can be computed automatically later.

---

## 4. Environments for EquipRite

| Ladder rung | EquipRite reality |
|-------------|-------------------|
| **Local/Dev** | `npm run desktop:fresh` (desktop) / `npm run serve` (web) on your PC |
| **Test/QA** | the automated suite: `npm test` + the Playwright `*.e2e.js` suites (your CI gate) |
| **Staging/UAT** | a **VBCS staging instance** of each web app; a **beta** channel of the desktop installer; the Android **internal testing track** |
| **Production** | the **VBCS production instance** (Old today; Next when promoted); the **stable** desktop installer; the Android **production track** |

Notes specific to you:
- **VBCS has its own application lifecycle** (develop → stage → publish, with versioned snapshots). Treat "publish to the prod VBCS instance" as your web deployment step, and keep the git tag matching what you published.
- **Secrets/keys** (Jira token, Fusion login, OpenAI key) are already kept on the PC via the desktop app / entered in‑app — good. Never commit them; the DB password you volunteered earlier must never go into files or commits (it hasn't).
- The **backends** (`services/catalog.json`) differ per environment; the desktop devserver injects the right ones. Keep a documented mapping of which backend URLs are dev vs prod.

---

## 5. Jira (project EQP) — your tracker, used properly

You already connected Jira and even built analysis pages over it. Use it as the single backlog/release tool:

- **Issue types:** Epic → Story → Sub‑task, plus Bug. (Your data already has Stories, Bugs, Epics.)
- **Workflow (statuses):** map to `Backlog → Ready → In Progress → In Review → In Test → Done`. You already see statuses like FUNC DESIGN / DEVELOPMENT / TEST / ONHOLD / Done — standardise them and make sure every story carries **acceptance criteria** (your Jira page already flags "No acceptance criteria" — that KPI is your DoR gate).
- **Sprints:** you have sprints in Jira (customfield_10020). Run **2‑week sprints** with a goal; use the "By sprint" view you built to spot still‑active‑after‑end sprints and carry‑over.
- **fixVersion = release:** create a Jira **version** per release (e.g. "Next 1.3.0"), tag each story/bug with its `fixVersion`, and **mark the version released** when you ship. This is how Jira ties stories → releases, and it's what generates release notes.
- **Tester gaps / quality score:** your Jira page already surfaces these — treat them as part of the **Definition of Done** (no open gaps, acceptance criteria present) before a story is "Done".

---

## 6. Testing & quality gates (you already have the backbone)

- **The gate to merge:** `npm test` green (your suite: unit + the `*.e2e.js` Playwright suites). You already run this religiously — formalise it as **branch protection on `main`**.
- **Known baseline:** 3 pre‑existing failing suites (import‑chains, mobile‑approve, mobile‑pick) and one flaky `oj-table` e2e. **Fix or quarantine these** so "green" means green — a noisy baseline erodes the gate.
- **The Old‑app guard** (`tests/old-app-unchanged.test.js`) is a great example of a **governance gate**: Old stays frozen except agreed changes. Keep that discipline.
- Add **CI** (GitHub Actions) that runs `npm test` on every PR, so the gate is automatic, not manual.

---

## 7. The EquipRite release checklist

Copy this into each release (or a Jira release ticket):

**Scope & prep**
- [ ] Decide which component(s) are releasing (Next? Desktop? Android?) and the scope.
- [ ] All intended stories merged to `main`; each meets DoD; acceptance criteria met.
- [ ] `npm test` green on the release commit (and e2e suites).
- [ ] Bump the version in the right manifest(s): `desktop/package.json` and/or app `package.json`, Android `version.json` (`versionCode`++).
- [ ] Update `CHANGELOG.md` (Added / Changed / Fixed / Breaking).
- [ ] Update `VERSIONS.md` (which component versions make up this release).
- [ ] Update user docs / runbook if behaviour changed.

**Cut the release**
- [ ] Tag: `git tag -a vX.Y.Z -m "EquipRite <suite> — Next x, Desktop y, Android z"` and push the tag.
- [ ] **Web:** publish the app(s) to the **staging** VBCS instance; smoke‑test; then publish to **production** VBCS.
- [ ] **Desktop:** build the packaged installer from the tag; put it on the **beta** channel; after sign‑off, promote to **stable** and distribute.
- [ ] **Android:** build the signed `.apk`/bundle (signing key stays **out** of the repo); upload to the internal track; staged rollout to production.

**After**
- [ ] Smoke‑test production of each shipped component.
- [ ] Mark the Jira **fixVersion released**; move its stories to Released.
- [ ] Announce (release notes to users/stakeholders).
- [ ] Watch for a defined window; if broken → **hotfix** branch + PATCH release, or roll back (redeploy previous VBCS snapshot / previous installer).

---

## 8. Operations for EquipRite

- **Desktop/Android are installed** → you need an **update story**: a visible version, a changelog users can read, and ideally the **self‑update** you already built for Android. Add "check for updates" to the desktop app over time.
- **Support channel:** a place users report issues; triage into Jira bugs with the **Record + technical trace + transcript** evidence you just built (that feature is, in effect, your bug‑report pipeline — lean into it).
- **Monitoring:** for the VBCS/Fusion calls, keep an eye on error rates; the technical‑trace feature already captures failing web‑service calls per test — the same idea (capture failures with context) is what production monitoring does at scale.
- **Post‑mortems:** when something breaks in prod, write a short blameless note (what, impact, cause, fix, prevention). Three sentences is fine.

---

## 9. "Start here" — adopt in this order (highest payoff first)

You don't need all of this at once. In order:

1. **Create `main`** from `claude/equiprite-future`; protect it (PR + `npm test` to merge). *→ gives you a stable line.*
2. **Add `CHANGELOG.md`** and start writing an entry per release. *→ you + users finally know what shipped.*
3. **Add `VERSIONS.md`** and settle one version scheme per component (desktop SemVer, Android versionName+code, a suite CalVer). *→ ends the scattered‑versions confusion.*
4. **Tag releases** (`vX.Y.Z`) from now on. *→ you can always reproduce/roll back a build.*
5. **Add CI** (GitHub Actions running `npm test`) and **fix the 3 failing suites + the flake** so green means green. *→ automatic quality gate.*
6. **Use Jira fixVersions** to tie stories to releases; enforce acceptance criteria as DoR and tester‑gaps/criteria as DoD. *→ real release notes + quality.*
7. **Write the release checklist** (section 7) into a reusable Jira release ticket. *→ repeatable, boring, safe releases.*
8. **Add ADRs** for the big decisions already made (VBCS + Electron; the 5‑app structure; local evidence store). *→ the "why" survives.*
9. Later: **feature flags**, **staged desktop channels (alpha/beta/stable)**, **automated changelog/versioning** (Conventional Commits + `standard-version`), **self‑update** for desktop.

Each step is independently useful — do them one per week and in two months EquipRite is run like a real product shop, without a big-bang process rollout.
