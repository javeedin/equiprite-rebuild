define(['vb/action/actionChain', 'resources/js/pagesClient', 'resources/js/codeView', 'resources/js/shellBus'], (ActionChain, PC, CV, bus) => {
  'use strict';

  // The Page code tab (read only): the open page's files (desktop/lib/pages.js code()), one shown at a time; copy it.
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
          if (!r.ok) v.result = { ok: false, text: (r.body && r.body.error) || 'Could not read the file.' };
          if (v.codeFind) CV.scrollTo('pgCodeFrame');
        } finally { v.codeBusy = false; }
      };
      if (act === 'open') {
        if (v.codePage === id && v.codeInfo) return; // as it was left
        v.codeBusy = true;
        let r;
        try { r = await PC.code(id); } finally { v.codeBusy = false; }
        if (v.selId !== id) return;
        v.codePage = id;
        v.codeInfo = r.ok ? r.body : { files: [], error: (r.body && r.body.error) || 'The code could not be read (it needs the desktop app).' };
        v.codeText = ''; v.codeSel = '';
        const files = v.codeInfo.files || [];
        const first = files.filter((f) => /-page\.html$/.test(f.path))[0] || files[0];
        if (first) await show(first.path);
        return;
      }
      if (act === 'file' && key) { await show(key); return; }
      if (act === 'copy') {
        try { await navigator.clipboard.writeText(v.codeText); bus.toast((v.codeSel.split('/').pop() || 'The file') + ' copied', 'info'); } catch (e) { bus.toast('Could not copy (select the text instead)', 'error'); }
      }
    }
  }
  return codeChain;
});
