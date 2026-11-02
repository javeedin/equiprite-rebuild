define([
  'vb/action/actionChain',
  'resources/js/sqlClient',
  'resources/js/sqlWorksheet',
  'resources/js/shellBus',
], (ActionChain, sql, W, bus) => {
  'use strict';

  // Save, Test, Connect and Delete in the connection dialog (as SQL Developer has them), Connect from the list, and
  // Disconnect. A saved connection's password stays in the desktop app: the page sends the connection's id and the
  // app uses the password it keeps. Connecting while changes are not committed asks first: they are rolled back.
  const KEY = 'equiprite-next:sql-session';
  const NONE = { id: '', name: '', user: '', target: '', banner: '', readOnly: false, pending: false, connId: '' };

  class connChain extends ActionChain {
    async run(context, { op, id }) {
      const v = context.$page.variables;
      const out = await this.step(v, op, id);
      // After Save, Delete or a connection opened for its password, the inputs show the form (the password box empty).
      if (v.dlg.open && (op === 'save' || op === 'delete' || op === 'connectSaved')) setTimeout(() => W.fillInputs(v.dlg.form), 0);
      return out;
    }

    async step(v, op, id) {
      const form = v.dlg.form || {};
      const status = (text, tone, more) => { v.dlg = Object.assign({}, v.dlg, { status: text, tone: tone || '', busy: '' }, more || {}); };

      if (op === 'save') {
        const miss = W.missing(form, true);
        if (miss) return status(miss, 'bad');
        v.dlg = Object.assign({}, v.dlg, { busy: 'Saving…' });
        const r = await sql.save(form);
        if (!r.ok) return status((r.body && r.body.error) || 'Not saved.', 'bad');
        await this.reload(v);
        const kept = r.body.passwordKept === 'keychain' ? 'the password is encrypted on this PC' : r.body.passwordKept === 'none' ? 'no password kept: it is asked when connecting' : 'the password is kept for this run only';
        return status('Saved "' + r.body.saved.name + '": ' + kept + '.', 'ok', { form: W.formOf(r.body.saved) });
      }
      if (op === 'test') {
        const miss = W.missing(form, false);
        if (miss) return status(miss, 'bad');
        v.dlg = Object.assign({}, v.dlg, { busy: 'Testing…', status: '', tone: '' });
        const r = await sql.test(form);
        const b = r.body || {};
        if (r.ok && b.ok) return status('Success. ' + b.user + ' @ ' + b.target + ' · ' + b.banner + ' · ' + W.took(b.ms), 'ok');
        return status('Failure: ' + (b.error || 'no answer from the desktop app'), 'bad');
      }
      if (op === 'connect') {
        const miss = W.missing(form, false);
        if (miss) return status(miss, 'bad');
        if (!(await this.leave(v))) return undefined;
        // Connect saves the connection first, as SQL Developer does: it is in the list from now on (named for it when
        // the Name was left empty), with the dialog's values.
        const named = String(form.name || '').trim() ? form
          : W.setField(form, 'name', W.autoName(form, (v.conns || []).filter((c) => c.id !== form.id).map((c) => c.name)));
        v.dlg = Object.assign({}, v.dlg, { busy: 'Saving…', status: '', tone: '' });
        const sv = await sql.save(named);
        if (!sv.ok) return status('Not saved, so not connected: ' + ((sv.body && sv.body.error) || 'no answer from the desktop app'), 'bad', { form: named });
        await this.reload(v);
        const saved = Object.assign({}, named, { id: sv.body.id });
        v.dlg = Object.assign({}, v.dlg, { busy: 'Connecting…', form: Object.assign({}, W.formOf(sv.body.saved), { password: form.password }) });
        const r = await sql.connect(saved);
        if (!r.ok) return status('Saved "' + named.name + '", but not connected: ' + ((r.body && r.body.error) || 'no answer from the desktop app'), 'bad');
        this.connected(v, r.body, sv.body.id);
        v.dlg = Object.assign({}, v.dlg, { open: false, busy: '', form: W.blankForm() });
        return undefined;
      }
      if (op === 'connectSaved') {
        const c = (v.conns || []).filter((x) => x.id === id)[0];
        if (!c) return undefined;
        if (!c.hasPassword) {
          // No password kept: the dialog asks for it, as SQL Developer does.
          v.dlg = { open: true, form: W.formOf(c), status: 'Give the password to connect to ' + c.name + '.', tone: '', busy: '', aliases: [], tnsNote: '', advanced: false };
          return undefined;
        }
        if (!(await this.leave(v))) return undefined;
        v.busy = 'connect';
        const r = await sql.connect({ id: c.id });
        v.busy = '';
        if (!r.ok) {
          bus.toast('Not connected to ' + c.name + ': ' + ((r.body && r.body.error) || 'no answer from the desktop app'), 'error');
          return undefined;
        }
        this.connected(v, r.body, c.id);
        await this.reload(v);
        return undefined;
      }
      if (op === 'delete') {
        if (!form.id || !window.confirm('Delete the connection "' + form.name + '" from this PC?')) return undefined;
        const r = await sql.remove(form.id);
        if (!r.ok) return status((r.body && r.body.error) || 'Not deleted.', 'bad');
        await this.reload(v);
        return status('Deleted "' + form.name + '".', 'ok', { form: W.blankForm() });
      }
      if (op === 'disconnect') {
        if (!v.session.id) return undefined;
        if (v.session.pending && !window.confirm('Disconnecting rolls back the uncommitted changes in ' + v.session.name + '. Disconnect?')) return undefined;
        const r = await sql.disconnect(v.session.id);
        bus.toast((r.body && r.body.message) || 'Disconnected.', 'info');
        v.session = Object.assign({}, NONE);
        try { window.sessionStorage.removeItem(KEY); } catch (e) { /* no storage */ }
      }
      return undefined;
    }

    async reload(v) {
      const c = await sql.connections();
      if (c.ok && Array.isArray(c.body)) { v.conns = c.body; v.connsError = ''; } else v.connsError = 'The saved connections could not be read: ' + ((c.body && c.body.error) || 'no answer from the desktop app') + '.';
    }

    /** Leaving the current session for another: asked first when changes are not committed (they are rolled back). */
    async leave(v) {
      if (!v.session.id) return true;
      if (v.session.pending && !window.confirm('Uncommitted changes in ' + v.session.name + ' are rolled back when you connect elsewhere. Go on?')) return false;
      await sql.disconnect(v.session.id);
      v.session = Object.assign({}, NONE);
      return true;
    }

    connected(v, b, connId) {
      v.session = { id: b.session, name: b.name, user: b.user, target: b.target, banner: b.banner || '', readOnly: !!b.readOnly, pending: false, connId };
      try { window.sessionStorage.setItem(KEY, JSON.stringify(v.session)); } catch (e) { /* no storage */ }
      bus.toast('Connected to ' + b.name + ' as ' + b.user + '.' + (b.banner ? ' ' + b.banner : ''), 'info');
      setTimeout(() => { const ed = document.getElementById('sqlEditor'); if (ed) ed.focus(); }, 50);
    }
  }

  return connChain;
});
