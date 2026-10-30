define([], function () {
  'use strict';

  // Installing EquipRite Mobile on the phone's home screen (a PWA). Android's Chrome and Edge offer an install prompt
  // (beforeinstallprompt), kept here for the Me tab's Install button; an iPhone has none, so the Me tab says how
  // (Share, then Add to Home Screen). Opened from the home screen, the app runs standalone: installed.
  var deferred = null;
  var listeners = [];
  var installedNow = false;

  function tell() { listeners.forEach(function (fn) { try { fn(); } catch (e) { /* a listener's own problem */ } }); }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      tell();
    });
    window.addEventListener('appinstalled', function () {
      deferred = null;
      installedNow = true;
      tell();
    });
  }

  /** Whether the app is running from the home screen (or was just installed). */
  function installed(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (installedNow) return true;
    if (!w) return false;
    try {
      if (w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) { /* no media queries */ }
    return !!(w.navigator && w.navigator.standalone);
  }

  /** 'ios' | 'android' | 'other', for the right words. */
  function platform(ua) {
    var s = String(ua != null ? ua : (typeof navigator !== 'undefined' ? navigator.userAgent : ''));
    if (/iPhone|iPad|iPod/i.test(s) || (/Macintosh/.test(s) && /Mobile/.test(s))) return 'ios';
    if (/Android/i.test(s)) return 'android';
    return 'other';
  }

  /** How to install it, in words, for this phone. */
  function howTo(p) {
    if (p === 'ios') return ['Open this page in Safari.', 'Tap Share (the square with an arrow).', 'Tap Add to Home Screen, then Add.'];
    if (p === 'android') return ['Open this page in Chrome.', 'Tap the menu (three dots).', 'Tap Install app (or Add to Home screen).'];
    return ['Open this page on your phone (scan the address or send it to yourself).', 'Then add it to the home screen from the browser\'s menu.'];
  }

  /** Whether the browser offers its own install prompt now. */
  function canPrompt() { return !!deferred; }

  /** Shows the browser's install prompt: resolves 'accepted', 'dismissed' or 'unavailable'. */
  function prompt() {
    if (!deferred) return Promise.resolve('unavailable');
    var e = deferred;
    deferred = null;
    try {
      e.prompt();
      return Promise.resolve(e.userChoice).then(function (c) {
        tell();
        return c && c.outcome ? c.outcome : 'dismissed';
      }).catch(function () { return 'dismissed'; });
    } catch (err) {
      return Promise.resolve('unavailable');
    }
  }

  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  return { installed: installed, platform: platform, howTo: howTo, canPrompt: canPrompt, prompt: prompt, onChange: onChange };
});
