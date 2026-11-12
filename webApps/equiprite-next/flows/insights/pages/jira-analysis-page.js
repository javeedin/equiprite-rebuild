define([], () => {
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

    /** The analysis HTML wrapped in a small styled document for its sandboxed iframe. */
    doc(html) {
      var body = String(html || '') || '<p style="color:#888">The analysis will appear here.</p>';
      return '<!doctype html><meta charset="utf-8"><style>'
        + 'body{font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#161513;margin:0;padding:14px}'
        + 'h2,h3,h4{color:#00688c;margin:16px 0 6px;font-size:15px;font-weight:700}h2:first-child,h3:first-child{margin-top:0}'
        + 'ul{margin:0 0 12px;padding-left:20px}li{margin-bottom:5px}p{margin:0 0 10px}strong{font-weight:700}'
        + 'code{background:#eef2f4;padding:1px 5px;border-radius:4px;font-size:12px}.nx-an-err{color:#b3311f}'
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
        + '</style>' + inner;
    }
  }
  return PageModule;
});
