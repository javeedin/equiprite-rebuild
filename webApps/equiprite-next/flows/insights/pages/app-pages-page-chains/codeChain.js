define(['vb/action/actionChain', 'resources/js/pagesClient', 'resources/js/codeView', 'resources/js/shellBus'], (ActionChain, PC, CV, bus) => {
  'use strict';

  // The Page code tab (read only): the open page's files (desktop/lib/pages.js code()), one shown at a time, what changed in
  // it marked (against VB Studio, or the branch's remote) and gone through change by change; read again (each time the tab
  // opens, and Refresh); copy it.
  class codeChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const id = v.selId;
      if (!act || !id) return;
      const show = async (path) => {
        v.codeBusy = true;
        try {
          const r = await PC.codeFile(id, path);
          if (v.selId !== id) return;
          v.codeSel = path;
          v.codeText = r.ok ? r.body.text : '';
          // what changed in it: marked, and shown from its first change (unless something is searched for)
          v.codeMarks = r.ok ? (r.body.changes || null) : null;
          const n = (v.codeMarks && v.codeMarks.regions) ? v.codeMarks.regions.length : 0;
          v.codeAt = n && !v.codeMarks.isNew ? 0 : -1;
          if (!r.ok) v.result = { ok: false, text: (r.body && r.body.error) || 'Could not read the file.' };
          if (v.codeFind) CV.scrollTo('pgCodeFrame');
          else if (v.codeAt === 0) CV.scrollTo('pgCodeFrame', CV.changeLine(v.codeMarks, 0));
        } finally { v.codeBusy = false; }
      };
      // the page's files and the one shown, read (again) as they are now — each time the tab opens (a change made in Code
      // fix, saved or committed, or by hand, is there) and on Refresh; the file you were on stays shown
      const reload = async (keep) => {
        v.codeBusy = true;
        let r;
        try { r = await PC.code(id); } finally { v.codeBusy = false; }
        if (v.selId !== id) return;
        v.codePage = id;
        v.codeInfo = r.ok ? r.body : { files: [], error: (r.body && r.body.error) || 'The code could not be read (it needs the desktop app).' };
        const files = v.codeInfo.files || [];
        const kept = keep && files.some((f) => f.path === keep) ? keep : '';
        const first = kept || ((files.filter((f) => /-page\.html$/.test(f.path))[0] || files[0] || {}).path || '');
        if (!first) { v.codeText = ''; v.codeSel = ''; v.codeMarks = null; }
        else await show(first);
        v.codeReadAt = new Date().toISOString();
      };
      if (act === 'open') { await reload(v.codePage === id ? v.codeSel : ''); return; }
      if (act === 'refresh') {
        const was = v.codeText;
        await reload(v.codeSel);
        bus.toast(v.codeText !== was ? 'Page code read again: the file has changed since' : 'Page code read again: no change in this file', 'info');
        return;
      }
      if (act === 'file' && key) { await show(key); return; }
      if (act === 'nextChange' || act === 'prevChange') {
        const n = (v.codeMarks && v.codeMarks.regions) ? v.codeMarks.regions.length : 0;
        if (!n) return;
        v.codeAt = act === 'nextChange' ? (v.codeAt + 1) % n : (v.codeAt <= 0 ? n - 1 : v.codeAt - 1);
        CV.scrollTo('pgCodeFrame', CV.changeLine(v.codeMarks, v.codeAt));
        return;
      }
      if (act === 'copy') {
        try { await navigator.clipboard.writeText(v.codeText); bus.toast((v.codeSel.split('/').pop() || 'The file') + ' copied', 'info'); } catch (e) { bus.toast('Could not copy (select the text instead)', 'error'); }
      }
    }
  }
  return codeChain;
});
