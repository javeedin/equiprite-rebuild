define([], function () {
  'use strict';

  // "Analyze with AI" for a Jira story (flows/insights jira-analysis page). Pure — no page, no DOM, no network. Builds the
  // prompt the shared Ask AI is given (the story, its subtasks and comments, the FDD section it names, and the list of
  // EquipRite pages so the LLM can say which page the work lands on), builds the follow-up chat prompt, and renders the
  // Markdown the LLM returns into safe HTML for the page.
  //
  //   prompt(story, pages, fdd)      { system, user } — the analysis, broken into fixed headings. `fdd` is the text of the
  //                                  FDD sections chosen for the story (fddIndex.pick), or { name, text }; with one, the
  //                                  analysis cites them ([FDD 7.2.5]) and adds an "FDD check" heading
  //   chatPrompt(story, history, q, fdd)  { system, user } — a follow-up question, grounded in the same story (and FDD)
  //   renderHtml(markdown)           Markdown (## headings, - bullets, **bold**, paragraphs) → safe HTML
  //   storyText(story)               the story + subtasks + comments as the prompt carries them (also used in tests)

  function txt(v) { return v == null ? '' : String(v); }
  function esc(s) { return txt(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var HEADINGS = ['Requirement', 'Current situation', 'What to do next', 'Risks & open questions', 'Suggested EquipRite page'];
  // With an FDD, one more, before the page: what the FDD asks for that the story misses or contradicts.
  var HEADINGS_FDD = ['Requirement', 'Current situation', 'What to do next', 'Risks & open questions', 'FDD check', 'Suggested EquipRite page'];

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

  var SYSTEM_FDD = [
    'You are a senior business analyst and developer on EquipRite, an equipment-rental and project application built on Oracle (Oracle JET / VBCS front end, Oracle Fusion and OIC behind it).',
    'You are given one Jira story with its sub-tasks and comments, excerpts of the FDD (the functional design document) chosen for this story — the sections it names and the ones that best match it — and the list of EquipRite screens.',
    'Write a short, practical analysis using EXACTLY these Markdown headings, in this order, each on its own line starting with "## ":',
    '## Requirement', '## Current situation', '## What to do next', '## Risks & open questions', '## FDD check', '## Suggested EquipRite page',
    'Under each heading use short "- " bullet points. Be concrete and specific to this story.',
    'Base everything ONLY on the information given — do not invent requirements, names, dates, numbers or decisions.',
    'When a point comes from the FDD, cite the section in square brackets, e.g. [FDD 7.2.5]. Never cite a section that is not in the excerpts.',
    'For "Requirement", combine the story with what the FDD sections say about it.',
    'For "Current situation", use the story status, its sub-tasks and the testers\' comments (what works, what is failing).',
    'For "What to do next", give clear next steps a developer/tester can act on.',
    'For "FDD check", list what the FDD requires that the story or its acceptance criteria miss, and anything in the story that contradicts the FDD, each with its [FDD n] citation. If they agree, say "No gaps found against the FDD excerpts." If the excerpts do not cover this story, say so.',
    'For "Suggested EquipRite page", pick the most relevant screen(s) from the list given and say in one line why; if none fits, say so.'
  ].join('\n');

  /** { name, text } from what the caller gives: '' / null, a string, or { name, text }. */
  function fddOf(fdd) {
    if (!fdd) return { name: '', text: '' };
    if (typeof fdd === 'string') return { name: '', text: fdd };
    return { name: txt(fdd.name), text: txt(fdd.text) };
  }

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

  /** { system, user } for the analysis. `fdd`: the FDD sections chosen for this story (text, or { name, text }). */
  function prompt(story, pages, fdd) {
    var f = fddOf(fdd);
    var parts = [storyText(story)];
    if (f.text.trim()) {
      parts.push(''); parts.push('FDD excerpts' + (f.name ? ' from "' + f.name + '"' : '') + ' (section numbers as in the document):');
      parts.push(f.text.trim());
    }
    var pt = pagesText(pages);
    if (pt) { parts.push(''); parts.push(pt); }
    return { system: f.text.trim() ? SYSTEM_FDD : SYSTEM, user: parts.join('\n') };
  }

  var CHAT_SYSTEM = 'You are helping with one EquipRite Jira story. Answer the user\'s question using the story, its sub-tasks, comments and FDD section below, plus general EquipRite/Oracle knowledge. Be concise and practical. Do not invent facts about this story that are not given.';
  var CHAT_SYSTEM_FDD = CHAT_SYSTEM + ' When you use the FDD excerpts, cite the section like [FDD 7.2.5]; if the excerpts do not answer the question, say so rather than guess what the FDD says.';

  /** { system, user } for a follow-up chat turn. `history` is [{ role:'user'|'assistant', text }]. */
  function chatPrompt(story, history, question, fdd) {
    var f = fddOf(fdd);
    var L = ['CONTEXT —', storyText(story)];
    if (f.text.trim()) { L.push(''); L.push('FDD excerpts' + (f.name ? ' from "' + f.name + '"' : '') + ' for this question:'); L.push(f.text.trim()); }
    (history || []).forEach(function (m) { L.push(''); L.push((m.role === 'assistant' ? 'Assistant' : 'User') + ': ' + txt(m.text)); });
    L.push(''); L.push('User: ' + txt(question));
    return { system: f.text.trim() ? CHAT_SYSTEM_FDD : CHAT_SYSTEM, user: L.join('\n') };
  }

  // ── Markdown → safe HTML (a small subset: ## / ### headings, - and * bullets, **bold**, *italic*, `code`, paragraphs) ──
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[FDD ([0-9A-Z][0-9A-Za-z.\-]*)\]/g, '<span class="fdd">FDD $1</span>'); // a citation, as a badge
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

  return { HEADINGS: HEADINGS, HEADINGS_FDD: HEADINGS_FDD, SYSTEM: SYSTEM, SYSTEM_FDD: SYSTEM_FDD, prompt: prompt, chatPrompt: chatPrompt, storyText: storyText, renderHtml: renderHtml };
});
