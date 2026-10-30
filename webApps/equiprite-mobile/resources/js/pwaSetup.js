define([], function () {
  'use strict';

  // Makes EquipRite Mobile installable (a PWA): the web app manifest, the iPhone's home-screen icon and the bar colour,
  // added to the page's head when the shell opens.
  //
  // Why at run time and not in index.html: a build puts the app's files under a version folder
  // (webApps/equiprite-mobile/version_…/resources/pwa/…) that index.html cannot name, so the addresses come from
  // require.toUrl. The manifest's start_url ("../../../") is relative to the manifest, so it is the app's own address
  // wherever it is deployed.
  //
  // When VB Studio's own PWA support is switched on (the web app's Settings, PWA), VB puts its manifest in the head;
  // then nothing is added here, so the two never compete.
  var THEME = '#2e5468';

  function addLink(doc, rel, href, extra) {
    var l = doc.createElement('link');
    l.setAttribute('rel', rel);
    l.setAttribute('href', href);
    Object.keys(extra || {}).forEach(function (k) { l.setAttribute(k, extra[k]); });
    doc.head.appendChild(l);
    return l;
  }

  function addMeta(doc, name, content) {
    if (doc.head.querySelector('meta[name="' + name + '"]')) return null;
    var m = doc.createElement('meta');
    m.setAttribute('name', name);
    m.setAttribute('content', content);
    doc.head.appendChild(m);
    return m;
  }

  /**
   * Adds what is missing. toUrl: require.toUrl (a path under the app to its address). Returns what was added, by name.
   */
  function apply(doc, toUrl) {
    var added = [];
    if (!doc || !doc.head || typeof toUrl !== 'function') return added;
    if (!doc.head.querySelector('link[rel="manifest"]')) {
      addLink(doc, 'manifest', toUrl('resources/pwa/manifest.json'));
      added.push('manifest');
    }
    if (!doc.head.querySelector('link[rel="apple-touch-icon"]')) {
      addLink(doc, 'apple-touch-icon', toUrl('resources/pwa/apple-touch-icon.png'));
      added.push('apple-touch-icon');
    }
    if (!doc.head.querySelector('link[rel="icon"]')) {
      addLink(doc, 'icon', toUrl('resources/pwa/icon-192.png'), { type: 'image/png', sizes: '192x192' });
      added.push('icon');
    }
    if (addMeta(doc, 'theme-color', THEME)) added.push('theme-color');
    if (addMeta(doc, 'apple-mobile-web-app-capable', 'yes')) added.push('apple-mobile-web-app-capable');
    if (addMeta(doc, 'mobile-web-app-capable', 'yes')) added.push('mobile-web-app-capable');
    if (addMeta(doc, 'apple-mobile-web-app-title', 'EquipRite')) added.push('apple-mobile-web-app-title');
    if (addMeta(doc, 'apple-mobile-web-app-status-bar-style', 'black-translucent')) added.push('apple-mobile-web-app-status-bar-style');
    return added;
  }

  return { apply: apply, THEME: THEME };
});
