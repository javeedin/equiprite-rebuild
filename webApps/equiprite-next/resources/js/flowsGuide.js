define([], function () {
  'use strict';

  // "How it works" (Build.Rite, flows/insights flows page): every flow of the team's tools, step by step — who does each
  // step (you, the AI, the agent, the app, git, Jira), its side paths, and where what it makes is kept. Data only; keep it
  // true to the code (desktop/lib/issues.js, codeFix.js, pages.js, fdd.js, dataBranch.js; the Jira, minutes and
  // follow-ups screens).

  var ACTORS = { you: 'You', ai: 'AI', agent: 'Agent', app: 'The app', git: 'Git', jira: 'Jira' };
  var LEGEND = [
    { id: 'you', label: 'You', about: 'a person clicks or types' },
    { id: 'ai', label: 'AI', about: 'the AI chosen in AI settings' },
    { id: 'agent', label: 'Agent', about: 'works on its own, after approval' },
    { id: 'app', label: 'The app', about: 'Build.Rite does it' },
    { id: 'git', label: 'Git', about: 'branches, commits, pull requests' },
    { id: 'jira', label: 'Jira', about: 'the record of the work' }
  ];
  var LINKS = [
    { name: 'Jira', what: 'The backlog is read from it; issues are created there and get a comment at each step.' },
    { name: 'The AI', what: 'Write-ups, analyses, code changes, screenshots read — the one chosen in AI settings (Claude Code on your subscription, or an API key).' },
    { name: 'Microsoft 365', what: 'Approval emails and standup minutes are sent from your mailbox (Mail.Send). Reading replies needs Mail.Read.' },
    { name: 'Git', what: 'Code changes: your branch (Code fix), a branch per issue with its pull request (Issues), and the data branch for what the app saves.' }
  ];

  var FLOWS = [
    {
      id: 'issues', title: 'Issues', kicker: 'From a bug report to a reviewed fix', open: 'issues',
      who: 'Anyone logs an issue; an approver approves it (you, for now).',
      steps: [
        { label: 'Log it', actor: 'you', note: 'its page, bug / enhancement / change, what is wrong, screenshots — or its Jira key' },
        { label: 'Write it up', actor: 'ai', note: 'title, summary, steps, expected, actual, impact, its questions — you can edit it' },
        { label: 'Analyze', actor: 'ai', note: 'reads the page\'s code and the FDD: a verdict; for a fix on the page, the exact change, checked, the issue\'s number in a comment at each change' },
        { label: 'Send for approval', actor: 'you', note: 'in the app, and an approval email with the change' },
        { label: 'Approve', actor: 'you', note: 'or reject with a reason; a change altered after it was sent cannot be approved' },
        { label: 'Apply change', actor: 'agent', note: 'branch fix/<KEY> in a folder apart: the related tests before and after, a commit with the key, pushed' },
        { label: 'Pull request', actor: 'git', note: 'open it, review it, merge it' },
        { label: 'Close', actor: 'you', note: 'once merged' }
      ],
      branches: [
        { label: 'Not a fix on this page', steps: [{ label: 'Fix elsewhere · Works as designed · Out of scope', actor: 'ai', note: 'with where, the FDD it quotes, or how to handle it' }, { label: 'Triaged', actor: 'app' }, { label: 'Close', actor: 'you' }] },
        { label: 'Needs information', steps: [{ label: 'Answer its questions', actor: 'you' }, { label: 'Ask again', actor: 'ai' }] },
        { label: 'Rejected', steps: [{ label: 'Reject, with why', actor: 'you' }, { label: 'Reopen', actor: 'you' }] },
        { label: 'The code moved on, or a test breaks', steps: [{ label: 'Not committed, said why', actor: 'agent' }, { label: 'Analyze again', actor: 'ai' }] }
      ],
      kept: ['On this PC: issues.json and the screenshots', 'Shared with everyone: the data branch (issues/)', 'Jira: the issue, and a comment at each step', 'Code: the branch fix/<KEY> and its pull request'],
      notes: ['Your own code folder and the running app are never changed by the agent.', 'Approving by replying to the email comes once your admin grants Mail.Read; approve in the app meanwhile.', 'Every step is on the issue\'s History: what, who, when.']
    },
    {
      id: 'codefix', title: 'Code fix', kicker: 'A quick change to one page, in your own folder', open: 'app-pages', openLabel: 'Application pages → a page → Code fix',
      who: 'Developers, on a page they know.',
      steps: [
        { label: 'Ask', actor: 'you', note: 'fix a bug / enhance / change, what to do, screenshots' },
        { label: 'Propose', actor: 'ai', note: 'reads the page\'s complete code: the analysis, the exact change, the checks (asked once more if an edit does not fit)' },
        { label: 'Preview', actor: 'app', note: 'before and after screenshots, the change only in the app\'s built copy for a moment' },
        { label: 'Approve and apply', actor: 'you', note: 'git pull first, the related tests before, the files written, the tests after' },
        { label: 'Commit & push', actor: 'you', note: 'or Undo: the files exactly as they were' }
      ],
      branches: [
        { label: 'Not right', steps: [{ label: 'Ask again, with what to change', actor: 'you' }, { label: 'Propose', actor: 'ai' }] },
        { label: 'Something broke', steps: [{ label: 'A new failure shown', actor: 'app' }, { label: 'Undo', actor: 'you' }] }
      ],
      compare: 'Code fix changes your own folder at once. Issues puts the fix on a branch of its own with a pull request, for review.',
      kept: ['On this PC: code-fixes.json (and the files before, for Undo)', 'Shared: the change history on the data branch (code-history/) once applied', 'Code: your branch, when you commit'],
      notes: ['Old EquipRite is kept unchanged by agreement: a change there is warned (⚠) and its guard test runs with the fix.', 'Change history · all pages: who asked, who approved, the tests, the commit.']
    },
    {
      id: 'pages', title: 'Application pages', kicker: 'Every VB page, explained', open: 'app-pages',
      who: 'Everyone: business analysts, developers, testers.',
      steps: [
        { label: 'Scan the code', actor: 'app', note: 'every page of Old, New, Next, Mobile and Future' },
        { label: 'Technical sheet', actor: 'app', note: 'features, business logic (chains, modules), integrations (REST, BI reports), links' },
        { label: 'Screenshots', actor: 'app', note: 'captured in a hidden window, or uploaded; several per page' },
        { label: 'Explain with AI', actor: 'ai', note: 'what the page is for, how people use it, its logic' },
        { label: 'Map Jira stories', actor: 'you', note: 'one sheet, many stories' },
        { label: 'Page map · Global map', actor: 'app', note: 'where it is opened from, where it goes; the whole app' },
        { label: 'Page code', actor: 'app', note: 'its files, read only, with find' }
      ],
      kept: ['Shared with everyone: the data branch (resources/pages: the catalog, sheets, screenshots)'],
      notes: ['Jira analyses read the sheets of the pages mapped to the story.', 'Code fix and Issues start from a page here.']
    },
    {
      id: 'jira', title: 'Jira stories and AI analysis', kicker: 'The backlog, read and analysed', open: 'jira',
      who: 'Product owners, analysts, leads.',
      steps: [
        { label: 'Connect Jira', actor: 'you', note: 'the site, your email and an API token, kept on this PC' },
        { label: 'The backlog', actor: 'jira', note: 'stories by sprint, epic, release, person; quality checks' },
        { label: 'A story', actor: 'app', note: 'all its activity: comments, history, work log, attachments' },
        { label: 'Analyze with AI', actor: 'ai', note: 'the story, its activity, the FDD sections it names, the sheets of its pages' },
        { label: 'Saved', actor: 'app', note: 'opens again without asking the AI; an AI icon in the lists' },
        { label: 'Chat · several together', actor: 'you', note: 'follow-up questions; Analyze N with AI in a tab of its own' }
      ],
      kept: ['On this PC: the analyses (ai-analyses.json)', 'Jira: read only from here (Issues writes to it)']
    },
    {
      id: 'fdd', title: 'FDD library', kicker: 'The functional design the AI reads', open: 'fdd-library',
      who: 'Whoever owns the FDD.',
      steps: [
        { label: 'Upload', actor: 'you', note: 'Word, PDF, HTML, Markdown or text, with its version' },
        { label: 'Split into sections', actor: 'app', note: 'by its numbered headings (7.2, 7.2.5G)' },
        { label: 'Make it the latest', actor: 'you', note: 'or pick another FDD for one analysis' },
        { label: 'Read by the AI', actor: 'ai', note: 'Jira analyses and Issues take the sections that match' }
      ],
      kept: ['Shared with everyone: the data branch (docs/fdd and resources/fdd)']
    },
    {
      id: 'minutes', title: 'Standup minutes', kicker: 'The daily standup, written down', open: 'minutes',
      who: 'Whoever runs the standup.',
      steps: [
        { label: 'The meeting', actor: 'you', note: 'its header and attendees' },
        { label: 'Lines', actor: 'you', note: 'tied to a story or general, each with its next action; voice to text' },
        { label: 'Format by AI', actor: 'ai', note: 'tidied up' },
        { label: 'Send', actor: 'app', note: 'by email or to Teams' }
      ],
      kept: ['On this PC: minutes.duckdb']
    },
    {
      id: 'followups', title: 'Follow-ups', kicker: 'Chasing stories', open: 'followups',
      who: 'Leads and analysts.',
      steps: [
        { label: 'Copy to follow-up', actor: 'you', note: 'from a Jira page' },
        { label: 'Save', actor: 'app', note: 'title, scope, recipients, when, the stories' },
        { label: 'Send and track', actor: 'you', note: 'by email' }
      ],
      kept: ['On this PC (DuckDB)']
    },
    {
      id: 'data', title: 'Shared data: the data branch', kicker: 'How everyone sees the same things', open: '',
      who: 'Behind the scenes, for everyone.',
      steps: [
        { label: 'Something saved', actor: 'app', note: 'a sheet, screenshot, FDD, issue, a code change\'s history' },
        { label: 'Commit', actor: 'git', note: 'on claude/equiprite-data, in <project>/.equiprite-data' },
        { label: 'Merge others\'', actor: 'git', note: 'before each push; a sheet, the catalog or the library merged by what it is' },
        { label: 'Push', actor: 'git', note: 'to GitHub' },
        { label: 'Everyone\'s app', actor: 'app', note: 'gets it at start, at Refresh, at each save' }
      ],
      kept: ['The data branch: data only, no code'],
      notes: ['The app never commits to a code branch, so your git pull of the code stays clean.', 'If git cannot reach it, the app says why and keeps the data in the project folder until it can.']
    },
    {
      id: 'ai', title: 'The AI', kicker: 'One choice, used everywhere', open: '',
      who: 'Set once on each PC.',
      steps: [
        { label: 'Choose it', actor: 'you', note: 'AI settings: Claude Code (your subscription), Claude API key, OpenAI, Gemini, OCI or OpenAI-compatible' },
        { label: 'Every flow uses it', actor: 'ai', note: 'write-ups, analyses, explanations, code changes — screenshots too' }
      ],
      notes: ['Long answers (code changes) get up to 16,000 tokens and 6 minutes.', 'Keys stay on this PC, encrypted; nothing goes to git.']
    }
  ];

  function withSteps(list) { return (list || []).map(function (s, i, a) { return Object.assign({ n: String(i + 1), last: i === a.length - 1, actorLabel: ACTORS[s.actor] || s.actor }, s); }); }

  return {
    ACTORS: ACTORS,
    LEGEND: LEGEND,
    LINKS: LINKS,
    FLOWS: FLOWS.map(function (f) {
      return Object.assign({}, f, { steps: withSteps(f.steps), branches: (f.branches || []).map(function (b) { return Object.assign({}, b, { steps: withSteps(b.steps) }); }),
        kept: f.kept || [], notes: f.notes || [], compare: f.compare || '', openLabel: f.openLabel || '' });
    })
  };
});
