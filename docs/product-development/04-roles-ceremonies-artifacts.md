# Part 4 — Roles, ceremonies and artifacts

Who does what, the recurring meetings, and the documents each phase produces. In a big company these are separate people; in a small team **one person wears several hats** — the *functions* still need doing.

---

## 1. Roles (functions, not necessarily headcount)

| Role | Owns | In a 1–3 person team… |
|------|------|------------------------|
| **Product Manager (PM)** | the *why/what*: vision, roadmap, priorities, success metrics | the founder/you |
| **Product Owner (PO)** | the backlog day‑to‑day, acceptance criteria, accepts stories | often same as PM |
| **Engineering Manager / Tech Lead** | delivery, architecture, standards, unblocking | the senior dev / you |
| **Developers** | build, test, review each other's code | you (+ Claude as pair) |
| **QA Engineer** | test strategy, test automation, quality gates | shared by the devs |
| **Designer (UX/UI)** | flows, mock‑ups, design system | you / contractor |
| **DevOps / SRE** | CI/CD, environments, monitoring, releases | whoever set up the pipeline |
| **Support / CS** | user issues, triage to bugs | you, early on |
| **Security / Compliance** | risk, data protection, audits | brought in when needed |

A useful tool when hats are shared: a **RACI** per activity — who is **R**esponsible, **A**ccountable, **C**onsulted, **I**nformed. Even solo, writing "who decides releases" prevents confusion once you add people.

---

## 2. Scrum ceremonies (the recurring meetings)

If you run Scrum, these five events give the rhythm. Keep them short; skip the theatre, keep the purpose.

| Ceremony | When | Purpose | Output |
|----------|------|---------|--------|
| **Backlog refinement (grooming)** | ~weekly | clarify & estimate upcoming stories so they're *Ready* | a refined, estimated top‑of‑backlog |
| **Sprint planning** | start of sprint | pick what fits capacity; set the **sprint goal** | the sprint backlog |
| **Daily stand‑up** | daily, 15 min | sync: did / will do / blockers | surfaced blockers |
| **Sprint review** | end of sprint | demo the increment to stakeholders; get feedback | accepted work, feedback |
| **Retrospective** | end of sprint | inspect how the team worked; one or two improvements | action items |

**Kanban** drops the fixed sprint and instead runs a board (To Do → In Progress → Review → Done) with **WIP limits**, continuous refinement, and metrics like **cycle time** and **throughput**. Many teams do **Scrumban**: Kanban board + a light planning/retro rhythm.

---

## 3. The board and its columns

Whatever the method, work flows across a board. A common set of states (map these to your Jira workflow):

```
Backlog → Ready → In Progress → In Review → In Test → Done → Released
```

- **Ready** = meets the Definition of Ready.
- **Done** = meets the Definition of Done.
- **Released** = actually shipped in a version (ties the story to a `fixVersion`).

### Definition of Ready (DoR) — a story may be started when:
- the user story and acceptance criteria are clear and testable,
- dependencies are known/unblocked,
- it's small enough to finish in a sprint,
- it's estimated.

### Definition of Done (DoD) — an item is finished when:
- acceptance criteria met,
- code reviewed and merged,
- tests written and passing (and coverage not dropped),
- docs/changelog updated,
- deployed to at least the test environment,
- no new critical/blocker bugs.

Writing DoR/DoD once and enforcing them is one of the highest‑leverage things a team can do for quality.

---

## 4. The artifacts (documents), by phase

| Phase | Artifact | One‑line purpose |
|-------|----------|------------------|
| Discovery | **Vision / one‑pager** | the problem, user, and value in a page |
| Discovery | **Personas, market/competitor notes** | who we serve and the landscape |
| Requirements | **PRD** | what to build & why; goals, non‑goals, metrics |
| Requirements | **FDD/FSD** | detailed functional behaviour |
| Requirements | **User stories + acceptance criteria** | the executable units of scope |
| Design | **Wireframes / mock‑ups / prototype** | what the user sees |
| Design | **Design system** | reusable UI components & tokens |
| Design | **Architecture doc + ADRs** | how it's built; key decisions |
| Planning | **Roadmap** | direction over quarters |
| Planning | **Backlog** | ordered queue of work |
| Build | **Coding standards / style guide** | consistency |
| Build | **Pull requests + reviews** | change + peer check |
| Test | **Test plan / test cases** | what we verify |
| Test | **UAT sign‑off** | stakeholder acceptance |
| Release | **CHANGELOG / release notes** | what changed per version |
| Release | **Release checklist** | repeatable release steps |
| Deploy | **Runbook** | how to deploy/operate/recover |
| Operate | **Monitoring dashboards** | health at a glance |
| Operate | **Incident report / post‑mortem** | what broke, why, prevention |
| Operate | **Support matrix** | which versions are supported |
| Sunset | **Deprecation / EOL notice + migration guide** | how users move off |

You don't need all of these on day one. The **starter set** for a small product: vision one‑pager, PRD/FDD per feature, stories with acceptance criteria, ADRs for big decisions, a CHANGELOG, a release checklist, and a runbook. Grow the rest as the team and user base grow.

---

## 5. Governance and quality gates

"Governance" just means the **agreed gates a change must pass** — automated where possible:

- **Branch protection:** can't push straight to `main`; PR + review + green CI required.
- **Quality gates in CI:** lint, type‑check, tests, coverage threshold, security/dependency scan.
- **Release approvals:** who signs off before prod (PM/QA/security as your policy requires).
- **Change management:** for regulated/enterprise contexts, a record of what changed, approved by whom, when (your tags + CHANGELOG + PR history already provide most of this).
- **Compliance/security:** data protection (GDPR etc.), access control, audit logs, secret management — scoped to what your product and customers require.

The goal of governance is **not** bureaucracy; it's making "the safe way" also "the easy, automatic way", so quality doesn't depend on anyone remembering.
