# Part 1 — The lifecycle phases, in detail

This walks every phase of building a product, from the first idea to retiring old versions. For each phase: **what happens, who owns it, the inputs, the outputs (artifacts), and how you know it's done.**

A phase is not a date on a calendar — in Agile you pass through most of these *every sprint*, at small scale. Think of them as the activities, not a one‑time waterfall.

---

## Phase 0 — Discovery / Ideation

**Goal:** be sure there's a real problem worth solving before you spend money building.

- **Owner:** Product Manager (PM), with founders/stakeholders.
- **Activities:**
  - Identify the **problem** and the **users/personas** who have it.
  - **Market & competitor** scan — does something already solve this? Why would anyone switch?
  - **User research** — interviews, surveys, watching people work today.
  - Shape a **vision** and the **value proposition** (who, what pain, what gain).
  - A rough **business case** — size of the opportunity vs. cost to build.
- **Outputs:** a problem statement, personas, a vision/one‑pager, maybe a lightweight business case.
- **Done when:** you can state, in one sentence, *who* has *what* problem and *why your solution is worth building now* — and a decision‑maker agrees.

> Skipping this is the #1 cause of wasted builds: teams build a thing beautifully that nobody needed.

---

## Phase 1 — Requirements / Product definition

**Goal:** write down *what* to build precisely enough that engineering can build it and everyone agrees what "done" means.

- **Owner:** PM / Product Owner (PO); engineering and design review.
- **Activities:**
  - Write a **PRD** (Product Requirements Document): problem, goals, **non‑goals**, target users, scope, success metrics, constraints.
  - Break scope into **Epics → User Stories**. A user story is a user‑visible slice: *"As a <role>, I want <capability> so that <benefit>."*
  - Add **acceptance criteria** to each story — the checkable conditions for "it works" (often Given/When/Then).
  - For complex functional areas, write an **FDD/FSD** (Functional Design Document) — the detailed behaviour, screen by screen. (You already do this in `docs/fdd-v2`.)
  - Define **success metrics** up front (e.g. "80% of requests approved within 1 day").
- **Outputs:** PRD, FDD(s), a set of stories with acceptance criteria, success metrics.
- **Done when:** stories meet the **Definition of Ready** (clear, estimable, testable, no blocking unknowns).

**Why non‑goals matter:** explicitly listing what you will *not* do this release is how you prevent scope creep and arguments later.

---

## Phase 2 — Design

Two different designs happen here. Don't confuse them.

### 2a. Product / UX design
- **Owner:** Product Designer / UX.
- **Activities:** information architecture, user flows, **wireframes → mock‑ups → interactive prototypes**, usability testing, a **design system** (reusable components, colours, type) so the product stays consistent.
- **Outputs:** flows, mock‑ups (Figma etc.), a design spec / handoff, design‑system components. (Your `docs/redesign` and `docs/next-redwood-screens.md` are exactly this.)

### 2b. Technical / architecture design
- **Owner:** Tech Lead / Architect / senior engineers.
- **Activities:**
  - Decide the **architecture** (components, data model, APIs, integrations, security, scaling).
  - Record significant decisions as **ADRs** (Architecture Decision Records) — one short file per decision: *context → decision → consequences → alternatives considered*.
  - Plan **non‑functional requirements**: performance, security, accessibility, reliability, cost.
- **Outputs:** an architecture doc / diagrams, ADRs, data model, API contracts.
- **Done when:** engineers can start building without large open questions, and the big trade‑offs are written down (not just in someone's head).

> **ADR example (keep them this short):**
> *Title:* Use Oracle VBCS for the web tier.
> *Context:* Must integrate with Oracle Fusion; small team; low‑code speeds delivery.
> *Decision:* Build the web apps in VBCS; wrap in Electron for desktop.
> *Consequences:* Fast UI delivery; tied to Oracle's component model; desktop packaging needed for local file/record features.
> *Alternatives:* React SPA + custom backend (more control, slower to build).

---

## Phase 3 — Planning

**Goal:** turn a pile of requirements into a sequence the team can actually execute.

- **Owner:** PM/PO (priority) + Engineering Manager/Team (capacity & sizing).
- **Activities:**
  - Maintain a **roadmap** — themes/outcomes over the next quarters (often **Now / Next / Later**, not hard dates).
  - Maintain and order the **product backlog**.
  - **Estimate** stories (story points or t‑shirt sizes) in backlog refinement/grooming.
  - **Sprint planning:** pick the top of the backlog that fits the team's capacity (**velocity**) into the next sprint, with a **sprint goal**.
- **Outputs:** roadmap, ordered backlog, a planned sprint with a goal.
- **Done when:** the team has a committed, achievable sprint and everyone knows the goal.

**Prioritisation frameworks** you'll hear: **MoSCoW** (Must/Should/Could/Won't), **RICE** (Reach × Impact × Confidence ÷ Effort), **Value vs. Effort** 2×2, **WSJF** (used in SAFe). Use any one consistently.

---

## Phase 4 — Development (Build)

**Goal:** implement the stories as working, reviewed, integrated code.

- **Owner:** Developers.
- **Activities & good practices:**
  - Work on a **branch** per story/feature (see Part 2 for branching models).
  - Follow **coding standards** and a **style guide**; keep changes small and focused.
  - Write **tests alongside the code** (unit tests at least).
  - Open a **Pull/Merge Request**; get a **code review** from a peer.
  - **Continuous Integration (CI)** runs on every push: build + lint + tests must pass before merge.
  - Keep the main branch **always releasable**.
- **Outputs:** merged code, passing CI, updated tests and docs.
- **Done when:** code is reviewed, CI is green, acceptance criteria are met, and it's merged to the mainline.

**Quality gates in the build phase:** lint/format, type‑checks, unit tests, a minimum code‑coverage bar, security/dependency scan (SAST, `npm audit`/Dependabot). These run automatically so humans don't have to remember.

---

## Phase 5 — Testing / QA

**Goal:** confirm the software does what the stories say and didn't break anything else.

- **Owner:** QA engineers and developers (in modern teams, quality is everyone's job).
- **The test pyramid** (lots of cheap fast tests at the bottom, few slow ones at the top):

```
        /\      End‑to‑end / UI tests   (few — slow, brittle, high value)
       /  \     Integration tests       (some — components together)
      /____\    Unit tests              (many — fast, pinpoint failures)
```

- **Kinds of testing:** unit, integration, **end‑to‑end (E2E)**, regression, **UAT (User Acceptance Testing)** by real users/stakeholders, plus non‑functional: performance/load, security/pen‑test, accessibility, compatibility.
- **Environments:** tests run in CI and in a **test/QA environment**; UAT often in **staging** (a production‑like environment).
- **Outputs:** test results, a test report, defects logged as bugs, a UAT sign‑off.
- **Done when:** the release's tests pass, no open blocker/critical bugs, and UAT is signed off.

> Your repo already has a real test suite (`npm test`, the `*.e2e.js` suites). That's the backbone of this phase — keep every new feature adding tests, and keep the suite green as the gate to release.

---

## Phase 6 — Release management

**Goal:** decide exactly *what* ships, label it, and prepare it for deployment. (This is the hinge everything else swings on — Parts 2 and 3 are all about it.)

- **Owner:** Release Manager / PM / Tech Lead (a "release captain" rotates in small teams).
- **Activities:**
  - **Scope the release:** which merged stories/fixes are in; freeze it (a **code freeze** / **release branch**).
  - Assign a **version number** (SemVer — Part 2).
  - Write **release notes / CHANGELOG** (human‑readable: features, fixes, breaking changes).
  - Run a **release checklist** (tests green, docs updated, migration ready, rollback known).
  - **Tag** the exact commit in git (e.g. `v1.4.0`).
  - Decide the **rollout** (all at once, canary, phased) and the **rollback** plan.
- **Outputs:** a tagged, versioned, release‑noted build ready to deploy.
- **Done when:** the release is approved per your governance (sign‑offs) and the artifact is built and stored.

**Release types** you'll use: **major** (big/breaking), **minor** (new features), **patch** (bug fixes), **hotfix** (urgent prod fix), and pre‑releases: **alpha → beta → release candidate (RC) → GA (general availability)**.

---

## Phase 7 — Deployment

**Goal:** get the released artifact running where users are, safely.

- **Owner:** DevOps / Platform engineers (or whoever owns the pipeline).
- **Activities:**
  - **Promote** the build through environments: **dev → test → staging → production** (the *same* artifact moves up; you don't rebuild per environment).
  - Use a **CD pipeline** to deploy (ideally one click or automatic).
  - Run **database migrations** in the right order; keep them backward‑compatible.
  - Apply a **rollout strategy:** big‑bang, **rolling**, **blue‑green**, or **canary** (Part 3).
  - **Smoke‑test** production after deploy.
- **Outputs:** the new version live; deployment record.
- **Done when:** production is on the new version, smoke tests pass, and monitoring is clean.

---

## Phase 8 — Operations / Maintenance

**Goal:** keep the live product healthy and users unblocked.

- **Owner:** SRE/Ops + on‑call engineers + Support.
- **Activities:**
  - **Monitoring & observability:** logs, metrics, traces, uptime, alerts (so you find out before users do).
  - **Incident management:** severity levels, on‑call, mitigation, **blameless post‑mortems**.
  - **Support:** a channel for user issues, triage into bugs.
  - **Maintenance:** patch security issues, upgrade dependencies, pay down **technical debt**.
  - Meet your **SLAs/SLOs** (uptime, response time).
- **Outputs:** dashboards, incident reports/post‑mortems, patched releases.
- **Done when:** (never — it's continuous), but each incident ends with a post‑mortem and follow‑up actions.

---

## Phase 9 — Feedback & iteration

**Goal:** learn whether what you shipped actually helped, and feed that back to Discovery.

- **Owner:** PM, with data/analytics.
- **Activities:** track the **success metrics** defined in Phase 1; product analytics (usage, funnels, retention); collect user feedback (NPS, interviews, support themes); run **A/B tests** for changes where it matters.
- **Outputs:** metric movement, insights, new backlog items — the loop closes back to Phase 0.
- **Done when:** you've decided what to do next *based on evidence*, not opinion.

---

## Phase 10 — Sunset / End‑of‑Life

**Goal:** retire old versions or whole products responsibly.

- **Activities:** publish **deprecation** notices and timelines; a **support matrix** (which versions get fixes); migration paths; data export/retention; finally decommission.
- **Outputs:** EOL announcement, migration guide, archived data.
- **Done when:** users are migrated and the old thing is safely switched off.

---

## How this looks in one sprint (the realistic, compressed version)

For a small team you don't do these as giant sequential stages — you do a little of each, every two weeks:

1. **Sprint planning** (Mon, week 1): pick stories (already refined with acceptance criteria), set the sprint goal.
2. **Daily:** build on feature branches, PRs, code review, CI green, merge to main. Write tests with the code.
3. **Throughout:** QA/test the merged work in the test environment; fix bugs.
4. **Backlog refinement** (mid‑sprint): size and clarify upcoming stories (feeds next sprint's planning).
5. **End of sprint:** **sprint review** (demo to stakeholders) + **retrospective** (how to improve).
6. **Release** when the increment is worth shipping (could be every sprint, or on a release train): version it, tag, release notes, deploy, smoke test.
7. **Operate & measure** what's live; feed learnings into the next planning.

Parts 2–4 give you the mechanics (versions, environments, roles); Part 5 turns it into EquipRite's exact SOP.
