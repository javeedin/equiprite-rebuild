define(['resources/js/jiraBacklog'], (J) => {
  'use strict';

  // One Jira item in Oracle's drawer, as Jira stories (jira-page) and a sprint's tab (jira-sprint-page) both show it: its
  // facts, quality, description, criteria, tester gaps, its whole activity (comments with their screenshots, history and
  // work log, as Jira's Activity shows them), test evidence (Record) and attachments. These are the drawer's binding helpers; each page module takes them as its own ($functions.facts …).
  // None uses `this`: a binding may call a function detached.
  //
  //   helpers          item, drawerOpen, drawerTitle, drawerSub, facts, scoreText, acList, imageUrl, imageNote,
  //                    imageFiles, otherFiles, videos, shots, evidenceText, traceText, traceClass
  //                    recText, recClass, recCount (the lists' icon: a story with recordings on this PC)
  //   closeOnEscape()  Escape closes an open item's drawer by its own Close button (once for the app)

  const EMPTY = { key: '', summary: '', fdd: [], checks: [], gaps: [], comments: [], labels: [], subtaskList: [], attachments: [], bodyImages: [] };
  // The drawers that show an item: Jira stories' and a sprint tab's.
  const DRAWERS = ['#jiraDrawer', '#jspDrawer'];

  let actKept = { k: '', v: null };
  let pagesKept = { k: '', v: [] };
  let choicesKept = { k: '', v: [] };
  const helpers = {
    /** The item open in the drawer, or an empty one. */
    item(rows, key) { return (rows || []).filter((r) => r.key === key)[0] || EMPTY; },
    drawerOpen(rows, key) { return !!key && (rows || []).some((r) => r.key === key); },
    /** The drawer's title and subtitle. */
    drawerTitle(r) { return r && r.key ? r.key + ' ' + r.summary : ''; },
    drawerSub(r) { return r && r.key ? [r.status, r.epicKey ? r.epicKey + ' ' + r.epicName : ''].filter((x) => !!x).join(' · ') : ''; },
    /** The facts under the drawer's title. */
    facts(r) {
      if (!r || !r.key) return [];
      return [
        { k: 'Status', v: r.status || '—' }, { k: 'Type', v: r.type || '—' }, { k: 'Priority', v: r.priority || '—' },
        { k: 'Assignee', v: r.assignee || 'Nobody' }, { k: 'Epic', v: r.epicKey ? r.epicKey + ' ' + r.epicName : '—' },
        { k: 'Release', v: r.release ? r.release + (r.releaseDate ? ' (' + r.releaseDate + ')' : '') : '—' },
        { k: 'Sprint', v: r.sprint ? r.sprint + (r.sprintState ? ' · ' + r.sprintState : '') + (r.sprintEnd ? ' · ends ' + r.sprintEnd : '') : '—' },
        { k: 'Earlier sprints', v: (r.sprintPast || []).length ? r.sprintPast.join(', ') : 'None' },
        { k: 'Due', v: r.due ? r.due + (r.overdue ? ' · overdue' : '') : '—' }, { k: 'FDD', v: (r.fdd || []).join(', ') || '—' },
        { k: 'Updated', v: r.updated ? r.updated + (r.idleDays != null ? ' (' + r.idleDays + ' days ago)' : '') : '—' },
      ];
    },
    /** "4.5 / 5 · 1 check failed". */
    scoreText(r) { return r ? r.score + ' / 5' + (r.checks && r.checks.length ? ' · ' + r.checks.length + (r.checks.length === 1 ? ' check failed' : ' checks failed') : '') : ''; },
    // ── Application pages mapped to a story (resources/pages, kept in git) ──────────────────────────────────────────────
    /** The pages a story is mapped to (catalog entries whose stories hold the key). */
    pagesFor(cat, key) {
      const k = String(key || '').toUpperCase();
      const ck = JSON.stringify([k, (cat || []).length, (cat || []).map((p) => (p.stories || []).indexOf(k) !== -1 ? p.id + (p.sheet ? p.sheet.at : '') : '').join('')]);
      if (pagesKept.k === ck) return pagesKept.v;
      pagesKept = { k: ck, v: k ? (cat || []).filter((p) => (p.stories || []).indexOf(k) !== -1) : [] };
      return pagesKept.v;
    },
    /** The pages to choose from (not mapped yet), the best matches for what is typed, a sheet first. */
    pageChoices(cat, q, key) {
      const k = String(key || '').toUpperCase();
      const s = String(q || '').trim().toLowerCase();
      const ck = JSON.stringify([k, s, (cat || []).length]);
      if (choicesKept.k === ck) return choicesKept.v;
      const ORDER = { vbredwoodapp: 0, equiprite: 1, 'equiprite-next': 2, 'equiprite-mobile': 3, 'equiprite-future': 4 };
      const words = s.split(/\s+/).filter(Boolean);
      const v = (cat || []).filter((p) => (p.stories || []).indexOf(k) === -1 && !p.missing
        && words.every((w) => [p.label, p.id, p.appName].join(' ').toLowerCase().indexOf(w) !== -1))
        .sort((a, b) => (b.sheet ? 1 : 0) - (a.sheet ? 1 : 0) || (ORDER[a.app] - ORDER[b.app]) || String(a.label).localeCompare(String(b.label)))
        .slice(0, 80);
      choicesKept = { k: ck, v: v };
      return v;
    },
    pageThumb(base, p) {
      if (!p || !p.sheet || !p.sheet.screenshot) return '';
      let b = base || ''; if (b && b.charAt(b.length - 1) !== '/') b += '/';
      return b + 'resources/pages/' + p.sheet.screenshot + '?t=' + encodeURIComponent(p.sheet.at || '');
    },
    pageApp(app) { return { vbredwoodapp: 'OLD', equiprite: 'NEW', 'equiprite-next': 'NEXT', 'equiprite-mobile': 'MOB', 'equiprite-future': 'FUT' }[app] || 'VB'; },
    pageMeta(p) {
      if (!p) return '';
      const sh = p.sheet;
      return [p.appName + ' · ' + (p.flow ? p.flow + '/' : '') + p.page, sh ? sh.rest + ' REST · ' + sh.chains + ' chains' + (sh.ai ? ' · explained' : '') : 'no sheet yet',
        (p.stories || []).length > 1 ? 'also ' + (p.stories.length - 1) + ' other ' + ((p.stories.length - 1) === 1 ? 'story' : 'stories') : ''].filter(Boolean).join(' · ');
    },
    pageChoiceMeta(p) {
      return p.appName + ' · ' + (p.flow ? p.flow + '/' : '') + p.page + (p.sheet ? ' · sheet ready' : '') + ((p.stories || []).length ? ' · ' + p.stories.join(', ') : '');
    },
    // ── The AI icon in a list: filled once the story has a saved analysis, faint until then ────────────────────────────
    aiClass(index, key) { return 'nx-ai-ico ' + (index && index[key] ? 'nx-ai-ico--done' : 'nx-ai-ico--none'); },
    aiTitle(index, key) {
      const it = index && index[key];
      if (!it) return 'Analyze ' + key + ' with AI';
      const d = new Date(it.at);
      const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
      const p2 = (n) => (n < 10 ? '0' : '') + n;
      return 'AI analysis of ' + key + ' · last run ' + (isNaN(d.getTime()) ? '' : d.getDate() + ' ' + mon + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes()))
        + (it.by ? ' by ' + it.by : '') + (it.fddLabel ? ' · against ' + it.fddLabel : '') + ' — open it';
    },
    // ── Activity (All / Comments / History / Work log), as Jira's Activity shows it ──────────────────────────────────
    /** What the Activity section shows for the open item: { items, counts, tab, loading, error, note } (jiraBacklog.activityView). */
    act(activity, key, tab, row) {
      const a = activity && key ? activity[key] : activity;
      const k = JSON.stringify([key, tab, a ? (a.ok ? 'ok' + a.all.length + ':' + (a.loadedAt || '') : (a.loading ? 'loading' : 'failed')) : 'none',
        row ? row.key + ':' + (row.comments || []).length : '']);
      if (actKept.k !== k) actKept = { k: k, v: J.activityView(a, row, tab) };
      return actKept.v;
    },
    actTabClass(view, t) { return 'nx-jira-acttab' + ((view && view.tab) === t ? ' nx-jira-acttab--on' : ''); },
    /** "Comments 3" (the count once the activity is read). */
    actLabel(view, t) {
      const name = { all: 'All', comments: 'Comments', history: 'History', worklog: 'Work log' }[t];
      const c = view && view.counts ? (t === 'all' ? (view.counts.history == null ? null : view.counts.comments + view.counts.history + view.counts.worklog) : view.counts[t]) : null;
      return c == null ? name : name + ' ' + c;
    },
    initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?'; },
    /** What the entry is: "commented", "changed 2 fields", "logged 3h". */
    actVerb(a) {
      if (!a) return '';
      if (a.kind === 'history') return a.items.length === 1 ? 'changed ' + a.items[0].field : 'made ' + a.items.length + ' changes';
      if (a.kind === 'worklog') return 'logged ' + a.spent;
      return a.edited ? 'commented (edited)' : 'commented';
    },
    actWhen(a) { return a ? [a.ago, a.when].filter(Boolean).join(' · ') : ''; },
    actEmpty(tab) { return { comments: 'No comments.', history: 'No changes recorded.', worklog: 'No work logged.' }[tab] || 'No activity.'; },
    actFrom(it) { return it && it.from ? it.from : 'None'; },
    actTo(it) { return it && it.to ? it.to : 'None'; },
    /** The acceptance criteria as a list of checks. */
    acList(ac) { return J.acChecks(ac); },
    /** An image of the open item: its URL once read, '' until then (or when it could not be read). */
    imageUrl(images, id) { return (images && id && images[id]) || ''; },
    /** What an image's place says before (or instead of) the image. */
    imageNote(images, id) {
      if (!id) return 'Not attached to the story';
      return images && Object.prototype.hasOwnProperty.call(images, id) && !images[id] ? 'Could not be read from Jira' : 'Loading the image…';
    },
    /** The item's images among its attachments, and the other files. */
    imageFiles(r) { return ((r && r.attachments) || []).filter((a) => a.image); },
    otherFiles(r) { return ((r && r.attachments) || []).filter((a) => !a.image); },
    /** The open item's recordings and screenshots (resources/js/testRecorder.js). */
    videos(ev) { return ((ev && ev.items) || []).filter((x) => x.kind === 'video'); },
    shots(ev) { return ((ev && ev.items) || []).filter((x) => x.kind === 'image'); },
    /** A recording's technical trace, on its button: "Technical trace · 23 calls · 2 failed · broke at 00:42". */
    traceText(t) {
      if (!t) return '';
      return ['Technical trace', t.calls + (t.calls === 1 ? ' call' : ' calls'), t.failed ? t.failed + ' failed' : '',
        t.errors ? t.errors + (t.errors === 1 ? ' console error' : ' console errors') : '', t.first ? 'broke at ' + t.first.at : ''].filter((x) => !!x).join(' · ');
    },
    traceClass(t) { return 'nx-btn nx-btn--sm nx-jira-tracebtn' + (t && (t.failed || t.errors) ? ' nx-jira-tracebtn--bad' : ''); },
    /** A list's icon for a story with test evidence on this PC (testRecorder.index): what it says, its look, its count. */
    recText(x) {
      if (!x) return '';
      return [x.videos ? x.videos + (x.videos === 1 ? ' recording' : ' recordings') : '', x.shots ? x.shots + (x.shots === 1 ? ' screenshot' : ' screenshots') : '',
        x.failed ? 'the trace caught ' + x.failed + (x.failed === 1 ? ' failure' : ' failures') : '', x.latest ? 'latest ' + x.latest : ''].filter((t) => !!t).join(' · ');
    },
    recClass(x) { return 'nx-jira-recmark' + (x && x.failed ? ' nx-jira-recmark--bad' : ''); },
    recCount(x) { return x && x.videos > 1 ? String(x.videos) : ''; },
    /** "2026-11-05 14:03 · 12.4 MB". */
    evidenceText(x) {
      if (!x) return '';
      const m = /(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})/.exec(x.name || '');
      const size = x.size >= 1048576 ? (Math.round(x.size / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(x.size / 1024)) + ' KB';
      return (m ? m[1] + ' ' + m[2] + ':' + m[3] : x.name) + ' · ' + size;
    },
  };

  // Escape closes the item's drawer through its own Close button (the drawer hides itself on Escape, but its
  // opened-changed does not reliably reach the page, which would then think the item is still open). Capture phase:
  // before the drawer acts on the key. One listener for the app.
  let escBound = false;
  function closeOnEscape() {
    if (escBound || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    escBound = true;
    const sel = DRAWERS.map((d) => d + ' button[aria-label^="Close"]').join(', ');
    document.addEventListener('keydown', (e) => {
      // the recorder's picker, a recording's technical trace, or its transcript closes first
      if (e.key !== 'Escape' || document.getElementById('eqrRecPicker') || document.getElementById('eqrTrace') || document.getElementById('eqrTx') || document.getElementById('eqrSetup')) return;
      const close = [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length)[0];
      if (close) { e.stopPropagation(); e.preventDefault(); close.click(); }
    }, true);
  }

  return { helpers, closeOnEscape, DRAWERS };
});
