# Part 2 — Versioning and branching

This is the part most small teams get wrong, and it's the one you asked about directly ("how to manage versions, releases"). Two linked topics:

1. **Version numbers** — how you *name* each release so humans and machines understand it.
2. **Branching** — how you organise work in git so you can build the next thing while keeping what's live stable.

---

## 1. Versioning schemes

A version is a **promise about compatibility and a pointer to an exact build**. Two common schemes:

### Semantic Versioning (SemVer) — the default for products and libraries

Format: **`MAJOR.MINOR.PATCH`**, e.g. `2.4.1`.

| Part | Bump it when… | Example |
|------|---------------|---------|
| **MAJOR** | You make a **breaking change** (existing behaviour/APIs change; users must do something to upgrade) | `2.0.0` |
| **MINOR** | You **add features** in a backward‑compatible way | `2.4.0` |
| **PATCH** | You make **backward‑compatible bug fixes** only | `2.4.1` |

Rules that matter:
- Start at `0.1.0` while pre‑1.0 (anything may change); cut **`1.0.0`** when you declare the product stable/"GA".
- Bumping a higher part **resets lower parts** (after `2.4.1`, the next feature release is `2.5.0`, not `2.4.2`).
- **Pre‑release** suffixes for builds that aren't final: `1.4.0-alpha.1`, `-beta.2`, `-rc.1`. They sort *before* the final `1.4.0`.
- **Build metadata** can be appended with `+`, e.g. `1.4.0+20260131.sha.a1b2c3` (ignored for precedence).

### Calendar Versioning (CalVer) — good for apps shipped on a time cadence

Format based on the date, e.g. **`YYYY.MM.PATCH`** (`2026.02.0`) or `YY.MM`. Oracle, Ubuntu, and many SaaS apps use CalVer because "which version is newer / how old is mine" is obvious.

> **Your repo already mixes both:** root `package.json` is `2510.0.3` (CalVer‑ish: 25‑10), the desktop app is `0.1.0` (SemVer), the Android app uses `versionName 1.1` + `versionCode 2`. That's fine *as long as it's intentional and documented* — Part 5 proposes one clear scheme per shippable artifact.

### Mobile apps have two numbers
Android/iOS need a **human version** (`versionName`, e.g. `1.1`) **and** a **monotonic integer** (`versionCode`, e.g. `2`) that must increase every store upload. You already do this (`desktop/phone-app/version.json`).

### Where the version lives
- One **source of truth** per artifact (e.g. `package.json` `version`), read everywhere else at build time (your desktop app already shows `app.getVersion()`).
- Every release is a **git tag** on the exact commit: `v1.4.0`.
- The tag, the artifact, and the CHANGELOG entry all carry the **same** version.

---

## 2. Branching models

A branching model is the team's agreement on **what branches exist, what each is for, and how code flows to production.** Pick ONE and write it down. Three mainstream options, simplest to most structured:

### A. Trunk‑Based Development (what elite teams do)
- One long‑lived branch: **`main`** (the "trunk"), always releasable.
- Developers merge **small changes daily** via short‑lived branches (hours to a couple of days) behind code review + CI.
- Unfinished features hide behind **feature flags** rather than long branches.
- Releases are **tags** on `main` (optionally short‑lived release branches for stabilisation).
- **Best for:** continuous delivery, small‑to‑mid teams, avoiding merge hell.

```
main  ●───●───●───●───●───●───●      (always green, tag releases here)
         \     \         /
          f1    f2──────/   short-lived feature branches, merged fast
```

### B. GitHub Flow (simplest usable model)
- **`main`** is always deployable.
- Branch per feature/fix → PR → review → CI → merge to `main` → deploy.
- No separate develop/release branches. Tag `main` for releases.
- **Best for:** web apps/SaaS deploying frequently; small teams. (This is the natural fit for EquipRite.)

### C. Git Flow (heaviest; good for versioned/desktop/on‑prem products)
- **`main`** = production (only release commits, each tagged).
- **`develop`** = integration of the next release.
- **`feature/*`** branch off `develop`, merge back.
- **`release/*`** branch off `develop` to stabilise a release, then merge to `main` + `develop`.
- **`hotfix/*`** branch off `main` for urgent prod fixes, merge to `main` + `develop`.
- **Best for:** products with **scheduled releases** and **multiple supported versions** (installed/desktop software, enterprise on‑prem). More ceremony than web SaaS needs.

```
main     ●───────────────●(v1.0)──────────●(v1.1)───●(v1.1.1 hotfix)
                          /                 /         /
release           ──────/           ──────/         /
develop  ●──●──●──●──●──●──●──●──●──●──●──●──●──●──●
            \     /     \        /
             feat        feat
```

### Which to choose
| You are… | Use |
|----------|-----|
| A small team shipping a web/SaaS app continuously | **GitHub Flow** (or trunk‑based) |
| Shipping installed/desktop software on a schedule, supporting old versions | **Git Flow** (release + hotfix branches earn their keep) |
| Many teams, one big product | trunk‑based + release trains |

> **Your current state:** lots of `claude/*` branches and `worktree-agent-*` branches, no tags. That's fine for exploratory building, but it has no "this is production" anchor. Part 5 proposes adopting **GitHub Flow with a `main` branch + release tags**, which gives you a stable line without Git Flow's overhead — while still allowing Git‑Flow‑style **release/** and **hotfix/** branches for the desktop app, which *is* installed software with old versions in the wild.

---

## 3. Tags, hotfixes and supporting old versions

- **Tag every release**: `git tag -a v1.4.0 -m "EquipRite 1.4.0" && git push origin v1.4.0`. A tag is an immutable pointer — you can always check out exactly what a customer is running.
- **Hotfix flow** (urgent production bug): branch from the **tag** of the live version (`git checkout -b hotfix/1.4.1 v1.4.0`), fix, test, bump **PATCH**, tag `v1.4.1`, deploy, then merge the fix back into `main`/`develop` so it isn't lost in the next release.
- **Supporting multiple versions:** keep a **support matrix** (e.g. "we patch the latest two minor versions"). Back‑port critical fixes to each supported line. This matters for installed software (desktop/Android) where users don't all upgrade at once — less so for a web app where everyone's on the one deployed version.

---

## 4. Commit messages and automated changelogs (worth adopting early)

Adopt **Conventional Commits** — a tiny convention that makes history readable and lets tools compute the next version and the changelog automatically:

```
feat(jira): add Record with screen + voice        → triggers a MINOR bump
fix(transcribe): run ffmpeg via shell on Windows   → triggers a PATCH bump
feat(api)!: rename requestNumber to requestId      → "!" = breaking → MAJOR bump
docs: add product-development guide                 → no release
```

Format: `type(scope): summary`, where type ∈ `feat | fix | docs | refactor | test | chore | perf | build | ci`. A `!` or a `BREAKING CHANGE:` footer marks a breaking change. Tools (`standard-version`, `semantic-release`, `changesets`) then:
- read commits since the last tag,
- decide the next SemVer number,
- bump `package.json`,
- generate the `CHANGELOG.md`,
- create the git tag.

You don't have to automate it on day one, but writing commits this way from now costs nothing and pays off the moment you do.
