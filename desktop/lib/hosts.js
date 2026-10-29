'use strict';

/**
 * Which URLs may open inside the desktop window, and which open in the user's default browser instead.
 *
 * The app runs from the local server (http://localhost:<port>/), so every normal navigation and every
 * REST call (proxied server-side by vb-serve) is same-origin and stays in the window. Links to Oracle
 * hosts the app legitimately reaches (Fusion, OIC, VBCS, the CDN) also stay in the window; anything else
 * opens externally. Resource loads (scripts, images from static.oracle.com) are not navigations and are
 * never gated here.
 *
 * Plain Node, no Electron, so npm test can check it too.
 */
const ORACLE_HOSTS = [
  /^static\.oracle\.com$/i, // JET / oj-sp / VB runtime CDN
  /^[a-z0-9-]+\.ds-fa\.oraclepdemos\.com$/i, // Fusion demo pods (fa-…-saasfademo1.ds-fa.oraclepdemos.com)
  /^[a-z0-9-]+\.fa\.[a-z0-9-]+\.oraclecloud\.com$/i, // Fusion pods (REST and BI Publisher)
  /^[a-z0-9-]+\.integration\.[a-z0-9-]+\.ocp\.oraclecloud\.com$/i, // OIC / Integration Applications
  /^[a-z0-9-]+\.builder\.[a-z0-9-]+\.ocp\.oraclecloud\.com$/i, // Visual Builder (VBCS)
];

/**
 * @param {string} url      the URL a navigation or window-open is heading to
 * @param {string} appOrigin the local app's origin, e.g. "http://localhost:18888"
 * @returns {boolean} true to keep it in the window, false to open it in the default browser
 */
function navAllowed(url, appOrigin) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.origin === appOrigin) {
    return true; // the app itself
  }
  if (u.protocol !== 'https:') {
    return false;
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  return ORACLE_HOSTS.some((re) => re.test(host));
}

/**
 * Old EquipRite opens in a window of its own when a link in New EquipRite points at it, so the New window stays
 * where it was (side-by-side demos). True when `url` is on the old app's origin and the window it was clicked in
 * shows a different origin.
 *
 * @param {string} url         where the link goes
 * @param {string} shownOrigin the origin the clicked window shows, e.g. "http://localhost:18889"
 * @param {string} oldOrigin   Old EquipRite's origin, e.g. "http://localhost:18888"
 */
function opensInOldWindow(url, shownOrigin, oldOrigin) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.origin === oldOrigin && shownOrigin !== oldOrigin;
}

module.exports = { navAllowed, opensInOldWindow, ORACLE_HOSTS };
