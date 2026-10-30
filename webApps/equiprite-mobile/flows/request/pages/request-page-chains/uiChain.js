define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // What the screen shows, nothing written:
  //   sheet (value)  a bottom sheet: cart | customer | project | task | reset, or '' to close it. The customer and
  //                  project sheets show their report's list straight away (searchChain, kept a few minutes)
  //   line (value)   a cart line's own dates and note, open or shut
  //   replace        the request asked for while something else was being raised here, now that it is confirmed
  //   notice         the note above the step, dismissed
  //   view (value)   back to the form after a submit (Raise another request)
  //   online (value) the connection came back or went (the page module's window listeners); back, it reads again
  //                  what could not be read without it
  class uiChain extends ActionChain {
    async run(context, { action, value }) {
      const { $page } = context;
      const v = $page.variables;
      const val = value == null ? '' : String(value);

      if (action === 'sheet') {
        if (v.sheet === 'replace' && val === '') v.pending = null;
        v.sheet = val;
        if (val === 'customer' || val === 'project') {
          if (!(v[val + 'Results'] || []).length || v[val + 'Query']) {
            await Actions.callChain(context, { chain: 'searchChain', params: { kind: val, text: '' } });
          }
        } else if (val === 'task') {
          v.taskQuery = '';
        }
        return;
      }
      if (action === 'line') {
        const id = Number(val) || 0;
        v.lineOpen = v.lineOpen === id ? 0 : id;
        return;
      }
      if (action === 'replace') {
        const p = v.pending ? { id: v.pending.id, number: v.pending.number, mode: v.pending.mode } : null;
        v.pending = null;
        v.sheet = '';
        if (!p) return;
        await Actions.callChain(context, { chain: 'resumeChain', params: { id: String(p.id || ''), number: p.number || '',
          mode: p.mode === 'again' ? 'again' : '', confirmed: true } });
        return;
      }
      if (action === 'notice') {
        v.notice = '';
        return;
      }
      if (action === 'view') {
        v.view = val === 'sent' ? 'sent' : 'form';
        if (v.view === 'form') v.sent = null;
        return;
      }
      if (action === 'online') {
        const on = value === true || val === 'true';
        const was = v.online;
        v.online = on;
        if (on && !was) {
          if (String(v.saveError || '').indexOf('No connection') === 0) v.saveError = '';
          if (v.catalogError || !(v.catalogRows || []).length) Actions.callChain(context, { chain: 'loadCatalogChain' });
          Actions.callChain(context, { chain: 'draftsChain', params: { refresh: true } });
        }
      }
    }
  }

  return uiChain;
});
