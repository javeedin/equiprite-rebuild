define([], function () {
  'use strict';

  // Code Fix, for the Code fix tab of Application pages (desktop/lib/codeFix.js does the work): the AI proposes a change
  // to a page; it is written to the code only when approved. The local server only (/__fix/*, X-EquipRite-Fix): the
  // desktop app. Each call resolves { ok, status, body } and never throws.

  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-Fix': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__fix/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false && !b.error, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The local server did not answer: ' + ((e && e.message) || e) } }; });
  }
  var post = function (p, b) { return call(p, 'POST', b || {}); };

  // Screenshots pasted, dropped or attached for a request: made at most 1600 px on their long side (what the AI reads
  // well, and far fewer tokens), kept as PNG if small enough, else JPEG. queue/take: the page module reads the clipboard
  // during the paste (it is gone after) and hands the images to the chain.
  var MAX_SIDE = 1600;
  function prepImage(file, name) {
    return new Promise(function (resolve) {
      if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type || '') || typeof FileReader === 'undefined') { resolve(null); return; }
      var fr = new FileReader();
      fr.onerror = function () { resolve(null); };
      fr.onload = function () {
        var url = String(fr.result || '');
        var img = new Image();
        img.onerror = function () { resolve(null); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAX_SIDE / Math.max(w, h, 1));
          var label = name || file.name || 'image';
          if (k === 1 && file.size <= 1.5e6 && file.type !== 'image/gif') { resolve({ name: label, mime: file.type, base64: url.split(',')[1], url: url, w: w, h: h, size: file.size }); return; }
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
          var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          var mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
          var out = c.toDataURL(mime, 0.88);
          if (mime === 'image/png' && out.length > 2.8e6) { mime = 'image/jpeg'; out = c.toDataURL(mime, 0.88); }
          resolve({ name: label, mime: mime, base64: out.split(',')[1], url: out, w: c.width, h: c.height, size: Math.round(out.length * 0.75) });
        };
        img.src = url;
      };
      fr.readAsDataURL(file);
    });
  }
  var queued = [];
  function queueImages(list) { queued = queued.concat((list || []).filter(Boolean)); }
  function takeImages() { var q = queued; queued = []; return q; }

  return {
    info: function () { return call('info'); },
    list: function (page) { return call('list?page=' + encodeURIComponent(page || '')); },
    history: function (q) { return call('history?q=' + encodeURIComponent(q || '')); },
    get: function (id) { return call('get?id=' + encodeURIComponent(id || '')); },
    prepImage: prepImage, queueImages: queueImages, takeImages: takeImages,
    imgUrl: function (fix, n) { return fix ? '/__fix/img?id=' + encodeURIComponent(fix.id) + '&n=' + n : ''; },
    shotUrl: function (fix, which) { return fix && fix.preview ? '/__fix/shot?id=' + encodeURIComponent(fix.id) + '&which=' + which + '&t=' + encodeURIComponent(fix.preview.at || '') : ''; },
    pick: function () { return post('pick'); },
    analyze: function (b) { return post('analyze', b); },
    preview: function (fix) { return post('preview', { fix: fix }); },
    apply: function (fix, skipPull) { return post('apply', { fix: fix, skipPull: !!skipPull }); },
    test: function (fix) { return post('test', { fix: fix }); },
    e2e: function (fix) { return post('e2e', { fix: fix }); },
    undo: function (fix, force) { return post('undo', { fix: fix, force: !!force }); },
    commit: function (fix, push) { return post('commit', { fix: fix, push: !!push }); },
    discard: function (fix) { return post('discard', { fix: fix }); }
  };
});
