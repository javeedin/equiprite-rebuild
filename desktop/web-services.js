'use strict';

/*
 * Web services page of the desktop client (served by the local server at /__services/).
 * Lists every endpoint from /__services/data.json and runs GET requests through /__backend/<name>/…, the same
 * forwarding the app's own calls use, so they go out with the same credentials (none for eqpt, the Fusion login
 * from the sign-in window for Fusion). Only GET is offered, so a test never changes data.
 */
(async function () {
  const $ = (id) => document.getElementById(id);
  const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const MAX_SHOWN = 300 * 1024;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pathHtml = (p) => esc(p).replace(/\{([^}]+)\}/g, '<i>{$1}</i>');
  const state = { svc: null, methods: new Set(), usage: 'all', q: '' };

  let DATA;
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    DATA = await res.json();
    if (!res.ok) {
      throw new Error(DATA.error || `HTTP ${res.status}`);
    }
  } catch (e) {
    $('lede').textContent = `Could not read the service connections: ${e.message}`;
    return;
  }

  const svcBy = Object.fromEntries(DATA.services.map((s) => [s.name, s]));
  const total = DATA.rows.length;
  const used = DATA.rows.filter((r) => r.f.length).length;
  const who = DATA.identity || {};
  const AUTH = {
    anon: ['Anonymous', 'No login, as in VBCS (forceProxy only forwards the call).'],
    fusion: ['Fusion credential', who.hasFusionLogin
      ? `Basic auth with the Fusion login from the sign-in window (${esc(who.fusionUser)}), standing in for the VBCS stored credential.`
      : 'Needs the Fusion login from the sign-in window (File → Sign in as… in the app window); without it Fusion answers 401.'],
    other: ['Own credential', 'Uses its own VBCS stored credential, which is not available locally; expect 401.'],
  };

  $('lede').innerHTML = `<b>${total} endpoints</b> across <b>${DATA.services.length} service connections</b>, read from
    <code>services/</code> just now; <b>${used}</b> are called by the app's pages and chains. Signed in as
    <b>${esc(who.username || 'nobody')}</b>${who.hasFusionLogin ? ' with a Fusion login' : ', no Fusion login'}.
    Open a GET to test it against the live backend.`;

  function renderServices() {
    $('services').innerHTML = DATA.services.map((s) => `
      <button class="svc" type="button" data-svc="${esc(s.name)}" aria-pressed="${state.svc === s.name}">
        <span class="n">${esc(s.name)}</span>
        <span class="host">${esc(s.backend)} · ${esc(s.url.replace(/^https?:\/\//, ''))}</span>
        <span class="meta"><span class="pill ${s.auth}">${AUTH[s.auth][0]}</span> ${s.count} endpoints · ${s.used} called</span>
      </button>`).join('');
  }
  $('services').addEventListener('click', (e) => {
    const b = e.target.closest('.svc');
    if (b) {
      state.svc = state.svc === b.dataset.svc ? null : b.dataset.svc;
      renderServices();
      render();
    }
  });

  $('methods').innerHTML = METHODS.map((m) => `<button type="button" class="chip" data-m="${m}" aria-pressed="false">${m}</button>`).join(' ');
  $('methods').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (b) {
      const m = b.dataset.m;
      if (state.methods.has(m)) {
        state.methods.delete(m);
      } else {
        state.methods.add(m);
      }
      b.setAttribute('aria-pressed', state.methods.has(m));
      render();
    }
  });
  let timer;
  $('q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); render(); }, 80);
  });
  $('usage').addEventListener('change', (e) => { state.usage = e.target.value; render(); });

  function matches(r) {
    if (state.svc && r.s !== state.svc) return false;
    if (state.methods.size && !state.methods.has(r.m)) return false;
    if (state.usage === 'used' && !r.f.length) return false;
    if (state.usage === 'unused' && r.f.length) return false;
    if (!state.q) return true;
    const hay = `${r.p} ${r.o} ${r.t} ${r.d} ${r.s}/${r.o}`.toLowerCase();
    return state.q.split(/\s+/).every((w) => hay.includes(w));
  }

  function testPanel(r, i) {
    if (r.m !== 'GET') {
      return `<p class="note">Testing runs GET only, so nothing is created, changed or deleted by mistake.</p>`;
    }
    const inputs = r.params.map((p, j) => `
      <label><span>${p.in === 'path' ? 'Path' : 'Query'} · <b>${esc(p.name)}</b>${p.required ? ' (required)' : ''}</span>
        <input data-row="${i}" data-param="${j}" value="${esc(p.example)}" placeholder="${esc(p.type || 'value')}"
          title="${esc(p.description)}" spellcheck="false" autocomplete="off"></label>`).join('');
    return `<div class="test">
      <h3>Test this GET</h3>
      ${inputs ? `<div class="params">${inputs}</div>` : '<p class="note">No parameters.</p>'}
      <div class="go">
        <input class="extra" data-extra="${i}" placeholder="More query parameters, e.g. limit=5&amp;offset=0" spellcheck="false" aria-label="More query parameters">
        <button class="send" type="button" data-send="${i}">Send GET</button>
      </div>
      <div class="res" data-res="${i}" hidden></div>
    </div>`;
  }

  function row(r, i) {
    const s = svcBy[r.s];
    const files = r.f.length
      ? `<ul class="files">${r.f.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
      : '<span class="sub">No page, fragment or chain names this endpoint.</span>';
    return `<details data-i="${i}">
      <summary>
        <span class="m ${r.m}">${r.m}</span>
        <span class="what"><span class="path">${pathHtml(r.p)}</span>
          <span class="sub"><code>${esc(r.o)}</code>${r.t ? ' · ' + esc(r.t) : ''}</span></span>
        <span class="use">${r.f.length ? `called in ${r.f.length} file${r.f.length > 1 ? 's' : ''}` : 'not referenced'}</span>
      </summary>
      <div class="detail">
        <dl class="kv">
          <dt>Endpoint ID</dt><dd><code>${esc(r.s)}/${esc(r.o)}</code></dd>
          <dt>Backend URL</dt><dd><code>${esc(s.url + r.p)}</code></dd>
          <dt>Credentials</dt><dd>${AUTH[s.auth][1]}</dd>
          ${r.d ? `<dt>Description</dt><dd>${esc(r.d)}</dd>` : ''}
          <dt>Called from</dt><dd>${files}</dd>
        </dl>
        ${testPanel(r, i)}
      </div>
    </details>`;
  }

  let shown = [];
  function render() {
    shown = DATA.rows.map((r, i) => [r, i]).filter(([r]) => matches(r));
    $('count').textContent = shown.length === total ? `${total} endpoints` : `${shown.length} of ${total}`;
    if (!shown.length) {
      $('out').innerHTML = '<p class="empty">No endpoint matches. Clear the search or a filter.</p>';
      return;
    }
    const groups = new Map();
    shown.forEach(([r, i]) => {
      const k = `${r.s}\u0000${r.g}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push([r, i]);
    });
    $('out').innerHTML = [...groups.entries()].map(([k, rs]) => {
      const [s, g] = k.split('\u0000');
      return `<section class="group"><h2>${esc(g || s)} <span>${esc(s)} · ${rs.length}</span></h2>
        <div class="list">${rs.map(([r, i]) => row(r, i)).join('')}</div></section>`;
    }).join('');
  }

  async function send(i, button) {
    const r = DATA.rows[i];
    const s = svcBy[r.s];
    const out = document.querySelector(`[data-res="${i}"]`);
    const values = [...document.querySelectorAll(`input[data-row="${i}"]`)].map((inp) => [r.params[Number(inp.dataset.param)], inp.value.trim()]);
    const missing = values.filter(([p, v]) => p.required && !v).map(([p]) => p.name);
    out.hidden = false;
    if (missing.length) {
      out.innerHTML = `<span class="err">Enter ${missing.map(esc).join(', ')} first.</span>`;
      return;
    }
    let p = r.p;
    const qs = new URLSearchParams();
    values.forEach(([prm, v]) => {
      if (prm.in === 'path') {
        p = p.replace(`{${prm.name}}`, encodeURIComponent(v));
      } else if (v) {
        qs.append(prm.name, v);
      }
    });
    const extra = document.querySelector(`[data-extra="${i}"]`).value.trim().replace(/^\?/, '');
    new URLSearchParams(extra).forEach((v, k) => qs.append(k, v));
    const query = qs.toString() ? `?${qs}` : '';
    const local = `/__backend/${encodeURIComponent(s.backend)}${p}${query}`;
    button.disabled = true;
    out.innerHTML = `<div class="sent">GET ${esc(s.url + p + query)}</div><div class="head">Waiting for ${esc(s.backend)}…</div>`;
    const started = performance.now();
    try {
      const res = await fetch(local, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const text = await res.text();
      const ms = Math.round(performance.now() - started);
      let body = text;
      const type = res.headers.get('content-type') || '';
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // not JSON: show as text
      }
      const cut = body.length > MAX_SHOWN;
      const hint = res.status === 401 && s.auth !== 'anon'
        ? `<span class="err">${s.auth === 'fusion' ? 'Fusion refused the login. Set or fix it with File → Sign in as… in the app window.' : 'This backend needs its own credential, which is not available locally.'}</span>`
        : res.status === 502 ? `<span class="err">The local server could not reach ${esc(s.backend)} from this PC.</span>` : '';
      out.innerHTML = `<div class="sent">GET ${esc(s.url + p + query)}</div>
        <div class="head"><span class="pill ${res.ok ? 'ok' : 'bad'}">${res.status} ${esc(res.statusText)}</span>
          <span>${ms} ms</span><span>${(text.length / 1024).toFixed(1)} KB</span><span>${esc(type.split(';')[0])}</span>
          <button class="small" type="button" data-copy="${i}">Copy response</button></div>
        ${hint}
        <pre>${esc(cut ? body.slice(0, MAX_SHOWN) : body) || '(empty body)'}</pre>
        ${cut ? `<p class="note">Showing the first 300 KB of ${(body.length / 1024).toFixed(0)} KB.</p>` : ''}`;
      out.dataset.body = body;
    } catch (e) {
      out.innerHTML = `<div class="sent">GET ${esc(s.url + p + query)}</div><span class="err">The request did not complete: ${esc(e.message)}</span>`;
    } finally {
      button.disabled = false;
    }
  }

  $('out').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-send]');
    if (b) {
      send(Number(b.dataset.send), b);
      return;
    }
    const c = e.target.closest('[data-copy]');
    if (c) {
      const res = document.querySelector(`[data-res="${c.dataset.copy}"]`);
      try {
        await navigator.clipboard.writeText(res.dataset.body || '');
        c.textContent = 'Copied';
      } catch {
        c.textContent = 'Copy failed';
      }
      setTimeout(() => { c.textContent = 'Copy response'; }, 1400);
    }
  });
  $('out').addEventListener('keydown', (e) => {
    const inp = e.target.closest('input[data-row], input[data-extra]');
    if (inp && e.key === 'Enter') {
      const i = inp.dataset.row || inp.dataset.extra;
      const b = document.querySelector(`[data-send="${i}"]`);
      if (b) send(Number(i), b);
    }
  });

  renderServices();
  render();
})();
