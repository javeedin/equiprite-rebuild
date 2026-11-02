define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/sqlWorksheet',
], (ActionChain, Actions, W) => {
  'use strict';

  // The page's own state: a field of the connection form (form.<key>), the worksheet's text (kept on this PC), the
  // results tab, the rows a fetch brings, the export menu, the Advanced section. Choosing TNS reads the aliases.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const v = context.$page.variables;
      const f = String(field || '');
      if (f.indexOf('form.') === 0) {
        const key = f.slice(5);
        v.dlg = Object.assign({}, v.dlg, { form: W.setField(v.dlg.form, key, value) });
        if (key === 'type' && value === 'tns' && !v.dlg.aliases.length) await Actions.callChain(context, { chain: 'dlgChain', params: { op: 'tns' } });
        return;
      }
      if (f === 'sql') {
        v.sql = value == null ? '' : String(value);
        try { window.localStorage.setItem('equiprite-next:sql-worksheet', v.sql); } catch (e) { /* no storage */ }
      } else if (f === 'tab') v.tab = String(value || 'result');
      else if (f === 'fetch') v.fetch = Number(value) || 200;
      else if (f === 'exportOpen') v.exportOpen = !v.exportOpen;
      else if (f === 'advanced') v.dlg = Object.assign({}, v.dlg, { advanced: !v.dlg.advanced });
    }
  }

  return setChain;
});
