define([], () => {
  'use strict';

  // FDD library: binding helpers. The work is the chains; reading and writing rules are resources/js/fddClient.js,
  // resources/js/fddIndex.js and desktop/lib/fdd.js. None uses `this`.
  function label(d) { return d ? d.name + (d.version ? ' · v' + String(d.version).replace(/^v/i, '') : '') : ''; }

  class PageModule {
    subText(lib) {
      const docs = (lib && lib.docs) || [];
      if (!docs.length) return 'The FDDs Analyze with AI reads. None uploaded yet.';
      const latest = docs.filter((d) => d.id === lib.latest)[0];
      return 'The FDDs Analyze with AI reads · latest: ' + (latest ? label(latest) : '—');
    }
    docLabel(lib, id) { return label(((lib && lib.docs) || []).filter((d) => d.id === id)[0]) || id; }
    docSub(d) {
      const when = d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      return [d.sections + ' sections' + (d.numbered != null && d.numbered < d.sections ? ' (' + d.numbered + ' numbered)' : ''),
        String(d.kind || '').toUpperCase(), when ? 'uploaded ' + when + (d.uploadedBy ? ' by ' + d.uploadedBy : '') : ''].filter(Boolean).join(' · ');
    }
    gitText(g) {
      if (!g || !g.available) return '';
      const where = g.branch + (g.upstream ? ' → ' + g.upstream : ' (not pushed anywhere yet)');
      if (g.pending && g.pending.length) return 'Branch ' + where + ' · ' + g.pending.length + ' FDD file' + (g.pending.length === 1 ? '' : 's') + ' not committed';
      if (g.unpushed && g.unpushed.length) return 'Branch ' + where + ' · ' + g.unpushed.length + ' FDD commit' + (g.unpushed.length === 1 ? '' : 's') + ' not pushed';
      return 'Branch ' + where + ' · everything is in git ✓';
    }
    needsPush(g) { return !!(g && g.available && ((g.pending && g.pending.length) || (g.unpushed && g.unpushed.length))); }
    filtered(outline, q) {
      const list = outline || [];
      const s = String(q || '').trim().toLowerCase();
      if (!s) return list;
      return list.filter((o) => (String(o.n).toLowerCase().indexOf(s) === 0) || String(o.t).toLowerCase().indexOf(s) !== -1);
    }
    ver(v) { return 'v' + String(v || '').replace(/^v/i, ''); }
    nodeClass(node, open) {
      const l = Math.min(4, Math.max(1, Number(node && node.l) || 1));
      return 'nx-flib-node nx-flib-l' + l + (open && node && open.key === node.key ? ' nx-flib-node--on' : '');
    }
    size(c) { const n = Number(c) || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); }
  }
  return PageModule;
});
