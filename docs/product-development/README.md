# How a software product is built, versioned and released

A practical guide to how real product companies take software **from an idea to a maintained product**, and how to run the same discipline at any size — including as a one‑ or two‑person team.

This folder has six parts. Read them in order the first time; after that use them as reference.

| # | File | What it covers |
|---|------|----------------|
| 0 | **README.md** (this file) | The big picture: the two lifecycles, how the pieces fit, the vocabulary |
| 1 | [01-lifecycle-phases.md](01-lifecycle-phases.md) | Every phase in detail: discovery → requirements → design → build → test → release → operate → iterate → sunset |
| 2 | [02-versioning-and-branching.md](02-versioning-and-branching.md) | Version numbers (SemVer/CalVer), git branching models, tags, hotfixes |
| 3 | [03-releases-and-environments.md](03-releases-and-environments.md) | Environments, CI/CD, the release process, rollout strategies, feature flags, rollback |
| 4 | [04-roles-ceremonies-artifacts.md](04-roles-ceremonies-artifacts.md) | Who does what, the meetings (ceremonies), and the documents each phase produces |
| 5 | [05-equiprite-playbook.md](05-equiprite-playbook.md) | The concrete SOP for **this** product (EquipRite): its versions, branches, Jira flow, release checklist |
| 6 | [06-how-oracle-fusion-does-it.md](06-how-oracle-fusion-does-it.md) | How Oracle runs Fusion for thousands of customers — the train, pods, opt-in, upgrade-safe extensibility — and what EquipRite should borrow |

---

## 1. The one idea to hold onto

A product company runs **two lifecycles at once**, turning the same handle:

```
   PRODUCT lifecycle  (the "why" and "what" — never really ends)
   ┌────────────────────────────────────────────────────────────────┐
   │ Discover → Define → Prioritise → … → Measure → Learn → Discover  │
   └───────────────┬────────────────────────────────────────────────┘
                   │ feeds work into
                   ▼
   DELIVERY lifecycle (the "how" — repeats every release/sprint)
   ┌────────────────────────────────────────────────────────────────┐
   │ Design → Build → Test → Release → Operate → (feedback back up)   │
   └────────────────────────────────────────────────────────────────┘
```

- The **product lifecycle** is owned by *product management*: what problem are we solving, for whom, why now, what's worth building, is it working. It is continuous.
- The **delivery lifecycle** (often called the **SDLC** — Software Development Life Cycle) is owned by *engineering*: turning a decided item into working, released, operated software. It repeats on a cadence (every sprint, every release).

Everything else in this guide is detail hung on those two loops. A company's "maturity" is mostly **how reliably and quickly it can go around the delivery loop without breaking things** — which is precisely what versioning, environments, CI/CD and release process give you.

---

## 2. The phases, in one list

The delivery loop, expanded into the phases most companies name explicitly:

1. **Discovery / Ideation** — find a real problem worth solving.
2. **Requirements / Product definition** — write down *what* we're building and how we'll know it's done (PRD, user stories, acceptance criteria).
3. **Design** — UX design (what the user sees) and technical/architecture design (how it's built), captured in design docs and ADRs.
4. **Planning** — turn requirements into a roadmap, a backlog, and sized sprints.
5. **Development (Build)** — write the code, on a branching model, with code review and continuous integration.
6. **Testing / QA** — automated tests (the test pyramid) plus manual/UAT, across environments.
7. **Release management** — decide what ships, give it a version, write release notes, cut a release.
8. **Deployment** — move the built artifact through environments (dev → test → staging → prod) with a rollout strategy and a rollback plan.
9. **Operations / Maintenance** — monitor, support, handle incidents, patch.
10. **Feedback & iteration** — measure usage and outcomes; feed learning back to Discovery.
11. **Sunset / EOL** — eventually retire old versions or the product.

Part 1 covers each in depth.

---

## 3. The methodologies (how teams *sequence* the phases)

The phases are the same; the *order and cadence* differ by methodology:

| Methodology | Idea | Good when | Weakness |
|-------------|------|-----------|----------|
| **Waterfall** | Do the phases once, in strict order (all requirements → all design → all build → all test → release) | Requirements are fixed and well understood (regulated, hardware, fixed‑bid contracts) | Expensive to change; you find out late if you built the wrong thing |
| **Agile – Scrum** | Repeat the phases in short **sprints** (1–4 weeks), shipping a potentially releasable increment each time | Most product software; requirements evolve | Needs discipline (ceremonies, a groomed backlog) |
| **Agile – Kanban** | Continuous flow of work items pulled through stages; no fixed sprints; limit work‑in‑progress | Support, ops, steady streams of small changes | Less rhythm for planning/forecasting |
| **Scrumban** | Scrum's cadence + Kanban's flow | Teams moving from Scrum to continuous delivery | — |
| **SAFe / LeSS** | Scaling frameworks to coordinate *many* teams on one product | Large orgs (50+ engineers) | Heavy; overkill for small teams |

**Rule of thumb:** a small team building a product should run **Scrum or Kanban** (lightweight), with **trunk‑based or GitHub‑flow** branching and **continuous delivery**. Waterfall only for the rare fixed‑scope sub‑project. SAFe only when you genuinely have many teams. Part 4 details the Scrum ceremonies.

---

## 4. The vocabulary you'll keep meeting

| Term | Meaning |
|------|---------|
| **SDLC** | Software Development Life Cycle — the delivery loop (design→build→test→release→operate) |
| **PRD** | Product Requirements Document — *what* to build and why (the "contract" between product and engineering) |
| **FDD / FSD** | Functional Design / Spec Document — detailed functional behaviour (you already keep these in `docs/fdd-v2`) |
| **ADR** | Architecture Decision Record — a short note capturing one significant technical decision and its trade‑offs |
| **Epic / Story / Task** | Work hierarchy: Epic (big outcome) → Story (a user‑visible slice) → Task (a dev step) |
| **Acceptance criteria** | The checkable conditions that say a story is "done" |
| **DoR / DoD** | Definition of Ready (a story is ready to start) / Definition of Done (an item is truly finished) |
| **Backlog** | The ordered list of everything not yet done |
| **Sprint** | A fixed timebox (e.g. 2 weeks) in which a team commits to a set of work |
| **Velocity** | How much a team completes per sprint (used to forecast) |
| **CI / CD** | Continuous Integration (merge + auto‑build + auto‑test often) / Continuous Delivery or Deployment (auto‑ship to an environment) |
| **SemVer** | Semantic Versioning — `MAJOR.MINOR.PATCH` (see Part 2) |
| **Release** | A specific, versioned, shippable build of the product |
| **Environment** | A place the software runs: dev, test, staging, production |
| **Feature flag** | A switch that turns a feature on/off without a new release |
| **Rollback** | Reverting to the previous known‑good release when a new one misbehaves |
| **SLA / SLO** | Service Level Agreement/Objective — the reliability you promise/target |
| **Runbook** | Step‑by‑step instructions to operate or recover a system |
| **Changelog / Release notes** | The human‑readable record of what changed in each version |

---

## 5. The minimum a serious product keeps

No matter how small, a product that's run professionally has these **artifacts living in version control or a tracker** (not in someone's head):

- A **roadmap** (where we're going) and a **backlog** (what's queued), in a tracker like Jira.
- **Requirements** for each feature (PRD/FDD) and **acceptance criteria** on each story.
- **One source of truth for code** (git), with a **branching model** and **code review**.
- **Automated tests** and a **CI pipeline** that runs them on every change.
- A **versioning scheme** and **git tags** marking every release.
- A **CHANGELOG / release notes** for every version.
- Defined **environments** and a **repeatable release process** (ideally automated).
- **Monitoring + a support/incident process** once real users exist.
- **ADRs** for the handful of big technical decisions.

Part 5 maps every one of these onto EquipRite specifically and gives you a checklist to adopt them incrementally.
