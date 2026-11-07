# Part 3 — Releases, environments, CI/CD and rollout

How the versioned release from Part 2 actually reaches users, safely and repeatably.

---

## 1. Environments

An **environment** is a complete, isolated place the software runs, with its own data and config. The standard ladder:

| Environment | Who uses it | Purpose | Data |
|-------------|-------------|---------|------|
| **Local / Dev** | each developer | write & run code on your machine | fake/seed |
| **Test / QA / Integration** | QA, automated tests | run the test suite, manual QA | test data |
| **Staging / Pre‑prod / UAT** | stakeholders, UAT users | a production‑like rehearsal; final sign‑off | prod‑like (masked) |
| **Production (Prod)** | real users | the live product | real |

Principles:
- **Build once, promote the same artifact up the ladder.** Don't rebuild per environment — only the *config* (URLs, keys) differs, injected at deploy time.
- **Config lives outside the code** (environment variables, secrets manager) — never hard‑code prod secrets.
- **Staging must mirror production** as closely as possible, or it won't catch prod‑only bugs.

> **EquipRite's environments are a bit special** (Part 5): the web apps deploy to **Oracle VBCS** instances (VBCS has its own dev/stage/prod via its lifecycle), and the **desktop app** runs locally and is distributed as a packaged build. The "environment" ladder still applies — it's just VBCS instances + packaged‑app channels (alpha/beta/stable).

---

## 2. CI/CD — the pipeline that does the boring work reliably

- **CI (Continuous Integration):** on every push/PR, automatically **build + lint + type‑check + test**. Meries to the mainline are blocked unless green. This keeps `main` always releasable and catches breakage in minutes, not at release time.
- **CD (Continuous Delivery):** every green build is **automatically packaged and deployed to a non‑prod environment**, and is *ready* to go to prod with one approval.
- **CD (Continuous Deployment):** the stricter version — every green build goes **all the way to prod automatically**, no human gate. (Only once you trust your tests and monitoring.)

A typical pipeline (what you'd put in GitHub Actions / GitLab CI / Jenkins):

```
push / PR
   └─ CI:   checkout → install → lint → typecheck → unit tests → build → e2e tests → security scan
            (all must pass; PR cannot merge otherwise)
merge to main
   └─ CD:   build artifact (versioned) → deploy to TEST → smoke test
            → (manual approval) → deploy to STAGING → UAT
            → (manual approval + tag) → deploy to PROD → smoke test → notify
```

Tools you'll meet: **GitHub Actions / GitLab CI / Jenkins / Azure DevOps** (pipelines), **artifact registries** (store built versions), **Docker** (package once, run anywhere), **Terraform/Ansible** (infrastructure as code).

---

## 3. The release process (a repeatable checklist)

This is the heart of "release management". Make it a checklist so it's the same every time and anyone can run it.

**Pre‑release**
- [ ] Decide scope; all intended stories merged to the mainline.
- [ ] CI green on the release commit (all tests pass).
- [ ] Version chosen per SemVer; `package.json`/version files bumped.
- [ ] **CHANGELOG / release notes** written (features, fixes, breaking changes, upgrade steps).
- [ ] Docs updated (user docs, API docs, runbook).
- [ ] DB migrations prepared and tested; **backward‑compatible**.
- [ ] Rollback plan written (how to revert; previous version known‑good).
- [ ] Sign‑offs obtained (QA, PM, security if needed).

**Release**
- [ ] Tag the commit: `vX.Y.Z`.
- [ ] Build the artifact(s) from the tag; store them.
- [ ] Deploy to staging; run UAT/smoke tests.
- [ ] Approve → deploy to production with the chosen rollout strategy.

**Post‑release**
- [ ] Smoke‑test production.
- [ ] Watch monitoring/error rates for a defined window.
- [ ] Announce the release (release notes to users/stakeholders).
- [ ] Close the release in the tracker (mark the `fixVersion` released in Jira).
- [ ] If anything's wrong → **rollback** (below), then post‑mortem.

**Release cadence options:**
- **Continuous:** ship each change as it's ready (web SaaS).
- **Release train:** ship on a fixed schedule (e.g. every 2 weeks); whatever's ready gets on the train, the rest waits for the next.
- **Milestone:** ship when a set of features is complete (common for installed/desktop software).

---

## 4. Rollout strategies (how new code reaches users)

| Strategy | How | Pro / Con |
|----------|-----|-----------|
| **Big‑bang** | replace everything at once | simple / riskiest — everyone hits new bugs together |
| **Rolling** | update servers a few at a time | no downtime / mixed versions briefly |
| **Blue‑green** | run two identical prod stacks; switch traffic from old (blue) to new (green); keep blue warm | instant switch **and instant rollback** / needs double infra |
| **Canary** | send a small % of users to the new version, watch metrics, then ramp to 100% | catches problems with limited blast radius / needs good metrics + routing |
| **Feature flags** | ship code dark, turn features on gradually (by %/user/segment) | decouples deploy from release; test in prod safely; kill‑switch / flag debt to manage |

For a web app, **canary + feature flags** is the modern default. For installed/desktop/mobile apps, the equivalent is **release channels** (alpha → beta → stable) and **staged store rollouts** (release to 5% of users, then 50%, then 100%).

---

## 5. Rollback and recovery

- **Always know the previous good version** (that's why you tag).
- **Rollback = redeploy the previous artifact** (for installed apps: push the previous version / block the update). Blue‑green makes this instant (switch back to blue).
- **Database migrations are the hard part:** write them **backward‑compatible** (additive first — add columns/tables, deploy code that works with old *and* new, then clean up in a later release). Never make a destructive migration that the previous app version can't run against, or you can't roll back.
- A **feature flag kill‑switch** is often faster than a rollback: turn the bad feature off without redeploying.

---

## 6. Release notes / CHANGELOG (don't skip this)

Keep a `CHANGELOG.md` at the repo root, newest version on top. The widely used format ("Keep a Changelog"):

```markdown
# Changelog

## [1.4.0] - 2026-02-15
### Added
- Jira stories: Record a test (screen video + voice) with a synced transcript.
### Changed
- Transcription setup helper now installs ffmpeg for you.
### Fixed
- Screen recording no longer refused with "Permission denied".
### Breaking
- (none)

## [1.3.0] - 2026-01-20
...
```

This doubles as your user‑facing release notes and your own memory of what shipped when. With Conventional Commits (Part 2 §4) it can be generated automatically.
