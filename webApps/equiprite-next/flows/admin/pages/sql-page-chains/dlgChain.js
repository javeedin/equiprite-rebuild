define([
  'vb/action/actionChain',
  'resources/js/sqlClient',
  'resources/js/sqlWorksheet',
], (ActionChain, sql, W) => {
  'use strict';

  // The connection dialog (SQL Developer's New / Select Database Connection): new, edit a saved one, pick one in its
  // list, Clear, Close; and the network aliases of tnsnames.ora in the TNS folder (TNS_ADMIN by default).
  class dlgChain extends ActionChain {
    async run(context, { op, id }) {
      const v = context.$page.variables;
      await this.step(v, op, id);
      // The inputs show the form a chain set (a native input the person typed in keeps its own value otherwise).
      if (v.dlg.open && op !== 'close') setTimeout(() => W.fillInputs(v.dlg.form), 0);
    }

    async step(v, op, id) {
      const blank = { open: true, form: W.blankForm(), status: '', tone: '', busy: '', aliases: [], tnsNote: '', advanced: false };
      if (op === 'new' || op === 'clear') {
        v.dlg = Object.assign({}, blank, op === 'clear' ? { aliases: v.dlg.aliases, tnsNote: v.dlg.tnsNote } : {});
        return;
      }
      if (op === 'close') {
        v.dlg = Object.assign({}, v.dlg, { open: false, form: W.blankForm(), busy: '' });
        return;
      }
      if (op === 'edit' || op === 'pick') {
        const c = (v.conns || []).filter((x) => x.id === id)[0];
        if (!c) return;
        v.dlg = Object.assign({}, blank, { form: W.formOf(c), advanced: !!(c.readOnly || c.walletLocation),
          status: c.hasPassword ? '' : 'Give the password: it is not saved for this connection.' });
        if (c.type === 'tns') await this.tns(v);
        return;
      }
      if (op === 'tns') await this.tns(v);
    }

    async tns(v) {
      const r = await sql.tns(v.dlg.form.tnsAdmin || '');
      const b = r.body || {};
      const aliases = Array.isArray(b.aliases) ? b.aliases : [];
      const form = !v.dlg.form.tnsAdmin && b.dir ? W.setField(v.dlg.form, 'tnsAdmin', b.dir) : v.dlg.form;
      v.dlg = Object.assign({}, v.dlg, { form, aliases,
        tnsNote: !r.ok ? (b.error || 'The aliases could not be read.') : b.note || (aliases.length + ' alias' + (aliases.length === 1 ? '' : 'es') + ' in ' + b.file + '.') });
    }
  }

  return dlgChain;
});
