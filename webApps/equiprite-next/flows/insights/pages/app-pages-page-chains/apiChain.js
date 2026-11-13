define(['vb/action/actionChain', 'resources/js/apiClient'], (ActionChain, AC) => {
  'use strict';

  // The API tester (desktop/lib/apiTest.js): a REST call or a BI Publisher report of the open page, sent to the real
  // backend through the local server's proxy. Its inputs are filled and read here (a native input's value is the DOM's):
  //   load         the page's last runs and its reports (when a page is picked)
  //   open/report  the tester for a call / a report: what it sends, the values last used filled in
  //   send         sends it (a call that changes data waits for 'Send it': confirm); the answer shown
  //   suggest      a value offered (seen in another call's answer, or one of its choices) put in its box
  //   checkAll     every call of the page that only reads (the ids one answers fill the next)
  //   tab, copy, template, cancel, close, closed
  const dlg = () => { try { return document.getElementById('apiDlg'); } catch (e) { return null; } };
  const byId = (id) => { try { return document.getElementById(id); } catch (e) { return null; } };
  const keysOf = (v) => {
    const rest = (((v.sheet || {}).facts || {}).integrations || {}).rest || [];
    return rest.map((r) => r.endpoint).concat((v.apiReports || []).map((r) => r.key));
  };
  /** The boxes, once drawn: each parameter's value last used (or its default), the body, more parameters. */
  function fill(desc, tries) {
    const box = byId('apiParams');
    if (!box) { if ((tries || 0) < 20) setTimeout(() => fill(desc, (tries || 0) + 1), 50); return; }
    const saved = desc.saved || {};
    const sp = saved.params || {};
    Array.prototype.forEach.call(box.querySelectorAll('[data-param]'), (el) => {
      const p = (desc.op.params || []).filter((x) => x.name === el.getAttribute('data-param'))[0] || {};
      el.value = sp[p.name] !== undefined ? sp[p.name] : (p.def || '');
    });
    const ex = byId('apiExtra');
    if (ex) ex.value = saved.extra || '';
    const body = byId('apiBody');
    if (body) body.value = saved.body || (desc.op.body ? desc.op.body.template : '');
    const first = box.querySelector('[data-param]') || byId('apiSend');
    if (first && first.focus) first.focus();
  }
  function values() {
    const params = {};
    const box = byId('apiParams');
    if (box) Array.prototype.forEach.call(box.querySelectorAll('[data-param]'), (el) => { params[el.getAttribute('data-param')] = el.value; });
    const ex = byId('apiExtra');
    const body = byId('apiBody');
    return { params, extra: ex ? ex.value : '', body: body ? body.value : '' };
  }

  class apiChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const k = String(key || '');
      if (!act) return;

      if (act === 'load') {
        const pid = v.selId;
        const facts = (v.sheet || {}).facts || {};
        v.apiPage = pid; v.apiCheck = null;
        const names = ((facts.integrations || {}).reports || []);
        const rr = names.length ? await AC.reports(pid, names) : { ok: true, body: { reports: [] } };
        if (v.selId !== pid) return;
        v.apiReports = rr.ok ? (rr.body.reports || []) : [];
        const lr = await AC.last(keysOf(v));
        if (v.selId === pid) v.apiLast = lr.ok ? (lr.body.last || {}) : {};
        return;
      }

      if (act === 'open' || act === 'report') {
        v.apiOpen = k; v.apiDesc = null; v.apiRes = null; v.apiHist = []; v.apiMsg = null; v.apiConfirm = false; v.apiTab = 'data';
        try { const d = dlg(); if (d && !d.open) d.showModal(); } catch (e) { /* no DOM */ }
        let r;
        if (act === 'report') {
          const rep = (v.apiReports || []).filter((x) => x.key === k)[0];
          r = rep ? await AC.report(rep) : { ok: false, body: { error: 'This report is not on the page any more.' } };
        } else r = await AC.op(k);
        if (v.apiOpen !== k) return;
        if (!r.ok) { v.apiMsg = { ok: false, text: r.body.error || 'Could not read this call.' }; return; }
        v.apiDesc = r.body; v.apiHist = r.body.history || [];
        setTimeout(() => fill(r.body), 30);
        return;
      }

      if (act === 'send' || act === 'confirm') {
        const desc = v.apiDesc;
        if (!desc || v.apiBusy) return;
        const vals = values();
        const req = Object.assign({ confirm: act === 'confirm' }, vals, desc.op.report
          ? { report: { path: desc.op.reportPath, name: desc.op.reportName, params: desc.op.params.map((p) => p.name), rowTag: desc.op.rowTag } }
          : { endpoint: desc.op.endpoint });
        v.apiBusy = true; v.apiMsg = null;
        try {
          const r = await AC.run(req);
          if (v.apiOpen !== desc.op.key) return;
          if (r.body.needsConfirm) { v.apiConfirm = true; v.apiMsg = { ok: false, text: r.body.error }; return; }
          v.apiConfirm = false;
          if (r.body.status === undefined) { v.apiMsg = { ok: false, text: r.body.error || 'Not sent.' }; return; }
          v.apiRes = r.body;
          v.apiHist = r.body.history || [];
          v.apiTab = r.body.table && r.body.table.total ? 'data' : (r.body.shape && r.body.shape.status === 'differs' ? 'shape' : 'body');
          const last = Object.assign({}, v.apiLast);
          if (r.body.history && r.body.history[0]) last[desc.op.key] = r.body.history[0];
          v.apiLast = last;
        } finally { v.apiBusy = false; }
        return;
      }

      if (act === 'cancel') { v.apiConfirm = false; v.apiMsg = null; return; }

      if (act === 'suggest') {
        const i = k.indexOf('=');
        const name = i < 0 ? k : k.slice(0, i);
        const box = byId('apiParams');
        const el = box ? Array.prototype.filter.call(box.querySelectorAll('[data-param]'), (x) => x.getAttribute('data-param') === name)[0] : null;
        if (el) { el.value = i < 0 ? '' : k.slice(i + 1); if (el.focus) el.focus(); }
        return;
      }

      if (act === 'template') {
        const body = byId('apiBody');
        if (body && v.apiDesc && v.apiDesc.op.body) body.value = v.apiDesc.op.body.template;
        return;
      }

      if (act === 'tab') { v.apiTab = k; return; }

      if (act === 'copy') {
        const res = v.apiRes;
        const text = !res ? '' : (k === 'curl' ? res.curl : res.pretty);
        try { await navigator.clipboard.writeText(text); v.apiMsg = { ok: true, text: k === 'curl' ? 'The curl command is copied (the password left out).' : 'The answer is copied.' }; } catch (e) { v.apiMsg = { ok: false, text: 'Could not copy: ' + ((e && e.message) || e) }; }
        return;
      }

      if (act === 'checkAll') {
        const rest = (((v.sheet || {}).facts || {}).integrations || {}).rest || [];
        if (!rest.length || v.apiChecking) return;
        const pid = v.selId;
        v.apiChecking = true; v.apiCheck = null;
        try {
          const r = await AC.check(rest.map((x) => x.endpoint));
          if (v.selId !== pid) return;
          v.apiCheck = r.ok ? r.body : { results: [], error: r.body.error || 'Check all did not run.' };
          const lr = await AC.last(keysOf(v));
          if (v.selId === pid && lr.ok) v.apiLast = lr.body.last || {};
        } finally { v.apiChecking = false; }
        return;
      }

      if (act === 'close') { try { const d = dlg(); if (d && d.open) d.close(); } catch (e) { /* no DOM */ } act = 'closed'; }
      if (act === 'closed') { v.apiOpen = ''; v.apiConfirm = false; v.apiMsg = null; }
    }
  }
  return apiChain;
});
