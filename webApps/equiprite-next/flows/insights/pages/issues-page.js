define(['resources/js/issuesClient', 'resources/js/codeFixClient', 'resources/js/storyAnalysis', 'resources/js/shellBus'], (IC, FX, SA, bus) => {
  'use strict';

  // Issues: binding helpers (desktop/lib/issues.js does the work; the chains call it). None uses `this`.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = (at) => { const d = new Date(at); if (isNaN(d.getTime())) return ''; const p2 = (n) => (n < 10 ? '0' : '') + n; return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const STATUS = { new: 'Logged', written: 'Written up', analyzed: 'Analyzed', triaged: 'Triaged', 'needs-info': 'Needs information', 'awaiting-approval': 'Waiting for approval',
    approved: 'Approved', rejected: 'Rejected', 'in-review': 'Pull request', closed: 'Closed' };
  let shownKept = { k: '', v: [] };

  // Screenshots for a new issue: pasted (Ctrl+V), dropped or picked in its form (#isAsk). Read here during the paste (the
  // clipboard is gone after), handed to the chain through codeFixClient's queue and the issueImages event.
  let fire = null;
  function listen() {
    if (typeof document === 'undefined' || window.__nxIssueImages) return;
    window.__nxIssueImages = true;
    const inAsk = (t) => !!(t && t.closest && t.closest('#isAsk'));
    const filesOf = (dt) => {
      if (!dt) return [];
      const items = Array.prototype.filter.call(dt.items || [], (i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile()).filter(Boolean);
      return items.length ? items : Array.prototype.filter.call(dt.files || [], (f) => /^image\//.test(f.type));
    };
    const take = (files) => { if (!files.length) return false; Promise.all(files.map((f) => FX.prepImage(f))).then((imgs) => { FX.queueImages(imgs.filter(Boolean)); if (fire) fire(); }); return true; };
    document.addEventListener('paste', (ev) => { if (inAsk(ev.target) && take(filesOf(ev.clipboardData))) ev.preventDefault(); });
    document.addEventListener('dragover', (ev) => { if (inAsk(ev.target)) ev.preventDefault(); });
    document.addEventListener('drop', (ev) => { if (!inAsk(ev.target)) return; ev.preventDefault(); take(filesOf(ev.dataTransfer)); });
    document.addEventListener('change', (ev) => { if (ev.target && ev.target.id === 'isImgFile') { take(Array.prototype.slice.call(ev.target.files || [])); ev.target.value = ''; } });
  }

  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      fire = () => { if (helper) helper.fireCustomEvent('issueImages', {}); };
      bus.onFocus('issues', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
      listen();
    }
    subText(c, info) {
      const n = c || {};
      return n.open + ' open · ' + n.approval + ' waiting for approval · ' + n.review + ' in review · ' + n.closed + ' closed' + (info && info.shared ? ' · shared with everyone' : '');
    }
    filters(c) { const n = c || {}; return [['open', 'Open'], ['approval', 'Waiting for approval'], ['review', 'In review'], ['closed', 'Closed'], ['all', 'All']].map((f) => ({ id: f[0], label: f[1], n: n[f[0]] || 0 })); }
    shown(list, q) {
      const k = (list || []).length + '|' + q + '|' + (list || []).map((x) => x.id + x.status).join(',');
      if (shownKept.k === k) return shownKept.v;
      const s = String(q || '').trim().toLowerCase();
      shownKept = { k: k, v: (list || []).filter((x) => !s || [x.key, x.title, x.label, x.page, x.by, x.status].join(' ').toLowerCase().indexOf(s) !== -1) };
      return shownKept.v;
    }
    statusText(s) { return STATUS[s] || s; }
    statusClass(s) { return 'nx-is-st nx-is-st--' + (s || 'new'); }
    verdictClass(v) { return 'nx-is-verdict nx-is-verdict--' + (v || 'none'); }
    when(at) { return when(at); }
    rowMeta(x) { return x.label + (x.verdictLabel ? ' · ' + x.verdictLabel : '') + ' · ' + when(x.updatedAt) + (x.shared ? ' · from another PC' : ''); }
    stepClass(s) { return 'nx-is-step nx-is-step--' + s.state; }
    // the page picker
    pagesShown(pages, q) {
      const s = String(q || '').trim().toLowerCase();
      if (!s) return [];
      return (pages || []).filter((p) => [p.label, p.id, p.appName].join(' ').toLowerCase().indexOf(s) !== -1).slice(0, 12);
    }
    pageOf(pages, id) { return (pages || []).filter((p) => p.id === id)[0] || null; }
    pageText(p) { return p ? p.appName + ' · ' + (p.flow ? p.flow + '/' : '') + p.page : ''; }
    kinds() { return [{ id: 'bug', label: 'Bug' }, { id: 'enhancement', label: 'Enhancement' }, { id: 'change', label: 'Change' }]; }
    // the issue
    title(x) { return x ? (x.formatted && x.formatted.title) || x.title : ''; }
    canEdit(x) { return !!x && !x.shared && ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'rejected'].indexOf(x.status) !== -1; }
    canAnalyze(x) { return !!x && !x.shared && ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'rejected'].indexOf(x.status) !== -1; }
    inFilter(st, f) {
      const g = { open: ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'awaiting-approval', 'approved', 'rejected'], approval: ['awaiting-approval'], review: ['approved', 'in-review'], closed: ['closed'] };
      return f === 'all' || !f || (g[f] || []).indexOf(st) !== -1;
    }
    approvalShown(x) { return !!x && (['awaiting-approval', 'approved', 'rejected', 'in-review', 'closed'].indexOf(x.status) !== -1 || (x.status === 'analyzed' && !!x.verdict && x.verdict.code === 'fix-here' && !!x.fix && x.fix.status === 'proposed')); }
    notHere(x) { return !!x && (x.status === 'triaged' || x.status === 'needs-info'); }
    canAsk(x) { return !!x && !x.shared && x.status === 'analyzed' && x.verdict && x.verdict.code === 'fix-here' && !!x.fix && x.fix.status === 'proposed'; }
    stepsText(f) { return ((f && f.steps) || []).join('\n'); }
    indexed(list) { return (list || []).map((x, i) => Object.assign({ i: String(i), n: String(i + 1) }, x)); }
    img(x, n) { return IC.imgUrl(x, n); }
    doc(md) {
      return '<!doctype html><meta charset="utf-8"><style>body{font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#161513;margin:0;padding:14px}'
        + 'h2,h3,h4{color:#00688c;margin:16px 0 6px;font-size:15px;font-weight:700}h2:first-child,h3:first-child{margin-top:0}ul,ol{margin:0 0 12px;padding-left:20px}li{margin-bottom:5px}p{margin:0 0 10px}'
        + 'code{background:#eef2f4;padding:1px 5px;border-radius:4px;font-size:12px}</style>' + SA.renderHtml(md || '');
    }
    /** Why: the verdict's text without its own words at the start (shown as the heading). */
    verdictText(v) {
      if (!v || !v.text) return '';
      return v.text.replace(/^[-*\s]*(\*\*)?\s*(fix (it )?on this page|fix here|fix elsewhere|works as designed|out of scope|needs? (more )?information)\s*(\*\*)?\s*[—–:.-]*\s*/i, '').replace(/\s*\n\s*/g, ' ').trim();
    }
    fixLine(t) { return 'nx-fx-l nx-fx-l--' + (t === '+' ? 'add' : t === '-' ? 'del' : 'ctx'); }
    fixSign(t) { return t === ' ' ? '' : (t === '-' ? '−' : t); }
    checkMark(c) { return c.ok ? '✓' : (c.warn ? '⚠' : (c.already ? '•' : '✗')); }
    checkClass(c) { return 'nx-fx-check ' + (c.ok ? 'nx-fx-check--ok' : (c.warn ? 'nx-fx-check--warn' : (c.already ? 'nx-fx-check--old' : 'nx-fx-check--bad'))); }
    stats(f) { const d = (f && f.diff) || []; return d.length + ' file' + (d.length === 1 ? '' : 's') + ' · +' + d.reduce((n, x) => n + x.added, 0) + ' −' + d.reduce((n, x) => n + x.removed, 0); }
    unitText(u) { return u.ok ? '✓ ' + u.passed + ' passed' : (u.newFailures.length ? '✗ ' + u.newFailures.length + ' new failure(s)' : '• ' + u.failed + ' failing, as before the fix'); }
    emailText(x) {
      const e = x && x.approval && x.approval.requested && x.approval.requested.email;
      if (!e) return '';
      return e.sent ? 'Approval email sent to ' + e.to + ' (code ' + x.approval.requested.code + '). Approving by replying to it comes with Mail.Read; approve here meanwhile.' : (e.error || '');
    }
    eventText(e) { return (e.by ? e.by + ' · ' : '') + when(e.at); }
    imgSize(x) { return (x.w ? x.w + '×' + x.h + ' · ' : '') + Math.max(1, Math.round((x.size || 0) / 1024)) + ' KB'; }
  }
  return PageModule;
});
