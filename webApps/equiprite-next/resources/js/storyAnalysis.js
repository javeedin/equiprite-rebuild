define([], function () {
  'use strict';

  // "Analyze with AI" for a Jira story (flows/insights jira-analysis page). Pure — no page, no DOM, no network. Builds the
  // prompt the shared Ask AI is given (the story, its subtasks and comments, the FDD section it names, and the list of
  // EquipRite pages so the LLM can say which page the work lands on), builds the follow-up chat prompt, and renders the
  // Markdown the LLM returns into safe HTML for the page.
  //
  //   prompt(story, pages, fdd)      { system, user } — the analysis, broken into fixed headings
  //   chatPrompt(story, history, q)  { system, user } — a follow-up question, grounded in the same story
  //   renderHtml(markdown)           Markdown (## headings, - bullets, **bold**, paragraphs) → safe HTML
  //   storyText(story)               the story + subtasks + comments as the prompt carries them (also used in tests)

  function txt(v) { return v == null ? '' : String(v); }
  function esc(s) { return txt(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var HEADINGS = ['Requirement', 'Current situation', 'What to do next', 'Risks & open questions', 'Suggested EquipRite page'];

  var SYSTEM = [
    'You are a senior business analyst and developer on EquipRite, an equipment-rental and project application built on Oracle (Oracle JET / VBCS front end, Oracle Fusion and OIC behind it).',
    'You are given one Jira story with its sub-tasks and comments, the FDD (functional design) section it references when available, and the list of EquipRite screens.',
    'Write a short, practical analysis using EXACTLY these Markdown headings, in this order, each on its own line starting with "## ":',
    '## Requirement', '## Current situation', '## What to do next', '## Risks & open questions', '## Suggested EquipRite page',
    'Under each heading use short "- " bullet points. Be concrete and specific to this story.',
    'Base everything ONLY on the information given — do not invent requirements, names, dates, numbers or decisions.',
    'For "Current situation", use the story status, its sub-tasks and the testers\' comments (what works, what is failing).',
    'For "What to do next", give clear next steps a developer/tester can act on.',
    'For "Suggested EquipRite page", pick the most relevant screen(s) from the list given and say in one line why; if none fits, say so.'
  ].join('\n');

  /** The story, its sub-tasks and comments, as the prompt carries them. */
  function storyText(story) {
    var s = story || {};
    var L = [];
    L.push('STORY ' + txt(s.key) + ': ' + txt(s.summary));
    L.push('Status: ' + (txt(s.status) || '—') + ' · Assignee: ' + (txt(s.assignee) || 'Unassigned')
      + ' · Sprint: ' + (txt(s.sprint) || '—') + (txt(s.epicKey) ? ' · Epic: ' + txt(s.epicKey) + ' ' + txt(s.epicName) : '')
      + (txt(s.due) ? ' · Due: ' + txt(s.due) : '') + ((s.labels && s.labels.length) ? ' · Labels: ' + s.labels.join(', ') : ''));
    if (txt(s.body).trim()) { L.push(''); L.push('Description:'); L.push(txt(s.body).trim()); }
    if (txt(s.ac).trim()) { L.push(''); L.push('Acceptance criteria:'); L.push(txt(s.ac).trim()); }
    var subs = s.subtaskList || s.subtasks || [];
    if (subs.length) {
      L.push(''); L.push('Sub-tasks (' + subs.length + '):');
      subs.forEach(function (t) { L.push('- ' + txt(t.key) + ' ' + txt(t.summary) + ' [' + (txt(t.status) || '—') + (txt(t.assignee) ? ', ' + txt(t.assignee) : '') + ']'); });
    }
    var comments = Array.isArray(s.comments) ? s.comments : ((s.comments && s.comments.list) || s.commentList || []);
    if (comments.length) {
      L.push(''); L.push('Comments (' + comments.length + '):');
      comments.forEach(function (c) { L.push('- ' + (txt(c.author) ? txt(c.author) + ': ' : '') + txt(c.text || c.body).replace(/\s+/g, ' ').trim()); });
    }
    return L.join('\n');
  }

  function pagesText(pages) {
    var ps = pages || [];
    if (!ps.length) return '';
    return 'EquipRite screens to choose from:\n' + ps.map(function (p) {
      return '- ' + txt(p.label) + (txt(p.keywords) ? ' (' + txt(p.keywords) + ')' : '');
    }).join('\n');
  }

  /** { system, user } for the analysis. `fdd` is the referenced FDD section text, when the desktop could read it. */
  function prompt(story, pages, fdd) {
    var parts = [storyText(story)];
    if (txt(fdd).trim()) { parts.push(''); parts.push('FDD section(s) referenced by this story:'); parts.push(txt(fdd).trim()); }
    var pt = pagesText(pages);
    if (pt) { parts.push(''); parts.push(pt); }
    return { system: SYSTEM, user: parts.join('\n') };
  }

  var CHAT_SYSTEM = 'You are helping with one EquipRite Jira story. Answer the user\'s question using the story, its sub-tasks, comments and FDD section below, plus general EquipRite/Oracle knowledge. Be concise and practical. Do not invent facts about this story that are not given.';

  /** { system, user } for a follow-up chat turn. `history` is [{ role:'user'|'assistant', text }]. */
  function chatPrompt(story, history, question, fdd) {
    var L = ['CONTEXT —', storyText(story)];
    if (txt(fdd).trim()) { L.push(''); L.push('FDD section:'); L.push(txt(fdd).trim()); }
    (history || []).forEach(function (m) { L.push(''); L.push((m.role === 'assistant' ? 'Assistant' : 'User') + ': ' + txt(m.text)); });
    L.push(''); L.push('User: ' + txt(question));
    return { system: CHAT_SYSTEM, user: L.join('\n') };
  }

  // ── Markdown → safe HTML (a small subset: ## / ### headings, - and * bullets, **bold**, *italic*, `code`, paragraphs) ──
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function renderHtml(markdown) {
    var lines = txt(markdown).replace(/\r/g, '').split(/\n/);
    var out = [], bullets = [], para = [];
    function fb() { if (bullets.length) { out.push('<ul>' + bullets.map(function (b) { return '<li>' + inline(b) + '</li>'; }).join('') + '</ul>'); bullets = []; } }
    function fp() { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      var h = /^(#{1,6})\s+(.*)$/.exec(line.trim());
      if (h) { fb(); fp(); var lvl = Math.min(h[1].length + 1, 4); out.push('<h' + lvl + '>' + inline(h[2]) + '</h' + lvl + '>'); return; }
      var b = /^\s*[-*]\s+(.*)$/.exec(line);
      if (b) { fp(); bullets.push(b[1]); return; }
      if (!line.trim()) { fb(); fp(); return; }
      fb(); para.push(line.trim());
    });
    fb(); fp();
    return out.join('');
  }

  return { HEADINGS: HEADINGS, SYSTEM: SYSTEM, prompt: prompt, chatPrompt: chatPrompt, storyText: storyText, renderHtml: renderHtml };
});
