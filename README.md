# EquipRite data

What the EquipRite desktop app saves for everyone, kept apart from the code (the app commits and pushes here, never
to a code branch):

- `webApps/equiprite-next/resources/pages`: Application pages: every VB page's technical sheet, screenshots, AI
  explanation and the Jira stories mapped to it (`catalog.json`, `sheets/`, `screens/`).
- `docs/fdd` and `webApps/equiprite-next/resources/fdd`: the FDD library: the documents and their outlines.

The app checks this branch out next to the code, in `<project>/.equiprite-data` (a git worktree), and merges what
others pushed before it pushes. Nothing here is code: do not merge this branch into a code branch.
