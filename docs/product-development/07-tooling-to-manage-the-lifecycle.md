# Part 7 — Software to manage the development lifecycle

**Is there one tool that does everything?** Not really. No single product covers discovery → requirements → design → code → test → release → deploy → operate → support *equally well*. What exists instead is:

- **"Do‑most‑of‑it" platforms** — one vendor that covers the bulk of the lifecycle (plan + code + CI/CD + releases, sometimes more). You can run a whole small company on one of these.
- **Best‑of‑breed stacks** — pick the strongest tool per area and integrate them (what most mature companies actually do).

The right answer for a small team is usually **one platform for the core + 1–3 add‑ons**. For EquipRite specifically there's also an **Oracle‑native** option worth knowing. This file maps the landscape and then recommends.

---

## 1. The categories (map tools to the lifecycle)

The lifecycle (Parts 1–4) needs these capabilities. "One tool for everything" really means "one tool that bundles several of these columns":

| Capability | What it does | Leading tools |
|------------|--------------|---------------|
| **Product discovery / roadmap** | ideas, prioritisation, roadmap | Jira Product Discovery, Aha!, Productboard, Linear |
| **Requirements / docs / knowledge** | PRD, FDD, ADRs, wiki | Confluence, Notion, Google Docs, your repo `docs/` |
| **Work tracking / backlog / sprints** | epics/stories/tasks, boards, sprints | **Jira**, Azure Boards, GitHub Projects, GitLab Issues, Linear, ClickUp, Monday, Asana |
| **Design** | wireframes, mock‑ups, design system | Figma, Adobe XD, Sketch |
| **Source control** | git repos, branches, PRs, review | GitHub, GitLab, Bitbucket, Azure Repos |
| **CI/CD pipelines** | build, test, deploy automatically | GitHub Actions, GitLab CI, Azure Pipelines, Jenkins, CircleCI |
| **Test management** | test cases, runs, UAT sign‑off | Xray / Zephyr (in Jira), TestRail; automation: Playwright, Selenium, Cypress |
| **Artifacts / packages** | store built versions | GitHub Packages, JFrog Artifactory, Nexus |
| **Releases / versioning** | tags, release notes, changelog | GitHub/GitLab Releases, semantic‑release, Changesets |
| **Environments / deploy / IaC** | provision & deploy | Terraform, Ansible, Kubernetes, cloud consoles |
| **Feature flags** | turn features on/off, canary | LaunchDarkly, Unleash, Flagsmith |
| **Monitoring / observability** | logs, metrics, traces, errors | Datadog, New Relic, Grafana, Dynatrace, Sentry |
| **Incident / on‑call / status** | alerting, on‑call, status page | PagerDuty, Opsgenie, Statuspage |
| **Support / ITSM** | user tickets, help desk | Jira Service Management, Zendesk, ServiceNow, Freshdesk |
| **Product analytics / feedback** | usage, funnels, NPS | Amplitude, Pendo, Mixpanel, PostHog |

---

## 2. The "do‑most‑of‑it" platforms

These each bundle many of the columns above under one login/billing — the closest thing to "one tool for the lifecycle":

| Platform | Covers | Strengths | Gaps you'd still fill |
|----------|--------|-----------|------------------------|
| **GitLab** | plan, code, CI/CD, package, release, security scan, basic monitor — *marketed as "the one DevOps platform"* | the single tool that bundles the **most** of the dev lifecycle in one app | deep product mgmt, design, product analytics, full ITSM |
| **GitHub (+ ecosystem)** | Issues + Projects (plan), Repos + PRs (code), **Actions** (CI/CD), Packages (artifacts), **Releases** (versioning), Dependabot/CodeQL (security), Discussions | huge ecosystem, where most open source/dev lives, easy CI/CD | dedicated roadmap/PM, test management, monitoring, ITSM → add‑ons |
| **Azure DevOps** | **Boards** (plan), **Repos**, **Pipelines** (CI/CD), **Artifacts**, **Test Plans** (test mgmt) | the most complete plan→build→test→release in one Microsoft suite | product discovery, design, monitoring (use Azure Monitor), ITSM |
| **Atlassian suite** | **Jira** (track) + **Jira Product Discovery** (ideation) + **Confluence** (docs) + **Bitbucket** (repos+pipelines) + **Compass** (catalog) + **Opsgenie** (on‑call) + **Jira Service Management** (support) + **Statuspage** | the most complete *product+delivery+support* suite when you buy several pieces | it's several products (cost/sprawl); CI/CD (Bitbucket Pipelines) weaker than GitHub/GitLab |

And the heavyweight **enterprise ALM** suites (requirements → test → release with full traceability, used in regulated industries like medical/aerospace/automotive): **Polarion** (Siemens), **IBM Engineering Lifecycle Management / DOORS**, **Jama Connect**, **Codebeamer**, **PTC Windchill/Integrity**. Powerful but heavy and expensive — overkill unless you're regulated.

And the enterprise **SPM/ITSM** platforms that wrap the business side: **ServiceNow**, **Planview**, **Targetprocess** — again, large‑org territory.

---

## 3. The Oracle‑native option (most relevant to EquipRite)

Because EquipRite is **VBCS on Fusion**, Oracle has a purpose‑built lifecycle tool for exactly this stack:

### **Oracle Visual Builder Studio (VB Studio)**
Oracle's DevOps/ALM platform for building and shipping **Fusion SaaS extensions, VBCS apps, JET and APEX apps**. In one product it gives you:
- **Git repositories** (hosted by Oracle),
- **Agile boards + issue tracking** (sprints, stories),
- **CI/CD build pipelines** (build, test, package),
- **Deployment to VBCS / Fusion environments** (dev → test → prod instances),
- **environment management** for your Fusion/VBCS instances.

For the **web‑app half of EquipRite** (the five VBCS apps), VB Studio is the closest to "one tool manages my whole lifecycle", *and* it understands VBCS deployment natively (which GitHub/GitLab don't). (Its predecessor was **Oracle Developer Cloud Service**, now effectively replaced by VB Studio.)

What it **doesn't** cover for you: the **Electron desktop app** and the **Android app** — those are ordinary Node/Electron/Android builds that fit GitHub Actions or GitLab CI better. So even the Oracle‑native path is "VB Studio for the web apps + GitHub for the packaged apps".

---

## 4. The honest truth about "one tool for everything"

- **GitLab** gets *closest* to a single tool for the **engineering** lifecycle (plan→deploy→monitor in one app).
- But **product discovery, design, product analytics, and full customer support/ITSM** almost always live in separate specialist tools (Figma, Amplitude, Zendesk, etc.), because the bundled versions are weaker.
- So in practice even "all‑in‑one" companies run **2–5 tools**. The goal isn't one tool — it's **one tool per area, well integrated**, with the *tracker* (Jira/Boards) as the hub that links everything (a story links to its PR, its build, its release, its deploy).

---

## 5. Recommendation for EquipRite

You already have most of what you need and shouldn't over‑buy. Three sensible configurations, cheapest/simplest first:

### Option A — Pragmatic, mostly what you already have (recommended to start)
- **Jira (project EQP)** — backlog, sprints, releases (fixVersions). *You already use it, Oracle‑connected.*
- **GitHub** — repos, PRs + review, **Actions** for CI (`npm test`), **Releases** + tags for versioning, Dependabot for security. *You're already on git.*
- **Your `docs/` folder** (or Confluence later) — PRD/FDD/ADRs/changelog. *Already there.*
- Add later as needed: **Sentry** (error monitoring, generous free tier), **a feature‑flag lib** (Unleash/Flagsmith, or your own simple flags — you already gate features).
- **Cost:** ~free to low. **Effort:** low — it's mostly turning on CI and tagging releases.

### Option B — Oracle‑native for the web apps
- **Oracle Visual Builder Studio** as the hub for the 5 VBCS apps (git + boards + pipelines + deploy to your Fusion/VBCS instances).
- **GitHub Actions** for the Electron desktop + Android builds.
- Best if you want VBCS‑aware CI/CD and to live inside Oracle's ecosystem.

### Option C — One‑vendor engineering platform
- **GitLab** (or **Azure DevOps**) for plan + code + CI/CD + releases + packages in a single tool, with Jira only if you prefer it for product tracking.
- Best if you want the fewest logins and a single pipeline tool, and don't mind migrating off GitHub.

**My pick for you now:** **Option A** — Jira + GitHub (Actions + Releases) + your `docs/` folder. It covers the entire lifecycle you asked about, costs almost nothing, builds on what you already run, and matches the "Start here" list in Part 5. Introduce **VB Studio** (Option B) when VBCS deployment automation becomes the bottleneck, and specialist tools (Sentry, Amplitude, a status page, Jira Service Management) only when real users create the need.

> Rule of thumb: **adopt a new tool only when the pain of not having it is real.** A two‑person team with Jira + GitHub + a docs folder is running the same lifecycle Oracle runs — the difference is scale and automation, not the number of tools.
