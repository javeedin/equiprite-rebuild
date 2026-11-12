define([
  'vb/action/actionChain',
  'resources/js/fddClient',
  'resources/js/shellBus',
], (ActionChain, FC, bus) => {
  'use strict';

  // Upload: read the chosen file, send it to the local server (desktop/lib/fdd.js), which splits it into sections, saves
  // it into the project and — when "Commit & push to git" is ticked — commits and pushes it. Then show what happened.
  function gitLines(g) {
    if (!g) return [];
    if (!g.ok) return [];
    if (g.nothing) return ['Nothing new for git.'];
    return [(g.committed ? 'Committed ' + g.committed : 'Committed') + (g.pushed ? ' and pushed to ' + g.upstream + ' — everyone gets it with git pull.' : ' (not pushed).')];
  }

  class uploadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      let f = null;
      try { const el = document.getElementById('flibFile'); f = el && el.files && el.files[0]; } catch (e) { /* no DOM */ }
      if (!f) { bus.toast('Choose the FDD file first.', 'error'); return; }
      if (f.size > 60 * 1024 * 1024) { bus.toast('The file is larger than 60 MB.', 'error'); return; }
      v.busy = true; v.result = null;
      try {
        v.progress = 'Reading ' + f.name + '…';
        const base64 = await FC.readFile(f);
        v.progress = v.upCommit ? 'Splitting it into sections and saving it to git…' : 'Splitting it into sections…';
        const r = await FC.upload({ fileName: f.name, base64: base64, name: v.upName, version: v.upVersion, note: v.upNote,
          latest: !!v.upLatest, commit: !!v.upCommit, push: true });
        const b = r.body || {};
        if (!b.ok) {
          v.result = { ok: false, title: 'Not uploaded', lines: [b.error || 'The upload failed.'] };
          return;
        }
        const d = b.doc;
        const lines = [d.sections + ' sections read' + (d.numbered < d.sections ? ' (' + d.numbered + ' with a number)' : '') + ', saved as ' + d.file + '.'];
        if (b.latest === d.id) lines.push('It is now the latest: Analyze with AI starts on it.');
        const g = b.git;
        v.result = { ok: !g || !!g.ok, title: 'Uploaded ' + d.name + (d.version ? ' v' + d.version : ''),
          lines: lines.concat(gitLines(g)).concat(g && !g.ok ? ['Saved in the project, but git said: ' + g.error] : []),
          warnings: b.warnings || [], hint: g && !g.ok ? (g.hint || 'Fix that, then use Commit & push above.') : (!g ? 'Not in git yet: use Commit & push above when you are ready.' : '') };
        v.upFile = ''; v.upName = ''; v.upVersion = ''; v.upNote = '';
        // the inputs too: a field someone typed in keeps its text when only the variable is cleared
        try { ['flibFile', 'flibName', 'flibVersion', 'flibNote'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; }); } catch (e) { /* no DOM */ }
        FC.forget();
        const lib = await FC.library(context.$application.path);
        v.lib = lib.body;
        v.git = (await FC.gitStatus()).body || v.git;
        v.viewId = ''; v.outline = []; v.section = null;
        bus.toast('FDD uploaded' + (g && g.pushed ? ' and pushed to git.' : '.'), 'info');
      } catch (e) {
        v.result = { ok: false, title: 'Not uploaded', lines: [String((e && e.message) || e)] };
      } finally {
        v.progress = '';
        v.busy = false;
      }
    }
  }
  return uploadChain;
});
