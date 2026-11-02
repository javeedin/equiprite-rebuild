define([
  'vb/action/actionChain',
  'resources/js/sqlClient',
  'resources/js/sqlWorksheet',
  'resources/js/shellBus',
], (ActionChain, sql, W, bus) => {
  'use strict';

  // Ask AI: a question in plain words, and the LLM the person chose writes the SQL into the worksheet, selected, for them
  // to read and run (never run by itself). The settings dialog: Claude, ChatGPT, Oracle OCI Generative AI, Gemini, or
  // any OpenAI-compatible service; the key typed here goes to the desktop app, which keeps it encrypted and never sends
  // it back. Models come from the provider with that key (Load models), and one is chosen.
  //
  //   op: load | open | close | provider (value) | field (key, value) | model (value) | models | save | forget | question
  //       (value) | ask
  class aiChain extends ActionChain {
    async run(context, { op, key, value }) {
      const v = context.$page.variables;
      const dlg = (more) => { v.aiDlg = Object.assign({}, v.aiDlg, more); };
      const formOf = (st, id) => {
        const pr = (st.providers || {})[id] || {};
        const f = { provider: id, model: pr.model || '' };
        const cat = (st.catalog || []).filter((p) => p.id === id)[0];
        (cat ? cat.fields : []).forEach((x) => { f[x.key] = x.secret ? '' : pr[x.key] || ''; });
        return f;
      };
      const fields = (st, id) => {
        const cat = (st.catalog || []).filter((p) => p.id === id)[0];
        const pr = (st.providers || {})[id] || {};
        return cat ? cat.fields.map((x) => Object.assign({}, x, { saved: !!(x.secret && pr['has_' + x.key]) })) : [];
      };
      const fill = () => setTimeout(() => W.fillInputs(v.aiDlg.form, null, '#sqlAiDialog'), 0);

      if (op === 'load' || op === 'open') {
        const r = await sql.aiSettings();
        if (!r.ok) {
          v.ai = Object.assign({}, v.ai, { who: '' });
          if (op === 'open') bus.toast((r.body && r.body.error) || 'Ask AI is not available here.', 'error');
          return;
        }
        const st = r.body;
        v.ai = Object.assign({}, v.ai, { who: W.aiWho(st) });
        if (op === 'load') return;
        const id = st.active || 'anthropic';
        v.aiDlg = { open: true, settings: st, provider: id, form: formOf(st, id), fields: fields(st, id), models: [], status: value || '', tone: value ? 'bad' : '', busy: '' };
        fill();
        return;
      }
      if (op === 'close') { dlg({ open: false, busy: '', form: {} }); return; }
      if (op === 'provider') {
        const st = v.aiDlg.settings;
        dlg({ provider: value, form: formOf(st, value), fields: fields(st, value), models: [], status: '', tone: '' });
        fill();
        return;
      }
      if (op === 'field') { const f = Object.assign({}, v.aiDlg.form); f[key] = value == null ? '' : String(value); dlg({ form: f }); return; }
      if (op === 'model') { dlg({ form: Object.assign({}, v.aiDlg.form, { model: String(value || '') }) }); fill(); return; }
      if (op === 'question') { v.ai = Object.assign({}, v.ai, { question: value == null ? '' : String(value) }); return; }

      if (op === 'save' || op === 'models') {
        // Test (Load models) saves first: the desktop app calls the provider with the key it keeps.
        dlg({ busy: op === 'save' ? 'Saving…' : 'Asking ' + this.label(v) + ' for its models…', status: '', tone: '' });
        const s = await sql.aiSave(v.aiDlg.form);
        if (!s.ok) { dlg({ busy: '', status: (s.body && s.body.error) || 'Not saved.', tone: 'bad' }); return; }
        const st = await sql.aiSettings();
        if (st.ok) {
          // The key typed is in the desktop app now: the page forgets it (the field shows "Saved").
          dlg({ settings: st.body, fields: fields(st.body, v.aiDlg.provider), form: Object.assign(formOf(st.body, v.aiDlg.provider), { model: v.aiDlg.form.model }) });
          v.ai = Object.assign({}, v.ai, { who: W.aiWho(st.body) });
          fill();
        }
        if (op === 'save') {
          const chosen = v.aiDlg.form.model;
          dlg({ busy: '', status: chosen ? 'Saved: Ask AI uses ' + this.label(v) + ' · ' + chosen + '. The key is ' + (s.body.keptIn === 'keychain' ? 'encrypted on this PC.' : 'kept for this run only (no keychain on this PC).')
            : 'Saved. Now pick a model: Load models.', tone: chosen ? 'ok' : 'bad' });
          if (chosen) { setTimeout(() => { dlg({ open: false }); const q = document.getElementById('sqlAiAsk'); if (q) q.focus(); }, 900); }
          return;
        }
        const m = await sql.aiModels(v.aiDlg.provider);
        const b = m.body || {};
        if (!m.ok) { dlg({ busy: '', models: [], status: 'Failure: ' + (b.error || 'no answer'), tone: 'bad' }); return; }
        dlg({ busy: '', models: b.models || [], status: 'Success: ' + (b.models || []).length + ' models this key may use. Pick one, then Save.', tone: 'ok' });
        return;
      }
      if (op === 'forget') {
        if (!window.confirm('Remove the key and settings of ' + this.label(v) + ' from this PC?')) return;
        await sql.aiForget(v.aiDlg.provider);
        const st = await sql.aiSettings();
        if (st.ok) {
          dlg({ settings: st.body, form: formOf(st.body, v.aiDlg.provider), fields: fields(st.body, v.aiDlg.provider), models: [], status: 'Removed from this PC.', tone: 'ok' });
          v.ai = Object.assign({}, v.ai, { who: W.aiWho(st.body) });
          fill();
        }
        return;
      }
      if (op === 'ask') {
        const q = String(v.ai.question || '').trim();
        if (!v.session.id) { bus.toast('Connect first: Ask AI reads the names of the tables of the connected schema.', 'error'); return; }
        if (!q) { v.ai = Object.assign({}, v.ai, { note: 'Write what you want to see, in plain words.', tone: 'bad' }); return; }
        if (!v.ai.who || /no model yet/.test(v.ai.who)) {
          await this.run(context, { op: 'open', value: 'Choose the LLM and a model first, then ask again.' });
          return;
        }
        v.busy = 'ai';
        v.ai = Object.assign({}, v.ai, { note: 'Asking ' + v.ai.who + '…', tone: '' });
        const ed = document.getElementById('sqlEditor');
        const r = await sql.aiAsk(v.session.id, q, ed ? ed.value : v.sql);
        v.busy = '';
        const b = r.body || {};
        if (!r.ok || !b.sql) {
          v.ai = Object.assign({}, v.ai, { note: b.error ? 'Not written: ' + b.error : (b.provider || 'The LLM') + ' wrote no SQL: ' + (b.explain || 'no answer.'), tone: 'bad' });
          return;
        }
        const ins = W.aiInsert(ed ? ed.value : v.sql, b.sql, q, b.provider);
        v.sql = ins.text;
        try { window.localStorage.setItem('equiprite-next:sql-worksheet', v.sql); } catch (e) { /* no storage */ }
        if (ed) { ed.value = ins.text; ed.focus(); ed.setSelectionRange(ins.start, ins.end); ed.scrollTop = ed.scrollHeight; }
        const kind = W.kindOf(b.sql);
        v.ai = Object.assign({}, v.ai, {
          tone: kind === 'query' ? 'ok' : 'warn',
          note: 'Written by ' + b.provider + ' · ' + b.model + ' in ' + W.took(b.ms) + (b.explain ? ': ' + b.explain : '.')
            + (kind === 'query' ? '' : ' It changes data or objects: read it carefully; a change waits for Commit.')
            + ' Sent: your question and the names of ' + b.sent.tables + ' tables and their columns (no rows). It is selected below: read it, then Ctrl+Enter.'
        });
      }
    }

    label(v) {
      const cat = ((v.aiDlg.settings || {}).catalog || []).filter((p) => p.id === v.aiDlg.provider)[0];
      return cat ? cat.label : 'the LLM';
    }
  }

  return aiChain;
});
