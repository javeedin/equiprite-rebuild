define(['resources/js/jiraStoryPanel'], (Panel) => {
  'use strict';

  // Analyze with AI (jira-analysis page): binding helpers. The prompt/render rules are resources/js/storyAnalysis.js; the
  // work is the chains. None uses `this`.
  class PageModule {
    sub(story) { return (story && (story.subtaskList || story.subtasks)) || []; }
    comments(story) { return (story && (Array.isArray(story.comments) ? story.comments : (story.comments && story.comments.list))) || []; }
    labels(story) { return (story && story.labels) || []; }
    fddRefs(story) { return (story && story.fdd) || []; }
    badge(cat) { return 'nx-an-badge nx-an-badge--' + (cat === 'done' ? 'done' : (cat === 'indeterminate' ? 'prog' : 'todo')); }
    storyUrl(story) { return (story && story.url) || ''; }
    count(list) { return (list || []).length; }
    hasText(s) { return !!(s && String(s).trim()); }

    /** The chosen FDD's label ("EquipRite FDD · v1.7 (latest)"), or "No FDD" when none is chosen. */
    fddLabel(options, id) {
      if (!id) return 'No FDD — the story only';
      const o = (options || []).filter(function (x) { return x.id === id; })[0];
      return o ? o.label : id;
    }
    /** The sections read, each with its index (the chip's data-i). */
    indexed(list) { return (list || []).map(function (p, i) { return Object.assign({ i: String(i) }, p); }); }
    chipText(p) { return (p.n ? p.n + ' ' : '') + (String(p.t || '').length > 34 ? String(p.t).slice(0, 32) + '…' : p.t); }
    chipClass(p, open) {
      var kind = /^named|^closest|^part of|^mentions/.test(p.why || '') ? 'named' : 'match';
      return 'nx-an-fddchip nx-an-fddchip--' + kind + (open && open.i === p.i ? ' nx-an-fddchip--on' : '');
    }

    /** The analysis HTML wrapped in a small styled document for its sandboxed iframe. */
    doc(html) {
      var body = String(html || '') || '<p style="color:#888">The analysis will appear here.</p>';
      return '<!doctype html><meta charset="utf-8"><style>'
        + 'body{font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#161513;margin:0;padding:14px}'
        + 'h2,h3,h4{color:#00688c;margin:16px 0 6px;font-size:15px;font-weight:700}h2:first-child,h3:first-child{margin-top:0}'
        + 'ul{margin:0 0 12px;padding-left:20px}li{margin-bottom:5px}p{margin:0 0 10px}strong{font-weight:700}'
        + 'code{background:#eef2f4;padding:1px 5px;border-radius:4px;font-size:12px}.nx-an-err{color:#b3311f}'
        + '.fdd{background:#e4f1f7;color:#0b4b61;border-radius:4px;padding:0 5px;font-size:12px;font-weight:600;white-space:nowrap}'
        + '</style>' + body;
    }
    /** The whole chat transcript as one styled document for its sandboxed iframe. */
    chatDoc(chat) {
      var turns = chat || [];
      var inner = turns.length
        ? turns.map(function (m) { return '<div class="b ' + (m.role === 'assistant' ? 'a' : 'u') + '">' + (m.html || '') + '</div>'; }).join('')
        : '<p class="e">Ask a question about this story — e.g. “what should I test first?” or “which files change?”</p>';
      return '<!doctype html><meta charset="utf-8"><style>'
        + 'body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#161513;margin:0;padding:12px;background:#fff}'
        + '.b{max-width:88%;width:fit-content;margin:0 0 10px;padding:8px 12px;border-radius:12px}'
        + '.u{background:#e4f1f7;color:#0b4b61;margin-left:auto}.a{background:#f1efec}'
        + '.b p{margin:0 0 6px}.b p:last-child{margin:0}.b ul{margin:0;padding-left:18px}.b h3,.b h4{margin:4px 0;font-size:14px}'
        + '.e{color:#8a8a8a}.nx-an-err{color:#b3311f}'
        + '.fdd{background:#d8ebf3;color:#0b4b61;border-radius:4px;padding:0 4px;font-size:12px;font-weight:600;white-space:nowrap}'
        + '</style>' + inner;
    }
  }
  // The activity, images and attachments: the same helpers as the Jira drawers (resources/js/jiraStoryPanel.js), where
  // this page has none of its own.
  Object.keys(Panel.helpers).forEach((k) => { if (!PageModule.prototype[k]) PageModule.prototype[k] = Panel.helpers[k]; });
  return PageModule;
});
