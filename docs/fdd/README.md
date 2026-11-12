# FDD library

The functional design documents that **Analyze with AI** reads (Jira stories → a story → ✨ Analyze with AI). They are
kept in git so every user has the same ones — on the app's **data branch**, `claude/equiprite-data`, not on a code branch.

**The data branch.** What the desktop app saves for everyone (this library, and the Application pages: sheets,
screenshots, AI explanations, Jira stories mapped) is committed and pushed to `claude/equiprite-data`, which holds only
that data (no code). The app checks it out next to the code in `<project>/.equiprite-data` (a git worktree, ignored by
the code branch), merges what others pushed before it pushes, and never commits to the code branch — so `git pull` of
the code stays clean. Same paths as below, on that branch. If git cannot set it up (no git, offline at the very first
start), the app says why and saves into the project folder as before; the next start moves that data onto the branch.
See `desktop/lib/dataBranch.js`.

| Path | What |
|---|---|
| `docs/fdd/<id>.<ext>` | the document as uploaded (Word, PDF, HTML, Markdown or text) |
| `webApps/equiprite-next/resources/fdd/library.json` | the library: every FDD, and which one is the **latest** |
| `webApps/equiprite-next/resources/fdd/<id>.json` | that FDD split into its numbered sections (what the AI reads) |

The JSON files ship with the app, so reading works everywhere (desktop app, `npm run serve`, VBCS). Uploading writes
into this project, so it needs the desktop app or `npm run serve` running from a git checkout.

## Upload

- **In the app:** Insights → **FDD library** → choose the file, give a name and version, tick *Make it the latest* and
  *Commit & push to git*, Upload.
- **From a terminal:** `npm run fdd -- upload "EquipRite_FDD_v1.7.docx" --name "EquipRite FDD" --version 1.7 --push`
  (`npm run fdd -- list`, `latest <id>`, `remove <id>`, `outline <id>`, `push`).

Only these FDD paths are committed, on the data branch, and pushed there. Teammates' apps get the FDD at their next
start (or next save); the copies on the code branch are a frozen snapshot from before the data branch.

**Word (.docx) is best:** its Heading 1/2/3 styles give the sections exactly, numbers included. A PDF is read as text
and its headings are found by their numbers (7.2, 7.2.5G), so check the outline on the FDD library page after upload.
Scanned PDFs (images) cannot be read.

## How the analysis uses it

The AI analysis starts on the **latest** FDD; the selector on the analysis lets you switch to any other. For a story it
reads the sections the story names (its `FDD Section: 7.2, 7.2.5G` line, with their subsections; the closest section
when the exact number is not in the document; `BR-012` / `INT-03` style ids where they are mentioned), then the few
sections whose words best match the story. The analysis cites them as `[FDD 7.2.5]` and adds an **FDD check**: what
the FDD requires that the story or its acceptance criteria miss or contradict. The chips under the analysis show
exactly which sections were read; click one to see its text.

> **Confidentiality:** anything committed here is visible to everyone who can read this repository. Check who that is
> before you push a client's FDD.
